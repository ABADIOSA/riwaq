// Codex's fourth review of PR #155 (docs/REVIEW-PR-155.md, "Fifth pass"):
// Q6 (a profile removal the store refused was reported as failed, stayed
// gone from memory and was written by the next, unrelated save) and Q7
// (account sync read the live state while a commit's write was still out,
// so a change the device then undid reached the account and the other
// device). These run the real Client over core/durable.mjs with a store
// that answers later and can be told to refuse, as IndexedDB does, the
// desktop's synchronous store that throws, and, for Q7, the real account
// service (server/accounts/service.mjs over Node's SQLite) with two devices.
// scripts/test-web-durability.mjs runs Q6 in Chromium against the real
// sealed vault.
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Client, STILL_SAVING } from "../core/client.mjs";
import { DurableWriter } from "../core/durable.mjs";
import { stateArt } from "../core/collection-art.mjs";
import { decryptBackup } from "../core/backup.mjs";
import { handle } from "../server/accounts/service.mjs";
import { sqliteD1 } from "../server/accounts/local.mjs";

const tick = () => new Promise((r) => setTimeout(r, 2));

/**
 * A store that commits later (the web's vault). `disk.fail` refuses that
 * many writes; `disk.hold()` keeps the next write out until released or
 * refused by hand.
 */
function asyncStore(initial = {}) {
  const disk = { text: JSON.stringify(initial), fail: 0, writes: 0, held: [] };
  let current = initial;
  disk.hold = () => {
    const slot = Promise.withResolvers();
    slot.started = Promise.withResolvers();
    disk.held.push(slot);
    return slot;
  };
  const writer = new DurableWriter({
    snapshot: () => ({
      text: JSON.stringify(current),
      meta: stateArt(current),
    }),
    write: async (text) => {
      await tick();
      const slot = disk.held.shift();
      if (slot) {
        slot.started.resolve();
        await slot.promise;
      }
      if (disk.fail > 0) {
        disk.fail--;
        throw null; // IndexedDB's manual abort: no error object at all.
      }
      disk.text = text;
      disk.writes++;
    },
    initialMeta: stateArt(initial),
  });
  const save = (data, undo) => {
    current = data;
    return writer.request(undo);
  };
  return {
    disk,
    writer,
    save,
    load: () => JSON.parse(disk.text),
    onDisk: () => JSON.parse(disk.text),
  };
}
function asyncClient(initial, options = {}) {
  const store = asyncStore(initial);
  const c = new Client({ load: store.load, save: store.save, ...options });
  return { c, ...store };
}
/** The desktop's store: writes at once and throws when it cannot. */
function desktopClient(initial = {}) {
  const disk = { text: JSON.stringify(initial), fail: 0 };
  const c = new Client({
    load: () => JSON.parse(disk.text),
    save: (data) => {
      if (disk.fail > 0) {
        disk.fail--;
        throw new Error("تشفير ويندوز غير متاح، تعذّر حفظ البيانات بأمان.");
      }
      disk.text = JSON.stringify(data);
    },
  });
  return { c, disk, onDisk: () => JSON.parse(disk.text) };
}
const ids = (state) => state.profiles.list.map((p) => p.id);
const names = (state) => state.profiles.list.map((p) => p.name);
const ART = "ab".repeat(16);

/** A: the default profile, B with a collection, a picture and a title. */
async function withB(made) {
  const { c } = made;
  const a = c.profiles.store.active;
  c.profiles.create({ name: "Profile B" });
  await c.durable();
  const b = c.profiles.store.list.find((p) => p.id !== a).id;
  c.profiles.switch({ id: b });
  await c.durable();
  c.collectionsEdit({ action: "create", title: "Only in B" });
  const collection = c.state.collections[0];
  c.collectionsEdit({
    action: "update",
    collectionId: collection.id,
    cover: `local:${ART}`,
  });
  c.favorite({ id: "tt0000001", type: "movie", name: "B's film" });
  await c.durable();
  c.profiles.switch({ id: a });
  await c.durable();
  return { a, b };
}
const bucketOf = (state, id) => state.profiles.data[id];

/* Q6: profile mutations. */

