// Codex's fourth review of PR #155 (Q10, docs/REVIEW-PR-155.md, "Fifth
// pass"), from the source: AccountHub.attempt bound a delayed sign-in to
// the active profile's ID and its own counter, not to the activation the
// sign-in started under, so A → B → A, a re-lock or a restore during the
// wait still signed the device in; and a Nuvio import checked its
// activation before and after its addon loop, never between addons, so a
// stale import went on starting installations. Real Client, the real
// account service over SQLite for the sign-ins, and a held addon request.
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Client, PROFILE_CHANGED } from "../core/client.mjs";
import { handle } from "../server/accounts/service.mjs";
import { sqliteD1 } from "../server/accounts/local.mjs";

const CHANGED = /تغيّرت جلسة الحساب/;

/** The account service with requests that can be held at a path. */
function service() {
  const env = {
    DB: sqliteD1(":memory:"),
    AUTH_PEPPER: randomBytes(32).toString("hex"),
  };
  const held = new Map();
  const hold = (path) => {
    const slot = Promise.withResolvers();
    slot.reached = Promise.withResolvers();
    held.set(path, slot);
    return slot;
  };
  const accountRequest = async (url, init) => {
    const response = await handle(new Request(url, init), env);
    const answer = {
      status: response.status,
      revision: response.headers.get("X-Riwaq-Revision"),
      text: await response.text(),
    };
    // Held after the server answered: the reply lands late.
    const slot = held.get(new URL(url).pathname);
    if (slot) {
      held.delete(new URL(url).pathname);
      slot.reached.resolve();
      await slot.promise;
    }
    return answer;
  };
  return {
    hold,
    options: { accountServer: "https://accounts.example.test", accountRequest },
  };
}
const credentials = () => ({
  username: "fixture-" + randomBytes(5).toString("hex"),
  password: randomBytes(24).toString("base64url"),
});
async function existing(svc) {
  const login = credentials();
  const maker = new Client({
    load: () => ({}),
    save: () => {},
    ...svc.options,
  });
  const { recoveryCode } = await maker.account.signup(login);
  return { login, recoveryCode };
}
function device(svc) {
  const c = new Client({ load: () => ({}), save: () => {}, ...svc.options });
  const a = c.profiles.store.active;
  c.profiles.create({ name: "Profile B" });
  const b = c.profiles.store.list.find((p) => p.id !== a).id;
  return { c, a, b };
}

test("Q10: a sign-in whose reply lands after A → B → A signs nothing in", async () => {
  const svc = service();
  const { login } = await existing(svc);
  const { c, a, b } = device(svc);
  const slot = svc.hold("/v1/login");
  const pending = c.account.login(login);
  await slot.reached.promise;
  c.profiles.switch({ id: b });
  c.profiles.switch({ id: a });
  slot.resolve();
  await assert.rejects(pending, CHANGED);
  assert.equal(c.account.bag, null, "this device is not signed in");
  // The same sign-in, started now, works.
  await c.account.login(login);
  assert.equal(c.account.bag.username, login.username);
});

test("Q10: a sign-in across a re-lock (unlocked again) or a restore signs nothing in", async () => {
  const svc = service();
  const { login } = await existing(svc);
  const { c, a } = device(svc);
  c.profiles.setPin({ id: a, pin: "2468" });
  assert.equal(c.profiles.unlocked, true);
  let slot = svc.hold("/v1/login");
  let pending = c.account.login(login);
  await slot.reached.promise;
  c.profiles.lock();
  c.profiles.unlock("2468");
  slot.resolve();
  await assert.rejects(pending, CHANGED);
  assert.equal(c.account.bag, null);
  // A restore replaces every profile: work started before belongs to none.
  const { text } = c.exportBackup({ passphrase: "fixture passphrase 3" });
  slot = svc.hold("/v1/login");
  pending = c.account.login(login);
  await slot.reached.promise;
  c.restoreBackup({ text, passphrase: "fixture passphrase 3" });
  c.profiles.unlock("2468");
  slot.resolve();
  await assert.rejects(pending, CHANGED);
  assert.equal(c.account.bag, null);
});

test("Q10: a late reply of an older sign-in never replaces a newer one", async () => {
  const svc = service();
  const first = await existing(svc);
  const second = await existing(svc);
  const { c } = device(svc);
  const slot = svc.hold("/v1/login");
  const older = c.account.login(first.login);
  await slot.reached.promise;
  await c.account.login(second.login);
  const token = c.account.bag.token;
  slot.resolve();
  await assert.rejects(older, CHANGED);
  assert.equal(c.account.bag.username, second.login.username);
  assert.equal(c.account.bag.token, token);
});

