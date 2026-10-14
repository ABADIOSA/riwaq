/**
 * Riwaq's built-in torrent engine (core/torrent-engine.mjs has the rules).
 * WebTorrent fetches the pieces MPV is reading, and a small HTTP server on
 * 127.0.0.1 hands MPV the file with byte ranges, as Stremio Service does.
 * It runs in its own utility process (electron/torrent-host.mjs), so a busy
 * swarm never slows the window; tests start it directly.
 *
 * - The HTTP server listens on 127.0.0.1 only, under a random path token,
 *   and answers only requests addressed to 127.0.0.1 (no DNS rebinding),
 *   GET and HEAD only.
 * - Only the pieces being watched are fetched (the torrent starts with
 *   nothing selected and each reader selects its range).
 * - UPnP, NAT-PMP and local peer discovery stay off: Riwaq never opens
 *   router ports or announces itself on the network.
 * - Peers connect over TCP; uTP is off (see below).
 * - A released title is kept a few minutes (a replay or a failover back
 *   finds it), then destroyed; its pieces stay only within the cache size.
 */
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  cachePrune,
  magnetOf,
  parseRange,
  pickFile,
  validHash,
} from "../core/torrent-engine.mjs";

const READY_MS = 45000;
const GRACE_MS = 3 * 60 * 1000;
const TYPES = {
  mkv: "video/x-matroska",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  avi: "video/x-msvideo",
  mov: "video/quicktime",
  ts: "video/mp2t",
};
const typeOf = (name = "") =>
  TYPES[name.split(".").pop().toLowerCase()] || "application/octet-stream";