test("Q6: a refused removal of an inactive profile is undone, and no later save writes it", async () => {
  const made = asyncClient();
  const { c, disk, onDisk } = made;
  const { a, b } = await withB(made);
  disk.fail = 1;
  c.profiles.remove({ id: b });
  await assert.rejects(c.durable());
  // Memory, the reply and the disk agree: B and everything it holds.
  assert.deepEqual(ids(c.state), [a, b]);
  assert.equal(bucketOf(c.state, b).collections[0].title, "Only in B");
  assert.equal(bucketOf(c.state, b).favorites[0].id, "tt0000001");
  assert.ok(c.publicState().profiles.list.some((p) => p.id === b));
  // The unrelated save the reviewer made: B is still there afterwards.
  c.settings({ uiLanguage: "en" });
  await c.durable();
  const kept = onDisk();
  assert.deepEqual(ids(kept), [a, b]);
  assert.equal(bucketOf(kept, b).collections[0].title, "Only in B");
  assert.equal(kept.profiles.data[a].settings.uiLanguage, "en");
  // Its picture is still named, in memory and on disk, so no sweep may
  // delete it.
  assert.ok(stateArt(c.state).has(ART));
  assert.ok(stateArt(kept).has(ART));
  assert.ok(made.writer.metas().every((m) => m.has(ART)));
  // A reload reads the same.
  const reloaded = new Client({ load: made.load, save: () => {} });
  assert.deepEqual(ids(reloaded.state), [a, b]);
  // A backup carries B.
  const { text } = c.exportBackup({ passphrase: "fixture passphrase 1" });
  const { payload } = decryptBackup(text, "fixture passphrase 1");
  assert.deepEqual(
    payload.profiles.data[b].collections.map((x) => x.title),
    ["Only in B"],
  );
  // A retry that is written removes it for good.
  c.profiles.remove({ id: b });
  await c.durable();
  assert.deepEqual(ids(onDisk()), [a]);
  assert.equal(onDisk().profiles.data[b], undefined);
});

test("Q6: a refused removal of the active profile puts it back as a new, locked activation", async () => {
  const made = asyncClient();
  const { c, disk, onDisk } = made;
  const { a, b } = await withB(made);
  c.profiles.switch({ id: b });
  await c.durable();
  c.profiles.setPin({ id: b, pin: "4321" });
  await c.durable();
  assert.equal(c.profiles.unlocked, true, "setting a PIN unlocks the setter");
  const stale = c.profiles.ticket();
  disk.fail = 1;
  c.profiles.remove({ id: b }); // unlocked: no PIN asked
  assert.equal(c.profiles.store.active, a, "the removal moved to A at once");
  await assert.rejects(c.durable());
  assert.equal(c.profiles.store.active, b, "B is active again, as on disk");
  assert.equal(onDisk().profiles.active, b);
  assert.equal(c.profiles.unlocked, false, "but locked: nothing revived");
  assert.equal(c.profiles.holds(stale), false, "the old activation stays over");
  assert.equal(c.state.collections[0].title, "Only in B", "live state is B's");
  // A wrong PIN still refuses; the right one unlocks a fresh activation.
  assert.throws(() => c.profiles.unlock("0000"));
  c.profiles.unlock("4321");
  assert.notEqual(c.profiles.session(), `${stale.id}:${stale.epoch}`);
});

test("Q6: the desktop's synchronous refusal undoes a removal at once, local songs included", () => {
  const { c, disk, onDisk } = desktopClient();
  const a = c.profiles.store.active;
  c.profiles.create({ name: "Profile B" });
  const b = c.profiles.store.list.find((p) => p.id !== a).id;
  c.state.localMusic = { [b]: { tracks: [{ id: "x" }] } };
  c.persist();
  disk.fail = 1;
  assert.throws(() => c.profiles.remove({ id: b }), /تشفير ويندوز/);
  assert.deepEqual(ids(c.state), [a, b]);
  assert.deepEqual(c.state.localMusic[b], { tracks: [{ id: "x" }] });
  c.settings({ uiLanguage: "en" });
  assert.deepEqual(ids(onDisk()), [a, b]);
  assert.ok(onDisk().localMusic[b]);
  // Written: the songs go in the same write as the profile.
  c.profiles.remove({ id: b });
  assert.deepEqual(ids(onDisk()), [a]);
  assert.equal(onDisk().localMusic[b], undefined);
});

