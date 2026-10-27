import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { OfflineLibrary } from "../electron/offline.mjs";
import { downloadCapability } from "../core/offline-media.mjs";

const id = "a".repeat(32),
  otherId = "b".repeat(32);
const meta = { id: "film", type: "movie", name: "Fixture" };

test("profile removal drains an in-flight artwork commit before erasing its files", async () => {
  const f = await fixture();
  const rename = fs.rename;
  let entered, release;
  const reached = new Promise((r) => (entered = r));
  const held = new Promise((r) => (release = r));
  const deleted = [];
  const jpeg = Buffer.from([255, 216, 255, 217]);
  f.client.state.offline.p[0].meta = {
    ...meta,
    poster: "https://art.invalid/poster.jpg",
  };
  fs.rename = async (...args) => {
    entered();
    await held;
    return rename(...args);
  };
  syncBuiltinESMExports();
  const lib = new OfflineLibrary(f.client, {
    root: f.root,
    thumbnail: () => jpeg,
    request: async () =>
      new Response(jpeg, { headers: { "content-type": "image/jpeg" } }),
    deleteFile: async (path) => {
      deleted.push(path);
      await rm(path, { force: true });
    },
  });
  let art, removal;
  try {
    art = lib.artwork("p", id).catch(() => {});
    await reached;
    removal = lib.forgetProfile("p");
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(
      deleted,
      [],
      "No deletion may race a pending poster commit",
    );
    release();
    await removal;
    await art;
    assert.deepEqual(await fs.readdir(f.root), []);
    assert.equal(f.client.state.offline.p, undefined);
  } finally {
    release();
    await Promise.allSettled([art, removal]);
    fs.rename = rename;
    syncBuiltinESMExports();
    await f.cleanup();
  }
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "riwaq-download-quality-"));
  const client = {
    state: {
      offline: {
        p: [{ id, meta, videoId: "film", status: "ready", bytes: 4 }],
      },
    },
    profiles: { store: { active: "p" }, gate() {}, capture() {} },
    saveData() {},
  };
  const library = new OfflineLibrary(client, { root });
  await writeFile(library.path(id), "test");
  return {
    root,
    client,
    library,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test("delete rechecks a file that begins playing during cancellation's async window", async () => {
  const f = await fixture();
  try {
    const removal = f.library.remove("p", id);
    f.library.playing = id;
    await assert.rejects(removal, /أوقف مشاهدة/);
    assert.equal((await stat(f.library.path(id))).size, 4);
    assert.equal(f.library.list("p").items.length, 1);
  } finally {
    await f.cleanup();
  }
});

test("a completed file lookup revalidates the profile after filesystem IO", async () => {
  const f = await fixture();
  try {
    const lookup = f.library.file("p", id);
    f.client.profiles.store.active = "other";
    await assert.rejects(lookup, /تغير الملف الشخصي/);
  } finally {
    await f.cleanup();
  }
});

async function mainPlayback() {
  const source = await readFile(
    new URL("../electron/main.mjs", import.meta.url),
    "utf8",
  );
  const body = source.slice(
    source.indexOf("function playbackMenu("),
    source.indexOf("// The built-in torrent engine (core/torrent-engine.mjs)"),
  );
  const calls = [];
  const player = {
    state: { active: true },
    videoId: "film",
    startToken: 2,
    command: (a) => calls.push(a),
  };
  const context = {
    downloadCapability,
    player,
    window: { isDestroyed: () => false },
    nowPlaying: { key: "k", id: "film" },
    client: {
      streams: new Map([["k", { infoHash: "c".repeat(40) }]]),
      profiles: { store: { active: "p" }, gate() {} },
    },
    clipboard: { writeText: (a) => calls.push(a) },
    magnetOf: () => "magnet:?xt=urn:btih:fixture",
    emit() {},
    startOffline: () => calls.push("download"),
  };
  vm.createContext(context);
  vm.runInContext(body, context);
  return { context, calls, player };
}

test("an old menu cannot screenshot a restarted viewing of the same video", async () => {
  const { context, calls, player } = await mainPlayback();
  const menu = context.playbackMenu();
  player.startToken++;
  await assert.rejects(
    context.playbackAction({
      action: "screenshot",
      videoId: menu.videoId,
      sessionId: menu.sessionId,
      profileId: menu.profileId,
    }),
    /انتهت هذه المشاهدة/,
  );
  assert.deepEqual(calls, []);
});

test("artwork is bounded, stored privately, and survives restart without network", async () => {
  const f = await fixture();
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  let requests = 0;
  f.client.state.offline.p[0].meta.poster = "https://art.invalid/poster.jpg";
  const options = {
    root: f.root,
    thumbnail: () => jpeg,
    request: async () => {
      requests++;
      return new Response(jpeg, { headers: { "content-type": "image/jpeg" } });
    },
  };
  const first = new OfflineLibrary(f.client, options);
  try {
    assert.equal(
      (await first.artwork("p", id)).image,
      "data:image/jpeg;base64," + jpeg.toString("base64"),
    );
    assert.equal(requests, 1);
    const restarted = new OfflineLibrary(f.client, {
      ...options,
      request: () => {
        throw Error("offline");
      },
    });
    assert.equal(
      (await restarted.artwork("p", id)).image,
      "data:image/jpeg;base64," + jpeg.toString("base64"),
    );
    assert.ok(!JSON.stringify(first.list("p")).includes(f.root));
    assert.ok(!JSON.stringify(first.list("p")).includes("art.invalid"));
    await restarted.remove("p", id);
    assert.deepEqual(
      await import("node:fs/promises").then((fs) => fs.readdir(f.root)),
      [],
    );
  } finally {
    await f.cleanup();
  }
});

test("file reservation protects pending playback, and is released after success or failure", async () => {
  const f = await fixture();
  try {
    let release, entered;
    const inside = new Promise((r) => (entered = r));
    const hold = new Promise((r) => (release = r));
    const use = f.library.useFile("p", id, async ({ path }) => {
      assert.equal(path, f.library.path(id));
      entered();
      await hold;
    });
    await inside;
    await assert.rejects(f.library.remove("p", id), /أوقف مشاهدة/);
    await assert.rejects(f.library.forgetProfile("p"), /أوقف مشاهدة/);
    release();
    await use;
    await assert.rejects(
      f.library.useFile("p", id, () => {
        throw Error("failed reveal");
      }),
      /failed reveal/,
    );
    await f.library.remove("p", id);
    assert.equal(f.library.list("p").items.length, 0);
  } finally {
    await f.cleanup();
  }
});

test("PIN locking during file IO rejects use, and deletion touches only the selected ID", async () => {
  const f = await fixture();
  try {
    let locked = false;
    f.client.profiles.gate = () => {
      if (locked) throw Error("locked");
    };
    const lookup = f.library.file("p", id);
    locked = true;
    await assert.rejects(lookup, /locked/);
    locked = false;
    f.client.state.offline.p.push({
      id: otherId,
      meta,
      videoId: "other",
      status: "ready",
      bytes: 5,
    });
    await writeFile(f.library.path(otherId), "other");
    await f.library.remove("p", id);
    assert.equal(await readFile(f.library.path(otherId), "utf8"), "other");
    assert.deepEqual(
      f.library.list("p").items.map((x) => x.id),
      [otherId],
    );
  } finally {
    await f.cleanup();
  }
});

test("reveal resolves an owned completed opaque ID in main without starting playback", async () => {
  const f = await fixture();
  const source = await readFile(
    new URL("../electron/main.mjs", import.meta.url),
    "utf8",
  );
  const handler = source.slice(
    source.indexOf("  offlineReveal:"),
    source.indexOf("  offlinePlay:"),
  );
  const reveals = [];
  const api = vm.runInNewContext(`({${handler}})`, {
    offline: f.library,
    shell: { showItemInFolder: (p) => reveals.push(p) },
  });
  try {
    await api.offlineReveal({ profileId: "p", id });
    assert.deepEqual(reveals, [f.library.path(id)]);
    await assert.rejects(
      api.offlineReveal({ profileId: "other", id }),
      /تغير الملف الشخصي/,
    );
    await assert.rejects(
      api.offlineReveal({ profileId: "p", id: "../../private" }),
    );
    f.client.state.offline.p[0].status = "paused";
    await assert.rejects(api.offlineReveal({ profileId: "p", id }), /غير جاهز/);
    assert.equal(reveals.length, 1);
  } finally {
    await f.cleanup();
  }
});

test("menu actions copy only a magnet and reject previous profile or incomplete identities", async () => {
  const { context, calls } = await mainPlayback();
  const menu = context.playbackMenu();
  await context.playbackAction({ ...menu, action: "copyMagnet" });
  assert.deepEqual(calls, ["magnet:?xt=urn:btih:fixture"]);
  context.client.profiles.store.active = "other";
  for (const action of ["copyMagnet", "download", "screenshot"])
    await assert.rejects(
      context.playbackAction({ ...menu, action }),
      /انتهت هذه المشاهدة/,
    );
  context.client.profiles.store.active = "p";
  await assert.rejects(
    context.playbackAction({ action: "screenshot", videoId: "film" }),
    /انتهت هذه المشاهدة/,
  );
  assert.equal(calls.length, 1);
});

test("download capability explains known live/local/manifest/credential-form refusals", () => {
  assert.equal(
    downloadCapability({ url: "https://fixture/video.mp4?private=secret" })
      .supported,
    true,
  );
  assert.equal(
    downloadCapability({ infoHash: "c".repeat(40) }).supported,
    true,
  );
  for (const stream of [
    null,
    { url: "https://fixture/video.m3u8?token=secret" },
    { url: "https://fixture/video.mpd" },
    { url: "https://u:p@fixture/file.mp4" },
    { url: "file:///private" },
  ]) {
    const result = downloadCapability(stream);
    assert.equal(result.supported, false);
    assert.ok(result.reason);
    assert.ok(!result.reason.includes("secret"));
  }
  assert.equal(
    downloadCapability({ url: "https://fixture/file.mp4" }, { live: true })
      .supported,
    false,
  );
  assert.equal(
    downloadCapability({ url: "https://fixture/file.mp4" }, { local: true })
      .supported,
    false,
  );
});

test("artwork fetches once per ID, bounds input/output and refuses unsafe redirects", async () => {
  const jpeg = Buffer.from([255, 216, 255, 217]);
  const cases = [
    () =>
      new Response(Buffer.alloc(2 * 1024 ** 2 + 1), {
        headers: { "content-type": "image/jpeg" },
      }),
    () => new Response(jpeg, { headers: { "content-type": "text/html" } }),
    () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://unsafe.invalid/poster.jpg" },
      }),
    () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://user:secret@unsafe.invalid/poster.jpg" },
      }),
  ];
  for (const response of cases) {
    const f = await fixture();
    let requests = 0;
    f.client.state.offline.p[0].meta.poster = "https://art.invalid/poster.jpg";
    const lib = new OfflineLibrary(f.client, {
      root: f.root,
      thumbnail: () => jpeg,
      request: async () => {
        requests++;
        return response();
      },
    });
    try {
      assert.equal((await lib.artwork("p", id)).image, null);
      assert.equal((await lib.artwork("p", id)).image, null);
      assert.equal(requests, 1);
    } finally {
      await f.cleanup();
    }
  }
  const f = await fixture();
  f.client.state.offline.p[0].meta.poster = "https://art.invalid/poster.jpg";
  const lib = new OfflineLibrary(f.client, {
    root: f.root,
    thumbnail: () => Buffer.alloc(128 * 1024 + 1),
    request: async () =>
      new Response(jpeg, { headers: { "content-type": "image/jpeg" } }),
  });
  try {
    assert.equal((await lib.artwork("p", id)).image, null);
  } finally {
    await f.cleanup();
  }
});

