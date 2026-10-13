/**
 * Torrent playback without Stremio's own server (issue #74). Stremio's
 * server.js is proprietary and "not meant to be used / distributed outside
 * of an official Stremio app" (Stremio/stremio-shell#435), so Riwaq offers
 * two ways instead: the viewer's own Stremio Service, as before, or a
 * built-in engine (WebTorrent, MIT) that runs only after the viewer chooses
 * it. These are the pure rules both sides share; the engine itself is
 * electron/torrent-engine.mjs. Browser-safe.
 */

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

/**
 * The file to play: the addon's file index when it is one of the torrent's
 * files, otherwise the largest video, otherwise the largest file.
 */
export function pickFile(files = [], fileIdx) {
  if (
    Number.isInteger(fileIdx) &&
    fileIdx >= 0 &&
    fileIdx < files.length &&
    files[fileIdx]
  )
    return fileIdx;
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
