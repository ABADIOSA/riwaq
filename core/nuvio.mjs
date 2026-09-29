/**
 * Bringing a viewer's Nuvio setup into Riwaq.
 *
 * Nuvio Desktop keeps each profile's addons, collections, plugin
 * repositories and library in Java `.properties` stores in its data folder
 * (NuvioHTPC in Local AppData, or Nuvio in Roaming AppData for the upstream
 * desktop app). Its settings backup is a zip of the same stores. Both hold
 * what the viewer's Nuvio account synced to that PC, so Riwaq reads them
 * directly: no Nuvio password, no Nuvio server.
 *
 * Nuvio plugins are JavaScript scrapers. Riwaq imports the repository list
 * (name, address, scraper count) and never keeps or runs the scraper code.
 *
 * Main-only for the zip reader (node:zlib); the parsers are pure.
 */

import { inflateRawSync } from "node:zlib";
import { cleanMedia } from "./library.mjs";
import { fromNuvio } from "./collections.mjs";

/** The Nuvio stores Riwaq reads; nothing else in the folder is opened. */
export const NUVIO_STORES = [
  "nuvio_profiles",
  "nuvio_addons",
  "nuvio_collections",
  "nuvio_plugins",
  // Read only for the TMDB key, and only imported when the viewer asks.
  "nuvio_tmdb_settings",
  "nuvio_library",
];
const MAX_STORE = 40 * 1024 * 1024;

/**
 * java.util.Properties text (as written by Properties.store: ISO-8859-1 with
 * \uXXXX escapes) into a plain object.
 */
export function parseProperties(text) {
  const out = Object.create(null);
  const lines = String(text ?? "").split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    let raw = lines[i].replace(/^[ \t\f]+/, "");
    if (!raw || raw[0] === "#" || raw[0] === "!") continue;
    // A line ending in an odd number of backslashes continues on the next.
    while (/(^|[^\\])(\\\\)*\\$/.test(raw) && i + 1 < lines.length)
      raw = raw.slice(0, -1) + lines[++i].replace(/^[ \t\f]+/, "");
    let key = "";
    let j = 0;
    for (; j < raw.length; j++) {
      const ch = raw[j];
      if (ch === "\\") {
        key += raw[j] + (raw[j + 1] ?? "");
        j++;
        continue;
      }
      if (ch === "=" || ch === ":" || ch === " " || ch === "\t" || ch === "\f")
        break;
      key += ch;
    }
    let rest = raw.slice(j).replace(/^[ \t\f]*/, "");
    if (rest[0] === "=" || rest[0] === ":")
      rest = rest.slice(1).replace(/^[ \t\f]*/, "");
    out[unescape(key)] = unescape(rest);
  }
  return out;
}
function unescape(value) {
  return value.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, e) => {
    if (e[0] === "u" && e.length === 5)
      return String.fromCharCode(parseInt(e.slice(1), 16));
    return { t: "\t", n: "\n", r: "\r", f: "\f" }[e] ?? e;
  });
}

/**
 * The `preferences/*.properties` entries of a Nuvio settings backup zip.
 * Only stored and deflated entries of the known stores are read, each capped
 * in size; anything else in the archive is ignored.
 */
export function readNuvioZip(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new Error("ملف نسخة نوفيو ليس ملف zip صالحاً");
  const count = buf.readUInt16LE(end + 10);
  let offset = buf.readUInt32LE(end + 16);
  const stores = {};
  for (let n = 0; n < Math.min(count, 500); n++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50)
      break;
    const method = buf.readUInt16LE(offset + 10);
    const compressed = buf.readUInt32LE(offset + 20);
    const size = buf.readUInt32LE(offset + 24);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const local = buf.readUInt32LE(offset + 42);
    const name = buf.toString("utf8", offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    const store = name.match(/^(?:preferences\/)?([\w]+)\.properties$/)?.[1];
    if (!store || !NUVIO_STORES.includes(store)) continue;
    if (size > MAX_STORE || compressed > MAX_STORE) continue;
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50)
      continue;
    const start =
      local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + compressed);
    let bytes;
    if (method === 0) bytes = data;
    else if (method === 8)
      bytes = inflateRawSync(data, { maxOutputLength: MAX_STORE });
    else continue;
    stores[store] = parseProperties(bytes.toString("latin1"));
  }
  if (!Object.keys(stores).length)
    throw new Error("لم نجد بيانات نوفيو في هذا الملف");
  return stores;
}

const json = (value) => {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};
const addonUrl = (value) => {
  if (typeof value !== "string" || value.length > 4000) return "";
  try {
    const url = new URL(value.trim());
    if (!["https:", "http:"].includes(url.protocol)) return "";
    if (!/\/manifest\.json$/.test(url.pathname))
      url.pathname = url.pathname.replace(/\/?$/, "/manifest.json");
    return url.toString();
  } catch {
    return "";
  }
};

