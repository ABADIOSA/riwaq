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
 * - With "incoming peers" on (the default since 0.46, as in Harbor), the
 *   router opens the engine's peer port through UPnP or NAT-PMP, so peers
 *   behind their own routers can reach it; the HTTP server stays on
 *   127.0.0.1. Local peer discovery stays off: Riwaq never announces itself
 *   on the LAN.
 * - Every torrent also announces to public trackers (HTTPS ones too, for
 *   networks that block UDP), joins the DHT through six routers and the
 *   nodes saved from the last run, and asks again every 30 s while it has
 *   few peers (core/torrent-engine.mjs).
 * - Peers connect over TCP; uTP is off (see below).
 * - With "delete after viewing" (the default), a released title goes a few
 *   seconds after its last reader closed, with its pieces, and starting
 *   another title sweeps any that are left (issue #138). With a cache size
 *   it is kept a few minutes (a replay or a failover back finds it), then
 *   destroyed; its pieces stay only within the cache size.
 * - On Windows, piece files are marked sparse before WebTorrent writes into
 *   them, so a read near the end of a film does not make NTFS allocate the
 *   whole file on disk (issue #138).
 */
import { createServer } from "node:http";
import { createSocket } from "node:dgram";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { constants, lstatSync } from "node:fs";
import {
  mkdir,
  lstat,
  open as openFile,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import {
  DHT_BOOTSTRAP,
  FEW_PEERS,
  PUBLIC_TRACKERS,
  REANNOUNCE_MS,
  cachePrune,
  cleanDhtNodes,
  cleanTorrentPath,
  magnetOf,
  parseRange,
  pickFile,
  trackersOf,
  validHash,
} from "../core/torrent-engine.mjs";

const READY_MS = 45000;
// With a cache size: a replay or a failover back within minutes finds it.
const GRACE_MS = 3 * 60 * 1000;
// "Delete after viewing" (issue #138): the pieces go seconds after the last
// reader closed. A few seconds cover MPV's reconnects and the gap between
// one start and the next of the same title.
const VIEWING_GRACE_MS = 5000;
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

/**
 * Marks a file sparse on Windows (FSCTL_SET_SPARSE through the
 * fs-native-extensions binding random-access-file already ships; a no-op
 * elsewhere). WebTorrent writes the pieces MPV reads at their offsets; on a
 * plain NTFS file a write near the end allocates everything before it, so
 * one look at a film's index reserved its whole size on disk. A failure (a
 * FAT drive, a missing binding) leaves an ordinary file, never a failed
 * stream.
 */
let nativeFs;
function nativeExtensions() {
  if (nativeFs === undefined) {
    try {
      nativeFs = createRequire(import.meta.url)("fs-native-extensions");
    } catch {
      nativeFs = null;
    }
  }
  return nativeFs;
}
export async function markSparse(path, extensions = nativeExtensions()) {
  if (!extensions?.sparse) return false;
  let handle;
  try {
    // Read and write without truncating: the file may hold pieces already.
    handle = await openFile(path, constants.O_RDWR | constants.O_CREAT);
    await extensions.sparse(handle.fd);
    return true;
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => {});
  }
}
/**
 * fs-chunk-store with each file marked sparse before its first use.
 * `FSChunkStore` is WebTorrent's own store class (null: WebTorrent's
 * default store is used unchanged).
 */
function sparseStore(FSChunkStore, mark) {
  if (!FSChunkStore) return null;
  return class SparseChunkStore extends FSChunkStore {
    constructor(chunkLength, opts) {
      super(chunkLength, opts);
      for (const file of this.files || []) {
        const open = file.open;
        let opening = null;
        file.open = (cb) => {
          opening ||= new Promise((resolve) =>
            open((error, raf) => {
              if (error) return resolve({ error });
              mark(file.path).then(
                () => resolve({ raf }),
                () => resolve({ raf }),
              );
            }),
          );
          opening.then(({ error, raf }) => cb(error || null, raf));
        };
      }
    }
  };
}

/** A UDP tracker answers BEP 15's connect request: UDP leaves this network. */
function udpReachable(host, port, ms = 5000) {
  return new Promise((resolve) => {
    const socket = createSocket("udp4");
    const done = (ok) => {
      clearTimeout(timer);
      try {
        socket.close();
      } catch {}
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), ms);
    const request = Buffer.alloc(16);
    request.writeBigUInt64BE(0x41727101980n, 0);
    request.writeUInt32BE(0, 8);
    const id = randomBytes(4);
    id.copy(request, 12);
    socket.on("message", (reply) =>
      done(reply.length >= 16 && reply.subarray(4, 8).equals(id)),
    );
    socket.on("error", () => done(false));
    socket.send(request, port, host, (error) => error && done(false));
  });
}

/** Any HTTPS tracker answers at all (a status of any kind counts). */
async function httpsReachable(urls, ms = 6000) {
  for (const url of urls) {
    try {
      await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(ms),
      });
      return true;
    } catch {}
  }
  return false;
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
  viewingGraceMs = VIEWING_GRACE_MS,
  sparse = markSparse,
  readyMs = READY_MS,
  reannounceMs = REANNOUNCE_MS,
  log = () => {},
} = {}) {
  if (!cacheDir) throw new Error("مجلد ذاكرة التورنت غير محدد");
  WebTorrent ||= (await import("webtorrent")).default;
  // WebTorrent's own file store, extended to mark files sparse.
  const store = sparseStore(
    await import("fs-chunk-store").then(
      (module) => module.default,
      () => null,
    ),
    sparse,
  );
  await mkdir(cacheDir, { recursive: true });
  // Startup may have skipped this root because it is a junction. The
  // engine must not follow it later when pruning or creating pieces.
  const rootInfo = await lstat(cacheDir);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
    throw new Error("مجلد ذاكرة التورنت ليس مجلداً آمناً");
  // The DHT starts warm from the nodes it knew when the engine last closed.
  const nodesFile = join(cacheDir, ".dht-nodes.json");
  const saved = cleanDhtNodes(
    await readFile(nodesFile, "utf8")
      .then((text) => (text.length <= 65536 ? JSON.parse(text) : []))
      .catch(() => []),
  );
  const useDht = network.dht ?? true;
  const useTrackers = network.tracker ?? true;
  // Tests keep a local tracker without asking the public ones.
  const extraTrackers = useTrackers && (network.publicTrackers ?? true);
  // Incoming peers through a port the router opens; tests pass no options.
  const incoming = network.natUpnp ?? options.incoming === true;
  const client = new WebTorrent({
    maxConns: options.maxConns || 55,
    downloadLimit: options.downloadLimit ?? -1,
    uploadLimit: options.uploadLimit ?? -1,
    dht: useDht
      ? {
          bootstrap: [
            ...saved.slice(0, 100).map(({ host, port }) => `${host}:${port}`),
            ...DHT_BOOTSTRAP,
          ],
        }
      : false,
    tracker: useTrackers,
    // uTP (utp-native) stalled every connection about 40 s before TCP took
    // over in Riwaq's measurements; TCP alone streams at full speed. Nuvio
    // HTPC measured the same and keeps outgoing connections on TCP too.
    utp: network.utp ?? false,
    lsd: false,
    natUpnp: incoming,
    natPmp: incoming,
  });
  async function saveNodes() {
    const nodes = cleanDhtNodes(client.dht?.toJSON?.().nodes);
    if (nodes.length)
      await writeFile(nodesFile, JSON.stringify(nodes)).catch(() => {});
  }
  // A crash keeps the nodes of the last ten minutes too.
  const nodesTimer = setInterval(() => void saveNodes(), 10 * 60 * 1000);
  nodesTimer.unref?.();
  client.on("error", (error) => log(error));
  let cap = Math.max(0, Number(options.cacheBytes) || 0);
  const token = randomBytes(16).toString("hex");
  const entries = new Map();
  // Titles being destroyed: a new start of the same title waits for it.
  const removing = new Map();
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
      const info = await lstat(path).catch(() => null);
      if (!info?.isDirectory() || info.isSymbolicLink()) continue;
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
      entry.released = false;
      entry.used = Date.now();
      return entry;
    }
    const own = trackersOf(stream);
    // A retained hash folder is untrusted filesystem input too. Refuse
    // a link before WebTorrent can write pieces through it.
    const piecePath = join(cacheDir, hash);
    try {
      const info = lstatSync(piecePath);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error("مجلد ذاكرة التورنت ليس مجلداً آمناً");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const torrent = client.add(magnetOf(stream), {
      path: piecePath,
      ...(store ? { store } : {}),
      deselect: true,
      strategy: "sequential",
      ...(extraTrackers
        ? { announce: PUBLIC_TRACKERS.filter((t) => !own.includes(t)) }
        : {}),
    });
    const ready = new Promise((resolve, reject) => {
      torrent.once("ready", resolve);
      torrent.once("error", reject);
    });
    ready.catch(() => {});
    torrent.on("error", (error) => log(error));
    // A sparse swarm is asked again every 30 s until it has enough peers.
    const boost = setInterval(() => {
      if (torrent.destroyed || torrent.done) return;
      if ((torrent.numPeers || 0) >= FEW_PEERS) return;
      try {
        torrent.discovery?.tracker?.update?.();
      } catch {}
      try {
        if (client.dht && torrent.infoHash) client.dht.lookup(torrent.infoHash);
      } catch {}
    }, reannounceMs);
    boost.unref?.();
    entry = {
      hash,
      torrent,
      ready,
      used: Date.now(),
      timer: null,
      boost,
      released: false,
      // Open HTTP responses: MPV, or another player given the copied link.
      readers: 0,
    };
    entries.set(hash, entry);
    // "Delete after viewing": a new title sweeps what earlier viewings left
    // (released, nobody reading), never the one starting now.
    if (cap === 0) {
      for (const other of [...entries.values()])
        if (other !== entry && other.released && other.readers === 0)
          void remove(other.hash);
      void prune().catch(() => {});
    }
    return entry;
  }

  /** A released title goes after its grace, once nobody reads it. */
  function schedule(entry) {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(
      () => {
        entry.timer = null;
        // The last reader to close schedules it again.
        if (entry.readers > 0 || entries.get(entry.hash) !== entry) return;
        void remove(entry.hash);
      },
      cap === 0 ? viewingGraceMs : graceMs,
    );
    entry.timer.unref?.();
  }

  async function remove(hash) {
    const entry = entries.get(hash);
    if (!entry) return removing.get(hash);
    entries.delete(hash);
    clearTimeout(entry.timer);
    clearInterval(entry.boost);
    const done = (async () => {
      // A destroy that never calls back must not keep its pieces on disk.
      await timeout(
        new Promise((resolve) =>
          entry.torrent.destroy({ destroyStore: cap === 0 }, () => resolve()),
        ),
        10000,
      ).catch(() => {});
      await prune().catch(() => {});
    })();
    removing.set(hash, done);
    try {
      await done;
    } finally {
      if (removing.get(hash) === done) removing.delete(hash);
    }
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
    let parts, named;
    try {
      const address = new URL(req.url, "http://127.0.0.1");
      parts = address.pathname.split("/").filter(Boolean);
      named = cleanTorrentPath(address.searchParams.get("f") || "");
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
      named,
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
    // A reader holds its title: a released one goes after the last closes.
    entry.readers++;
    let counted = true;
    const uncount = () => {
      if (!counted) return;
      counted = false;
      entry.readers--;
      entry.used = Date.now();
      if (
        entry.released &&
        entry.readers === 0 &&
        !entry.timer &&
        entries.get(entry.hash) === entry
      )
        schedule(entry);
    };
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
    res.on("close", () => {
      finish();
      uncount();
    });
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
      // The same title being destroyed right now: start it again after.
      const going = removing.get(stream.infoHash.toLowerCase());
      if (going) return going.then(() => this.url(stream));
      const entry = ensure(stream);
      const index =
        Number.isInteger(stream.fileIdx) && stream.fileIdx >= 0
          ? stream.fileIdx
          : -1;
      // Without an index, the addon's file name picks the file (a pack).
      const named = index < 0 ? cleanTorrentPath(stream.filename) : "";
      return `${origin}/${token}/${entry.hash}/${index}${named ? `?f=${encodeURIComponent(named)}` : ""}`;
    },
    /**
     * The viewing ended. "Delete after viewing": destroyed with its pieces
     * seconds after its last reader closed; with a cache size, kept a few
     * minutes first.
     */
    release(hash) {
      const entry = entries.get(String(hash || "").toLowerCase());
      if (!entry || entry.released) return false;
      entry.released = true;
      if (entry.readers === 0) schedule(entry);
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
    /**
     * A torrent's files in its own order (paths and sizes), once its
     * metadata came: TorrServer's fallback finds the addon's file by it.
     */
    files(hash) {
      const torrent = entries.get(String(hash || "").toLowerCase())?.torrent;
      if (!torrent?.ready || !Array.isArray(torrent.files)) return null;
      return torrent.files.map((file) => ({
        path: String(file.path || file.name || ""),
        length: Number(file.length) || 0,
      }));
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
    /**
     * What the network lets through, for the P2P page: DHT nodes, UDP to a
     * tracker, HTTPS to a tracker, and whether incoming peers are on.
     */
    async netcheck() {
      const [udp, https] = await Promise.all([
        extraTrackers ? udpReachable("tracker.opentrackr.org", 1337) : false,
        extraTrackers
          ? httpsReachable(
              PUBLIC_TRACKERS.filter((t) => t.startsWith("https:")).slice(0, 3),
            )
          : false,
      ]);
      return {
        dhtNodes: client.dht ? client.dht.toJSON().nodes.length : 0,
        udp,
        https,
        incoming,
      };
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
        if (entry.released && entry.readers === 0) await remove(entry.hash);
      const saved = cap;
      cap = 0;
      await prune();
      cap = saved;
      return true;
    },
    async close() {
      if (closed) return true;
      closed = true;
      clearInterval(nodesTimer);
      for (const entry of entries.values()) {
        clearTimeout(entry.timer);
        clearInterval(entry.boost);
      }
      await saveNodes();
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
