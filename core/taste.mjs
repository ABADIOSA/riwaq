// Explainable, local recommendations. No network, accounts or inferred ratings.
import { foldArabic } from "./arabic.mjs";
import { titleKey } from "./library.mjs";
import { runtimeMinutes } from "./session.mjs";

export const TASTE_GENRES = [
  ["action", "أكشن", ["action", "أكشن", "حركة"]],
  ["adventure", "مغامرة", ["adventure", "مغامرة", "مغامرات"]],
  ["comedy", "كوميديا", ["comedy", "كوميديا"]],
  ["drama", "دراما", ["drama", "دراما"]],
  ["mystery", "غموض", ["mystery", "غموض"]],
  ["thriller", "إثارة", ["thriller", "إثارة", "تشويق"]],
  ["crime", "جريمة", ["crime", "جريمة"]],
  ["fantasy", "فانتازيا", ["fantasy", "فانتازيا"]],
  ["scifi", "خيال علمي", ["science fiction", "sci-fi", "sci fi", "خيال علمي"]],
  ["animation", "رسوم متحركة", ["animation", "رسوم متحركة", "أنيميشن"]],
  ["family", "عائلي", ["family", "عائلي", "عائلة"]],
  ["documentary", "وثائقي", ["documentary", "وثائقي"]],
  ["romance", "رومانسي", ["romance", "رومانسي", "رومانسية"]],
  ["history", "تاريخي", ["history", "تاريخ", "تاريخي"]],
  ["horror", "رعب", ["horror", "رعب"]],
  ["music", "موسيقى", ["music", "musical", "موسيقى", "موسيقي"]],
];
const aliases = new Map(
  TASTE_GENRES.flatMap(([id, , names]) =>
    names.map((n) => [foldArabic(n), id]),
  ),
);
const known = new Set(TASTE_GENRES.map(([id]) => id));
const label = (id) => TASTE_GENRES.find(([key]) => key === id)?.[1] || id;
const text = (v, max) =>
  typeof v === "string" &&
  v.trim().length > 0 &&
  v.length <= max &&
  !/[\x00-\x1f]/.test(v);
const validTitle = (m) =>
  m &&
  ["movie", "series"].includes(m.type) &&
  text(m.id, 200) &&
  text(m.name, 300);
