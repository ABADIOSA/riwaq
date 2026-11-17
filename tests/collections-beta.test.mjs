// Collections in the November 2026 beta: moving covers and Nuvio's other
// display fields, a faithful round trip, the import report and modes, and
// a large file. core/collections.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  LIMITS,
  artUrl,
  cleanCollections,
  editCollections,
  fromNuvio,
  importCollections,
  plainCopy,
  toNuvio,
} from "../core/collections.mjs";

// The Reality TV folder of Kaptain's Nuvio Native file, as the task gives it.
const BASE = "https://raw.githubusercontent.com/ImKaptain/nuvio-assets/main";
const REALITY = {
  id: "folder-KQEZGAMF",
  title: "Reality TV",
  tileShape: "LANDSCAPE",
  hideTitle: true,
  focusGifEnabled: true,
  focusGifUrl: `${BASE}/Genres/Reality%20TV/Reality_TV_Hover.gif`,
  coverImageUrl: `${BASE}/Genres/Reality%20TV/Reality_TV_Base.png`,
  sources: [
    {
      provider: "tmdb",
      tmdbSourceType: "DISCOVER",
      mediaType: "TV",
      title: "New Series",
      sortBy: "primary_release_date.desc",
      filters: { year: 2026, withGenres: "10764", voteCountGte: 10 },
    },
    { provider: "simkl", listId: 42, title: "Not here yet", deep: { a: 1 } },
  ],
};
const FILE = [
  {
    id: "kaptain-genres",
    title: "Genres",
    backdropImageUrl: `${BASE}/backdrop.jpg`,
    pinToTop: true,
    viewMode: "TABBED_GRID",
    folders: [REALITY],
  },
];

test("a moving cover stays a moving cover, beside the still one", () => {
  const { collections, report } = fromNuvio(JSON.stringify(FILE));
  const folder = collections[0].folders[0];
  assert.equal(folder.cover, REALITY.coverImageUrl);
  assert.equal(folder.gif, REALITY.focusGifUrl);
  assert.equal(folder.gifOn, true);
  assert.equal(folder.hideTitle, true);
  assert.equal(folder.shape, "landscape");
  assert.equal(folder.tmdb[0].filters.withGenres, "10764");
  // The source Riwaq cannot read is kept, named and reported.
  assert.equal(folder.unsupported.length, 1);
  assert.equal(report.unsupported[0].provider, "simkl");
  assert.equal(report.unsupported[0].folder, "Reality TV");
  assert.equal(report.sources, 1);
});

test("the round trip gives every display field and unread source back", () => {
  const { collections } = fromNuvio(FILE);
  const [back] = toNuvio(collections);
  const folder = back.folders[0];
  assert.equal(folder.coverImageUrl, REALITY.coverImageUrl);
  assert.equal(folder.focusGifUrl, REALITY.focusGifUrl);
  assert.equal(folder.focusGifEnabled, true);
  assert.equal(folder.hideTitle, true);
  assert.equal(folder.tileShape, "LANDSCAPE");
  assert.equal(folder.focusGlowEnabled, false);
  assert.equal(back.backdropImageUrl, `${BASE}/backdrop.jpg`);
  // The Simkl source goes back as it came.
  assert.deepEqual(folder.sources.at(-1), REALITY.sources[1]);
  // And again: nothing drifts.
  const again = fromNuvio(toNuvio(fromNuvio(toNuvio(collections)).collections));
  assert.deepEqual(again.collections, collections);
});

test("artwork: HTTPS images or Riwaq's own local IDs, never a .gifv or a path", () => {
  assert.equal(artUrl("https://i.example/a.gif"), "https://i.example/a.gif");
  assert.equal(artUrl("https://i.imgur.com/abc.gifv"), "");
  assert.equal(artUrl("https://cdn.example/clip.mp4?x=1"), "");
  assert.equal(artUrl("http://i.example/a.gif"), "");
  assert.equal(artUrl("https://user:pw@i.example/a.gif"), "");
  assert.equal(artUrl(`local:${"a".repeat(32)}`), `local:${"a".repeat(32)}`);
  assert.equal(artUrl("local:../../etc/passwd"), "");
  assert.equal(artUrl("C:\\Users\\me\\cover.gif"), "");
  // Local pictures stay on this computer: never in a Nuvio export.
  const [c] = cleanCollections([
    {
      title: "Mine",
      folders: [
        {
          title: "F",
          cover: `local:${"b".repeat(32)}`,
          gif: `local:${"c".repeat(32)}`,
          catalogs: [{ addon: "a.b", type: "movie", catalog: "top" }],
        },
      ],
    },
  ]);
  const [out] = toNuvio([c]);
  assert.equal(out.folders[0].coverImageUrl, null);
  assert.equal(out.folders[0].focusGifUrl, null);
});

