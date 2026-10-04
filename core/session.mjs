import {
  continueWatching,
  isCompleted,
  releasedEpisodes,
  titleKey,
} from "./library.mjs";
import { foldArabic } from "./arabic.mjs";

export const SESSION_MOODS = [
  { id: "any", label: "فاجئني", genres: [] },
  {
    id: "light",
    label: "شيء خفيف",
    genres: ["comedy", "family", "كوميديا", "عائلي"],
  },
  {
    id: "thrill",
    label: "شدّ انتباهي",
    genres: [
      "thriller",
      "mystery",
      "crime",
      "action",
      "إثارة",
      "غموض",
      "جريمة",
      "أكشن",
    ],
  },
  {
    id: "wonder",
    label: "خذني بعيداً",
    genres: [
      "fantasy",
      "sci-fi",
      "science fiction",
      "adventure",
      "animation",
      "خيال",
      "فانتازيا",
      "مغامرة",
      "رسوم متحركة",
    ],
  },
  {
    id: "depth",
    label: "شيء يبقى معي",
    genres: ["drama", "documentary", "history", "دراما", "وثائقي", "تاريخ"],
  },
];

/** Runtime is minutes in Stremio; never guess one from a title or rating. */
export function runtimeMinutes(value) {
  if (typeof value === "number")
    return value > 0 && value <= 600 ? Math.ceil(value) : null;
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  let minutes;
  if (/^\d+(\.\d+)?\s*(min(utes?)?|m|دقيقة|دقائق|د)?$/.test(text))
    minutes = parseFloat(text);
  else {
    const match = text.match(/^(\d+)\s*h(?:\s*(\d+)\s*m(?:in)?)?$/);
    if (match) minutes = Number(match[1]) * 60 + Number(match[2] || 0);
  }
  return minutes > 0 && minutes <= 600 ? Math.ceil(minutes) : null;
}

export function matchesMood(meta, mood) {
  const desired = SESSION_MOODS.find((item) => item.id === mood)?.genres || [];
  const genres = (Array.isArray(meta?.genres) ? meta.genres : []).map((g) =>
    foldArabic(String(g)),
  );
  return (
    !desired.length ||
    desired.some((g) => genres.some((v) => v.includes(foldArabic(g))))
  );
}

/** Bounded, interleaved catalog sample; saved and unfinished titles come first. */
export function sessionSeeds(
  { favorites = [], progress = {}, rows = [] },
  mood = "any",
) {
  const seeds = new Map();
  const done = new Set(
    Object.values(progress)
      .filter(isCompleted)
      .filter((p) => p.meta?.type === "movie")
      .map((p) => titleKey(p.meta)),
  );
  const add = (meta, origin, resume) => {
    if (
      typeof meta?.id !== "string" ||
      !meta.id ||
      typeof meta.name !== "string" ||
      !meta.name ||
      !["movie", "series"].includes(meta.type) ||
      done.has(titleKey(meta))
    )
      return;
    if (!seeds.has(titleKey(meta)))
      seeds.set(titleKey(meta), { meta, origin, resume });
  };
  continueWatching(progress).forEach((p) => add(p.meta, "continue", p));
  favorites.forEach((m) => add(m, "library"));
  for (let i = 0; i < 12 && seeds.size < 80; i++)
    for (const row of rows.slice(0, 30)) {
      add(row.metas?.[i], "discover");
      if (seeds.size >= 80) break;
    }
  return [...seeds.values()]
    .sort(
      (a, b) =>
        Number(matchesMood(b.meta, mood)) - Number(matchesMood(a.meta, mood)),
    )
    .slice(0, 18);
}

