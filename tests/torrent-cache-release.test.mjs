// Issue #138: torrent space piled up when several titles were opened in a
// short time, and went only when the app opened or closed. Two causes in
// the built-in engine: a released title was kept three minutes even with
// "delete after viewing", and on Windows a plain NTFS file allocates every
// byte before the furthest write (MPV reads a film's index near its end).
// These run a real swarm of two on this machine and a real filesystem.
import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebTorrent from "webtorrent";
import { markSparse, startEngine } from "../electron/torrent-engine.mjs";

const OFFLINE = { dht: false, tracker: false, utp: false, natUpnp: false };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function seed(bytes, name) {
  const dir = mkdtempSync(join(tmpdir(), "riwaq-seed-"));
  writeFileSync(join(dir, name), bytes);
  const seeder = new WebTorrent({ ...OFFLINE, lsd: false, natPmp: false });
  const torrent = await new Promise((resolve) =>
    seeder.seed(join(dir, name), { announce: [] }, resolve),
  );
  return { seeder, torrent, address: `127.0.0.1:${seeder.address().port}` };
}

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () =>
        resolve({ status: res.statusCode, body: Buffer.concat(chunks) }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

/** Opens a response and keeps it open, as a paused player would. */
function hold(url) {
  return new Promise((resolve, reject) => {
    const req = request(url, (res) => {
      res.pause();
      resolve(() => req.destroy());
    });
    req.on("error", () => {});
    req.on("error", reject);
    req.end();
  });
}

async function until(check, ms = 3000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await check()) return Date.now() - start;
    await wait(20);
  }
  return -1;
}

test("delete after viewing: a released title and its pieces go within seconds", async () => {
  const bytes = randomBytes(700 * 1024);
  const { seeder, torrent, address } = await seed(bytes, "Film.mkv");
  const cacheDir = mkdtempSync(join(tmpdir(), "riwaq-cache-"));
  // A file beside the cache that nothing may touch.
  const guardDir = mkdtempSync(join(tmpdir(), "riwaq-guard-"));
  writeFileSync(join(guardDir, "keep.txt"), "keep");
  const engine = await startEngine({
    cacheDir,
    network: OFFLINE,
    WebTorrent,
    viewingGraceMs: 100,
  });
  try {
    const url = engine.url({ infoHash: torrent.infoHash });
    engine.addPeer(torrent.infoHash, address);
    assert.ok((await get(url)).body.equals(bytes));
    assert.ok(existsSync(join(cacheDir, torrent.infoHash)));
    const released = Date.now();
    assert.equal(engine.release(torrent.infoHash), true);
    const took = await until(
      () => !existsSync(join(cacheDir, torrent.infoHash)),
    );
    assert.ok(took >= 0, "the pieces were deleted");
    // Measured: the grace (100 ms here, 5 s by default) plus the destroy.
    assert.ok(Date.now() - released < 2000, `${Date.now() - released} ms`);
    assert.equal((await engine.stats()).torrents, 0);
    assert.equal((await engine.stats()).cache, 0);
  } finally {
    await engine.close();
    await new Promise((resolve) => seeder.destroy(resolve));
  }
  assert.equal(readdirSync(guardDir).join(), "keep.txt");
});

test("a reader still streaming holds a released title until it closes", async () => {
  // Larger than loopback socket buffers, so a paused reader stays open.
  const bytes = randomBytes(40 * 1024 * 1024);
  const { seeder, torrent, address } = await seed(bytes, "Held.mkv");
  const cacheDir = mkdtempSync(join(tmpdir(), "riwaq-cache-"));
  const engine = await startEngine({
    cacheDir,
    network: OFFLINE,
    WebTorrent,
    viewingGraceMs: 50,
  });
  try {
    const url = engine.url({ infoHash: torrent.infoHash });
    engine.addPeer(torrent.infoHash, address);
    // Another player playing the copied link.
    const close = await hold(url);
    engine.release(torrent.infoHash);
    await wait(400);
    assert.equal((await engine.stats()).torrents, 1, "held by its reader");
    close();
    assert.ok(
      (await until(() => !existsSync(join(cacheDir, torrent.infoHash)))) >= 0,
      "gone after the reader closed",
    );
  } finally {
    await engine.close();
    await new Promise((resolve) => seeder.destroy(resolve));
  }
});

