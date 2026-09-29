import test from "node:test";
import assert from "node:assert/strict";
import {
  sourceLabel,
  tmdbItems,
  tmdbRequest,
  traktMetas,
  traktRequest,
} from "../core/collection-sources.mjs";
import {
  editCollections,
  parseTmdbSource,
  parseTraktSource,
} from "../core/collections.mjs";
import { Client } from "../core/client.mjs";

test("TMDB requests for every Nuvio source kind", () => {
  assert.deepEqual(tmdbRequest({ kind: "collection", id: 10 }), {
    path: "collection/10",
    params: { language: "ar-SA" },
  });
  assert.equal(tmdbRequest({ kind: "list", id: 5 }).path, "list/5");
  assert.equal(
    tmdbRequest({ kind: "director", id: 525, media: "movie" }).path,
    "person/525/combined_credits",
  );
  const studio = tmdbRequest({
    kind: "company",
    id: 420,
    media: "movie",
    sort: "popularity.desc",
  });
  assert.equal(studio.path, "discover/movie");
  assert.equal(studio.params.with_companies, "420");
  const network = tmdbRequest({
    kind: "network",
    id: 213,
    media: "tv",
    sort: "primary_release_date.desc",
  });
  assert.equal(network.path, "discover/tv");
  assert.equal(network.params.with_networks, "213");
  assert.equal(
    network.params.sort_by,
    "first_air_date.desc",
    "TV has its own date sort",
  );
  const anime = tmdbRequest({
    kind: "discover",
    media: "tv",
    sort: "popularity.desc",
    filters: {
      withGenres: "16",
      withOriginalLanguage: "ja",
      withPeople: "1",
      releaseDateGte: "2020-01-01",
      voteAverageGte: 7,
    },
  });
  assert.equal(anime.params.with_genres, "16");
  assert.equal(anime.params.with_original_language, "ja");
  assert.equal(anime.params["first_air_date.gte"], "2020-01-01");
  assert.equal(anime.params["vote_average.gte"], "7");
  assert.equal(
    anime.params.with_people,
    undefined,
    "no people filter on TV discover",
  );
});

test("TMDB results become ordered items with kinds", () => {
  const collection = tmdbItems(
    {
      parts: [
        { id: 3, title: "Return of the Jedi", release_date: "1983-05-25" },
        { id: 1, title: "A New Hope", release_date: "1977-05-25" },
        { id: 2, title: "Empire", release_date: "1980-05-21" },
        { id: 1, title: "A New Hope" },
        { id: "x", title: "bad" },
      ],
    },
    { kind: "collection", id: 10, media: "movie", sort: "original" },
  );
  assert.deepEqual(
    collection.map((i) => i.tmdb),
    [1, 2, 3],
    "a film collection in release order, one each",
  );
  const director = tmdbItems(
    {
      crew: [
        { id: 27205, media_type: "movie", title: "Inception", job: "Director" },
        { id: 1, media_type: "movie", title: "x", job: "Producer" },
        { id: 2, media_type: "tv", name: "y", job: "Director" },
      ],
    },
    { kind: "director", id: 525, media: "movie", sort: "original" },
  );
  assert.deepEqual(
    director.map((i) => i.tmdb),
    [27205],
  );
  const list = tmdbItems(
    {
      items: [
        { id: 1, media_type: "tv", name: "Show", first_air_date: "2011-04-17" },
        { id: 2, media_type: "movie", title: "Film" },
      ],
    },
    { kind: "list", id: 1, media: "movie", sort: "original" },
  );
  assert.deepEqual(
    list.map((i) => [i.tmdb, i.kind]),
    [
      [1, "tv"],
      [2, "movie"],
    ],
  );
  const network = tmdbItems(
    { results: [{ id: 9, name: "Stranger Things", vote_average: 8.6 }] },
    { kind: "network", id: 213, media: "tv" },
  );
  assert.equal(network[0].kind, "tv");
  assert.equal(network[0].rating, 8.6);
});

