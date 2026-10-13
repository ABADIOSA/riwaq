/**
 * Continue watching on the same source (issue #74). A viewing keeps the
 * source it started with beside its progress: the opaque stream key (a hash
 * of the offer, never its link) and the loose identity series memory uses
 * (addon, release group, tier, source). A resume asks the addons again and
 * plays that offer when it is still there, else the closest one from the
 * same addon and release group, else it shows the list. Browser-safe.
 */
import { sourceIdentity } from "./series-memory.mjs";

const KEY = /^[a-f0-9]{24}$/;

/** A stored resume source, checked like everything restored or synced. */
export function cleanResumeSource(value) {
  if (!value || typeof value !== "object" || !KEY.test(value.key || ""))
    return null;
  const memory = value.memory ? sourceIdentity(value.memory) : null;
  return memory ? { key: value.key, memory } : { key: value.key };
}

/**
 * The offer to play again from a fresh source list, or null. External
 * links (a browser page, YouTube) are never started on their own.
 */
export function resumePick(streams = [], saved) {
  const source = cleanResumeSource(saved);
  if (!source) return null;
  const playable = streams.filter((s) => s?.supported && !s.external);
  const exact = playable.find((s) => s.key === source.key);
  if (exact) return { stream: exact, exact: true };
  const m = source.memory;
  if (!m) return null;
  const close = playable.find(
    (s) =>
      s.addonId === m.addonId &&
      (s.group || "") === (m.group || "") &&
      (s.tier || "") === (m.tier || "") &&
      (s.source || "") === (m.source || ""),
  );
  return close ? { stream: close, exact: false } : null;
}