test("Q6: a wrong PIN or a locked profile refuses the removal before anything changes", async () => {
  const made = asyncClient();
  const { c, disk } = made;
  const { a, b } = await withB(made);
  c.profiles.setPin({ id: b, pin: "2468" });
  await c.durable();
  const writes = c.writes;
  assert.throws(() => c.profiles.remove({ id: b, pin: "1111" }), /رمز/);
  assert.throws(() => c.profiles.remove({ id: b }), /رمز/);
  assert.equal(c.writes, writes, "nothing was written");
  assert.deepEqual(ids(c.state), [a, b]);
  c.profiles.remove({ id: b, pin: "2468" });
  await c.durable();
  assert.deepEqual(ids(JSON.parse(disk.text)), [a]);
});

test("Q6: a removal and a settings write refused together are both undone; the next save writes neither", async () => {
  const made = asyncClient();
  const { c, disk, onDisk } = made;
  const { a, b } = await withB(made);
  disk.fail = 1;
  c.profiles.remove({ id: b });
  const removal = c.durable();
  c.settings({ uiLanguage: "en" });
  const language = c.durable();
  const outcomes = await Promise.allSettled([removal, language]);
  assert.deepEqual(
    outcomes.map((o) => o.status),
    ["rejected", "rejected"],
  );
  assert.deepEqual(ids(c.state), [a, b]);
  assert.notEqual(c.state.settings.uiLanguage, "en");
  c.favorite({ id: "tt0000002", type: "movie", name: "Later" });
  await c.durable();
  assert.deepEqual(ids(onDisk()), [a, b]);
  assert.notEqual(onDisk().profiles.data[a].settings.uiLanguage, "en");
});

test("Q6: refused create, update and PIN changes are undone in memory and never written later", async () => {
  const made = asyncClient();
  const { c, disk, onDisk } = made;
  const { a, b } = await withB(made);
  // Create.
  disk.fail = 1;
  c.profiles.create({ name: "Never kept" });
  await assert.rejects(c.durable());
  assert.deepEqual(names(c.state), ["المشاهد", "Profile B"]);
  // Update (name, rooms, adult filter).
  disk.fail = 1;
  c.profiles.update({ id: b, name: "Renamed", lockedRooms: ["live"] });
  await assert.rejects(c.durable());
  const entry = c.profiles.store.list.find((p) => p.id === b);
  assert.equal(entry.name, "Profile B");
  assert.equal(Object.hasOwn(entry, "lockedRooms"), false);
  // A new PIN on the active profile.
  disk.fail = 1;
  c.profiles.setPin({ id: a, pin: "1357" });
  await assert.rejects(c.durable());
  assert.equal(c.profiles.active().pin, undefined);
  // A PIN removed from a protected profile comes back, locked.
  c.profiles.setPin({ id: a, pin: "1357" });
  await c.durable();
  const before = c.profiles.ticket();
  disk.fail = 1;
  c.profiles.setPin({ id: a, pin: null, current: "1357" });
  assert.equal(c.profiles.unlocked, true);
  await assert.rejects(c.durable());
  assert.ok(c.profiles.active().pin, "the PIN that is kept is back");
  assert.equal(c.profiles.unlocked, false, "and it locks the profile");
  assert.equal(c.profiles.holds(before), false);
  // None of it rides on the next save.
  c.settings({ uiLanguage: "en" });
  await c.durable();
  const kept = onDisk();
  assert.deepEqual(names(kept), ["المشاهد", "Profile B"]);
  assert.equal(kept.profiles.list.find((p) => p.id === b).name, "Profile B");
  assert.ok(kept.profiles.list.find((p) => p.id === a).pin);
});

