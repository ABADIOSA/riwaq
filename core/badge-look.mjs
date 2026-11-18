/**
 * How the stream badges look (Settings → Sources → Stream badges →
 * "Stream badge appearance"; the November 2026 beta, replacing the Harbor
 * badge packs page of issue #152).
 *
 * - riwaq: Riwaq's own text chips, as before (the default; nobody's look
 *   changes unless they choose).
 * - liquid: the same chips drawn as Riwaq's Liquid Glass (src/liquid.css):
 *   local CSS only, nothing fetched.
 * - fr-glass, fr-frost, fr-minimal: FR-Badges by farizmohd70 (MIT), its
 *   "Lite" files of 219 badges in three of its fourteen styles. Choosing
 *   one fetches that style's JSON from its address at one pinned commit
 *   (the fixed URL below: nothing typed by anyone; size and SHA-256
 *   checked), reads it with the same importer and checks as any pack
 *   (core/badges.mjs), and keeps the badges' pictures as addresses at the
 *   same commit: they load from GitHub when the sources show, and a
 *   picture that fails falls back to a Liquid Glass chip.
 * - "Off" is badgesOn: false: it hides every built-in chip and an
 *   FR-Badges style's badges; the viewer's own rules stay.
 *
 * The full FR-Badges library (732 kinds per style) is not imported: it is
 * larger than the 250 rules a profile keeps, and importing part of it while
 * calling it complete is exactly what this module refuses to do. The
 * report says how many badges loaded and how many did not fit.
 * Browser-safe.
 */
import { RULE_LIMIT, cleanBadgeArt, cleanBadgeRules } from "./badges.mjs";

export const BADGE_LOOKS = [
  "riwaq",
  "liquid",
  "fr-glass",
  "fr-frost",
  "fr-minimal",
];

/**
 * FR-Badges' raw files on GitHub, pinned to one commit (PR #155 review,
 * security): a commit's files never change, and each is checked against
 * its size and SHA-256 before it is read, so a change upstream cannot
 * alter what a profile receives. The badges' pictures are pinned to the
 * same commit; a picture anywhere else is dropped. Nothing else is ever
 * fetched here. A newer FR-Badges is a reviewed change to these lines.
 */
export const FR_COMMIT = "3fae65b65bb8859003eb8f6b5d4e51a0065b3901";
const FR_REPO = "https://raw.githubusercontent.com/farizmohd70/FR-Badges/";
export const FR_BASE = `${FR_REPO}${FR_COMMIT}/`;
export const FR_STYLES = {
  "fr-glass": {
    file: "badges.json",
    pack: "FR-Badges Glass",
    bytes: 161875,
    sha256: "a8db847ce4f2b509ed3db69b1e9492e599d5f9ddd1d077d0fafddd945cbae326",
  },
  "fr-frost": {
    file: "badges-frost.json",
    pack: "FR-Badges Frost",
    bytes: 163189,
    sha256: "8327df32fa2d4edb7e68516df025d99a2533f4c12b61f2329a67a3f473e15835",
  },
  "fr-minimal": {
    file: "badges-minimal.json",
    pack: "FR-Badges Minimal",
    bytes: 163627,
    sha256: "ef5437d7bd0acc7b397490acbe60985db75a7c643ee565019a0ffe774c6a93e3",
  },
};
const FR_PACKS = new Set(Object.values(FR_STYLES).map((s) => s.pack));
/** The most a style file may be: well above the pinned sizes, far below a pack's 3 MB. */
export const FR_MAX_BYTES = 512 * 1024;

export const isFrLook = (look) => Object.hasOwn(FR_STYLES, look);
/** Said when a newer look was chosen before a style finished (R3). */
export const LOOK_SUPERSEDED =
  "اخترت غير ذلك قبل اكتمال هذا؛ بقي اختيارك الأحدث";

/** The one address a look may fetch, or "". */
export const frStyleUrl = (look) =>
  isFrLook(look) ? FR_BASE + FR_STYLES[look].file : "";

/** A picture that came from FR-Badges, at any commit (leaving the style removes it). */
export const isFrImage = (url) =>
  typeof url === "string" && url.startsWith(FR_REPO);

/**
 * An FR-Badges picture as Riwaq keeps it: at the pinned commit (the files
 * name "main", which moves), a plain relative path inside the repository,
 * or "" for anything else.
 */
