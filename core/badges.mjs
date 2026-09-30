/**
 * Stream badges (Harbor's Badges, Custom rules and Packs pages).
 *
 * - Built-in format chips come from what the stream engine read: resolution,
 *   HDR, codec, source, audio, size, seeds, cache, trusted group and Arabic.
 *   The viewer may turn all of them off or hide single kinds.
 * - Badge art swaps a built-in chip's text for a picture (4K, Dolby Vision,
 *   Atmos...), the way Harbor's art packs do.
 * - Custom rules are the viewer's own badges: a label, colours, an optional
 *   picture and a pattern tested against the stream's name and title.
 * - A pack is a JSON file of rules and art. Riwaq reads its own format,
 *   Harbor's (`overrides` + `rules`) and Nuvio's (`filters`), which is what
 *   links such as harbor.site/badges/harbor-light.json serve.
 *
 * Patterns run on every stream row, so patterns known to backtrack without
 * end (a repeated group that is itself repeated) are refused, and a title is
 * cut before it is tested. Pictures are plain HTTPS addresses without
 * credentials. Browser-safe.
 */

export const BADGE_KINDS = [
  ["resolution", "الدقة"],
  ["hdr", "HDR"],
  ["codec", "الترميز"],
  ["source", "نوع النسخة"],
  ["audio", "الصوت"],
  ["size", "الحجم"],
  ["seeders", "المشاركون"],
  ["cached", "المخزّن"],
  ["group", "المجموعة الموثوقة"],
  ["arabic", "العربية"],
];
export const RULE_LIMIT = 250;
export const PATTERN_MAX = 20000;
export const PACK_TEXT_MAX = 3_000_000;
const HEX = /^#[0-9A-Fa-f]{6}$/;
const TITLE_MAX = 400;
const DEFAULT_COLOR = "#E7B66E";
const STYLES = ["filled", "outlined", "bordered", "filled and bordered"];
const MATCH_LIMIT = 8;

const text = (value, max) =>
  typeof value === "string"
    ? value
        .replace(/[\u0000-\u001f\u007f]+/g, " ")
        .trim()
        .slice(0, max)
    : "";

/** A badge picture: HTTPS, no credentials, a sane length. */
export function badgeImage(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 600)
    return "";
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password) return "";
    return url.toString();
  } catch {
    return "";
  }
}

/**
 * A colour as CSS: #RRGGBB, or Android's #AARRGGBB (Nuvio packs) turned into
 * #RRGGBBAA. Anything else is dropped.
 */
export function badgeColor(value) {
  if (typeof value !== "string") return "";
  const hex = value.trim();
  if (HEX.test(hex)) return hex.toUpperCase();
  const argb = /^#([0-9A-Fa-f]{2})([0-9A-Fa-f]{6})$/.exec(hex);
  return argb ? `#${argb[2]}${argb[1]}`.toUpperCase() : "";
}

/**
 * Patterns written for Java or Kotlin (Nuvio packs) in the form JavaScript
 * runs: inline flags dropped (matching is case-insensitive anyway), atomic
 * groups made plain, possessive quantifiers made greedy.
 */