test("Trakt public lists need only the client ID and carry IMDb IDs", () => {
  const url = traktRequest({
    list: 123,
    media: "tv",
    sort: "added",
    how: "desc",
  });
  assert.equal(
    url,
    "https://api.trakt.tv/lists/123/items/show?extended=full&page=1&limit=50&sort_by=added&sort_how=desc",
  );
  const metas = traktMetas(
    [
      {
        type: "show",
        show: {
          title: "Breaking Bad",
          year: 2008,
          rating: 9.3,
          ids: { imdb: "tt0903747" },
        },
      },
      { type: "show", show: { title: "No IMDb", ids: { tmdb: 1 } } },
      {
        type: "show",
        show: { title: "Breaking Bad", ids: { imdb: "tt0903747" } },
      },
    ],
    { list: 123, media: "tv" },
  );
  assert.deepEqual(metas, [
    {
      id: "tt0903747",
      type: "series",
      name: "Breaking Bad",
      poster: "https://images.metahub.space/poster/medium/tt0903747/img",
      releaseInfo: "2008",
      imdbRating: "9.3",
    },
  ]);
  assert.equal(sourceLabel({ list: 5 }, true), "قائمة Trakt 5");
  assert.equal(sourceLabel({ kind: "company", title: "Pixar" }), "Pixar");
});

test("pasted TMDB and Trakt addresses become sources", () => {
  assert.deepEqual(
    parseTmdbSource(
      "https://www.themoviedb.org/collection/10-star-wars-collection",
    ),
    {
      kind: "collection",
      id: 10,
      media: "movie",
      sort: "original",
    },
  );
  assert.equal(
    parseTmdbSource("https://www.themoviedb.org/network/213-netflix").media,
    "tv",
  );
  assert.equal(parseTmdbSource("https://example.com/nothing"), null);
  assert.equal(
    parseTraktSource("https://trakt.tv/users/x/lists/998877-best").list,
    998877,
  );
  assert.equal(parseTraktSource("hello"), null);
  let list = editCollections([], {
    action: "create",
    title: "A",
    folders: [{ title: "f" }],
  });
  const ids = { collectionId: list[0].id, folderId: list[0].folders[0].id };
  list = editCollections(list, {
    action: "tmdbAdd",
    ...ids,
    source: { kind: "company", id: 420 },
  });
  list = editCollections(list, {
    action: "tmdbAdd",
    ...ids,
    source: { kind: "company", id: 420 },
  });
  list = editCollections(list, {
    action: "traktAdd",
    ...ids,
    source: { list: 7, media: "tv" },
  });
  assert.equal(
    list[0].folders[0].tmdb.length,
    1,
    "a source sits in a folder once",
  );
  assert.equal(list[0].folders[0].trakt[0].media, "tv");
  assert.throws(() =>
    editCollections(list, {
      action: "tmdbAdd",
      ...ids,
      source: { kind: "evil", id: 1 },
    }),
  );
  assert.equal(
    editCollections(list, {
      action: "tmdbAdd",
      ...ids,
      source: { kind: "discover", media: "tv" },
    })[0].folders[0].tmdb.at(-1).kind,
    "discover",
    "a discover source without filters is TMDB's popular titles",
  );
  list = editCollections(list, { action: "tmdbRemove", ...ids, index: 0 });
  assert.deepEqual(list[0].folders[0].tmdb, []);
});

test("a folder reads TMDB with the key and matches IMDb IDs, or says what it needs", async () => {
  const seen = [];
  const client = new Client({
    load: () => ({}),
    save: () => {},
    request: async (url, init) => {
      seen.push({ url, init });
      if (url.includes("api.themoviedb.org/3/collection/10"))
        return {
          parts: [
            { id: 11, title: "Star Wars", release_date: "1977-05-25" },
            { id: 12, title: "Unmatched", release_date: "1980-01-01" },
          ],
        };
      if (url.includes("movie/11/external_ids"))
        return { imdb_id: "tt0076759" };
      if (url.includes("movie/12/external_ids")) return { imdb_id: null };
      if (url.startsWith("https://api.trakt.tv/lists/7/items/movie"))
        return [
          { movie: { title: "Heat", year: 1995, ids: { imdb: "tt0113277" } } },
        ];
      throw new Error("HTTP 404");
    },
  });
  client.state.collections = editCollections([], {
    action: "create",
    title: "A",
    folders: [
      {
        title: "f",
        tmdb: [{ kind: "collection", id: 10 }],
        trakt: [{ list: 7 }],
      },
    ],
  });
  const ids = {
    collectionId: client.state.collections[0].id,
    folderId: client.state.collections[0].folders[0].id,
  };
  const without = await client.collectionFolder(ids);
  assert.deepEqual(
    without.needs.sort(),
    ["tmdb", "trakt"],
    "no key, no request, and a reason",
  );
  assert.equal(seen.length, 0);

  client.state.providers = { tmdb: { key: "a".repeat(32) } };
  client.state.integrations = { trakt: { clientId: "client-123" } };
  const folder = await client.collectionFolder(ids);
  assert.deepEqual(folder.needs, []);
  assert.deepEqual(
    folder.rows.map((r) => [r.provider, r.metas.map((m) => m.id)]),
    [
      ["TMDB", ["tt0076759"]],
      ["Trakt", ["tt0113277"]],
    ],
    "an unmatched TMDB title is left out rather than shown unopenable",
  );
  const trakt = seen.find((s) => s.url.includes("api.trakt.tv"));
  assert.equal(trakt.init.headers["trakt-api-key"], "client-123");
  assert.equal(
    trakt.init.redirect,
    "error",
    "a credential header never follows a redirect",
  );
  const before = seen.length;
  await client.collectionFolder(ids);
  assert.ok(
    seen.filter((s) => s.url.includes("external_ids")).length <= before,
    "IMDb matches are cached",
  );
  assert.equal(
    seen.filter((s) => s.url.includes("movie/11/external_ids")).length,
    1,
  );
});

