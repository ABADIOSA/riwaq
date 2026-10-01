/**
 * Riwaq's own home rows: titles arranged by what they are (trending, in
 * cinemas, top rated, Arabic, Turkish, Korean, anime, genres) rather than
 * by which addon listed them. A viewer with forty addons still gets one
 * tidy home; their addons stay on Discover and supply the sources.
 *
 * - With the viewer's TMDB key: TMDB charts and discover queries in the
 *   metadata language and region, matched to IMDb IDs as collection
 *   sources are (Client.tmdbRow).
 * - Without it: Cinemeta's public catalogs, top titles overall and by
 *   genre. Cinemeta knows no languages, so the Arabic, Turkish, Korean and
 *   anime rows need the key; the addons' own Arabic and anime catalogs are
 *   still gathered into shelves below (core/smart-groups.mjs).
 *
 * Rows travel through the normal catalog plan with keys `feed:<id>`, so
 * they load one at a time and render as they arrive. Pure data and
 * builders; the client fetches.
 */

export const FEED_PREFIX = "feed:";
export const CINEMETA_BASE = "https://v3-cinemeta.strem.io";

// TMDB genre IDs (movie / tv).
const G = {
  action: 28,
  adventure: 12,
  animation: 16,
  comedy: 35,
  crime: 80,
  documentary: 99,
  drama: 18,
  family: 10751,
  fantasy: 14,
  horror: 27,
  mystery: 9648,
  romance: 10749,
  scifi: 878,
  thriller: 53,
  tvAction: 10759,
  tvScifi: 10765,
};

const today = (offsetDays = 0) =>
  new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);

/**
 * The TMDB rows. `source` is a collection-style TMDB source; `chart` and
 * `trending` are TMDB's own lists, the rest are discover queries.
 */
export const TMDB_FEED = [
  [
    "trending-movies",
    "رائج هذا الأسبوع",
    "movie",
    { kind: "trending", media: "movie" },
  ],
  [
    "now-playing",
    "في السينما الآن",
    "movie",
    { kind: "chart", media: "movie", chart: "now_playing" },
  ],
  [
    "trending-series",
    "مسلسلات رائجة",
    "series",
    { kind: "trending", media: "tv" },
  ],
  [
    "arabic-series",
    "مسلسلات عربية",
    "series",
    {
      kind: "discover",
      media: "tv",
      sort: "popularity.desc",
      filters: { withOriginalLanguage: "ar", voteCountGte: 5 },
    },
  ],
  [
    "popular-movies",
    "أفلام شائعة",
    "movie",
    { kind: "chart", media: "movie", chart: "popular" },
  ],
  [
    "on-the-air",
    "تُعرض حلقاتها الآن",
    "series",
    { kind: "chart", media: "tv", chart: "on_the_air" },
  ],
  [
    "arabic-movies",
    "أفلام عربية",
    "movie",
    {
      kind: "discover",
      media: "movie",
      sort: "popularity.desc",
      filters: { withOriginalLanguage: "ar", voteCountGte: 5 },
    },
  ],
  [
    "top-movies",
    "الأعلى تقييماً: أفلام",
    "movie",
    { kind: "chart", media: "movie", chart: "top_rated" },
  ],
  [
    "top-series",
    "الأعلى تقييماً: مسلسلات",
    "series",
    { kind: "chart", media: "tv", chart: "top_rated" },
  ],
  [
    "turkish",
    "مسلسلات تركية",
    "series",
    {
      kind: "discover",
      media: "tv",
      sort: "popularity.desc",
      filters: { withOriginalLanguage: "tr", voteCountGte: 20 },
    },
  ],
  [
    "korean",
    "دراما كورية",
    "series",
    {
      kind: "discover",
      media: "tv",
      sort: "popularity.desc",
      filters: {
        withOriginalLanguage: "ko",
        withGenres: String(G.drama),
        voteCountGte: 30,
      },
    },
  ],
  [
    "anime",
    "أنمي",
    "series",
    {
      kind: "discover",
      media: "tv",
      sort: "popularity.desc",
      filters: {
        withOriginalLanguage: "ja",
        withGenres: String(G.animation),
        voteCountGte: 50,
      },
    },
  ],
  [
    "action",
    "أكشن ومغامرة",
    "movie",
    {
      kind: "discover",
      media: "movie",
      sort: "popularity.desc",
      filters: { withGenres: `${G.action}|${G.adventure}`, voteCountGte: 300 },
    },
  ],
  [
    "comedy",
    "كوميديا",
    "movie",
    {
      kind: "discover",
      media: "movie",
      sort: "popularity.desc",
      filters: { withGenres: String(G.comedy), voteCountGte: 300 },
    },
  ],
  [
    "scifi",
    "خيال علمي وفانتازيا",
    "movie",
    {
      kind: "discover",
      media: "movie",
      sort: "popularity.desc",
      filters: { withGenres: `${G.scifi}|${G.fantasy}`, voteCountGte: 300 },
    },
  ],
  [
    "horror",
    "رعب",
    "movie",
    {
      kind: "discover",
      media: "movie",
      sort: "popularity.desc",
      filters: { withGenres: String(G.horror), voteCountGte: 300 },
    },
  ],
  [
    "crime-series",
    "جريمة وغموض",
    "series",
    {
      kind: "discover",
      media: "tv",
      sort: "popularity.desc",
      filters: { withGenres: `${G.crime}|${G.mystery}`, voteCountGte: 200 },
    },
  ],
  [
    "family",
    "للعائلة والصغار",
    "movie",
    {
      kind: "discover",
      media: "movie",
      sort: "popularity.desc",
      filters: { withGenres: `${G.family}|${G.animation}`, voteCountGte: 300 },
    },
  ],
  [
    "documentary",
    "وثائقيات",
    "movie",
    {
      kind: "discover",
      media: "movie",
      sort: "popularity.desc",
      filters: { withGenres: String(G.documentary), voteCountGte: 100 },
    },
  ],
  [
    "hidden-gems",
    "جواهر قد تكون فاتتك",
    "movie",
    {
      kind: "discover",
      media: "movie",
      sort: "vote_average.desc",
      filters: { voteAverageGte: 7.5, voteCountGte: 400, withRuntimeGte: 70 },
    },
  ],
  [
    "upcoming",
    "قريباً في السينما",
    "movie",
    { kind: "chart", media: "movie", chart: "upcoming" },
  ],
].map(([id, name, type, source]) => ({ id, name, type, source }));