test("starting another title sweeps what earlier viewings left, never the new one", async () => {
  const a = await seed(randomBytes(300 * 1024), "A.mkv");
  const b = await seed(randomBytes(300 * 1024), "B.mkv");
  const cacheDir = mkdtempSync(join(tmpdir(), "riwaq-cache-"));
  // A crash left an info-hash folder behind; a non-hash folder stays.
  const crashed = join(cacheDir, "d".repeat(40));
  mkdirSync(crashed);
  writeFileSync(join(crashed, "piece"), "x");
  mkdirSync(join(cacheDir, "not-a-hash"));
  const engine = await startEngine({
    cacheDir,
    network: OFFLINE,
    WebTorrent,
    // Long: only the new start may remove A, not its timer.
    viewingGraceMs: 60000,
  });
  try {
    const urlA = engine.url({ infoHash: a.torrent.infoHash });
    engine.addPeer(a.torrent.infoHash, a.address);
    await get(urlA);
    engine.release(a.torrent.infoHash);
    assert.ok(existsSync(join(cacheDir, a.torrent.infoHash)));
    const urlB = engine.url({ infoHash: b.torrent.infoHash });
    engine.addPeer(b.torrent.infoHash, b.address);
    assert.ok(
      (await until(() => !existsSync(join(cacheDir, a.torrent.infoHash)))) >= 0,
      "A swept at B's start",
    );
    assert.equal(existsSync(crashed), false, "crash leftovers swept");
    assert.ok(existsSync(join(cacheDir, "not-a-hash")), "only hash folders");
    assert.equal((await get(urlB)).status, 200);
    assert.ok(existsSync(join(cacheDir, b.torrent.infoHash)), "B kept");
    assert.equal((await engine.stats()).torrents, 1);
  } finally {
    await engine.close();
    await new Promise((resolve) => a.seeder.destroy(resolve));
    await new Promise((resolve) => b.seeder.destroy(resolve));
  }
});

test("the same torrent for the next episode is picked up again, not destroyed", async () => {
  const bytes = randomBytes(400 * 1024);
  const { seeder, torrent, address } = await seed(bytes, "Pack.mkv");
  const cacheDir = mkdtempSync(join(tmpdir(), "riwaq-cache-"));
  const engine = await startEngine({
    cacheDir,
    network: OFFLINE,
    WebTorrent,
    viewingGraceMs: 150,
  });
  try {
    const url = engine.url({ infoHash: torrent.infoHash });
    engine.addPeer(torrent.infoHash, address);
    await get(url);
    engine.release(torrent.infoHash);
    // Main asks for the same info hash again before the grace ends.
    await wait(50);
    assert.equal(engine.url({ infoHash: torrent.infoHash }), url);
    await wait(400);
    assert.equal((await engine.stats()).torrents, 1, "still served");
    assert.ok((await get(url)).body.equals(bytes));
    // Released again, it goes.
    engine.release(torrent.infoHash);
    assert.ok(
      (await until(() => !existsSync(join(cacheDir, torrent.infoHash)))) >= 0,
    );
    // A start while it is being destroyed waits for the destroy, then
    // starts afresh instead of failing on a duplicate torrent.
    const again = await engine.url({ infoHash: torrent.infoHash });
    engine.addPeer(torrent.infoHash, address);
    assert.ok((await get(again)).body.equals(bytes));
  } finally {
    await engine.close();
    await new Promise((resolve) => seeder.destroy(resolve));
  }
});

