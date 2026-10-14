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
const meta = { id: "tt1234567", type: "movie", name: "Fixture" };
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
