/**
 * Spoiler protection for series (Harbor's Detail pages): episode titles you
 * have not reached stay hidden until you get there. The episode you are on
 * and the next one to watch are always clear, as are finished episodes and
 * specials. Pure.
 */
import { isCompleted } from "./library.mjs";

const order = (a, b) =>
  (a.season ?? 1) - (b.season ?? 1) || (a.episode ?? 0) - (b.episode ?? 0);

/**
 * The IDs of episodes whose titles should stay hidden. `progress` is keyed
 * `${type}:${videoId}`, as the library stores it.
 */
export function spoilerIds(
  videos,
  progress = {},
  { type = "series", current = "" } = {},
) {
  const numbered = (videos || [])
    .filter((v) => v?.id && (v.season ?? 1) > 0)
    .sort(order);
  const done = (v) => isCompleted(progress[`${type}:${v.id}`]);
  let last = -1;
  numbered.forEach((v, i) => {
    if (done(v)) last = i;
  });
  const next = numbered[last + 1]?.id;
  const hidden = new Set();
  numbered.forEach((v, i) => {
    if (i > last + 1 && !done(v) && v.id !== current && v.id !== next)
      hidden.add(v.id);
  });
  return hidden;
}
