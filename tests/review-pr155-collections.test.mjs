// Codex's independent review of PR #155 (docs/REVIEW-PR-155.md): the
// collections findings F1 (Replace emptied the list after a valid preview),
// F3 (Merge and a template update dropped the viewer's own fields), F7 (the
// Nuvio round trip copied, dropped and over-reported) and F9's limit. Each
// test reproduces the reviewer's case against core/collections.mjs and the
// Client import path the interface calls.
import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "../core/client.mjs";
import {
  LIMITS,
  cleanCollections,
  editCollections,
  fromNuvio,
  importCollections,
  toNuvio,
} from "../core/collections.mjs";
import { presetCollection, PRESETS } from "../core/collection-presets.mjs";

const LOCAL = (c) => `local:${c.repeat(32)}`;
const client = () => {
  const c = new Client({ load: () => ({}), save: () => {} });
  return c;
};
const MINE = [
  {
    id: "mine",
    title: "Mine",
    folders: [
      {
        id: "f1",
        title: "Folder",
        catalogs: [{ addon: "a.b", type: "movie", catalog: "top" }],
      },
    ],
  },
];
// A Nuvio file whose collection and folder carry a title but no ID.
const NO_ID = JSON.stringify([
  {
    title: "From the phone",
    folders: [
      {
        title: "Picks",
        sources: [
          { provider: "addon", addonId: "x.y", type: "movie", catalogId: "c" },
        ],
      },
    ],
  },
]);

test("F1: a collection without an ID keeps the ID the preview showed", () => {
  const preview = fromNuvio(NO_ID).collections;
  const commit = fromNuvio(NO_ID).collections;
  assert.equal(preview.length, 1);
  assert.equal(preview[0].id, commit[0].id, "preview and commit agree");
  assert.equal(preview[0].folders[0].id, commit[0].folders[0].id);
});

test("F1: Replace after a valid preview replaces, never empties", () => {
  const c = client();
  c.state.collections = cleanCollections(MINE);
  // What the interface does: preview in the renderer, then send the IDs.
  const only = fromNuvio(NO_ID).collections.map((x) => x.id);
  const { result } = c.importNuvioCollections({
    text: NO_ID,
    mode: "replace",
    only,
  });
  assert.equal(result.added, 1);
  assert.equal(result.replaced, 1);
  assert.deepEqual(
    c.state.collections.map((x) => x.title),
    ["From the phone"],
  );
});

test("F1: Replace with nothing effectively chosen is refused and changes nothing", () => {
  const c = client();
  c.state.collections = cleanCollections(MINE);
  const before = structuredClone(c.state.collections);
  for (const only of [[], ["not-in-the-file"], ["nope", "also-nope"]])
    assert.throws(
      () => c.importNuvioCollections({ text: NO_ID, mode: "replace", only }),
      /لم يبق|اختر/,
    );
  assert.deepEqual(c.state.collections, before);
  // The same refusal in the pure function, whatever calls it.
  assert.throws(() => importCollections(MINE, [], { mode: "replace" }), /اختر/);
  assert.throws(
    () =>
      importCollections(MINE, fromNuvio(NO_ID).collections, {
        mode: "replace",
        only: ["gone"],
      }),
    /لم يبق|اختر/,
  );
});

test("F1: a chosen collection missing at commit refuses the whole import", () => {
  const c = client();
  c.state.collections = cleanCollections(MINE);
  const before = structuredClone(c.state.collections);
  const [id] = fromNuvio(NO_ID).collections.map((x) => x.id);
  for (const mode of ["merge", "add", "replace"])
    assert.throws(
      () =>
        c.importNuvioCollections({
          text: NO_ID,
          mode,
          only: [id, "vanished"],
        }),
      /تغيّر|لم يبق/,
    );
  assert.deepEqual(c.state.collections, before);
});

test("F1: invalid, empty and non-list files change nothing", () => {
  const c = client();
  c.state.collections = cleanCollections(MINE);
  const before = structuredClone(c.state.collections);
  for (const text of ["", "   ", "{not json", "42", '"text"', "[]", "[{}]"])
    assert.throws(() =>
      c.importNuvioCollections({ text, mode: "replace", only: [] }),
    );
  assert.deepEqual(c.state.collections, before);
});

