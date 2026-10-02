import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DISCOVER_CINEMETA,
  DISCOVER_TABS,
  DISCOVER_TMDB,
  NEEDS_TMDB,
  addonSection,
  blendedSection,
  discoverCinemetaUrl,
  discoverPlan,
  discoverRow,
  discoverSections,
  discoverTabs,
  discoverTmdbRows,
} from "../core/discover.mjs";
import { FEED_PREFIX, TMDB_FEED, CINEMETA_FEED } from "../core/feed.mjs";
import { tmdbRequest } from "../core/collection-sources.mjs";
import { chartRequest } from "../core/feed.mjs";
import { Client } from "../core/client.mjs";

const source = (file) =>
  readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8");

test("Discover has Riwaq's own sections, filled by TMDB or Cinemeta", () => {
  assert.deepEqual(discoverSections(true), [
    "movies",
    "series",
    "arabic",
    "world",
    "anime",
    "family",
    "docs",
  ]);
  // Without the key, the language sections have no rows of Riwaq's own.
  assert.deepEqual(discoverSections(false), [
    "movies",
    "series",
    "family",
    "docs",
  ]);
  assert.ok(NEEDS_TMDB.every((t) => !discoverSections(false).includes(t)));
  const ids = [...DISCOVER_TMDB, ...DISCOVER_CINEMETA].map((r) => r.id);
  assert.ok(ids.every((id) => id.startsWith("d-")));
  assert.equal(
    new Set(DISCOVER_TMDB.map((r) => r.id)).size,
    DISCOVER_TMDB.length,
  );
  assert.equal(
    new Set(DISCOVER_CINEMETA.map((r) => r.id)).size,
    DISCOVER_CINEMETA.length,
  );
  // Discover keys never collide with home's rows.
  const home = new Set([...TMDB_FEED, ...CINEMETA_FEED].map((r) => r.id));
  assert.ok(ids.every((id) => !home.has(id)));
  assert.ok(
    [...DISCOVER_TMDB, ...DISCOVER_CINEMETA].every((r) =>
      DISCOVER_TABS.some(([id]) => id === r.tab),
    ),
  );
});