test("folder looks are edited through the same validation", () => {
  let list = editCollections([], { action: "create", title: "C" });
  const id = list[0].id;
  list = editCollections(list, {
    action: "folderAdd",
    collectionId: id,
    title: "F",
  });
  const folderId = list[0].folders[0].id;
  list = editCollections(list, {
    action: "folderUpdate",
    collectionId: id,
    folderId,
    gif: "https://i.example/move.gif",
    gifOn: false,
    backdrop: "https://i.example/wide.jpg",
    logo: "https://i.example/logo.png",
    glow: true,
    hideTitle: true,
  });
  const f = list[0].folders[0];
  assert.deepEqual(
    [f.gif, f.gifOn, f.backdrop, f.logo, f.glow, f.hideTitle],
    [
      "https://i.example/move.gif",
      false,
      "https://i.example/wide.jpg",
      "https://i.example/logo.png",
      true,
      true,
    ],
  );
  // A bad address is dropped, not stored.
  list = editCollections(list, {
    action: "folderUpdate",
    collectionId: id,
    folderId,
    gif: "https://i.imgur.com/x.gifv",
  });
  assert.equal(list[0].folders[0].gif, undefined);
  // Older folders keep their shape: no new keys unless set.
  const [plain] = cleanCollections([
    { title: "Old", folders: [{ title: "x" }] },
  ]);
  assert.deepEqual(Object.keys(plain.folders[0]).sort(), [
    "catalogs",
    "cover",
    "emoji",
    "id",
    "shape",
    "title",
    "titles",
    "tmdb",
    "trakt",
  ]);
});

test("import modes: merge by ID, add as copies, replace everything", () => {
  const incoming = fromNuvio(FILE).collections;
  const mine = cleanCollections([
    { id: "mine", title: "Mine", folders: [{ id: "own", title: "Own" }] },
    {
      id: "nuvio-kaptain-genres",
      title: "Genres (edited)",
      folders: [{ id: "extra", title: "My extra folder" }],
    },
  ]);
  // Merge: the same collection is updated; my extra folder stays.
  const merged = importCollections(mine, incoming, { mode: "merge" });
  assert.deepEqual(merged.report, {
    added: 0,
    updated: 1,
    replaced: 0,
    skipped: 0,
  });
  const genres = merged.collections.find(
    (c) => c.id === "nuvio-kaptain-genres",
  );
  assert.deepEqual(
    genres.folders.map((f) => f.title),
    ["My extra folder", "Reality TV"],
  );
  // Twice: no duplicates.
  const twice = importCollections(merged.collections, incoming, {});
  assert.equal(twice.collections.length, merged.collections.length);
  assert.equal(
    twice.collections.find((c) => c.id === "nuvio-kaptain-genres").folders
      .length,
    2,
  );
  // Add: a copy with its own ID.
  const added = importCollections(mine, incoming, { mode: "add" });
  assert.equal(added.collections.length, 3);
  assert.equal(added.report.added, 1);
  // Replace: only the file's collections remain.
  const replaced = importCollections(mine, incoming, { mode: "replace" });
  assert.deepEqual(
    replaced.collections.map((c) => c.id),
    ["nuvio-kaptain-genres"],
  );
  assert.equal(replaced.report.replaced, 2);
  // One collection of several.
  const two = fromNuvio([...FILE, { id: "x", title: "X", folders: [] }]);
  const one = importCollections([], two.collections, { only: ["nuvio-x"] });
  assert.deepEqual(
    one.collections.map((c) => c.title),
    ["X"],
  );
});

test("a large file imports within the limits and says what did not fit", () => {
  // 70 collections × 120 folders × 50 catalog sources: 420,000 sources.
  const huge = Array.from({ length: 70 }, (_, ci) => ({
    id: `c${ci}`,
    title: `Collection ${ci}`,
    folders: Array.from({ length: 120 }, (_, fi) => ({
      id: `f${ci}-${fi}`,
      title: `Folder ${fi}`,
      sources: Array.from({ length: 50 }, (_, si) => ({
        provider: "addon",
        addonId: "com.example",
        type: "movie",
        catalogId: `cat-${si}`,
      })),
    })),
  }));
  // Parsed data: as text this is far past the 4 MB a paste may be.
  const started = Date.now();
  const { collections, report } = fromNuvio(huge);
  const took = Date.now() - started;
  assert.equal(collections.length, LIMITS.collections);
  assert.ok(collections.every((c) => c.folders.length === LIMITS.folders));
  assert.ok(
    collections[0].folders.every((f) => f.catalogs.length === LIMITS.catalogs),
  );
  assert.equal(report.over.collections, 10);
  assert.equal(report.over.folders, 60 * 20);
  assert.equal(report.over.sources, 60 * 100 * 10);
  assert.ok(took < 5000, `${took} ms`);
  // A file larger than 4 MB is refused before parsing.
  assert.throws(() => fromNuvio(" ".repeat(4_000_001)), /كبير/);
});

