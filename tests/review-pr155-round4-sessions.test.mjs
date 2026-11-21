// Codex's third review of PR #155, N12 (and the F2 remainder): work that
// awaits must belong to the activation that started it, from its first
// step, and be refused at every later one when that activation ended,
// even when the same profile is active again (A → B → A), re-locked, or
// had its data replaced by a backup restore or an account sync.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, PROFILE_CHANGED } from "../core/client.mjs";
import { fileArtStore } from "../electron/collection-art.mjs";
import { collectBackup } from "../core/backup.mjs";

const client = (options = {}) =>
  new Client({ load: () => ({}), save: () => {}, ...options });
const twoProfiles = (c) => {
  const a = c.profiles.store.active;
  c.profiles.create({ name: "B" });
  const b = c.profiles.store.list.find((p) => p.id !== a).id;
  return { a, b };
};

test("N12: the interface's strict claim refuses a missing session and a profile ID alone", () => {
  const c = client();
  const { a, b } = twoProfiles(c);
  const session = c.profiles.session();
  assert.throws(() => c.claimSession({}), { message: PROFILE_CHANGED });
  assert.throws(() => c.claimSession({ profileId: a }), {
    message: PROFILE_CHANGED,
  });
  assert.ok(c.claimSession({ profileSession: session }));
  c.profiles.switch({ id: b });
  c.profiles.switch({ id: a });
  // The same profile again, a new activation: the old session is refused.
  assert.throws(() => c.claimSession({ profileSession: session }), {
    message: PROFILE_CHANGED,
  });
  // The legacy claim still lets a profile ID alone through (synchronous
  // core callers); the interface's calls never take that path.
  assert.ok(c.claim({ profileId: a }));
});

test("N12: a Nuvio preview read under A, imported after A → B → A, installs nothing and writes nothing", async () => {
  let asked = 0;
  const c = client({
    request: async () => {
      asked++;
      return {
        id: "x",
        name: "x",
        version: "1",
        resources: ["catalog"],
        types: ["movie"],
        catalogs: [],
      };
    },
  });
  const { a, b } = twoProfiles(c);
  const preview = c.profiles.ticket();
  c.profiles.switch({ id: b });
  c.profiles.switch({ id: a });
  const addons = c.state.addons.length;
  await assert.rejects(
    c.importNuvio(
      {
        nuvio_addons: {
          installed_addon_urls_1: JSON.stringify([
            "https://one.example.invalid/manifest.json",
          ]),
        },
        nuvio_collections: {
          collections_1: JSON.stringify([{ title: "Imported" }]),
        },
      },
      {
        profile: 1,
        parts: { addons: true, collections: true },
        ticket: preview,
      },
    ),
    { message: PROFILE_CHANGED },
  );
  assert.equal(asked, 0, "no addon was asked for");
  assert.equal(c.state.addons.length, addons);
  assert.deepEqual(c.state.collections, []);
});

test("N12: a Nuvio preview read under a locked-then-unlocked activation is refused", async () => {
  const c = client();
  c.profiles.setPin({ id: c.profiles.store.active, pin: "1234" });
  c.profiles.unlock("1234");
  const preview = c.profiles.ticket();
  c.profiles.lock();
  c.profiles.unlock("1234");
  await assert.rejects(
    c.importNuvio({}, { profile: 1, parts: {}, ticket: preview }),
    { message: PROFILE_CHANGED },
  );
});

test("N12: an account sync that replaces the profile's data ends the activation, even with the same profile and PIN", () => {
  const c = client();
  const before = c.profiles.session();
  const ticket = c.profiles.ticket();
  c.profiles.capture();
  const { payload } = collectBackup(c.state, { includeSecrets: false });
  c.account.apply(payload);
  assert.notEqual(c.profiles.session(), before);
  assert.equal(c.profiles.holds(ticket), false);
  assert.throws(() => c.holds(ticket), { message: PROFILE_CHANGED });
});

test("N12: a backup restore ends the activation, so a pending badge style or picture pick cannot land on it", async () => {
  let release;
  const c = client();
  const session = c.profiles.session();
  const passphrase = "a long enough passphrase 1234";
  const { text } = c.exportBackup({ passphrase });
  const pending = c.applyBadgeStyle(
    { look: "fr-glass", profileSession: session },
    () =>
      new Promise((r) => {
        release = r;
      }),
  );
  c.restoreBackup({ text, passphrase });
  release("[]");
  await assert.rejects(pending, { message: PROFILE_CHANGED });
});

test("N12: the desktop's pictures folder replaced by a link is never read, listed, written or swept", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "riwaq-art-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const elsewhere = join(root, "elsewhere");
  await mkdir(elsewhere);
  const id = "c".repeat(32);
  await writeFile(join(elsewhere, `${id}.png`), Buffer.from([0x89, 0x50]));
  const linked = join(root, "collection-art");
  try {
    await symlink(elsewhere, linked, "dir");
  } catch (error) {
    t.skip(`no directory links here (${error.code})`);
    return;
  }
  const store = fileArtStore(linked);
  assert.equal(await store.read(`local:${id}`), null);
  assert.deepEqual(await store.backend.list(), []);
  assert.equal(await store.backend.remove(id), false);
  await assert.rejects(
    store.add(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==",
        "base64",
      ),
    ),
    /ليس مجلداً عادياً/,
  );
  assert.equal(await store.sweep(new Set()), 0);
});