test("artwork has one active request and never returns a cache after profile changes", async () => {
  const f = await fixture();
  const jpeg = Buffer.from([255, 216, 255, 217]);
  let entered,
    release,
    concurrent = 0,
    peak = 0;
  const reached = new Promise((r) => (entered = r)),
    wait = new Promise((r) => (release = r));
  f.client.state.offline.p[0].meta.poster = "https://art.invalid/poster.jpg";
  f.client.state.offline.p.push({
    id: otherId,
    meta: { ...meta, poster: "https://art.invalid/other.jpg" },
    status: "ready",
    bytes: 5,
  });
  const lib = new OfflineLibrary(f.client, {
    root: f.root,
    thumbnail: () => jpeg,
    request: async () => {
      concurrent++;
      peak = Math.max(peak, concurrent);
      entered();
      await wait;
      concurrent--;
      return new Response(jpeg, { headers: { "content-type": "image/jpeg" } });
    },
  });
  const first = lib.artwork("p", id),
    second = lib.artwork("p", otherId);
  try {
    await reached;
    f.client.profiles.store.active = "other";
    release();
    const results = await Promise.allSettled([first, second]);
    assert.equal(results.filter((r) => r.status === "rejected").length, 2);
    assert.equal(peak, 1);
    const files = await import("node:fs/promises").then((fs) =>
      fs.readdir(f.root),
    );
    assert.deepEqual(files, [id + ".media"]);
  } finally {
    release();
    await Promise.allSettled([first, second]);
    await f.cleanup();
  }
});

test("concurrent selected-download deletions cannot resurrect another removed record", async () => {
  const f = await fixture();
  try {
    f.client.state.offline.p.push({
      id: otherId,
      meta,
      videoId: "other",
      status: "ready",
      bytes: 5,
    });
    await writeFile(f.library.path(otherId), "other");
    await Promise.all([
      f.library.remove("p", id),
      f.library.remove("p", otherId),
    ]);
    assert.deepEqual(f.library.list("p").items, []);
  } finally {
    await f.cleanup();
  }
});

test("a media deletion failure retains ownership and never exposes a private path", async () => {
  const f = await fixture();
  const lib = new OfflineLibrary(f.client, {
    root: f.root,
    deleteFile: async () => {
      throw Error("EPERM " + f.root);
    },
  });
  try {
    await assert.rejects(
      lib.remove("p", id),
      (e) => !e.message.includes(f.root),
    );
    assert.equal(lib.list("p").items.length, 1);
    assert.equal((await stat(lib.path(id))).size, 4);
  } finally {
    await f.cleanup();
  }
});
