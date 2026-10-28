import test from "node:test";
import assert from "node:assert/strict";
import {
  BROWSE_PARALLEL,
  browseCoverage,
  browseItems,
  browseLoads,
  browseRequest,
  failBrowse,
  loadingBrowse,
  mergeBrowse,
  refilterBrowse,
  startBrowse,
} from "../core/browse.mjs";

const meta = (id, type = "movie") => ({ id, type, name: id });
const row = (key, ids, extra = {}) => ({
  key,
  name: key,
  provider: "Fixture",
  type: "movie",
  metas: ids.map((id) => meta(id)),
  hasMore: true,
  ...extra,
});

test("a See all page starts from the row's real catalogs and their cursors", () => {
  const state = startBrowse(
    [
      row("a", ["a1", "a2"]),
      row("b", ["b1"], { page: 3, skip: 40, feed: true }),
    ],
    { a: { genre: "Drama" } },
  );
  assert.deepEqual(
    state.catalogs.map(({ key, skip, page, hasMore, feed, filters }) => ({
      key,
      skip,
      page,
      hasMore,
      feed,
      filters,
    })),
    [
      {
        key: "a",
        skip: 2,
        page: 1,
        hasMore: true,
        feed: false,
        filters: { genre: "Drama" },
      },
      { key: "b", skip: 40, page: 3, hasMore: true, feed: true, filters: {} },
    ],
  );
  // All interleaves one title from each catalog in turn.
  assert.deepEqual(
    browseItems(state, "all").map((m) => m.id),
    ["a1", "b1", "a2"],
  );
  assert.deepEqual(
    browseItems(state, "b").map((m) => m.id),
    ["b1"],
  );
});

test("All asks every catalog that has more, a few at a time; a tab asks its own", () => {
  const rows = Array.from({ length: 6 }, (_, i) => row("r" + i, ["x" + i]));
  rows[2].hasMore = false;
  let state = startBrowse(rows);
  assert.deepEqual(browseLoads(state, "all"), ["r0", "r1", "r3", "r4"]);
  assert.equal(browseLoads(state, "all").length, BROWSE_PARALLEL);
  assert.deepEqual(browseLoads(state, "r5"), ["r5"]);
  assert.deepEqual(browseLoads(state, "r2"), []);
  // A catalog already being asked, or one that failed, is not asked again
  // until the viewer retries.
  state = loadingBrowse(state, ["r0"]);
  state = failBrowse(state, "r1", "تعذّر");
  assert.deepEqual(browseLoads(state, "all"), ["r3", "r4", "r5"]);
  assert.deepEqual(browseLoads(state, "all", { retry: true }), [
    "r1",
    "r3",
    "r4",
    "r5",
  ]);
});

test("the request carries the catalog's key, filters, search and provider cursor", () => {
  const state = startBrowse([row("a", ["a1", "a2"], { page: 2, skip: 20 })], {
    a: { sort: "Rating" },
  });
  assert.deepEqual(browseRequest(state.catalogs[0], { search: "قطار" }), {
    catalogKey: "a",
    type: "movie",
    search: "قطار",
    filters: { sort: "Rating" },
    skip: 20,
    page: 3,
    retryFailed: false,
  });
  const failed = failBrowse(state, "a", "x").catalogs[0];
  assert.equal(browseRequest(failed).retryFailed, true);
});

test("a repeated provider page advances the cursor instead of stalling", () => {
  let state = startBrowse([row("a", ["a1", "a2"])]);
  // The provider sent its second page as a copy of the first.
  state = mergeBrowse(state, "a", {
    key: "a",
    metas: [meta("a1"), meta("a2")],
    hasMore: true,
  });
  const a = state.catalogs[0];
  assert.equal(a.skip, 4, "skip counts what the provider sent");
  assert.equal(a.page, 2);
  assert.equal(a.hasMore, true, "a duplicate page does not end the catalog");
  assert.deepEqual(browseLoads(state, "all"), ["a"]);
  state = mergeBrowse(state, "a", {
    key: "a",
    metas: [meta("a3")],
    hasMore: true,
  });
  assert.deepEqual(
    browseItems(state, "a").map((m) => m.id),
    ["a1", "a2", "a3"],
  );
  // An empty page, or a missing row, ends that catalog.
  state = mergeBrowse(state, "a", null);
  assert.equal(state.catalogs[0].hasMore, false);
  assert.deepEqual(browseLoads(state, "all"), []);
});

