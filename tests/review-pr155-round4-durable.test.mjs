// Codex's third review of PR #155 (docs/REVIEW-PR-155.md, "Fourth pass"):
// N1 (a write the browser refused was answered as done, then carried by a
// later save, and let an artwork sweep delete a kept picture) and N2 (a
// Nuvio import that failed half way kept half of itself). These run the
// real Client over core/durable.mjs with a store that answers later and can
// be told to refuse, as IndexedDB does; scripts/test-web-durability.mjs
// runs the same cases in Chromium against the real sealed vault.
import test from "node:test";
import assert from "node:assert/strict";
import { Client, PROFILE_CHANGED } from "../core/client.mjs";
import { DurableWriter } from "../core/durable.mjs";
import { stateArt, referencedArt } from "../core/collection-art.mjs";

const tick = () => new Promise((r) => setTimeout(r, 2));

/** A Client over a store that commits later and can refuse a write. */
function asyncClient(initial = {}, options = {}) {
  const disk = {
    text: JSON.stringify(initial),
    fail: 0,
    writes: 0,
    refused: 0,
    hold: null,
  };
  let current = initial;
  const writer = new DurableWriter({
    snapshot: () => ({
      text: JSON.stringify(current),
      meta: stateArt(current),
    }),
    write: async (text) => {
      await tick();
      if (disk.hold) await disk.hold;
      if (disk.fail > 0) {
        disk.fail--;
        disk.refused++;
        // IndexedDB's manual abort: no error object at all.
        throw null;
      }
      disk.text = text;
      disk.writes++;
    },
    initialMeta: stateArt(initial),
  });
  const c = new Client({
    load: () => JSON.parse(disk.text),
    save: (data, undo) => {
      current = data;
      return writer.request(undo);
    },
    ...options,
  });
  const onDisk = () => JSON.parse(disk.text);
  return { c, disk, writer, onDisk };
}
const diskTitles = (state) =>
  (state.profiles.data[state.profiles.active].collections || []).map(
    (x) => x.title,
  );
const titles = (list) => list.map((x) => x.title);
const nuvioText = (title, id = "replacement") =>
  JSON.stringify([{ id, title, folders: [] }]);

/* The writer itself. */

test("N1: a save resolves only after the write commits, and rejects when refused", async () => {
  const done = [];
  let fail = false;
  const w = new DurableWriter({
    snapshot: () => ({ text: "x" }),
    write: async () => {
      await tick();
      if (fail) throw new Error("abort");
      done.push("committed");
    },
  });
  const first = w.request();
  assert.deepEqual(done, [], "nothing committed yet");
  await first;
  assert.deepEqual(done, ["committed"]);
  fail = true;
  await assert.rejects(w.request(), /abort/);
  assert.equal(w.failures, 1);
  await w.settled();
});

test("N1: a refused write undoes its commit and every commit built on it, newest first", async () => {
  const order = [];
  let release;
  const gate = new Promise((r) => (release = r));
  let calls = 0;
  const w = new DurableWriter({
    snapshot: () => ({ text: String(calls) }),
    write: async () => {
      calls++;
      if (calls === 1) {
        await gate;
        throw new Error("refused");
      }
    },
  });
  const a = w.request(() => order.push("undo a"));
  await tick(); // a's write is under way
  const b = w.request(() => order.push("undo b"));
  const c = w.request(() => order.push("undo c"));
  const plain = w.request();
  release();
  await assert.rejects(a, /refused/);
  await assert.rejects(b, /حفظاً سبقه/);
  await assert.rejects(c, /حفظاً سبقه/);
  await plain; // a plain save is written again with the rolled-back state
  assert.deepEqual(order, ["undo c", "undo b", "undo a"]);
  assert.equal(calls, 2, "the plain save went out after the undo");
});

test("N1: settled() never rejects, and a refused write with no error object still says why", async () => {
  const w = new DurableWriter({
    snapshot: () => ({ text: "x" }),
    write: async () => {
      throw null;
    },
  });
  const p = w.request(() => {});
  await assert.rejects(
    p,
    (e) => e instanceof Error && /تعذّر حفظ/.test(e.message),
  );
  await w.settled();
  assert.equal(w.busy, false);
});

