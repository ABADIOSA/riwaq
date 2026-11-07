// The built-in engine's cache boundary (issue #138, PR #142 review,
// CWE-59): a link left in userData/torrent-cache (by a crash, another
// program or a hostile local process before the title starts) must never
// let the engine read, write, mark sparse or delete a file outside it.
// A real two-peer swarm on this machine and a real filesystem; Linux
// symlinks stand in for NTFS junctions here (Node's lstat reports both as
// links), and the hard-link case is the same on both.
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebTorrent from "webtorrent";
import { startEngine } from "../electron/torrent-engine.mjs";

const OFFLINE = { dht: false, tracker: false, utp: false, natUpnp: false };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function seed(name, bytes) {
  const dir = mkdtempSync(join(tmpdir(), "riwaq-seed-"));
  writeFileSync(join(dir, name), bytes);
  const seeder = new WebTorrent({ ...OFFLINE, lsd: false, natPmp: false });
  const torrent = await new Promise((resolve) =>
    seeder.seed(join(dir, name), { announce: [] }, resolve),
  );
  return { seeder, torrent, address: `127.0.0.1:${seeder.address().port}` };
}

/** A guard file outside the cache, and what it held. */
function guard(size = 64 * 1024) {
  const dir = mkdtempSync(join(tmpdir(), "riwaq-outside-"));
  const path = join(dir, "guard.mkv");
  const bytes = randomBytes(size);
  writeFileSync(path, bytes);
  return {
    dir,
    path,
    intact() {
      assert.ok(existsSync(path), "the outside file still exists");
      assert.equal(statSync(path).size, bytes.length);
      assert.ok(readFileSync(path).equals(bytes), "its bytes are unchanged");
    },
  };
}

async function run({ prepare, name = "Single.mkv", cacheBytes = 0 }) {
  const content = randomBytes(256 * 1024);
  const { seeder, torrent, address } = await seed(name, content);
  const cacheDir = mkdtempSync(join(tmpdir(), "riwaq-cache-"));
  const marked = [];
  const outside = guard(content.length);
  outside.bytes = readFileSync(outside.path);
  const hashDir = join(cacheDir, torrent.infoHash);
  prepare({ hashDir, cacheDir, name, outside });
  const engine = await startEngine({
    cacheDir,
    options: { cacheBytes },
    network: OFFLINE,
    WebTorrent,
    viewingGraceMs: 50,
    sparse: async (path) => marked.push(path),
  });
  let body = null;
  let started = null;
  try {
    // url() answers at once, or a promise while the same title is going.
    started = await Promise.resolve()
      .then(() => engine.url({ infoHash: torrent.infoHash }))
      .then((url) => {
        engine.addPeer(torrent.infoHash, address);
        return url;
      })
      .catch((error) => error);
    if (typeof started === "string")
      body = await fetch(started, {
        headers: { Range: "bytes=0-4095" },
        signal: AbortSignal.timeout(2000),
      })
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .catch(() => null);
    engine.release(torrent.infoHash);
    await wait(400);
    await engine.clear();
  } finally {
    await engine.close();
    await new Promise((resolve) => seeder.destroy(resolve));
  }
  return { body, started, marked, outside, content };
}

test("a hash folder that is a link to another folder is refused", async () => {
  const { started, marked, outside } = await run({
    prepare: ({ hashDir, outside }) =>
      symlinkSync(outside.dir, hashDir, "junction"),
  });
  assert.ok(started instanceof Error, "the title does not start through it");
  assert.equal(marked.length, 0);
  outside.intact();
});

// "Delete after viewing" (cacheBytes 0, the default) sweeps a leftover hash
// folder before the title uses it. A size cap keeps a leftover that holds
// bytes (a hard link counts its size), so there the store's own check must
// refuse the shared file when it opens it.
for (const [policy, cacheBytes] of [
  ["delete after viewing", 0],
  ["a 2 GB cap", 2 * 1024 ** 3],
]) {
  test(`${policy}: a piece file that is a symbolic link is never opened`, async () => {
    const { body, marked, outside, content } = await run({
      cacheBytes,
      prepare: ({ hashDir, name, outside }) => {
        mkdirSync(hashDir);
        symlinkSync(outside.path, join(hashDir, name), "file");
      },
    });
    if (body)
      assert.ok(
        Buffer.from(body).equals(content.subarray(0, 4096)),
        "only the swarm's own bytes, from a fresh file",
      );
    // A symbolic link counts no bytes, so even under a cap its folder is
    // an empty leftover and is swept before the title starts: either way
    // the engine works on a fresh file of its own.
    outside.intact();
  });

  test(`${policy}: a piece file hard-linked outside is never written`, async () => {
    const { body, marked, outside, content } = await run({
      cacheBytes,
      prepare: ({ hashDir, name, outside }) => {
        mkdirSync(hashDir);
        linkSync(outside.path, join(hashDir, name));
      },
    });
    if (body)
      assert.ok(
        Buffer.from(body).equals(content.subarray(0, 4096)),
        "only the swarm's own bytes, from a fresh file",
      );
    if (cacheBytes) {
      assert.equal(body, null, "the shared file is refused");
      assert.equal(marked.length, 0);
    }
    outside.intact();
  });
}

test("an ordinary leftover folder is still used and cleaned", async () => {
  const { body, marked, outside } = await run({
    prepare: ({ hashDir }) => mkdirSync(hashDir),
  });
  assert.ok(body && body.byteLength === 4096, "the title plays");
  assert.ok(marked.length >= 1, "its own piece file was marked sparse");
  outside.intact();
});
