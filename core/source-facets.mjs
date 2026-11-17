/**
 * The source picker's advanced filters (issue #154): facets over the list
 * already on screen, never a new request and never a change to the ranked
 * list that autoplay and failover use.
 *
 * - Groups combine with AND, the values inside a group with OR.
 * - Each value shows how many sources it would leave, counted against the
 *   other groups' choices (so adding it never surprises).
 * - A source says nothing about a group: it is "not reported" there, a
 *   value of its own. Missing information is never read as absence: no
 *   "SDR" without the word, no "uncached" without "[RD download]", no
 *   Arabic subtitles guessed from a flag.
 *
 * Every fact comes from the stream engine's parse (core/stream-engine.mjs)
 * or, for the few it keeps as one value, from the source's own name and
 * description with the same kind of whole-word tests. Browser-safe.
 */

const text = (s) => `${s?.name || ""} ${s?.title || ""}`;
const test = (rx) => (s) => rx.test(text(s));

const RELEASES = ["REMUX", "BluRay", "WEB-DL", "WEBRip", "HDTV"];
const CODECS = ["HEVC", "AVC", "AV1"];
const SERVICES = ["RD", "AD", "PM", "TB", "DL", "OC"];

// Audio formats a release can name together ("TrueHD Atmos 7.1",
// "DDP5.1 Atmos"): each is its own fact. The engine's one reading
// (s.audio) counts too.
const either = (rx, audio) => (s) => rx.test(text(s)) || s.audio === audio;
const AUDIO = [
  ["Atmos", either(/\batmos\b/i, "Atmos")],
  ["TrueHD", either(/\btrue-?hd\b/i, "TrueHD")],
  ["DTS-X", either(/\bdts[-. :]?x\b/i, "DTS-X")],
  ["DTS-HD", either(/\bdts[-. ]?hd(?:[-. ]?ma)?\b/i, "DTS-HD MA")],
  // Plain DTS: not when the name only has DTS-HD or DTS:X.
  ["DTS", either(/\bdts\b(?![-. :]?(?:hd|x)\b)/i, "DTS")],
  // "DDP5.1" glues the channels on: no word boundary after "ddp".
  [
    "DD+",
    either(
      /\b(ddp(?=\d|\b)|dd\+|e-?ac-?3|eac3|dolby\s*digital\s*plus)/i,
      "DD+",
    ),
  ],
  [
    "DD",
    either(
      /\b(?<!e-)(ac-?3|dd(?:5|2|7)[.\- ]?\d|dolby\s*digital)\b(?!\s*plus)/i,
      "AC3",
    ),
  ],
  ["AAC", either(/\baac\b/i, "AAC")],
];

const MULTI_RX =
  /\b(multi(?:[-. ]?(?:subs?|audio|lang(?:uages?)?))?|dual[-. ]?audio)\b|متعدد(?:ة)?\s*(?:اللغات|الترجمات)/i;
const EN_SUB_RX = /\b(eng(?:lish)?[-. ]?subs?|subs?[-. ]?eng(?:lish)?)\b/i;
const SDR_RX = /\bsdr\b/i;

/**
 * The groups, in the order the panel shows them: quality, then dynamic
 * range, audio, the kind of source, then languages (the order badges are
 * kept in when space is short). `values` are [id, label]; `read` gives a
 * source's values in that group, [] when it reports none.
 */
