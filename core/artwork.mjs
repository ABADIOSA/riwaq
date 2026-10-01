/**
 * Artwork for a title's page: backgrounds, posters, logos and fan art.
 *
 * - Without any key: the addon's own poster, background and logo, plus
 *   metahub's images by IMDb ID (the ones Cinemeta itself uses).
 * - With the viewer's TMDB key: every backdrop, poster and logo TMDB holds,
 *   in Arabic, English or without text.
 * - With the viewer's Fanart.tv key: fanart.tv's community-made artwork.
 *   Its backgrounds, posters and logos join those tabs. Clear art, character
 *   art, thumbs, banners and disc art make the fan art tab.
 *
 * Keys stay in main; the image addresses that reach the interface carry
 * none. Only image.tmdb.org, assets.fanart.tv, images.metahub.space and the
 * addon's own HTTPS images are used. Pure builders and parsers.
 */

export const ARTWORK_LIMIT = 80;
export const ARTWORK_HOSTS = [
  "image.tmdb.org",
  "assets.fanart.tv",
  "images.metahub.space",
];
const IMDB = /^tt\d{5,12}$/;

/** An HTTPS image address without credentials, or "". */
export function httpsImage(value) {
  if (typeof value !== "string" || value.length > 2000) return "";
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password) return "";
    return url.toString();
  } catch {
    return "";
  }
}

/** Whether main may open this image in the browser. */
export function artworkHost(value) {
  const url = httpsImage(value);
  return !!url && ARTWORK_HOSTS.includes(new URL(url).hostname);
}

// --- TMDB --------------------------------------------------------------------

/** The request for every image TMDB holds for a title. */
export function tmdbImagesRequest(type, tmdbId) {
  if (!/^\d{1,10}$/.test(String(tmdbId || ""))) return null;
  return {
    path: `${type === "series" ? "tv" : "movie"}/${tmdbId}/images`,
    params: { include_image_language: "ar,en,null" },
  };
}

const TMDB_PATH = /^\/[\w-]+\.(jpg|jpeg|png|svg|webp)$/i;
const tmdbUrl = (path, size) =>
  `https://image.tmdb.org/t/p/${/\.svg$/i.test(path) ? "original" : size}${path}`;
// Backdrops read best without text; posters and logos in Arabic first.
const LANG_ORDER = {
  backdrops: [null, "ar", "en"],
  posters: ["ar", "en", null],
  logos: ["ar", "en", null],
};
const rank = (kind, lang) => {
  const i = LANG_ORDER[kind].indexOf(lang ?? null);
  return i < 0 ? 9 : i;
};

/** TMDB's images as gallery items, best first. */
export function parseTmdbImages(body) {
  const sizes = { backdrops: "w780", posters: "w342", logos: "w300" };
  const out = { backdrops: [], posters: [], logos: [] };
  for (const kind of Object.keys(out)) {
    const list = Array.isArray(body?.[kind]) ? body[kind] : [];
    out[kind] = list
      .filter(
        (i) => typeof i?.file_path === "string" && TMDB_PATH.test(i.file_path),
      )
      .sort(
        (a, b) =>
          rank(kind, a.iso_639_1) - rank(kind, b.iso_639_1) ||
          (b.vote_average || 0) - (a.vote_average || 0) ||
          (b.width || 0) - (a.width || 0),
      )
      .slice(0, ARTWORK_LIMIT)
      .map((i) => ({
        thumb: tmdbUrl(i.file_path, sizes[kind]),
        full: tmdbUrl(i.file_path, "original"),
        width: Number(i.width) || 0,
        height: Number(i.height) || 0,
        lang: typeof i.iso_639_1 === "string" ? i.iso_639_1.slice(0, 5) : "",
        source: "TMDB",
      }));
  }
  return out;
}

// --- Fanart.tv ---------------------------------------------------------------

/** The Fanart.tv request: films by IMDb (or TMDB) ID, series by TVDB ID. */
export function fanartRequest(type, { imdb, tmdbId, tvdbId } = {}) {
  if (type === "series")
    return /^\d{1,10}$/.test(String(tvdbId || "")) ? `tv/${tvdbId}` : null;
  if (IMDB.test(imdb || "")) return `movies/${imdb}`;
  return /^\d{1,10}$/.test(String(tmdbId || "")) ? `movies/${tmdbId}` : null;
}