/** The keyless rows, from Cinemeta's catalogs (genres in its own English). */
export const CINEMETA_FEED = [
  ["top-movies", "الأكثر مشاهدة الآن", "movie", ""],
  ["top-series", "مسلسلات يتابعها الجميع", "series", ""],
  ["action", "أكشن", "movie", "Action"],
  ["drama-series", "مسلسلات دراما", "series", "Drama"],
  ["comedy", "كوميديا", "movie", "Comedy"],
  ["scifi", "خيال علمي", "movie", "Sci-Fi"],
  ["thriller", "إثارة وتشويق", "movie", "Thriller"],
  ["crime-series", "مسلسلات جريمة", "series", "Crime"],
  ["animation", "رسوم متحركة", "movie", "Animation"],
  ["horror", "رعب", "movie", "Horror"],
  ["comedy-series", "مسلسلات كوميدية", "series", "Comedy"],
  ["romance", "رومانسي", "movie", "Romance"],
  ["adventure", "مغامرة", "movie", "Adventure"],
  ["fantasy", "فانتازيا", "movie", "Fantasy"],
  ["mystery", "غموض", "movie", "Mystery"],
  ["documentary", "وثائقيات", "movie", "Documentary"],
].map(([id, name, type, genre]) => ({ id, name, type, genre }));

/** The rows to show: TMDB's with a key, Cinemeta's without; hidden ones out. */
export function feedRows({ tmdb = false, hidden = [] } = {}) {
  const off = new Set(hidden);
  return (tmdb ? TMDB_FEED : CINEMETA_FEED).filter((r) => !off.has(r.id));
}

/** Every row a viewer can hide, with its name, for the settings page. */
export function feedChoices(tmdb) {
  return (tmdb ? TMDB_FEED : CINEMETA_FEED).map(({ id, name }) => ({
    id,
    name,
  }));
}

/** The hidden-row list from settings, validated against every known row. */
export function cleanFeedHidden(input) {
  const known = new Set([...TMDB_FEED, ...CINEMETA_FEED].map((r) => r.id));
  return Array.isArray(input)
    ? [...new Set(input.filter((id) => known.has(id)))]
    : [];
}

/** The plan entries for the catalog loader: opaque keys and labels only. */
export function feedPlan(options) {
  return feedRows(options).map((r) => ({
    key: `${FEED_PREFIX}${r.id}`,
    name: r.name,
    provider: "رِواق",
    type: r.type,
    feed: true,
  }));
}

/** A feed key's row, or null. */
export function feedRow(key, { tmdb = false } = {}) {
  if (typeof key !== "string" || !key.startsWith(FEED_PREFIX)) return null;
  const id = key.slice(FEED_PREFIX.length);
  return (tmdb ? TMDB_FEED : CINEMETA_FEED).find((r) => r.id === id) || null;
}

/** The TMDB request for a chart or trending row. */
export function chartRequest(
  source,
  { page = 1, language = "ar-SA", region = "SA" } = {},
) {
  if (source.kind === "trending")
    return {
      path: `trending/${source.media === "tv" ? "tv" : "movie"}/week`,
      params: { language, page },
    };
  const params = { language, page };
  if (source.media === "movie") params.region = region;
  // TMDB's upcoming list includes films already out in some regions.
  if (source.chart === "upcoming")
    return {
      path: "discover/movie",
      params: {
        language,
        page,
        region,
        sort_by: "popularity.desc",
        include_adult: "false",
        "primary_release_date.gte": today(1),
        "primary_release_date.lte": today(150),
      },
    };
  return {
    path: `${source.media === "tv" ? "tv" : "movie"}/${source.chart}`,
    params,
  };
}

/** Cinemeta's catalog address for a keyless row, with paging by skip. */
export function cinemetaUrl(row, skip = 0) {
  const parts = [`${CINEMETA_BASE}/catalog/${row.type}/top`];
  const extra = [];
  if (row.genre) extra.push(`genre=${encodeURIComponent(row.genre)}`);
  if (skip > 0) extra.push(`skip=${Math.floor(skip)}`);
  return `${parts[0]}${extra.length ? `/${extra.join("&")}` : ""}.json`;
}
