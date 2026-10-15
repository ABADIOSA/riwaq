import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { PlaybackRequest } from "../core/playback-request.mjs";
import { OfflineLibrary, downloadFile } from "../electron/offline.mjs";
import { collectBackup, restoreState } from "../core/backup.mjs";
import { safeSettings } from "../core/protocol.mjs";
import { startEngine } from "../electron/torrent-engine.mjs";
import { offlineEpisode } from "../core/offline-media.mjs";
import { episodeLabel } from "../core/episodes.mjs";
import { translate } from "../core/i18n.mjs";
const meta = { id: "tt1234567", type: "movie", name: "Fixture" };

test("offline episode identity prefers metadata, supports legacy IDs and never invents opaque episode numbers", () => {
  const series = {
    id: "kitsu:123",
    type: "anime",
    videos: [
      { id: "opaque", season: "2", episode: "3", title: "Original title" },
    ],
  };
  assert.deepEqual(offlineEpisode(series, "opaque"), {
    season: 2,
    episode: 3,
    title: "Original title",
  });
  const old = offlineEpisode({ id: "tt123", type: "series" }, "tt123:0:2");
  assert.deepEqual(old, { season: 0, episode: 2 });
  assert.equal(translate(episodeLabel(old), "en"), "Season 0 · Episode 2");
  assert.deepEqual(offlineEpisode(series, "kitsu:123:1:4"), {
    season: 1,
    episode: 4,
  });
  assert.equal(offlineEpisode(series, "unknown"), undefined);
  assert.equal(
    offlineEpisode({ id: "tt123", type: "series" }, "other:1:2"),
    undefined,
  );
  assert.equal(offlineEpisode(meta, "tt1234567:1:2"), undefined);
  assert.equal(
    offlineEpisode(series, "unknown", {
      season: false,
      episode: {},
      title: 12,
    }),
    undefined,
  );
  assert.deepEqual(
    offlineEpisode(series, "unknown", {
      season: 1,
      episode: 2,
      title: "Safe\u0000 title",
      url: "https://secret.invalid",
    }),
    { season: 1, episode: 2, title: "Safe  title" },
  );
});

