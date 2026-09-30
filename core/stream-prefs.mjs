/**
 * The viewer's stream preferences, applied after the stream engine has ranked
 * every offer (Harbor's Sources & library pages):
 *
 * - source mode: every source, direct and debrid links only, or torrents only;
 * - saved stream filters, one of them active: a stream must match every
 *   category the filter sets, a blank category accepts anything;
 * - result order: Riwaq's ranking, or the viewer's addon order.
 *
 * Nothing is lost silently. When the mode or the filter would leave nothing,
 * every stream stays and the reply says so; streams outside the active filter
 * are sent after the matching ones and flagged, so the picker can fold them
 * away while "play" and failover always reach a matching source first.
 * Browser-safe.
 */

export const FILTER_OPTIONS = {
  resolution: ["4K", "1080p", "720p", "480p", "SD"],
  source: [
    "REMUX",
    "BluRay",
    "WEB-DL",
    "WEBRip",
    "BDRip",
    "HDRip",
    "HDTV",
    "DVDRip",
    "CAM",
    "TS",
    "TC",
    "SCR",
    "Other",
  ],
  codec: ["HEVC", "AVC", "AV1", "VP9", "MPEG2", "Other"],
  audio: [
    "Atmos",
    "DTS-X",
    "TrueHD",
    "DTS-HD MA",
    "DTS",
    "DD+",
    "AC3",
    "AAC",
    "FLAC",
    "Opus",
    "Other",
  ],
};
export const FILTER_LIMIT = 12;
export const SOURCE_MODES = ["all", "direct", "p2p"];
export const STREAM_ORDERS = ["riwaq", "addon"];
const GIB = 1024 ** 3;

const text = (value, max) =>
  typeof value === "string"
    ? value
        .replace(/[\u0000-\u001f\u007f]+/g, " ")
        .trim()
        .slice(0, max)
    : "";
const pickList = (value, allowed) =>
  Array.isArray(value)
    ? [...new Set(value.filter((v) => allowed.includes(v)))]
    : [];

/** Saved filters: a name, and only the categories and limits Riwaq knows. */
export function cleanStreamFilters(input) {
  const out = [];
  for (const f of Array.isArray(input) ? input : []) {
    if (!f || typeof f !== "object") continue;
    const id = /^[\w-]{1,40}$/.test(f.id || "") ? f.id : "";
    const name = text(f.name, 40);
    if (!id || !name || out.some((x) => x.id === id)) continue;
    const seeds = Number(f.minSeeders);
    const size = Number(f.maxSizeGb);
    out.push({
      id,
      name,
      resolution: pickList(f.resolution, FILTER_OPTIONS.resolution),
      source: pickList(f.source, FILTER_OPTIONS.source),
      codec: pickList(f.codec, FILTER_OPTIONS.codec),
      audio: pickList(f.audio, FILTER_OPTIONS.audio),
      requireHdr: f.requireHdr === true,
      cachedOnly: f.cachedOnly === true,
      minSeeders:
        Number.isInteger(seeds) && seeds > 0 ? Math.min(seeds, 10000) : 0,
      maxSizeGb:
        Number.isFinite(size) && size > 0
          ? Math.min(Math.round(size * 10) / 10, 500)
          : 0,
    });
    if (out.length >= FILTER_LIMIT) break;
  }
  return out;
}

/** Addon manifest IDs in the viewer's order, as text without surprises. */
export function cleanAddonPriority(input) {
  return Array.isArray(input)
    ? [
        ...new Set(
          input
            .filter(
              (id) => typeof id === "string" && /^[^\s<>"`]{1,200}$/.test(id),
            )
            .slice(0, 100),
        ),
      ]
    : [];
}

const bucket = (resolution) =>
  resolution >= 2160
    ? "4K"
    : resolution >= 1080
      ? "1080p"
      : resolution >= 720
        ? "720p"
        : resolution >= 480
          ? "480p"
          : "SD";
const known = (value, list) => (list.includes(value) ? value : "Other");

/** Whether a stream, as the picker sees it, meets a saved filter. */
export function matchesFilter(stream, filter) {
  if (!filter) return true;
  if (
    filter.resolution.length &&
    !filter.resolution.includes(bucket(stream.resolution))
  )
    return false;
  if (
    filter.source.length &&
    !filter.source.includes(known(stream.source, FILTER_OPTIONS.source))
  )
    return false;
  if (
    filter.codec.length &&
    !filter.codec.includes(known(stream.codec, FILTER_OPTIONS.codec))
  )
    return false;
  if (
    filter.audio.length &&
    !filter.audio.includes(known(stream.audio, FILTER_OPTIONS.audio))
  )
    return false;
  if (filter.requireHdr && !stream.hdr) return false;
  if (filter.cachedOnly && !stream.cached) return false;
  // Seeds only mean something for a torrent; a direct link passes.
  if (
    filter.minSeeders &&
    stream.torrent &&
    (stream.seeders ?? 0) < filter.minSeeders
  )
    return false;
  if (filter.maxSizeGb && stream.size && stream.size > filter.maxSizeGb * GIB)
    return false;
  return true;
}

/** The kind of link a stream is, for the source mode. */
const inMode = (stream, mode) =>
  mode === "p2p"
    ? !!stream.torrent
    : mode === "direct"
      ? !stream.torrent
      : true;

/**
 * Applies mode, filter and order to the ranked streams. `streams` carry the
 * engine's `score` and their addon's `addonId`; `addonOrder` is the installed
 * addons' IDs in install order, the fallback for addons the viewer did not
 * place.
 */
export function applyStreamPrefs(streams, settings = {}, addonOrder = []) {
  const mode = SOURCE_MODES.includes(settings.sourceMode)
    ? settings.sourceMode
    : "all";
  const filters = cleanStreamFilters(settings.streamFilters);
  const filter = filters.find((f) => f.id === settings.activeFilter) || null;
  let list = streams.filter((s) => inMode(s, mode));
  const modeFallback = mode !== "all" && !list.length && streams.length > 0;
  if (modeFallback) list = [...streams];
  if (settings.streamOrder === "addon") {
    const priority = [
      ...cleanAddonPriority(settings.addonPriority),
      ...addonOrder,
    ];
    const rank = (s) => {
      const i = priority.indexOf(s.addonId);
      return i < 0 ? priority.length : i;
    };
    list = list
      .map((s, i) => ({ s, i }))
      .sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i)
      .map(({ s }) => s);
  }
  let matched = list.length;
  if (filter) {
    const yes = list.filter((s) => matchesFilter(s, filter));
    const no = list.filter((s) => !matchesFilter(s, filter));
    matched = yes.length;
    list = [
      ...yes.map((s) => ({ ...s, matches: true })),
      ...no.map((s) => ({ ...s, matches: false })),
    ];
  }
  return {
    streams: list,
    mode,
    modeFallback,
    filter: filter
      ? {
          id: filter.id,
          name: filter.name,
          matched,
          fallback: !matched && list.length > 0,
        }
      : null,
  };
}
