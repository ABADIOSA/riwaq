/**
 * Subtitle and audio track rules shared by main and the interface.
 *
 * Browser-safe: no Node imports. Addon subtitle URLs never come through
 * here; the interface only ever sees opaque keys and labels.
 */

// ISO 639-1 and 639-2 (bibliographic and terminology) codes, named in Arabic.
const LANGUAGES = [
  ["ar", ["ara", "arabic"], "العربية"],
  ["en", ["eng", "english"], "الإنجليزية"],
  ["fr", ["fre", "fra", "french"], "الفرنسية"],
  ["es", ["spa", "spanish"], "الإسبانية"],
  ["de", ["ger", "deu", "german"], "الألمانية"],
  ["it", ["ita", "italian"], "الإيطالية"],
  ["pt", ["por", "portuguese", "pob", "pt-br"], "البرتغالية"],
  ["tr", ["tur", "turkish"], "التركية"],
  ["fa", ["per", "fas", "persian", "farsi"], "الفارسية"],
  ["ur", ["urd", "urdu"], "الأردية"],
  ["hi", ["hin", "hindi"], "الهندية"],
  ["ru", ["rus", "russian"], "الروسية"],
  ["ja", ["jpn", "japanese"], "اليابانية"],
  ["ko", ["kor", "korean"], "الكورية"],
  ["zh", ["chi", "zho", "chinese", "chs", "cht"], "الصينية"],
  ["id", ["ind", "indonesian"], "الإندونيسية"],
  ["ms", ["may", "msa", "malay"], "الملايوية"],
  ["nl", ["dut", "nld", "dutch"], "الهولندية"],
  ["pl", ["pol", "polish"], "البولندية"],
  ["sv", ["swe", "swedish"], "السويدية"],
  ["he", ["heb", "hebrew"], "العبرية"],
  ["el", ["gre", "ell", "greek"], "اليونانية"],
  ["ro", ["rum", "ron", "romanian"], "الرومانية"],
  ["uk", ["ukr", "ukrainian"], "الأوكرانية"],
  ["vi", ["vie", "vietnamese"], "الفيتنامية"],
  ["th", ["tha", "thai"], "التايلاندية"],
];
const BY_CODE = new Map();
for (const [code, aliases, name] of LANGUAGES)
  for (const alias of [code, ...aliases]) BY_CODE.set(alias, { code, name });

/** Normalises a track or addon language tag to one code and an Arabic name. */
export function languageOf(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (!raw || raw === "und" || raw === "unknown")
    return { code: "und", name: "غير محددة" };
  const known = BY_CODE.get(raw) || BY_CODE.get(raw.split(/[-_]/)[0]);
  return known || { code: raw.slice(0, 12), name: raw.slice(0, 24) };
}

/** The viewer's language list ("ara,ar,eng,en") as ordered unique codes. */
export function preferredLanguages(setting) {
  const codes = [];
  for (const part of String(setting || "").split(",")) {
    const { code } = languageOf(part);
    if (code !== "und" && !codes.includes(code)) codes.push(code);
  }
  return codes;
}

const SDH = /\b(sdh|cc|hi|hoh|hearing[ -]?impaired|closed[ -]?captions?)\b/i;
const FORCED = /\b(forced|foreign|signs?)\b/i;

/**
 * Standard, SDH or forced. Forced comes from the container flag or the name,
 * SDH from the name or MPV's hearing-impaired flag.
 */
export function subtitleKind(track = {}) {
  const text = `${track.title || ""} ${track.label || ""}`;
  if (track.forced || FORCED.test(text)) return "forced";
  if (track.hearingImpaired || SDH.test(text)) return "sdh";
  return "standard";
}

export const KIND_LABELS = {
  standard: "عادية",
  sdh: "للصم وضعاف السمع",
  forced: "إجبارية",
};

