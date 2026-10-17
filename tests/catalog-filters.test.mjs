import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "../core/client.mjs";
import { catalogExtras } from "../core/protocol.mjs";

const cat = {
  id: "filters",
  type: "movie",
  name: "Fixture",
  extra: [
    { name: "genre", options: ["Drama", "Sci-Fi"] },
    { name: "sort", isRequired: true, options: ["Popular", "Rating"] },
    { name: "language", options: ["Arabic", "English"] },
    { name: "skip" },
    { name: "search" },
  ],
};
test("#90 declared addon filters reach the catalog and remain on subsequent pages", async () => {
  const urls = [];
  const c = new Client({
    load: () => ({}),
    save: () => {},
    request: async (url) => {
      urls.push(decodeURIComponent(url));
      return { metas: [{ id: "tt1", name: "Test" }] };
    },
  });
  c.state.addons = [
    {
      enabled: true,
      transportUrl: "https://fixture.test/private-token/manifest.json",
      manifest: {
        id: "filters",
        name: "Filter fixture",
        types: ["movie"],
        resources: ["catalog"],
        catalogs: [cat],
      },
    },
  ];
  const [plan] = c.catalogPlan();
  assert.deepEqual(
    plan.filters.map((f) => f.name),
    ["genre", "sort", "language"],
  );
  assert.ok(!JSON.stringify(plan).includes("private-token"));
  const filters = {
    genre: "Sci-Fi",
    sort: "Rating",
    language: "Arabic",
    unknown: "do-not-send",
    skip: "999",
  };
  await c.catalog({ catalogKey: plan.key, filters });
  await c.catalog({ catalogKey: plan.key, filters, skip: 100 });
  assert.match(urls[0], /genre=Sci-Fi&sort=Rating&language=Arabic\.json$/);
  assert.match(
    urls[1],
    /skip=100&genre=Sci-Fi&sort=Rating&language=Arabic\.json$/,
  );
  assert.ok(
    urls.every((url) => !url.includes("unknown") && !url.includes("999")),
  );
});
test("catalog filters validate choices and preserve required defaults and legacy genre", () => {
  assert.deepEqual(catalogExtras(cat, "", "Drama"), {
    genre: "Drama",
    sort: "Popular",
  });
  assert.equal(catalogExtras(cat, "", "", 0, { sort: "Invented" }), null);
  assert.equal(catalogExtras(cat, "", "", 0, { sort: ["Popular"] }), null);
  assert.deepEqual(catalogExtras(cat, "", "", 0, { language: "English" }), {
    language: "English",
    sort: "Popular",
  });
});
