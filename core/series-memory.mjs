/**
 * What a viewer chose for a series, carried to its next episode (Harbor
 * #1419, Nuvio #611): the source (addon, release group, quality) and the
 * audio and subtitle tracks.
 *
 * Nothing here is a link. A source is remembered by its addon ID, release
 * group and quality tier, so the next episode's fresh streams are matched
 * again instead of replaying a URL that may have expired. A track is
 * remembered by language, title and flags rather than its number, which
 * changes between files. Per profile (it lives in settings), capped, and
 * cleared from the settings page. Browser-safe.
 */

import { languageOf } from "./subtitles.mjs";
import { TIERS } from "./stream-engine.mjs";

export const MEMORY_LIMIT = 200;
const SERIES_ID = /^[\w:.-]{1,120}$/;
const ADDON_ID = /^[^\s"<>]{1,160}$/;

const text = (value, max) =>
  typeof value === "string"
    ? value
        .replace(/[\u0000-\u001f\u007f]+/g, " ")
        .trim()
        .slice(0, max)
    : "";
const lower = (value) => text(value, 80).toLowerCase();
const code = (value) => {
  const c = languageOf(value).code;
  return c === "und" ? "" : c;
};

/** A played stream's identity for its series, or null when it has none. */
export function sourceIdentity(stream = {}) {
  const addonId = ADDON_ID.test(stream.addonId || "") ? stream.addonId : "";
  if (!addonId || stream.home) return null;
  return {
    addonId,
    provider: text(stream.provider, 80),
    group: text(stream.group, 40),
    tier: TIERS.includes(stream.tier) ? stream.tier : "",
    source: text(stream.source, 20),
  };
}

/** A selected track's identity: language, title and flags; or subtitles off. */
export function trackIdentity(track) {
  if (track === "no") return { off: true };
  if (!track || typeof track !== "object") return null;
  const lang = code(track.lang);
  if (!lang) return null;
  const out = { lang };
  const title = text(track.title, 120);
  if (title) out.title = title;
  if (track.forced) out.forced = true;
  if (track.hearingImpaired) out.hi = true;
  if (track.external) out.external = true;
  const channels = Number(track.channels);
  if (Number.isInteger(channels) && channels > 0 && channels <= 16)
    out.channels = channels;
  return out;
}

function cleanTrack(input, allowOff) {
  if (!input || typeof input !== "object") return null;
  if (input.off === true) return allowOff ? { off: true } : null;
  return trackIdentity({
    lang: input.lang,
    title: input.title,
    forced: input.forced === true,
    hearingImpaired: input.hi === true,
    external: input.external === true,
    channels: input.channels,
  });
}

function cleanSource(input) {
  if (!input || typeof input !== "object") return null;
  return sourceIdentity({
    addonId: input.addonId,
    provider: input.provider,
    group: input.group,
    tier: input.tier,
    source: input.source,
  });
}

/** The stored memory, validated field by field, newest kept when over cap. */
export function cleanSeriesMemory(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const entries = [];
  for (const [id, value] of Object.entries(input)) {
    if (!SERIES_ID.test(id) || !value || typeof value !== "object") continue;
    const entry = {};
    const source = cleanSource(value.source);
    const audio = cleanTrack(value.audio, false);
    const subtitle = cleanTrack(value.subtitle, true);
    if (source) entry.source = source;
    if (audio) entry.audio = audio;
    if (subtitle) entry.subtitle = subtitle;
    if (!source && !audio && !subtitle) continue;
    const at = Number(value.at);
    entry.at = Number.isFinite(at) && at > 0 ? Math.floor(at) : 0;
    entries.push([id, entry]);
  }
  entries.sort((a, b) => b[1].at - a[1].at);
  return Object.fromEntries(entries.slice(0, MEMORY_LIMIT));
}

/** The memory with one series' choice merged in. `patch` holds identities. */
export function rememberSeries(memory, seriesId, patch = {}, now = Date.now()) {
  if (!SERIES_ID.test(seriesId || "")) return cleanSeriesMemory(memory);
  const current = cleanSeriesMemory(memory);
  const entry = { ...(current[seriesId] || {}) };
  for (const key of ["source", "audio", "subtitle"])
    if (patch[key] === null) delete entry[key];
    else if (patch[key]) entry[key] = patch[key];
  entry.at = now;
  return cleanSeriesMemory({ ...current, [seriesId]: entry });
}

/** The memory without one series, or empty when `seriesId` is omitted. */
export function forgetSeries(memory, seriesId) {
  if (!seriesId) return {};
  const next = { ...cleanSeriesMemory(memory) };
  delete next[seriesId];
  return next;
}

/**
 * The track to select for a remembered choice: an MPV track ID, "no" for
 * subtitles off, or null when nothing in this file matches (the viewer's
 * general language settings then apply). The language must match; title and
 * flags break ties, so "Arabic (Forced)" is not taken for full Arabic.
 */
export function matchTrack(tracks = [], type, wanted) {
  if (!wanted) return null;
  if (wanted.off) return type === "sub" ? "no" : null;
  const candidates = tracks.filter(
    (t) => t && t.type === type && code(t.lang) === wanted.lang,
  );
  if (!candidates.length) return null;
  const score = (t) =>
    (wanted.title && lower(t.title) === lower(wanted.title) ? 8 : 0) +
    (!!t.forced === !!wanted.forced ? 4 : 0) +
    (!!t.hearingImpaired === !!wanted.hi ? 2 : 0) +
    (wanted.channels && Number(t.channels) === wanted.channels ? 1 : 0) +
    (!t.external ? 0.5 : 0);
  const best = candidates
    .map((t, i) => ({ t, i, s: score(t) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)[0].t;
  // A forced-only track never stands in for full subtitles, or the reverse.
  if (type === "sub" && !!best.forced !== !!wanted.forced) return null;
  return best.id;
}

/** Whether a ranked stream is the remembered source for its series. */
export function isRememberedSource(stream = {}, remembered) {
  if (!remembered?.addonId || stream.addonId !== remembered.addonId)
    return false;
  if (remembered.group) return lower(stream.group) === lower(remembered.group);
  // Without a release group, the same addon at the same quality and source.
  return (
    !!remembered.tier &&
    stream.tier === remembered.tier &&
    (!remembered.source || stream.source === remembered.source)
  );
}

export const REMEMBERED_LABEL = "نفس مصدر الحلقة السابقة";

/**
 * Ranked streams with the remembered source moved first inside its filter
 * band (matching streams stay ahead of non-matching ones), labelled so the
 * picker can say why it moved. The rest keep their order.
 */
export function preferRemembered(streams = [], remembered) {
  if (!remembered) return { streams, remembered: 0 };
  let count = 0;
  const marked = streams.map((s, i) => {
    if (!isRememberedSource(s, remembered)) return { s, i, hit: false };
    count++;
    return {
      s: {
        ...s,
        remembered: true,
        reasons: [
          { code: "remembered", label: REMEMBERED_LABEL, points: 0 },
          ...(s.reasons || []),
        ].slice(0, 6),
      },
      i,
      hit: true,
    };
  });
  const band = (x) => (x.s.matches === false ? 1 : 0);
  marked.sort(
    (a, b) => band(a) - band(b) || Number(b.hit) - Number(a.hit) || a.i - b.i,
  );
  return { streams: marked.map((x) => x.s), remembered: count };
}

/** The series a viewing belongs to, or "" for films, live and local files. */
export function seriesOf(meta) {
  return meta?.type === "series" && SERIES_ID.test(meta.id || "")
    ? meta.id
    : "";
}