export function sessionCandidate(
  seed,
  details,
  progress = {},
  now = Date.now(),
) {
  const meta = {
    ...seed.meta,
    ...details,
    id: seed.meta.id,
    type: seed.meta.type,
    name: typeof details?.name === "string" ? details.name : seed.meta.name,
    videos: Array.isArray(details?.videos || seed.meta.videos)
      ? (details?.videos || seed.meta.videos).filter(
          (v) => v && typeof v.id === "string",
        )
      : [],
  };
  const future =
    Number.isFinite(Date.parse(meta.released)) &&
    Date.parse(meta.released) > now;
  if (
    future ||
    Number(String(meta.releaseInfo || meta.year || "").slice(0, 4)) >
      new Date(now).getFullYear()
  )
    return null;
  let videoId = meta.id,
    episode = null;
  let resume = seed.resume;
  if (meta.type === "series") {
    const videos = releasedEpisodes(meta, now).filter((v) => v.season !== 0);
    episode = resume
      ? videos.find((v) => v.id === resume.videoId)
      : videos.find(
          (v) =>
            !Object.values(progress).some(
              (p) =>
                p.videoId === v.id &&
                titleKey(p.meta) === titleKey(meta) &&
                isCompleted(p),
            ),
        );
    // A resume with a measured duration works even when the episode catalog is unavailable.
    if (!episode && !(resume?.videoId && resume.duration > 0)) return null;
    videoId = episode?.id || resume.videoId;
    if (!resume)
      resume = Object.values(progress).find(
        (p) => p.videoId === videoId && titleKey(p.meta) === titleKey(meta),
      );
  }
  if (isCompleted(resume)) return null;
  const measured = Number.isFinite(resume?.duration) && resume.duration > 0;
  const total = measured
    ? resume.duration / 60
    : runtimeMinutes(episode?.runtime) || runtimeMinutes(meta.runtime);
  if (!total || total > 600) return null;
  const position = Number.isFinite(resume?.position)
    ? Math.max(0, resume.position)
    : 0;
  const minutes = Math.ceil(total - position / 60);
  if (minutes < 1) return null;
  const continuing = position > 10;
  return {
    key: JSON.stringify([meta.type, videoId]),
    meta,
    videoId,
    minutes,
    origin: continuing ? "continue" : seed.origin,
    episode: episode
      ? `S${episode.season || 1} · E${episode.episode || 1}`
      : "",
    estimated:
      meta.type === "series" && !measured && !runtimeMinutes(episode?.runtime),
    reason: continuing
      ? "نكمل ما بدأته؛ حسبنا الوقت المتبقي فقط"
      : seed.origin === "library"
        ? "من الأعمال التي حفظتها في مكتبتك"
        : "اكتشاف من الفهارس المحمّلة لديك",
  };
}

/** Load only on request, at most three metadata calls at once. Obsolete jobs stop scheduling. */
export async function prepareSession(
  seeds,
  load,
  { progress = {}, current = () => true, now = Date.now() } = {},
) {
  const found = [],
    failures = [];
  let index = 0;
  const worker = async () => {
    while (current() && index < seeds.length) {
      const seed = seeds[index++];
      let meta;
      try {
        meta = await load(seed.meta);
      } catch {
        failures.push(seed.meta.id);
      }
      if (!current()) return;
      const candidate = sessionCandidate(seed, meta, progress, now);
      if (candidate) found.push(candidate);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, seeds.length) }, worker));
  return {
    candidates: found.sort((a, b) => a.key.localeCompare(b.key)),
    failures: failures.length,
    skipped: seeds.length - found.length,
  };
}

/** Pick up to three different titles, including a five-minute interval between them. */
export function planSession(
  candidates,
  { budget = 90, mood = "any", excluded = [] } = {},
) {
  budget = Math.min(240, Math.max(15, Number(budget) || 90));
  const eligible = candidates
    .filter(
      (c) =>
        c.minutes > 0 &&
        c.minutes <= budget &&
        !excluded.includes(c.key) &&
        matchesMood(c.meta, mood),
    )
    .slice(0, 30);
  let best = { items: [], minutes: 0, score: -1 };
  const visit = (items, start, minutes) => {
    if (items.length) {
      const preference =
        items.reduce(
          (sum, c) =>
            sum +
            (c.origin === "continue" ? 24 : c.origin === "library" ? 14 : 0),
          0,
        ) / items.length;
      const score = (minutes / budget) * 70 + preference;
      if (score > best.score) best = { items, minutes, score };
    }
    if (items.length === 3) return;
    for (let i = start; i < eligible.length; i++) {
      const next = eligible[i];
      if (items.some((c) => titleKey(c.meta) === titleKey(next.meta))) continue;
      const total = minutes + next.minutes + (items.length ? 5 : 0);
      if (total <= budget) visit([...items, next], i + 1, total);
    }
  };
  visit([], 0, 0);
  return {
    items: best.items.sort(
      (a, b) =>
        Number(b.origin === "continue") - Number(a.origin === "continue"),
    ),
    minutes: best.minutes,
    remaining: budget - best.minutes,
    budget,
  };
}