export function normalizePattern(pattern) {
  if (typeof pattern !== "string") return "";
  return pattern
    .trim()
    .replace(/\(\?[imsux-]+\)/g, "")
    .replace(/\(\?[imsux-]+:/g, "(?:")
    .replace(/\(\?>/g, "(?:")
    .replace(/([*+?}])\+/g, "$1");
}

/**
 * A pattern Riwaq will run: a valid expression of at most 600 characters,
 * without a quantified group that contains a quantifier, the shape behind
 * catastrophic backtracking. Returns the error, or "" when it is fine.
 */
export function patternProblem(pattern) {
  if (typeof pattern !== "string" || !pattern.trim()) return "اكتب نمطاً";
  if (pattern.length > PATTERN_MAX) return `النمط أطول من ${PATTERN_MAX} حرف`;
  // "(?:[^.]*\.)" repeated is safe: the run cannot swallow its own
  // delimiter, so it is set aside before looking for nested repetition.
  const checked = pattern.replace(/\(\?:\[\^\\?([^\]\\])\]\*\\?\1\)/g, "(?:x)");
  if (/\([^()]*[+*][^()]*\)\s*(?:[+*]|\{\d*,)/.test(checked))
    return "هذا النمط قد يبطئ رِواق كثيراً؛ بسّطه";
  if (/\\[1-9]/.test(pattern)) return "المراجع الخلفية غير مدعومة";
  try {
    new RegExp(pattern, "i");
  } catch {
    return "النمط غير صحيح";
  }
  return "";
}

const safeId = (value) =>
  String(value || "")
    .replace(/[^\w-]/g, "")
    .slice(0, 40);

/** The viewer's rules, each validated; broken ones are dropped. */
export function cleanBadgeRules(input) {
  const out = [];
  for (const r of Array.isArray(input) ? input : []) {
    if (!r || typeof r !== "object") continue;
    const id = /^[\w-]{1,40}$/.test(r.id || "") ? r.id : "";
    const label = text(r.label ?? r.name, 40);
    const pattern = normalizePattern(r.pattern);
    if (
      !id ||
      !label ||
      patternProblem(pattern) ||
      out.some((x) => x.id === id)
    )
      continue;
    const rule = {
      id,
      label,
      pattern,
      color: badgeColor(r.color) || DEFAULT_COLOR,
      enabled: r.enabled !== false,
    };
    const image = badgeImage(r.image);
    if (image) rule.image = image;
    const textColor = badgeColor(r.textColor);
    if (textColor) rule.textColor = textColor;
    const border = badgeColor(r.borderColor);
    if (border) rule.borderColor = border;
    if (STYLES.includes(r.style) && r.style !== "filled") rule.style = r.style;
    const pack = text(r.pack, 60);
    if (pack) rule.pack = pack;
    out.push(rule);
    if (out.length >= RULE_LIMIT) break;
  }
  return out;
}

export const cleanHiddenBadges = (input) =>
  Array.isArray(input)
    ? [...new Set(input.filter((k) => BADGE_KINDS.some(([id]) => id === k)))]
    : [];

// --- Badge art: pictures for the built-in chips ----------------------------

/** The built-in chip values a picture can stand in for. */
export const ART_KEYS = [
  "8k",
  "4k",
  "1440p",
  "1080p",
  "720p",
  "576p",
  "480p",
  "sd",
  "dv",
  "hdr10+",
  "hdr10",
  "hdr",
  "hlg",
  "hevc",
  "av1",
  "avc",
  "vp9",
  "remux",
  "bluray",
  "webdl",
  "webrip",
  "hdtv",
  "dvd",
  "scr",
  "telecine",
  "telesync",
  "cam",
  "atmos",
  "dts-x",
  "truehd",
  "dts-hd-ma",
  "dts-hd",
  "dts",
  "ddp",
  "dd",
  "flac",
  "aac",
  "opus",
  "mp3",
  "5.1",
  "7.1",
  "2.0",
  "imax",
];

/** Names used in packs for those values, lower-cased and trimmed. */
const ART_NAMES = {
  "8k": "8k",
  "4320p": "8k",
  "4k": "4k",
  "2160p": "4k",
  uhd: "4k",
  "4k uhd": "4k",
  "ultra hd": "4k",
  "4k ultra hd": "4k",
  "2k": "1440p",
  "1440p": "1440p",
  qhd: "1440p",
  "1080p": "1080p",
  fhd: "1080p",
  "full hd": "1080p",
  "720p": "720p",
  hd: "720p",
  "576p": "576p",
  "480p": "480p",
  sd: "sd",
  dv: "dv",
  "dolby vision": "dv",
  dovi: "dv",
  "hdr10+": "hdr10+",
  hdr10plus: "hdr10+",
  "hdr10 plus": "hdr10+",
  hdr10: "hdr10",
  hdr: "hdr",
  hlg: "hlg",
  hevc: "hevc",
  x265: "hevc",
  h265: "hevc",
  "h.265": "hevc",
  av1: "av1",
  avc: "avc",
  x264: "avc",
  h264: "avc",
  "h.264": "avc",
  vp9: "vp9",
  remux: "remux",
  bluray: "bluray",
  "blu-ray": "bluray",
  "blu ray": "bluray",
  "web-dl": "webdl",
  "web dl": "webdl",
  webdl: "webdl",
  web: "webdl",
  webrip: "webrip",
  "web-rip": "webrip",
  hdtv: "hdtv",
  dvd: "dvd",
  dvdrip: "dvd",
  scr: "scr",
  screener: "scr",
  telecine: "telecine",
  tc: "telecine",
  telesync: "telesync",
  ts: "telesync",
  cam: "cam",
  hdcam: "cam",
  atmos: "atmos",
  "dolby atmos": "atmos",
  "dts-x": "dts-x",
  "dts:x": "dts-x",
  dtsx: "dts-x",
  "dts x": "dts-x",
  truehd: "truehd",
  "true hd": "truehd",
  "dolby truehd": "truehd",
  "dts-hd ma": "dts-hd-ma",
  "dts hd ma": "dts-hd-ma",
  "dts-hd": "dts-hd",
  "dts hd": "dts-hd",
  dts: "dts",
  "dd+": "ddp",
  ddp: "ddp",
  eac3: "ddp",
  "e-ac3": "ddp",
  "dolby digital plus": "ddp",
  dd: "dd",
  ac3: "dd",
  "dolby digital": "dd",
  flac: "flac",
  aac: "aac",
  opus: "opus",
  mp3: "mp3",
  5.1: "5.1",
  7.1: "7.1",
  "2.0": "2.0",
  stereo: "2.0",
  imax: "imax",
  "imax enhanced": "imax",
  // Harbor's own kind names, as its packs and exports carry them.
  "4k-uhd": "4k",
  "2k-qhd": "1440p",
  "hdr10-plus": "hdr10+",
  "dts-hd-ma": "dts-hd-ma",
};

/** The art key a pack's badge name stands for, or "". */
export function artKeyFor(name) {
  const norm = String(name || "")
    .toLowerCase()
    .replace(/[^\w+.:\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return ART_NAMES[norm] || "";
}

/** The viewer's badge art: known keys to HTTPS pictures. */
export function cleanBadgeArt(input) {
  const out = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  for (const key of ART_KEYS) {
    const image = badgeImage(input[key]);
    if (image) out[key] = image;
  }
  return out;
}

/**
 * The art keys for one chip value, best first: a stream read as "DV+HDR10"
 * shows Dolby Vision and HDR10, and HDR10 falls back to a plain HDR picture.
 */
export function artKeys(kind, value) {
  const v = String(value ?? "");
  switch (kind) {
    case "resolution": {
      const n = Number(value) || 0;
      if (n >= 4320) return ["8k"];
      if (n >= 2160) return ["4k"];
      if (n >= 1440) return ["1440p"];
      if (n >= 1080) return ["1080p"];
      if (n >= 720) return ["720p"];
      if (n >= 576) return ["576p"];
      if (n >= 480) return ["480p"];
      return n ? ["sd"] : [];
    }
    case "hdr":
      return v
        .split("+HDR")
        .map((part, i) => (i ? `HDR${part}` : part))
        .map((part) =>
          part === "DV"
            ? "dv"
            : part === "HDR10+"
              ? "hdr10+"
              : part === "HDR10"
                ? "hdr10"
                : part === "HLG"
                  ? "hlg"
                  : "",
        )
        .filter(Boolean);
    case "codec":
      return (
        { HEVC: ["hevc"], AV1: ["av1"], AVC: ["avc"], VP9: ["vp9"] }[v] || []
      );
    case "source":
      return (
        {
          REMUX: ["remux"],
          BluRay: ["bluray"],
          BDRip: ["bluray"],
          "WEB-DL": ["webdl"],
          WEBRip: ["webrip"],
          HDTV: ["hdtv"],
          DVDRip: ["dvd"],
          SCR: ["scr"],
          TC: ["telecine"],
          TS: ["telesync"],
          CAM: ["cam"],
        }[v] || []
      );
    case "audio":
      return (
        {
          Atmos: ["atmos"],
          "DTS-X": ["dts-x"],
          TrueHD: ["truehd"],
          "DTS-HD MA": ["dts-hd-ma", "dts-hd"],
          DTS: ["dts"],
          "DD+": ["ddp"],
          AC3: ["dd"],
          FLAC: ["flac"],
          AAC: ["aac"],
          Opus: ["opus"],
          MP3: ["mp3"],
        }[v] || []
      );
    case "channels":
      return ["5.1", "7.1", "2.0"].includes(v) ? [v] : [];
    default:
      return [];
  }
}

/** The pictures standing in for a chip, or [] to keep its text. */
export function chipArt(art, kind, value) {
  if (!art) return [];
  const keys = artKeys(kind, value);
  if (kind === "hdr" && keys.length > 1) {
    const all = keys.map((k) => art[k] || (k === "hdr10" ? art.hdr : ""));
    return all.every(Boolean) ? all : [];
  }
  for (const k of keys) if (art[k]) return [art[k]];
  if (kind === "hdr" && keys[0] === "hdr10" && art.hdr) return [art.hdr];
  return [];
}

// --- Matching ----------------------------------------------------------------

const compiled = new Map();
const compile = (pattern) => {
  if (!compiled.has(pattern)) {
    let re = null;
    try {
      re = new RegExp(pattern, "i");
    } catch {
      /* A rule that stopped compiling simply earns nothing. */
    }
    if (compiled.size > 2000) compiled.clear();
    compiled.set(pattern, re);
  }
  return compiled.get(pattern);
};

/**
 * The custom badges a stream earns from the enabled rules. Past `deadline`
 * (a Date.now() time) no more rules are tried.
 */
export function ruleBadges(stream, rules, deadline = Infinity) {
  const subject = `${stream?.name || ""} ${stream?.title || ""}`.slice(
    0,
    TITLE_MAX,
  );
  const out = [];
  for (const rule of rules || []) {
    if (!rule.enabled) continue;
    if (Date.now() > deadline) break;
    if (!compile(rule.pattern)?.test(subject)) continue;
    const badge = { label: rule.label, color: rule.color };
    for (const key of ["image", "textColor", "borderColor", "style"])
      if (rule[key]) badge[key] = rule[key];
    out.push(badge);
    if (out.length >= MATCH_LIMIT) break;
  }
  return out;
}

// --- Packs -------------------------------------------------------------------

const PACK = "riwaq-badges";
/** A pack to share: the rules, the art and the hidden kinds. */
export function exportBadgePack(settings = {}) {
  return JSON.stringify(
    {
      format: PACK,
      version: 2,
      rules: cleanBadgeRules(settings.badgeRules).map(
        ({ id, enabled, pack, ...rule }) => rule,
      ),
      art: cleanBadgeArt(settings.badgeArt),
      hidden: cleanHiddenBadges(settings.badgesHidden),
    },
    null,
    2,
  );
}

/**
 * JSON as people share it: a byte-order mark, raw line breaks inside
 * strings, or a missing comma at the end of a line are forgiven.
 */
export function parsePackText(raw) {
  if (typeof raw !== "string") return raw;
  if (raw.length > PACK_TEXT_MAX) throw new Error("الحزمة أكبر من المسموح");
  const src = raw.replace(/^﻿/, "");
  try {
    return JSON.parse(src);
  } catch {
    /* repaired below */
  }
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of src) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      else if (ch === "\n") {
        out += "\\n";
        continue;
      } else if (ch === "\r" || ch === "\t") {
        out += ch === "\t" ? "\\t" : "";
        continue;
      }
    } else if (ch === '"') inString = true;
    out += ch;
  }
  try {
    return JSON.parse(out);
  } catch {
    /* one more try below */
  }
  try {
    return JSON.parse(
      out.replace(
        /("(?:[^"\\]|\\.)*"|true|false|null|-?\d[\d.eE+-]*|[}\]])(\s*\n\s*)(?=["{[])/g,
        "$1,$2",
      ),
    );
  } catch {
    throw new Error("الملف ليس JSON صالحاً");
  }
}