test("Q6: a refused switch returns to the previous profile as a new, locked activation", async () => {
  const made = asyncClient();
  const { c, disk, onDisk } = made;
  const { a, b } = await withB(made);
  c.profiles.setPin({ id: a, pin: "9753" });
  await c.durable();
  assert.equal(c.profiles.unlocked, true);
  const stale = c.profiles.ticket();
  disk.fail = 1;
  c.profiles.switch({ id: b });
  assert.equal(c.profiles.store.active, b);
  await assert.rejects(c.durable());
  assert.equal(c.profiles.store.active, a, "back on A, as on disk");
  assert.equal(onDisk().profiles.active, a);
  assert.equal(c.profiles.unlocked, false, "A's unlock ended with the switch");
  assert.equal(c.profiles.holds(stale), false);
  assert.equal(c.state.favorites.length, 0, "live state is A's again");
});

test("Q6: A→B→A with a removal pending: a refusal undoes all of it and revives no activation", async () => {
  const made = asyncClient();
  const { c, disk, onDisk } = made;
  const { a, b } = await withB(made);
  c.profiles.create({ name: "Profile C" });
  await c.durable();
  const cId = c.profiles.store.list.find((p) => ![a, b].includes(p.id)).id;
  const first = c.profiles.ticket();
  disk.fail = 1;
  c.profiles.remove({ id: cId });
  c.profiles.switch({ id: b });
  const mid = c.profiles.ticket();
  c.profiles.switch({ id: a });
  const last = c.profiles.ticket();
  await assert.rejects(c.durable());
  await c.durable().catch(() => {});
  await made.writer.settled();
  assert.deepEqual(ids(c.state), [a, b, cId]);
  assert.equal(c.profiles.store.active, a);
  for (const t of [first, mid, last])
    assert.equal(c.profiles.holds(t), false, "every older activation is over");
  c.settings({ uiLanguage: "en" });
  await c.durable();
  assert.deepEqual(ids(onDisk()), [a, b, cId]);
});

/* Q7: account sync never sends a change that may yet be undone. */

function accountEnv() {
  const env = {
    DB: sqliteD1(":memory:"),
    AUTH_PEPPER: randomBytes(32).toString("hex"),
  };
  const log = { puts: 0 };
  const accountRequest = async (url, init) => {
    const response = await handle(new Request(url, init), env);
    if (init.method === "PUT" && response.ok) log.puts++;
    return {
      status: response.status,
      revision: response.headers.get("X-Riwaq-Revision"),
      text: await response.text(),
    };
  };
  const serverRevision = async () =>
    (await env.DB.prepare("SELECT revision FROM users").first())?.revision;
  return {
    env,
    log,
    serverRevision,
    options: { accountServer: "https://accounts.example.test", accountRequest },
  };
}
const credentials = () => ({
  username: "fixture-" + randomBytes(5).toString("hex"),
  password: randomBytes(24).toString("base64url"),
});
/** Device A (the web's store) signed in, and device B's view of the account. */
async function twoDevices() {
  const account = accountEnv();
  const deviceA = asyncClient({}, account.options);
  deviceA.c.collectionsEdit({ action: "create", title: "Shared collection" });
  await deviceA.c.durable();
  const login = credentials();
  await deviceA.c.account.signup(login);
  await deviceA.writer.settled();
  deviceA.c.account.restWait = 400;
  const readB = async () => {
    const b = new Client({
      load: () => ({}),
      save: () => {},
      ...account.options,
    });
    await b.account.login(login);
    return b;
  };
  return { account, deviceA, login, readB };
}

