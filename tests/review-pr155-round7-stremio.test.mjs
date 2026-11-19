// Codex's sixth review of PR #155 (docs/REVIEW-PR-155.md, "Seventh pass"),
// W3: Client.sync() took its profile activation after its first request,
// so A → B → A during addonCollectionGet let the old import write a title
// and a position into A's new activation. The claim is now taken before
// any request; the Stremio sign-in and the import's own run are part of it.
import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "../core/client.mjs";

const manifest = {
  id: "test.provider",
  name: "Fixture",
  version: "1.0.0",
  types: ["movie"],
  resources: ["stream"],
  catalogs: [],
};
const item = (id, offset = 14000) => ({
  _id: id,
  type: "movie",
  name: "Disposable " + id,
  _mtime: "2025-01-01T00:00:00Z",
  state: { timeOffset: offset, duration: 90000 },
});

/**
 * A client whose Stremio API answers from `library` and can be held at one
 * method (`hold(method)` → { asked, release }). `calls` lists every request
 * with the key it carried; the key is a synthetic placeholder.
 */
function fixture({ ids = ["tt9142009"], addons = 1 } = {}) {
  const calls = [];
  const holds = new Map();
  const saved = [];
  const c = new Client({
    load: () => ({}),
    save: (state) => saved.push(structuredClone(state)),
    api: async (method, payload) => {
      calls.push([method, payload.authKey]);
      const hold = holds.get(method);
      if (hold) {
        holds.delete(method);
        hold.asked.resolve();
        await hold.release.promise;
      }
      if (method === "getUser")
        return { fullname: "Synthetic " + payload.authKey.slice(-1) };
      if (method === "addonCollectionGet")
        return {
          addons: Array.from({ length: addons }, (_, i) => ({
            transportUrl: `https://addon${i}.test/manifest.json`,
            manifest: { ...manifest, id: "test.provider" + i },
          })),
        };
      if (method === "datastoreMeta") return ids.map((id) => [id]);
      if (method === "datastoreGet") return payload.ids.map((id) => item(id));
      throw new Error("Unexpected test request " + method);
    },
  });
  return {
    c,
    calls,
    saved,
    hold(method) {
      const h = {
        asked: Promise.withResolvers(),
        release: Promise.withResolvers(),
      };
      holds.set(method, h);
      return { asked: h.asked.promise, release: () => h.release.resolve() };
    },
    methods: () => calls.map(([m]) => m),
  };
}
async function signedIn(options) {
  const f = fixture(options);
  await f.c.authenticate("synthetic-key-1");
  const a = f.c.profiles.store.active;
  const b = f.c.profiles
    .create({ name: "B" })
    .profiles.list.find((p) => p.id !== a).id;
  f.calls.length = 0;
  return { ...f, a, b };
}
const library = (c) => ({
  favorites: c.state.favorites.map((m) => m.id),
  positions: Object.keys(c.state.progress),
});

test("W3: A → B → A during the first request imports the shared addons only; the library is neither asked for nor written", async () => {
  const f = await signedIn();
  const held = f.hold("addonCollectionGet");
  const loading = f.c.sync();
  await held.asked;
  f.c.profiles.switch({ id: f.b });
  f.c.profiles.switch({ id: f.a });
  held.release();
  const result = await loading;
  assert.equal(f.c.profiles.store.active, f.a);
  // Codex's finding: a title and a 14 s position landed in A's new activation.
  assert.deepEqual(library(f.c), { favorites: [], positions: [] });
  assert.equal(result.libraryWarning, true);
  assert.equal(result.profileChanged, true);
  assert.equal(result.imported, 1);
  assert.equal(f.c.state.addons.length, 1);
  // No new work for an ended activation.
  assert.deepEqual(f.methods(), ["addonCollectionGet"]);
  // B, the profile in between, got nothing either.
  f.c.profiles.switch({ id: f.b });
  assert.deepEqual(library(f.c), { favorites: [], positions: [] });
});

test("W3: A → B → A during a later library page stops the remaining pages and writes no library", async () => {
  const ids = Array.from({ length: 150 }, (_, i) => `tt${1000000 + i}`);
  const f = await signedIn({ ids });
  const held = f.hold("datastoreGet");
  const loading = f.c.sync();
  await held.asked;
  f.c.profiles.switch({ id: f.b });
  f.c.profiles.switch({ id: f.a });
  held.release();
  const result = await loading;
  assert.deepEqual(library(f.c), { favorites: [], positions: [] });
  assert.equal(result.libraryWarning, true);
  assert.equal(result.profileChanged, true);
  assert.deepEqual(f.methods(), [
    "addonCollectionGet",
    "datastoreMeta",
    "datastoreGet",
  ]);
});

