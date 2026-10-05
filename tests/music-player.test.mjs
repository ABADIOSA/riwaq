import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MusicTransport } from "../core/music-player.mjs";
import { MusicLibrary, audioRange } from "../electron/music-library.mjs";
import { Client } from "../core/client.mjs";
import { collectBackup } from "../core/backup.mjs";
import { SpotifyHub } from "../core/spotify.mjs";

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
function transport(resolve = async (id) => ({ url: id })) {
  const elements = [];
  const engine = new MusicTransport({
    resolve,
    changed: () => {},
    random: () => 0,
    createAudio: () => {
      const audio = {
        paused: true,
        currentTime: 0,
        duration: 100,
        play: async function () {
          this.paused = false;
        },
        pause() {
          this.paused = true;
        },
        removeAttribute() {},
        load() {},
      };
      elements.push(audio);
      return audio;
    },
  });
  engine.queue(["a", "b", "c"]);
  return { engine, elements };
}
test("audio starts ignore late sources and a stop cancels a pending start", async () => {
  const late = deferred(),
    { engine, elements } = transport((id) =>
      id === "a" ? late.promise : Promise.resolve({ url: id }),
    );
  const first = engine.play("a");
  await engine.play("b");
  late.resolve({ url: "a" });
  await first;
  assert.equal(engine.state.id, "b");
  assert.equal(elements.length, 1);
  assert.equal(elements[0].src, "b");
  const wait = deferred();
  engine.resolve = () => wait.promise;
  const started = engine.play("c");
  engine.stop();
  wait.resolve({ url: "c" });
  await started;
  assert.equal(engine.state.id, "");
  assert.equal(elements.length, 1);
  assert.equal(elements[0].paused, true);
});
test("shuffle visits every queued title once; repeats and previous are explicit", async () => {
  const { engine } = transport();
  engine.option("shuffle", true);
  await engine.play("a");
  await engine.next(true);
  assert.equal(engine.state.id, "b");
  await engine.next(true);
  assert.equal(engine.state.id, "c");
  await engine.next(true);
  assert.equal(engine.state.playing, false);
  engine.option("repeat", "all");
  await engine.next(true);
  assert.equal(engine.state.id, "a");
  engine.option("repeat", "one");
  await engine.next(true);
  assert.equal(engine.state.id, "a");
  engine.option("shuffle", false);
  await engine.next();
  assert.equal(engine.state.id, "b");
  await engine.previous();
  assert.equal(engine.state.id, "a");
});
test("seek, volume and errors are bounded; a corrupt file never creates a skip loop", async () => {
  const { engine, elements } = transport();
  await engine.play("a");
  const audio = elements[0];
  audio.onloadedmetadata();
  engine.seek(150);
  assert.equal(audio.currentTime, 100);
  engine.seek(NaN);
  assert.equal(audio.currentTime, 100);
  engine.option("volume", -10);
  assert.equal(audio.volume, 0);
  engine.option("volume", 2);
  assert.equal(audio.volume, 1);
  audio.onerror();
  assert.equal(engine.state.playing, false);
  assert.match(engine.state.error, /قراءة/);
  assert.equal(elements.length, 1);
  await engine.next();
  assert.equal(engine.state.id, "b");
  assert.equal(engine.state.error, "");
});
test("pause cancels source loading, and an old element cannot publish after replacement", async () => {
  const { engine, elements } = transport();
  await engine.play("a");
  const late = elements[0].onended;
  await engine.play("b");
  late();
  assert.equal(engine.state.id, "b");
  const wait = deferred();
  engine.resolve = () => wait.promise;
  const start = engine.play("c");
  engine.pause();
  wait.resolve({ url: "c" });
  await start;
  assert.equal(engine.state.loading, false);
  assert.equal(elements.length, 2);
});
test("byte ranges support seek, suffix and invalid/empty requests", () => {
  assert.deepEqual(audioRange("bytes=3-8", 6), {
    start: 3,
    end: 5,
    partial: true,
  });
  assert.deepEqual(audioRange("bytes=-3", 10), {
    start: 7,
    end: 9,
    partial: true,
  });
  assert.deepEqual(audioRange(null, 10), { start: 0, end: 9, partial: false });
  for (const h of [
    "bytes=10-",
    "bytes=4-2",
    "bytes=0-1,3-4",
    "bytes=-0",
    "no",
    "bytes=9007199254740992-",
  ])
    assert.equal(audioRange(h, 10), null);
  assert.equal(audioRange(null, 0), null);
});
test("resuming rechecks audio focus, and a pause cancels an in-flight resume", async () => {
  const { engine, elements } = transport();
  await engine.play("a");
  engine.pause();
  const wait = deferred();
  let checked = 0;
  engine.beforeResume = async () => {
    checked++;
    await wait.promise;
  };
  const resume = engine.resume();
  engine.pause();
  wait.resolve();
  await resume;
  assert.equal(checked, 1);
  assert.equal(elements[0].paused, true);
  assert.equal(engine.state.playing, false);
  engine.beforeResume = async () => {
    throw new Error("مشاهدة نشطة");
  };
  await engine.resume();
  assert.equal(elements[0].paused, true);
  assert.match(engine.state.error, /مشاهدة/);
});
async function libraryRig() {
  const folder = await mkdtemp(join(tmpdir(), "riwaq-audio-test-"));
  const file = join(folder, "أغنية.wav");
  await writeFile(file, "0123456789");
  let saved;
  const client = new Client({
    load: () => ({}),
    save: (s) => (saved = structuredClone(s)),
  });
  return {
    file,
    client,
    library: new MusicLibrary(client),
    saved: () => saved,
  };
}
test("library imports only selected audio, hides paths, persists and excludes paths from backup", async () => {
  const { file, client, library, saved } = await libraryRig();
  const imported = await library.importFiles("default", [
    file,
    file,
    file + ".txt",
  ]);
  assert.equal(imported.added, 1);
  assert.equal(imported.skipped, 2);
  assert.doesNotMatch(JSON.stringify(imported), /path|Users|Temp/);
  const id = imported.tracks[0].id;
  library.edit({ profileId: "default", action: "queue", ids: [id, "bad", id] });
  library.edit({
    profileId: "default",
    action: "playlist",
    name: "ليلة هادئة",
    ids: [id],
  });
  library.edit({ profileId: "default", action: "favorite", id });
  const restarted = new MusicLibrary(
    new Client({ load: saved, save: () => {} }),
  );
  assert.equal(restarted.view("default").tracks[0].favorite, true);
  assert.deepEqual(restarted.view("default").queue, [id]);
  assert.equal(restarted.view("default").playlists[0].name, "ليلة هادئة");
  assert.equal(
    JSON.stringify(client.publicState()).includes(
      file.replaceAll("\\", "\\\\"),
    ),
    false,
  );
  assert.equal(
    JSON.stringify(
      collectBackup(client.state, { includeSecrets: true }),
    ).includes("localMusic"),
    false,
  );
});
test("local audio capabilities support partial reads and expire on revoke or profile switch", async () => {
  const { file, client, library } = await libraryRig();
  const id = (await library.importFiles("default", [file])).tracks[0].id;
  const { url } = await library.source({ profileId: "default", id });
  library.edit({ profileId: "default", action: "remove", id: "unrelated" });
  const response = await library.respond(
    new Request(url, { headers: { range: "bytes=2-5" } }),
  );
  assert.equal(response.status, 206);
  assert.equal(await response.text(), "2345");
  assert.equal(response.headers.get("Content-Range"), "bytes 2-5/10");
  assert.equal(
    (await library.respond(new Request(url.replace("track", "other")))).status,
    403,
  );
  assert.equal(
    (
      await library.respond(
        new Request(url, { headers: { range: "bytes=30-" } }),
      )
    ).status,
    416,
  );
  library.revoke();
  assert.equal((await library.respond(new Request(url))).status, 403);
  const again = await library.source({ profileId: "default", id });
  client.profiles.create({ name: "guest" });
  const guest = client.profiles.store.list.at(-1).id;
  client.profiles.switch({ id: guest });
  assert.equal((await library.respond(new Request(again.url))).status, 403);
  assert.equal(library.view(guest).tracks.length, 0);
  await assert.rejects(library.source({ profileId: "default", id }), /تغير/);
  assert.throws(
    () => library.edit({ profileId: "default", action: "remove", id }),
    /تغير/,
  );
});
test("library gate protects reads/imports and missing files fail clearly; remove only changes references", async () => {
  const { file, client, library } = await libraryRig();
  const id = (await library.importFiles("default", [file])).tracks[0].id;
  library.edit({ profileId: "default", action: "queue", ids: [id] });
  library.edit({
    profileId: "default",
    action: "playlist",
    name: "list",
    ids: [id],
  });
  client.profiles.setPin({ id: "default", pin: "1234" });
  client.profiles.update({ id: "default", lockedRooms: ["library"] });
  client.profiles.lock();
  assert.throws(() => library.view("default"));
  await assert.rejects(library.importFiles("default", [file]));
  client.profiles.unlock("1234");
  await unlink(file);
  await assert.rejects(
    library.source({ profileId: "default", id }),
    /غير موجود/,
  );
  const removed = library.edit({ profileId: "default", action: "remove", id });
  assert.equal(removed.tracks.length, 0);
  assert.equal(removed.queue.length, 0);
  assert.equal(removed.playlists[0].ids.length, 0);
});
test("late Spotify refresh and login cannot recreate credentials after disconnect", async () => {
  for (const exchange of [false, true]) {
    const wait = deferred(),
      bag = {
        clientId: "a".repeat(32),
        token: { refresh_token: "old", expires_at: 0 },
      };
    const hub = new SpotifyHub({
      bag: () => bag,
      save: () => {},
      request: () => wait.promise,
    });
    const work = exchange ? hub.exchange("code", "verifier") : hub.token();
    const rejected = assert.rejects(work, /انتهى/);
    hub.disconnect();
    wait.resolve({
      status: 200,
      data: { access_token: "late", refresh_token: "late", expires_in: 3600 },
    });
    await rejected;
    assert.equal(bag.token, undefined);
    assert.equal(hub.publicState().connected, false);
  }
});
test("a late 401 from an old Spotify link cannot expire a replacement account", async () => {
  const wait = deferred(),
    bag = {
      clientId: "a".repeat(32),
      token: {
        access_token: "old",
        refresh_token: "r",
        expires_at: Date.now() + 3600000,
      },
    };
  const hub = new SpotifyHub({
    bag: () => bag,
    save: () => {},
    request: () => wait.promise,
  });
  const work = hub.playback();
  const rejected = assert.rejects(work, /انتهى/);
  await Promise.resolve();
  hub.disconnect();
  bag.token = {
    access_token: "new",
    refresh_token: "new-r",
    expires_at: 123456789,
  };
  wait.resolve({ status: 401 });
  await rejected;
  assert.equal(bag.token.expires_at, 123456789);
  assert.equal(bag.token.access_token, "new");
});
