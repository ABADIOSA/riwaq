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
