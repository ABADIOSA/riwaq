/**
 * Adult content, for a profile that hides it (Harbor's Library page). Addons
 * declare themselves adult with `behaviorHints.adult`, as Stremio defines it;
 * single titles are caught by an explicit flag or an adult genre. Pure.
 */

const ADULT_GENRE =
  /^(adult|adults|erotic|erotica|porn|porno|pornography|xxx|hentai|للبالغين|إباحي|اباحي)$/i;

/** An addon that says it serves adult content. */
export const isAdultAddon = (manifest) =>
  manifest?.behaviorHints?.adult === true;

/** A title flagged adult by its addon, TMDB or its genres. */
export function isAdultMeta(meta) {
  if (!meta || typeof meta !== "object") return false;
  if (meta.adult === true || meta.behaviorHints?.adult === true) return true;
  const genres = [
    ...(Array.isArray(meta.genres) ? meta.genres : []),
    ...(Array.isArray(meta.genre) ? meta.genre : []),
  ];
  return genres.some(
    (g) => typeof g === "string" && ADULT_GENRE.test(g.trim()),
  );
}

/** A row without adult titles. */
export const withoutAdult = (metas) =>
  (metas || []).filter((m) => !isAdultMeta(m));