test("F1: duplicate IDs in a file are both kept under distinct stable IDs", () => {
  const file = JSON.stringify([
    { id: "same", title: "One", folders: [{ id: "f", title: "A" }] },
    { id: "same", title: "Two", folders: [{ id: "f", title: "B" }] },
  ]);
  const a = fromNuvio(file);
  const b = fromNuvio(file);
  assert.equal(a.collections.length, 2);
  assert.notEqual(a.collections[0].id, a.collections[1].id);
  assert.deepEqual(
    a.collections.map((x) => x.id),
    b.collections.map((x) => x.id),
  );
  assert.equal(a.report.duplicates, 1);
});

test("F1: importing the same file twice (merge) adds nothing the second time", () => {
  const c = client();
  c.state.collections = cleanCollections(MINE);
  const only = fromNuvio(NO_ID).collections.map((x) => x.id);
  c.importNuvioCollections({ text: NO_ID, mode: "merge", only });
  const once = structuredClone(c.state.collections);
  const { result } = c.importNuvioCollections({
    text: NO_ID,
    mode: "merge",
    only,
  });
  assert.equal(result.added, 0);
  assert.deepEqual(c.state.collections, once);
  assert.equal(c.state.collections.length, 2);
  assert.equal(c.state.collections[1].folders.length, 1);
});

test("F1: after a Replace, count, names, folders and sources are what was chosen", () => {
  const file = JSON.stringify([
    {
      title: "A",
      folders: [
        {
          title: "A1",
          sources: [
            { provider: "addon", addonId: "x", type: "movie", catalogId: "1" },
            { provider: "addon", addonId: "x", type: "movie", catalogId: "2" },
          ],
        },
      ],
    },
    { title: "B", folders: [{ title: "B1" }] },
  ]);
  const c = client();
  c.state.collections = cleanCollections(MINE);
  const preview = fromNuvio(file).collections;
  c.importNuvioCollections({
    text: file,
    mode: "replace",
    only: [preview[0].id],
  });
  assert.equal(c.state.collections.length, 1);
  assert.equal(c.state.collections[0].title, "A");
  assert.equal(c.state.collections[0].folders[0].title, "A1");
  assert.equal(c.state.collections[0].folders[0].catalogs.length, 2);
});

/* F3: Merge and a template update keep what only Riwaq holds. */

const RICH = cleanCollections([
  {
    id: "nuvio-shared",
    title: "Shared",
    cover: LOCAL("a"),
    pinned: true,
    folders: [
      {
        id: "nuvio-f",
        title: "Folder",
        cover: LOCAL("b"),
        gif: LOCAL("c"),
        backdrop: LOCAL("d"),
        logo: LOCAL("e"),
        catalogs: [{ addon: "a.b", type: "movie", catalog: "top" }],
        titles: [
          { id: "tt0000001", type: "movie", name: "Picked one" },
          { id: "tt0000002", type: "movie", name: "Picked two" },
        ],
      },
    ],
  },
]);

test("F3: re-merging an export keeps local pictures and hand-picked titles", () => {
  const back = fromNuvio(JSON.stringify(toNuvio(RICH))).collections;
  const { collections } = importCollections(RICH, back, { mode: "merge" });
  const [c] = collections;
  assert.equal(c.cover, LOCAL("a"));
  assert.equal(c.pinned, true);
  const [f] = c.folders;
  assert.equal(f.cover, LOCAL("b"));
  assert.equal(f.gif, LOCAL("c"));
  assert.equal(f.backdrop, LOCAL("d"));
  assert.equal(f.logo, LOCAL("e"));
  assert.deepEqual(
    f.titles.map((t) => t.id),
    ["tt0000001", "tt0000002"],
  );
});

test("F3: Merge takes the file's values where the file has them", () => {
  const incoming = structuredClone(RICH);
  incoming[0].title = "Renamed in Nuvio";
  incoming[0].folders[0].cover = "https://img.example/new.png";
  incoming[0].folders[0].catalogs = [
    { addon: "a.b", type: "movie", catalog: "new" },
  ];
  incoming[0].folders[0].titles = [];
  const { collections } = importCollections(RICH, incoming, { mode: "merge" });
  const [f] = collections[0].folders;
  assert.equal(collections[0].title, "Renamed in Nuvio");
  assert.equal(f.cover, "https://img.example/new.png");
  assert.equal(f.gif, LOCAL("c"), "absent in the file: the local one stays");
  assert.deepEqual(
    f.catalogs.map((x) => x.catalog),
    ["new"],
  );
  assert.equal(f.titles.length, 2, "Nuvio has no hand-picked titles");
});

