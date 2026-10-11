import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "../core/client.mjs";
import {
  newRecoveryCode,
  normalizeRecoveryCode,
  normalizeUsername,
  openData,
  sealData,
  serverUrl,
  unwrapKey,
  wrapKey,
} from "../core/account.mjs";
import { merge3 } from "../core/sync-merge.mjs";
import { collectBackup } from "../core/backup.mjs";
import { handle } from "../server/accounts/worker.mjs";
import { sqliteD1 } from "../server/accounts/local.mjs";

// Riwaq accounts (docs/ACCOUNTS.md): end-to-end encrypted sync between
// devices. The server here is the real Worker (server/accounts/worker.mjs)
// over Node's SQLite, called in-process.

function service() {
  const db = sqliteD1();
  const env = {
    DB: db,
    AUTH_PEPPER: "test-pepper-".repeat(4),
    ALLOWED_ORIGINS: "",
  };
  let now = Date.now();
  const request = async (url, init = {}) => {
    const response = await handle(new Request(url, init), env, { now });
    return {
      status: response.status,
      revision: response.headers.get("X-Riwaq-Revision"),
      text: await response.text(),
    };
  };
  return { db, request, later: (ms) => (now += ms) };
}
function device(server, load = {}) {
  let saved = load;
  const client = new Client({
    load: () => structuredClone(saved),
    save: (s) => {
      saved = structuredClone(s);
    },
    accountServer: "https://accounts.riwaq.test",
    accountRequest: server.request,
  });
  client.saved = () => saved;
  return client;
}
const film = (id, name) => ({ id, type: "movie", name });
const names = (client) => client.state.favorites.map((f) => f.name).sort();

test("three-way merge keeps both sides' additions and honours removals", () => {
  const base = { favorites: [film("tt1", "A"), film("tt2", "B")], volume: 50 };
  const local = { favorites: [film("tt1", "A"), film("tt3", "C")], volume: 50 };
  const remote = {
    favorites: [film("tt1", "A"), film("tt2", "B"), film("tt4", "D")],
    volume: 70,
  };
  const merged = merge3(base, local, remote);
  // B removed here stays removed; C and D both kept; the volume changed
  // only on the other device.
  assert.deepEqual(
    merged.favorites.map((f) => f.name),
    ["A", "C", "D"],
  );
  assert.equal(merged.volume, 70);
  // A real conflict takes the preferred side.
  assert.equal(merge3({ v: 1 }, { v: 2 }, { v: 3 }).v, 2);
  assert.equal(merge3({ v: 1 }, { v: 2 }, { v: 3 }, { prefer: "remote" }).v, 3);
  // Progress records are never mixed: the newer one wins whole.
  const p = merge3(
    { "movie:tt1": { position: 10, duration: 100, updated: 1 } },
    { "movie:tt1": { position: 40, duration: 100, updated: 5 } },
    { "movie:tt1": { position: 60, duration: 0, updated: 9 } },
  );
  assert.deepEqual(p["movie:tt1"], { position: 60, duration: 0, updated: 9 });
  // A key deleted on one side and untouched on the other is gone.
  assert.deepEqual(merge3({ a: 1, b: 2 }, { a: 1 }, { a: 1, b: 2 }), { a: 1 });
  // Without a common ancestor (signing in), lists are unions.
  assert.deepEqual(merge3(undefined, ["x", "y"], ["y", "z"]), ["x", "y", "z"]);
});