/**
 * Where a kind lands for a viewer who prefers `preferred`: the preferred kind
 * first, then a plain translation (it covers the whole dialogue), then SDH,
 * and forced last because it leaves most lines untranslated.
 */
export function kindRank(kind, preferred = "standard") {
  if (kind === preferred) return 0;
  if (kind === "standard") return 1;
  if (kind === "sdh") return 2;
  return 3;
}

/**
 * Language is the hard rule and kind the tiebreaker inside it. Never jumps to
 * a less preferred language to satisfy the kind. Returns the ranked copies.
 */
export function rankSubtitles(
  items,
  { languages = [], kind = "standard" } = {},
) {
  const position = (item) => {
    const index = languages.indexOf(languageOf(item.lang).code);
    return index < 0 ? languages.length : index;
  };
  return items
    .map((item, order) => ({ item, order }))
    .sort(
      (a, b) =>
        position(a.item) - position(b.item) ||
        kindRank(subtitleKind(a.item), kind) -
          kindRank(subtitleKind(b.item), kind) ||
        a.order - b.order,
    )
    .map(({ item }) => item);
}

/** Languages present in a list, preferred first, each with its count. */
export function languageGroups(items, languages = []) {
  const counts = new Map();
  for (const item of items) {
    const { code, name } = languageOf(item.lang);
    const entry = counts.get(code) || { code, name, count: 0 };
    entry.count++;
    counts.set(code, entry);
  }
  return [...counts.values()].sort((a, b) => {
    const x = languages.indexOf(a.code);
    const y = languages.indexOf(b.code);
    if (x !== y) return (x < 0 ? 999 : x) - (y < 0 ? 999 : y);
    return b.count - a.count || a.name.localeCompare(b.name, "ar");
  });
}

/**
 * Picks the addon subtitle to load on its own when the file carries no track
 * in the viewer's first language. Only that first language qualifies: a
 * fallback language is something the viewer can choose, not something forced.
 */
export function automaticSubtitle({
  tracks = [],
  addons = [],
  languages = [],
  kind,
}) {
  const first = languages[0];
  if (!first) return null;
  const embedded = tracks.some(
    (t) => t.type === "sub" && languageOf(t.lang).code === first,
  );
  if (embedded) return null;
  const candidates = addons.filter((s) => languageOf(s.lang).code === first);
  return rankSubtitles(candidates, { languages, kind })[0] || null;
}

// --- Cues and quick sync ----------------------------------------------------

const TIME =
  /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

const seconds = (h, m, s, ms) =>
  Number(h || 0) * 3600 +
  Number(m) * 60 +
  Number(s) +
  Number(String(ms).padEnd(3, "0")) / 1000;

/** SRT and WebVTT cues: start, end and plain text without markup. */
export function parseCues(text, { limit = 20000 } = {}) {
  const cues = [];
  const blocks = String(text || "")
    .replace(/^﻿/, "")
    .replace(/\r/g, "")
    .split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n");
    const at = lines.findIndex((line) => TIME.test(line));
    if (at < 0) continue;
    const m = lines[at].match(TIME);
    const body = lines
      .slice(at + 1)
      .join(" ")
      .replace(/<[^>]*>/g, "")
      .replace(/\{\\[^}]*\}/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!body) continue;
    const start = seconds(m[1], m[2], m[3], m[4]);
    const end = seconds(m[5], m[6], m[7], m[8]);
    if (end < start) continue;
    cues.push({ start, end, text: body.slice(0, 200) });
    if (cues.length >= limit) break;
  }
  return cues.sort((a, b) => a.start - b.start);
}

/**
 * Cues around the moment the viewer is at, in subtitle time (position minus
 * the current delay), so a line just heard is on screen to be picked.
 */
export function cuesAround(
  cues,
  position,
  delay = 0,
  { before = 6, after = 6 } = {},
) {
  const t = position - delay;
  let index = cues.findIndex((cue) => cue.start >= t);
  if (index < 0) index = cues.length;
  return cues.slice(Math.max(0, index - before), index + after);
}

