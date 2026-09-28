/**
 * Automatic source failover: when a source fails, the next playable one in
 * the stream engine's ranking plays from the same position.
 */

export const FAILOVER_LIMIT = 3;

/**
 * The next source to try for a title, or null. `ranked` is the ranked list
 * of playable keys, `tried` the keys that already failed (including the one
 * failing now). Gives up after FAILOVER_LIMIT failures so a dead title never
 * loops through every addon.
 */
export function nextSource(
  ranked = [],
  tried = new Set(),
  limit = FAILOVER_LIMIT,
) {
  if (tried.size > limit) return null;
  return ranked.find((key) => !tried.has(key)) || null;
}

/** Playable keys in ranked order: supported, and not opened outside Riwaq. */
export function playableKeys(result) {
  return (result?.streams || [])
    .filter((s) => s && s.supported && !s.external)
    .map((s) => s.key);
}