/* The Client over it: Codex's three observations. */

test("N1: a refused Replace fails, is rolled back, and survives no later save", async () => {
  const { c, disk, onDisk } = asyncClient();
  c.collectionsEdit({ action: "create", title: "Existing collection" });
  await c.durable();
  assert.deepEqual(diskTitles(onDisk()), ["Existing collection"]);
  disk.fail = 1;
  const reply = c.importNuvioCollections({
    text: nuvioText("Replacement"),
    only: ["nuvio-replacement"],
    mode: "replace",
    profileSession: c.profiles.session(),
  });
  // The reply is computed, but the call is only answered by its write.
  assert.equal(reply.result.collections, 1);
  await assert.rejects(c.durable(), /تعذّر حفظ/);
  assert.deepEqual(titles(c.state.collections), ["Existing collection"]);
  assert.deepEqual(diskTitles(onDisk()), ["Existing collection"]);
  // Codex: an unrelated language save used to write the refused Replace.
  c.settings({ uiLanguage: "en" });
  await c.durable();
  assert.deepEqual(diskTitles(onDisk()), ["Existing collection"]);
  assert.equal(onDisk().profiles.data.default.settings.uiLanguage, "en");
  // A retry after the failure goes through.
  c.importNuvioCollections({
    text: nuvioText("Replacement"),
    only: ["nuvio-replacement"],
    mode: "replace",
    profileSession: c.profiles.session(),
  });
  await c.durable();
  assert.deepEqual(diskTitles(onDisk()), ["Replacement"]);
  assert.equal(disk.refused, 1);
});

test("N1: two concurrent edits, the first refused: both fail, neither is kept, a retry works", async () => {
  const { c, disk, onDisk } = asyncClient();
  c.collectionsEdit({ action: "create", title: "Kept" });
  await c.durable();
  disk.fail = 1;
  c.collectionsEdit({ action: "create", title: "First" });
  const first = c.durable();
  await tick();
  c.collectionsEdit({ action: "create", title: "Second" });
  const second = c.durable();
  await assert.rejects(first);
  await assert.rejects(second);
  assert.deepEqual(titles(c.state.collections), ["Kept"]);
  assert.deepEqual(diskTitles(onDisk()), ["Kept"]);
  c.collectionsEdit({ action: "create", title: "Again" });
  await c.durable();
  assert.deepEqual(diskTitles(onDisk()), ["Kept", "Again"]);
});

test("N1: an edit refused after a profile switch goes back into its own profile, not the active one", async () => {
  const { c, disk, onDisk } = asyncClient();
  const a = c.profiles.store.active;
  c.profiles.create({ name: "B" });
  const b = c.profiles.store.list.find((p) => p.id !== a).id;
  c.collectionsEdit({ action: "create", title: "A's own" });
  await c.durable();
  let release;
  disk.hold = new Promise((r) => (release = r));
  disk.fail = 1;
  c.collectionsEdit({ action: "create", title: "A's refused" });
  const refused = c.durable();
  await tick();
  c.profiles.switch({ id: b });
  c.collectionsEdit({ action: "create", title: "B's new" });
  const later = c.durable();
  disk.hold = null;
  release();
  await assert.rejects(refused);
  await assert.rejects(later, /حفظاً سبقه/);
  // B's collection was built after the refusal and went back into B's own
  // bucket. Since the fifth pass (Q6) the switch is a commit too, built on
  // the refused write, so it is undone with them: A is active again, as on
  // disk, under a new activation.
  assert.deepEqual(titles(c.profiles.store.data[b].collections), []);
  assert.equal(c.profiles.store.active, a);
  assert.deepEqual(titles(c.state.collections), ["A's own"]);
  await c.durable().catch(() => {});
  c.settings({ uiLanguage: "en" });
  await c.durable();
  const kept = onDisk();
  assert.deepEqual(titles(kept.profiles.data[a].collections), ["A's own"]);
  assert.deepEqual(titles(kept.profiles.data[b].collections), []);
  assert.equal(kept.profiles.active, a);
});

