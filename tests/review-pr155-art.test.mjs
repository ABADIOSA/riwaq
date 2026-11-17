// Codex's review of PR #155, F8 and the artwork security notes: a moving
// picture accepted in a still slot, pictures read by ID alone, a sweep that
// read its references before awaiting the store, links under the store, and
// raw unsupported sources carrying credentials. Real multi-frame images
// (scripts/fixtures/moving-images.mjs), not one-frame stand-ins.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import {
  ART_GRACE_MS,
  ArtStore,
  isAnimated,
  sniffImage,
} from "../core/collection-art.mjs";
import { Client } from "../core/client.mjs";
import { cleanCollections, plainCopy } from "../core/collections.mjs";
import { fileArtStore, readArtFile } from "../electron/collection-art.mjs";
import { bytesOf } from "../scripts/fixtures/moving-images.mjs";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const memory = () => {
  const files = new Map();
  return {
    files,
    write: async (id, bytes, mime) =>
      files.set(id, { bytes, mime, at: Date.now() }),
    read: async (id) => files.get(id) || null,
    remove: async (id) => files.delete(id),
    list: async () => [...files].map(([id, f]) => ({ id, at: f.at })),
  };
};

test("F8: the frames are counted from the bytes", () => {
  for (const [name, moving] of [
    ["gif2", true],
    ["gif1", false],
    ["apng", true],
    ["png", false],
    ["webp2", true],
    ["webp1", false],
  ]) {
    const bytes = bytesOf(name);
    const { type } = sniffImage(bytes);
    assert.equal(isAnimated(bytes, type), moving, name);
  }
  // A cut-off file never throws.
  const cut = bytesOf("gif2").subarray(0, 40);
  assert.equal(isAnimated(cut, "gif"), false);
});

test("F8: a still slot refuses a moving picture; the moving slot keeps it", async () => {
  const backend = memory();
  const store = new ArtStore(backend);
  for (const name of ["gif2", "apng", "webp2"])
    await assert.rejects(
      store.add(bytesOf(name), { still: true }),
      /صورة متحركة/,
      name,
    );
  assert.equal(backend.files.size, 0, "nothing kept after a refusal");
  const still = await store.add(bytesOf("gif1"), { still: true });
  assert.match(still.ref, /^local:[a-f\d]{32}$/);
  assert.equal(still.animated, false);
  const moving = await store.add(bytesOf("gif2"), { still: false });
  assert.equal(moving.animated, true);
});

test("F8: the pickers say which slot they fill", () => {
  const collections = read("src/components/Collections.jsx");
  assert.match(
    collections,
    /call\("collectionArtPick", \{ slot, profileId \}\)/,
  );
  assert.match(collections, /value=\{folder\.gif\}[\s\S]{0,80}slot="moving"/);
  for (const file of ["electron/main.mjs", "web/bridge.js"]) {
    const source = read(file);
    assert.match(source, /still: a\?\.slot !== "moving"/, file);
    assert.match(source, /client\.notePickedArt\(ref\)/, file);
    assert.match(source, /if \(!client\.canReadArt\(ref\)\) return "";/, file);
  }
});

test("F8: every still slot draws through StillImage; the folder page uses its backdrop and logo", () => {
  const art = read("src/components/CollectionArt.jsx");
  assert.match(art, /<StillImage\s+className="art-still"/);
  assert.match(art, /<StillImage\s+className="folder-logo"/);
  const collections = read("src/components/Collections.jsx");
  assert.doesNotMatch(collections, /backgroundImage/);
  assert.match(collections, /<StillImage\s+className="collection-hero-art"/);
  assert.match(collections, /<StillImage\s+className="collection-logo"/);
  const page = read("src/components/FolderPage.jsx");
  assert.doesNotMatch(page, /backgroundImage/);
  assert.match(page, /useArt\(folder\.backdrop \|\| folder\.cover \|\| ""\)/);
  assert.match(page, /useArt\(folder\.logo \|\| ""\)/);
  assert.match(page, /className="folder-hero-logo"/);
});

