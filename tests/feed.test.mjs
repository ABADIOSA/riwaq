import test from "node:test";
import assert from "node:assert/strict";
import {
  CINEMETA_FEED,
  FEED_PREFIX,
  TMDB_FEED,
  chartRequest,
  cinemetaUrl,
  cleanFeedHidden,
  feedPlan,
  feedRow,
} from "../core/feed.mjs";
import { tmdbItems, tmdbRequest } from "../core/collection-sources.mjs";
import { DEFAULT_SETTINGS, safeSettings } from "../core/protocol.mjs";

test("Riwaq's rows come from TMDB with a key and Cinemeta without", () => {
  const withKey = feedPlan({ tmdb: true });
  const without = feedPlan({ tmdb: false });
  assert.equal(withKey.length, TMDB_FEED.length);
  assert.equal(without.length, CINEMETA_FEED.length);
  assert.ok(withKey.every((r) => r.key.startsWith(FEED_PREFIX) && r.feed));
  assert.ok(withKey.some((r) => r.name === "مسلسلات عربية"));
  assert.ok(withKey.some((r) => r.name === "مسلسلات تركية"));
  assert.ok(!without.some((r) => /عربية|تركية|كورية/.test(r.name)));
  // Keys and labels only: no addresses reach the interface.
  assert.ok(
    withKey.every(
      (r) => Object.keys(r).sort().join() === "feed,key,name,provider,type",
    ),
  );
  assert.deepEqual(
    feedPlan({ tmdb: true, hidden: ["horror", "anime"] })
      .map((r) => r.key)
      .filter((k) => /horror|anime/.test(k)),
    [],
  );
  assert.equal(feedRow("feed:arabic-series", { tmdb: true }).type, "series");
  assert.equal(feedRow("feed:arabic-series", { tmdb: false }), null);
  assert.equal(feedRow("abc", { tmdb: true }), null);
  const ids = [...TMDB_FEED, ...CINEMETA_FEED].map((r) => r.id);
  assert.equal(new Set(TMDB_FEED.map((r) => r.id)).size, TMDB_FEED.length);
  assert.ok(ids.length > 30);
});

test("TMDB rows ask TMDB for its charts, trending and filtered discover pages", () => {
  const trending = TMDB_FEED.find((r) => r.id === "trending-series").source;
  assert.deepEqual(chartRequest(trending, { page: 2 }), {
    path: "trending/tv/week",
    params: { language: "ar-SA", page: 2 },
  });
  const cinema = TMDB_FEED.find((r) => r.id === "now-playing").source;
  assert.deepEqual(chartRequest(cinema, { region: "AE" }), {
    path: "movie/now_playing",
    params: { language: "ar-SA", page: 1, region: "AE" },
  });
  const upcoming = chartRequest(
    TMDB_FEED.find((r) => r.id === "upcoming").source,
  );
  assert.equal(upcoming.path, "discover/movie");
  assert.ok(
    upcoming.params["primary_release_date.gte"] >
      new Date().toISOString().slice(0, 10),
  );
  const arabic = tmdbRequest(
    TMDB_FEED.find((r) => r.id === "arabic-series").source,
  );
  assert.equal(arabic.path, "discover/tv");
  assert.equal(arabic.params.with_original_language, "ar");
  const korean = tmdbRequest(TMDB_FEED.find((r) => r.id === "korean").source);
  assert.equal(korean.params.with_original_language, "ko");
  assert.equal(korean.params.with_genres, "18");
  // Charts list titles of one kind, with backdrops for the hero.
  const items = tmdbItems(
    {
      results: [
        {
          id: 7,
          name: "مسلسل",
          backdrop_path: "/b.jpg",
          poster_path: "/p.jpg",
        },
      ],
    },
    trending,
  );
  assert.deepEqual([items[0].kind, items[0].backdrop], ["tv", "/b.jpg"]);
});

test("keyless rows read Cinemeta's top catalogs by genre, paged by skip", () => {
  const action = CINEMETA_FEED.find((r) => r.id === "action");
  assert.equal(
    cinemetaUrl(action),
    "https://v3-cinemeta.strem.io/catalog/movie/top/genre=Action.json",
  );
  assert.equal(
    cinemetaUrl(
      CINEMETA_FEED.find((r) => r.id === "scifi"),
      100,
    ),
    "https://v3-cinemeta.strem.io/catalog/movie/top/genre=Sci-Fi&skip=100.json",
  );
  assert.equal(
    cinemetaUrl(CINEMETA_FEED[1]),
    "https://v3-cinemeta.strem.io/catalog/series/top.json",
  );
});

test("hidden rows are validated against every known row", () => {
  assert.deepEqual(DEFAULT_SETTINGS.feedHidden, []);
  assert.deepEqual(cleanFeedHidden(["horror", "horror", "drama-series", "x"]), [
    "horror",
    "drama-series",
  ]);
  assert.deepEqual(safeSettings({ feedHidden: ["anime", "<b>"] }).feedHidden, [
    "anime",
  ]);
});

test("the client serves feed keys from TMDB or Cinemeta and plans them first on home", async () => {
  const { Client } = await import("../core/client.mjs");
  const fake = {
    state: { settings: { feedHidden: [] }, providers: {} },
    catalogTasks: () => [
      {
        addon: { manifest: { name: "Akwam" } },
        cat: { id: "a", type: "akwam", name: "Akwam" },
        key: "k1",
      },
    ],
    enabled: () => [],
    adultFilter: (m) => m,
    cached: async (url) => {
      fake.asked = url;
      return { metas: [{ id: "tt1", name: "Film" }, { name: "no id" }] };
    },
    tmdbRow: async (source, addons, page) => ({
      metas: [
        {
          id: "tt2",
          type: "series",
          name: "مسلسل",
          background: "https://image.tmdb.org/t/p/w1280/b.jpg",
        },
      ],
      more: page < 3,
      source,
    }),
  };
  for (const m of ["catalogPlan", "tmdbActive", "feedCatalog", "catalog"])
    fake[m] = Client.prototype[m].bind(fake);
  const plan = fake.catalogPlan({ feed: true });
  assert.equal(plan[0].key, "feed:top-movies");
  assert.equal(plan.at(-1).key, "k1");
  assert.equal(fake.catalogPlan({}).length, 1, "only home asks for the feed");
  assert.equal(fake.catalogPlan({ feed: true, search: "x" }).length, 1);
  // A feed row's full page plans just that row.
  assert.deepEqual(
    fake.catalogPlan({ catalogKey: "feed:action" }).map((r) => r.key),
    ["feed:action"],
  );
  const keyless = await fake.catalog({ catalogKey: "feed:action", skip: 0 });
  assert.equal(
    fake.asked,
    "https://v3-cinemeta.strem.io/catalog/movie/top/genre=Action.json",
  );
  assert.deepEqual(
    keyless.rows[0].metas.map((m) => [m.id, m.type]),
    [["tt1", "movie"]],
  );
  fake.state.providers.tmdb = { key: "k", enabled: true };
  assert.equal(fake.catalogPlan({ feed: true })[0].key, "feed:trending-movies");
  const page2 = await fake.catalog({
    catalogKey: "feed:arabic-series",
    page: 2,
  });
  assert.equal(page2.rows[0].name, "مسلسلات عربية");
  assert.equal(page2.rows[0].page, 2);
  assert.equal(page2.rows[0].hasMore, true);
  assert.deepEqual((await fake.catalog({ catalogKey: "feed:nope" })).rows, []);
});
