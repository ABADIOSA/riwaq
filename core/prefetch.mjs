/**
 * Getting the next episode ready before the current one ends (Nuvio #808).
 *
 * With autoplay on, a series viewing that reaches its last minutes asks the
 * addons for the next title's sources in the background: the head of the
 * queue when there is one, otherwise the next released episode. When the
 * episode ends, autoplay uses that answer instead of waiting for every
 * addon again. Only sources are asked for; nothing is downloaded or played
 * early, and an answer is used only for the same title, the same profile
 * and within PREFETCH_TTL. Browser-safe.
 */

export const PREFETCH_TTL = 10 * 60 * 1000;
// Start when this many seconds are left, or at this share of the episode.
export const PREFETCH_LEFT = 240;
export const PREFETCH_SHARE = 0.9;

/** Whether a viewing has reached the point where the next title is fetched. */
export function prefetchDue(player = {}, settings = {}) {
  if (!settings.autoplay || !player.active || player.live) return false;
  if (player.meta?.type !== "series" || typeof player.videoId !== "string")
    return false;
  const duration = Number(player.duration);
  const position = Number(player.position);
  if (!(duration > 120) || !Number.isFinite(position)) return false;
  return (
    duration - position <= PREFETCH_LEFT ||
    position / duration >= PREFETCH_SHARE
  );
}

/**
 * What autoplay will play next, as `{ type, id, seriesId }`, or null: the
 * queue head first (as `advance` does at the end), then the episode after
 * `videoId` in `videos` (released, numbered, in order).
 */
export function prefetchTarget({ queue = [], meta, videoId, videos = [] }) {
  const queued = queue[0];
  if (queued?.meta?.type && typeof queued.videoId === "string")
    return {
      type: queued.meta.type,
      id: queued.videoId,
      seriesId: queued.meta.id,
    };
  if (!meta?.id || meta.type !== "series") return null;
  const index = videos.findIndex((v) => v?.id === videoId);
  const next = index >= 0 ? videos[index + 1] : null;
  return next?.id ? { type: "series", id: next.id, seriesId: meta.id } : null;
}

/**
 * The prefetched answer for `target`, or null when it is for another title,
 * another profile, or too old. `entry` is `{ id, profileId, at, promise }`.
 */
export function prefetched(entry, { id, profileId, now = Date.now() } = {}) {
  if (!entry || entry.id !== id || entry.profileId !== profileId) return null;
  if (!(now - entry.at < PREFETCH_TTL)) return null;
  return entry.promise || null;
}
