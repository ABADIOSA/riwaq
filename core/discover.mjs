/**
 * Discover arranged by Riwaq, like home (core/feed.mjs): sections for what
 * titles are (films, series, Arabic, from around the world, anime, family,
 * documentaries), each holding rows by genre, chart or language. No addon is
 * named anywhere on the page: the addons' own catalogs are folded into the
 * section their titles belong to (core/smart-groups.mjs) and shown as one
 * blended row per kind, without catalog or addon names.
 *
 * - With the viewer's TMDB key, rows are TMDB charts and discover queries in
 *   the metadata language, matched to IMDb IDs (Client.tmdbRow).
 * - Without it, rows are Cinemeta's public catalogs by genre. Cinemeta knows
 *   no languages, so the Arabic, world and anime sections then hold only
 *   what the addons offer, and the page says the key would fill them.
 *
 * Rows travel through the catalog loader as `feed:d-…` keys, so a row's
 * "عرض الكل" opens the same paged full page as home's rows. Pure data.
 */

import { FEED_PREFIX, CINEMETA_BASE } from "./feed.mjs";
import { blendRows, groupOf } from "./smart-groups.mjs";

const day = (offsetDays = 0) =>
  new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

/** Riwaq's sections on Discover, in order. */
export const DISCOVER_TABS = [
  ["movies", "أفلام"],
  ["series", "مسلسلات"],
  ["arabic", "عربي"],
  ["world", "حول العالم"],
  ["anime", "أنمي"],
  ["family", "للعائلة"],
  ["docs", "وثائقي"],
  // Sections only addons fill; shown when an addon has such a catalog.
  ["foryou", "مقترحة لك"],
  ["live", "قنوات وبث مباشر"],
  ["sports", "رياضة"],
  ["videos", "يوتيوب وفيديو"],
  ["other", "المزيد"],
];
export const DISCOVER_IDS = DISCOVER_TABS.map(([id]) => id);
const TAB_NAME = Object.fromEntries(DISCOVER_TABS);
// Sections that need TMDB's languages; Cinemeta cannot fill them.
export const NEEDS_TMDB = ["arabic", "world", "anime"];
const ADDON_ONLY = ["foryou", "live", "sports", "videos", "other"];

const movie = (filters, sort = "popularity.desc") => ({
  kind: "discover",
  media: "movie",
  sort,
  filters,
});
const tv = (filters, sort = "popularity.desc") => ({
  kind: "discover",
  media: "tv",
  sort,
  filters,
});
const chart = (media, name) => ({ kind: "chart", media, chart: name });
const trending = (media) => ({ kind: "trending", media });

/**
 * TMDB rows: [id, section, name, type, source]. Built on each call, so the
 * "recent" windows follow today's date in a session that stays open.
 */