test("every TMDB row builds a TMDB request, with recent windows from today", () => {
  for (const row of discoverTmdbRows()) {
    const { path, params } = ["chart", "trending"].includes(row.source.kind)
      ? chartRequest(row.source, { page: 1 })
      : tmdbRequest(row.source, { language: "ar-SA", page: 1 });
    assert.match(path, /^(discover|trending|movie|tv)\//, row.id);
    assert.equal(params.page, 1, row.id);
  }
  const gulf = discoverTmdbRows().find((r) => r.id === "d-a-gulf");
  const req = tmdbRequest(gulf.source, { language: "ar-SA", page: 1 });
  assert.equal(req.path, "discover/tv");
  assert.equal(req.params.with_original_language, "ar");
  assert.equal(req.params.with_origin_country, "SA|AE|KW|QA|BH|OM");
  const fresh = discoverTmdbRows().find((r) => r.id === "d-m-new");
  assert.equal(
    fresh.source.filters.releaseDateLte,
    new Date().toISOString().slice(0, 10),
  );
});

test("a section's plan carries opaque keys and Riwaq's labels only", () => {
  const plan = discoverPlan({ tmdb: true, tab: "arabic" });
  assert.ok(plan.length >= 5);
  assert.ok(plan.every((r) => r.key.startsWith(`${FEED_PREFIX}d-a-`)));
  assert.ok(plan.every((r) => r.provider === "رِواق" && r.feed));
  assert.deepEqual(discoverPlan({ tmdb: false, tab: "arabic" }), []);
  assert.equal(discoverRow("feed:d-a-gulf", { tmdb: true }).tab, "arabic");
  assert.equal(discoverRow("feed:d-a-gulf", { tmdb: false }), null);
  assert.equal(discoverRow("feed:arabic-series", { tmdb: true }), null);
  assert.equal(
    discoverCinemetaUrl(
      DISCOVER_CINEMETA.find((r) => r.id === "d-m-action"),
      100,
    ),
    "https://v3-cinemeta.strem.io/catalog/movie/top/genre=Action&skip=100.json",
  );
  assert.equal(
    discoverCinemetaUrl(DISCOVER_CINEMETA.find((r) => r.id === "d-s-rated")),
    "https://v3-cinemeta.strem.io/catalog/series/imdbRating.json",
  );
});

const meta = (id, type) => ({ id, type, name: id });
const addonRows = [
  {
    key: "a1",
    name: "Akwam Series",
    provider: "Akwam",
    type: "series",
    metas: [meta("tt1", "series"), meta("tt2", "series")],
  },
  {
    key: "a2",
    name: "Arabic Movies",
    provider: "Cima",
    type: "movie",
    metas: [meta("tt3", "movie")],
  },
  {
    key: "a3",
    name: "Live Football",
    provider: "Sports",
    type: "tv",
    metas: [meta("ch1", "tv")],
  },
  { key: "a4", name: "Empty", provider: "X", type: "movie", metas: [] },
];

test("addon catalogs fold into Riwaq's sections without any addon name", () => {
  assert.equal(addonSection(addonRows[0]), "arabic");
  assert.equal(addonSection(addonRows[2]), "sports");
  const arabic = blendedSection(addonRows, "arabic", new Set(["series:tt2"]));
  assert.deepEqual(
    arabic.map((r) => [r.name, r.metas.map((m) => m.id)]),
    [
      ["مختارات أخرى: مسلسلات", ["tt1"]],
      ["مختارات أخرى: أفلام", ["tt3"]],
    ],
  );
  const sports = blendedSection(addonRows, "sports");
  assert.equal(sports[0].name, "رياضة");
  const text = JSON.stringify([...arabic, ...sports]);
  for (const leak of ["Akwam", "Cima", "Sports", "Arabic Movies", "a1", "a2"])
    assert.ok(!text.includes(leak), leak);
  assert.ok([...arabic, ...sports].every((r) => r.key.startsWith("blend:")));
});

test("tabs are Riwaq's sections plus addon-only ones in use", () => {
  assert.deepEqual(
    discoverTabs({ tmdb: false, addonRows }).map((t) => t.id),
    ["movies", "series", "arabic", "family", "docs", "sports"],
  );
  assert.deepEqual(
    discoverTabs({ tmdb: true }).map((t) => t.id),
    ["movies", "series", "arabic", "world", "anime", "family", "docs"],
  );
});

test("the client plans a section, serves it, and opens a row's full page", async () => {
  const requested = [];
  const c = new Client({
    load: () => ({
      addons: [
        {
          transportUrl: "https://one.example/manifest.json",
          manifest: {
            id: "one",
            name: "One",
            version: "1",
            resources: ["catalog"],
            types: ["movie"],
            catalogs: [{ type: "movie", id: "pop", name: "Popular" }],
          },
        },
      ],
    }),
    save: () => {},
    request: async (url) => {
      requested.push(url);
      return { metas: [{ id: "tt1", type: "movie", name: "واحد" }] };
    },
  });
  const plan = c.catalogPlan({ discover: "movies" });
  assert.equal(plan[0].key, "feed:d-m-top");
  assert.equal(plan.at(-1).provider, "One", "addon catalogs follow");
  assert.equal(
    c.catalogPlan({ discover: "movies", search: "x" }).some((r) => r.feed),
    false,
  );
  assert.deepEqual(
    c.catalogPlan({ catalogKey: "feed:d-m-action" }).map((r) => r.key),
    ["feed:d-m-action"],
  );
  const row = await c.catalog({ catalogKey: "feed:d-m-action", skip: 0 });
  assert.equal(row.rows[0].name, "أكشن");
  assert.equal(row.rows[0].provider, "رِواق");
  assert.equal(row.rows[0].tab, "movies");
  assert.match(requested.at(-1), /catalog\/movie\/top\/genre=Action\.json$/);
});

test("Discover's page names no addon, even when one fails", () => {
  const app = source("src/App.jsx");
  assert.match(app, /discover: discoverTab/);
  assert.match(app, /view === "discover"\s*\?\s*"بعض الأعمال لم تصل بعد\."/);
  // The old per-catalog tabs remain for search only.
  assert.match(app, /view === "search" && !catalog && rowGroups\.length > 0/);
  const page = source("src/components/DiscoverSections.jsx");
  assert.doesNotMatch(page, /provider/);
});
