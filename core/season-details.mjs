/**
 * Episode details for a series page: a still, a description, the runtime
 * and a rating for each episode.
 *
 * The addon's own fields come first (Cinemeta sends `thumbnail`, `overview`
 * or `description`, `rating` and `released`). With the viewer's TMDB key,
 * the season is read in the viewer's metadata language to fill what the
 * addon lacks, and to give Arabic titles and descriptions when TMDB has
 * them. A description TMDB lacks in that language is filled from English.
 * Pure builders and parsers; the client fetches.
 */

const TMDB_PATH = /^\/[\w-]+\.(jpg|jpeg|png|webp)$/i;
// TMDB fills untranslated Arabic names with "الحلقة 3" or "Episode 3":
// those say nothing the episode number does not.
const GENERIC = /^(الحلقة|حلقة|episode|ep\.?)\s*\d+$/i;

const https = (value) => {
  if (typeof value !== "string" || value.length > 2000) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.toString()
      : "";
  } catch {
    return "";
  }
};
const text = (value, max) =>
  typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, max)
    : "";

/** The TMDB request for one season, or null when the IDs are not usable. */
export function seasonRequest(tmdbId, season, language = "ar-SA") {
  if (
    !/^\d{1,10}$/.test(String(tmdbId || "")) ||
    !Number.isInteger(season) ||
    season < 0
  )
    return null;
  return { path: `tv/${tmdbId}/season/${season}`, params: { language } };
}

/** A season's episodes by number. */
export function parseSeason(body) {
  const out = {};
  for (const e of Array.isArray(body?.episodes) ? body.episodes : []) {
    const number = Number(e?.episode_number);
    if (!Number.isInteger(number) || number < 0) continue;
    const still =
      typeof e.still_path === "string" && TMDB_PATH.test(e.still_path)
        ? e.still_path
        : "";
    const title = text(e.name, 160);
    out[number] = {
      title: GENERIC.test(title) ? "" : title,
      overview: text(e.overview, 1200),
      thumb: still ? `https://image.tmdb.org/t/p/w400${still}` : "",
      runtime: Number.isInteger(e.runtime) && e.runtime > 0 ? e.runtime : 0,
      rating:
        Number.isFinite(e.vote_average) &&
        e.vote_average > 0 &&
        (e.vote_count ?? 1) > 0
          ? Math.round(e.vote_average * 10) / 10
          : 0,
      airDate: /^\d{4}-\d{2}-\d{2}$/.test(e.air_date || "") ? e.air_date : "",
    };
  }
  return out;
}

/** Descriptions missing in the viewer's language, filled from English. */
export function fillOverviews(primary, english) {
  const out = { ...primary };
  for (const [number, e] of Object.entries(english || {})) {
    const own = out[number];
    if (!own) out[number] = { ...e, overviewLang: "en" };
    else if (!own.overview && e.overview)
      out[number] = { ...own, overview: e.overview, overviewLang: "en" };
  }
  return out;
}

/** Whether enough descriptions are missing to be worth an English request. */
export const needsEnglish = (season) => {
  const list = Object.values(season || {});
  return (
    list.length > 0 && list.filter((e) => !e.overview).length * 2 >= list.length
  );
};

/**
 * One episode as the page shows it: the addon's fields first, then TMDB's.
 * A TMDB title in the viewer's language wins over an English addon title.
 */
export function episodeDetails(video, tmdb) {
  const addonTitle = text(video?.title || video?.name, 160);
  const ownOverview = text(video?.overview || video?.description, 1200);
  const rating = Number(video?.rating);
  const tmdbTitle = tmdb?.title || "";
  const arabic = (s) => /[؀-ۿ]/.test(s);
  return {
    title:
      tmdbTitle && arabic(tmdbTitle) && !arabic(addonTitle)
        ? tmdbTitle
        : addonTitle || tmdbTitle,
    overview:
      tmdb?.overview && arabic(tmdb.overview) && !arabic(ownOverview)
        ? tmdb.overview
        : ownOverview || tmdb?.overview || "",
    overviewLang: !ownOverview && tmdb?.overviewLang === "en" ? "en" : "",
    thumb: https(video?.thumbnail) || tmdb?.thumb || "",
    runtime: tmdb?.runtime || 0,
    rating: Number.isFinite(rating) && rating > 0 ? rating : tmdb?.rating || 0,
  };
}