test("N1: plain saves made while a refused commit is written go out again; the commit does not", async () => {
  const { c, disk, onDisk } = asyncClient();
  c.collectionsEdit({ action: "create", title: "Kept" });
  await c.durable();
  disk.fail = 1;
  c.collectionsEdit({ action: "create", title: "Refused" });
  const refused = c.durable();
  await tick(); // the refused write is under way
  // A position saved meanwhile (a plain save, never undone).
  c.state.progress["movie:tt0000001"] = { position: 30, duration: 100 };
  c.persist();
  const plain = c.durable();
  await assert.rejects(refused);
  await plain;
  const kept = onDisk();
  assert.deepEqual(diskTitles(kept), ["Kept"]);
  assert.equal(
    kept.profiles.data.default.progress["movie:tt0000001"].position,
    30,
  );
});

test("N1: a plain save in the refused write itself is kept in memory and written by the next save, without the commit", async () => {
  const { c, disk, onDisk } = asyncClient();
  disk.fail = 1;
  c.collectionsEdit({ action: "create", title: "Refused" });
  c.state.progress["movie:tt0000002"] = { position: 40, duration: 100 };
  c.persist();
  await assert.rejects(c.durable());
  assert.deepEqual(titles(c.state.collections), []);
  c.settings({ uiLanguage: "en" });
  await c.durable();
  const kept = onDisk();
  assert.deepEqual(diskTitles(kept), []);
  assert.equal(
    kept.profiles.data.default.progress["movie:tt0000002"].position,
    40,
  );
});

test("N1: the pictures a sweep must keep include the durable state's while a change is unconfirmed", async () => {
  const art = "b".repeat(32);
  const { c, disk, writer } = asyncClient();
  c.collectionsEdit({ action: "create", title: "With art" });
  const id = c.state.collections[0].id;
  c.collectionsEdit({
    action: "update",
    collectionId: id,
    cover: `local:${art}`,
  });
  await c.durable();
  let release;
  disk.hold = new Promise((r) => (release = r));
  disk.fail = 1;
  c.importNuvioCollections({
    text: nuvioText("Replacement"),
    only: ["nuvio-replacement"],
    mode: "replace",
    profileSession: c.profiles.session(),
  });
  const replaced = c.durable();
  // Memory no longer names the picture; the durable state still does.
  assert.equal(referencedArt(c.allCollections()).has(art), false);
  assert.ok(writer.metas().some((set) => set.has(art)));
  disk.hold = null;
  release();
  await assert.rejects(replaced);
  assert.equal(referencedArt(c.allCollections()).has(art), true);
});

test("N1: every user edit is rolled back when its write is refused", async () => {
  const cases = [
    [
      "favorite",
      (c) => c.favorite({ id: "tt1", type: "movie", name: "T" }),
      (s) => s.favorites.length,
    ],
    [
      "hotkey",
      (c) => c.setHotkey({ id: "fullscreen", binding: "Ctrl+K" }),
      (s) => JSON.stringify(s.hotkeys || {}),
    ],
    [
      "history",
      (c) =>
        c.historyEdit({
          action: "complete",
          meta: { id: "tt1", type: "movie", name: "T" },
          videoId: "tt1",
        }),
      (s) => Object.keys(s.progress).length,
    ],
    [
      "queue",
      (c) =>
        c.queueEdit({
          action: "add",
          meta: { id: "tt1", type: "movie", name: "T" },
          videoId: "tt1",
        }),
      (s) => (s.queue || []).length,
    ],
    [
      "provider",
      (c) => c.dataHub.save({ id: "tmdb", key: "a".repeat(32) }),
      (s) => JSON.stringify(s.providers || {}),
    ],
    [
      "settings",
      (c) => c.settings({ uiLanguage: "en" }),
      (s) => s.settings.uiLanguage,
    ],
  ];
  for (const [name, edit, read] of cases) {
    const { c, disk } = asyncClient();
    const before = read(c.state);
    disk.fail = 1;
    try {
      edit(c);
    } catch (error) {
      assert.fail(`${name}: ${error.message}`);
    }
    await assert.rejects(c.durable(), undefined, name);
    assert.deepEqual(read(c.state), before, name);
  }
});

