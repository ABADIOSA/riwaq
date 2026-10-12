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

// Delay an actual service reply, rather than mocking account state. This models
// a slow connection while another account action or playback happens locally.
function holdReply(server, matches) {
  const ready = Promise.withResolvers();
  const resume = Promise.withResolvers();
  let held = false;
  return {
    ready: ready.promise,
    release: () => resume.resolve(),
    request: async (url, init) => {
      const hold = !held && matches(new URL(url).pathname, init);
      if (hold) held = true;
      const reply = await server.request(url, init);
      if (hold) {
        ready.resolve();
        await resume.promise;
      }
      return reply;
    },
  };
}

const credentials = { username: "viewer", password: "long enough password" };

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

test("sign-out cancels a pending sign-in before its reply arrives", async () => {
  const server = service();
  await device(server).account.signup(credentials);
  const pc = device(server);
  const held = holdReply(server, (path) => path === "/v1/login");
  pc.account.request = held.request;
  const login = pc.account.login(credentials);
  const rejected = assert.rejects(login, /تغيّرت جلسة/);
  await held.ready;
  await pc.account.logout();
  held.release();
  await rejected;
  assert.equal(pc.account.publicState().signedIn, false);
});

test("a late sign-in cannot replace a newer account", async () => {
  const server = service();
  await device(server).account.signup(credentials);
  const other = { ...credentials, username: "other" };
  await device(server).account.signup(other);
  const pc = device(server);
  const held = holdReply(server, (path) => path === "/v1/login");
  pc.account.request = held.request;
  const rejected = assert.rejects(pc.account.login(credentials), /تغيّرت جلسة/);
  await held.ready;
  await pc.account.login(other);
  held.release();
  await rejected;
  assert.equal(pc.account.publicState().username, "other");
  await pc.account.sync();
});

test("a pending sign-in must still own an unlocked Settings room", async () => {
  const server = service();
  await device(server).account.signup(credentials);
  const pc = device(server);
  const id = pc.profiles.store.active;
  pc.profiles.setPin({ id, pin: "1234" });
  pc.profiles.update({ id, pin: "1234", lockedRooms: ["settings"] });
  const held = holdReply(server, (path) => path === "/v1/login");
  pc.account.request = held.request;
  const rejected = assert.rejects(pc.account.login(credentials));
  await held.ready;
  pc.profiles.lock();
  held.release();
  await rejected;
  assert.equal(pc.account.publicState().signedIn, false);
});

test("a slow logout takes effect locally and cannot end a replacement session", async () => {
  const server = service();
  const pc = device(server);
  await pc.account.signup(credentials);
  const held = holdReply(server, (path) => path === "/v1/logout");
  pc.account.request = held.request;
  const logout = pc.account.logout();
  assert.equal(pc.account.publicState().signedIn, false);
  await held.ready;
  await pc.account.login(credentials);
  const token = pc.state.account.token;
  held.release();
  await logout;
  assert.equal(pc.state.account.token, token);
  await pc.account.sync();
});

test("an old sync finishing cannot clear the new session's running sync", async () => {
  const server = service();
  const pc = device(server);
  await pc.account.signup(credentials);
  const old = holdReply(
    server,
    (path, init) => path === "/v1/data" && init.method === "GET",
  );
  pc.account.request = old.request;
  const oldSync = pc.account.sync();
  await old.ready;
  await pc.account.logout();
  const fresh = holdReply(
    server,
    (path, init) => path === "/v1/data" && init.method === "GET",
  );
  pc.account.request = fresh.request;
  const login = pc.account.login(credentials);
  await fresh.ready;
  const newSync = pc.account.running;
  old.release();
  await oldSync;
  assert.equal(pc.account.running, newSync);
  assert.equal(pc.account.publicState().syncing, true);
  fresh.release();
  await login;
  assert.equal(pc.account.publicState().syncing, false);
});

test("a revoked old session cannot sign out or report errors on the new one", async () => {
  const server = service();
  const pc = device(server);
  await pc.account.signup(credentials);
  const oldBag = pc.account.bag;
  await server.request("https://accounts.riwaq.test/v1/logout", {
    method: "POST",
    headers: { Authorization: `Bearer ${oldBag.token}` },
  });
  const held = holdReply(server, (path) => path === "/v1/data");
  pc.account.request = held.request;
  const oldSync = pc.account.sync();
  await held.ready;
  pc.account.request = server.request;
  await pc.account.login(credentials);
  held.release();
  await oldSync;
  assert.equal(pc.account.publicState().signedIn, true);
  assert.equal(pc.account.publicState().error, "");
  const expired = Object.assign(new Error("expired"), {
    code: "unauthorized",
    status: 401,
  });
  await assert.rejects(
    pc.account.proving(() => Promise.reject(expired), oldBag),
  );
  assert.equal(pc.account.publicState().signedIn, true);
});

test("the secrets choice syncs even when the viewer has no keys", async () => {
  const server = service();
  const pc = device(server);
  await pc.account.signup(credentials);
  const web = device(server);
  await web.account.login(credentials);
  for (const secrets of [true, false]) {
    await pc.account.configure({ secrets });
    await web.account.sync();
    assert.equal(web.account.publicState().secrets, secrets);
  }
});

