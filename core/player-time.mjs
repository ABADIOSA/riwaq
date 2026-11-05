/**
 * The player's bottom bar (issue #140): chapters, the time counter and the
 * "ends at" clock, shared by the HUD and the theater. Pure functions, so
 * both draw the same thing and tests can check it without a player.
 */

/** "1:02:03" or "4:05": hours only when there are some. */
export function clockTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/**
 * The counter: "elapsed / total", or "-remaining / total" (the viewer clicks
 * it to switch). Live streams and unknown lengths show the position only.
 */
export function timeCounter(player = {}, mode = "elapsed") {
  const position = Math.max(0, Number(player.position) || 0);
  const duration = Number(player.duration);
  if (player.live || !Number.isFinite(duration) || duration <= 0)
    return clockTime(position);
  const total = clockTime(duration);
  return mode === "remaining"
    ? `-${clockTime(Math.max(0, duration - position))} / ${total}`
    : `${clockTime(Math.min(position, duration))} / ${total}`;
}

/**
 * The file's chapters as the bar draws them, or [] when they cannot be
 * trusted: MPV's chapter-list ({time, title}) sorted, with times inside the
 * file, repeated or near-repeated starts merged (the first title wins),
 * a first chapter that starts late given the opening, and each chapter's
 * end at the next one's start. One chapter is no division at all, and
 * nothing is invented: a missing title stays empty (the bar numbers it).
 */
export function chapterMarks(chapters, duration, { live = false } = {}) {
  const length = Number(duration);
  if (live || !Number.isFinite(length) || length <= 0) return [];
  if (!Array.isArray(chapters)) return [];
  const clean = chapters
    .map((c) => ({
      start: Number(c?.time),
      title: typeof c?.title === "string" ? c.title.trim().slice(0, 120) : "",
    }))
    .filter((c) => Number.isFinite(c.start) && c.start >= 0 && c.start < length)
    .sort((a, b) => a.start - b.start);
  const marks = [];
  for (const c of clean) {
    const last = marks.at(-1);
    // Under a second apart: the same place written twice.
    if (last && c.start - last.start < 1) {
      if (!last.title && c.title) last.title = c.title;
      continue;
    }
    marks.push({ ...c });
  }
  if (marks.length < 2) return [];
  marks[0].start = 0;
  return marks.map((m, i) => ({
    ...m,
    index: i,
    end: i + 1 < marks.length ? marks[i + 1].start : length,
  }));
}

/** The chapter playing at `position`, or null. */
export function chapterAt(marks, position) {
  const at = Number(position) || 0;
  for (let i = marks.length - 1; i >= 0; i--)
    if (at >= marks[i].start) return marks[i];
  return null;
}

/**
 * When the viewing would end if it played on from now: a 12-hour clock with
 * AM/PM (ص/م in Arabic), from the time left at the current speed, and
 * whether that falls on a later day (past midnight). Null for live streams,
 * an unknown length or a finished file, so no misleading time is shown.
 * While paused it is the end if playback resumed now.
 */
export function endsAt(player = {}, { now = Date.now(), locale = "ar" } = {}) {
  const duration = Number(player.duration);
  const position = Math.max(0, Number(player.position) || 0);
  if (player.live || !Number.isFinite(duration) || duration <= 0) return null;
  const left = duration - position;
  if (!(left > 0)) return null;
  const speed = Number(player.speed) > 0 ? Number(player.speed) : 1;
  const end = new Date(now + (left / speed) * 1000);
  const time = new Intl.DateTimeFormat(
    locale === "en" ? "en-US" : "ar-SA-u-ca-gregory-nu-latn",
    { hour: "numeric", minute: "2-digit", hour12: true },
  ).format(end);
  const start = new Date(now);
  const days = Math.round(
    (new Date(end.getFullYear(), end.getMonth(), end.getDate()) -
      new Date(start.getFullYear(), start.getMonth(), start.getDate())) /
      86400000,
  );
  return { time, days, at: end.getTime() };
}
