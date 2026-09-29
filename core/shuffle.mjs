/**
 * A random episode of a series, the way the official Nuvio apps shuffle:
 * released, numbered episodes only (no specials), unwatched ones unless the
 * viewer includes watched, never the episode already chosen, and no repeat
 * until every candidate has come up once. Browser-safe and deterministic
 * given `random`, so the tests can pin it.
 */

import { isCompleted, releasedEpisodes } from "./library.mjs";

/** The episodes a shuffle may choose from. */
export function shuffleCandidates(
  meta,
  progress = {},
  { includeWatched = false, now = Date.now() } = {},
) {
  const seen = new Set();
  return releasedEpisodes(meta, now).filter((v) => {
    if (!((v.season ?? 1) > 0) || !(Number(v.episode) > 0)) return false;
    const slot = `${v.season ?? 1}:${v.episode}`;
    if (seen.has(slot)) return false;
    seen.add(slot);
    return includeWatched || !isCompleted(progress[`${meta.type}:${v.id}`]);
  });
}

/**
 * Picks one. `history` is the set of episode IDs already shown this session
 * for this series; it is updated in place, and emptied when every candidate
 * has been shown so the cycle starts again.
 */
export function shufflePick(
  candidates,
  { current = "", history = new Set(), random = Math.random } = {},
) {
  const pool = candidates.filter((v) => v.id !== current);
  if (!pool.length) return null;
  let fresh = pool.filter((v) => !history.has(v.id));
  if (!fresh.length) {
    for (const v of pool) history.delete(v.id);
    fresh = pool;
  }
  const pick =
    fresh[Math.min(fresh.length - 1, Math.floor(random() * fresh.length))];
  history.add(pick.id);
  return pick;
}