/**
 * Reads a pack in any of the formats people share:
 * - Riwaq's own: { format: "riwaq-badges", rules, art, hidden };
 * - Harbor's: { overrides: { kind: { image } }, rules: [{ name, pattern, image,
 *   tagColor, textColor, borderColor, tagStyle }] };
 * - Nuvio's: { filters: [{ id, name, pattern, imageURL, isEnabled, ... }] };
 * - a bare list of { label | name, pattern | regex, color }.
 * A badge whose name is a built-in value (4K, Atmos...) and that has a
 * picture becomes badge art; the rest become rules. Every rule then goes
 * through the same cleaning as the viewer's own.
 */
export function importBadgePack(json, makeId, { name = "" } = {}) {
  const data = parsePackText(json);
  const pack = text(name, 60);
  const art = {};
  const raw = [];
  let total = 0;
  let disabled = 0;
  const add = (entry) => {
    total++;
    const key = artKeyFor(entry.name);
    const image = badgeImage(entry.image);
    if (key && image && !art[key]) {
      art[key] = image;
      return;
    }
    raw.push(entry);
  };
  if (Array.isArray(data?.filters)) {
    for (const f of data.filters) {
      if (!f || typeof f !== "object") continue;
      if (f.isEnabled === false) {
        total++;
        disabled++;
        continue;
      }
      add({
        id: f.id,
        name: f.name,
        pattern: f.pattern,
        image: f.imageURL ?? f.image,
        color: f.tagColor,
        textColor: f.textColor,
        borderColor: f.borderColor,
        style: f.tagStyle,
      });
    }
  } else {
    const list = Array.isArray(data) ? data : data?.rules;
    if (data?.overrides && typeof data.overrides === "object") {
      for (const [kind, value] of Object.entries(data.overrides)) {
        const key = artKeyFor(kind);
        const image = badgeImage(value?.image);
        total++;
        if (key && image) art[key] = image;
      }
    }
    if (data?.art && typeof data.art === "object")
      Object.assign(art, cleanBadgeArt(data.art));
    for (const r of Array.isArray(list) ? list : []) {
      if (!r || typeof r !== "object") continue;
      if (r.enabled === false) {
        total++;
        disabled++;
        continue;
      }
      add({
        id: r.id,
        name: r.label ?? r.name,
        pattern: r.pattern ?? r.regex,
        image: r.image ?? r.imageURL,
        color: r.color ?? r.tagColor,
        textColor: r.textColor,
        borderColor: r.borderColor,
        style: r.style ?? r.tagStyle,
      });
    }
  }
  if (!total) throw new Error("لم نجد قاعدة صالحة في هذا الملف");
  // A named pack gets stable IDs, so importing it again replaces its rules.
  const prefix =
    safeId(pack.toLowerCase().replace(/[^a-z0-9]+/g, "")).slice(0, 12) ||
    "pack";
  const used = new Set();
  const rules = cleanBadgeRules(
    raw.slice(0, RULE_LIMIT * 2).map((r, i) => {
      let id = makeId
        ? makeId(i)
        : `${prefix}-${safeId(r.id) || i}`.slice(0, 40);
      while (used.has(id)) id = `${id.slice(0, 36)}-${i}`;
      used.add(id);
      return { ...r, id, label: r.name, pack };
    }),
  );
  const cleanArt = cleanBadgeArt(art);
  if (!rules.length && !Object.keys(cleanArt).length)
    throw new Error("لم نجد قاعدة صالحة في هذا الملف");
  return {
    rules,
    art: cleanArt,
    hidden: cleanHiddenBadges(data?.hidden),
    total,
    skipped: total - disabled - rules.length - Object.keys(cleanArt).length,
    disabled,
  };
}

