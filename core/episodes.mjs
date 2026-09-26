// Shared by main and React. No network or platform dependencies.
import { isCompleted, latestProgress } from "./library.mjs";

const EPISODIC = new Set(["series", "anime"]);
const DAY = 86400000;

const releasedAt = (video) => {
  const time = Date.parse(video?.released);
  return Number.isFinite(time) ? time : null;
};
// Specials (season 0) are real airings but not a place in the story: they
// neither advance "what's next" nor belong between two regular episodes.
const regular = (video) =>
  !!video?.id &&
  Number.isFinite(Number(video.episode)) &&
  Number(video.season ?? 1) > 0;
const order = (a, b) =>
  Number(a.season ?? 1) - Number(b.season ?? 1) ||
  Number(a.episode) - Number(b.episode);

/**
 * Series this viewer follows: saved to their library, queued, or watched at
 * least once. Most recently touched first, so the cap drops the stale ones.
 */
export function followedSeries(state, limit = 40) {
  const seen = new Map();
  const touch = (meta, at) => {
    if (!meta?.id || !EPISODIC.has(meta.type)) return;
    const key = `${meta.type}:${meta.id}`;
    const current = seen.get(key);
    if (!current || at > current.at) seen.set(key, { meta, at });
  };
  for (const record of latestProgress(state.progress || {}))
    touch(record.meta, record.updated || 0);
  for (const item of state.queue || []) touch(item.meta, item.added || 0);
  (state.favorites || []).forEach((meta, index) => touch(meta, index));
  return [...seen.values()]
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
    .map((entry) => entry.meta);
}

export function episodeLabel(video) {
  if (!video) return "";
  return `الموسم ${video.season ?? 1} · الحلقة ${video.episode}`;
}

/**
 * The next episode to watch in one series, or null. It is the first released
 * regular episode after the furthest one the viewer finished. A title with an
 * episode still in progress is left to continue watching, which already
 * offers it, and a series nobody has started yet has no "next".
 */
export function upNext(
  meta,
  progress = {},
  { now = Date.now(), freshDays = 14 } = {},
) {
  const videos = (meta?.videos || []).filter(regular).slice().sort(order);
  if (!videos.length) return null;
  const record = (video) => progress[`${meta.type}:${video.id}`];
  let furthest = -1;
  videos.forEach((video, index) => {
    if (isCompleted(record(video))) furthest = index;
  });
  if (furthest < 0) return null;
  const latest = latestProgress(progress).find(
    (entry) => entry.meta.id === meta.id && entry.meta.type === meta.type,
  );
  if (latest && !isCompleted(latest) && latest.position > 10) return null;
  const released = (video) => {
    const at = releasedAt(video);
    return at === null || at <= now;
  };
  const remaining = videos
    .slice(furthest + 1)
    .filter((video) => released(video) && !isCompleted(record(video)));
  if (!remaining.length) return null;
  const next = remaining[0];
  const at = releasedAt(next);
  return {
    meta: {
      id: meta.id,
      type: meta.type,
      name: meta.name,
      poster: meta.poster,
      background: meta.background,
    },
    video: {
      id: next.id,
      season: next.season ?? 1,
      episode: next.episode,
      title: next.title || next.name || "",
      thumbnail: next.thumbnail,
      released: next.released,
    },
    label: episodeLabel(next),
    remaining: remaining.length,
    fresh: at !== null && now - at <= freshDays * DAY,
  };
}

/** Up next across every followed series: fresh episodes first. */
export function upNextList(metas, progress, options = {}) {
  return metas
    .map((meta) => upNext(meta, progress, options))
    .filter(Boolean)
    .sort(
      (a, b) =>
        Number(b.fresh) - Number(a.fresh) ||
        (releasedAt(b.video) ?? 0) - (releasedAt(a.video) ?? 0),
    );
}

/**
 * Episodes airing in a window around now, for the calendar. Dates without a
 * parseable release are left out: placing them on a guessed day would be
 * worse than not showing them.
 */
export function calendarEntries(
  metas,
  progress = {},
  { now = Date.now(), days = 30, pastDays = 7 } = {},
) {
  const from = now - pastDays * DAY;
  const to = now + days * DAY;
  const entries = [];
  for (const meta of metas)
    for (const video of meta?.videos || []) {
      if (!regular(video)) continue;
      const at = releasedAt(video);
      if (at === null || at < from || at > to) continue;
      entries.push({
        meta: {
          id: meta.id,
          type: meta.type,
          name: meta.name,
          poster: meta.poster,
        },
        video: {
          id: video.id,
          season: video.season ?? 1,
          episode: video.episode,
          title: video.title || video.name || "",
          released: video.released,
        },
        label: episodeLabel(video),
        at,
        aired: at <= now,
        watched: isCompleted(progress[`${meta.type}:${video.id}`]),
      });
    }
  return entries.sort(
    (a, b) => a.at - b.at || a.meta.name.localeCompare(b.meta.name, "ar"),
  );
}

/** Groups calendar entries by calendar day in the viewer's time zone. */
export function groupByDay(entries, { timeZone } = {}) {
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const days = new Map();
  for (const entry of entries) {
    const day = format.format(new Date(entry.at));
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(entry);
  }
  return [...days.entries()].map(([day, list]) => ({ day, entries: list }));
}