async function folderBytes(path) {
  let total = 0;
  let items;
  try {
    items = await readdir(path, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const item of items) {
    const full = join(path, item.name);
    if (item.isDirectory()) total += await folderBytes(full);
    else total += (await stat(full).catch(() => null))?.size || 0;
  }
  return total;
}

function timeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Starts the engine. `options` are engineOptions(settings); `network` is for
 * tests (no DHT or trackers on a machine without internet).
 */
export async function startEngine({
  cacheDir,
  options = {},
  network = {},
  WebTorrent,
  graceMs = GRACE_MS,
  readyMs = READY_MS,
  log = () => {},
} = {}) {
  if (!cacheDir) throw new Error("مجلد ذاكرة التورنت غير محدد");
  WebTorrent ||= (await import("webtorrent")).default;
  await mkdir(cacheDir, { recursive: true });
  const client = new WebTorrent({
    maxConns: options.maxConns || 55,
    downloadLimit: options.downloadLimit ?? -1,
    uploadLimit: options.uploadLimit ?? -1,
    dht: network.dht ?? true,
    tracker: network.tracker ?? true,
    // uTP (utp-native) stalled every connection about 40 s before TCP took
    // over in Riwaq's measurements; TCP alone streams at full speed.
    utp: network.utp ?? false,
    lsd: false,
    natUpnp: false,
    natPmp: false,
  });
  client.on("error", (error) => log(error));
  let cap = Math.max(0, Number(options.cacheBytes) || 0);
  const token = randomBytes(16).toString("hex");
  const entries = new Map();
  let closed = false;

  // Pieces of titles no longer watched, beyond the cache size, go; a crash
  // left over from an earlier run is cleaned the same way.
  async function prune() {
    let names;
    try {
      names = await readdir(cacheDir);
    } catch {
      return;
    }
    const listed = [];
    for (const name of names) {
      if (!validHash(name)) continue;
      const path = join(cacheDir, name);
      const info = await stat(path).catch(() => null);
      if (!info?.isDirectory()) continue;
      listed.push({
        name,
        bytes: await folderBytes(path),
        used: entries.get(name)?.used || info.mtimeMs,
      });
    }
    for (const name of cachePrune(listed, cap, [...entries.keys()]))
      await rm(join(cacheDir, name), { recursive: true, force: true });
  }

  function ensure(stream) {
    const hash = stream.infoHash.toLowerCase();
    let entry = entries.get(hash);
    if (entry) {
      clearTimeout(entry.timer);
      entry.timer = null;
      entry.used = Date.now();
      return entry;
    }
    const torrent = client.add(magnetOf(stream), {
      path: join(cacheDir, hash),
      deselect: true,
      strategy: "sequential",
    });
    const ready = new Promise((resolve, reject) => {
      torrent.once("ready", resolve);
      torrent.once("error", reject);
    });
    ready.catch(() => {});
    torrent.on("error", (error) => log(error));
    entry = { hash, torrent, ready, used: Date.now(), timer: null };
    entries.set(hash, entry);
    return entry;
  }

  async function remove(hash) {
    const entry = entries.get(hash);
    if (!entry) return;
    entries.delete(hash);
    clearTimeout(entry.timer);
    // A destroy that never calls back must not keep its pieces on disk.
    await timeout(
      new Promise((resolve) =>
        entry.torrent.destroy({ destroyStore: cap === 0 }, () => resolve()),
      ),
      10000,
    ).catch(() => {});
    await prune();
  }

  const refuse = (res, status) => {
    res.writeHead(status, { "Cache-Control": "no-store" });
    res.end();
  };

  const server = createServer(async (req, res) => {
    const port = server.address()?.port;
    // Only requests addressed to this loopback port: a web page that points
    // its own host name at 127.0.0.1 is refused.
    if (req.headers.host !== `127.0.0.1:${port}`) return refuse(res, 403);
    if (req.method !== "GET" && req.method !== "HEAD") return refuse(res, 405);
    let parts;
    try {
      parts = new URL(req.url, "http://127.0.0.1").pathname
        .split("/")
        .filter(Boolean);
    } catch {
      return refuse(res, 400);
    }
    if (parts.length !== 3 || parts[0] !== token) return refuse(res, 404);
    const entry = entries.get(parts[1].toLowerCase());
    if (!entry) return refuse(res, 404);
    try {
      await timeout(entry.ready, readyMs);
    } catch {
      return refuse(res, 504);
    }
    const index = Number(parts[2]);
    const at = pickFile(
      entry.torrent.files,
      Number.isInteger(index) && index >= 0 ? index : undefined,
    );
    const file = entry.torrent.files[at];
    if (!file) return refuse(res, 404);
    entry.used = Date.now();
    const range = parseRange(req.headers.range, file.length);
    if (range === "invalid") {
      res.writeHead(416, { "Content-Range": `bytes */${file.length}` });
      return res.end();
    }
    const start = range ? range.start : 0;
    const end = range ? range.end : file.length - 1;
    const headers = {
      "Accept-Ranges": "bytes",
      "Content-Type": typeOf(file.name),
      "Content-Length": String(end - start + 1),
      "Cache-Control": "no-store",
    };
    if (range)
      headers["Content-Range"] = `bytes ${start}-${end}/${file.length}`;
    res.writeHead(range ? 206 : 200, headers);
    if (req.method === "HEAD" || file.length === 0) return res.end();
    const reader = file.createReadStream({ start, end });
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      reader.destroy?.();
    };
    reader.on("data", (chunk) => {
      if (!res.write(chunk)) {
        reader.pause();
        res.once("drain", () => reader.resume());
      }
    });
    reader.on("end", () => {
      done = true;
      res.end();
    });
    reader.on("error", () => {
      finish();
      res.destroy();
    });
    res.on("close", finish);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  await prune();

  return {
    origin,
    /** The address MPV plays for this stream; the torrent starts now. */
    url(stream) {
      if (closed) throw new Error("محرك التورنت متوقف");
      if (!validHash(stream?.infoHash))
        throw new Error("معرّف التورنت غير صالح");
      const entry = ensure(stream);
      const index =
        Number.isInteger(stream.fileIdx) && stream.fileIdx >= 0
          ? stream.fileIdx
          : -1;
      return `${origin}/${token}/${entry.hash}/${index}`;
    },
    /** The viewing ended: kept a few minutes, then destroyed. */
    release(hash) {
      const entry = entries.get(String(hash || "").toLowerCase());
      if (!entry || entry.timer) return false;
      entry.timer = setTimeout(() => remove(entry.hash), graceMs);
      entry.timer.unref?.();
      return true;
    },
    /** One torrent's start: metadata, peers, speed and bytes so far. */
    status(hash) {
      const torrent = entries.get(String(hash || "").toLowerCase())?.torrent;
      if (!torrent) return null;
      return {
        metadata: !!torrent.ready,
        peers: torrent.numPeers || 0,
        down: torrent.downloadSpeed || 0,
        bytes: torrent.downloaded || 0,
      };
    },
    /** For tests: a known peer, when there is no DHT or tracker. */
    addPeer(hash, address) {
      const torrent = entries.get(String(hash || "").toLowerCase())?.torrent;
      if (!torrent) return;
      // WebTorrent takes peers only once it has read the info hash.
      if (torrent.infoHash && torrent.discovery) torrent.addPeer(address);
      else torrent.once("infoHash", () => torrent.addPeer(address));
    },
    configure(next = {}) {
      if (next.downloadLimit !== undefined)
        client.throttleDownload(next.downloadLimit);
      if (next.uploadLimit !== undefined)
        client.throttleUpload(next.uploadLimit);
      if (next.maxConns) client.maxConns = next.maxConns;
      if (next.cacheBytes !== undefined) {
        cap = Math.max(0, Number(next.cacheBytes) || 0);
        return prune().then(() => true);
      }
      return true;
    },
    async stats() {
      let peers = 0;
      for (const entry of entries.values())
        peers += entry.torrent.numPeers || 0;
      return {
        running: true,
        torrents: entries.size,
        peers,
        down: client.downloadSpeed || 0,
        up: client.uploadSpeed || 0,
        cache: await folderBytes(cacheDir),
      };
    },
    /** Removes every title not being watched, and its pieces. */
    async clear() {
      for (const entry of [...entries.values()])
        if (entry.timer) await remove(entry.hash);
      const saved = cap;
      cap = 0;
      await prune();
      cap = saved;
      return true;
    },
    async close() {
      if (closed) return true;
      closed = true;
      for (const entry of entries.values()) clearTimeout(entry.timer);
      const closing = new Promise((resolve) => server.close(() => resolve()));
      server.closeAllConnections?.();
      await closing;
      await new Promise((resolve) => client.destroy(() => resolve()));
      entries.clear();
      await prune();
      return true;
    },
  };
}