export const FACET_GROUPS = [
  {
    id: "quality",
    title: "الدقة",
    values: [
      ["8k", "8K"],
      ["4k", "4K"],
      ["1440p", "1440p"],
      ["1080p", "1080p"],
      ["720p", "720p"],
      ["sd", "SD"],
    ],
    read: (s) => {
      const r = Number(s.resolution) || 0;
      if (r >= 4320) return ["8k"];
      if (r >= 2160) return ["4k"];
      if (r >= 1440) return ["1440p"];
      if (r >= 1080) return ["1080p"];
      if (r >= 720) return ["720p"];
      return r > 0 ? ["sd"] : [];
    },
  },
  {
    // REMUX is how the file was made, not how many lines it has: a group
    // of its own beside the resolution.
    id: "release",
    title: "نوع الإصدار",
    values: [
      ["REMUX", "REMUX"],
      ["BluRay", "Blu-ray"],
      ["WEB-DL", "WEB-DL"],
      ["WEBRip", "WEBRip"],
      ["HDTV", "HDTV"],
      ["other", "إصدار آخر"],
    ],
    read: (s) => {
      if (!s.source) return [];
      if (s.source === "BDRip") return ["BluRay"];
      return [RELEASES.includes(s.source) ? s.source : "other"];
    },
  },
  {
    id: "range",
    title: "النطاق الديناميكي",
    values: [
      ["dv", "Dolby Vision"],
      ["hdr10plus", "HDR10+"],
      ["hdr10", "HDR10"],
      ["hlg", "HLG"],
      ["sdr", "SDR"],
    ],
    read: (s) => {
      switch (s.hdr) {
        case "DV+HDR10":
          return ["dv", "hdr10"];
        case "DV":
          return ["dv"];
        case "HDR10+":
          return ["hdr10plus"];
        case "HDR10":
          return ["hdr10"];
        case "HLG":
          return ["hlg"];
      }
      // SDR only when the source says so: no HDR word is not proof.
      return SDR_RX.test(text(s)) ? ["sdr"] : [];
    },
  },
  {
    id: "codec",
    title: "ترميز الفيديو",
    values: [
      ["HEVC", "HEVC"],
      ["AVC", "AVC"],
      ["AV1", "AV1"],
      ["other", "ترميز آخر"],
    ],
    read: (s) =>
      s.codec ? [CODECS.includes(s.codec) ? s.codec : "other"] : [],
  },
  {
    id: "audio",
    title: "صيغة الصوت",
    values: [
      ["Atmos", "Dolby Atmos"],
      ["TrueHD", "TrueHD"],
      ["DTS-X", "DTS:X"],
      ["DTS-HD", "DTS-HD"],
      ["DTS", "DTS"],
      ["DD+", "Dolby Digital Plus"],
      ["DD", "Dolby Digital"],
      ["AAC", "AAC"],
    ],
    read: (s) => AUDIO.filter(([, has]) => has(s)).map(([id]) => id),
  },
  {
    id: "channels",
    title: "القنوات",
    values: [
      ["7.1", "7.1"],
      ["5.1", "5.1"],
      ["2.0", "ستيريو"],
    ],
    read: (s) => {
      const c = String(s.channels || "");
      if (c.startsWith("7.")) return ["7.1"];
      if (c.startsWith("5.")) return ["5.1"];
      if (c.startsWith("2.")) return ["2.0"];
      return [];
    },
  },
  {
    // Cached only with the addon's own mark ([RD+], ⚡, "cached"); a debrid
    // name alone says nothing about the cache.
    id: "link",
    title: "نوع المصدر",
    values: [
      ["cached", "Debrid مخزّن"],
      ["debrid", "Debrid دون تأكيد التخزين"],
      ["torrent", "تورنت P2P"],
      ["direct", "رابط مباشر HTTP/HLS"],
      ["external", "يفتح خارج رِواق"],
    ],
    read: (s) => {
      if (s.cached) return ["cached"];
      if (s.debrid) return ["debrid"];
      if (s.torrent) return ["torrent"];
      if (s.external) return ["external"];
      return ["direct"];
    },
  },
  {
    id: "service",
    title: "خدمة Debrid",
    values: [
      ["RD", "Real-Debrid"],
      ["AD", "AllDebrid"],
      ["PM", "Premiumize"],
      ["TB", "TorBox"],
      ["DL", "Debrid-Link"],
      ["OC", "Offcloud"],
    ],
    read: (s) => (SERVICES.includes(s.debrid) ? [s.debrid] : []),
  },
  {
    // Arabic subtitles and an Arabic dub are separate facts; a language
    // named in the description may be the audio or the subtitles, and the
    // label says just that.
    id: "language",
    title: "الترجمة واللغة",
    values: [
      ["arSub", "ترجمة عربية"],
      ["arDub", "دبلجة عربية"],
      ["enSub", "ترجمة إنجليزية"],
      ["multi", "عدة لغات أو ترجمات"],
      ["en", "الإنجليزية مذكورة"],
      ["otherLang", "لغة أخرى مذكورة"],
    ],
    read: (s) => {
      const out = [];
      const langs = Array.isArray(s.languages) ? s.languages : [];
      if (s.arabicSub) out.push("arSub");
      if (s.arabicDub) out.push("arDub");
      if (EN_SUB_RX.test(text(s))) out.push("enSub");
      if (MULTI_RX.test(text(s)) || langs.length > 2) out.push("multi");
      if (langs.includes("en")) out.push("en");
      if (langs.some((l) => l !== "ar" && l !== "en")) out.push("otherLang");
      return out;
    },
  },
  {
    // Built from the list itself: one value per addon copy.
    id: "addon",
    title: "الإضافة",
    values: [],
    read: (s) => [addonValue(s)],
  },
];

/** A source's addon copy, as a facet value (never an address). */
export const addonValue = (s) =>
  s.home ? "home" : String(s.addonKey || s.addonId || s.provider || "?");