/** Fanart.tv's kinds: which tab each goes to and what to call it. */
export const FANART_KINDS = {
  moviebackground: ["backdrops", "خلفية"],
  showbackground: ["backdrops", "خلفية"],
  movieposter: ["posters", "بوستر"],
  tvposter: ["posters", "بوستر"],
  hdmovielogo: ["logos", "شعار"],
  movielogo: ["logos", "شعار"],
  hdtvlogo: ["logos", "شعار"],
  clearlogo: ["logos", "شعار"],
  hdmovieclearart: ["fanart", "فن شفاف"],
  movieart: ["fanart", "فن شفاف"],
  hdclearart: ["fanart", "فن شفاف"],
  clearart: ["fanart", "فن شفاف"],
  characterart: ["fanart", "رسم الشخصيات"],
  moviethumb: ["fanart", "لقطة مصممة"],
  tvthumb: ["fanart", "لقطة مصممة"],
  moviebanner: ["fanart", "لافتة"],
  tvbanner: ["fanart", "لافتة"],
  moviedisc: ["fanart", "قرص"],
};

const fanartUrl = (value) => {
  const url = httpsImage(value);
  return url && new URL(url).hostname === "assets.fanart.tv" ? url : "";
};

/** Fanart.tv's artwork, most liked first within each kind. */
export function parseFanart(body) {
  const out = { backdrops: [], posters: [], logos: [], fanart: [] };
  if (!body || typeof body !== "object") return out;
  for (const [kind, [tab, label]] of Object.entries(FANART_KINDS)) {
    const list = Array.isArray(body[kind]) ? body[kind] : [];
    const items = list
      .map((i) => ({ i, full: fanartUrl(i?.url) }))
      .filter(({ full }) => full)
      .sort((a, b) => Number(b.i.likes || 0) - Number(a.i.likes || 0))
      .map(({ i, full }) => ({
        thumb: full.replace("/fanart/", "/preview/"),
        full,
        lang:
          typeof i.lang === "string" && i.lang !== "00"
            ? i.lang.slice(0, 5)
            : "",
        likes: Number(i.likes) || 0,
        kind: label,
        source: "Fanart.tv",
      }));
    out[tab].push(...items);
  }
  for (const tab of Object.keys(out))
    out[tab] = out[tab].slice(0, ARTWORK_LIMIT);
  return out;
}

// --- Without keys ------------------------------------------------------------

/** The addon's images and metahub's by IMDb ID. */
export function metaArtwork(meta) {
  const out = { backdrops: [], posters: [], logos: [], fanart: [] };
  const add = (tab, value, source) => {
    const url = httpsImage(value);
    if (url) out[tab].push({ thumb: url, full: url, lang: "", source });
  };
  add("backdrops", meta?.background, "الإضافة");
  add("posters", meta?.poster, "الإضافة");
  add("logos", meta?.logo, "الإضافة");
  const imdb = String(meta?.imdb_id || meta?.id || "").split(":")[0];
  if (IMDB.test(imdb)) {
    add(
      "backdrops",
      `https://images.metahub.space/background/large/${imdb}/img`,
      "Metahub",
    );
    add(
      "posters",
      `https://images.metahub.space/poster/large/${imdb}/img`,
      "Metahub",
    );
    add(
      "logos",
      `https://images.metahub.space/logo/large/${imdb}/img`,
      "Metahub",
    );
  }
  return out;
}

/** Every source's artwork in one gallery, without repeats. */
export function mergeArtwork(...parts) {
  const out = { backdrops: [], posters: [], logos: [], fanart: [] };
  for (const tab of Object.keys(out)) {
    const seen = new Set();
    for (const part of parts)
      for (const item of part?.[tab] || []) {
        if (!item?.full || seen.has(item.full)) continue;
        seen.add(item.full);
        out[tab].push(item);
      }
    out[tab] = out[tab].slice(0, ARTWORK_LIMIT);
  }
  return out;
}
