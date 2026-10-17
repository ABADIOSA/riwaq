// Simkl's documented /sync/all-items and /scrobble objects. Keep IDs exact;
// an anime's absolute episode number must never become a guessed TV season.
const statuses = {
  watching: "أشاهده",
  plantowatch: "أريد مشاهدته",
  hold: "متوقف مؤقتاً",
  dropped: "متروك",
  completed: "مكتمل",
};
const positive = (value) =>
  /^\d{1,9}$/.test(String(value)) && Number(value) > 0;

export function simklLists(result) {
  if (!result || typeof result !== "object" || Array.isArray(result))
    throw new Error("استجابة مكتبة Simkl غير صالحة");
  const rows = [];
  for (const [kind, label] of Object.entries({
    movies: "أفلام",
    shows: "مسلسلات",
    anime: "أنمي",
  })) {
    if (result[kind] !== undefined && !Array.isArray(result[kind]))
      throw new Error("استجابة مكتبة Simkl غير صالحة");
    for (const [status, name] of Object.entries(statuses)) {
      const metas = (result[kind] || [])
        .filter((item) => item?.status === status)
        .map((item) => {
          const m = item.movie || item.show || item.anime;
          if (!m || !m.title) return null;
          const imdb = /^tt\d+$/.test(m.ids?.imdb || "") ? m.ids.imdb : "";
          const animeId =
            kind === "anime" &&
            ["anilist", "mal", "kitsu"].find((key) => positive(m.ids?.[key]));
          const id =
            imdb ||
            (animeId
              ? `${animeId}:${m.ids[animeId]}`
              : positive(m.ids?.simkl)
                ? `simkl:${m.ids.simkl}`
                : "");
          if (!id) return null;
          return {
            id,
            type:
              kind === "movies" || item.anime_type === "movie"
                ? "movie"
                : "series",
            name: String(m.title).slice(0, 200),
            releaseInfo: String(m.year || ""),
            ...(kind === "anime" ? { genres: ["Anime"] } : {}),
            poster: imdb
              ? `https://images.metahub.space/poster/medium/${imdb}/img`
              : /^[\w/-]{1,200}$/.test(m.poster || "")
                ? `https://simkl.in/posters/${m.poster}_m.jpg`
                : undefined,
          };
        })
        .filter(Boolean);
      if (metas.length)
        rows.push({
          key: `simkl-${kind}-${status}`,
          service: "simkl",
          name: `Simkl · ${label} · ${name}`,
          metas,
        });
    }
  }
  return rows;
}

export function simklScrobbleBody(meta, videoId, progress) {
  if (
    !meta ||
    !["movie", "series"].includes(meta.type) ||
    !Number.isFinite(progress)
  )
    return null;
  const imdb = /^tt\d+$/.test(meta.id || "");
  const named = /^(anilist|mal|kitsu|simkl):(\d{1,9})$/.exec(meta.id || "");
  if (!imdb && (!named || !positive(named[2]))) return null;
  const ids = imdb
    ? { imdb: meta.id }
    : { [named[1]]: named[1] === "simkl" ? Number(named[2]) : named[2] };
  const body = {
    progress: Math.round(Math.max(0, Math.min(100, progress)) * 100) / 100,
  };
  if (meta.type === "movie")
    return {
      ...body,
      [named && named[1] !== "simkl" ? "anime" : "movie"]: { ids },
    };
  const suffix = String(videoId || "").startsWith(`${meta.id}:`)
    ? String(videoId).slice(meta.id.length + 1)
    : "";
  if (imdb) {
    const match = /^(\d{1,4}):(\d{1,6})$/.exec(suffix);
    if (!match || Number(match[2]) < 1) return null;
    return {
      ...body,
      show: { ids },
      episode: { season: Number(match[1]), number: Number(match[2]) },
    };
  }
  // Only absolute-numbered anime IDs have an unambiguous episode here.
  if (named[1] === "simkl" || !positive(suffix)) return null;
  return {
    ...body,
    anime: { ids },
    episode: { season: 1, number: Number(suffix) },
  };
}

// Simkl's own runtimes when it knows none (its playback docs): only the
// ratio matters here, since a resume starts at the exact percentage.
const RUNTIME = { movie: 90 * 60, series: 45 * 60, anime: 25 * 60 };
const IMDB = /^tt\d{1,10}$/;
const count = (value) =>
  /^\d{1,4}$/.test(String(value ?? "")) ? Number(value) : null;