/** "Not reported" in a group: the source says nothing about it. */
export const UNKNOWN = "unknown";
const GROUPS = new Map(FACET_GROUPS.map((g) => [g.id, g]));
const valuesOf = (group, s) => {
  const found = group.read(s);
  return found.length ? found : [UNKNOWN];
};

/** Choices as they are kept: known groups, string values, bounded. */
export function cleanFacets(input) {
  const out = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  for (const [id, list] of Object.entries(input)) {
    const group = GROUPS.get(id);
    if (!group || !Array.isArray(list)) continue;
    const allowed = new Set([...group.values.map(([v]) => v), UNKNOWN]);
    const values = [
      ...new Set(
        list.filter(
          (v) =>
            typeof v === "string" &&
            (id === "addon" ? /^[^\s<>"`]{1,200}$/.test(v) : allowed.has(v)),
        ),
      ),
    ].slice(0, 30);
    if (values.length) out[id] = values;
  }
  return out;
}

const passes = (s, chosen, skip) => {
  for (const [id, list] of Object.entries(chosen)) {
    if (id === skip || !list.length) continue;
    const group = GROUPS.get(id);
    if (!group) continue;
    const have = valuesOf(group, s);
    if (!list.some((v) => have.includes(v))) return false;
  }
  return true;
};

/** The sources meeting every chosen group, in the order they came. */
export function applyFacets(streams = [], chosen = {}) {
  const clean = cleanFacets(chosen);
  if (!Object.keys(clean).length) return streams;
  return streams.filter((s) => passes(s, clean, null));
}

/**
 * The panel: each group with the values that appear in this list (or are
 * chosen), each with the count it would leave given the other groups'
 * choices. Groups where every source is "not reported" are left out unless
 * something in them is chosen.
 */
export function facetPanel(streams = [], chosen = {}) {
  const clean = cleanFacets(chosen);
  const panel = [];
  for (const group of FACET_GROUPS) {
    const pool = streams.filter((s) => passes(s, clean, group.id));
    const counts = new Map();
    for (const s of pool)
      for (const v of valuesOf(group, s))
        counts.set(v, (counts.get(v) || 0) + 1);
    const picked = clean[group.id] || [];
    let values = group.values.map(([id, label]) => ({ id, label }));
    if (group.id === "addon") {
      const names = new Map();
      for (const s of streams)
        if (!names.has(addonValue(s)))
          names.set(
            addonValue(s),
            s.home ? "نسختك على خادمك" : s.provider || s.name || "مصدر",
          );
      values = [...names].map(([id, label]) => ({ id, label }));
    }
    values = values
      .map((v) => ({
        ...v,
        count: counts.get(v.id) || 0,
        chosen: picked.includes(v.id),
      }))
      .filter((v) => v.count > 0 || v.chosen);
    const unknown = counts.get(UNKNOWN) || 0;
    const anyKnown = streams.some((s) => group.read(s).length > 0);
    if (!anyKnown && !picked.length) continue;
    if (group.id === "addon" && values.length < 2 && !picked.length) continue;
    if (unknown > 0 || picked.includes(UNKNOWN))
      values.push({
        id: UNKNOWN,
        label: "غير مذكور",
        count: unknown,
        chosen: picked.includes(UNKNOWN),
      });
    if (values.length) panel.push({ id: group.id, title: group.title, values });
  }
  return panel;
}

/** One value on or off in its group. */
export function toggleFacet(chosen = {}, group, value) {
  const clean = cleanFacets(chosen);
  const list = clean[group] || [];
  const next = list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
  const out = { ...clean, [group]: next };
  if (!next.length) delete out[group];
  return cleanFacets(out);
}

/** How many values are chosen across the groups. */
export const facetCount = (chosen = {}) =>
  Object.values(cleanFacets(chosen)).reduce((n, list) => n + list.length, 0);

/** The chosen values with their labels, for the summary under the tools. */
export function chosenFacets(chosen = {}, streams = []) {
  const clean = cleanFacets(chosen);
  const out = [];
  for (const group of FACET_GROUPS) {
    for (const value of clean[group.id] || []) {
      let label =
        value === UNKNOWN
          ? `${group.title}: غير مذكور`
          : group.values.find(([v]) => v === value)?.[1];
      if (group.id === "addon" && value !== UNKNOWN) {
        const s = streams.find((x) => addonValue(x) === value);
        label = s ? (s.home ? "نسختك على خادمك" : s.provider || s.name) : value;
      }
      out.push({ group: group.id, value, label: label || value });
    }
  }
  return out;
}