export function tasteGenres(meta) {
  return [
    ...new Set(
      (Array.isArray(meta?.genres) ? meta.genres : [])
        .slice(0, 30)
        .map((g) => (typeof g === "string" ? aliases.get(foldArabic(g)) : null))
        .filter(Boolean),
    ),
  ];
}
export function cleanTaste(value) {
  const input = value && typeof value === "object" ? value : {};
  const seen = new Set();
  const feedback = (Array.isArray(input.feedback) ? input.feedback : [])
    .filter((f) => validTitle(f) && ["like", "hide"].includes(f.value))
    .map((f) => ({
      id: f.id,
      type: f.type,
      name: f.name,
      value: f.value,
      genres: [
        ...new Set(
          (Array.isArray(f.genres) ? f.genres : []).filter((g) => known.has(g)),
        ),
      ],
      updated: Number.isFinite(f.updated) && f.updated >= 0 ? f.updated : 0,
    }))
    .sort((a, b) => b.updated - a.updated)
    .filter((f) => {
      const key = titleKey(f);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 300);
  return {
    genres: [
      ...new Set(
        (Array.isArray(input.genres) ? input.genres : []).filter((g) =>
          known.has(g),
        ),
      ),
    ],
    exploration: ["balanced", "familiar", "curious"].includes(input.exploration)
      ? input.exploration
      : "balanced",
    feedback,
  };
}
export function editTaste(previous, action, now = Date.now()) {
  const taste = cleanTaste(previous);
  if (action.action === "preferences") {
    return cleanTaste({
      ...taste,
      genres: action.genres ?? taste.genres,
      exploration: action.exploration ?? taste.exploration,
    });
  }
  if (action.action === "reset") return cleanTaste({});
  if (
    action.action !== "feedback" ||
    !validTitle(action.meta) ||
    !["like", "hide", "clear"].includes(action.value)
  )
    throw new Error("اختيار الذوق غير صالح");
  const feedback = taste.feedback.filter(
    (f) => titleKey(f) !== titleKey(action.meta),
  );
  if (action.value !== "clear")
    feedback.unshift({
      id: action.meta.id,
      type: action.meta.type,
      name: action.meta.name,
      genres: tasteGenres(action.meta),
      value: action.value,
      updated: now,
    });
  return cleanTaste({ ...taste, feedback });
}
export function tasteProfile(value) {
  const taste = cleanTaste(value),
    weights = new Map();
  for (const genre of taste.genres) weights.set(genre, 6);
  for (const f of taste.feedback.filter((f) => f.value === "like"))
    for (const genre of f.genres)
      weights.set(genre, Math.min(12, (weights.get(genre) || 0) + 2));
  return {
    taste,
    weights,
    hidden: new Set(
      taste.feedback.filter((f) => f.value === "hide").map(titleKey),
    ),
  };
}
export const tasteAffinity = (meta, profile) =>
  tasteGenres(meta)
    .map((g) => profile.weights.get(g) || 0)
    .sort((a, b) => b - a)
    .slice(0, 2)
    .reduce((a, b) => a + b, 0);

/** Interleave catalogs so one fast or very large catalog cannot own the shelf. */
export function tasteCandidates(rows) {
  const pool = new Map(),
    sample = (Array.isArray(rows) ? rows : []).slice(0, 80);
  for (let index = 0; index < 60 && pool.size < 600; index++) {
    for (const row of sample) {
      const meta = row?.metas?.[index];
      if (!validTitle(meta)) continue;
      const key = titleKey(meta),
        previous = pool.get(key);
      if (!previous) pool.set(key, { ...meta });
      else
        pool.set(key, {
          ...meta,
          ...previous,
          genres: [
            ...new Set([
              ...(Array.isArray(previous.genres) ? previous.genres : []),
              ...(Array.isArray(meta.genres) ? meta.genres : []),
            ]),
          ],
          runtime: previous.runtime || meta.runtime,
        });
      if (pool.size >= 600) break;
    }
  }
  return [...pool.values()];
}

export function recommendTaste(
  metas,
  value,
  {
    watched = new Set(),
    type = "",
    maxMinutes = 0,
    limit = 8,
    now = Date.now(),
  } = {},
) {
  const profile = tasteProfile(value),
    { taste, weights, hidden } = profile;
  const liked = taste.feedback.filter((f) => f.value === "like");
  const knownLikes = new Set(liked.map(titleKey));
  const seen = new Set();
  let eligible = (Array.isArray(metas) ? metas : [])
    .slice(0, 600)
    .filter((m) => {
      if (!validTitle(m)) return false;
      const key = titleKey(m);
      if (seen.has(key)) return false;
      seen.add(key);
      return (
        !hidden.has(key) &&
        !knownLikes.has(key) &&
        !watched.has(`${m.type}:${m.id}`) &&
        (!type || m.type === type) &&
        !(Date.parse(m.released) > now) &&
        !(parseInt(m.releaseInfo || m.year) > new Date(now).getFullYear()) &&
        (!maxMinutes ||
          (m.type === "movie" &&
            runtimeMinutes(m.runtime) &&
            runtimeMinutes(m.runtime) <= maxMinutes))
      );
    })
    .map((meta, index) => {
      const genres = tasteGenres(meta),
        score = tasteAffinity(meta, profile);
      const selected = genres.filter((g) => taste.genres.includes(g));
      const source = liked.find((f) =>
        f.genres.some((g) => genres.includes(g)),
      );
      return {
        meta,
        genres,
        score,
        index,
        reason: selected.length
          ? `لأنك اخترت ${selected.slice(0, 2).map(label).join(" و")}`
          : source
            ? `يشترك في النوع مع «${source.name}» الذي أحببته`
            : "اكتشاف من فهارسك المحمّلة",
        novel: genres.length > 0 && !score,
      };
    });
  if (taste.exploration === "familiar" && weights.size)
    eligible = eligible.filter((c) => c.score > 0);
  const result = [],
    used = new Map();
  while (eligible.length && result.length < Math.min(12, Math.max(1, limit))) {
    const explore =
      weights.size &&
      taste.exploration === "curious" &&
      result.length % 3 === 0;
    const novelty = explore ? eligible.filter((c) => c.novel) : [];
    const choices = novelty.length ? novelty : eligible;
    // Diminishing returns keep a shelf from repeating the same two genres.
    const rank = (c) =>
      c.score -
      c.genres.reduce((sum, g) => sum + (used.get(g) || 0), 0) *
        (taste.exploration === "familiar" ? 1 : 4);
    const pick = [...choices].sort(
      (a, b) => rank(b) - rank(a) || a.index - b.index,
    )[0];
    result.push({
      ...pick,
      reason: novelty.length
        ? "خارج المعتاد: نوع مختلف عن اختياراتك"
        : pick.reason,
    });
    for (const genre of pick.genres)
      used.set(genre, (used.get(genre) || 0) + 1);
    eligible = eligible.filter((c) => c !== pick);
  }
  return result;
}