const manifest = (id, extra = {}) => ({
  id,
  name: id,
  version: "1.0.0",
  resources: ["catalog", "meta"],
  types: ["movie", "series"],
  catalogs: [],
  ...extra,
});

test("every source answers with a row, and an empty one says why", async () => {
  let failCatalog = true;
  const client = new Client({
    load: () => ({
      addons: [
        {
          transportUrl: "https://cinemeta.example/manifest.json",
          manifest: manifest("com.linvo.cinemeta", {
            catalogs: [
              { type: "movie", id: "top", name: "Popular" },
              { type: "movie", id: "empty", name: "Empty" },
              { type: "movie", id: "broken", name: "Broken" },
              {
                type: "movie",
                id: "needs",
                name: "Needs",
                extra: [{ name: "search", isRequired: true }],
              },
            ],
          }),
        },
      ],
    }),
    save: () => {},
    request: async (url) => {
      if (url.includes("/catalog/movie/top.json"))
        return { metas: [{ id: "tt1", name: "One" }] };
      if (url.includes("/catalog/movie/empty.json")) return { metas: [] };
      if (url.includes("/catalog/movie/broken.json") && failCatalog)
        throw new Error("HTTP 500");
      throw new Error("HTTP 404");
    },
  });
  client.state.collections = editCollections([], {
    action: "create",
    title: "A",
    folders: [
      {
        title: "f",
        catalogs: [
          { addon: "com.linvo.cinemeta", type: "movie", catalog: "top" },
          { addon: "com.linvo.cinemeta", type: "movie", catalog: "empty" },
          { addon: "com.linvo.cinemeta", type: "movie", catalog: "broken" },
          { addon: "com.linvo.cinemeta", type: "movie", catalog: "needs" },
          { addon: "org.gone", type: "movie", catalog: "gone" },
        ],
        tmdb: [{ kind: "company", id: 420 }],
        trakt: [{ list: 7 }],
        unsupported: [{ provider: "mdblist", title: "My list" }],
      },
    ],
  });
  const c = client.state.collections[0];
  const folder = await client.collectionFolder({
    collectionId: c.id,
    folderId: c.folders[0].id,
  });
  assert.deepEqual(
    folder.rows.map((r) => [r.name, r.metas.length, r.note || ""]),
    [
      ["Popular", 1, ""],
      ["Empty", 0, "empty"],
      ["Broken", 0, "failed"],
      ["Needs", 0, "input"],
      ["gone", 0, "missing"],
      ["استوديو", 0, "needs-tmdb"],
      ["قائمة Trakt 7", 0, "needs-trakt"],
      ["My list", 0, "unsupported"],
    ],
  );
  assert.deepEqual(folder.needs.sort(), ["tmdb", "trakt"]);
});

test("TMDB titles without IMDb show through an addon that opens TMDB IDs", async () => {
  const load = (addons) => () => ({
    addons,
    providers: { tmdb: { key: "b".repeat(32) } },
  });
  const request = async (url) => {
    if (url.includes("discover/movie"))
      return {
        results: [
          { id: 1, title: "Matched", poster_path: "/one.jpg" },
          { id: 2, title: "Only TMDB", poster_path: "/two.jpg" },
        ],
      };
    if (url.includes("movie/1/external_ids")) return { imdb_id: "tt0000001" };
    if (url.includes("movie/2/external_ids")) return { imdb_id: null };
    throw new Error("HTTP 404");
  };
  const source = {
    kind: "company",
    id: 420,
    media: "movie",
    sort: "popularity.desc",
  };
  const plain = new Client({ load: load([]), save: () => {}, request });
  const row = await plain.tmdbRow(source);
  assert.deepEqual(
    row.metas.map((m) => m.id),
    ["tt0000001"],
  );
  assert.equal(row.hidden, 1, "the hidden title is counted, not silently lost");
  assert.equal(row.metas[0].poster, "https://image.tmdb.org/t/p/w342/one.jpg");
  const withTmdbAddon = new Client({
    load: load([
      {
        transportUrl: "https://tmdb-addon.example/manifest.json",
        manifest: manifest("org.tmdb", { idPrefixes: ["tmdb:"] }),
      },
    ]),
    save: () => {},
    request,
  });
  const both = await withTmdbAddon.tmdbRow(source, withTmdbAddon.enabled());
  assert.deepEqual(
    both.metas.map((m) => m.id),
    ["tt0000001", "tmdb:2"],
  );
  assert.equal(both.hidden, undefined);
});

