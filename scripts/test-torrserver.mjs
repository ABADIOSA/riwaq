/**
 * TorrServer against a real local swarm: the program the viewer downloads,
 * driven by Riwaq's TorrServerHost (electron/torrserver.mjs).
 *
 *   node scripts/test-torrserver.mjs <TorrServer binary>
 *
 * A WebTorrent seeder shares two episodes through a tracker on 127.0.0.1;
 * TorrServer finds them from the magnet alone. The script checks that the
 * program refuses requests without the password, read Riwaq's settings (no
 * Bonjour, LAN discovery or DLNA), plays the file an addon names by index
 * or by name byte for byte, reports counts, and that a dropped torrent is
 * gone. Pass the Windows build on Windows, the Linux build elsewhere: the
 * binary's own SHA-256 is pinned for the run, since this is not the
 * download check (tests/torrserver.test.mjs covers that).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import WebTorrent from "webtorrent";
import Server from "bittorrent-tracker/server";
import { TorrServerHost } from "../electron/torrserver.mjs";

const binary = resolve(process.argv[2] || "");
const bytes = readFileSync(binary);
const release = {
  version: "local",
  size: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
};

function get(url, headers = {}) {
  return new Promise((done, fail) => {
    const req = request(url, { headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () =>
        done({ status: res.statusCode, body: Buffer.concat(chunks) }),
      );
    });
    req.on("error", fail);
    req.setTimeout(60000, () => req.destroy(new Error("timeout")));
    req.end();
  });
}

const root = mkdtempSync(join(tmpdir(), "riwaq-torrserver-"));
const pack = join(root, "Show.S01");
mkdirSync(pack);
const first = Buffer.alloc(3 * 1024 * 1024, 1);
const second = Buffer.alloc(2 * 1024 * 1024, 2);
for (let i = 0; i < second.length; i += 4096) second[i] = i % 251;
writeFileSync(join(pack, "Show.S01E01.mkv"), first);
writeFileSync(join(pack, "Show.S01E02.mkv"), second);

const tracker = new Server({ udp: false, ws: false, stats: false });
await new Promise((done) => tracker.listen(0, "127.0.0.1", done));
const announce = `http://127.0.0.1:${tracker.http.address().port}/announce`;
const seeder = new WebTorrent({
  dht: false,
  lsd: false,
  utp: false,
  natUpnp: false,
  natPmp: false,
});
const torrent = await new Promise((done) =>
  seeder.seed(pack, { announce: [announce] }, done),
);
const order = torrent.files.map((f) => ({ path: f.path, length: f.length }));
console.log("seeding", torrent.infoHash, order.map((f) => f.path).join(", "));

const host = new TorrServerHost({
  dir: join(root, "torrserver"),
  release,
  exe: binary,
  pollMs: 500,
  log: (e) => console.log("log:", e.message),
});
const stream = (extra) => ({
  infoHash: torrent.infoHash,
  sources: [`tracker:${announce}`],
  ...extra,
});
try {
  const began = Date.now();
  const second2 = order.findIndex((f) => f.path.endsWith("E02.mkv"));
  const byIndex = await host.url(
    stream({ fileIdx: second2 }),
    {},
    { files: order, onStatus: (s) => s && console.log("status", s) },
  );
  console.log(
    "ready in",
    Date.now() - began,
    "ms:",
    byIndex.replace(/link=.*$/, "link=…"),
  );
  assert.match(
    byIndex,
    /^http:\/\/127\.0\.0\.1:\d+\/stream\/Show\.S01E02\.mkv\?/,
  );
  const whole = await get(byIndex);
  assert.equal(whole.status, 200);
  assert.ok(whole.body.equals(second), "the second episode, byte for byte");
  const part = await get(byIndex, { Range: "bytes=1000-200999" });
  assert.equal(part.status, 206);
  assert.ok(part.body.equals(second.subarray(1000, 201000)));
  // The addon names the file instead of giving an index.
  const byName = await host.url(
    stream({ behaviorHints: { filename: "Show.S01E01.mkv" } }),
    {},
  );
  assert.ok((await get(byName)).body.equals(first));
  // An index with neither the torrent's list nor a name is not guessed.
  await assert.rejects(host.url(stream({ fileIdx: 0 }), {}), /أي ملف/);
  const status = await host.status(torrent.infoHash);
  assert.deepEqual(Object.keys(status).sort(), [
    "bytes",
    "down",
    "metadata",
    "peers",
  ]);
  assert.equal(status.metadata, true);
  assert.ok(status.bytes > 0);
  // Nothing without the password: adding, settings, shutdown.
  const open = await fetch(host.origin + "/torrents", {
    method: "POST",
    body: JSON.stringify({ action: "list" }),
  });
  assert.equal(open.status, 401);
  assert.equal((await fetch(host.origin + "/shutdown")).status, 401);
  const sets = await host.api("/settings", { action: "get" });
  assert.equal(sets.EnableBonjour, false);
  assert.equal(sets.EnableLPD, false);
  assert.equal(sets.EnableDLNA, false);
  // A torrent is dropped when its last viewing ends: MPV's address then
  // answers 401 without the password.
  await host.release(torrent.infoHash);
  assert.equal((await get(byIndex)).status, 200, "the other viewing keeps it");
  await host.release(torrent.infoHash);
  assert.equal((await get(byIndex)).status, 401);
  console.log("TorrServer local swarm: OK");
} finally {
  await host.stop();
  assert.equal(host.running, false);
  await new Promise((done) => seeder.destroy(done));
  await new Promise((done) => tracker.close(done));
}