/**
 * Simkl's paused sessions (GET /sync/playback) as Riwaq resume points:
 * `{ meta, videoId, percent, pausedAt, duration }`, newest first. An item
 * is kept only with an ID an addon can play: IMDb (episodes by TVDB
 * numbering, which IMDb-based catalogs use), else an anime's Kitsu, MAL or
 * AniList ID with its absolute episode. Anything else is left out.
 */
export function simklPlaybacks(result, limit = 100) {
  if (result === null || result === undefined) return [];
  if (!Array.isArray(result))
    throw new Error("استجابة استئناف Simkl غير صالحة");
  const out = [];
  for (const item of result) {
    const percent = Number(item?.progress);
    const pausedAt = Date.parse(item?.paused_at);
    if (!(percent >= 1 && percent < 95) || !Number.isFinite(pausedAt)) continue;
    const point =
      item.type === "movie"
        ? moviePoint(item)
        : item.type === "episode"
          ? episodePoint(item)
          : null;
    if (!point) continue;
    out.push({ ...point, percent: Math.round(percent * 100) / 100, pausedAt });
    if (out.length >= limit) break;
  }
  return out.sort((a, b) => b.pausedAt - a.pausedAt);
}

function animeId(ids = {}) {
  const key = ["kitsu", "mal", "anilist"].find((k) => positive(ids[k]));
  return key ? `${key}:${Number(ids[key])}` : "";
}

function poster(work, imdb) {
  if (imdb) return `https://images.metahub.space/poster/medium/${imdb}/img`;
  return /^[\w/-]{1,200}$/.test(work?.poster || "")
    ? `https://simkl.in/posters/${work.poster}_m.jpg`
    : undefined;
}

function moviePoint(item) {
  const work = item.movie || item.anime;
  if (!work?.title) return null;
  const imdb = IMDB.test(work.ids?.imdb || "") ? work.ids.imdb : "";
  // Simkl may name an anime's object `show` or `movie`: its IDs tell.
  const anime = animeId(work.ids);
  const id = imdb || anime;
  if (!id) return null;
  const meta = (id) => ({
    id,
    type: "movie",
    name: String(work.title).slice(0, 200),
    poster: poster(work, imdb),
  });
  return {
    meta: meta(id),
    videoId: id,
    duration: RUNTIME[item.anime || anime ? "anime" : "movie"],
    ...(imdb && anime
      ? { alternates: [{ meta: meta(anime), videoId: anime }] }
      : {}),
  };
}

function episodePoint(item) {
  const work = item.show || item.anime;
  const episode = item.episode;
  if (!work?.title || !episode) return null;
  const imdb = IMDB.test(work.ids?.imdb || "") ? work.ids.imdb : "";
  const meta = (id) => ({
    id,
    type: "series",
    name: String(work.title).slice(0, 200),
    poster: poster(work, imdb),
  });
  // An anime's absolute (AniDB) episode under its Kitsu, MAL or AniList ID;
  // Simkl may name an anime's object `show`, so its IDs tell.
  const anime = animeId(work.ids);
  const duration = RUNTIME[item.anime || anime ? "anime" : "series"];
  const absolute = count(episode.number ?? episode.episode);
  const animeSeason = count(episode.season);
  const byAnime =
    anime && absolute && (animeSeason === null || animeSeason === 1)
      ? { meta: meta(anime), videoId: `${anime}:${absolute}` }
      : null;
  if (imdb) {
    const season = count(episode.tvdb_season ?? episode.season);
    const number = count(
      episode.tvdb_number ?? episode.number ?? episode.episode,
    );
    if (season !== null && number)
      return {
        meta: meta(imdb),
        videoId: `${imdb}:${season}:${number}`,
        duration,
        // The same episode as an anime addon names it: a viewing saved
        // under that key is the one this pause belongs to.
        ...(byAnime ? { alternates: [byAnime] } : {}),
      };
  }
  return byAnime ? { ...byAnime, duration } : null;
}

/** The playback times from GET /sync/activities, as one comparable mark. */
export function simklPlaybackMark(activities) {
  if (!activities || typeof activities !== "object") return "";
  const times = ["movies", "tv_shows", "anime"].map((kind) =>
    String(activities[kind]?.playback || ""),
  );
  // Without any time there is nothing to compare: the sessions are read.
  return times.some(Boolean) ? times.join("|") : "";
}