test("N1: a backup restore whose write is refused is undone whole, and a later save keeps the old state", async () => {
  const { c, disk, onDisk } = asyncClient();
  c.collectionsEdit({ action: "create", title: "Backed up" });
  await c.durable();
  const passphrase = "a long enough passphrase 1234";
  const { text } = c.exportBackup({ passphrase });
  c.collectionsEdit({ action: "create", title: "After backup" });
  await c.durable();
  disk.fail = 1;
  c.restoreBackup({ text, passphrase });
  await assert.rejects(c.durable());
  assert.deepEqual(titles(c.state.collections), ["Backed up", "After backup"]);
  c.settings({ uiLanguage: "en" });
  await c.durable();
  assert.deepEqual(diskTitles(onDisk()), ["Backed up", "After backup"]);
  // The retry restores.
  c.restoreBackup({ text, passphrase });
  await c.durable();
  assert.deepEqual(diskTitles(onDisk()), ["Backed up"]);
});

/* N2: a Nuvio import is all of the profile's parts, or none of them. */

const manifest = (id) => ({
  id,
  name: id,
  version: "1.0.0",
  resources: ["catalog"],
  types: ["movie"],
  catalogs: [],
});
const STORES = {
  nuvio_addons: {
    installed_addon_urls_1: JSON.stringify([
      "https://one.example.invalid/manifest.json",
      "https://two.example.invalid/manifest.json",
    ]),
    addon_enabled_states_1: JSON.stringify({
      "https://two.example.invalid/manifest.json": false,
    }),
  },
  nuvio_collections: {
    collections_1: JSON.stringify([{ id: "c1", title: "Imported" }]),
  },
  nuvio_library: {
    library_1: JSON.stringify({
      items: [{ id: "tt0111161", type: "movie", name: "Library title" }],
    }),
  },
  nuvio_plugins: {
    plugins_state_1: JSON.stringify({
      repositories: [
        {
          manifestUrl: "https://repo.example.invalid/manifest.json",
          name: "Repo",
        },
      ],
    }),
  },
  nuvio_tmdb_settings: { tmdb_api_key_1: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6" },
};
const ALL = {
  addons: true,
  collections: true,
  library: true,
  plugins: true,
  tmdbKey: true,
};
const nuvioClient = () =>
  asyncClient(
    {},
    {
      request: async (url) => manifest(new URL(url).host),
    },
  );

test("N2: the import's last write refused: no collection, title, repository or key stays; installed addons are kept and named", async () => {
  const { c, disk, onDisk } = nuvioClient();
  const before = c.state.addons.length;
  // Two addon writes go through, the profile write is refused.
  const run = c.importNuvio(STORES, { profile: 1, parts: ALL });
  const watcher = setInterval(() => {
    if (disk.writes >= 2 && !disk.fail && !disk.armed) {
      disk.armed = true;
      disk.fail = 1;
    }
  }, 0);
  await assert.rejects(run, (error) => {
    assert.match(error.message, /الإضافات المثبّتة \(2\) فمحفوظة/);
    assert.equal(error.installedAddons, 2);
    return true;
  });
  clearInterval(watcher);
  await c.durable().catch(() => {});
  for (const state of [c.state, onDisk().profiles.data.default]) {
    assert.deepEqual(titles(state.collections), []);
    assert.equal(state.favorites.length, 0);
  }
  assert.equal((c.state.nuvioPlugins || []).length, 0);
  assert.equal(c.state.providers?.tmdb, undefined);
  // A later unrelated save does not bring any of it back.
  c.settings({ uiLanguage: "en" });
  await c.durable();
  const kept = onDisk();
  assert.equal((kept.nuvioPlugins || []).length, 0);
  assert.equal(kept.providers?.tmdb, undefined);
  assert.deepEqual(titles(kept.profiles.data.default.collections), []);
  assert.equal(kept.addons.length, before + 2, "the two addons stay");
  assert.equal(
    kept.addons.find((a) => a.manifest.id === "two.example.invalid").enabled,
    false,
  );
  // A retry brings the rest in once.
  const again = await c.importNuvio(STORES, { profile: 1, parts: ALL });
  assert.equal(again.result.addons, 0);
  assert.equal(again.result.collections, 1);
  assert.equal(again.result.tmdbKey, "imported");
  await c.durable();
  const after = onDisk();
  assert.deepEqual(titles(after.profiles.data.default.collections), [
    "Imported",
  ]);
  assert.equal(after.providers.tmdb.key, "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6");
});

test("N2: an addon whose write is refused is not counted and not kept", async () => {
  const { c, disk, onDisk } = nuvioClient();
  disk.fail = 1; // the first addon's write
  const { result } = await c.importNuvio(STORES, {
    profile: 1,
    parts: { addons: true },
  });
  assert.equal(result.addons, 1);
  assert.deepEqual(result.addonFailures, ["one.example.invalid"]);
  await c.durable();
  const ids = onDisk().addons.map((a) => a.manifest.id);
  assert.ok(!ids.includes("one.example.invalid"));
  assert.ok(ids.includes("two.example.invalid"));
  assert.ok(
    !c.state.addons.some((a) => a.manifest.id === "one.example.invalid"),
  );
});

test("N2: every part arrives in one write when nothing fails, on the desktop's synchronous store too", async () => {
  let writes = 0;
  let saved = null;
  const c = new Client({
    load: () => ({}),
    save: (state) => {
      writes++;
      saved = structuredClone(state);
    },
    request: async (url) => manifest(new URL(url).host),
  });
  const start = writes;
  const { result } = await c.importNuvio(STORES, {
    profile: 1,
    parts: { ...ALL, addons: false },
  });
  assert.equal(
    writes - start,
    1,
    "collections, library, plugins and key in one write",
  );
  assert.equal(result.tmdbKey, "imported");
  assert.equal(saved.providers.tmdb.key, "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6");
  assert.equal(saved.nuvioPlugins.length, 1);
});

test("N2: a synchronous write failure leaves the desktop's import whole-or-nothing too", async () => {
  let fail = false;
  const c = new Client({
    load: () => ({}),
    save: () => {
      if (fail) throw new Error("disk full");
    },
    request: async (url) => manifest(new URL(url).host),
  });
  fail = true;
  await assert.rejects(
    c.importNuvio(STORES, { profile: 1, parts: { ...ALL, addons: false } }),
    /disk full/,
  );
  assert.equal(c.state.providers?.tmdb, undefined);
  assert.deepEqual(c.state.collections, []);
  assert.equal(c.state.favorites.length, 0);
  assert.equal((c.state.nuvioPlugins || []).length, 0);
});

test("N2: a switch during the addon installs refuses the profile parts and names the kept addons", async () => {
  let resume;
  let entered;
  const installing = new Promise((r) => (entered = r));
  const { c } = asyncClient(
    {},
    {
      request: async (url) => {
        entered();
        await new Promise((r) => (resume = r));
        return manifest(new URL(url).host);
      },
    },
  );
  const a = c.profiles.store.active;
  c.profiles.create({ name: "B" });
  const b = c.profiles.store.list.find((p) => p.id !== a).id;
  const run = c.importNuvio(
    {
      ...STORES,
      nuvio_addons: {
        installed_addon_urls_1: JSON.stringify([
          "https://one.example.invalid/manifest.json",
        ]),
      },
    },
    { profile: 1, parts: ALL },
  );
  await installing;
  c.profiles.switch({ id: b });
  resume();
  await assert.rejects(run, (error) => {
    assert.ok(error.message.startsWith(PROFILE_CHANGED));
    assert.equal(error.installedAddons, 1);
    return true;
  });
  assert.deepEqual(c.profiles.store.data[a].collections, []);
  assert.equal(c.state.providers?.tmdb, undefined);
});