test("F3: updating a template keeps the viewer's cover, pin and picked titles", () => {
  const id = PRESETS[0].id;
  const c = client();
  c.collectionsEdit({ action: "preset", preset: id });
  const added = c.state.collections[0];
  const folder = added.folders[0];
  c.collectionsEdit({
    action: "update",
    collectionId: added.id,
    title: added.title,
    cover: LOCAL("1"),
    pinned: true,
  });
  c.collectionsEdit({
    action: "folderUpdate",
    collectionId: added.id,
    folderId: folder.id,
    title: "My own name",
    cover: LOCAL("2"),
  });
  c.collectionsEdit({
    action: "titleAdd",
    collectionId: added.id,
    folderId: folder.id,
    meta: { id: "tt0000009", type: "movie", name: "Mine" },
  });
  const extra = c.state.collections[0].folders[0].tmdb.length;
  // The viewer removed a query: an update must not bring it back.
  c.collectionsEdit({
    action: "tmdbRemove",
    collectionId: added.id,
    folderId: folder.id,
    index: 0,
  });
  c.collectionsEdit({ action: "preset", preset: id });
  const [after] = c.state.collections;
  assert.equal(after.cover, LOCAL("1"));
  assert.equal(after.pinned, true);
  const f = after.folders.find((x) => x.id === folder.id);
  assert.equal(f.title, "My own name");
  assert.equal(f.cover, LOCAL("2"));
  assert.deepEqual(
    f.titles.map((t) => t.id),
    ["tt0000009"],
  );
  assert.equal(f.tmdb.length, extra - 1);
  assert.equal(c.state.collections.length, 1, "updated in place, not copied");
});

test("F3: a merge keeps local pictures referenced, so the sweep cannot take them", () => {
  const back = fromNuvio(JSON.stringify(toNuvio(RICH))).collections;
  const { collections } = importCollections(RICH, back, { mode: "merge" });
  const refs = JSON.stringify(collections).match(/local:[a-f\d]{32}/g);
  assert.deepEqual(
    [...new Set(refs)].sort(),
    [LOCAL("a"), LOCAL("b"), LOCAL("c"), LOCAL("d"), LOCAL("e")].sort(),
  );
});

/* F7: the Nuvio round trip and the import report. */

test("F7: a Riwaq collection exported and merged back updates, never copies", () => {
  const own = editCollections([], { action: "create", title: "Own" });
  const withFolder = editCollections(own, {
    action: "folderAdd",
    collectionId: own[0].id,
    title: "F",
  });
  const list = editCollections(withFolder, {
    action: "catalogAdd",
    collectionId: own[0].id,
    folderId: withFolder[0].folders[0].id,
    catalog: { addon: "a.b", type: "movie", catalog: "top" },
  });
  const back = fromNuvio(JSON.stringify(toNuvio(list))).collections;
  assert.equal(back[0].id, list[0].id, "the exported ID comes back unchanged");
  assert.equal(back[0].folders[0].id, list[0].folders[0].id);
  const { collections, report } = importCollections(list, back, {
    mode: "merge",
  });
  assert.equal(collections.length, 1);
  assert.equal(report.updated, 1);
  assert.equal(report.added, 0);
});

test("F7: the export keeps the All tab choice and folders that hold only a cover", () => {
  const list = cleanCollections([
    {
      id: "c",
      title: "C",
      showAll: false,
      folders: [
        {
          id: "art",
          title: "Only a cover",
          cover: "https://img.example/a.png",
        },
        { id: "empty", title: "Nothing at all" },
      ],
    },
  ]);
  const [out] = toNuvio(list);
  assert.equal(out.showAllTab, false);
  assert.deepEqual(
    out.folders.map((f) => f.id),
    ["riwaq-art"],
  );
  const back = fromNuvio(JSON.stringify([out])).collections;
  assert.equal(back[0].id, "c");
  assert.equal(back[0].folders[0].id, "art");
  assert.equal(back[0].showAll, false);
  assert.equal(back[0].folders[0].cover, "https://img.example/a.png");
  // Absent in the file: the All tab shows, as Nuvio's default.
  assert.equal(
    fromNuvio('[{"title":"x","folders":[]}]').collections[0].showAll,
    undefined,
  );
});

