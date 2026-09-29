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
