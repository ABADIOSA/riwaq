import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { TorrentHost } from "../electron/torrent.mjs";
import WebTorrent from "webtorrent";
import {
  ENGINE_CACHES,
  NEEDS_ENGINE,
  SERVICE_DOWNLOAD,
  TORRENT_ENGINES,
  cacheBytes,
  cachePrune,
  chooseEngine,
  engineOptions,
  magnetOf,
  parseRange,
  pickFile,
  publicStats,
  startLine,
  startStatus,
  TORRENT_DEAD_MS,
  torrentDead,
  trackersOf,
} from "../core/torrent-engine.mjs";
import { startEngine } from "../electron/torrent-engine.mjs";

// No DHT, trackers, uTP or router ports: the swarm is two clients on this
// machine.
const OFFLINE = { dht: false, tracker: false, utp: false, natUpnp: false };

test("closing the engine disconnects a reader waiting for unavailable pieces", async () => {
  const started = Promise.withResolvers();
  const reader = new PassThrough();
  class WaitingClient extends EventEmitter {
    add() {
      const torrent = new EventEmitter();
      torrent.files = [
        {
          name: "waiting.mkv",
          length: 1024,
          createReadStream: () => {
            started.resolve();
            return reader;
          },
        },
      ];
      torrent.destroy = (_options, done) => done();
      queueMicrotask(() => torrent.emit("ready"));
      return torrent;
    }
    destroy(done) {
      done();
    }
  }
  const engine = await startEngine({
    cacheDir: mkdtempSync(join(tmpdir(), "riwaq-closing-")),
    WebTorrent: WaitingClient,
    network: OFFLINE,
  });
  const req = request(engine.url({ infoHash: "a".repeat(40) }));
  req.on("error", () => {});
  req.end();
  await started.promise;
  const closing = engine.close();
  let timer;
  try {
    const finished = await Promise.race([
      closing.then(() => true),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), 500);
      }),
    ]);
    assert.equal(
      finished,
      true,
      "shutdown does not await pieces or a closed socket",
    );
  } finally {
    clearTimeout(timer);
    req.destroy();
    reader.destroy();
    await closing;
  }
});

test("a late engine-start reply after Stop cannot restore the retired origin", async () => {
  let startId;
  const child = new EventEmitter();
  child.kill = () => {};
  child.postMessage = ({ id, method }) => {
    if (method === "start") startId = id;
    if (method === "close")
      queueMicrotask(() => child.emit("message", { id, result: true }));
  };
  const host = new TorrentHost({ fork: () => child, cacheDir: "/unused" });
  const start = host.start({});
  const rejected = assert.rejects(start);
  await host.stop();
  child.emit("message", {
    id: startId,
    result: { origin: "http://127.0.0.1:9" },
  });
  await rejected;
  assert.equal(host.origin, "");
  assert.equal(host.running, false);
  assert.equal(host.calls.size, 0);
});

test("a failed engine message does not leave a pending call or timer", async () => {
  const host = new TorrentHost({ fork: () => {}, cacheDir: "/unused" });
  host.child = {
    postMessage: () => {
      throw new Error("closed port");
    },
  };
  await assert.rejects(host.call("stats"), /closed port/);
  assert.equal(host.calls.size, 0);
});

test("an unresponsive engine has a bounded Stop and settles old calls", async (t) => {
  const child = new EventEmitter();
  child.kill = () => {
    child.killed = true;
  };
  child.postMessage = ({ id, method }) => {
    if (method === "start")
      queueMicrotask(() =>
        child.emit("message", {
          id,
          result: { origin: "http://127.0.0.1:9" },
        }),
      );
  };
  const host = new TorrentHost({ fork: () => child, cacheDir: "/unused" });
  await host.start({});
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const rejected = assert.rejects(host.call("stats"));
  let finished = false;
  const stopping = host.stop().then(() => {
    finished = true;
  });
  try {
    t.mock.timers.tick(1500);
    for (let i = 0; i < 12; i++) await Promise.resolve();
    assert.equal(finished, true, "Stop is bounded at 1.5 seconds");
  } finally {
    t.mock.timers.tick(20000);
    await stopping;
    await rejected;
  }
  assert.equal(child.killed, true);
  assert.equal(host.calls.size, 0);
  assert.equal(host.running, false);
});

test("which engine plays a torrent", () => {
  assert.deepEqual(TORRENT_ENGINES, ["ask", "auto", "builtin"]);
  assert.equal(chooseEngine("ask", true), "service");
  assert.equal(chooseEngine("ask", false), "ask");
  assert.equal(chooseEngine("auto", true), "service");
  assert.equal(chooseEngine("auto", false), "builtin");
  assert.equal(chooseEngine("builtin", true), "builtin");
  assert.equal(chooseEngine("anything", false), "ask");
});