export const discoverTmdbRows = () =>
  [
    ["m-trending", "movies", "رائجة هذا الأسبوع", "movie", trending("movie")],
    ["m-popular", "movies", "الأكثر شعبية", "movie", chart("movie", "popular")],
    [
      "m-new",
      "movies",
      "صدرت حديثاً",
      "movie",
      movie({
        releaseDateGte: day(-150),
        releaseDateLte: day(0),
        voteCountGte: 40,
      }),
    ],
    ["m-top", "movies", "الأعلى تقييماً", "movie", chart("movie", "top_rated")],
    [
      "m-action",
      "movies",
      "أكشن ومغامرة",
      "movie",
      movie({ withGenres: "28|12", voteCountGte: 300 }),
    ],
    [
      "m-comedy",
      "movies",
      "كوميديا",
      "movie",
      movie({ withGenres: "35", voteCountGte: 300 }),
    ],
    [
      "m-drama",
      "movies",
      "دراما",
      "movie",
      movie({ withGenres: "18", voteCountGte: 400 }),
    ],
    [
      "m-thriller",
      "movies",
      "إثارة وجريمة",
      "movie",
      movie({ withGenres: "53|80", voteCountGte: 300 }),
    ],
    [
      "m-horror",
      "movies",
      "رعب",
      "movie",
      movie({ withGenres: "27", voteCountGte: 300 }),
    ],
    [
      "m-scifi",
      "movies",
      "خيال علمي وفانتازيا",
      "movie",
      movie({ withGenres: "878|14", voteCountGte: 300 }),
    ],
    [
      "m-romance",
      "movies",
      "رومانسي",
      "movie",
      movie({ withGenres: "10749", voteCountGte: 300 }),
    ],
    [
      "m-history",
      "movies",
      "تاريخ وحروب",
      "movie",
      movie({ withGenres: "36|10752", voteCountGte: 200 }),
    ],
    [
      "m-classics",
      "movies",
      "كلاسيكيات خالدة",
      "movie",
      movie(
        { releaseDateLte: "1989-12-31", voteCountGte: 1500 },
        "vote_average.desc",
      ),
    ],
    ["s-trending", "series", "رائجة هذا الأسبوع", "series", trending("tv")],
    ["s-popular", "series", "الأكثر شعبية", "series", chart("tv", "popular")],
    [
      "s-airing",
      "series",
      "تُعرض حلقاتها الآن",
      "series",
      chart("tv", "on_the_air"),
    ],
    ["s-top", "series", "الأعلى تقييماً", "series", chart("tv", "top_rated")],
    [
      "s-drama",
      "series",
      "دراما",
      "series",
      tv({ withGenres: "18", voteCountGte: 300 }),
    ],
    [
      "s-crime",
      "series",
      "جريمة وغموض",
      "series",
      tv({ withGenres: "80|9648", voteCountGte: 200 }),
    ],
    [
      "s-comedy",
      "series",
      "كوميديا",
      "series",
      tv({ withGenres: "35", voteCountGte: 200 }),
    ],
    [
      "s-scifi",
      "series",
      "خيال علمي وفانتازيا",
      "series",
      tv({ withGenres: "10765", voteCountGte: 200 }),
    ],
    [
      "s-action",
      "series",
      "أكشن ومغامرة",
      "series",
      tv({ withGenres: "10759", voteCountGte: 200 }),
    ],
    [
      "s-reality",
      "series",
      "برامج واقعية",
      "series",
      tv({ withGenres: "10764", voteCountGte: 20 }),
    ],
    [
      "a-series-new",
      "arabic",
      "مسلسلات عربية جديدة",
      "series",
      tv({ withOriginalLanguage: "ar", releaseDateGte: day(-365) }),
    ],
    [
      "a-series",
      "arabic",
      "مسلسلات عربية",
      "series",
      tv({ withOriginalLanguage: "ar", voteCountGte: 5 }),
    ],
    [
      "a-movies",
      "arabic",
      "أفلام عربية",
      "movie",
      movie({ withOriginalLanguage: "ar", voteCountGte: 5 }),
    ],
    [
      "a-gulf",
      "arabic",
      "دراما خليجية",
      "series",
      tv({
        withOriginalLanguage: "ar",
        withOriginCountry: "SA|AE|KW|QA|BH|OM",
      }),
    ],
    [
      "a-egypt",
      "arabic",
      "دراما مصرية",
      "series",
      tv({ withOriginalLanguage: "ar", withOriginCountry: "EG" }),
    ],
    [
      "a-levant",
      "arabic",
      "دراما شامية",
      "series",
      tv({ withOriginalLanguage: "ar", withOriginCountry: "SY|LB|JO" }),
    ],
    [
      "a-top",
      "arabic",
      "أفلام عربية بأعلى تقييم",
      "movie",
      movie(
        { withOriginalLanguage: "ar", voteCountGte: 40 },
        "vote_average.desc",
      ),
    ],
    [
      "w-turkish",
      "world",
      "مسلسلات تركية",
      "series",
      tv({ withOriginalLanguage: "tr", voteCountGte: 20 }),
    ],
    [
      "w-korean",
      "world",
      "دراما كورية",
      "series",
      tv({ withOriginalLanguage: "ko", withGenres: "18", voteCountGte: 30 }),
    ],
    [
      "w-indian",
      "world",
      "أفلام هندية",
      "movie",
      movie({ withOriginalLanguage: "hi", voteCountGte: 50 }),
    ],
    [
      "w-spanish",
      "world",
      "مسلسلات إسبانية ولاتينية",
      "series",
      tv({ withOriginalLanguage: "es", voteCountGte: 50 }),
    ],
    [
      "w-japanese",
      "world",
      "سينما يابانية",
      "movie",
      movie({
        withOriginalLanguage: "ja",
        withoutGenres: "16",
        voteCountGte: 100,
      }),
    ],
    [
      "w-french",
      "world",
      "سينما فرنسية",
      "movie",
      movie({ withOriginalLanguage: "fr", voteCountGte: 150 }),
    ],
    [
      "n-popular",
      "anime",
      "أنمي شائع",
      "series",
      tv({ withOriginalLanguage: "ja", withGenres: "16", voteCountGte: 50 }),
    ],
    [
      "n-new",
      "anime",
      "أنمي جديد",
      "series",
      tv({
        withOriginalLanguage: "ja",
        withGenres: "16",
        releaseDateGte: day(-240),
      }),
    ],
    [
      "n-top",
      "anime",
      "أنمي بأعلى تقييم",
      "series",
      tv(
        { withOriginalLanguage: "ja", withGenres: "16", voteCountGte: 300 },
        "vote_average.desc",
      ),
    ],
    [
      "n-movies",
      "anime",
      "أفلام أنمي",
      "movie",
      movie({
        withOriginalLanguage: "ja",
        withGenres: "16",
        voteCountGte: 100,
      }),
    ],
    [
      "f-family",
      "family",
      "أفلام للعائلة",
      "movie",
      movie({ withGenres: "10751", voteCountGte: 300 }),
    ],
    [
      "f-animation",
      "family",
      "رسوم متحركة",
      "movie",
      movie({ withGenres: "16", withoutGenres: "27", voteCountGte: 500 }),
    ],
    [
      "f-kids",
      "family",
      "مسلسلات للصغار",
      "series",
      tv({ withGenres: "10762", voteCountGte: 20 }),
    ],
    [
      "d-movies",
      "docs",
      "أفلام وثائقية",
      "movie",
      movie({ withGenres: "99", voteCountGte: 100 }),
    ],
    [
      "d-series",
      "docs",
      "سلاسل وثائقية",
      "series",
      tv({ withGenres: "99", voteCountGte: 30 }),
    ],
    [
      "d-top",
      "docs",
      "وثائقيات بأعلى تقييم",
      "movie",
      movie({ withGenres: "99", voteCountGte: 300 }, "vote_average.desc"),
    ],
  ].map(([id, tab, name, type, source]) => ({
    id: `d-${id}`,
    tab,
    name,
    type,
    source,
  }));
