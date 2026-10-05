export const PROVIDERS = [
  {
    id: "tmdb",
    name: "TMDB",
    description: "عناوين وأوصاف عربية، طاقم العمل، الصور ومنصات العرض",
    url: "https://www.themoviedb.org/settings/api",
  },
  {
    id: "omdb",
    name: "OMDb",
    description: "تقييمات IMDb وRotten Tomatoes وMetacritic",
    url: "https://www.omdbapi.com/apikey.aspx",
  },
  {
    id: "mdblist",
    name: "MDBList",
    description: "تقييمات متعددة من Letterboxd وTrakt ومصادر أخرى",
    url: "https://mdblist.com/preferences/",
  },
  {
    id: "fanart",
    name: "Fanart.tv",
    description: "شعارات العناوين وخلفيات سينمائية عالية الجودة",
    url: "https://fanart.tv/get-an-api-key/",
  },
];
const image = (path, size = "original") =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : undefined;
const finiteRating = (source, value) =>
  value !== null && value !== undefined && value !== "" && value !== "N/A"
    ? { source, value: String(value).slice(0, 30) }
    : null;

export class DataHub {
  constructor(client) {
    this.client = client;
    this.cache = new Map();
    this.generation = 0;
  }
  publicState() {
    return PROVIDERS.map((p) => {
      const s = this.client.state.providers?.[p.id] || {};
      return {
        ...p,
        configured: !!s.key,
        enabled: s.enabled !== false,
        status: s.status || "untested",
        testedAt: s.testedAt || null,
      };
    });
  }
  save({ id, key, enabled, clear = false }) {
    if (!PROVIDERS.some((p) => p.id === id))
      throw new Error("خدمة البيانات غير معروفة");
    const state = (this.client.state.providers ||= {});
    const current = state[id] || {};
    if (clear) delete state[id];
    else {
      if (
        key !== undefined &&
        (typeof key !== "string" || key.length > 4096 || /[\r\n]/.test(key))
      )
        throw new Error("مفتاح الخدمة غير صالح");
      state[id] = {
        ...current,
        ...(key?.trim() ? { key: key.trim(), status: "untested" } : {}),
        enabled:
          typeof enabled === "boolean" ? enabled : current.enabled !== false,
      };
    }
    this.cache.clear();
    this.generation++;
    this.client.persist();
    return this.client.publicState();
  }
  async request(id, path, params = {}) {
    const key = this.client.state.providers?.[id]?.key;
    if (!key) throw new Error("أضف مفتاح الخدمة أولاً");
    const bases = {
      tmdb: "https://api.themoviedb.org/3/",
      omdb: "https://www.omdbapi.com/",
      mdblist: "https://api.mdblist.com/",
      fanart: "https://webservice.fanart.tv/v3/",
    };
    const url = new URL(path, bases[id]),
      headers = {};
    if (id === "tmdb" && !/^[a-f\d]{32}$/i.test(key))
      headers.Authorization = `Bearer ${key}`;
    else
      url.searchParams.set(
        id === "tmdb" || id === "fanart" ? "api_key" : "apikey",
        key,
      );
    for (const [k, v] of Object.entries(params))
      url.searchParams.set(k, String(v));
    // Reject redirects instead of forwarding provider credentials to another host.
    const result = await this.client.request(url.toString(), {
      headers,
      redirect: "error",
    });
    if (result.Response === "False" || result.success === false || result.error)
      throw new Error("لم تقبل الخدمة المفتاح أو الطلب");
    return result;
  }
  async test(id) {
    const paths = {
      tmdb: ["configuration", {}],
      omdb: ["", { i: "tt0111161" }],
      mdblist: ["user", {}],
      fanart: ["movies/tt0111161", {}],
    };
    if (!paths[id]) throw new Error("خدمة غير معروفة");
    const entry = this.client.state.providers?.[id];
    if (!entry?.key) throw new Error("احفظ مفتاح الخدمة أولاً");
    try {
      await this.request(id, ...paths[id]);
      entry.status = "ok";
    } catch {
      entry.status = "error";
    }
    entry.testedAt = Date.now();
    this.client.persist();
    return this.client.publicState();
  }
  async tmdb(meta) {
    const kind = meta.type === "movie" ? "movie" : "tv";
    const found = await this.request("tmdb", `find/${meta.id}`, {
      external_source: "imdb_id",
    });
    const match = found[`${kind}_results`]?.[0];
    if (!match) return {};
    const detail = await this.request("tmdb", `${kind}/${match.id}`, {
      language: this.client.state.settings.metadataLanguage || "ar-SA",
      append_to_response: "credits,external_ids,watch/providers",
    });
    const providers =
      detail["watch/providers"]?.results?.[
        this.client.state.settings.region || "SA"
      ];
    return {
      name: detail.title || detail.name || meta.name,
      // The title in its own language, for searches that are not translated.
      originalName: String(
        detail.original_title || detail.original_name || "",
      ).slice(0, 200),
      description: detail.overview || meta.description,
      poster: image(detail.poster_path, "w500") || meta.poster,
      background: image(detail.backdrop_path) || meta.background,
      cast: detail.credits?.cast?.slice(0, 12).map((a) => a.name) || meta.cast,
      genres: detail.genres?.map((g) => g.name) || meta.genres,
      tmdbId: match.id,
      tvdbId: detail.external_ids?.tvdb_id,
      ratings: [finiteRating("TMDB", detail.vote_average?.toFixed(1))].filter(
        Boolean,
      ),
      watchProviders:
        providers?.flatrate?.map((p) => ({
          name: p.provider_name,
          logo: image(p.logo_path, "w92"),
        })) || [],
      watchProviderLink: providers?.link,
    };
  }
  async enrich(meta) {
    const generation = this.generation;
    if (!/^tt\d+$/.test(meta.id) || !["movie", "series"].includes(meta.type))
      return meta;
    const cacheKey = `${meta.type}:${meta.id}:${this.client.state.settings.metadataLanguage}:${this.client.state.settings.region}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.at < 1800000)
      return { ...meta, ...cached.value };
    const active = (id) => {
      const p = this.client.state.providers?.[id];
      return p?.key && p.enabled !== false;
    };
    let enrichment = {},
      ratings = [],
      sources = [],
      failures = [];
    const jobs = [];
    if (active("tmdb"))
      jobs.push(
        (async () => {
          try {
            const data = await this.tmdb(meta);
            enrichment = { ...enrichment, ...data };
            ratings.push(...(data.ratings || []));
            sources.push("TMDB");
          } catch {
            failures.push("TMDB");
          }
        })(),
      );
    if (active("omdb"))
      jobs.push(
        (async () => {
          try {
            const data = await this.request("omdb", "", {
              i: meta.id,
              plot: "full",
            });
            ratings.push(
              ...(data.Ratings || [])
                .map((r) => finiteRating(r.Source, r.Value))
                .filter(Boolean),
            );
            sources.push("OMDb");
          } catch {
            failures.push("OMDb");
          }
        })(),
      );
    if (active("mdblist"))
      jobs.push(
        (async () => {
          try {
            const data = await this.request(
              "mdblist",
              `imdb/${meta.type === "movie" ? "movie" : "show"}/${meta.id}`,
            );
            ratings.push(
              ...(data.ratings || [])
                .map((r) => finiteRating(r.source, r.value))
                .filter(Boolean),
            );
            sources.push("MDBList");
          } catch {
            failures.push("MDBList");
          }
        })(),
      );
    await Promise.all(jobs);
    if (active("fanart") && (meta.type === "movie" || enrichment.tvdbId)) {
      try {
        const data = await this.request(
          "fanart",
          meta.type === "movie"
            ? `movies/${meta.id}`
            : `tv/${enrichment.tvdbId}`,
        );
        const logos =
          data.hdmovielogo ||
          data.hdtvlogo ||
          data.movielogo ||
          data.clearlogo ||
          [];
        const logo =
          logos.find((l) => l.lang === "ar") ||
          logos.find((l) => l.lang === "en") ||
          logos[0];
        if (logo?.url?.startsWith("https://")) enrichment.logo = logo.url;
        const back = (data.moviebackground || data.showbackground)?.[0]?.url;
        if (back?.startsWith("https://")) enrichment.background = back;
        sources.push("Fanart.tv");
      } catch {
        failures.push("Fanart.tv");
      }
    }
    const value = {
      ...enrichment,
      ratings: [
        ...new Map(ratings.map((r) => [r.source.toLowerCase(), r])).values(),
      ],
      dataSources: sources,
      dataFailures: failures,
    };
    if (!failures.length && generation === this.generation)
      this.cache.set(cacheKey, { at: Date.now(), value });
    return { ...meta, ...value };
  }
  async resolve(title, year) {
    const data = await this.request("tmdb", "search/movie", {
      query: title,
      year: year || "",
      language: "en-US",
    });
    // Never silently map a CSV title to a different film.
    const normalized = (s) =>
      String(s || "")
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]/gu, "");
    const match = data.results?.find(
      (m) =>
        (normalized(m.title) === normalized(title) ||
          normalized(m.original_title) === normalized(title)) &&
        (!year || m.release_date?.startsWith(String(year))),
    );
    if (!match) return null;
    const ids = await this.request("tmdb", `movie/${match.id}/external_ids`);
    return /^tt\d+$/.test(ids.imdb_id || "")
      ? {
          id: ids.imdb_id,
          type: "movie",
          name: match.title,
          poster: image(match.poster_path, "w500"),
          background: image(match.backdrop_path),
          releaseInfo: match.release_date?.slice(0, 4),
        }
      : null;
  }
}