test("episode names and numbers survive download and restart without retaining the metadata's links", async () => {
  const root = await mkdtemp(join(tmpdir(), "riwaq-episode-"));
  const client = {
    state: {},
    profiles: { store: { active: "p" }, gate() {}, capture() {} },
    saveData() {},
  };
  const options = {
    root,
    resolveSource: async () => ({ url: "http://fixture/video" }),
    request: async () => new Response(Buffer.alloc(32)),
  };
  const lib = new OfflineLibrary(client, options);
  try {
    const m = {
      id: "show",
      type: "series",
      name: "Show",
      videos: [
        {
          id: "opaque",
          season: 2,
          episode: 4,
          title: "Chapter four",
          streams: [{ url: "https://secret.invalid" }],
        },
      ],
    };
    lib.start({
      profileId: "p",
      stream: {},
      meta: m,
      videoId: "opaque",
      settings: {},
    });
    await lib.job.done;
    const reloaded = new OfflineLibrary(client, options).list("p").items[0];
    assert.deepEqual(reloaded.episode, {
      season: 2,
      episode: 4,
      title: "Chapter four",
    });
    assert.equal(reloaded.status, "ready");
    assert.ok(!JSON.stringify(client.state.offline).includes("secret.invalid"));
    assert.ok(
      !JSON.stringify(collectBackup(client.state)).includes("Chapter four"),
    );
  } finally {
    await lib.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("failed profile cleanup retains undeleted records durably and retries without touching another profile", async () => {
  const root = await mkdtemp(join(tmpdir(), "riwaq-cleanup-"));
  let active = "one",
    blocked = "",
    saved;
  const client = {
    state: {},
    profiles: {
      store: {
        get active() {
          return active;
        },
      },
      gate() {},
      capture() {},
    },
    saveData(state) {
      saved = structuredClone(state);
    },
  };
  const lib = new OfflineLibrary(client, {
    root,
    resolveSource: async () => ({ url: "http://fixture/video" }),
    request: async () => new Response(Buffer.alloc(32)),
    deleteFile: async (path) => {
      if (path === blocked)
        throw Object.assign(Error("locked"), { code: "EPERM" });
      await rm(path, { force: true });
    },
  });
  const add = async () => {
    lib.start({
      profileId: active,
      stream: {},
      meta,
      videoId: meta.id,
      settings: {},
    });
    const id = lib.job.id;
    await lib.job.done;
    return id;
  };
  try {
    const good = await add(),
      locked = await add();
    client.state.offline.one.reverse();
    active = "two";
    const other = await add();
    active = "one";
    blocked = lib.path(locked);
    await assert.rejects(lib.forgetProfile("one"), /تعذر حذف بعض التنزيلات/);
    await assert.rejects(stat(lib.path(good)), { code: "ENOENT" });
    assert.equal((await stat(blocked)).size, 32);
    assert.deepEqual(
      client.state.offline.one.map((x) => x.id),
      [locked],
    );
    assert.deepEqual(
      saved.offline.one.map((x) => x.id),
      [locked],
    );
    client.state = saved;
    assert.equal((await lib.file("one", locked)).item.status, "ready");
    blocked = "";
    await lib.forgetProfile("one");
    assert.equal(saved.offline.one, undefined);
    assert.equal((await stat(lib.path(other))).size, 32);
    assert.deepEqual(
      saved.offline.two.map((x) => x.id),
      [other],
    );
  } finally {
    await lib.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("profile cleanup refuses a playing file and serializes new download operations while removing", async () => {
  const root = await mkdtemp(join(tmpdir(), "riwaq-cleanup-busy-")),
    id = "a".repeat(32);
  let release,
    calls = 0;
  const client = {
    state: {
      offline: {
        p: [{ id, meta, videoId: meta.id, status: "ready", bytes: 32 }],
      },
    },
    profiles: { store: { active: "p" }, gate() {}, capture() {} },
    saveData() {},
  };
  const lib = new OfflineLibrary(client, {
    root,
    resolveSource: async () => {},
    deleteFile: async () => {
      if (++calls === 1)
        await new Promise((r) => {
          release = r;
        });
    },
  });
  try {
    lib.playing = id;
    await assert.rejects(lib.forgetProfile("p"), /أوقف مشاهدة/);
    assert.equal(client.state.offline.p.length, 1);
    lib.playing = "";
    const deleting = lib.forgetProfile("p");
    assert.throws(
      () => lib.start({ profileId: "p", meta, videoId: meta.id }),
      /جارٍ حذف تنزيلات/,
    );
    await assert.rejects(lib.file("p", id), /جارٍ حذف تنزيلات/);
    await assert.rejects(lib.forgetProfile("p"), /جارٍ حذف تنزيلات/);
    release();
    await deleting;
    assert.equal(lib.removing.size, 0);
    assert.equal(client.state.offline.p, undefined);
  } finally {
    await lib.stop();
    await rm(root, { recursive: true, force: true });
  }
});
test("Stop and a newer request revoke pre-player work, without releasing a current torrent", () => {
  const p = new PlaybackRequest(),
    a = p.begin("a");
  p.cancel();
  assert.ok(!p.owns(a));
  assert.ok(p.mayRelease("a"));
  const b = p.begin("b");
  assert.ok(!p.owns(a));
  assert.ok(p.owns(b));
  assert.ok(!p.mayRelease("b"));
  assert.ok(!p.mayRelease("a", "a"));
  const c = p.begin("a");
  assert.ok(!p.mayRelease("a"));
  assert.ok(!p.owns(b));
  assert.ok(p.owns(c));
});
test("simple/advanced settings and quiet interface survive validated account backups", () => {
  const s = safeSettings({ settingsMode: "simple", quietInterface: true });
  assert.equal(s.settingsMode, "simple");
  assert.equal(s.quietInterface, true);
  const original = {
    profiles: {
      list: [{ id: "p", name: "Test", createdAt: 1 }],
      active: "p",
      data: { p: { settings: s } },
    },
  };
  const backup = collectBackup(original).payload;
  const restored = restoreState({}, backup);
  assert.equal(restored.profiles.data.p.settings.quietInterface, true);
  assert.equal(restored.profiles.data.p.settings.settingsMode, "simple");
  assert.notEqual(
    safeSettings({ settingsMode: "random" }).settingsMode,
    "random",
  );
});
const temp = () => mkdtemp(join(tmpdir(), "riwaq-offline-review-"));
test("a failed state write cannot leave a busy download or publish an uncommitted file", async () => {
  const root = await temp();
  let saves = 0,
    failAt = 1,
    resolved = 0;
  const client = {
    state: {},
    profiles: { store: { active: "one" }, gate() {}, capture() {} },
    saveData() {
      if (++saves === failAt) throw Error("disk full");
    },
  };
  const lib = new OfflineLibrary(client, {
    root,
    resolveSource: async () => {
      resolved++;
      return { url: "http://fixture/video" };
    },
    request: async () => new Response(Buffer.alloc(20)),
  });
  const args = {
    profileId: "one",
    stream: {},
    meta,
    videoId: meta.id,
    settings: {},
  };
  try {
    assert.throws(() => lib.start(args), /disk full/);
    assert.equal(lib.job, null);
    assert.equal(resolved, 0);
    assert.deepEqual(lib.list("one").items, []);
    saves = 0;
    failAt = 2;
    const item = lib.start(args).items[0];
    await lib.job.done;
    assert.equal(lib.job, null);
    assert.equal(lib.list("one").items[0].status, "error");
    await assert.rejects(stat(lib.path(item.id)), { code: "ENOENT" });
    await assert.rejects(lib.file("one", item.id));
  } finally {
    await lib.stop();
    await rm(root, { recursive: true, force: true });
  }
});
test("offline download writes bytes to disk incrementally and commits only a complete file; backup omits it", async () => {
  const root = await temp();
  let active = "one",
    touches = 0;
  const bytes = Buffer.alloc(65539, 42);
  const client = {
    state: {},
    profiles: {
      store: {
        get active() {
          return active;
        },
      },
      gate() {},
      capture() {},
    },
    saveData() {
      touches++;
    },
  };
  const lib = new OfflineLibrary(client, {
    root,
    resolveSource: async () => ({ url: "http://fixture/video" }),
    request: async () =>
      new Response(bytes, {
        headers: {
          "content-length": bytes.length,
          "content-type": "video/mp4",
        },
      }),
  });
  try {
    const result = lib.start({
      profileId: "one",
      stream: {},
      meta,
      videoId: meta.id,
      settings: {},
    });
    const done = lib.job.done;
    await done;
    const ready = lib.list("one").items[0];
    assert.equal(ready.status, "ready");
    assert.deepEqual(
      await readFile((await lib.file("one", ready.id)).path),
      bytes,
    );
    assert.ok(!JSON.stringify(ready).includes(root));
    // Addons may use a custom catalog/media type. A restart must preserve
    // its completed download just as it preserves a standard movie.
    client.state.offline.one[0].meta.type = "anime";
    const reopened = new OfflineLibrary(client, {
      root,
      resolveSource: async () => {},
    });
    assert.equal(reopened.list("one").items[0].meta.type, "anime");
    assert.equal((await reopened.file("one", ready.id)).item.status, "ready");
    assert.ok(
      !JSON.stringify(
        collectBackup(client.state, { includeSecrets: true }),
      ).includes(ready.id),
    );
    active = "two";
    assert.deepEqual(lib.list("two").items, []);
    await assert.rejects(lib.file("one", ready.id));
    active = "one";
    lib.playing = ready.id;
    await assert.rejects(lib.remove("one", ready.id), /أوقف/);
    lib.playing = "";
    await lib.remove("one", ready.id);
    assert.deepEqual(lib.list("one").items, []);
    assert.ok(touches > 1);
    assert.ok(result.busy);
  } finally {
    await lib.stop();
    await rm(root, { recursive: true, force: true });
  }
});
test("late source preparation cannot resurrect a cancelled download, and partial files never become ready", async () => {
  const root = await temp();
  let resolve;
  const client = {
    state: {},
    profiles: { store: { active: "p" }, gate() {}, capture() {} },
    saveData() {},
  };
  const lib = new OfflineLibrary(client, {
    root,
    resolveSource: () => new Promise((r) => (resolve = r)),
  });
  try {
    const { items } = lib.start({
      profileId: "p",
      stream: {},
      meta,
      videoId: meta.id,
      settings: {},
    });
    while (!resolve) await new Promise((r) => setTimeout(r, 5));
    const cancelling = lib.cancel("p", items[0].id);
    resolve({ url: "http://should-not-fetch/" });
    await cancelling;
    assert.equal(lib.list("p").items[0].status, "cancelled");
    await assert.rejects(stat(lib.path(items[0].id)));
    assert.equal(lib.job, null);
  } finally {
    await lib.stop();
    await rm(root, { recursive: true, force: true });
  }
});
test("HLS, an incomplete response and path injection are rejected", async () => {
  const root = await temp(),
    signal = new AbortController().signal;
  try {
    await assert.rejects(
      downloadFile({
        url: "https://fixture/video.m3u8",
        part: join(root, "hls.part"),
        signal,
        request: async () =>
          new Response("manifest", {
            headers: { "content-type": "application/vnd.apple.mpegurl" },
          }),
      }),
    );
    await assert.rejects(
      downloadFile({
        url: "https://fixture/video",
        part: join(root, "short.part"),
        signal,
        request: async () =>
          new Response("short", {
            headers: { "content-length": "999", "content-type": "video/mp4" },
          }),
      }),
      /لم يكتمل/,
    );
    const lib = new OfflineLibrary(
      { state: {}, profiles: { store: { active: "p" }, gate() {} } },
      { root },
    );
    assert.throws(() => lib.path("../private"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("cross-origin redirects strip private headers and HTTPS cannot downgrade", async () => {
  const root = await temp(),
    calls = [];
  try {
    const request = async (url, args) => {
      calls.push({ url, args });
      return calls.length === 1
        ? new Response(null, {
            status: 302,
            headers: { location: "https://cdn.test/file" },
          })
        : new Response("video", { headers: { "content-type": "video/mp4" } });
    };
    await downloadFile({
      url: "https://origin.test/video",
      headers: { Authorization: "private", Cookie: "private" },
      part: join(root, "file.part"),
      signal: new AbortController().signal,
      request,
    });
    assert.deepEqual(calls[1].args.headers, {});
    assert.equal(calls[0].args.redirect, "manual");
    await assert.rejects(
      downloadFile({
        url: "https://origin.test/video",
        part: join(root, "bad.part"),
        signal: new AbortController().signal,
        request: async () =>
          new Response(null, {
            status: 302,
            headers: { location: "http://origin.test/file" },
          }),
      }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("real HTTP body that stalls is aborted within the idle deadline", async () => {
  const root = await temp();
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "video/mp4" });
    res.write("prefix");
  });
  try {
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    await assert.rejects(
      downloadFile({
        url: `http://127.0.0.1:${server.address().port}/video`,
        part: join(root, "stall.part"),
        signal: new AbortController().signal,
        idleMs: 50,
      }),
    );
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await rm(root, { recursive: true, force: true });
  }
});
test("a real offline torrent swarm downloads all video bytes to a persistent offline file", async () => {
  const { default: WebTorrent } = await import("webtorrent");
  const root = await temp(),
    data = Buffer.alloc(131071, 13);
  const seeder = new WebTorrent({
    dht: false,
    tracker: false,
    utp: false,
    lsd: false,
    natUpnp: false,
    natPmp: false,
  });
  let engine;
  try {
    const seeded = await new Promise((resolve, reject) => {
      seeder.once("error", reject);
      seeder.seed(data, { name: "fixture.mkv", announce: [] }, resolve);
    });
    engine = await startEngine({
      cacheDir: join(root, "pieces"),
      network: { dht: false, tracker: false, utp: false },
      graceMs: 50,
    });
    const url = engine.url({
      infoHash: seeded.infoHash,
      fileIdx: 0,
      sources: [],
    });
    engine.addPeer(seeded.infoHash, `127.0.0.1:${seeder.address().port}`);
    const part = join(root, "complete.part");
    const bytes = await downloadFile({
      url,
      part,
      signal: new AbortController().signal,
      idleMs: 10000,
    });
    assert.equal(bytes, data.length);
    assert.equal(Buffer.compare(await readFile(part), data), 0);
  } finally {
    await engine?.close();
    await new Promise((r) => seeder.destroy(r));
    await rm(root, { recursive: true, force: true });
  }
});
test("a removed profile's downloads are deleted with it, others stay", async () => {
  const root = await temp();
  let active = "one";
  const bytes = Buffer.alloc(4096, 7);
  const client = {
    state: {},
    profiles: {
      store: {
        get active() {
          return active;
        },
      },
      gate() {},
      capture() {},
    },
    saveData() {},
  };
  const lib = new OfflineLibrary(client, {
    root,
    resolveSource: async () => ({ url: "http://fixture/video" }),
    request: async () =>
      new Response(bytes, {
        headers: {
          "content-length": bytes.length,
          "content-type": "video/mp4",
        },
      }),
  });
  const args = (profileId) => ({
    profileId,
    stream: {},
    meta,
    videoId: meta.id,
    settings: {},
  });
  try {
    const mine = lib.start(args("one")).items[0];
    await lib.job.done;
    active = "two";
    const theirs = lib.start(args("two")).items[0];
    await lib.job.done;
    await stat(lib.path(mine.id));
    await lib.forgetProfile("one");
    await assert.rejects(stat(lib.path(mine.id)), { code: "ENOENT" });
    assert.equal(client.state.offline.one, undefined);
    // Another profile's download is untouched.
    assert.equal((await stat(lib.path(theirs.id))).size, bytes.length);
    assert.equal(lib.list("two").items.length, 1);
    // A download still preparing for the removed profile stops first (the
    // real source rejects when its engine stops, as this one does).
    const slow = new OfflineLibrary(client, {
      root,
      resolveSource: (_stream, _settings, signal) =>
        new Promise((_resolve, reject) => {
          if (signal.aborted) return reject(Error("stopped"));
          signal.addEventListener("abort", () => reject(Error("stopped")));
        }),
      request: async () => new Response(bytes),
    });
    slow.start(args("two"));
    assert.ok(slow.job);
    await slow.forgetProfile("two");
    assert.equal(slow.job, null);
    assert.equal(client.state.offline.two, undefined);
  } finally {
    await lib.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("the player menu copies only a magnet, and a cancelled play is not a start", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (path) =>
    readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const main = read("electron/main.mjs");
  const menu = main.slice(
    main.indexOf("function playbackMenu("),
    main.indexOf("// The built-in torrent engine (core/torrent-engine.mjs)"),
  );
  // A direct address can carry credentials (a home server's api_key).
  assert.match(menu, /if \(!stream\?\.infoHash\) throw/);
  assert.match(menu, /clipboard\.writeText\(magnetOf\(stream\)\)/);
  // An action runs only for the viewing whose menu offered it.
  assert.match(menu, /player\.videoId !== videoId/);
  assert.doesNotMatch(menu, /stream\.url/);
  assert.doesNotMatch(menu, /نسخ رابط المصدر/);
  // Stop or another play while this one was prepared started nothing.
  assert.match(
    read("src/components/Details.jsx"),
    /if \(!ok \|\| ok\.cancelled\) return;/,
  );
  assert.match(
    read("src/App.jsx"),
    /if \(\(await call\("play", playArgs\)\)\?\.cancelled\) return;/,
  );
});

test("main checks its playback request after every wait before MPV starts", async () => {
  const { readFileSync } = await import("node:fs");
  const main = readFileSync(
    new URL("../electron/main.mjs", import.meta.url),
    "utf8",
  );
  const play = main.slice(
    main.indexOf("async function play("),
    main.indexOf("async function playChannel("),
  );
  const at = (text) => {
    const i = play.indexOf(text);
    assert.ok(i >= 0, text);
    return i;
  };
  const owns = [...play.matchAll(/playbackRequest\.owns\(request\)/g)].map(
    (m) => m.index,
  );
  // After the service probe, after the engine's address, after Stop.
  for (const wait of [
    "await serviceUp()",
    "await torrents().url(",
    "await torrServers().url(",
    "await player.stop()",
  ])
    assert.ok(
      owns.some((i) => i > at(wait)),
      `ownership checked after ${wait}`,
    );
  assert.ok(owns.at(-1) < at("player.start("), "all before MPV starts");
  // Everything that ends a viewing or changes who watches revokes it.
  for (const name of ["stop:", "profileSwitch:", "profileLock:"]) {
    const body = main.slice(main.indexOf(`  ${name}`));
    assert.match(body.slice(0, 400), /playbackRequest\.cancel\(\)/, name);
  }
  const quit = main.slice(main.indexOf('app.on("before-quit"'));
  assert.match(quit.slice(0, 200), /playbackRequest\.cancel\(\)/);
});

test("the player menu is HTML in the controls, never a native menu", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (path) =>
    readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const main = read("electron/main.mjs");
  // A native menu owned by the non-focusable HUD, or under MPV's on-top
  // window, can open out of sight and hold every click in Riwaq.
  assert.doesNotMatch(main, /Menu\.buildFromTemplate|menu\.popup\(/);
  assert.doesNotMatch(main, /^\s+Menu,$/m);
  // MPV's own right click opens the same HTML menu where the controls are.
  assert.match(main, /event\.type === "context"\) event = \{ type: "menu" \}/);
  assert.match(main, /event\.type === "panel" \|\| event\.type === "menu"/);
  const { HUD_METHODS } = await import("../core/hud.mjs");
  assert.ok(HUD_METHODS.has("playbackMenu"));
  assert.ok(HUD_METHODS.has("playbackAction"));
  assert.match(read("electron/preload.cjs"), /"playbackAction"/);
  for (const file of [
    "src/components/Hud.jsx",
    "src/components/PlayerView.jsx",
  ]) {
    const page = read(file);
    assert.match(page, /<PlayerMenu/, file);
    assert.doesNotMatch(
      page,
      /call\("playbackMenu"\)|act\("playbackMenu"\)/,
      file,
    );
  }
  const menu = read("src/components/PlayerMenu.jsx");
  assert.match(menu, /call\("playbackMenu"\)/);
  assert.match(
    menu,
    /request\("playbackAction", \{ action, videoId: options\.videoId \}\)/,
  );
  // It closes on any press elsewhere, and the theater hides the native
  // picture under it like any HTML dialog.
  assert.match(menu, /addEventListener\("pointerdown", down, true\)/);
  assert.match(
    read("src/components/PlayerView.jsx"),
    /visible: !hidden && !menu/,
  );
});
