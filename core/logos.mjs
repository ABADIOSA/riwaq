/**
 * Title logos: the work's own wordmark in place of its typed name, on the
 * home hero and the title page.
 *
 * The viewer chooses the order (`titleLogos` in settings):
 * - `arabic` (the default): an Arabic logo first, then the original
 *   language, then English, then a textless one.
 * - `original`: the original language first, then English, then Arabic.
 * - `text`: no logo; the name is typed.
 *
 * With the viewer's TMDB key, every logo TMDB holds in those languages is
 * ranked. Without it, metahub's logo by IMDb ID (the one Cinemeta uses) and
 * the addon's own logo stand in. When a picture fails, the page falls back
 * to the next one and finally to the typed name. Pure builders and parsers.
 */

export const LOGO_MODES = ["arabic", "original", "text"];
const TMDB_PATH = /^\/[\w-]+\.(png|svg|webp)$/i;
const LANG = /^[a-z]{2}$/;
const IMDB = /^tt\d{5,12}$/;

/** The TMDB find request for an IMDb ID, or null. */
export function logoFindRequest(id) {
  return IMDB.test(id || "")
    ? { path: `find/${id}`, params: { external_source: "imdb_id" } }
    : null;
}

/** The TMDB ID and original language from a find answer. */
export function parseLogoFind(body, type) {
  const hit = body?.[type === "series" ? "tv_results" : "movie_results"]?.[0];
  if (!hit || !/^\d{1,10}$/.test(String(hit.id))) return null;
  return {
    tmdbId: String(hit.id),
    original: LANG.test(hit.original_language || "")
      ? hit.original_language
      : "",
  };
}

/** The TMDB images request for logos in the languages that matter. */
export function logoImagesRequest(type, tmdbId, original = "") {
  if (!/^\d{1,10}$/.test(String(tmdbId || ""))) return null;
  const langs = ["ar", "en", "null"];
  if (LANG.test(original) && !langs.includes(original)) langs.push(original);
  return {
    path: `${type === "series" ? "tv" : "movie"}/${tmdbId}/images`,
    params: { include_image_language: langs.join(",") },
  };
}

/** The language order a mode asks for. */
export function logoOrder(mode, original = "") {
  const orig = LANG.test(original) ? original : "";
  const order =
    mode === "original" ? [orig, "en", "ar", null] : ["ar", orig, "en", null];
  return order.filter((l, i) => l !== "" && order.indexOf(l) === i);
}

/**
 * The best logos from a TMDB images answer, as picture addresses in order.
 * A logo's own votes break ties inside a language; wider ones read better.
 */
export function pickLogos(body, mode = "arabic", original = "", limit = 3) {
  if (mode === "text") return [];
  const order = logoOrder(mode, original);
  const rank = (lang) => {
    const i = order.indexOf(LANG.test(lang || "") ? lang : null);
    return i < 0 ? 99 : i;
  };
  return (Array.isArray(body?.logos) ? body.logos : [])
    .filter(
      (l) =>
        typeof l?.file_path === "string" &&
        TMDB_PATH.test(l.file_path) &&
        rank(l.iso_639_1) < 99,
    )
    .sort(
      (a, b) =>
        rank(a.iso_639_1) - rank(b.iso_639_1) ||
        (b.vote_average || 0) - (a.vote_average || 0) ||
        (b.aspect_ratio || 0) - (a.aspect_ratio || 0),
    )
    .slice(0, limit)
    .map((l) => ({
      url: `https://image.tmdb.org/t/p/${/\.svg$/i.test(l.file_path) ? "original" : "w500"}${l.file_path}`,
      lang: LANG.test(l.iso_639_1 || "") ? l.iso_639_1 : "",
    }));
}

/** Metahub's logo for an IMDb ID, or "". */
export function metahubLogo(id) {
  const imdb = String(id || "").split(":")[0];
  return IMDB.test(imdb)
    ? `https://images.metahub.space/logo/medium/${imdb}/img`
    : "";
}

const https = (value) => {
  if (typeof value !== "string" || value.length > 2000) return "";
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && !url.username && !url.password
      ? url.toString()
      : "";
  } catch {
    return "";
  }
};

/**
 * The pictures to try, best first: TMDB's ranked logos, then the addon's
 * own logo, then metahub's. Duplicates are dropped.
 */
export function logoCandidates({ tmdb = [], addonLogo = "", id = "", mode }) {
  if (mode === "text") return [];
  const list = [
    ...tmdb.map((l) => l.url),
    https(addonLogo),
    metahubLogo(id),
  ].filter(Boolean);
  return [...new Set(list)].slice(0, 5);
}