test("unread sources are copied as plain data only", () => {
  const evil = JSON.parse(
    '{"provider":"x","__proto__":{"polluted":true},"fn":"() => 1","deep":{"a":{"b":{"c":{"d":{"e":1}}}}},"big":"' +
      "x".repeat(900) +
      '"}',
  );
  const copy = plainCopy(evil);
  assert.equal({}.polluted, undefined);
  assert.equal(copy.fn, "() => 1", "a string stays a string, never run");
  assert.equal(copy.big.length, 500);
  // Four levels with the source itself: what is deeper is left out.
  assert.deepEqual(copy.deep, { a: { b: {} } });
});

// --- Pictures from this computer (core/collection-art.mjs) -----------------

import {
  ART_GRACE_MS,
  ArtStore,
  referencedArt,
  sniffImage,
} from "../core/collection-art.mjs";
import { deflateSync } from "node:zlib";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileArtStore } from "../electron/collection-art.mjs";

const gif = (w = 2, h = 2) => {
  const b = new Uint8Array(32);
  b.set([...Buffer.from("GIF89a")], 0);
  b[6] = w & 255;
  b[7] = w >> 8;
  b[8] = h & 255;
  b[9] = h >> 8;
  return b;
};
const pngOf = (w, h) => {
  const b = new Uint8Array(40);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([...Buffer.from("IHDR")], 12);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
};
const jpegOf = (w, h) =>
  new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x04,
    0x00,
    0x00,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    h >> 8,
    h & 255,
    w >> 8,
    w & 255,
    0x03,
    0,
    0,
    0,
    0,
    0,
    0,
  ]);

test("the bytes decide what a picture is, not its name", () => {
  assert.deepEqual(sniffImage(gif(320, 180)), {
    type: "gif",
    mime: "image/gif",
    width: 320,
    height: 180,
  });
  assert.equal(sniffImage(pngOf(1280, 720)).type, "png");
  assert.deepEqual(
    [sniffImage(jpegOf(640, 360)).width, sniffImage(jpegOf(640, 360)).height],
    [640, 360],
  );
  // A video (an MP4's "ftyp" box), text, or nothing at all is refused.
  const mp4 = new Uint8Array([0, 0, 0, 0x18, ...Buffer.from("ftypisom"), 0, 0]);
  assert.throws(() => sniffImage(mp4), /الفيديو لا يُقبل/);
  assert.throws(() => sniffImage(Buffer.from("<svg></svg>")), /ليست صورة/);
  assert.throws(() => sniffImage(new Uint8Array()), /فارغ/);
  assert.throws(() => sniffImage(gif(5000, 10)), /أكبر من 4096/);
  assert.throws(() => sniffImage(new Uint8Array(8 * 1024 * 1024 + 1)), /8/);
});

test("pictures named by no collection go, after a grace period", async () => {
  const files = new Map();
  let clock = 1_000_000;
  const store = new ArtStore(
    {
      write: async (id, bytes, mime) =>
        files.set(id, { bytes, mime, at: clock }),
      read: async (id) => files.get(id) || null,
      remove: async (id) => files.delete(id),
      list: async () => [...files].map(([id, v]) => ({ id, at: v.at })),
    },
    { now: () => clock },
  );
  const kept = await store.add(gif());
  const dropped = await store.add(pngOf(4, 4));
  assert.match(kept.ref, /^local:[a-f\d]{32}$/);
  const collections = cleanCollections([
    { title: "C", folders: [{ title: "F", gif: kept.ref }] },
  ]);
  // A picture chosen a moment ago survives a sweep: it may be saved next.
  assert.equal(await store.sweep(referencedArt(collections)), 0);
  clock += ART_GRACE_MS + 1;
  assert.equal(await store.sweep(referencedArt(collections)), 1);
  assert.ok(await store.read(kept.ref));
  assert.equal(await store.read(dropped.ref), null);
  // Only "local:" IDs are read; nothing else reaches the backend.
  assert.equal(await store.read("../../secret"), null);
  assert.equal(await store.read("https://x.example/a.gif"), null);
});

test("on Windows the pictures are files named by their ID only", async () => {
  const dir = mkdtempSync(join(tmpdir(), "riwaq-art-"));
  const store = fileArtStore(dir);
  const { ref } = await store.add(gif(10, 10));
  const names = readdirSync(dir);
  assert.equal(names.length, 1);
  assert.match(names[0], /^[a-f\d]{32}\.gif$/);
  const back = await store.read(ref);
  assert.equal(back.mime, "image/gif");
  assert.equal(Buffer.from(back.bytes).subarray(0, 6).toString(), "GIF89a");
});

test("the page asks for a picture by ID, behind the library lock", () => {
  const read = (file) =>
    readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8");
  const main = read("electron/main.mjs");
  assert.match(
    main,
    /collectionArtPick: async \(\) => \{\s*client\.profiles\.gate\("library"\);/,
  );
  assert.match(
    main,
    /collectionArt: async \(a\) => \{\s*client\.profiles\.gate\("library"\);/,
  );
  const web = read("web/bridge.js");
  assert.match(web, /collectionArtPick: async \(\) => \{/);
  assert.match(read("electron/preload.cjs"), /"collectionArt",/);
});
