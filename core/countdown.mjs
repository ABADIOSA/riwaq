/**
 * Countdowns to titles that are not out yet: a film's release, or a series'
 * next episode. A title page shows one when its date is in the future, and
 * the viewer may pin it to the home page.
 *
 * Release dates are calendar days, so a countdown runs to midnight of that
 * day on the viewer's clock. With the viewer's TMDB key, a film's date in
 * their region (Saudi cinemas, by default) is read from TMDB's release
 * dates and shown beside the worldwide one. Pure functions.
 */

export const COUNTDOWN_LIMIT = 12;
const DAY = /^(\d{4})-(\d{2})-(\d{2})/;
// TMDB release types: 1 premiere, 2 limited, 3 theatrical, 4 digital,
// 5 physical, 6 TV.
const RELEASE_LABELS = {
  1: "العرض الأول",
  2: "عرض محدود",
  3: "السينما",
  4: "المنصات الرقمية",
  5: "الإصدار المنزلي",
  6: "التلفزيون",
};

/** "2026-12-18" from an ISO date or date-time, or "". */
export function dayOf(value) {
  const m = DAY.exec(String(value || ""));
  if (!m) return "";
  const date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return Number.isNaN(date.getTime()) ? "" : `${m[1]}-${m[2]}-${m[3]}`;
}

/** Midnight of a day on a clock `offsetMinutes` east of UTC, as an instant. */
export function midnightOf(day, offsetMinutes) {
  const m = DAY.exec(day || "");
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) - offsetMinutes * 60000);
}

/** What is left until a moment: days, hours, minutes, seconds. */
export function remaining(target, now) {
  const ms = Math.max(0, target - now);
  const s = Math.floor(ms / 1000);
  return {
    done: ms <= 0,
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
  };
}

/**
 * The countdown a title deserves, or null: a film or series not out yet,
 * or a series' next unaired episode.
 */
export function releaseTarget(meta, now, offsetMinutes) {
  if (!meta || !["movie", "series"].includes(meta.type)) return null;
  const future = (day) => {
    const at = midnightOf(day, offsetMinutes);
    return at && at > now ? at : null;
  };
  if (meta.type === "series") {
    const next = (meta.videos || [])
      .filter((v) => (v.season ?? 1) > 0 && dayOf(v.released))
      .map((v) => ({ v, at: future(dayOf(v.released)) }))
      .filter((x) => x.at)
      .sort((a, b) => a.at - b.at)[0];
    if (next)
      return {
        day: dayOf(next.v.released),
        kind: "episode",
        label: `الحلقة ${next.v.episode ?? 1} من الموسم ${next.v.season ?? 1}`,
        videoId: next.v.id,
      };
  }
  const day = dayOf(meta.released);
  if (day && future(day))
    return {
      day,
      kind: meta.type === "series" ? "premiere" : "release",
      label: meta.type === "series" ? "العرض الأول" : "موعد الإصدار",
    };
  return null;
}

/**
 * A film's dates in one region from TMDB's release dates: the theatrical
 * date first, then the earliest of any other kind.
 */
export function parseReleaseDates(body, region = "SA") {
  const country = (Array.isArray(body?.results) ? body.results : []).find(
    (r) => r?.iso_3166_1 === region,
  );
  const dates = (country?.release_dates || [])
    .map((d) => ({ day: dayOf(d?.release_date), type: Number(d?.type) }))
    .filter((d) => d.day && RELEASE_LABELS[d.type])
    .sort((a, b) => a.day.localeCompare(b.day));
  const pick =
    dates.find((d) => d.type === 3) ||
    dates.find((d) => d.type === 2) ||
    dates[0];
  return pick
    ? {
        day: pick.day,
        type: pick.type,
        label: RELEASE_LABELS[pick.type],
        region,
      }
    : null;
}

const https = (value) => {
  if (typeof value !== "string" || value.length > 2000) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.toString()
      : "";
  } catch {
    return "";
  }
};

/** The viewer's pinned countdowns, validated. */
export function cleanCountdowns(input) {
  const out = [];
  for (const c of Array.isArray(input) ? input : []) {
    if (!c || typeof c !== "object") continue;
    const type =
      c.type === "series" ? "series" : c.type === "movie" ? "movie" : "";
    const id =
      typeof c.id === "string" && /^[\w:.-]{1,80}$/.test(c.id) ? c.id : "";
    const day = dayOf(c.day);
    if (!type || !id || !day || out.some((x) => x.type === type && x.id === id))
      continue;
    out.push({
      type,
      id,
      name: String(c.name || "").slice(0, 120) || id,
      day,
      label: String(c.label || "").slice(0, 60),
      ...(dayOf(c.localDay)
        ? {
            localDay: dayOf(c.localDay),
            localLabel: String(c.localLabel || "").slice(0, 40),
          }
        : {}),
      poster: https(c.poster),
      background: https(c.background),
      logo: https(c.logo),
    });
    if (out.length >= COUNTDOWN_LIMIT) break;
  }
  return out;
}
