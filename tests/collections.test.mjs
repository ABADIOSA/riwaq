import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LIMITS,
  availableCatalogs,
  cleanCollections,
  coverUrl,
  editCollections,
  fromNuvio,
  mergeCollections,
  resolveCatalog,
  titlePlaces,
  toNuvio,
} from "../core/collections.mjs";
import {
  arrangeRows,
  moveCatalog,
  safeCatalogKeys,
  safeHomeSections,
} from "../core/home.mjs";
import { DEFAULT_SETTINGS, safeSettings } from "../core/protocol.mjs";
import { Profiles } from "../core/profiles.mjs";
import { collectBackup, restoreState } from "../core/backup.mjs";
import { HUD_METHODS } from "../core/hud.mjs";
import { HIDEABLE_NAV } from "../core/appearance.mjs";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const film = (id, name = id) => ({ id, type: "movie", name });

test("collections are validated field by field", () => {
  const [c] = cleanCollections([
    {
      id: "bad id with spaces",
      title: "  سهرة\nالخميس  ",
      emoji: "🍿",
      cover: "http://insecure.example/x.jpg",
      pinned: "yes",
      view: "carousel",
      folders: [
        {
          id: "f1",
          title: "أفلام",
          shape: "hexagon",
          cover: "https://user:pass@evil.example/x.jpg",
          catalogs: [
            { addon: "com.linvo.cinemeta", type: "movie", catalog: "top" },
            { addon: "com.linvo.cinemeta", type: "movie", catalog: "top" },
            { addon: "bad addon id!", type: "movie", catalog: "x" },
            { addon: "a", type: "", catalog: "x" },
          ],
          titles: [film("tt1"), film("tt1"), { id: "x" }, film("tt2")],
        },
        { title: "" },
        { id: "f1", title: "duplicate id" },
      ],
    },
    { title: "" },
    "junk",
  ]);
  assert.equal(c.title, "سهرة الخميس");
  assert.match(c.id, /^[\w-]{1,64}$/);
  assert.notEqual(c.id, "bad id with spaces");
  assert.equal(c.cover, "", "HTTPS only");
  assert.equal(c.pinned, false, "only a real boolean pins");
  assert.equal(c.view, "tabs");
  assert.equal(c.folders.length, 1);
  const [f] = c.folders;
  assert.equal(f.shape, "poster");
  assert.equal(f.cover, "", "no credentials in a cover");
  assert.deepEqual(
    f.catalogs.map((c) => `${c.addon}|${c.type}|${c.catalog}`),
    ["com.linvo.cinemeta|movie|top", "a||x"],
    "duplicates and IDs with spaces dropped; a typeless source matches by ID",
  );
  assert.deepEqual(
    f.titles.map((t) => t.id),
    ["tt1", "tt2"],
  );
  assert.equal(
    coverUrl("https://img.example/a.jpg"),
    "https://img.example/a.jpg",
  );
  assert.equal(
    cleanCollections(Array.from({ length: 60 }, (_, i) => ({ title: `c${i}` })))
      .length,
    LIMITS.collections,
  );
});

