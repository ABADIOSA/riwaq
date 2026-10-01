import test from "node:test";
import assert from "node:assert/strict";
import {
  SMART_IDS,
  blendRows,
  cleanSmartHidden,
  groupOf,
  groupRows,
  homeLayout,
  groupsBesideFeed,
} from "../core/smart-groups.mjs";
import { DEFAULT_SETTINGS, safeSettings } from "../core/protocol.mjs";

const row = (type, name, provider = "x", metaTypes = ["movie"]) => ({
  key: `${provider}:${type}:${name}`,
  type,
  name,
  provider,
  metas: metaTypes.map((t, i) => ({
    id: `tt${name.length}${i}${type.length}`,
    type: t,
  })),
});

test("catalogs from the owner's Discover page land in sensible groups", () => {
  const cases = [
    [row("movie", "Popular", "Cinemeta"), "movies"],
    [row("series", "Popular", "Cinemeta", ["series"]), "series"],
    [row("series", "Series Recommended For You", "Trakt"), "foryou"],
    [row("movie", "Movies Recommended For You", "Trakt"), "foryou"],
    [row("movie", "New Streaming Releases: Movies", "TMDB"), "movies"],
    [row("youtube", "YouTube", "YouTube"), "videos"],
    [row("arabcity-alooytv", "ArabCity-AlooyTV", "ArabCity"), "arabic"],
    [row("arabcity-akwam", "ArabCity-Akwam", "ArabCity"), "arabic"],
    [row("akwam", "Akwam", "Akwam"), "arabic"],
    [row("wecima", "WeCima", "WeCima"), "arabic"],
    [row("anime", "أنمي", "Kitsu", ["anime"]), "anime"],
    [row("Sport", "Sport", "Live"), "sports"],
    [row("sports", "Sports", "TV"), "sports"],
    [row("tv", "تلفزيون", "USA TV", ["tv"]), "live"],
    [row("Berserk", "Berserk", "AIOLists", ["series", "series"]), "series"],
    [row("DC", "DC", "AIOLists", ["movie", "movie", "series"]), "movies"],
    [row("Marvel", "Marvel", "AIOLists"), "movies"],
    [row("other", "Other", "x", []), "other"],
  ];
  for (const [r, group] of cases) assert.equal(groupOf(r), group, r.name);
  // Arabic words that merely contain "لك" are not suggestions.
  assert.equal(groupOf(row("movie", "مملكة السماء", "x")), "movies");
});

test("groups keep Riwaq's order and the viewer's row order, without empty or hidden ones", () => {
  const rows = [
    row("series", "Popular", "Cinemeta", ["series"]),
    row("movie", "Popular", "Cinemeta"),
    row("akwam", "Akwam", "Akwam"),
    row("movie", "Featured", "Cinemeta"),
    { ...row("movie", "Empty", "x"), metas: [] },
  ];
  const groups = groupRows(rows);
  assert.deepEqual(
    groups.map((g) => [g.id, g.rows.map((r) => r.name)]),
    [
      ["movies", ["Popular", "Featured"]],
      ["series", ["Popular"]],
      ["arabic", ["Akwam"]],
    ],
  );
  assert.deepEqual(
    groupRows(rows, { hidden: ["arabic"] }).map((g) => g.id),
    ["movies", "series"],
  );
});

test("a group's all-shelf takes one title from each catalog in turn, once each", () => {
  const a = {
    metas: [
      { id: "1", type: "movie" },
      { id: "2", type: "movie" },
    ],
  };
  const b = {
    metas: [
      { id: "3", type: "movie" },
      { id: "1", type: "movie" },
    ],
  };
  assert.deepEqual(
    blendRows([a, b]).map((m) => m.id),
    ["1", "3", "2"],
  );
  assert.equal(blendRows([a, b], 2).length, 2);
});

test("Riwaq's rows stand in until the viewer builds collections", () => {
  assert.equal(DEFAULT_SETTINGS.homeGrouping, "auto");
  assert.equal(homeLayout("auto", []), "riwaq");
  assert.equal(homeLayout("auto", [{ id: "c" }]), "rows");
  assert.equal(homeLayout("riwaq", [{ id: "c" }]), "riwaq");
  assert.equal(homeLayout("groups", []), "groups");
  assert.equal(homeLayout("rows", []), "rows");
  assert.equal(safeSettings({ homeGrouping: "rows" }).homeGrouping, "rows");
  assert.equal(safeSettings({ homeGrouping: "tiles" }).homeGrouping, "auto");
  assert.deepEqual(cleanSmartHidden(["live", "live", "nope", 3]), ["live"]);
  assert.deepEqual(safeSettings({ smartHidden: ["sports", "x"] }).smartHidden, [
    "sports",
  ]);
  assert.equal(SMART_IDS.length, 9);
  // Under Riwaq's rows, films and series come from the rows themselves, and
  // anime too when TMDB supplies it.
  assert.ok(!groupsBesideFeed(false).includes("movies"));
  assert.ok(groupsBesideFeed(false).includes("anime"));
  assert.ok(!groupsBesideFeed(true).includes("anime"));
  assert.ok(groupsBesideFeed(true).includes("arabic"));
});