for (const edit of [
  {
    name: "a favorite added",
    run: (c) => c.favorite({ id: "tt7654321", type: "movie", name: "Refused" }),
    seen: (c) => c.state.favorites.some((x) => x.id === "tt7654321"),
  },
  {
    name: "a collection removed",
    run: (c) =>
      c.collectionsEdit({
        action: "remove",
        collectionId: c.state.collections[0].id,
      }),
    seen: (c) =>
      !c.state.collections.some((x) => x.title === "Shared collection"),
  },
  {
    name: "a setting changed",
    run: (c) => c.settings({ uiLanguage: "en" }),
    seen: (c) => c.state.settings.uiLanguage === "en",
  },
  {
    name: "a profile removed",
    before: (c) => c.profiles.create({ name: "Profile B" }),
    run: (c) =>
      c.profiles.remove({
        id: c.profiles.store.list.find((p) => p.name === "Profile B").id,
      }),
    seen: (c) => !c.profiles.store.list.some((p) => p.name === "Profile B"),
  },
]) {
  test(`Q7: ${edit.name} while its write is out: a refused one never reaches the account or device B`, async () => {
    const { account, deviceA, readB } = await twoDevices();
    const { c, disk } = deviceA;
    if (edit.before) {
      edit.before(c);
      await c.durable();
      await c.account.sync();
    }
    const revision = await account.serverRevision();
    const puts = account.log.puts;
    const slot = disk.hold();
    edit.run(c);
    const refused = assert.rejects(c.durable());
    await slot.started.promise;
    // A manual sync while the write is out waits for it…
    const syncing = c.account.sync();
    await tick();
    assert.equal(account.log.puts, puts, "nothing went up while it was out");
    // …and the store then refuses it.
    disk.fail = 1;
    slot.resolve();
    await refused;
    await syncing;
    assert.equal(edit.seen(c), false, "undone on device A");
    assert.equal(account.log.puts, puts, "the undone change was never sent");
    assert.equal(await account.serverRevision(), revision, "no new revision");
    const b = await readB();
    assert.equal(edit.seen(b), false, "device B never sees it");
  });

  test(`Q7: ${edit.name} while its write is out: a kept one goes up once, after it is durable`, async () => {
    const { account, deviceA, readB } = await twoDevices();
    const { c, disk } = deviceA;
    if (edit.before) {
      edit.before(c);
      await c.durable();
      await c.account.sync();
    }
    const revision = await account.serverRevision();
    const puts = account.log.puts;
    const slot = disk.hold();
    edit.run(c);
    const kept = c.durable();
    await slot.started.promise;
    const syncing = c.account.sync();
    await tick();
    assert.equal(account.log.puts, puts, "not before it is durable");
    slot.resolve();
    await kept;
    await syncing;
    assert.equal(account.log.puts, puts + 1, "sent exactly once");
    assert.equal(await account.serverRevision(), revision + 1);
    await c.account.sync();
    assert.equal(account.log.puts, puts + 1, "a second sync sends nothing");
    const b = await readB();
    assert.equal(edit.seen(b), true, "device B gets it");
  });
}

test("Q7: several commits out at once: only what survives is sent", async () => {
  const { account, deviceA, readB } = await twoDevices();
  const { c, disk } = deviceA;
  const puts = account.log.puts;
  const slot = disk.hold();
  c.favorite({ id: "tt0000011", type: "movie", name: "First" });
  const first = c.durable();
  await slot.started.promise;
  c.favorite({ id: "tt0000012", type: "movie", name: "Second, built on it" });
  const second = c.durable();
  const syncing = c.account.sync();
  disk.fail = 1;
  slot.resolve();
  const outcomes = await Promise.allSettled([first, second]);
  assert.deepEqual(
    outcomes.map((o) => o.status),
    ["rejected", "rejected"],
  );
  await syncing;
  assert.equal(account.log.puts, puts);
  c.favorite({ id: "tt0000013", type: "movie", name: "Third, kept" });
  await c.durable();
  await c.account.sync();
  assert.equal(account.log.puts, puts + 1);
  const b = await readB();
  assert.deepEqual(
    b.state.favorites.map((x) => x.id),
    ["tt0000013"],
  );
});

test("Q7: the scheduled and closing syncs wait the same way; a stuck write makes them give up, not send", async () => {
  const { account, deviceA } = await twoDevices();
  const { c, disk } = deviceA;
  c.account.start();
  try {
    const puts = account.log.puts;
    const slot = disk.hold();
    c.favorite({ id: "tt0000021", type: "movie", name: "Out" });
    const out = c.durable();
    await slot.started.promise;
    // touch() scheduled a push; closing the app flushes it now.
    assert.ok(c.account.pushTimer, "a push is scheduled by the save");
    const flushed = c.account.flush();
    // The write stays out longer than a sync waits: it gives up, sends
    // nothing and says why.
    await flushed;
    assert.equal(account.log.puts, puts);
    assert.equal(c.account.error, STILL_SAVING);
    disk.fail = 1;
    slot.resolve();
    await assert.rejects(out);
    // Once nothing is out, the next sync works and sends nothing new.
    await c.account.sync();
    assert.equal(c.account.error, "");
    assert.equal(account.log.puts, puts);
  } finally {
    c.account.stop();
  }
});