test("new titles append after what is on screen, so cards never reorder", () => {
  let state = startBrowse([row("a", ["a1", "a2"]), row("b", ["b1"])]);
  const before = browseItems(state, "all").map((m) => m.id);
  state = mergeBrowse(state, "b", {
    key: "b",
    metas: [meta("b2"), meta("a1")],
    hasMore: true,
  });
  state = mergeBrowse(state, "a", {
    key: "a",
    metas: [meta("a3")],
    hasMore: false,
  });
  const after = browseItems(state, "all").map((m) => m.id);
  assert.deepEqual(after.slice(0, before.length), before);
  assert.deepEqual(after, ["a1", "b1", "a2", "b2", "a3"]);
  // A title present in two catalogs shows once.
  assert.equal(new Set(after).size, after.length);
});

test("a failed catalog keeps its titles and the others keep loading", () => {
  let state = startBrowse([row("a", ["a1"]), row("b", ["b1"])]);
  state = failBrowse(state, "a", "تعذّر تحميل الكتالوج");
  state = mergeBrowse(state, "b", {
    key: "b",
    metas: [meta("b2")],
    hasMore: true,
  });
  assert.deepEqual(
    browseItems(state, "all").map((m) => m.id),
    ["a1", "b1", "b2"],
  );
  assert.deepEqual(browseCoverage(state).failed, ["a"]);
  // The retry succeeds and clears the error.
  state = mergeBrowse(state, "a", {
    key: "a",
    metas: [meta("a2")],
    hasMore: true,
  });
  assert.deepEqual(browseCoverage(state).failed, []);
  assert.equal(state.catalogs[0].error, "");
});

test("changing a catalog's filter restarts it and ignores its old replies", () => {
  let state = startBrowse([row("a", ["a1", "a2"], { page: 2, skip: 40 })]);
  const old = state.catalogs[0].generation;
  state = refilterBrowse(state, "a", { genre: "Drama" });
  const a = state.catalogs[0];
  assert.deepEqual(a.filters, { genre: "Drama" });
  assert.equal(a.skip, 0);
  assert.equal(a.page, 0);
  assert.equal(a.hasMore, true);
  assert.deepEqual(a.metas, []);
  assert.notEqual(a.generation, old);
  assert.deepEqual(browseLoads(state, "a"), ["a"]);
  // The first page of the new filter is page 1 at skip 0.
  assert.equal(browseRequest(a).page, 1);
  assert.equal(browseRequest(a).skip, 0);
  // A reply sent for the old filter is dropped.
  const stale = mergeBrowse(
    state,
    "a",
    { key: "a", metas: [meta("old")], hasMore: true },
    old,
  );
  assert.equal(stale, state);
  state = mergeBrowse(
    state,
    "a",
    { key: "a", metas: [meta("d1")], hasMore: true },
    a.generation,
  );
  assert.deepEqual(
    browseItems(state, "all").map((m) => m.id),
    ["d1"],
  );
  // An empty filter value means the catalog's default.
  state = refilterBrowse(state, "a", { genre: "" });
  assert.deepEqual(state.catalogs[0].filters, {});
});

test("coverage says what was loaded, never a total the providers did not give", () => {
  let state = startBrowse([
    row("a", ["a1", "a2"]),
    row("b", ["b1"], { hasMore: false }),
  ]);
  assert.deepEqual(browseCoverage(state), {
    titles: 3,
    catalogs: 2,
    done: ["b"],
    failed: [],
    more: true,
  });
  state = mergeBrowse(state, "a", null);
  assert.equal(browseCoverage(state).more, false);
});

test("bad input cannot break the page", () => {
  const state = startBrowse([null, { key: "" }, row("a", ["a1"])]);
  assert.deepEqual(
    state.catalogs.map((c) => c.key),
    ["a"],
  );
  assert.equal(mergeBrowse(state, "missing", null), state);
  assert.equal(failBrowse(state, "missing", "x"), state);
  assert.deepEqual(browseItems(state, "missing"), []);
  assert.deepEqual(startBrowse(undefined).catalogs, []);
});