test("names, recovery codes and the sealed format", () => {
  assert.equal(normalizeUsername("  Abadi_07 "), "abadi_07");
  assert.throws(() => normalizeUsername("ab"));
  assert.throws(() => normalizeUsername("عبادي"));
  const code = newRecoveryCode();
  assert.match(code, /^([0-9A-HJKMNP-TV-Z]{4}-){5}[0-9A-HJKMNP-TV-Z]{4}$/);
  assert.equal(
    normalizeRecoveryCode(code.toLowerCase().replace(/-/g, " ")),
    code.replace(/-/g, ""),
  );
  assert.throws(() => normalizeRecoveryCode("ABCD"));
  const key = Buffer.alloc(32, 7);
  const wrap = Buffer.alloc(32, 9);
  const wrapped = wrapKey(wrap, key, "abadi", "password");
  assert.deepEqual(unwrapKey(wrap, wrapped, "abadi", "password"), key);
  // Bound to the user and the kind: moved anywhere else it does not open.
  assert.throws(() => unwrapKey(wrap, wrapped, "other", "password"));
  assert.throws(() => unwrapKey(wrap, wrapped, "abadi", "recovery"));
  const text = sealData(key, "abadi", {
    format: "riwaq-sync",
    version: 1,
    payload: { secret: "مكتبتي" },
  });
  assert.doesNotMatch(Buffer.from(text, "base64").toString("latin1"), /secret/);
  assert.equal(openData(key, "abadi", text).payload.secret, "مكتبتي");
  assert.throws(() => openData(Buffer.alloc(32, 1), "abadi", text));
  assert.throws(() => openData(key, "other", text));
  // Only HTTPS servers, or this machine for development.
  assert.equal(serverUrl("http://evil.example"), "");
  assert.equal(serverUrl("https://a.example/"), "https://a.example");
  assert.equal(serverUrl("http://127.0.0.1:8787"), "http://127.0.0.1:8787");
});

test("an account carries a viewer's data to a second device, end to end encrypted", async () => {
  const server = service();
  const pc = device(server);
  pc.favorite(film("tt0111161", "الخلاص من شاوشانك"));
  pc.settings({ seekStep: 30 });
  pc.dataHub.save({ id: "tmdb", key: "tmdb-secret-key" });
  const { recoveryCode, state } = await pc.account.signup({
    username: "Abadi",
    password: "correct horse battery",
  });
  assert.match(recoveryCode, /-/);
  assert.equal(state.account.signedIn, true);
  assert.equal(state.account.username, "abadi");
  // Never the session token or the data key.
  const kept = pc.state.account;
  assert.ok(kept.token && kept.key);
  for (const secret of [kept.token, kept.key])
    assert.ok(!JSON.stringify(state).includes(secret));

  // What the server holds is ciphertext and hashes, nothing readable.
  const stored = JSON.stringify([
    (await server.db.prepare("SELECT * FROM users").all()).results,
    (await server.db.prepare("SELECT * FROM chunks").all()).results,
  ]);
  for (const plain of [
    "شاوشانك",
    "tt0111161",
    "correct horse",
    "seekStep",
    "tmdb-secret",
  ])
    assert.ok(!stored.includes(plain), plain);

  const web = device(server);
  await assert.rejects(
    web.account.login({ username: "abadi", password: "wrong password!" }),
    /غير صحيحة/,
  );
  assert.equal(web.publicState().account.signedIn, false);
  await web.account.login({
    username: "ABADI",
    password: "correct horse battery",
  });
  assert.deepEqual(names(web), ["الخلاص من شاوشانك"]);
  assert.equal(web.state.settings.seekStep, 30);
  // Keys stay off the account unless the viewer turns that on.
  assert.equal(web.state.providers?.tmdb?.key, undefined);

  // A change on one device reaches the other.
  web.settings({ seekStep: 15 });
  await web.account.sync();
  await pc.account.sync();
  assert.equal(pc.state.settings.seekStep, 15);

  // Turning keys on for the account brings them across.
  await pc.account.configure({ secrets: true });
  await web.account.sync();
  assert.equal(web.state.providers.tmdb.key, "tmdb-secret-key");
  assert.equal(web.publicState().account.secrets, true);

  // The recovery code sets a new password; other devices are signed out
  // and keep their data.
  const phone = device(server);
  await phone.account.recover({
    username: "abadi",
    code: recoveryCode,
    password: "a brand new password",
  });
  assert.deepEqual(names(phone), ["الخلاص من شاوشانك"]);
  await assert.rejects(pc.account.sync(), /انتهت جلستك/);
  assert.equal(pc.publicState().account.signedIn, false);
  assert.deepEqual(names(pc), ["الخلاص من شاوشانك"]);
  await assert.rejects(
    device(server).account.login({
      username: "abadi",
      password: "correct horse battery",
    }),
  );
  await assert.rejects(
    phone.account.changePassword({
      password: "not it at all",
      newPassword: "another one here",
    }),
    /الحالية غير صحيحة/,
  );
  assert.equal(phone.publicState().account.signedIn, true);

  // Deleting the account removes it from the server.
  await phone.account.deleteAccount({ password: "a brand new password" });
  assert.equal(phone.publicState().account.signedIn, false);
  await assert.rejects(
    device(server).account.login({
      username: "abadi",
      password: "a brand new password",
    }),
  );
  assert.equal(
    (await server.db.prepare("SELECT count(*) n FROM chunks").first()).n,
    0,
  );
});