test("F7: the report counts only what was chosen and what was actually kept", () => {
  const sources = (n, extra = {}) =>
    Array.from({ length: n }, (_, i) => ({
      provider: "simkl",
      listId: i,
      title: `S${i}`,
      ...extra,
    }));
  const file = JSON.stringify([
    {
      id: "a",
      title: "A",
      folders: [{ id: "fa", title: "FA", sources: sources(41) }],
    },
    {
      id: "b",
      title: "B",
      folders: [
        { id: "fb", title: "FB", sources: sources(2) },
        { id: "fc", title: "FC" },
      ],
    },
  ]);
  const c = client();
  const { result } = c.importNuvioCollections({
    text: file,
    mode: "merge",
    only: ["nuvio-b"],
  });
  assert.equal(result.added, 1);
  assert.equal(result.folders, 2, "B's folders only");
  assert.equal(result.skippedSources, 2, "B's unread sources only");
  assert.equal(result.unsupported.length, 2);
  assert.ok(result.unsupported.every((u) => u.collection === "B"));
  const all = c.importNuvioCollections({
    text: file,
    mode: "merge",
    only: ["nuvio-a"],
  }).result;
  const kept = c.state.collections.find((x) => x.id === "nuvio-a").folders[0]
    .unsupported.length;
  assert.equal(kept, LIMITS.catalogs);
  assert.equal(all.skippedSources, kept, "what was kept, not what was read");
  assert.equal(all.over.sources, 1, "the one over the limit is reported");
});

/* F9: the collection limit. */

test("F9: a template at the collection limit is refused, never reported as added", () => {
  const c = client();
  c.state.collections = cleanCollections(
    Array.from({ length: LIMITS.collections }, (_, i) => ({
      id: `c${i}`,
      title: `C${i}`,
    })),
  );
  assert.throws(
    () => c.collectionsEdit({ action: "preset", preset: PRESETS[0].id }),
    /الحد الأقصى/,
  );
  assert.equal(c.state.collections.length, LIMITS.collections);
  assert.ok(presetCollection(PRESETS[0].id));
});

test("F9: every template's discover queries can be edited in place", () => {
  for (const { id } of PRESETS) {
    const [c] = cleanCollections([presetCollection(id)]);
    let list = [c];
    for (const folder of c.folders) {
      folder.tmdb.forEach((t, index) => {
        if (t.kind !== "discover") return;
        const before = structuredClone(
          list[0].folders.find((f) => f.id === folder.id),
        );
        const source = {
          ...t,
          title: `${t.title || "Q"} (edited)`,
          sort: "vote_average.desc",
          filters: {
            ...(t.filters || {}),
            withGenres: t.media === "tv" ? "18|10765" : "18,878",
            withKeywords: "9672",
            withoutKeywords: "210024",
            releaseDateGte: "2000-01-01",
            releaseDateLte: "2010-12-31",
            // One distinct value each: two queries of a folder that ask
            // the same thing are refused as a duplicate.
            voteCountGte: 50 + index,
          },
        };
        list = editCollections(list, {
          action: "tmdbUpdate",
          collectionId: c.id,
          folderId: folder.id,
          index,
          source,
        });
        const after = list[0].folders.find((f) => f.id === folder.id);
        const edited = after.tmdb[index];
        assert.equal(edited.sort, "vote_average.desc", `${id}/${folder.id}`);
        assert.equal(edited.filters.withKeywords, "9672");
        assert.equal(edited.filters.releaseDateLte, "2010-12-31");
        // The other sources of the folder are untouched.
        assert.deepEqual(
          after.tmdb.filter((_, i) => i !== index),
          before.tmdb.filter((_, i) => i !== index),
        );
      });
    }
  }
});

test("F9: an invalid value is refused by name, and nothing changes", () => {
  const [c] = cleanCollections([presetCollection(PRESETS[0].id)]);
  const folder = c.folders[0];
  const index = folder.tmdb.findIndex((t) => t.kind === "discover");
  for (const [key, value] of [
    ["withKeywords", "eighteen"],
    ["year", 1200],
    ["releaseDateGte", "yesterday"],
    ["withOriginCountry", "Saudi"],
  ])
    assert.throws(
      () =>
        editCollections([c], {
          action: "tmdbUpdate",
          collectionId: c.id,
          folderId: folder.id,
          index,
          source: { ...folder.tmdb[index], filters: { [key]: value } },
        }),
      new RegExp(key),
    );
  assert.throws(
    () =>
      editCollections([c], {
        action: "tmdbUpdate",
        collectionId: c.id,
        folderId: folder.id,
        index: 999,
        source: folder.tmdb[index],
      }),
    /غير موجود/,
  );
});
