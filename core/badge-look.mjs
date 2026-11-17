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
 *   one fetches that style's JSON from its pinned address on GitHub (main
 *   only, the fixed URL below: nothing typed by anyone), reads it with the
 *   same importer and checks as any pack (core/badges.mjs), and keeps the
 *   badges' pictures as addresses: they load from GitHub when the sources
 *   show, and a picture that fails falls back to a Liquid Glass chip.
 * - "Off" is badgesOn: false, the switch that already hid every chip.
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

/** FR-Badges' raw files on GitHub; nothing else is ever fetched here. */
export const FR_BASE =
  "https://raw.githubusercontent.com/farizmohd70/FR-Badges/main/";
export const FR_STYLES = {
  "fr-glass": { file: "badges.json", pack: "FR-Badges Glass" },
  "fr-frost": { file: "badges-frost.json", pack: "FR-Badges Frost" },
  "fr-minimal": { file: "badges-minimal.json", pack: "FR-Badges Minimal" },
};
const FR_PACKS = new Set(Object.values(FR_STYLES).map((s) => s.pack));

export const isFrLook = (look) => Object.hasOwn(FR_STYLES, look);

/** The one address a look may fetch, or "". */
export const frStyleUrl = (look) =>
  isFrLook(look) ? FR_BASE + FR_STYLES[look].file : "";

/** A picture that came from FR-Badges (so leaving the style removes it). */
export const isFrImage = (url) =>
  typeof url === "string" && url.startsWith(FR_BASE);

/** A rule that came with an FR-Badges style. */
export const isFrRule = (rule) => FR_PACKS.has(rule?.pack);

const ownArt = (art) =>
  Object.fromEntries(
    Object.entries(cleanBadgeArt(art)).filter(([, v]) => !isFrImage(v)),
  );

/**
 * Settings after choosing an FR-Badges style, from a pack the importer read.
 * The viewer's own rules come first and stay whole; the style's badges fill
 * the room left under the rule limit, best groups first (orderRules). A
 * style chosen again replaces its earlier badges. The report counts what
 * loaded and what did not fit.
 */
export function chooseFrStyle(settings = {}, pack, look) {
  if (!isFrLook(look) || !pack) throw new Error("نمط غير معروف");
  const name = FR_STYLES[look].pack;
  const own = cleanBadgeRules(settings.badgeRules).filter((r) => !isFrRule(r));
  const room = Math.max(0, RULE_LIMIT - own.length);
  const incoming = orderRules(
    cleanBadgeRules(pack.rules).map((r) => ({ ...r, pack: name })),
  );
  const loaded = incoming.slice(0, room);
  const art = cleanBadgeArt(pack.art);
  return {
    patch: {
      badgeLook: look,
      badgesOn: true,
      badgeRules: [...own, ...loaded],
      badgeArt: { ...ownArt(settings.badgeArt), ...art },
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
  };
}

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