test("W3: a re-lock (lock, unlock) or a restore's new activation during the first request writes no library", async () => {
  for (const between of ["lock", "renew"]) {
    const f = await signedIn();
    f.c.profiles.setPin({ id: f.a, pin: "2468" });
    f.c.profiles.unlock("2468");
    const held = f.hold("addonCollectionGet");
    const loading = f.c.sync();
    await held.asked;
    if (between === "lock") {
      f.c.profiles.lock();
      f.c.profiles.unlock("2468");
    } else f.c.profiles.renew();
    held.release();
    const result = await loading;
    assert.deepEqual(library(f.c), { favorites: [], positions: [] }, between);
    assert.equal(result.profileChanged, true, between);
  }
});

test("W3: a Stremio sign-out during the import writes nothing at all, addons included", async () => {
  for (const at of ["addonCollectionGet", "datastoreMeta", "datastoreGet"]) {
    const f = await signedIn();
    const held = f.hold(at);
    const loading = f.c.sync();
    await held.asked;
    f.c.logout();
    held.release();
    await assert.rejects(loading, /لم تكتب هذه المزامنة شيئًا/, at);
    assert.equal(f.c.state.auth, null, at);
    assert.deepEqual(f.c.state.addons, [], at);
    assert.deepEqual(library(f.c), { favorites: [], positions: [] }, at);
  }
});

test("W3: another account signed in during the import keeps the new sign-in and none of the old account's data", async () => {
  const f = await signedIn();
  const held = f.hold("datastoreMeta");
  const loading = f.c.sync();
  await held.asked;
  await f.c.authenticate("synthetic-key-2");
  held.release();
  await assert.rejects(loading, /لم تكتب هذه المزامنة شيئًا/);
  assert.equal(f.c.state.auth.authKey, "synthetic-key-2");
  assert.deepEqual(f.c.state.addons, []);
  assert.deepEqual(library(f.c), { favorites: [], positions: [] });
});

test("W3: a sign-out while the sign-in's getUser is out leaves Stremio signed out", async () => {
  const f = fixture();
  const held = f.hold("getUser");
  const signing = f.c.authenticate("synthetic-key-1");
  await held.asked;
  f.c.logout();
  held.release();
  await assert.rejects(signing, /لم يتغير شيء/);
  assert.equal(f.c.state.auth, null);
  // An older sign-in finishing after a newer one never replaces it.
  const older = f.hold("getUser");
  const first = f.c.authenticate("synthetic-key-1");
  await older.asked;
  await f.c.authenticate("synthetic-key-2");
  older.release();
  await assert.rejects(first, /لم يتغير شيء/);
  assert.equal(f.c.state.auth.authKey, "synthetic-key-2");
});

test("W3: of two overlapping imports only the newer writes; the older is told it wrote nothing", async () => {
  const f = await signedIn();
  const held = f.hold("datastoreGet");
  const older = f.c.sync();
  await held.asked;
  const newer = await f.c.sync();
  assert.deepEqual(library(f.c), {
    favorites: ["tt9142009"],
    positions: ["movie:tt9142009"],
  });
  held.release();
  await assert.rejects(older, /بدأت مزامنة أحدث/);
  assert.equal(newer.libraryWarning, false);
  assert.equal(f.c.state.addons.length, 1);
  assert.equal(f.c.state.favorites.length, 1);
});

test("W3: an uninterrupted import writes addons, library and positions into the profile that asked; a retry after a stale one works", async () => {
  const f = await signedIn();
  const held = f.hold("addonCollectionGet");
  const stale = f.c.sync();
  await held.asked;
  f.c.profiles.switch({ id: f.b });
  f.c.profiles.switch({ id: f.a });
  held.release();
  await stale;
  const result = await f.c.sync();
  assert.equal(result.libraryWarning, false);
  assert.equal(result.profileChanged, undefined);
  assert.equal(result.imported, 1);
  assert.deepEqual(library(f.c), {
    favorites: ["tt9142009"],
    positions: ["movie:tt9142009"],
  });
  assert.equal(f.c.state.progress["movie:tt9142009"].position, 14);
  f.c.profiles.switch({ id: f.b });
  assert.deepEqual(library(f.c), { favorites: [], positions: [] });
});