export function frImage(url) {
  if (typeof url !== "string") return "";
  const prefix = [FR_BASE, `${FR_REPO}main/`].find((p) => url.startsWith(p));
  if (!prefix) return "";
  const path = url.slice(prefix.length);
  if (!/^[\w%][\w%./-]{0,300}$/.test(path) || path.split("/").includes(".."))
    return "";
  return FR_BASE + path;
}
/** Pictures an FR-Badges style gives the built-in chips, as safeSettings keeps them. */
export const cleanStyleArt = (art) => frArt(art);
const frArt = (art) =>
  Object.fromEntries(
    Object.entries(cleanBadgeArt(art))
      .map(([k, v]) => [k, frImage(v)])
      .filter(([, v]) => v),
  );

/** A rule that came with an FR-Badges style. */
export const isFrRule = (rule) => FR_PACKS.has(rule?.pack);

const ownArt = (art) =>
  Object.fromEntries(
    Object.entries(cleanBadgeArt(art)).filter(([, v]) => !isFrImage(v)),
  );

/**
 * Fetches one FR-Badges style file (main and the web bridge): only an
 * address frStyleUrl gives, no redirect, credentials never sent, a 15 s
 * limit, text or JSON only, read in pieces and stopped past FR_MAX_BYTES,
 * then its size and SHA-256 compared with the pinned ones. Returns the
 * text. Browser-safe (WebCrypto).
 */