/** Every Nuvio profile index the stores mention, with its name when known. */
function profilesOf(stores) {
  const found = new Map();
  const payload = json(stores.nuvio_profiles?.profiles);
  for (const p of Array.isArray(payload?.profiles) ? payload.profiles : []) {
    const index = Number(p?.profile_index ?? p?.profileIndex);
    if (Number.isInteger(index) && index > 0 && index < 100)
      found.set(index, String(p?.name || "").slice(0, 40));
  }
  const patterns = [
    [stores.nuvio_addons, /^installed_addon_urls_(\d+)$/],
    [stores.nuvio_collections, /^collections_(\d+)$/],
    [stores.nuvio_plugins, /^plugins_state_(\d+)$/],
    [stores.nuvio_library, /^library_(\d+)$/],
  ];
  for (const [store, pattern] of patterns)
    for (const key of Object.keys(store || {})) {
      const index = Number(key.match(pattern)?.[1]);
      if (
        Number.isInteger(index) &&
        index > 0 &&
        index < 100 &&
        !found.has(index)
      )
        found.set(index, "");
    }
  return [...found.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, name]) => ({ index, name: name || `الملف ${index}` }));
}

/**
 * What one Nuvio profile holds, cleaned: addon manifest URLs with their
 * enabled state, collections converted to Riwaq's shape, plugin repositories
 * without their code, and library titles.
 */
export function nuvioProfile(stores, index) {
  const addons = [];
  const urls = json(stores.nuvio_addons?.[`installed_addon_urls_${index}`]);
  const states = json(stores.nuvio_addons?.[`addon_enabled_states_${index}`]);
  for (const value of Array.isArray(urls) ? urls.slice(0, 200) : []) {
    const url = addonUrl(value);
    if (!url || addons.some((a) => a.url === url)) continue;
    const enabled = states && typeof states === "object" ? states[value] : true;
    addons.push({ url, enabled: enabled !== false });
  }
  let collections = { collections: [], folders: 0, skipped: 0 };
  const rawCollections = stores.nuvio_collections?.[`collections_${index}`];
  if (rawCollections) {
    try {
      collections = fromNuvio(rawCollections);
    } catch {
      /* An unreadable collections store is reported as empty. */
    }
  }
  const plugins = [];
  const pluginState = json(stores.nuvio_plugins?.[`plugins_state_${index}`]);
  for (const repo of Array.isArray(pluginState?.repositories)
    ? pluginState.repositories.slice(0, 100)
    : []) {
    const url = addonUrl(repo?.manifestUrl);
    if (!url || plugins.some((p) => p.url === url)) continue;
    plugins.push({
      url,
      name: String(repo?.name || new URL(url).host).slice(0, 80),
      scrapers: Math.max(0, Math.min(10000, Number(repo?.scraperCount) || 0)),
    });
  }
  const library = [];
  const libraryPayload = json(stores.nuvio_library?.[`library_${index}`]);
  for (const item of Array.isArray(libraryPayload?.items)
    ? libraryPayload.items.slice(0, 5000)
    : []) {
    try {
      const media = cleanMedia({
        id: item?.id,
        type: item?.type,
        name: item?.name,
        poster: item?.poster,
        releaseInfo: item?.releaseInfo,
      });
      if (!library.some((m) => m.id === media.id && m.type === media.type))
        library.push(media);
    } catch {
      /* skip */
    }
  }
  // Nuvio's TMDB sources need a TMDB key; the viewer's own key may come
  // across with them. It never leaves main and is stored encrypted.
  const rawKey = stores.nuvio_tmdb_settings?.[`tmdb_api_key_${index}`];
  const tmdbKey =
    typeof rawKey === "string" && /^[\w.-]{16,600}$/.test(rawKey.trim())
      ? rawKey.trim()
      : "";
  const tmdbSources = collections.collections.reduce(
    (n, c) => n + c.folders.reduce((m, f) => m + f.tmdb.length, 0),
    0,
  );
  return { addons, collections, plugins, library, tmdbKey, tmdbSources };
}

/** A summary the interface can show before anything is imported. */
export function nuvioPreview(stores) {
  return profilesOf(stores).map(({ index, name }) => {
    const p = nuvioProfile(stores, index);
    return {
      index,
      name,
      addons: p.addons.length,
      collections: p.collections.collections.length,
      folders: p.collections.folders,
      skippedSources: p.collections.skipped,
      plugins: p.plugins.length,
      scrapers: p.plugins.reduce((n, r) => n + r.scrapers, 0),
      library: p.library.length,
      // Whether a key exists, never the key itself.
      tmdbKey: !!p.tmdbKey,
      tmdbSources: p.tmdbSources,
    };
  });
}

/** Nuvio's data folders on this PC, most recent layout first. */
export function nuvioFolders(env = {}, home = "") {
  const local = env.LOCALAPPDATA || (home ? `${home}\\AppData\\Local` : "");
  const roaming = env.APPDATA || (home ? `${home}\\AppData\\Roaming` : "");
  return [
    local && { path: `${local}\\NuvioHTPC`, label: "Nuvio HTPC" },
    roaming && { path: `${roaming}\\Nuvio`, label: "Nuvio Desktop" },
    local && { path: `${local}\\Nuvio`, label: "Nuvio Desktop" },
  ].filter(Boolean);
}