test("editing: create, folders, catalogs, hand-picked order", () => {
  let list = editCollections([], {
    action: "create",
    title: "عالم الأبطال",
    emoji: "🦸",
    folders: [{ title: "الأفلام" }],
  });
  const cid = list[0].id;
  assert.equal(list[0].pinned, true, "new collections pin to home");
  const fid = list[0].folders[0].id;
  list = editCollections(list, {
    action: "folderAdd",
    collectionId: cid,
    title: "المسلسلات",
  });
  assert.equal(list[0].folders.length, 2);
  list = editCollections(list, {
    action: "catalogAdd",
    collectionId: cid,
    folderId: fid,
    catalog: {
      addon: "com.linvo.cinemeta",
      type: "movie",
      catalog: "top",
      genre: "Action",
    },
  });
  assert.deepEqual(list[0].folders[0].catalogs[0], {
    addon: "com.linvo.cinemeta",
    type: "movie",
    catalog: "top",
    genre: "Action",
  });
  for (const id of ["tt1", "tt2", "tt3"])
    list = editCollections(list, {
      action: "titleAdd",
      collectionId: cid,
      folderId: fid,
      meta: film(id),
    });
  list = editCollections(list, {
    action: "titleAdd",
    collectionId: cid,
    folderId: fid,
    meta: film("tt1"),
  });
  assert.deepEqual(
    list[0].folders[0].titles.map((t) => t.id),
    ["tt1", "tt2", "tt3"],
    "a title sits in a folder once",
  );
  list = editCollections(list, {
    action: "titleMove",
    collectionId: cid,
    folderId: fid,
    id: "tt3",
    type: "movie",
    direction: "up",
  });
  assert.deepEqual(
    list[0].folders[0].titles.map((t) => t.id),
    ["tt1", "tt3", "tt2"],
  );
  assert.deepEqual(titlePlaces(list, film("tt3")), [`${cid}/${fid}`]);
  list = editCollections(list, {
    action: "titleRemove",
    collectionId: cid,
    folderId: fid,
    id: "tt3",
    type: "movie",
  });
  assert.deepEqual(titlePlaces(list, film("tt3")), []);
  list = editCollections(list, {
    action: "folderMove",
    collectionId: cid,
    folderId: fid,
    direction: "down",
  });
  assert.equal(list[0].folders[1].id, fid);
  list = editCollections(list, {
    action: "update",
    collectionId: cid,
    view: "rows",
    pinned: false,
    title: "  ",
  }).map((c) => c);
  assert.equal(list[0].view, "rows");
  assert.equal(list[0].pinned, false);
  assert.equal(list[0].title, "عالم الأبطال", "an empty rename keeps the name");
  assert.throws(
    () =>
      editCollections(list, {
        action: "folderAdd",
        collectionId: "nope",
        title: "x",
      }),
    /غير موجودة/,
  );
  assert.throws(() => editCollections(list, { action: "explode" }));
  assert.throws(() =>
    editCollections(list, {
      action: "titleAdd",
      collectionId: cid,
      folderId: fid,
      meta: { id: "x" },
    }),
  );
  assert.deepEqual(
    editCollections(list, { action: "remove", collectionId: cid }),
    [],
  );
});

const addons = [
  {
    transportUrl: "https://secret-token@example/manifest.json",
    manifest: {
      id: "com.linvo.cinemeta",
      name: "Cinemeta",
      catalogs: [
        {
          type: "movie",
          id: "top",
          name: "Popular",
          extra: [{ name: "genre", options: ["Action", "Drama"] }],
        },
        { type: "series", id: "top", name: "Popular" },
        {
          type: "movie",
          id: "search-only",
          extra: [{ name: "search", isRequired: true }],
        },
        { type: "addon_catalog", id: "store" },
      ],
    },
  },
  {
    transportUrl: "https://fork.example/manifest.json",
    manifest: {
      id: "org.fork",
      name: "Fork",
      catalogs: [{ type: "movie", id: "trending" }],
    },
  },
];

test("folder sources find their catalog, even in a forked addon", () => {
  const exact = resolveCatalog(addons, {
    addon: "com.linvo.cinemeta",
    type: "movie",
    catalog: "top",
  });
  assert.equal(exact.addon.manifest.id, "com.linvo.cinemeta");
  const fork = resolveCatalog(addons, {
    addon: "gone.addon",
    type: "movie",
    catalog: "trending",
  });
  assert.equal(
    fork.addon.manifest.id,
    "org.fork",
    "same catalog in another addon",
  );
  assert.equal(
    resolveCatalog(addons, { addon: "x", type: "movie", catalog: "none" }),
    null,
  );
  const list = availableCatalogs(addons);
  assert.deepEqual(
    list.map((c) => `${c.addon}/${c.type}/${c.catalog}`),
    [
      "com.linvo.cinemeta/movie/top",
      "com.linvo.cinemeta/series/top",
      "org.fork/movie/trending",
    ],
    "no search-only or addon-store catalogs",
  );
  assert.deepEqual(list[0].genres, ["Action", "Drama"]);
  assert.ok(!JSON.stringify(list).includes("secret-token"), "no addon URLs");
});