export async function fetchFrStyle(
  url,
  { fetch: get = globalThis.fetch, timeout = 15000 } = {},
) {
  const style = Object.values(FR_STYLES).find((s) => FR_BASE + s.file === url);
  if (!style) throw new Error("نمط غير معروف");
  const fail = (message) => {
    throw new Error(message);
  };
  let response;
  try {
    response = await get(url, {
      redirect: "error",
      credentials: "omit",
      headers: { Accept: "application/json, text/plain" },
      signal: AbortSignal.timeout(timeout),
    });
  } catch {
    fail("تعذّر الوصول إلى ملف النمط");
  }
  if (!response.ok) fail(`لم يُتح ملف النمط (HTTP ${response.status})`);
  const type = String(response.headers.get("content-type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (type && type !== "text/plain" && type !== "application/json")
    fail("ملف النمط ليس نصاً");
  if (Number(response.headers.get("content-length") || 0) > FR_MAX_BYTES)
    fail("ملف النمط أكبر من المسموح");
  const parts = [];
  let size = 0;
  const reader = response.body?.getReader?.();
  if (reader) {
    for (;;) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch {
        fail("انقطع تحميل ملف النمط");
      }
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > FR_MAX_BYTES) {
        reader.cancel().catch(() => {});
        fail("ملف النمط أكبر من المسموح");
      }
      parts.push(chunk.value);
    }
  } else {
    const buffer = new Uint8Array(await response.arrayBuffer());
    size = buffer.byteLength;
    if (size > FR_MAX_BYTES) fail("ملف النمط أكبر من المسموح");
    parts.push(buffer);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.byteLength;
  }
  const digest = Array.from(
    new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  if (size !== style.bytes || digest !== style.sha256)
    fail("ملف النمط لا يطابق النسخة المثبّتة");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/**
 * Settings after choosing an FR-Badges style, from a pack the importer read.
 * The viewer's own rules come first and stay whole; the style's badges fill
 * the room left under the rule limit, best groups first (orderRules). A
 * style chosen again replaces its earlier badges. The report counts what
 * loaded and what did not fit.
 *
 * The style's pictures for the built-in chips go to their own field,
 * badgeStyleArt, never into the viewer's badgeArt: a picture the viewer
 * set for 4K stays theirs, is drawn first, and is still there after
 * leaving the style (PR #155 review, F6). Pictures outside FR-Badges'
 * pinned commit are dropped.
 */
export function chooseFrStyle(settings = {}, pack, look) {
  if (!isFrLook(look) || !pack) throw new Error("نمط غير معروف");
  const name = FR_STYLES[look].pack;
  const own = cleanBadgeRules(settings.badgeRules).filter((r) => !isFrRule(r));
  const room = Math.max(0, RULE_LIMIT - own.length);
  const incoming = orderRules(
    cleanBadgeRules(pack.rules).map((r) => {
      const { image, ...rest } = r;
      const pinned = frImage(image);
      return { ...rest, ...(pinned ? { image: pinned } : {}), pack: name };
    }),
  );
  const loaded = incoming.slice(0, room);
  const art = frArt(pack.art);
  return {
    patch: {
      badgeLook: look,
      badgesOn: true,
      badgeRules: [...own, ...loaded],
      badgeArt: ownArt(settings.badgeArt),
      badgeStyleArt: art,
    },
    report: {
      style: name,
      loaded: loaded.length,
      pictures: Object.keys(art).length,
      over: incoming.length - loaded.length,
      skipped: Math.max(0, Number(pack.skipped) || 0),
      disabled: Math.max(0, Number(pack.disabled) || 0),
      total: Math.max(0, Number(pack.total) || 0),
      own: own.length,
    },
  };
}

/** Leaving an FR-Badges style: its badges and pictures go, the rest stays. */
export function chooseLook(settings = {}, look) {
  if (!BADGE_LOOKS.includes(look) || isFrLook(look))
    throw new Error("نمط غير معروف");
  return {
    badgeLook: look,
    badgesOn: true,
    badgeRules: cleanBadgeRules(settings.badgeRules).filter(
      (r) => !isFrRule(r),
    ),
    badgeArt: ownArt(settings.badgeArt),
    badgeStyleArt: {},
  };
}

/** The pictures the built-in chips use: the viewer's own first, then the style's. */
export const chipPictures = (settings = {}) => ({
  ...frArt(settings.badgeStyleArt),
  ...ownArt(settings.badgeArt),
});

/**
 * The badges a stream shows: with badges off ("بدون شارات") an FR-Badges
 * style's badges go with the built-in chips; the viewer's own rules stay,
 * as the choice says (F6).
 */
export const visibleBadges = (badges = [], settings = {}) =>
  settings.badgesOn === false
    ? badges.filter((b) => !FR_PACKS.has(b?.pack))
    : badges;

// --- Order and duplicates ----------------------------------------------------

/**
 * Badge groups (FR-Badges' own group IDs) in the order a row keeps them
 * when space is short: quality, then HDR, then audio, then the kind of
 * source, then languages. The viewer's own rules (no group) lead.
 */
export const BADGE_GROUPS = [
  "resolution",
  "dynamic-range",
  "video-format",
  "audio-codec",
  "audio-channels",
  "source",
  "video-codec",
  "editions",
  "debrid",
  "streaming",
  "languages",
  "subtitles",
  "audio-subs",
  "containers",
];
const RANK = new Map(BADGE_GROUPS.map((g, i) => [g, i + 1]));
const rank = (badge) => RANK.get(badge?.group) ?? 0;

/** Rules or badges in that order; equal ones keep theirs. */
export function orderRules(list = []) {
  return list
    .map((item, i) => ({ item, i }))
    .sort((a, b) => rank(a.item) - rank(b.item) || a.i - b.i)
    .map(({ item }) => item);
}
export const orderBadges = orderRules;

/**
 * The built-in chip a badge group stands for: when a stream shows the
 * group's badge, the chip with the same fact is not drawn again.
 */
const GROUP_KIND = {
  resolution: "resolution",
  "dynamic-range": "hdr",
  "video-codec": "codec",
  source: "source",
  "audio-codec": "audio",
  debrid: "cached",
  subtitles: "arabic",
  languages: "arabic",
};
export function coveredKinds(badges = []) {
  const kinds = new Set();
  for (const b of badges)
    if (GROUP_KIND[b?.group]) kinds.add(GROUP_KIND[b.group]);
  // FR-Badges' Arabic subtitles badge says what the chip says; another
  // language's subtitles do not cover the Arabic chip.
  if (
    kinds.has("arabic") &&
    !badges.some(
      (b) =>
        (b.group === "subtitles" || b.group === "languages") &&
        /arabic|العربية|عرب/i.test(b.label || ""),
    )
  )
    kinds.delete("arabic");
  return kinds;
}

/**
 * The badges a row shows when it has room for `room`, and how many wait
 * behind "+N" (their labels go in its tooltip).
 */
export function fitBadges(badges = [], room = 6) {
  const ordered = orderBadges(badges);
  const seen = new Set();
  const unique = ordered.filter((b) => {
    const key = `${b.group || ""}:${String(b.label || "").toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const n = Math.max(0, Math.floor(room));
  return { shown: unique.slice(0, n), more: unique.slice(n) };
}
