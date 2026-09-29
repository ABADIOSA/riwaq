import test from "node:test";
import assert from "node:assert/strict";
import {
  folderItems,
  interleave,
  mergePage,
  randomPick,
  unique,
} from "../core/folder-view.mjs";
import { editCollections } from "../core/collections.mjs";
import { Client } from "../core/client.mjs";

const m = (id, extra = {}) => ({ id, type: "movie", name: id, ...extra });

test("the all tab takes one from each source in turn, without repeats", () => {
  assert.deepEqual(
    interleave([[m("a"), m("b"), m("c")], [m("x"), m("a")], []]).map(
      (x) => x.id,
    ),
    ["a", "x", "b", "c"],
  );
  assert.equal(unique([m("a"), m("a"), { name: "no id" }]).length, 1);
});

test("a folder page filters by tab, type, Arabic search and order", () => {
  const view = {
    titles: [m("p1", { name: "القاهرة", releaseInfo: "1999" })],
    rows: [
      {
        index: "c0",
        metas: [
          m("a", { name: "Heat", releaseInfo: "1995", imdbRating: "8.3" }),
          m("b", {
            name: "Arrival",
            type: "series",
            releaseInfo: "2016",
            imdbRating: "7.9",
          }),
        ],
      },
      { index: "t0", metas: [m("c", { name: "Dune", releaseInfo: "2021" })] },
    ],
  };
  assert.deepEqual(
    folderItems(view).map((x) => x.id),
    ["p1", "a", "c", "b"],
  );
  assert.deepEqual(
    folderItems(view, { tab: "c0" }).map((x) => x.id),
    ["a", "b"],
  );
  assert.deepEqual(
    folderItems(view, { tab: "picks" }).map((x) => x.id),
    ["p1"],
  );
  assert.deepEqual(
    folderItems(view, { type: "series" }).map((x) => x.id),
    ["b"],
  );
  assert.deepEqual(
    folderItems(view, { query: "القاهره" }).map((x) => x.id),
    ["p1"],
    "search folds Arabic spelling",
  );
  assert.deepEqual(
    folderItems(view, { sort: "newest" }).map((x) => x.id),
    ["c", "b", "p1", "a"],
  );
  assert.deepEqual(
    folderItems(view, { sort: "rating" })
      .slice(0, 2)
      .map((x) => x.id),
    ["a", "b"],
  );
  assert.deepEqual(folderItems(view, { tab: "gone" }), []);
});

test("a further page is appended once, and a page that adds nothing ends it", () => {
  const row = { index: "c0", metas: [m("a")], more: true, page: 1 };
  const next = mergePage(row, { metas: [m("a"), m("b")], more: true, page: 2 });
  assert.deepEqual(
    next.metas.map((x) => x.id),
    ["a", "b"],
  );
  assert.equal(next.more, true);
  assert.equal(next.page, 2);
  const stale = mergePage(next, { metas: [m("b")], more: true, page: 3 });
  assert.equal(stale.more, false, "a repeating addon cannot loop forever");
});

test("a random pick stays within the list", () => {
  const items = [m("a"), m("b"), m("c")];
  assert.equal(randomPick(items, () => 0).id, "a");
  assert.equal(randomPick(items, () => 0.9999).id, "c");
  assert.equal(
    randomPick([], () => 0.5),
    null,
  );
});

test("folder sources say whether more exists, and serve the next page", async () => {
  const seen = [];
  const client = new Client({
    load: () => ({
      addons: [
        {
          transportUrl: "https://lists.example/manifest.json",
          manifest: {
            id: "org.lists",
            name: "Lists",
            version: "1.0.0",
            resources: ["catalog", "meta"],
            types: ["movie"],
            catalogs: [
              {
                type: "Top Fantasy/Sci-Fi Movies",
                id: "fan",
                name: "Fantasy",
                extra: [{ name: "skip" }],
              },
              { type: "movie", id: "fixed", name: "Fixed" },
            ],
          },
        },
      ],
    }),
    save: () => {},
    request: async (url) => {
      seen.push(url);
      if (url.includes("/fan/skip=2.json"))
        return { metas: [{ id: "tt3", name: "Three" }] };
      if (url.includes("/fan.json"))
        return {
          metas: [
            { id: "tt1", name: "One" },
            { id: "tt2", name: "Two" },
          ],
        };
      if (url.includes("/fixed.json"))
        return { metas: [{ id: "tt9", name: "Nine" }] };
      if (url.includes("api.themoviedb.org/3/discover/movie"))
        return {
          page: Number(new URL(url).searchParams.get("page")),
          total_pages: 2,
          results: [{ id: 5, title: "Five" }],
        };
      if (url.includes("movie/5/external_ids")) return { imdb_id: "tt0000005" };
      throw new Error("HTTP 404");
    },
  });
  client.state.providers = { tmdb: { key: "a".repeat(32) } };
  client.state.collections = editCollections([], {
    action: "create",
    title: "A",
    folders: [
      {
        title: "f",
        catalogs: [
          {
            addon: "org.lists",
            type: "Top Fantasy/Sci-Fi Movies",
            catalog: "fan",
          },
          { addon: "org.lists", type: "movie", catalog: "fixed" },
        ],
        tmdb: [{ kind: "discover", media: "movie" }],
      },
    ],
  });
  const ids = {
    collectionId: client.state.collections[0].id,
    folderId: client.state.collections[0].folders[0].id,
  };
  const folder = await client.collectionFolder(ids);
  assert.deepEqual(
    folder.rows.map((r) => [r.index, r.metas.length, r.more]),
    [
      ["c0", 2, true],
      ["c1", 1, false],
      ["t0", 1, true],
    ],
    "only a catalog that takes skip, or a paged TMDB query, offers more",
  );
  const more = await client.collectionSource({ ...ids, index: "c0", skip: 2 });
  assert.deepEqual(
    more.metas.map((x) => x.id),
    ["tt3"],
  );
  assert.equal(more.index, "c0");
  assert.ok(
    seen.some((u) =>
      u.includes("/catalog/Top%20Fantasy%2FSci-Fi%20Movies/fan/skip=2.json"),
    ),
  );
  const tmdb = await client.collectionSource({ ...ids, index: "t0", page: 2 });
  assert.equal(tmdb.more, false, "the last TMDB page ends the source");
  assert.ok(
    seen.some((u) => u.includes("discover/movie") && u.includes("page=2")),
  );
  await assert.rejects(
    client.collectionSource({ ...ids, index: "x9" }),
    /المصدر غير موجود/,
  );
  await assert.rejects(
    client.collectionSource({ ...ids, index: "c7" }),
    /المصدر غير موجود/,
  );
});
