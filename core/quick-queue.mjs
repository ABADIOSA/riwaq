import { isCompleted, releasedEpisodes } from "./library.mjs";

/** A poster queues a concrete video, never a series ID masquerading as an episode. */
export function quickQueueTarget(meta, progress = {}, preferred) {
  if (meta.type === "movie")
    return {
      videoId: meta.behaviorHints?.defaultVideoId || meta.id,
      label: "",
    };
  const episodes = releasedEpisodes(meta);
  const saved = Object.values(progress)
    .filter((p) => p.meta?.id === meta.id && p.meta?.type === meta.type)
    .sort((a, b) => (b.updated || 0) - (a.updated || 0))[0];
  const episode =
    episodes.find((v) => v.id === preferred) ||
    (!isCompleted(saved) && episodes.find((v) => v.id === saved?.videoId)) ||
    episodes.find(
      (v) =>
        (v.season ?? 1) > 0 && !isCompleted(progress[`${meta.type}:${v.id}`]),
    ) ||
    episodes.find((v) => (v.season ?? 1) > 0);
  return episode
    ? {
        videoId: episode.id,
        label: `S${episode.season ?? 1} · E${episode.episode ?? ""}`,
      }
    : null;
}
