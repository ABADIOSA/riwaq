/**
 * Riwaq's own sections for addon catalogs, for viewers who never build
 * collections or who install so many addons that one row per catalog buries
 * the home page.
 *
 * Every catalog row goes to one group: suggestions for the viewer, films,
 * series, Arabic, anime, channels and live, sport, videos, or other. A
 * catalog is placed by its declared type first, then by words in its name
 * and its addon's name, and when an addon names its type after a list ("DC",
 * "Berserk", "Top Fantasy/Sci-Fi Movies"), by what most of its titles are.
 *
 * On home each group is one shelf: chips for its catalogs plus "all", which
 * blends them one title from each in turn. Discover uses the same groups as
 * its tabs. Pure functions; SmartHome.jsx draws.
 */

import { interleave } from "./folder-view.mjs";

export const SMART_GROUPS = [
  ["foryou", "مقترحة لك"],
  ["movies", "أفلام"],
  ["series", "مسلسلات"],
  ["arabic", "عربي"],
  ["anime", "أنمي"],
  ["live", "قنوات وبث مباشر"],
  ["sports", "رياضة"],
  ["videos", "يوتيوب وفيديو"],
  ["other", "أخرى"],
];
export const SMART_IDS = SMART_GROUPS.map(([id]) => id);
export const GROUP_NAME = Object.fromEntries(SMART_GROUPS);

/**
 * How home lays out titles: Riwaq's own rows (core/feed.mjs) with the
 * addons' groups the rows do not cover, the addons' groups alone, or one
 * row per addon catalog. "auto" is Riwaq's rows until the viewer builds
 * collections of their own.
 */
export const HOME_GROUPING = ["auto", "riwaq", "groups", "rows"];

const WORDS = {
  foryou:
    /\b(recommend(?:ed|ations)?|for you|because you|your (?:list|watchlist|picks)|watchlist|up next|continue)\b|مقترح|مقترحة|من أجلك|قائمتي|قائمة المشاهدة/i,
  live: /\b(live|iptv|channels?|tv guide|epg|events?|streams? tv|24\/7)\b|قنوات|قناة|بث مباشر|مباشر/i,
  sports:
    /\b(sports?|football|soccer|nba|nfl|nhl|mlb|ufc|mma|wwe|boxing|f1|formula ?1|motogp|cricket|tennis|matches)\b|رياض|كورة|كرة|مباريات|دوري/i,
  videos:
    /\b(youtube|yt|vimeo|twitch|dailymotion|podcasts?|shorts|clips?)\b|يوتيوب|بودكاست/i,
  anime:
    /\b(anime|animes|kitsu|anilist|myanimelist|mal|crunchyroll|hianime|animepahe|gogoanime|donghua|manga)\b|أنمي|انمي|انيمي/i,
  arabic:
    /\b(arab(?:ic|city)?|akwam|wecima|we ?cima|my ?cima|cima\w*|egy ?best|egydead|shahid|shahid4u|faselhd|fasel|aflam\w*|alooy\w*|aloodytv|tuktuk\w*|osn|mbc|ramadan|khaleeji|gulf)\b|عرب|عربي|عربية|اكوام|أكوام|سيما|شاهد|فاصل|رمضان|خليجي|مصري|سوري|تركي مدبلج/i,
};

const typeOf = (value) => String(value || "").toLowerCase();

/** What most of a row's titles are: movie, series, anime, tv… or "". */
function mostlyType(metas = []) {
  const counts = {};
  for (const m of metas.slice(0, 40)) {
    const t = typeOf(m?.type);
    if (t) counts[t] = (counts[t] || 0) + 1;
  }
  const [best] = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return best ? best[0] : "";
}

/** The group a catalog row belongs to. */
export function groupOf(row = {}) {
  const type = typeOf(row.type);
  const text = `${row.name || ""} ${row.provider || ""} ${type}`;
  if (WORDS.foryou.test(text)) return "foryou";
  if (["tv", "channel", "channels", "events", "live"].includes(type))
    return WORDS.sports.test(text) ? "sports" : "live";
  if (WORDS.sports.test(text)) return "sports";
  if (
    ["youtube", "video", "videos", "podcast"].includes(type) ||
    WORDS.videos.test(text)
  )
    return "videos";
  if (WORDS.arabic.test(text)) return "arabic";
  if (type === "anime" || WORDS.anime.test(text)) return "anime";
  if (WORDS.live.test(text)) return "live";
  if (type === "movie") return "movies";
  if (type === "series") return "series";
  // A list addon names its type after the list: judge it by its titles.
  const inner = mostlyType(row.metas);
  if (inner === "movie") return "movies";
  if (inner === "series") return "series";
  if (inner === "anime") return "anime";
  if (["tv", "channel", "events"].includes(inner)) return "live";
  return "other";
}

/**
 * Rows gathered into groups, in Riwaq's order, without empty or hidden
 * groups. Rows keep their own order (the viewer's arrangement) inside a group.
 */
export function groupRows(rows = [], { hidden = [] } = {}) {
  const off = new Set(hidden);
  const buckets = new Map(SMART_IDS.map((id) => [id, []]));
  for (const row of rows) {
    if (!row?.metas?.length) continue;
    buckets.get(groupOf(row)).push(row);
  }
  return SMART_GROUPS.filter(
    ([id]) => !off.has(id) && buckets.get(id).length,
  ).map(([id, name]) => ({ id, name, rows: buckets.get(id) }));
}

/** A group's "all" shelf: one title from each catalog in turn, once each. */
export function blendRows(rows = [], limit = 60) {
  return interleave(rows.map((r) => r.metas || [])).slice(0, limit);
}

/** The layout home uses now: "riwaq", "groups" or "rows". */
export function homeLayout(mode, collections = []) {
  if (mode === "riwaq" || mode === "groups" || mode === "rows") return mode;
  return Array.isArray(collections) && collections.length ? "rows" : "riwaq";
}

/**
 * The addon groups shown under Riwaq's rows: films and series come from
 * Riwaq's rows, and so do Arabic and anime when TMDB supplies them.
 */
export function groupsBesideFeed(feedHasLanguages) {
  return SMART_IDS.filter(
    (id) =>
      !["movies", "series"].includes(id) &&
      !(feedHasLanguages && ["anime"].includes(id)),
  );
}

/** The hidden-group list from settings, validated. */
export function cleanSmartHidden(input) {
  return Array.isArray(input)
    ? [...new Set(input.filter((id) => SMART_IDS.includes(id)))]
    : [];
}
