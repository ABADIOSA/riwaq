/**
 * Torrent playback without Stremio's own server (issue #74). Stremio's
 * server.js is proprietary and "not meant to be used / distributed outside
 * of an official Stremio app" (Stremio/stremio-shell#435), so Riwaq offers
 * two ways instead: the viewer's own Stremio Service, as before, or a
 * built-in engine (WebTorrent, MIT) that runs only after the viewer chooses
 * it. These are the pure rules both sides share; the engine itself is
 * electron/torrent-engine.mjs. Browser-safe.
 */

import { PEERS, arabicCount } from "./arabic.mjs";

const KIB = 1024;
const MIB = 1024 * KIB;
const GIB = 1024 * MIB;

/**
 * Which engine plays torrents:
 * - ask (the default): Stremio Service when it answers, otherwise the
 *   viewer is asked (the setup guide offers both);
 * - auto: Stremio Service when it answers, otherwise the built-in engine;
 * - builtin: always the built-in engine.
 */
export const TORRENT_ENGINES = ["ask", "auto", "builtin"];

/** Connections and download speed, from gentle to fast. -1 is no limit. */
export const ENGINE_PROFILES = {
  gentle: { maxConns: 35, downloadLimit: Math.round(1.6 * MIB) },
  balanced: { maxConns: 55, downloadLimit: -1 },
  fast: { maxConns: 150, downloadLimit: -1 },
};
export const ENGINE_PROFILE_IDS = Object.keys(ENGINE_PROFILES);

/** Upload while watching (BitTorrent always shares the pieces it has). */
export const UPLOAD_LIMITS = { normal: -1, low: 256 * KIB, minimal: 32 * KIB };
export const UPLOAD_LIMIT_IDS = Object.keys(UPLOAD_LIMITS);

/**
 * What stays on disk: "viewing" deletes a title's pieces when its viewing
 * ends; a size keeps the most recent titles up to that many gigabytes.
 */
export const ENGINE_CACHES = ["viewing", "2", "5", "10"];
export const cacheBytes = (choice) =>
  choice === "viewing" || !ENGINE_CACHES.includes(choice)
    ? 0
    : Number(choice) * GIB;

/**
 * The sentence a torrent source gives when no engine can play it. Main and
 * the web bridge throw it; the main window recognises it and opens the setup
 * guide, and anywhere else (the HUD) it reads as an instruction.
 */
export const NEEDS_ENGINE =
  "مصادر التورنت تحتاج محرك تورنت: فعّل المحرك المدمج أو شغّل Stremio Service من الإعدادات ← محرك P2P.";

/** Stremio Service's official releases (Stremio's own GitHub organisation). */
export const SERVICE_DOWNLOAD =
  "https://github.com/Stremio/stremio-service/releases/latest";

/** Which engine plays this torrent: "service", "builtin", or "ask". */
export function chooseEngine(setting, serviceUp) {
  const choice = TORRENT_ENGINES.includes(setting) ? setting : "ask";
  if (choice === "builtin") return "builtin";
  if (serviceUp) return "service";
  return choice === "auto" ? "builtin" : "ask";
}

/**
 * Public trackers every built-in torrent announces to besides the addon's,
 * as Harbor and Nuvio HTPC do (docs/REFERENCE-REVIEW.md). The HTTPS ones
 * still find peers on a network that blocks UDP, and with it the DHT and
 * the UDP trackers.
 */
export const PUBLIC_TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.demonii.com:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://explodie.org:6969/announce",
  "udp://tracker.dler.org:6969/announce",
  "udp://tracker.qu.ax:6969/announce",
  "http://tracker.opentrackr.org:1337/announce",
  "http://tracker.bt4g.com:2095/announce",
  "https://tracker.zhuqiy.com:443/announce",
  "https://tracker.yemekyedim.com:443/announce",
  "https://tracker.pmman.tech:443/announce",
  "https://tracker.gcrenwp.top:443/announce",
  "https://tr.nyacat.pw:443/announce",
  "https://tracker.leechshield.link:443/announce",
];

/** DHT routers to join through; bittorrent-dht itself knows three. */
export const DHT_BOOTSTRAP = [
  "router.bittorrent.com:6881",
  "router.utorrent.com:6881",
  "dht.transmissionbt.com:6881",
  "dht.libtorrent.org:25401",
  "dht.aelitis.com:6881",
  "router.bitcomet.com:6881",
];

/**
 * While a torrent has fewer peers than FEW_PEERS, the engine asks its
 * trackers and the DHT again every REANNOUNCE_MS (Nuvio HTPC measured that
 * sparse swarms otherwise die before they are asked again).
 */