test("Q7: the account's data is not put over a commit still being written (409 and retry)", async () => {
  const { account, deviceA, login } = await twoDevices();
  const { c, disk } = deviceA;
  // Device B moves the account first.
  const b = new Client({
    load: () => ({}),
    save: () => {},
    ...account.options,
  });
  await b.account.login(login);
  b.favorite({ id: "tt0000031", type: "movie", name: "From B" });
  await b.account.sync();
  const revision = await account.serverRevision();
  // A's own edit is out when A syncs: the pull waits, then merges with
  // what survived.
  const slot = disk.hold();
  c.favorite({ id: "tt0000032", type: "movie", name: "From A" });
  const kept = c.durable();
  await slot.started.promise;
  const syncing = c.account.sync();
  await tick();
  assert.equal(
    c.state.favorites.some((x) => x.id === "tt0000031"),
    false,
    "B's data waits for A's write",
  );
  slot.resolve();
  await kept;
  await syncing;
  assert.deepEqual(c.state.favorites.map((x) => x.id).sort(), [
    "tt0000031",
    "tt0000032",
  ]);
  assert.equal(await account.serverRevision(), revision + 1);
  await b.account.sync();
  assert.deepEqual(b.state.favorites.map((x) => x.id).sort(), [
    "tt0000031",
    "tt0000032",
  ]);
  // A stale base: A's next push meets B's newer revision (409), pulls and
  // retries once, and both agree.
  b.favorite({ id: "tt0000033", type: "movie", name: "B again" });
  await b.account.sync();
  c.favorite({ id: "tt0000034", type: "movie", name: "A again" });
  await c.durable();
  await c.account.sync();
  await b.account.sync();
  assert.deepEqual(
    c.state.favorites.map((x) => x.id).sort(),
    b.state.favorites.map((x) => x.id).sort(),
  );
  assert.equal(c.state.favorites.length, 4);
});

test("Q7: a backup waits for a commit being written and never carries a refused one", async () => {
  const made = asyncClient();
  const { c, disk } = made;
  const slot = disk.hold();
  c.favorite({ id: "tt0000041", type: "movie", name: "Refused" });
  const out = c.durable();
  await slot.started.promise;
  const sealing = c.atRest(() =>
    c.exportBackup({ passphrase: "fixture passphrase 2" }),
  );
  disk.fail = 1;
  slot.resolve();
  await assert.rejects(out);
  const { text } = await sealing;
  const { payload } = decryptBackup(text, "fixture passphrase 2");
  assert.deepEqual(
    payload.profiles.data[payload.profiles.active].favorites,
    [],
  );
});

test("Q7 policy: a plain save (a rotated provider token) is never undone, and syncs once written or not", async () => {
  const { account, deviceA, readB } = await twoDevices();
  const { c, disk } = deviceA;
  await c.account.configure({ secrets: true });
  await deviceA.writer.settled();
  // A provider rotated its single-use refresh token: the old one is dead,
  // so the new one stays in memory even when the store refuses the write.
  disk.fail = 1;
  c.state.integrations = {
    trakt: {
      clientId: "fixture-client",
      token: {
        access_token: "rotated-access",
        refresh_token: "rotated-refresh",
      },
    },
  };
  const written = c.persist();
  await assert.rejects(written);
  assert.equal(
    c.state.integrations.trakt.token.refresh_token,
    "rotated-refresh",
  );
  // It is not a commit, so a sync does not wait for it and may carry it.
  await c.account.sync();
  const b = await readB();
  assert.equal(
    b.state.integrations?.trakt?.token?.refresh_token,
    "rotated-refresh",
  );
  // The next successful write keeps it on this device too.
  c.settings({ uiLanguage: "en" });
  await c.durable();
  assert.equal(
    JSON.parse(disk.text).integrations.trakt.token.refresh_token,
    "rotated-refresh",
  );
});