test("TMDB calls queue four at a time and retry once", async () => {
  let running = 0;
  let peak = 0;
  let calls = 0;
  const client = new Client({
    load: () => ({ providers: { tmdb: { key: "c".repeat(32) } } }),
    save: () => {},
    request: async (url) => {
      calls++;
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      if (url.includes("flaky") && calls === 1) throw new Error("HTTP 429");
      return { ok: true };
    },
  });
  client.tmdbRetryMs = 1;
  assert.deepEqual(await client.tmdbCall("flaky"), { ok: true }, "one retry");
  await Promise.all(
    Array.from({ length: 12 }, (_, i) => client.tmdbCall(`movie/${i}`)),
  );
  assert.ok(peak <= 4, `at most four at once (saw ${peak})`);
});

test("an unknown Nuvio source is kept by name, not dropped silently", async () => {
  const { fromNuvio } = await import("../core/collections.mjs");
  const { collections, skipped } = fromNuvio([
    {
      id: "c",
      title: "C",
      folders: [
        {
          id: "f",
          title: "F",
          sources: [{ provider: "mdblist", title: "Top 250" }],
        },
      ],
    },
  ]);
  assert.equal(skipped, 1);
  assert.deepEqual(collections[0].folders[0].unsupported, [
    { provider: "mdblist", title: "Top 250" },
  ]);
});

test("Nuvio discover filters reach TMDB as Nuvio sends them", async () => {
  const { fromNuvio } = await import("../core/collections.mjs");
  const { collections } = fromNuvio([
    {
      id: "c",
      title: "U.N.E",
      folders: [
        {
          id: "f",
          title: "",
          heroBackdropUrl: "https://image.tmdb.org/t/p/original/x.jpg",
          sources: [
            {
              provider: "TMDB",
              tmdbSourceType: "DISCOVER",
              mediaType: "TV",
              title: "Korean dramas, no animation",
              filters: {
                withGenres: "18",
                withoutGenres: "16, 10764",
                withoutKeywords: "210024",
                withOriginalLanguage: "KO|ja",
                withOriginCountry: "kr",
                withWatchProviders: "8|337",
                withoutCompanies: "1",
              },
            },
          ],
        },
      ],
    },
  ]);
  const folder = collections[0].folders[0];
  assert.equal(
    folder.title,
    "Korean dramas, no animation",
    "a nameless folder is kept",
  );
  assert.equal(folder.cover, "https://image.tmdb.org/t/p/original/x.jpg");
  const [source] = folder.tmdb;
  assert.equal(source.media, "tv");
  const { path, params } = tmdbRequest(source);
  assert.equal(path, "discover/tv");
  assert.equal(params.without_genres, "16,10764");
  assert.equal(params.without_keywords, "210024");
  assert.equal(params.without_companies, "1");
  assert.equal(params.with_original_language, "ko|ja");
  assert.equal(params.with_origin_country, "KR");
  assert.equal(params.with_watch_providers, "8|337");
  assert.equal(params.watch_region, "US", "a provider filter without a region");
  assert.equal(
    params.with_watch_monetization_types,
    "flatrate|free|ads|rent|buy",
  );
});

test("a shared Nuvio collection pasted on its own is accepted", async () => {
  const { fromNuvio } = await import("../core/collections.mjs");
  const one = {
    id: "shared",
    title: "Shared",
    folders: [
      {
        id: "f",
        title: "Top",
        sources: [
          { provider: "addon", addonId: "a", type: "movie", catalogId: "top" },
        ],
      },
    ],
  };
  assert.equal(fromNuvio(JSON.stringify(one)).folders, 1);
  assert.equal(fromNuvio({ collections: [one] }).folders, 1);
  const many = {
    ...one,
    folders: Array.from({ length: 70 }, (_, i) => ({
      ...one.folders[0],
      id: `f${i}`,
      title: `F${i}`,
    })),
  };
  assert.equal(
    fromNuvio([many]).folders,
    70,
    "large community collections are not cut at 40 folders",
  );
});
