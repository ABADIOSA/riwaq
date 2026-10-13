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
  trackersOf,
} from "../core/torrent-engine.mjs";
import { startEngine } from "../electron/torrent-engine.mjs";

// No DHT, trackers or uTP: the swarm is two clients on this machine.
const OFFLINE = { dht: false, tracker: false, utp: false };

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
  });
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
    network: { dht: false, utp: false },
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
  for (const off of ["lsd: false", "natUpnp: false", "natPmp: false"])
    assert.ok(engine.includes(off), off);
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
    /const previousTorrent = builtinTorrent;\s*builtinTorrent = null;\s*try \{\s*await player\.stop\(\);/,
  );
  assert.match(
    main,
    /if \(previousTorrent && previousTorrent !== torrentHash\)/,
  );
  assert.match(
    main,
    /serverUrl: \[client\.state\.settings\.serverUrl, torrentHost\?\.origin\]/,
  );
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