/** A person reacts after hearing a line; the offset allows for that. */
export const REACTION_SECONDS = 0.3;

/**
 * The delay that puts the picked cue where the viewer heard it. Positive
 * delays show subtitles later, as MPV defines sub-delay.
 */
export function syncDelay(cueStart, position) {
  const delay = position - REACTION_SECONDS - cueStart;
  return Math.round(Math.max(-60, Math.min(60, delay)) * 10) / 10;
}

// --- Style ------------------------------------------------------------------

export const DEFAULT_SUBTITLE_STYLE = {
  color: "#FFFFFF",
  outlineColor: "#000000",
  outline: 2,
  background: "#000000",
  backgroundOpacity: 0,
  shadow: 0,
  bold: false,
  assOverride: "scale",
};

const HEX = /^#[0-9A-Fa-f]{6}$/;
const clamp = (value, min, max, fallback) =>
  Number.isFinite(Number(value))
    ? Math.max(min, Math.min(max, Number(value)))
    : fallback;

/** Validates a style from the interface or a backup; anything odd is dropped. */
export function safeSubtitleStyle(
  input = {},
  current = DEFAULT_SUBTITLE_STYLE,
) {
  const next = { ...DEFAULT_SUBTITLE_STYLE, ...current };
  if (!input || typeof input !== "object") return next;
  for (const key of ["color", "outlineColor", "background"])
    if (HEX.test(input[key])) next[key] = input[key].toUpperCase();
  if ("outline" in input)
    next.outline = clamp(input.outline, 0, 8, next.outline);
  if ("shadow" in input) next.shadow = clamp(input.shadow, 0, 8, next.shadow);
  if ("backgroundOpacity" in input)
    next.backgroundOpacity = Math.round(
      clamp(input.backgroundOpacity, 0, 100, next.backgroundOpacity),
    );
  if (typeof input.bold === "boolean") next.bold = input.bold;
  if (["no", "scale", "force"].includes(input.assOverride))
    next.assOverride = input.assOverride;
  return next;
}

/** MPV colours are #AARRGGBB, with alpha as opacity. */
const mpvColor = (hex, opacity = 100) =>
  `#${Math.round((opacity / 100) * 255)
    .toString(16)
    .padStart(2, "0")
    .toUpperCase()}${hex.slice(1)}`;

/** The MPV properties a style sets, as [name, value] pairs. */
export function styleProperties(input) {
  const style = safeSubtitleStyle(input);
  const box = style.backgroundOpacity > 0;
  return [
    ["sub-color", mpvColor(style.color)],
    ["sub-border-color", mpvColor(style.outlineColor)],
    ["sub-border-size", style.outline],
    ["sub-back-color", mpvColor(style.background, style.backgroundOpacity)],
    ["sub-border-style", box ? "background-box" : "outline-and-shadow"],
    ["sub-shadow-offset", style.shadow],
    ["sub-shadow-color", "#99000000"],
    ["sub-bold", style.bold ? "yes" : "no"],
    ["sub-ass-override", style.assOverride],
  ];
}

/** The same style as command-line options for a fresh MPV process. */
export function styleArgs(input) {
  return styleProperties(input).map(([name, value]) => `--${name}=${value}`);
}

// --- Audio ------------------------------------------------------------------

const LAYOUTS = { 1: "أحادي", 2: "ستيريو", 6: "5.1", 8: "7.1" };

/** A readable line for an audio track: language, title, codec and layout. */
export function audioLabel(track = {}) {
  const parts = [languageOf(track.lang).name];
  if (track.title) parts.push(track.title);
  if (track.codec) parts.push(String(track.codec).toUpperCase());
  if (track.channels)
    parts.push(LAYOUTS[track.channels] || `${track.channels}ch`);
  return parts.join(" · ");
}