// Nuvio's collections JSON, shaped like its CollectionModels.
const NUVIO = [
  {
    id: "c1",
    title: "Marvel",
    backdropImageUrl: "https://img.example/marvel.jpg",
    pinToTop: true,
    viewMode: "ROWS",
    folders: [
      {
        id: "f1",
        title: "Movies",
        coverEmoji: "🎬",
        tileShape: "wide",
        sources: [
          {
            provider: "addon",
            addonId: "com.linvo.cinemeta",
            type: "movie",
            catalogId: "top",
            genre: "none",
          },
          { provider: "tmdb", tmdbSourceType: "COLLECTION", tmdbId: 86311 },
          { provider: "trakt", traktListId: 123 },
        ],
      },
      {
        id: "f2",
        title: "Legacy",
        catalogSources: [
          { addonId: "org.fork", type: "movie", catalogId: "trending" },
        ],
      },
    ],
  },
];

test("Nuvio collections come across, and go back", () => {
  const { collections, folders, skipped } = fromNuvio(JSON.stringify(NUVIO));
  assert.equal(collections.length, 1);
  assert.equal(folders, 2);
  assert.equal(skipped, 0, "addon, TMDB and Trakt sources all carry over");
  const [c] = collections;
  assert.equal(c.id, "nuvio-c1");
  assert.equal(c.pinned, true);
  assert.equal(c.view, "rows");
  assert.equal(c.cover, "https://img.example/marvel.jpg");
  assert.equal(c.folders[0].shape, "landscape");
  assert.equal(c.folders[0].emoji, "🎬");
  assert.deepEqual(c.folders[0].catalogs, [
    { addon: "com.linvo.cinemeta", type: "movie", catalog: "top" },
  ]);
  assert.equal(
    c.folders[1].catalogs[0].addon,
    "org.fork",
    "legacy catalogSources",
  );
  assert.throws(() => fromNuvio("not json"), /غير صالح/);
  assert.throws(() => fromNuvio({}), /غير صالح/);

  const back = toNuvio([
    ...collections,
    {
      title: "picks only",
      folders: [{ title: "mine", titles: [film("tt1")] }],
    },
  ]);
  assert.equal(back[0].viewMode, "ROWS");
  assert.equal(back[0].pinToTop, true);
  assert.equal(back[0].folders[0].tileShape, "landscape");
  assert.deepEqual(back[0].folders[0].sources[0], {
    provider: "addon",
    addonId: "com.linvo.cinemeta",
    type: "movie",
    catalogId: "top",
    genre: null,
  });
  assert.deepEqual(
    back[1].folders,
    [],
    "hand-picked titles have no Nuvio form",
  );
  // A round trip keeps the arrangement.
  assert.deepEqual(back[0].folders[0].sources[1], {
    provider: "tmdb",
    tmdbSourceType: "COLLECTION",
    tmdbId: 86311,
    mediaType: "MOVIE",
    sortBy: "original",
    title: null,
    filters: null,
  });
  const again = fromNuvio(back).collections[0].folders[0];
  assert.deepEqual(again.catalogs, c.folders[0].catalogs);
  assert.deepEqual(again.tmdb, c.folders[0].tmdb);
  assert.deepEqual(again.trakt, c.folders[0].trakt);
});

test("a re-import updates by ID instead of duplicating", () => {
  const first = fromNuvio(NUVIO).collections;
  const merged = mergeCollections([{ id: "mine", title: "Mine" }], first);
  assert.equal(merged.collections.length, 2);
  const again = mergeCollections(merged.collections, first);
  assert.equal(again.collections.length, 2);
});

test("collections belong to each profile and travel in backups", () => {
  const client = {
    state: { settings: { ...DEFAULT_SETTINGS }, favorites: [], progress: {} },
    persist() {},
    publicState() {
      return {};
    },
  };
  const profiles = new Profiles(client);
  profiles.ensure();
  client.state.collections = editCollections([], {
    action: "create",
    title: "A",
  });
  profiles.capture();
  const firstId = profiles.store.active;
  profiles.create({ name: "الثاني" });
  const second = profiles.store.list[1].id;
  profiles.store.active = second;
  profiles.apply();
  assert.deepEqual(client.state.collections, [], "a new profile starts empty");
  profiles.store.active = firstId;
  profiles.apply();
  assert.equal(client.state.collections[0].title, "A");

  const { payload } = collectBackup(client.state);
  assert.equal(payload.profiles.data[firstId].collections[0].title, "A");
  payload.profiles.data[firstId].collections.push({
    title: "evil",
    cover: "javascript:alert(1)",
    folders: [
      {
        title: "x",
        catalogs: [{ addon: "<script>", type: "movie", catalog: "x" }],
      },
    ],
  });
  const restored = restoreState(client.state, payload);
  const bucket = restored.profiles.data[firstId];
  assert.equal(bucket.collections.length, 2);
  assert.equal(bucket.collections[1].cover, "");
  assert.deepEqual(
    bucket.collections[1].folders[0].catalogs,
    [],
    "validated on restore",
  );
});