test("Ownership: a profile reads only the pictures its collections name", () => {
  const c = new Client({ load: () => ({}), save: () => {} });
  const a = c.profiles.store.active;
  const mine = `local:${"a".repeat(32)}`;
  const theirs = `local:${"b".repeat(32)}`;
  c.state.collections = cleanCollections([
    { id: "c", title: "C", cover: mine, folders: [] },
  ]);
  c.profiles.create({ name: "B" });
  const b = c.profiles.store.list.find((p) => p.id !== a).id;
  c.profiles.switch({ id: b });
  c.state.collections = cleanCollections([
    { id: "d", title: "D", folders: [{ id: "f", title: "F", gif: theirs }] },
  ]);
  assert.equal(c.canReadArt(theirs), true);
  assert.equal(c.canReadArt(mine), false, "A's picture, unknown to B");
  c.profiles.switch({ id: a });
  assert.equal(c.canReadArt(mine), true);
  assert.equal(c.canReadArt(theirs), false);
  // Just picked, not saved yet: readable by the profile that picked it.
  const fresh = `local:${"c".repeat(32)}`;
  c.notePickedArt(fresh);
  assert.equal(c.canReadArt(fresh), true);
  c.profiles.switch({ id: b });
  assert.equal(c.canReadArt(fresh), false);
  assert.equal(c.canReadArt("local:../../x"), false);
  assert.equal(c.canReadArt(`${"a".repeat(32)}`), false);
});

test("Sweep: a reference that appears while the sweep runs keeps its picture", async () => {
  let now = 0;
  const backend = memory();
  const store = new ArtStore(backend, { now: () => now });
  const one = await store.add(bytesOf("png"));
  const two = await store.add(bytesOf("png"));
  for (const f of backend.files.values()) f.at = 0;
  now = ART_GRACE_MS + 1;
  const refs = new Set();
  const id = (ref) => ref.slice(6);
  // The store answers slowly; a restore names `one` meanwhile.
  const list = backend.list;
  backend.list = async () => {
    const out = await list();
    refs.add(id(one.ref));
    return out;
  };
  const removed = await store.sweep(() => refs);
  assert.equal(removed, 1);
  assert.ok(backend.files.has(id(one.ref)), "re-linked: kept");
  assert.ok(!backend.files.has(id(two.ref)));
  // Within the grace period nothing goes.
  const three = await store.add(bytesOf("png"));
  backend.files.get(id(three.ref)).at = now;
  assert.equal(await store.sweep(new Set([id(one.ref)])), 0);
  assert.ok(backend.files.has(id(three.ref)));
});

test("Store on disk: links and folders under a picture's name are never read, listed or followed", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "riwaq-art-"));
  const outside = mkdtempSync(join(tmpdir(), "riwaq-outside-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
  const store = fileArtStore(dir);
  const { ref } = await store.add(bytesOf("png"));
  assert.ok(await store.read(ref));
  const secret = join(outside, "secret.png");
  writeFileSync(secret, bytesOf("png"));
  const linked = `${"d".repeat(32)}`;
  try {
    symlinkSync(secret, join(dir, `${linked}.png`));
  } catch (e) {
    // Windows without the right to create links (Codex's EPERM): the
    // link cannot exist there, so there is nothing to refuse.
    if (e.code === "EPERM") return t.skip("no permission to create links");
    throw e;
  }
  assert.equal(await store.read(`local:${linked}`), null);
  const listed = (await store.backend.list()).map((f) => f.id);
  assert.ok(!listed.includes(linked));
  await assert.rejects(readArtFile(join(dir, `${linked}.png`), 1e6), /عادياً/);
  // A file larger than its limit is refused before it is read.
  await assert.rejects(readArtFile(secret, 10), /أكبر/);
});

test("Unsupported sources keep no credentials on their way into a backup", () => {
  const raw = plainCopy({
    provider: "simkl",
    listId: 42,
    title: "List",
    apiKey: "k",
    token: "t",
    key: "x",
    nested: {
      password: "p",
      feed: "https://host.example/list?api_key=1",
      login: "https://user:pw@host.example/",
      image: "https://img.example/a.png?w=300",
    },
  });
  assert.deepEqual(raw, {
    provider: "simkl",
    listId: 42,
    title: "List",
    nested: { image: "https://img.example/a.png?w=300" },
  });
});