/**
 * The address of a pack to fetch: HTTPS, no credentials, not a machine on
 * the viewer's own network (a pasted link must not reach into their LAN).
 */
export function packUrl(input) {
  let url;
  try {
    url = new URL(String(input || "").trim());
  } catch {
    throw new Error("الصق رابط الحزمة كاملاً، مثل https://…/badges.json");
  }
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("استخدم رابط https بلا اسم مستخدم أو كلمة مرور");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".localhost") ||
    /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
      host,
    ) ||
    host === "::1" ||
    /^f[cd][0-9a-f]{2}:/.test(host) ||
    /^fe80:/.test(host) ||
    (!host.includes(".") && !host.includes(":"))
  )
    throw new Error("هذا الرابط يشير إلى جهاز في شبكتك، وليس حزمة منشورة");
  url.hash = "";
  return url.toString();
}

/**
 * Fetches a pack's text, following at most three redirects and checking
 * every hop with `packUrl`. Nothing is sent but the request itself.
 */
export async function fetchPackText(
  input,
  { fetch: get = globalThis.fetch, timeout = 15000 } = {},
) {
  let url = packUrl(input);
  for (let hop = 0; hop < 4; hop++) {
    let response;
    try {
      response = await get(url, {
        redirect: "manual",
        headers: { Accept: "application/json, text/plain" },
        signal: AbortSignal.timeout(timeout),
      });
    } catch {
      throw new Error("تعذّر الوصول إلى رابط الحزمة");
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = response.headers.get("location");
      if (!next) throw new Error("تحويل بلا وجهة");
      url = packUrl(new URL(next, url).toString());
      continue;
    }
    if (!response.ok)
      throw new Error(`لم يُتح الرابط الحزمة (HTTP ${response.status})`);
    if (Number(response.headers.get("content-length") || 0) > PACK_TEXT_MAX)
      throw new Error("الحزمة أكبر من المسموح");
    const body = await response.text();
    if (body.length > PACK_TEXT_MAX) throw new Error("الحزمة أكبر من المسموح");
    return { text: body, name: new URL(url).hostname };
  }
  throw new Error("تحويلات كثيرة");
}