export const DISCOVER_TMDB = discoverTmdbRows();

/** Cinemeta rows without a key: [id, section, name, type, genre, catalog]. */
export const DISCOVER_CINEMETA = [
  ["m-top", "movies", "الأكثر مشاهدة الآن", "movie", "", "top"],
  ["m-rated", "movies", "الأعلى تقييماً", "movie", "", "imdbRating"],
  ["m-action", "movies", "أكشن", "movie", "Action", "top"],
  ["m-comedy", "movies", "كوميديا", "movie", "Comedy", "top"],
  ["m-drama", "movies", "دراما", "movie", "Drama", "top"],
  ["m-thriller", "movies", "إثارة وتشويق", "movie", "Thriller", "top"],
  ["m-crime", "movies", "جريمة", "movie", "Crime", "top"],
  ["m-horror", "movies", "رعب", "movie", "Horror", "top"],
  ["m-scifi", "movies", "خيال علمي", "movie", "Sci-Fi", "top"],
  ["m-fantasy", "movies", "فانتازيا", "movie", "Fantasy", "top"],
  ["m-romance", "movies", "رومانسي", "movie", "Romance", "top"],
  ["m-adventure", "movies", "مغامرة", "movie", "Adventure", "top"],
  ["m-mystery", "movies", "غموض", "movie", "Mystery", "top"],
  ["m-history", "movies", "تاريخ", "movie", "History", "top"],
  ["m-war", "movies", "حروب", "movie", "War", "top"],
  ["s-top", "series", "مسلسلات يتابعها الجميع", "series", "", "top"],
  ["s-rated", "series", "الأعلى تقييماً", "series", "", "imdbRating"],
  ["s-drama", "series", "دراما", "series", "Drama", "top"],
  ["s-crime", "series", "جريمة", "series", "Crime", "top"],
  ["s-comedy", "series", "كوميديا", "series", "Comedy", "top"],
  ["s-scifi", "series", "خيال علمي", "series", "Sci-Fi", "top"],
  ["s-action", "series", "أكشن", "series", "Action", "top"],
  ["s-mystery", "series", "غموض", "series", "Mystery", "top"],
  ["s-fantasy", "series", "فانتازيا", "series", "Fantasy", "top"],
  ["s-reality", "series", "برامج واقعية", "series", "Reality-TV", "top"],
  ["f-animation", "family", "رسوم متحركة", "movie", "Animation", "top"],
  ["f-family", "family", "أفلام للعائلة", "movie", "Family", "top"],
  ["f-series", "family", "مسلسلات رسوم متحركة", "series", "Animation", "top"],
  ["d-movies", "docs", "أفلام وثائقية", "movie", "Documentary", "top"],
  ["d-series", "docs", "سلاسل وثائقية", "series", "Documentary", "top"],
].map(([id, tab, name, type, genre, catalog]) => ({
  id: `d-${id}`,
  tab,
  name,
  type,
  genre,
  catalog,
}));