test("with a cache size, a released title is kept, within the size", async () => {
  const bytes = randomBytes(300 * 1024);
  const { seeder, torrent, address } = await seed(bytes, "Kept.mkv");
  const cacheDir = mkdtempSync(join(tmpdir(), "riwaq-cache-"));
  const engine = await startEngine({
    cacheDir,
    options: { cacheBytes: 2 * 1024 ** 3 },
    network: OFFLINE,
    WebTorrent,
    viewingGraceMs: 10,
    graceMs: 60000,
  });
  try {
    engine.url({ infoHash: torrent.infoHash });
    engine.addPeer(torrent.infoHash, address);
    await get(engine.url({ infoHash: torrent.infoHash }));
    engine.release(torrent.infoHash);
    await wait(300);
    assert.equal((await engine.stats()).torrents, 1, "the viewer chose 2 GB");
  } finally {
    await engine.close();
    await new Promise((resolve) => seeder.destroy(resolve));
  }
});

test("piece files are marked sparse before the first write, and a failure never stops a stream", async () => {
  const bytes = randomBytes(1024 * 1024);
  const { seeder, torrent, address } = await seed(bytes, "Sparse.mkv");
  const cacheDir = mkdtempSync(join(tmpdir(), "riwaq-cache-"));
  const marked = [];
  const engine = await startEngine({
    cacheDir,
    network: OFFLINE,
    WebTorrent,
    viewingGraceMs: 20,
    sparse: async (path) => {
      marked.push(path);
      // As on a FAT drive: the flag cannot be set.
      throw new Error("not supported");
    },
  });
  try {
    const url = engine.url({ infoHash: torrent.infoHash });
    engine.addPeer(torrent.infoHash, address);
    const tail = await get(url, { Range: "bytes=-4096" });
    assert.ok(tail.body.equals(bytes.subarray(bytes.length - 4096)));
    assert.equal(marked.length, 1);
    assert.ok(marked[0].startsWith(join(cacheDir, torrent.infoHash)));
    assert.ok(marked[0].endsWith("Sparse.mkv"));
  } finally {
    await engine.close();
    await new Promise((resolve) => seeder.destroy(resolve));
  }
});

test("markSparse opens without truncating and reports what it could do", async () => {
  const dir = mkdtempSync(join(tmpdir(), "riwaq-sparse-"));
  const file = join(dir, "kept.bin");
  writeFileSync(file, "pieces");
  const fds = [];
  assert.equal(
    await markSparse(file, { sparse: async (fd) => fds.push(fd) }),
    true,
  );
  assert.equal(fds.length, 1);
  assert.equal(statSync(file).size, 6, "existing pieces are kept");
  assert.equal(await markSparse(join(dir, "new.bin"), null), false);
  assert.equal(
    await markSparse(join(dir, "x.bin"), {
      sparse: async () => {
        throw new Error("ERROR_INVALID_FUNCTION");
      },
    }),
    false,
  );
});

test("measured on this filesystem: a tail read writes far less than the file's size", async (t) => {
  if (process.platform === "win32")
    return t.skip("NTFS needs the sparse flag; measured by scripts on Windows");
  const bytes = randomBytes(8 * 1024 * 1024);
  const { seeder, torrent, address } = await seed(bytes, "Index.mkv");
  const cacheDir = mkdtempSync(join(tmpdir(), "riwaq-cache-"));
  const engine = await startEngine({ cacheDir, network: OFFLINE, WebTorrent });
  try {
    const url = engine.url({ infoHash: torrent.infoHash });
    engine.addPeer(torrent.infoHash, address);
    await get(url, { Range: "bytes=-2000" });
    await wait(200);
    const file = join(cacheDir, torrent.infoHash, "Index.mkv");
    const info = statSync(file);
    t.diagnostic(
      `logical ${info.size} bytes, allocated ${info.blocks * 512} bytes`,
    );
    assert.equal(info.size, bytes.length, "the file reaches the tail");
    assert.ok(info.blocks * 512 < bytes.length / 2, "but is not allocated");
  } finally {
    await engine.close();
    await new Promise((resolve) => seeder.destroy(resolve));
  }
});