test("Q10: a recovery whose last reply lands after A → B → A signs nothing in", async () => {
  const svc = service();
  const { login, recoveryCode } = await existing(svc);
  const { c, a, b } = device(svc);
  const slot = svc.hold("/v1/recover/finish");
  const pending = c.account.recover({
    username: login.username,
    code: recoveryCode,
    password: "a new fixture password",
  });
  await slot.reached.promise;
  c.profiles.switch({ id: b });
  c.profiles.switch({ id: a });
  slot.resolve();
  await assert.rejects(pending, CHANGED);
  assert.equal(c.account.bag, null);
  // The server took the new password; signing in with it, now, works.
  await c.account.login({
    username: login.username,
    password: "a new fixture password",
  });
  assert.equal(c.account.bag.username, login.username);
});

/* The Nuvio import's addon loop. */

const manifest = (n) => ({
  id: `org.fixture.addon${n}`,
  name: `Fixture addon ${n}`,
  version: "1.0.0",
  resources: ["catalog"],
  types: ["movie"],
  catalogs: [{ id: `c${n}`, type: "movie" }],
});
const stores = (count) => ({
  nuvio_addons: {
    installed_addon_urls_1: JSON.stringify(
      Array.from(
        { length: count },
        (_, i) => `https://addon${i + 1}.example.invalid/manifest.json`,
      ),
    ),
  },
  nuvio_collections: {
    collections_1: JSON.stringify([{ title: "Import fixture" }]),
  },
});
/** A client whose addon requests answer at once, or wait for `release`. */
function addonClient() {
  const asked = [];
  let gate = null;
  const c = new Client({
    load: () => ({}),
    save: () => {},
    request: async (url) => {
      const n = Number(/addon(\d+)\./.exec(String(url))?.[1]);
      asked.push(n);
      if (gate && gate.n === n) {
        const g = gate;
        gate = null;
        g.reached.resolve();
        await g.promise;
      }
      return manifest(n);
    },
  });
  const holdAddon = (n) => {
    gate = Promise.withResolvers();
    gate.n = n;
    gate.reached = Promise.withResolvers();
    return gate;
  };
  return { c, asked, holdAddon };
}

test("Q10: a Nuvio import whose activation ends after its first addon starts no other", async () => {
  const { c, asked, holdAddon } = addonClient();
  const a = c.profiles.store.active;
  c.profiles.create({ name: "B" });
  const b = c.profiles.store.list.find((p) => p.id !== a).id;
  const before = structuredClone(c.state.collections);
  const first = holdAddon(1);
  const run = c.importNuvio(stores(3), {
    profile: 1,
    parts: { addons: true, collections: true },
  });
  await first.reached.promise;
  c.profiles.switch({ id: b });
  c.profiles.switch({ id: a });
  first.resolve();
  await assert.rejects(run, (error) => {
    assert.ok(error.message.startsWith(PROFILE_CHANGED));
    // The addon already being installed stays, and is reported.
    assert.equal(error.installedAddons, 1);
    return true;
  });
  assert.deepEqual(asked, [1], "addons 2 and 3 were never asked for");
  assert.ok(
    c.state.addons.some((x) => x.manifest?.id === "org.fixture.addon1"),
  );
  assert.equal(
    c.state.addons.some((x) => /addon[23]/.test(x.manifest?.id || "")),
    false,
  );
  assert.deepEqual(c.state.collections, before, "no profile part was written");
});

test("Q10: a Nuvio import across a re-lock stops before its next addon; a live import installs them all", async () => {
  const { c, asked, holdAddon } = addonClient();
  const a = c.profiles.store.active;
  c.profiles.setPin({ id: a, pin: "1357" });
  const first = holdAddon(1);
  const run = c.importNuvio(stores(2), {
    profile: 1,
    parts: { addons: true },
  });
  await first.reached.promise;
  c.profiles.lock();
  c.profiles.unlock("1357");
  first.resolve();
  await assert.rejects(run, (error) => error.installedAddons === 1);
  assert.deepEqual(asked, [1]);
  // Started now, under this activation: the rest installs, nothing twice.
  const { result } = await c.importNuvio(stores(3), {
    profile: 1,
    parts: { addons: true, collections: true },
  });
  assert.equal(result.addons, 2);
  assert.deepEqual(asked, [1, 2, 3]);
  assert.equal(result.collections, 1);
});