export const FEW_PEERS = 40;
export const REANNOUNCE_MS = 30 * 1000;

const IPV4 =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
/**
 * DHT nodes saved from the last run, so the next one starts warm: IPv4
 * addresses and ports only, no duplicates, at most 200.
 */
export function cleanDhtNodes(list) {
  const out = [];
  const seen = new Set();
  for (const node of Array.isArray(list) ? list : []) {
    const host = typeof node?.host === "string" ? node.host : "";
    const port = Number(node?.port);
    if (!IPV4.test(host) || !Number.isInteger(port) || port < 1 || port > 65535)
      continue;
    const key = `${host}:${port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ host, port });
    if (out.length >= 200) break;
  }
  return out;
}

/** The engine's options from the viewer's settings. */
export function engineOptions(settings = {}) {
  const profile =
    ENGINE_PROFILES[settings.torrentProfile] || ENGINE_PROFILES.balanced;
  const upload = UPLOAD_LIMITS[settings.torrentUpload] ?? UPLOAD_LIMITS.normal;
  // WebTorrent takes whole bytes per second only.
  return {
    maxConns: profile.maxConns,
    downloadLimit: Math.round(profile.downloadLimit),
    uploadLimit: Math.round(upload),
    cacheBytes: cacheBytes(settings.torrentCache),
    // Peers may connect in through a port the router opens (UPnP/NAT-PMP).
    incoming: settings.torrentIncoming !== false,
  };
}

const HASH = /^[a-f\d]{40}$/i;
export const validHash = (value) =>
  typeof value === "string" && HASH.test(value);

/**
 * Trackers an addon lists for a torrent ("tracker:udp://…"). DHT entries
 * ("dht:…") need nothing: the engine always asks the DHT.
 */
export function trackersOf(stream) {
  const out = [];
  for (const source of Array.isArray(stream?.sources) ? stream.sources : []) {
    if (typeof source !== "string" || source.length > 300) continue;
    const tracker = source.replace(/^tracker:/, "");
    if (
      /^(udp|https?|wss?):\/\/[^\s]+$/i.test(tracker) &&
      !out.includes(tracker)
    )
      out.push(tracker);
    if (out.length >= 30) break;
  }
  return out;
}

/** The magnet address the engine adds: the info hash and its trackers. */
export function magnetOf(stream) {
  if (!validHash(stream?.infoHash)) throw new Error("معرّف التورنت غير صالح");
  const params = [`xt=urn:btih:${stream.infoHash.toLowerCase()}`];
  for (const tracker of trackersOf(stream))
    params.push(`tr=${encodeURIComponent(tracker)}`);
  return `magnet:?${params.join("&")}`;
}

const VIDEO = /\.(mkv|mp4|m4v|avi|mov|wmv|webm|ts|m2ts|mpg|mpeg|flv|ogv)$/i;

/** A file's own name from an addon's behaviorHints.filename, or "". */
export function cleanFilename(name) {
  if (typeof name !== "string") return "";
  const base = name.split(/[\\/]/).pop().trim();
  return base.length <= 255 && !/[\u0000-\u001f\u007f]/.test(base) ? base : "";
}
/** A matching hint only, never a filesystem path to open or write. */
export function cleanTorrentPath(name) {
  if (
    typeof name !== "string" ||
    name.length > 2048 ||
    /[\u0000-\u001f\u007f]/.test(name)
  )
    return "";
  return name.trim().replace(/\\/g, "/").replace(/^\/+/, "");
}
/** One unambiguous path/name match, or -1. Never pick the first duplicate. */
export function namedFile(files, filename) {
  const wanted = cleanTorrentPath(filename).toLowerCase();
  if (!wanted) return -1;
  const paths = files.map((file) =>
    cleanTorrentPath(file?.path || file?.name).toLowerCase(),
  );
  const exact = paths
    .map((path, i) => (path === wanted || path.endsWith("/" + wanted) ? i : -1))
    .filter((i) => i >= 0);
  if (exact.length) return exact.length === 1 ? exact[0] : -1;
  const base = cleanFilename(wanted).toLowerCase();
  const same = paths
    .map((path, i) => (cleanFilename(path).toLowerCase() === base ? i : -1))
    .filter((i) => i >= 0);
  return same.length === 1 ? same[0] : -1;
}

/**
 * The torrent's only video file, or -1. A name that matches nothing cannot
 * choose between a pack's episodes, but a film with an .nfo or a subtitle
 * beside it has nothing to choose: 0.45 played it whatever the addon called
 * it (some addons send the release name without its extension).
 */
export function soleVideo(files = []) {
  const videos = files.flatMap((file, i) =>
    VIDEO.test(file?.name || file?.path || "") ? [i] : [],
  );
  return videos.length === 1 ? videos[0] : -1;
}

/**
 * The file to play: the addon's file index when it is one of the torrent's
 * files; otherwise the one file the addon names (behaviorHints.filename, a
 * path or a name, so a season pack plays the right episode), or the only
 * video when that name matches nothing, never a guess between episodes;
 * without a name, the largest video, otherwise the largest file.
 */
export function pickFile(files = [], fileIdx, filename = "") {
  if (
    Number.isInteger(fileIdx) &&
    fileIdx >= 0 &&
    fileIdx < files.length &&
    files[fileIdx]
  )
    return fileIdx;
  const wanted = cleanTorrentPath(filename);
  if (wanted) {
    const named = namedFile(files, wanted);
    return named >= 0 ? named : soleVideo(files);
  }
  let best = -1;
  for (const pass of [true, false]) {
    files.forEach((file, i) => {
      if (pass && !VIDEO.test(file?.name || "")) return;
      if (best < 0 || (file?.length || 0) > (files[best]?.length || 0))
        best = i;
    });
    if (best >= 0) return best;
  }
  return -1;
}

/**
 * One byte range from a Range header: {start, end}, null when there is no
 * header (the whole file), or "invalid" for one that cannot be served (416).
 */
export function parseRange(header, size) {
  if (header == null || header === "") return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m || (m[1] === "" && m[2] === "") || !(size > 0)) return "invalid";
  let start;
  let end;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (!(suffix > 0)) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!(start >= 0) || start > end || start >= size) return "invalid";
  return { start, end };
}

/**
 * Folders to remove so the cache fits: empty ones, then the oldest, never
 * one in use. `entries` are {name, bytes, used} (used: last use time).
 */
export function cachePrune(entries = [], cap = 0, active = []) {
  const keep = new Set(active);
  const candidates = entries
    .filter((e) => !keep.has(e.name))
    .sort((a, b) => a.used - b.used);
  let total = entries.reduce((sum, e) => sum + (e.bytes || 0), 0);
  // A destroyed title can leave its folder behind, empty.
  const remove = candidates.filter((e) => !e.bytes).map((e) => e.name);
  for (const entry of candidates) {
    if (total <= cap) break;
    if (!entry.bytes) continue;
    remove.push(entry.name);
    total -= entry.bytes;
  }
  return remove;
}

/** What the interface may see of the engine: counts and speeds only. */
export function publicStats(stats) {
  if (!stats || typeof stats !== "object") return { running: false };
  const n = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0);
  return {
    running: !!stats.running,
    torrents: n(stats.torrents),
    peers: n(stats.peers),
    down: n(stats.down),
    up: n(stats.up),
    cache: n(stats.cache),
  };
}

/**
 * A built-in torrent that has not started after this long, with no data at
 * all, is dead for now: no peers answered, or none of them has the file.
 * Reconnecting to the same swarm does not help, so the next source plays
 * (issue #82: a dead torrent used to leave "Getting the viewing ready" on a
 * black screen for minutes).
 */
export const TORRENT_DEAD_MS = 40000;

/** One torrent's start, as the interface may see it: counts and speed only. */
export function startStatus(status) {
  if (!status || typeof status !== "object") return null;
  const n = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0);
  return {
    metadata: !!status.metadata,
    peers: Math.round(n(status.peers)),
    down: n(status.down),
    bytes: n(status.bytes),
  };
}

/** Whether a torrent that is still starting should give way to the next source. */
export function torrentDead(status, elapsed) {
  const s = startStatus(status);
  if (!s || !(elapsed >= TORRENT_DEAD_MS)) return false;
  return s.bytes === 0;
}

/**
 * The line under "Getting the viewing ready" while a built-in torrent
 * starts, so a slow or empty swarm reads as what it is.
 */
export function startLine(status) {
  const s = startStatus(status);
  if (!s) return "";
  const peers = arabicCount(s.peers, PEERS);
  if (!s.metadata)
    return s.peers
      ? `نجلب معلومات التورنت · ${peers}`
      : "نبحث عن مشاركين في التورنت…";
  if (!s.down) return `${peers} · ننتظر أول البيانات…`;
  return `${peers} · ${(s.down / MIB).toFixed(1)} م.ب/ث`;
}
