/**
 * Reading a folder's TMDB and Trakt sources. The request builders and
 * response parsers are pure; the client does the fetching with the viewer's
 * own TMDB key and Trakt client ID. Titles come back as TMDB or Trakt IDs,
 * while Riwaq's addons open titles by IMDb ID, so every result carries the
 * IDs needed to find it (Trakt includes the IMDb ID; TMDB needs a lookup).
 */

const date = (value) =>
  typeof value === "string" && /^\d{4}/.test(value) ? value.slice(0, 10) : "";

/** The TMDB endpoint and query for one source page. */
export function tmdbRequest(source, { page = 1, language = "ar-SA" } = {}) {
  const lang = { language };
  switch (source.kind) {
    case "list":
      return { path: `list/${source.id}`, params: { ...lang, page } };
    case "collection":
      return { path: `collection/${source.id}`, params: lang };
    case "person":
    case "director":
      return { path: `person/${source.id}/combined_credits`, params: lang };
    default: {
      const tv = source.kind === "network" || source.media === "tv";
      const f = source.filters || {};
      let sort = source.sort === "original" ? "popularity.desc" : source.sort;
      if (tv && sort === "primary_release_date.desc")
        sort = "first_air_date.desc";
      if (!tv && sort === "first_air_date.desc")
        sort = "primary_release_date.desc";
      const params = {
        ...lang,
        page,
        sort_by: sort || "popularity.desc",
        include_adult: "false",
      };
      const set = (key, value) => {
        if (value !== undefined && value !== null && value !== "")
          params[key] = String(value);
      };
      set(
        "with_companies",
        source.kind === "company" ? source.id : f.withCompanies,
      );
      set(
        "with_networks",
        source.kind === "network" ? source.id : f.withNetworks,
      );
      set("without_companies", f.withoutCompanies);
      set("with_genres", f.withGenres);
      set("without_genres", f.withoutGenres);
      set("with_keywords", f.withKeywords);
      set("without_keywords", f.withoutKeywords);
      set("with_original_language", f.withOriginalLanguage);
      set("with_origin_country", f.withOriginCountry);
      set("vote_average.gte", f.voteAverageGte);
      set("vote_average.lte", f.voteAverageLte);
      set("vote_count.gte", f.voteCountGte);
      set("with_runtime.gte", f.withRuntimeGte);
      set("with_runtime.lte", f.withRuntimeLte);
      // TMDB's television discover has no people filter.
      if (!tv) set("with_people", f.withPeople);
      // A provider filter needs a region; like Nuvio, assume the US when the
      // source names none, rather than dropping the filter.
      if (f.withWatchProviders || f.withoutWatchProviders) {
        set("watch_region", f.watchRegion || "US");
        set("with_watch_providers", f.withWatchProviders);
        set("without_watch_providers", f.withoutWatchProviders);
        if (f.withWatchProviders)
          set("with_watch_monetization_types", "flatrate|free|ads|rent|buy");
      }
      const gte = tv ? "first_air_date.gte" : "primary_release_date.gte";
      const lte = tv ? "first_air_date.lte" : "primary_release_date.lte";
      set(gte, f.releaseDateGte);
      set(lte, f.releaseDateLte);
      set(tv ? "first_air_date_year" : "primary_release_year", f.year);
      return { path: tv ? "discover/tv" : "discover/movie", params };
    }
  }
}

/**
 * TMDB results as items with their TMDB ID and kind, in the order the
 * source asks for. A person's credits keep only the chosen media and, for a
 * director, only directing jobs.
 */
