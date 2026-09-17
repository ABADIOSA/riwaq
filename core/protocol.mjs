import { createHash } from "node:crypto";

export const CINEMETA = "https://v3-cinemeta.strem.io/manifest.json";
export const DEFAULT_SETTINGS = {
  accent: "amber",
  quality: "2160",
  hideCam: true,
  subtitleLanguage: "ara,ar,eng,en",
  audioLanguage: "ara,ar,eng,en",
  subtitleSize: 44,
  subtitleDelay: 0,
  hardwareDecoding: true,
  hdr: false,
  mpvPath: "",
  serverUrl: "http://127.0.0.1:11470",
  autoplay: false,
  layout: "cinematic",
  cardStyle: "glass",
  cardSize: "comfortable",
  showHero: true,
  showRatings: true,
  reduceMotion: false,
  hideWatched: false,
  metadataLanguage: "ar-SA",
  region: "SA",
  subtitlePosition: 95,
  pauseOnMinimize: true,
  seekStep: 10,
};
export const keyFor = (value) =>
  createHash("sha256").update(value).digest("hex").slice(0, 24);
export function webUrl(value, { httpsOnly = false } = {}) {
  if (typeof value !== "string" || value.length > 16000)
    throw new Error("الرابط غير صالح");
  const url = new URL(value);
  if (
    !(httpsOnly ? ["https:"] : ["http:", "https:"]).includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("استخدم رابط HTTP أو HTTPS صالحاً");
  return url;
}
export function normalizeAddon(input) {
  const url = webUrl(
    String(input)
      .trim()
      .replace(/^stremio:\/\//i, "https://"),
  );
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  if (!url.pathname.endsWith("/manifest.json"))
    url.pathname += "/manifest.json";
  return url.toString();
}
export function validateManifest(m) {
  if (
    !m ||
    typeof m.id !== "string" ||
    !m.id ||
    typeof m.name !== "string" ||
    !Array.isArray(m.resources) ||
    !Array.isArray(m.types) ||
    !m.types.every((t) => typeof t === "string") ||
    !m.resources.every(
      (r) =>
        typeof r === "string" ||
        (r &&
          typeof r.name === "string" &&
          Array.isArray(r.types) &&
          r.types.every((t) => typeof t === "string") &&
          (!r.idPrefixes ||
            (Array.isArray(r.idPrefixes) &&
              r.idPrefixes.every((p) => typeof p === "string")))),
    ) ||
    (m.idPrefixes &&
      (!Array.isArray(m.idPrefixes) ||
        !m.idPrefixes.every((p) => typeof p === "string"))) ||
    (m.catalogs &&
      (!Array.isArray(m.catalogs) ||
        !m.catalogs.every(
          (c) =>
            c &&
            typeof c.id === "string" &&
            typeof c.type === "string" &&
            (!c.extra ||
              (Array.isArray(c.extra) &&
                c.extra.every(
                  (e) =>
                    e &&
                    typeof e.name === "string" &&
                    (!e.options ||
                      (Array.isArray(e.options) &&
                        e.options.every((o) => typeof o === "string"))),
                ))),
        )))
  )
    throw new Error("الإضافة لا تحتوي على ملف manifest صالح");
  return m;
}
export function accepts(manifest, resource, type, id) {
  return (manifest.resources || []).some((entry) => {
    if ((typeof entry === "string" ? entry : entry.name) !== resource)
      return false;
    const types = typeof entry === "string" ? manifest.types : entry.types;
    const prefixes =
      typeof entry === "string" ? manifest.idPrefixes : entry.idPrefixes;
    return (
      (types || []).includes(type) &&
      (!prefixes?.length || prefixes.some((prefix) => id.startsWith(prefix)))
    );
  });
}
export function resourceUrl(transport, resource, type, id, extras = {}) {
  const url = webUrl(transport);
  const extra = Object.entries(extras)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  url.pathname =
    url.pathname.replace(/\/manifest\.json$/, "") +
    "/" +
    [resource, type, id].map(encodeURIComponent).join("/") +
    (extra ? "/" + extra : "") +
    ".json";
  return url.toString();
}
export function catalogExtras(catalog, search = "", genre = "", skip = 0) {
  const extras = {};
  const definitions = catalog.extra || [];
  if (search && !definitions.some((e) => e.name === "search")) return null;
  if (search) extras.search = search;
  if (genre && definitions.some((e) => e.name === "genre"))
    extras.genre = genre;
  if (skip && definitions.some((e) => e.name === "skip")) extras.skip = skip;
  for (const def of definitions) {
    if (!def.isRequired || extras[def.name]) continue;
    if (def.name === "search" || !def.options?.length) return null;
    extras[def.name] = def.options[0];
  }
  return extras;
}
export function mergeAddons(local, incoming) {
  const result = [...local];
  for (const addon of incoming) {
    const normalized = {
      ...addon,
      transportUrl: normalizeAddon(addon.transportUrl),
    };
    const index = result.findIndex(
      (a) => a.transportUrl === normalized.transportUrl,
    );
    if (index < 0) result.push({ ...normalized, enabled: true });
    else result[index] = { ...result[index], manifest: normalized.manifest };
  }
  return result;
}
export function describeStream(stream) {
  const text = `${stream.name || ""} ${stream.title || ""} ${stream.description || ""}`;
  const resolution = /2160|4k|uhd/i.test(text)
    ? 2160
    : /1080/i.test(text)
      ? 1080
      : /720/i.test(text)
        ? 720
        : /480/i.test(text)
          ? 480
          : 0;
  const cam = /\b(cam|hdcam|telesync|telecine|hdts)\b/i.test(text);
  const hdr = /\b(hdr10\+?|hdr|dolby vision|dv)\b/i.test(text);
  const codec = /hevc|h[ .]?265|x265/i.test(text)
    ? "HEVC"
    : /av1/i.test(text)
      ? "AV1"
      : /h[ .]?264|x264/i.test(text)
        ? "H.264"
        : "";
  const arabic = /arabic|\bara\b|عربي/i.test(text);
  return { resolution, cam, hdr, codec, arabic };
}
export function rankStreams(streams, settings) {
  const preferred = Number(settings.quality) || 2160;
  return streams
    .map((stream, index) => {
      const info = describeStream(stream);
      const score =
        (info.resolution <= preferred
          ? info.resolution
          : preferred - (info.resolution - preferred)) +
        (info.arabic ? 60 : 0) -
        (info.cam ? 10000 : 0);
      return { ...stream, ...info, score, originalIndex: index };
    })
    .filter((s) => !(settings.hideCam && s.cam))
    .sort((a, b) => b.score - a.score || a.originalIndex - b.originalIndex);
}
export function torrentUrl(stream, base) {
  if (!/^[a-f\d]{40}$/i.test(stream.infoHash || ""))
    throw new Error("معرّف التورنت غير صالح");
  const url = webUrl(base);
  if (
    stream.fileIdx !== undefined &&
    (!Number.isInteger(stream.fileIdx) || stream.fileIdx < 0)
  )
    throw new Error("رقم الملف غير صالح");
  url.pathname =
    url.pathname.replace(/\/$/, "") +
    "/" +
    stream.infoHash.toLowerCase() +
    "/" +
    (stream.fileIdx ?? -1);
  for (const source of stream.sources || []) {
    if (typeof source !== "string") continue;
    const tracker = source.replace(/^tracker:/, "");
    if (/^(udp|https?|wss?):\/\//i.test(tracker))
      url.searchParams.append("tr", tracker);
  }
  return url.toString();
}
export function continueWatching(progress) {
  return Object.values(progress)
    .filter(
      (p) => p.position > 10 && (!p.duration || p.position / p.duration < 0.95),
    )
    .sort((a, b) => b.updated - a.updated);
}
export function safeSettings(input, current = DEFAULT_SETTINGS) {
  const next = { ...current };
  for (const k of [
    "hideCam",
    "hardwareDecoding",
    "hdr",
    "autoplay",
    "showHero",
    "showRatings",
    "reduceMotion",
    "hideWatched",
    "pauseOnMinimize",
  ])
    if (typeof input[k] === "boolean") next[k] = input[k];
  if (
    ["amber", "teal", "violet", "noir", "nord", "rose", "forest"].includes(
      input.accent,
    )
  )
    next.accent = input.accent;
  if (["2160", "1080", "720"].includes(input.quality))
    next.quality = input.quality;
  for (const k of ["subtitleLanguage", "audioLanguage"])
    if (typeof input[k] === "string" && /^[a-z,-]{0,100}$/.test(input[k]))
      next[k] = input[k];
  if (Number.isFinite(input.subtitleSize))
    next.subtitleSize = Math.max(18, Math.min(80, input.subtitleSize));
  if (Number.isFinite(input.subtitleDelay))
    next.subtitleDelay = Math.max(-60, Math.min(60, input.subtitleDelay));
  if (typeof input.serverUrl === "string")
    next.serverUrl = webUrl(input.serverUrl).toString().replace(/\/$/, "");
  for (const [key, values] of Object.entries({
    layout: ["cinematic", "sidebar", "topbar"],
    cardStyle: ["glass", "flat"],
    cardSize: ["compact", "comfortable", "large"],
    metadataLanguage: ["ar-SA", "en-US", "ja-JP", "fr-FR"],
    region: ["SA", "AE", "EG", "US", "GB"],
    seekStep: [5, 10, 30],
    subtitlePosition: [80, 85, 90, 95, 100],
  }))
    if (values.includes(input[key])) next[key] = input[key];
  return next;
}