test("two devices changing at once both keep their changes", async () => {
  const server = service();
  const a = device(server);
  await a.account.signup({ username: "family", password: "shared password 1" });
  const b = device(server);
  await b.account.login({ username: "family", password: "shared password 1" });
  a.favorite(film("tt1", "من الحاسوب"));
  b.favorite(film("tt2", "من الجوال"));
  a.recordProgress(film("tt9", "فيلم"), "tt9", 100, 1000);
  server.later(5);
  b.recordProgress(film("tt9", "فيلم"), "tt9", 400, 1000);
  await a.account.sync();
  // b's base is now behind: its upload conflicts, it merges and retries.
  await b.account.sync();
  await a.account.sync();
  for (const device of [a, b]) {
    assert.deepEqual(names(device), ["من الجوال", "من الحاسوب"]);
    assert.equal(device.state.progress["movie:tt9"].position, 400);
  }
  // A removal on one device is not undone by the other.
  a.favorite(film("tt2", "من الجوال"));
  await a.account.sync();
  await b.account.sync();
  assert.deepEqual(names(b), ["من الحاسوب"]);
});

test("account actions respect the Settings lock, and backups never carry the account", async () => {
  const server = service();
  const pc = device(server);
  await assert.rejects(
    pc.account.signup({ username: "abadi", password: "short" }),
    /10 أحرف/,
  );
  await pc.account.signup({ username: "abadi", password: "long enough pass" });
  await assert.rejects(
    device(server).account.signup({
      username: "abadi",
      password: "long enough pass",
    }),
    /مأخوذ/,
  );
  const { payload } = collectBackup(pc.state, { includeSecrets: true });
  assert.ok(!("account" in payload));
  assert.doesNotMatch(JSON.stringify(payload), /riwaq-account|"token"/);
  // A locked Settings room locks the account too.
  const kid = device(server);
  const id = kid.profiles.store.active;
  kid.profiles.setPin({ id, pin: "1234" });
  kid.profiles.update({ id, pin: "1234", lockedRooms: ["settings"] });
  kid.profiles.lock();
  await assert.rejects(
    kid.account.login({ username: "abadi", password: "long enough pass" }),
  );
  assert.equal(kid.publicState().account.signedIn, false);
});

test("without a configured server the account stays off and sends nothing", async () => {
  let sent = 0;
  const client = new Client({
    load: () => ({}),
    save: () => {},
    accountServer: "",
    accountRequest: async () => {
      sent++;
      return { status: 500, text: "" };
    },
  });
  assert.equal(client.publicState().account.available, false);
  await assert.rejects(
    client.account.signup({ username: "abadi", password: "long enough pass" }),
    /غير متاحة/,
  );
  assert.equal(sent, 0);
});