test("engine options follow the settings", () => {
  assert.deepEqual(engineOptions({}), {
    maxConns: 55,
    downloadLimit: -1,
    uploadLimit: -1,
    cacheBytes: 0,
    incoming: true,
  });
  assert.equal(engineOptions({ torrentIncoming: false }).incoming, false);
  const gentle = engineOptions({
    torrentProfile: "gentle",
    torrentUpload: "minimal",
    torrentCache: "5",
  });
  assert.equal(gentle.maxConns, 35);
  assert.ok(gentle.downloadLimit > 0);
  assert.ok(
    Number.isInteger(gentle.downloadLimit),
    "WebTorrent refuses fractions",
  );
  assert.equal(gentle.uploadLimit, 32 * 1024);
  assert.equal(gentle.cacheBytes, 5 * 1024 ** 3);
  assert.equal(cacheBytes("viewing"), 0);
  assert.equal(cacheBytes("999"), 0);
  assert.deepEqual(ENGINE_CACHES, ["viewing", "2", "5", "10"]);
});

test("trackers, magnets, files and ranges", () => {
  const stream = {
    infoHash: "A".repeat(40),
    sources: [
      "tracker:udp://tracker.example:1337/announce",
      "dht:" + "a".repeat(40),
      "tracker:javascript:alert(1)",
      "tracker:udp://tracker.example:1337/announce",
      42,
    ],
  };
  assert.deepEqual(trackersOf(stream), ["udp://tracker.example:1337/announce"]);
  assert.equal(
    magnetOf(stream),
    `magnet:?xt=urn:btih:${"a".repeat(40)}&tr=${encodeURIComponent("udp://tracker.example:1337/announce")}`,
  );
  assert.throws(() => magnetOf({ infoHash: "zz" }), /غير صالح/);
  const files = [
    { name: "sample.txt", length: 10 },
    { name: "Movie.mkv", length: 900 },
    { name: "Extras.mp4", length: 100 },
    { name: "huge.iso", length: 5000 },
  ];
  assert.equal(pickFile(files, 2), 2);
  assert.equal(
    pickFile(files, 9),
    1,
    "a bad index falls back to the largest video",
  );
  assert.equal(pickFile(files), 1);
  assert.equal(
    pickFile([
      { name: "a.iso", length: 5 },
      { name: "b.bin", length: 9 },
    ]),
    1,
  );
  assert.equal(pickFile([]), -1);
  assert.equal(parseRange(undefined, 100), null);
  assert.deepEqual(parseRange("bytes=0-9", 100), { start: 0, end: 9 });
  assert.deepEqual(parseRange("bytes=90-", 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange("bytes=50-500", 100), { start: 50, end: 99 });
  assert.equal(parseRange("bytes=100-", 100), "invalid");
  assert.equal(parseRange("bytes=9-3", 100), "invalid");
  assert.equal(parseRange("bytes=0-1,5-6", 100), "invalid");
  assert.equal(parseRange("items=0-1", 100), "invalid");
});

test("the cache keeps the newest titles within its size, never one in use", () => {
  const entries = [
    { name: "old", bytes: 4, used: 1 },
    { name: "mid", bytes: 4, used: 2 },
    { name: "new", bytes: 4, used: 3 },
    { name: "playing", bytes: 4, used: 0 },
  ];
  assert.deepEqual(cachePrune(entries, 8, ["playing"]), ["old", "mid"]);
  assert.deepEqual(cachePrune(entries, 0, ["playing"]), ["old", "mid", "new"]);
  assert.deepEqual(cachePrune(entries, 100, []), []);
  assert.deepEqual(
    cachePrune([{ name: "empty", bytes: 0, used: 9 }, ...entries], 100, []),
    ["empty"],
    "an empty folder goes even when the cache has room",
  );
});

test("the interface sees counts and speeds, never addresses", () => {
  assert.deepEqual(publicStats(null), { running: false });
  assert.deepEqual(
    publicStats({
      running: true,
      torrents: 1,
      peers: 3,
      down: 1000,
      up: -5,
      cache: "x",
      origin: "http://127.0.0.1:1234",
      token: "secret",
    }),
    { running: true, torrents: 1, peers: 3, down: 1000, up: 0, cache: 0 },
  );
  assert.match(NEEDS_ENGINE, /Stremio Service/);
  assert.equal(new URL(SERVICE_DOWNLOAD).host, "github.com");
  assert.match(
    new URL(SERVICE_DOWNLOAD).pathname,
    /^\/Stremio\/stremio-service\//,
  );
});

test("a torrent that sends nothing gives way, and its start reads plainly", () => {
  assert.equal(startStatus(null), null);
  assert.deepEqual(
    startStatus({
      metadata: 1,
      peers: 2.4,
      down: -3,
      bytes: "x",
      origin: "http://127.0.0.1:1",
    }),
    { metadata: true, peers: 2, down: 0, bytes: 0 },
  );
  // Nothing at all after 40 seconds: the next source plays.
  const empty = { metadata: false, peers: 0, down: 0, bytes: 0 };
  assert.equal(torrentDead(empty, TORRENT_DEAD_MS - 1), false);
  assert.equal(torrentDead(empty, TORRENT_DEAD_MS), true);
  // Peers with the details but none with the file count the same.
  assert.equal(
    torrentDead({ metadata: true, peers: 6, bytes: 0 }, TORRENT_DEAD_MS),
    true,
  );
  // Any data at all is a slow torrent, not a dead one.
  assert.equal(torrentDead({ metadata: true, bytes: 1 }, 10 * 60000), false);
  assert.equal(torrentDead(null, 10 * 60000), false);

  assert.equal(startLine(null), "");
  assert.equal(startLine(empty), "نبحث عن مشاركين في التورنت…");
  assert.equal(
    startLine({ metadata: false, peers: 3 }),
    "نجلب معلومات التورنت · 3 مشاركين",
  );
  assert.equal(
    startLine({ metadata: true, peers: 2, down: 0 }),
    "مشاركان · ننتظر أول البيانات…",
  );
  assert.equal(
    startLine({ metadata: true, peers: 12, down: 1.5 * 1024 * 1024 }),
    "12 مشاركاً · 1.5 م.ب/ث",
  );
});

// A real swarm of two on this machine: a seeder, and the engine.
async function seedFile(bytes, name = "Clip.mkv") {
  const dir = mkdtempSync(join(tmpdir(), "riwaq-seed-"));
  const path = join(dir, name);
  writeFileSync(path, bytes);
  const seeder = new WebTorrent({
    ...OFFLINE,
    lsd: false,
    natUpnp: false,
    natPmp: false,
  });
  const torrent = await new Promise((resolve) =>
    seeder.seed(path, { announce: [] }, resolve),
  );
  return { seeder, torrent, address: `127.0.0.1:${seeder.address().port}` };
}

function get(url, headers = {}, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = request(url, { method, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () =>
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
        }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

test("the engine streams a torrent to MPV with byte ranges", async () => {
  const bytes = randomBytes(3 * 1024 * 1024 + 123);
  const { seeder, torrent, address } = await seedFile(bytes);
  const cacheDir = mkdtempSync(join(tmpdir(), "riwaq-cache-"));
  const engine = await startEngine({ cacheDir, network: OFFLINE, WebTorrent });
  try {
    assert.match(engine.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    const url = engine.url({ infoHash: torrent.infoHash.toUpperCase() });
    assert.match(
      url,
      new RegExp(`^${engine.origin}/[a-f0-9]{32}/${torrent.infoHash}/-1$`),
    );
    // Before any peer: no details and no data yet (issue #82's start line).
    const before = engine.status(torrent.infoHash);
    assert.equal(before.metadata, false);
    assert.equal(before.bytes, 0);
    assert.equal(engine.status("f".repeat(40)), null);
    engine.addPeer(torrent.infoHash, address);

    const head = await get(url, {}, "HEAD");
    assert.equal(head.status, 200);
    assert.equal(head.headers["accept-ranges"], "bytes");
    assert.equal(Number(head.headers["content-length"]), bytes.length);
    assert.equal(head.headers["content-type"], "video/x-matroska");

    const part = await get(url, { Range: "bytes=1048576-2097151" });
    assert.equal(part.status, 206);
    assert.equal(
      part.headers["content-range"],
      `bytes 1048576-2097151/${bytes.length}`,
    );
    assert.ok(part.body.equals(bytes.subarray(1048576, 2097152)));

    const tail = await get(url, { Range: "bytes=-1000" });
    assert.ok(tail.body.equals(bytes.subarray(bytes.length - 1000)));

    const whole = await get(url);
    assert.equal(whole.status, 200);
    assert.ok(whole.body.equals(bytes));

    const bad = await get(url, { Range: `bytes=${bytes.length}-` });
    assert.equal(bad.status, 416);

    const after = startStatus(engine.status(torrent.infoHash.toUpperCase()));
    assert.equal(after.metadata, true);
    assert.ok(after.bytes >= bytes.length, "the bytes read were counted");
    assert.equal(torrentDead(after, TORRENT_DEAD_MS * 2), false);

    const stats = await engine.stats();
    assert.equal(stats.running, true);
    assert.equal(stats.torrents, 1);
    assert.ok(stats.cache > 0, "pieces were written to the cache");
  } finally {
    await engine.close();
    await new Promise((resolve) => seeder.destroy(resolve));
  }
  assert.deepEqual(readdirSync(cacheDir), [], "a closed engine leaves nothing");
});

test("only this engine's own address, token and methods are served", async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "riwaq-cache-"));
  const engine = await startEngine({
    cacheDir,
    network: OFFLINE,
    WebTorrent,
    readyMs: 300,
  });
  try {
    const url = engine.url({ infoHash: "b".repeat(40), fileIdx: 0 });
    const { port } = new URL(engine.origin);
    // A page that points its own name at 127.0.0.1 (DNS rebinding).
    assert.equal(
      (await get(url, { Host: `evil.example:${port}` })).status,
      403,
    );
    assert.equal((await get(url, { Host: `localhost:${port}` })).status, 403);
    assert.equal((await get(url, {}, "POST")).status, 405);
    const wrongToken = url.replace(/\/[a-f0-9]{32}\//, `/${"0".repeat(32)}/`);
    assert.equal((await get(wrongToken)).status, 404);
    const unknown = url.replace("b".repeat(40), "c".repeat(40));
    assert.equal((await get(unknown)).status, 404);
    // Metadata that never comes ends with a timeout, not a hang.
    assert.equal((await get(url)).status, 504);
    assert.throws(() => engine.url({ infoHash: "nope" }), /غير صالح/);
  } finally {
    await engine.close();
  }
  assert.throws(() => engine.url({ infoHash: "b".repeat(40) }), /متوقف/);
});

test("a released title is destroyed after its grace period, with its pieces", async () => {
  const bytes = randomBytes(600 * 1024);
  const { seeder, torrent, address } = await seedFile(bytes, "Short.mp4");
  const cacheDir = mkdtempSync(join(tmpdir(), "riwaq-cache-"));
  const engine = await startEngine({
    cacheDir,
    network: OFFLINE,
    WebTorrent,
    graceMs: 50,
  });
  try {
    const url = engine.url({ infoHash: torrent.infoHash });
    engine.addPeer(torrent.infoHash, address);
    const whole = await get(url);
    assert.ok(whole.body.equals(bytes));
    assert.ok(existsSync(join(cacheDir, torrent.infoHash)));
    assert.equal(engine.release(torrent.infoHash), true);
    assert.equal(engine.release(torrent.infoHash), false, "released once");
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.equal((await engine.stats()).torrents, 0);
    assert.equal(existsSync(join(cacheDir, torrent.infoHash)), false);
    assert.equal((await get(url)).status, 404);
  } finally {
    await engine.close();
    await new Promise((resolve) => seeder.destroy(resolve));
  }
});

test("with a cache size, watched titles stay until it is full", async () => {
  const bytes = randomBytes(300 * 1024);
  const { seeder, torrent, address } = await seedFile(bytes, "Kept.mkv");
  const cacheDir = mkdtempSync(join(tmpdir(), "riwaq-cache-"));
  const engine = await startEngine({
    cacheDir,
    options: { cacheBytes: 2 * 1024 ** 3 },
    network: OFFLINE,
    WebTorrent,
    graceMs: 20,
  });
  try {
    const url = engine.url({ infoHash: torrent.infoHash });
    engine.addPeer(torrent.infoHash, address);
    assert.ok((await get(url)).body.equals(bytes));
    engine.release(torrent.infoHash);
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.ok(existsSync(join(cacheDir, torrent.infoHash)), "kept within 2 GB");
    await engine.clear();
    assert.equal(
      existsSync(join(cacheDir, torrent.infoHash)),
      false,
      "cleared on request",
    );
  } finally {
    await engine.close();
    await new Promise((resolve) => seeder.destroy(resolve));
  }
});

test("main's handle runs the engine in its own process and plays through it", async () => {
  const { EventEmitter } = await import("node:events");
  const { default: Server } = await import("bittorrent-tracker/server");
  const { TorrentHost } = await import("../electron/torrent.mjs");
  // A tracker on this machine: the engine finds the seeder through the
  // trackers the addon listed, as it would on the internet.
  const tracker = new Server({
    udp: false,
    ws: false,
    http: true,
    stats: false,
  });
  await new Promise((resolve) => tracker.listen(0, "127.0.0.1", resolve));
  const announce = `http://127.0.0.1:${tracker.http.address().port}/announce`;
  const dir = mkdtempSync(join(tmpdir(), "riwaq-seed-"));
  const bytes = randomBytes(700 * 1024);
  writeFileSync(join(dir, "Episode.mkv"), bytes);
  const seeder = new WebTorrent({
    dht: false,
    utp: false,
    lsd: false,
    natUpnp: false,
    natPmp: false,
  });
  const torrent = await new Promise((resolve) =>
    seeder.seed(join(dir, "Episode.mkv"), { announce: [announce] }, resolve),
  );
  // Electron's utility process, played by two event emitters: the host
  // module runs here and talks over the same messages.
  const parent = new EventEmitter();
  const child = new EventEmitter();
  parent.postMessage = (m) =>
    setImmediate(() => child.emit("message", structuredClone(m)));
  child.postMessage = (m) =>
    setImmediate(() => parent.emit("message", { data: structuredClone(m) }));
  child.kill = () => {};
  const previous = process.parentPort;
  process.parentPort = parent;
  await import("../electron/torrent-host.mjs");
  let forks = 0;
  const cacheDir = mkdtempSync(join(tmpdir(), "riwaq-cache-"));
  const host = new TorrentHost({
    fork: () => {
      forks++;
      return child;
    },
    cacheDir,
    network: { dht: false, utp: false, natUpnp: false, publicTrackers: false },
  });
  try {
    assert.equal((await host.stats()).running, false);
    assert.equal(
      await host.release(torrent.infoHash),
      false,
      "nothing to release yet",
    );
    const stream = {
      infoHash: torrent.infoHash,
      fileIdx: 0,
      sources: [`tracker:${announce}`],
    };
    const url = await host.url(stream, { torrentProfile: "gentle" });
    assert.equal(forks, 1);
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{32}\//);
    assert.equal(new URL(url).origin, host.origin);
    const part = await get(url, { Range: "bytes=100000-299999" });
    assert.equal(part.status, 206);
    assert.ok(part.body.equals(bytes.subarray(100000, 300000)));
    await host.url(stream, {});
    assert.equal(forks, 1, "one process for every torrent");
    const stats = await host.stats();
    assert.equal(stats.running, true);
    assert.equal(stats.torrents, 1);
    assert.equal(
      Object.keys(stats).sort().join(),
      "cache,down,peers,running,torrents,up",
    );
    // The start line's counts cross the process boundary, nothing else.
    const status = await host.status(torrent.infoHash);
    assert.equal(
      Object.keys(status).sort().join(),
      "bytes,down,metadata,peers",
    );
    assert.equal(status.metadata, true);
    assert.ok(status.bytes > 0);
    assert.equal(await host.status("x"), null);
    assert.equal(await host.configure({ torrentUpload: "low" }), true);
    assert.equal(await host.release(torrent.infoHash), true);
    await assert.rejects(host.url({ infoHash: "x" }, {}), /غير صالح/);
  } finally {
    await host.stop();
    assert.equal(host.running, false);
    process.parentPort = previous;
    await new Promise((resolve) => seeder.destroy(resolve));
    await new Promise((resolve) => tracker.close(resolve));
  }
});

test("a crashed engine process is started again on the next play", async () => {
  const { EventEmitter } = await import("node:events");
  const { TorrentHost } = await import("../electron/torrent.mjs");
  const children = [];
  const host = new TorrentHost({
    fork: () => {
      const child = new EventEmitter();
      child.postMessage = ({ id, method }) =>
        setImmediate(() =>
          child.emit("message", {
            id,
            result:
              method === "start"
                ? { origin: "http://127.0.0.1:9" }
                : `http://127.0.0.1:9/t/${children.length}`,
          }),
        );
      child.kill = () => {};
      children.push(child);
      return child;
    },
    cacheDir: "/unused",
  });
  const stream = { infoHash: "d".repeat(40) };
  assert.equal(await host.url(stream, {}), "http://127.0.0.1:9/t/1");
  children[0].emit("exit");
  assert.equal(host.running, false);
  assert.equal(await host.url(stream, {}), "http://127.0.0.1:9/t/2");
  assert.equal(children.length, 2);
  // A process that cannot start says so in a sentence, and can be retried.
  const broken = new TorrentHost({
    fork: () => {
      throw new Error("spawn failed");
    },
    cacheDir: "/unused",
  });
  await assert.rejects(
    broken.url(stream, {}),
    /تعذّر تشغيل محرك التورنت المدمج/,
  );
});

test("main, the web bridge and the interface route torrents through the rules", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const read = (p) =>
    readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
  const engine = read("electron/torrent-engine.mjs");
  // TCP only: uTP stalled each connection about 40 s in measurements.
  assert.match(engine, /utp: network\.utp \?\? false/);
  // Never announced on the LAN; a router port only with incoming peers on.
  assert.ok(engine.includes("lsd: false"));
  assert.match(
    engine,
    /const incoming = network\.natUpnp \?\? options\.incoming === true;/,
  );
  assert.match(engine, /natUpnp: incoming,\s*natPmp: incoming,/);
  assert.match(engine, /server\.listen\(0, "127\.0\.0\.1"/);
  const main = read("electron/main.mjs");
  assert.match(main, /chooseEngine\(\s*setting,/);
  assert.match(
    main,
    /if \(engine === "ask"\) throw new Error\(NEEDS_ENGINE\);/,
  );
  assert.match(
    main,
    /utilityProcess\.fork\(join\(root, "electron", "torrent-host\.mjs"\)/,
  );
  assert.match(main, /if \(!s\.active\) releaseTorrent\(\);/);
  // Replaying the same torrent must not release it: the stop before a play
  // runs with nothing marked as playing.
  assert.match(
    main,
    /const previousTorrent = builtinTorrent;\s*builtinTorrent = null;[\s\S]{0,200}?const previousFallback = fallbackTorrent;\s*fallbackTorrent = null;\s*try \{\s*await player\.stop\(\);/,
  );
  assert.match(
    main,
    /if \(previousTorrent && previousTorrent !== torrentHash\)/,
  );
  // Seek previews and the menu's torrent link share one list of engines.
  assert.match(
    main,
    /function torrentEngines\(\) \{\s*return \[\s*client\.state\.settings\.serverUrl,\s*torrentHost\?\.origin,\s*torrServer\?\.origin,\s*\]/,
  );
  assert.match(main, /const serverUrl = torrentEngines\(\);/);
  assert.match(main, /\.then\(\(\) => torrentHost\?\.stop\(\)\)/);
  assert.match(main, /shell\.openExternal\(SERVICE_DOWNLOAD\)/);
  assert.match(main, /torrentHost\?\.configure\(client\.state\.settings\)/);
  // The service check refuses redirects, like every other request.
  assert.match(
    main,
    /async function serviceUp\(\)[\s\S]{0,300}redirect: "error"/,
  );
  const bridge = read("web/bridge.js");
  assert.match(
    bridge,
    /if \(!\(await serverUp\(\)\)\) throw new Error\(NEEDS_ENGINE\);/,
  );
  assert.match(
    bridge,
    /torrentEngineStats: \(\) => \(\{ available: false, running: false \}\)/,
  );
  const app = read("src/App.jsx");
  assert.match(app, /method === "play" && e\.message === NEEDS_ENGINE/);
  assert.match(app, /onRetry=\{\(\) => act\("play", torrentSetup\.args\)\}/);
  const preload = read("electron/preload.cjs");
  for (const method of [
    "torrentEngineStats",
    "torrentEngineClear",
    "openServiceDownload",
  ])
    assert.match(preload, new RegExp(`"${method}"`));
  const { DEFAULT_SETTINGS, safeSettings } =
    await import("../core/protocol.mjs");
  assert.equal(DEFAULT_SETTINGS.torrentEngine, "ask", "never on until chosen");
  assert.equal(
    safeSettings({ torrentEngine: "builtin" }).torrentEngine,
    "builtin",
  );
  assert.equal(
    safeSettings({ torrentEngine: "everything" }).torrentEngine,
    "ask",
  );
  const { thumbnailsAllowed } = await import("../core/trickplay.mjs");
  const source = { url: "http://127.0.0.1:4000/token/hash/0" };
  assert.equal(
    thumbnailsAllowed(source, "local", [
      "http://127.0.0.1:11470",
      "http://127.0.0.1:4000",
    ]),
    false,
  );
  assert.equal(
    thumbnailsAllowed(source, "local", "http://127.0.0.1:11470"),
    true,
  );
});

test("main watches a built-in torrent's start and moves on from a dead swarm (issue #82)", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const main = readFileSync(
    fileURLToPath(new URL("../electron/main.mjs", import.meta.url)),
    "utf8",
  );
  // Built-in torrents (and TorrServer's after them) are watched, from the
  // moment MPV is started.
  assert.match(
    main,
    /const watched = torrentHash\s*\? \[torrentHash, "builtin"\]\s*: fallbackHash\s*\? \[fallbackHash, "torrserver"\]\s*: null;\s*if \(watched\) \{\s*const watch = watchTorrentStart\(\.\.\.watched\);/,
  );
  // A start that fails ends its watch.
  assert.match(
    main,
    /started\.catch\(\(\) => \{\s*if \(torrentWatch !== watch\) return;/,
  );
  const watch = main.slice(main.indexOf("function watchTorrentStart("));
  const body = watch.slice(0, watch.indexOf("\n}\n"));
  // It belongs to one viewing and one torrent, and ends with either.
  assert.match(
    body,
    /nowPlaying === viewing &&\s*\(fallback \? fallbackTorrent : builtinTorrent\) === hash/,
  );
  assert.match(body, /player\.setTorrentStatus\(status\)/);
  assert.match(body, /torrentDead\(status, Date\.now\(\) - began\)/);
  // A dead swarm tries the next source; with none, the viewing ends with a
  // sentence instead of a black screen.
  assert.match(body, /if \(await tryNextSource\(\)\) return;/);
  assert.match(body, /await player\.stop\(\);/);
  const next = main.slice(main.indexOf("async function tryNextSource("));
  assert.match(
    next.slice(0, next.indexOf("\n}\n")),
    /return !result\?\.cancelled;/,
  );
  assert.match(
    next.slice(0, next.indexOf("\n}\n")),
    /catch \{[\s\S]*return false;/,
  );
});

test("more peers: public trackers, DHT routers and saved nodes are clean", async () => {
  const {
    PUBLIC_TRACKERS,
    DHT_BOOTSTRAP,
    FEW_PEERS,
    REANNOUNCE_MS,
    cleanDhtNodes,
  } = await import("../core/torrent-engine.mjs");
  // HTTPS trackers reach peers on networks that block UDP (Harbor's list).
  assert.ok(PUBLIC_TRACKERS.some((t) => t.startsWith("https://")));
  assert.ok(PUBLIC_TRACKERS.some((t) => t.startsWith("udp://")));
  for (const tracker of PUBLIC_TRACKERS)
    assert.match(tracker, /^(udp|https?):\/\/[a-z0-9.-]+:\d+\/announce$/);
  assert.equal(new Set(PUBLIC_TRACKERS).size, PUBLIC_TRACKERS.length);
  for (const router of DHT_BOOTSTRAP) assert.match(router, /^[a-z0-9.-]+:\d+$/);
  assert.equal(FEW_PEERS, 40);
  assert.equal(REANNOUNCE_MS, 30000);
  assert.deepEqual(
    cleanDhtNodes([
      { host: "1.2.3.4", port: 6881 },
      { host: "1.2.3.4", port: 6881 },
      { host: "256.1.1.1", port: 1 },
      { host: "example.com", port: 6881 },
      { host: "::1", port: 6881 },
      { host: "5.6.7.8", port: 0 },
      { host: "5.6.7.8", port: 70000 },
      { host: "5.6.7.8", port: "6882" },
      null,
    ]),
    [
      { host: "1.2.3.4", port: 6881 },
      { host: "5.6.7.8", port: 6882 },
    ],
  );
  assert.deepEqual(cleanDhtNodes("nope"), []);
  const many = Array.from({ length: 300 }, (_, i) => ({
    host: `10.0.${i >> 8}.${i & 255}`,
    port: 6881,
  }));
  assert.equal(cleanDhtNodes(many).length, 200);
});

test("a season pack plays the file the addon names", async () => {
  const { cleanFilename } = await import("../core/torrent-engine.mjs");
  assert.equal(
    cleanFilename("Show/Season 1/Show.S01E02.mkv"),
    "Show.S01E02.mkv",
  );
  assert.equal(cleanFilename("C:\\Pack\\Ep 3.mkv"), "Ep 3.mkv");
  assert.equal(cleanFilename("bad\u0000name.mkv"), "");
  assert.equal(cleanFilename("x".repeat(256)), "");
  assert.equal(cleanFilename(42), "");
  const files = [
    { name: "Show.S01E01.mkv", length: 900 },
    { name: "Show.S01E02.mkv", length: 800 },
    { name: "sample.mkv", length: 100 },
  ];
  // The index wins, then the name (any case, any folder), then the largest.
  assert.equal(pickFile(files, 2, "Show.S01E02.mkv"), 2);
  assert.equal(pickFile(files, undefined, "show.s01e02.MKV"), 1);
  assert.equal(pickFile(files, undefined, "Pack/Show.S01E02.mkv"), 1);
  assert.equal(pickFile(files, undefined, "missing.mkv"), -1);
  assert.equal(pickFile(files, undefined), 0);
  // A real swarm: two episodes in one torrent, no index, the second named.
  const dir = mkdtempSync(join(tmpdir(), "riwaq-pack-"));
  const first = randomBytes(400 * 1024);
  const second = randomBytes(200 * 1024);
  const { mkdirSync } = await import("node:fs");
  mkdirSync(join(dir, "Pack"));
  writeFileSync(join(dir, "Pack", "Ep01.mkv"), first);
  writeFileSync(join(dir, "Pack", "Ep02.mkv"), second);
  for (const season of ["S01", "S02"]) mkdirSync(join(dir, "Pack", season));
  writeFileSync(join(dir, "Pack", "S01", "Same.mkv"), first);
  writeFileSync(join(dir, "Pack", "S02", "Same.mkv"), second);
  const seeder = new WebTorrent({ ...OFFLINE, lsd: false, natPmp: false });
  const torrent = await new Promise((resolve) =>
    seeder.seed(join(dir, "Pack"), { announce: [] }, resolve),
  );
  const cacheDir = mkdtempSync(join(tmpdir(), "riwaq-cache-"));
  const engine = await startEngine({ cacheDir, network: OFFLINE, WebTorrent });
  try {
    const url = engine.url({
      infoHash: torrent.infoHash,
      filename: "Season/Ep02.mkv",
    });
    assert.match(url, /\/-1\?f=Season%2FEp02\.mkv$/);
    engine.addPeer(torrent.infoHash, `127.0.0.1:${seeder.address().port}`);
    assert.ok((await get(url)).body.equals(second));
    const specific = engine.url({
      infoHash: torrent.infoHash,
      filename: "S02/Same.mkv",
    });
    assert.ok((await get(specific)).body.equals(second));
    const ambiguous = engine.url({
      infoHash: torrent.infoHash,
      filename: "Same.mkv",
    });
    assert.equal((await get(ambiguous)).status, 404);
    // Without a name, the largest video plays.
    const plain = engine.url({ infoHash: torrent.infoHash });
    assert.doesNotMatch(plain, /\?f=/);
    assert.ok((await get(plain)).body.equals(first));
  } finally {
    await engine.close();
    await new Promise((resolve) => seeder.destroy(resolve));
  }
});

// A WebTorrent stand-in that records what the engine asks of it.
function recordingClient() {
  const seen = { options: null, adds: [], updates: 0, lookups: 0 };
  class Recording extends EventEmitter {
    constructor(options) {
      super();
      seen.options = options;
      this.dht = options.dht
        ? {
            toJSON: () => ({
              nodes: [
                { host: "9.9.9.9", port: 6881 },
                { host: "bad", port: 1 },
              ],
            }),
            lookup: () => seen.lookups++,
          }
        : undefined;
    }
    add(magnet, options) {
      seen.adds.push({ magnet, options });
      const torrent = new EventEmitter();
      torrent.infoHash = magnet.match(/btih:([a-f0-9]{40})/i)[1];
      torrent.numPeers = seen.peers ?? 0;
      torrent.discovery = { tracker: { update: () => seen.updates++ } };
      torrent.files = [];
      torrent.destroy = (_options, done) => done();
      return torrent;
    }
    destroy(done) {
      done();
    }
  }
  return { Recording, seen };
}

test("every torrent asks public trackers and the DHT again while peers are few", async () => {
  const { PUBLIC_TRACKERS, DHT_BOOTSTRAP } =
    await import("../core/torrent-engine.mjs");
  const cacheDir = mkdtempSync(join(tmpdir(), "riwaq-cache-"));
  // Nodes saved by the last run start the DHT warm, before the routers.
  writeFileSync(
    join(cacheDir, ".dht-nodes.json"),
    JSON.stringify([
      { host: "8.8.4.4", port: 6881 },
      { host: "x", port: 1 },
    ]),
  );
  const { Recording, seen } = recordingClient();
  const engine = await startEngine({
    cacheDir,
    options: { incoming: true },
    WebTorrent: Recording,
    reannounceMs: 20,
  });
  try {
    assert.deepEqual(seen.options.dht.bootstrap, [
      "8.8.4.4:6881",
      ...DHT_BOOTSTRAP,
    ]);
    assert.equal(seen.options.tracker, true);
    assert.equal(seen.options.natUpnp, true);
    assert.equal(seen.options.natPmp, true);
    assert.equal(seen.options.lsd, false);
    assert.equal(seen.options.utp, false);
    const own = PUBLIC_TRACKERS[0];
    engine.url({ infoHash: "e".repeat(40), sources: [`tracker:${own}`] });
    const { options } = seen.adds[0];
    assert.equal(options.deselect, true);
    assert.equal(options.strategy, "sequential");
    // The addon's own trackers stay in the magnet; the rest are added once.
    assert.ok(seen.adds[0].magnet.includes(encodeURIComponent(own)));
    assert.equal(options.announce.includes(own), false);
    assert.equal(options.announce.length, PUBLIC_TRACKERS.length - 1);
    await new Promise((resolve) => setTimeout(resolve, 90));
    assert.ok(seen.updates >= 2, "trackers asked again");
    assert.ok(seen.lookups >= 2, "the DHT asked again");
  } finally {
    await engine.close();
  }
  const updates = seen.updates;
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(seen.updates, updates, "a closed engine asks no more");
  // The DHT's nodes are kept for the next run, cleaned.
  const { readFileSync } = await import("node:fs");
  assert.deepEqual(
    JSON.parse(readFileSync(join(cacheDir, ".dht-nodes.json"), "utf8")),
    [{ host: "9.9.9.9", port: 6881 }],
  );
});

test("a swarm with enough peers is left alone, and offline tests ask nobody", async () => {
  const { FEW_PEERS } = await import("../core/torrent-engine.mjs");
  const { Recording, seen } = recordingClient();
  seen.peers = FEW_PEERS;
  const busy = await startEngine({
    cacheDir: mkdtempSync(join(tmpdir(), "riwaq-cache-")),
    WebTorrent: Recording,
    reannounceMs: 10,
  });
  try {
    busy.url({ infoHash: "f".repeat(40) });
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(seen.updates, 0);
    // Incoming peers stay off unless the settings ask for them.
    assert.equal(seen.options.natUpnp, false);
  } finally {
    await busy.close();
  }
  const quiet = recordingClient();
  const offline = await startEngine({
    cacheDir: mkdtempSync(join(tmpdir(), "riwaq-cache-")),
    network: OFFLINE,
    options: { incoming: true },
    WebTorrent: quiet.Recording,
  });
  try {
    offline.url({ infoHash: "a".repeat(40) });
    assert.equal(quiet.seen.options.dht, false);
    assert.equal(quiet.seen.options.natUpnp, false, "the test forces it off");
    assert.equal("announce" in quiet.seen.adds[0].options, false);
    // Without trackers the check sends nothing and says so.
    assert.deepEqual(await offline.netcheck(), {
      dhtNodes: 0,
      udp: false,
      https: false,
      incoming: false,
    });
  } finally {
    await offline.close();
  }
});

test("the engine process restarts when incoming peers change, and gets the file name", async () => {
  const children = [];
  const calls = [];
  const host = new TorrentHost({
    fork: () => {
      const child = new EventEmitter();
      child.postMessage = ({ id, method, args }) => {
        calls.push({ child: children.indexOf(child), method, params: args[0] });
        setImmediate(() =>
          child.emit("message", {
            id,
            result:
              method === "start"
                ? { origin: "http://127.0.0.1:9" }
                : method === "netcheck"
                  ? { dhtNodes: 12.4, udp: true, https: "yes", extra: "x" }
                  : "http://127.0.0.1:9/t",
          }),
        );
      };
      child.kill = () => setImmediate(() => child.emit("exit"));
      children.push(child);
      return child;
    },
    cacheDir: "/unused",
  });
  const stream = {
    infoHash: "d".repeat(40),
    behaviorHints: { filename: "Pack/Show.S01E04.mkv" },
  };
  try {
    await host.url(stream, { torrentIncoming: false });
    const start = calls.find((c) => c.method === "start");
    assert.equal(start.params.options.incoming, false);
    const url = calls.find((c) => c.method === "url");
    assert.equal(url.params.filename, "Pack/Show.S01E04.mkv");
    await host.url(stream, { torrentIncoming: false });
    assert.equal(children.length, 1, "same setting, same process");
    await host.url(stream, {});
    assert.equal(children.length, 2, "a changed setting starts it again");
    assert.equal(
      calls.filter((c) => c.method === "start")[1].params.options.incoming,
      true,
    );
    // Only clean counts and flags come back from the check.
    assert.deepEqual(await host.netcheck({}), {
      dhtNodes: 12,
      udp: true,
      https: false,
      incoming: false,
    });
  } finally {
    await host.stop();
  }
});

test("incoming peers are a kept setting, and the network check is desktop-only", async () => {
  const { safeSettings, DEFAULT_SETTINGS } =
    await import("../core/protocol.mjs");
  assert.equal(DEFAULT_SETTINGS.torrentIncoming, true);
  assert.equal(safeSettings({ torrentIncoming: false }).torrentIncoming, false);
  assert.equal(safeSettings({ torrentIncoming: "no" }).torrentIncoming, true);
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const read = (p) =>
    readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
  assert.match(read("electron/preload.cjs"), /"torrentNetworkCheck"/);
  assert.match(
    read("electron/main.mjs"),
    /torrentNetworkCheck: \(\) => torrents\(\)\.netcheck\(client\.state\.settings\)/,
  );
  assert.match(read("web/desktop-only.js"), /torrentNetworkCheck:/);
  assert.match(read("electron/torrent-host.mjs"), /"netcheck"/);
});