export function tmdbItems(body, source) {
  let list;
  if (source.kind === "collection") list = body?.parts;
  else if (source.kind === "list") list = body?.items;
  else if (source.kind === "person") list = body?.cast;
  else if (source.kind === "director")
    list = (body?.crew || []).filter((c) => /^director$/i.test(c?.job || ""));
  else list = body?.results;
  const fixed =
    source.kind === "network"
      ? "tv"
      : source.kind === "collection"
        ? "movie"
        : "";
  const items = [];
  const seen = new Set();
  for (const r of Array.isArray(list) ? list : []) {
    const kind =
      fixed ||
      (["list"].includes(source.kind)
        ? r?.media_type === "tv"
          ? "tv"
          : "movie"
        : ["person", "director"].includes(source.kind)
          ? r?.media_type
          : source.media);
    if (kind !== "movie" && kind !== "tv") continue;
    if (["person", "director"].includes(source.kind) && kind !== source.media)
      continue;
    const id = Number(r?.id);
    const name = String(
      r?.title || r?.name || r?.original_title || r?.original_name || "",
    ).trim();
    if (!Number.isInteger(id) || id < 1 || !name || seen.has(`${kind}:${id}`))
      continue;
    seen.add(`${kind}:${id}`);
    const released = date(r?.release_date || r?.first_air_date);
    items.push({
      tmdb: id,
      kind,
      name: name.slice(0, 200),
      released,
      rating:
        Number.isFinite(r?.vote_average) && r.vote_average > 0
          ? r.vote_average
          : null,
      votes: Number(r?.vote_count) || 0,
      popularity: Number(r?.popularity) || 0,
      poster:
        typeof r?.poster_path === "string" &&
        /^\/[\w.-]{1,120}$/.test(r.poster_path)
          ? r.poster_path
          : "",
    });
  }
  const by = {
    "vote_average.desc": (a, b) => (b.rating || 0) - (a.rating || 0),
    "vote_count.desc": (a, b) => b.votes - a.votes,
    "primary_release_date.desc": (a, b) => b.released.localeCompare(a.released),
    "first_air_date.desc": (a, b) => b.released.localeCompare(a.released),
    "popularity.desc": (a, b) => b.popularity - a.popularity,
  }[source.sort];
  // Discover pages come back already sorted by TMDB; the rest sort here.
  if (by && !["discover", "company", "network"].includes(source.kind))
    items.sort(by);
  // A film collection in "original" order reads best in release order.
  if (source.kind === "collection" && source.sort === "original")
    items.sort((a, b) =>
      (a.released || "9999").localeCompare(b.released || "9999"),
    );
  return items;
}

/** One Trakt public list page request (the client adds its API key). */
export function traktRequest(source, { page = 1 } = {}) {
  const type = source.media === "tv" ? "show" : "movie";
  const q = new URLSearchParams({
    extended: "full",
    page: String(page),
    limit: "50",
    sort_by: source.sort,
    sort_how: source.how,
  });
  return `https://api.trakt.tv/lists/${source.list}/items/${type}?${q}`;
}

/** Trakt list items that carry an IMDb ID, as Riwaq metas. */
export function traktMetas(body, source) {
  const key = source.media === "tv" ? "show" : "movie";
  const metas = [];
  const seen = new Set();
  for (const item of Array.isArray(body) ? body : []) {
    const m = item?.[key];
    const imdb = m?.ids?.imdb;
    if (!/^tt\d{5,12}$/.test(imdb || "") || seen.has(imdb)) continue;
    seen.add(imdb);
    const name = String(m?.title || "").trim();
    if (!name) continue;
    metas.push({
      id: imdb,
      type: source.media === "tv" ? "series" : "movie",
      name: name.slice(0, 200),
      poster: `https://images.metahub.space/poster/medium/${imdb}/img`,
      ...(m?.year ? { releaseInfo: String(m.year) } : {}),
      ...(Number.isFinite(m?.rating) && m.rating > 0
        ? { imdbRating: m.rating.toFixed(1) }
        : {}),
    });
  }
  return metas;
}

/** A readable row name for a source without a title of its own. */
export function sourceLabel(source, trakt = false) {
  if (source.title) return source.title;
  if (trakt) return `قائمة Trakt ${source.list}`;
  return (
    {
      list: "قائمة TMDB",
      collection: "سلسلة أفلام",
      company: "استوديو",
      network: "شبكة",
      discover: "اكتشف من TMDB",
      person: "أعمال ممثل",
      director: "أعمال مخرج",
    }[source.kind] || "TMDB"
  );
}