test("changing the secrets choice during an upload schedules the final choice", async () => {
  const server = service();
  const pc = device(server);
  await pc.account.signup(credentials);
  const web = device(server);
  await web.account.login(credentials);
  const held = holdReply(
    server,
    (path, init) => path === "/v1/data" && init.method === "PUT",
  );
  pc.account.request = held.request;
  const first = pc.account.configure({ secrets: true });
  await held.ready;
  const last = pc.account.configure({ secrets: false });
  held.release();
  await Promise.all([first, last]);
  await web.account.sync();
  assert.equal(web.account.publicState().secrets, false);
  assert.equal(pc.account.bag.secretsChanged, false);
});

test("remote changes wait for the native video process, then merge both devices", async () => {
  const server = service();
  const pc = device(server);
  await pc.account.signup(credentials);
  const web = device(server);
  await web.account.login(credentials);
  web.settings({ seekStep: 30 });
  web.favorite(film("tt1", "من الجهاز الآخر"));
  await web.account.sync();
  const before = pc.state.settings.seekStep;
  const revision = pc.account.bag.revision;
  let child = true;
  pc.account.playbackActive = () => !!pc.account.watching || child;
  pc.account.playbackChanged(true);
  pc.favorite(film("tt2", "أثناء المشاهدة"));
  await pc.account.sync();
  assert.equal(pc.account.publicState().deferred, true);
  assert.equal(pc.state.settings.seekStep, before);
  assert.equal(pc.account.bag.revision, revision);
  assert.deepEqual(names(pc), ["أثناء المشاهدة"]);
  pc.account.playbackChanged(false);
  assert.equal(pc.account.running, null); // MPV still exiting.
  child = false;
  pc.account.playbackChanged(false);
  await pc.account.running;
  assert.equal(pc.account.publicState().deferred, false);
  assert.equal(pc.state.settings.seekStep, 30);
  assert.deepEqual(names(pc), ["أثناء المشاهدة", "من الجهاز الآخر"]);
  await web.account.sync();
  assert.deepEqual(names(web), names(pc));
});

test("a deferred first sign-in keeps remote conflict priority", async () => {
  const server = service();
  const web = device(server);
  web.settings({ seekStep: 30 });
  await web.account.signup(credentials);
  const pc = device(server);
  pc.settings({ seekStep: 15 });
  pc.account.playbackChanged(true);
  await pc.account.login(credentials);
  assert.equal(pc.account.publicState().deferred, true);
  assert.equal(pc.state.settings.seekStep, 15);
  pc.account.playbackChanged(false);
  await pc.account.running;
  assert.equal(pc.state.settings.seekStep, 30);
  await web.account.sync();
  assert.equal(web.state.settings.seekStep, 30);
});

test("sign-out during the first sync never returns a stale sign-in success", async () => {
  const server = service();
  await device(server).account.signup(credentials);
  const pc = device(server);
  const held = holdReply(server, (path) => path === "/v1/data");
  pc.account.request = held.request;
  const rejected = assert.rejects(pc.account.login(credentials), /تغيّرت جلسة/);
  await held.ready;
  let notified = false;
  pc.account.onChange = () => {
    if (!pc.account.publicState().signedIn) notified = true;
  };
  await pc.account.logout();
  assert.equal(notified, true);
  held.release();
  await rejected;
  assert.equal(pc.account.publicState().signedIn, false);
});

test("a failed deferred sync waits for the normal retry instead of spinning", async () => {
  const server = service();
  const pc = device(server);
  await pc.account.signup(credentials);
  const web = device(server);
  await web.account.login(credentials);
  web.settings({ seekStep: 30 });
  await web.account.sync();
  pc.account.playbackChanged(true);
  await pc.account.sync();
  let requests = 0;
  pc.account.request = async () => {
    requests++;
    return { status: 503, text: "" };
  };
  pc.account.playbackChanged(false);
  await assert.rejects(pc.account.running);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests, 1);
  assert.equal(pc.account.publicState().deferred, true);
  assert.ok(pc.account.publicState().error);
  pc.account.request = server.request;
  await pc.account.sync();
  assert.equal(pc.account.publicState().deferred, false);
  assert.equal(pc.state.settings.seekStep, 30);
});

test("a remote PIN change cannot lock the viewing or move its progress mid-video", async () => {
  const server = service();
  const pc = device(server);
  await pc.account.signup(credentials);
  const web = device(server);
  await web.account.login(credentials);
  const id = pc.profiles.store.active;
  const unlocked = pc.profiles.unlocked;
  web.profiles.setPin({ id, pin: "1234" });
  web.profiles.update({ id, pin: "1234", lockedRooms: ["library"] });
  await web.account.sync();
  pc.account.playbackChanged(true);
  pc.recordProgress(film("tt9", "المشاهدة الحالية"), "tt9", 120, 1000);
  await pc.account.sync();
  assert.equal(pc.profiles.active().pin, undefined);
  assert.equal(pc.profiles.store.active, id);
  assert.equal(pc.profiles.unlocked, unlocked);
  pc.recordProgress(film("tt9", "المشاهدة الحالية"), "tt9", 240, 1000);
  pc.account.playbackChanged(false);
  await pc.account.running;
  assert.ok(pc.profiles.active().pin);
  assert.equal(pc.profiles.store.active, id);
  assert.equal(pc.profiles.unlocked, false);
  assert.equal(pc.state.progress["movie:tt9"].position, 240);
  await web.account.sync();
  assert.equal(web.profiles.store.data[id].progress["movie:tt9"].position, 240);
});

test("a completed sync returns an idle snapshot to the interface", async () => {
  const server = service();
  const pc = device(server);
  await pc.account.signup(credentials);
  const result = await pc.account.sync();
  assert.equal(result.account.syncing, false);
  assert.equal(pc.account.publicState().syncing, false);
});
