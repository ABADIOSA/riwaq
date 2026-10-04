/**
 * Sources without waiting for the slowest addon. Every stream addon is asked
 * at once; the list is shown when all have answered, or earlier once enough
 * is in hand:
 *
 * - `soft` ms after the start, if at least one addon has already returned a
 *   stream, the addons still out are left running as "late";
 * - before that, nothing is cut short;
 * - if nothing has returned a stream by `soft`, the list waits for the first
 *   addon that does, plus `grace` ms for others close behind, or for every
 *   addon to settle (each request has its own timeout).
 *
 * Late addons keep running. Their answers fill the same run, so asking again
 * shows them without a new request. Pure and browser-safe; the caller
 * supplies `ask(addon)` and the clock.
 */

export const SOURCE_SOFT_MS = 4000;
export const SOURCE_GRACE_MS = 1200;
export const SOURCE_RUN_TTL = 5 * 60 * 1000;

/**
 * Ask every addon. Resolves with `{ answers, late }`: `answers` maps each
 * answered addon's key (`keyOf`) to its streams (or `null` when it failed), `late`
 * lists the addons still out. `done` resolves when every addon has settled,
 * with the same `answers` filled in.
 */
export function gatherSources(
  addons,
  ask,
  {
    soft = SOURCE_SOFT_MS,
    grace = SOURCE_GRACE_MS,
    timer = setTimeout,
    clear = clearTimeout,
    keyOf = (addon) => addon.key,
  } = {},
) {
  const answers = new Map();
  const list = Array.isArray(addons) ? addons : [];
  let settle;
  const done = new Promise((resolve) => (settle = resolve));
  const ready = new Promise((resolve) => {
    let shown = false;
    let softPassed = false;
    let graceTimer = null;
    const pending = () => list.filter((a) => !answers.has(keyOf(a)));
    const haveStreams = () =>
      [...answers.values()].some((s) => Array.isArray(s) && s.length > 0);
    const show = () => {
      if (shown) return;
      shown = true;
      clear(softTimer);
      if (graceTimer) clear(graceTimer);
      resolve({ answers, late: pending() });
    };
    const softTimer = timer(() => {
      softPassed = true;
      if (haveStreams()) show();
    }, soft);
    if (!list.length) {
      show();
      settle(answers);
      return;
    }
    for (const addon of list)
      Promise.resolve()
        .then(() => ask(addon))
        .then(
          (streams) => (Array.isArray(streams) ? streams : []),
          () => null,
        )
        .then((streams) => {
          answers.set(keyOf(addon), streams);
          if (answers.size === list.length) {
            show();
            settle(answers);
            return;
          }
          // Past the soft limit with nothing yet: this is the first stream
          // in hand, so give the others close behind a moment, then show.
          if (softPassed && !shown && streams?.length && !graceTimer)
            graceTimer = timer(show, grace);
        });
  });
  // `answers` is live: it fills as addons answer, before and after `ready`.
  return { ready, done, answers };
}

/** Forgets runs older than the reuse window, so they free their answers. */
export function pruneRuns(runs, now = Date.now()) {
  for (const [key, run] of runs || [])
    if (now - run.at >= SOURCE_RUN_TTL) runs.delete(key);
}

/**
 * The remembered run for a title, when it is recent enough to reuse and was
 * asked of the same addons (`signature`) the viewer has enabled now.
 */
export function reusableRun(runs, key, now = Date.now(), signature) {
  pruneRuns(runs, now);
  const run = runs?.get(key);
  if (!run) return null;
  if (signature !== undefined && run.signature !== signature) return null;
  return run;
}

/** What identifies an addon list: the addresses, in order (main only). */
export const addonSignature = (addons = []) =>
  addons.map((a) => a.transportUrl || a.key || "").join("\n");