const rowsFor = (tmdb) => (tmdb ? discoverTmdbRows() : DISCOVER_CINEMETA);

/** The sections that have Riwaq rows for this viewer. */
export function discoverSections(tmdb) {
  return [...new Set(rowsFor(tmdb).map((r) => r.tab))];
}

/** The plan entries for one section: opaque keys and labels only. */
export function discoverPlan({ tmdb = false, tab = "movies" } = {}) {
  return rowsFor(tmdb)
    .filter((r) => r.tab === tab)
    .map((r) => ({
      key: `${FEED_PREFIX}${r.id}`,
      name: r.name,
      provider: "رِواق",
      type: r.type,
      feed: true,
      tab: r.tab,
    }));
}

/** A Discover key's row, or null. */
export function discoverRow(key, { tmdb = false } = {}) {
  if (typeof key !== "string" || !key.startsWith(`${FEED_PREFIX}d-`))
    return null;
  const id = key.slice(FEED_PREFIX.length);
  return rowsFor(tmdb).find((r) => r.id === id) || null;
}

/** Cinemeta's address for a Discover row, paged by skip. */
export function discoverCinemetaUrl(row, skip = 0) {
  const catalog = row.catalog === "imdbRating" ? "imdbRating" : "top";
  const extra = [];
  if (row.genre) extra.push(`genre=${encodeURIComponent(row.genre)}`);
  if (skip > 0) extra.push(`skip=${Math.floor(skip)}`);
  return `${CINEMETA_BASE}/catalog/${row.type}/${catalog}${extra.length ? `/${extra.join("&")}` : ""}.json`;
}

/** The section an addon catalog's titles belong to. */
export function addonSection(row) {
  const group = groupOf(row);
  return DISCOVER_IDS.includes(group) ? group : "other";
}

const KIND_LABEL = {
  movie: "أفلام",
  series: "مسلسلات",
  anime: "أنمي",
  tv: "قنوات",
  channel: "قنوات",
  events: "بث مباشر",
};

/**
 * The addons' catalogs of one section as anonymous rows: one blended row
 * per kind of title (films, series…), titles already in Riwaq's rows left
 * out. Rows carry no catalog or addon name, and no key that opens one.
 */
export function blendedSection(addonRows = [], tab, shownIds = new Set()) {
  const mine = addonRows.filter(
    (r) => r?.metas?.length && addonSection(r) === tab,
  );
  const byKind = new Map();
  for (const row of mine) {
    const kind = KIND_LABEL[row.type] ? row.type : "other";
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind).push(row);
  }
  const out = [];
  for (const [kind, rows] of byKind) {
    const seen = new Set(shownIds);
    const metas = blendRows(rows, 200)
      .filter((m) => {
        const id = `${m.type}:${m.id}`;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .slice(0, 60);
    if (!metas.length) continue;
    const label = KIND_LABEL[kind];
    out.push({
      key: `blend:${tab}:${kind}`,
      // Sections only addons fill take their own name; Riwaq's sections
      // add these after their rows as "more of the same kind".
      name: ADDON_ONLY.includes(tab)
        ? byKind.size > 1 && label
          ? `${TAB_NAME[tab]} · ${label}`
          : TAB_NAME[tab]
        : `مختارات أخرى${label ? `: ${label}` : ""}`,
      subtitle: ADDON_ONLY.includes(tab) ? label || "" : TAB_NAME[tab],
      type: kind === "other" ? "" : kind,
      metas,
      blended: true,
    });
  }
  return out;
}

/** The sections to offer as tabs: Riwaq's own, then addon-only ones in use. */
export function discoverTabs({ tmdb = false, addonRows = [] } = {}) {
  const own = new Set(discoverSections(tmdb));
  const fromAddons = new Set(
    addonRows.filter((r) => r?.metas?.length).map(addonSection),
  );
  return DISCOVER_TABS.filter(([id]) => own.has(id) || fromAddons.has(id)).map(
    ([id, name]) => ({ id, name, riwaq: own.has(id) }),
  );
}