test("the home page follows the viewer's arrangement", () => {
  const rows = ["a", "b", "c", "d"].map((k) => ({ key: k.repeat(24) }));
  const [a, b, c, d] = rows.map((r) => r.key);
  assert.deepEqual(
    arrangeRows(rows, { order: [c, a], hidden: [b] }).map((r) => r.key),
    [c, a, d],
    "ordered first, hidden gone, the rest in addon order",
  );
  assert.deepEqual(moveCatalog(rows, [], d, "up"), [a, b, d, c]);
  assert.deepEqual(moveCatalog(rows, [], a, "up"), [a, b, c, d]);
  assert.deepEqual(safeHomeSections(["catalogs", "hero", "hero", "evil"]), [
    "catalogs",
    "hero",
  ]);
  assert.deepEqual(
    safeCatalogKeys(["x", a, a, "https://addon/manifest.json"]),
    [a],
  );
  const next = safeSettings(
    {
      homeSections: ["catalogs", "nope"],
      homeOrder: [a, "bad"],
      homeHidden: "x",
    },
    DEFAULT_SETTINGS,
  );
  assert.deepEqual(next.homeSections, ["catalogs"]);
  assert.deepEqual(next.homeOrder, [a]);
  assert.deepEqual(next.homeHidden, []);
  assert.equal(DEFAULT_SETTINGS.homeSections.length, 6);
});

test("collections and Nuvio actions are main-window only", () => {
  const preload = read("electron/preload.cjs");
  for (const method of [
    "collectionsEdit",
    "collectionCatalogs",
    "collectionFolder",
    "collectionSource",
    "collectionsCopyNuvio",
    "collectionsSaveNuvio",
    "importNuvioCollections",
    "nuvioScan",
    "nuvioPickBackup",
    "nuvioImport",
    "removeNuvioPlugin",
  ]) {
    assert.ok(preload.includes(`"${method}"`), method);
    assert.ok(!HUD_METHODS.has(method), `${method} stays off the HUD`);
  }
  assert.ok(HIDEABLE_NAV.some(([id]) => id === "collections"));
  const main = read("electron/main.mjs");
  const scan = main.slice(
    main.indexOf("nuvioScan:"),
    main.indexOf("nuvioPickBackup:"),
  );
  assert.match(
    scan,
    /nuvioFolders\(process\.env/,
    "folders come from the environment",
  );
  assert.match(scan, /NUVIO_STORES/, "only the known stores are read");
});

test("list-addon catalogs with their own type, as in U.N.E, are kept and found", async () => {
  const { resourceUrl } = await import("../core/protocol.mjs");
  const types = [
    "Trending Movies on Trakt",
    "IMDb's Top Drama Movies",
    "Top Fantasy/Sci-Fi Movies",
    "New Streaming Releases: Netflix",
  ];
  const { collections, skipped } = fromNuvio([
    {
      id: "une",
      title: "U.N.E",
      folders: [
        {
          id: "f",
          title: "Mixed",
          sources: types.map((type, i) => ({
            provider: "addon",
            addonId: "com.aiolists.user",
            type,
            catalogId: `aiolists-${i}`,
            genre: null,
          })),
        },
      ],
    },
  ]);
  assert.equal(skipped, 0);
  const [folder] = collections[0].folders;
  assert.deepEqual(
    folder.catalogs.map((c) => c.type),
    types,
  );
  const addon = {
    transportUrl: "https://lists.example/cfg/manifest.json",
    manifest: {
      id: "com.aiolists.user",
      catalogs: types.map((type, i) => ({
        type,
        id: `aiolists-${i}`,
        name: type,
      })),
    },
  };
  const found = resolveCatalog([addon], folder.catalogs[2]);
  assert.equal(found.cat.id, "aiolists-2");
  assert.equal(
    resourceUrl(addon.transportUrl, "catalog", found.cat.type, found.cat.id),
    "https://lists.example/cfg/catalog/Top%20Fantasy%2FSci-Fi%20Movies/aiolists-2.json",
  );
});
