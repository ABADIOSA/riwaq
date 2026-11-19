// Codex's fifth review of PR #155 (docs/REVIEW-PR-155.md, "Sixth pass"),
// V2: reversible actions saved with a plain write left a change the store
// refused in memory, where a backup, account sync and the next unrelated
// save picked it up. Codex reproduced it with a Live TV favorite (it reached
// a second device), a removed Live TV source and an integration opt-in.
// These run the real Client over core/durable.mjs (the web's later-answering
// store, refused the way IndexedDB refuses: an abort with no error object,
// or a QuotaExceededError), the desktop's synchronous store, and the real
// account service (server/accounts/service.mjs over Node's SQLite) with two
// devices. scripts/test-web-durability.mjs runs the same in Chromium.
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Client } from "../core/client.mjs";
import { DurableWriter } from "../core/durable.mjs";
import { decryptBackup } from "../core/backup.mjs";
import { handle } from "../server/accounts/service.mjs";
import { sqliteD1 } from "../server/accounts/local.mjs";

const tick = () => new Promise((r) => setTimeout(r, 2));
const PLAYLIST = "https://live.example.test/fixture.m3u";
const M3U = (n = 2) =>
  "#EXTM3U\n" +
  Array.from(
    { length: n },
    (_, i) => `#EXTINF:-1,Fixture ${i}\nhttps://live.example.test/${i}.ts\n`,
  ).join("");

/** The web's vault: answers later; `disk.fail` refuses, `disk.hold()` waits. */
function asyncStore(initial = {}) {
  const disk = {
    text: JSON.stringify(initial),
    fail: 0,
    error: null,
    writes: 0,
    held: [],
  };
  let current = initial;
  disk.hold = () => {
    const slot = Promise.withResolvers();
    slot.started = Promise.withResolvers();
    disk.held.push(slot);
    return slot;
  };
  const writer = new DurableWriter({
    snapshot: () => ({ text: JSON.stringify(current) }),
    write: async (text) => {
      await tick();
      const slot = disk.held.shift();
      if (slot) {
        slot.started.resolve();
        await slot.promise;
      }
      if (disk.fail > 0) {
        disk.fail--;
        // IndexedDB's manual abort has no error object; a full disk names
        // QuotaExceededError.
        throw disk.error;
      }
      disk.text = text;
      disk.writes++;
    },
  });
  return {
    disk,
    writer,
    save: (data, undo) => {
      current = data;
      return writer.request(undo);
    },
    load: () => JSON.parse(disk.text),
    onDisk: () => JSON.parse(disk.text),
  };
}
const options = {
  requestText: async (url) => {
    assert.equal(url, PLAYLIST);
    return M3U();
  },
};
function webClient(initial = {}, extra = {}) {
  const store = asyncStore(initial);
  const c = new Client({
    load: store.load,
    save: store.save,
    ...options,
    ...extra,
  });
  return { c, ...store };
}
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
    ...options,
  });
  return { c, disk, onDisk: () => JSON.parse(disk.text) };
}
const reload = (made) =>
  new Client({ load: made.load || (() => made.onDisk()), save: () => {} });
const backupOf = (c, includeSecrets) => {
  const { text } = c.exportBackup({
    passphrase: "fixture passphrase 6",
    includeSecrets,
  });
  return decryptBackup(text, "fixture passphrase 6").payload;
};

async function withSource(made) {
  await made.c.live.addSource({ kind: "m3u", name: "Fixture", url: PLAYLIST });
  await made.c.durable();
  return made.c.live.allChannels().map((x) => x.key);
}
const TRAKT = {
  clientId: "fixture-client",
  clientSecret: "fixture-secret",
  token: { access_token: "access-1", refresh_token: "refresh-1" },
};

/**
 * Each reversible action Codex named, and the others the sixth pass moved
 * onto commits: `prepare` (written), `run`, `seen` in a state or a backup
 * payload, `secret` when only a backup with integrations carries it.
 */
const EDITS = [
  {
    name: "a Live TV favorite added",
    prepare: async (made) => ({ key: (await withSource(made))[0] }),
    run: (c, { key }) => c.live.favorite(key),
    seen: (state, { key }) => !!state.live?.favorites?.includes(key),
  },
  {
    name: "a Live TV favorite removed",
    prepare: async (made) => {
      const key = (await withSource(made))[0];
      made.c.live.favorite(key);
      await made.c.durable();
      return { key };
    },
    run: (c, { key }) => c.live.favorite(key),
    seen: (state, { key }) => !state.live?.favorites?.includes(key),
  },
  {
    name: "a Live TV source added",
    run: (c) =>
      c.live.addSource({ kind: "m3u", name: "Refused", url: PLAYLIST }),
    seen: (state) => !!state.live?.sources?.some((s) => s.name === "Refused"),
    secret: true,
  },
  {
    name: "a Live TV source removed",
    prepare: async (made) => {
      await withSource(made);
      return { id: made.c.state.live.sources[0].id };
    },
    run: (c, { id }) => c.live.updateSource({ id, action: "remove" }),
    seen: (state, { id }) => !state.live?.sources?.some((s) => s.id === id),
    secret: true,
  },
  {
    name: "a Live TV source switched off",
    prepare: async (made) => {
      await withSource(made);
      return { id: made.c.state.live.sources[0].id };
    },
    run: (c, { id }) => c.live.updateSource({ id, action: "toggle" }),
    seen: (state, { id }) =>
      state.live?.sources?.find((s) => s.id === id)?.enabled === false,
    secret: true,
  },
  {
    name: "Trakt history opted in",
    prepare: async (made) => {
      made.c.state.integrations = { trakt: structuredClone(TRAKT) };
      made.c.persist();
      await made.c.durable();
    },
    run: (c) => c.integrations.save({ id: "trakt", trackHistory: true }),
    seen: (state) => state.integrations?.trakt?.trackHistory === true,
    secret: true,
  },
  {
    name: "Trakt disconnected",
    prepare: async (made) => {
      made.c.state.integrations = { trakt: structuredClone(TRAKT) };
      made.c.persist();
      await made.c.durable();
    },
    run: (c) => c.integrations.disconnect("trakt"),
    seen: (state) => !state.integrations?.trakt?.token,
    secret: true,
  },
  {
    name: "a Discord notification target saved",
    run: (c) =>
      c.notifier.save({
        id: "discord",
        webhook:
          "https://discord.com/api/webhooks/123456789012345678/abc-DEF_1",
      }),
    seen: (state) => !!state.notify?.discord?.webhook,
    secret: true,
  },
  {
    name: "a debrid key saved",
    run: (c) => c.services.debridSave({ id: "realdebrid", key: "FIXTUREKEY" }),
    seen: (state) => !!state.debrid?.realdebrid,
    local: true,
  },
  {
    name: "an AI key saved",
    run: (c) => c.ai.save({ provider: "groq", key: "gsk_fixture" }),
    seen: (state) => !!state.aiSearch?.key,
    local: true,
  },
  {
    name: "update checks switched off",
    run: (c) => c.updates.setEnabled(false),
    seen: (state) => state.updates?.enabled === false,
    local: true,
  },
  {
    name: "Stremio signed out",
    prepare: async (made) => {
      made.c.state.auth = { authKey: "fixture-auth-key", email: "", name: "" };
      made.c.persist();
      await made.c.durable();
    },
    run: (c) => c.logout(),
    seen: (state) => !state.auth,
    secret: true,
  },
];

for (const edit of EDITS) {
  test(`V2 web: ${edit.name}, refused by the vault, is undone and never written, backed up or reloaded`, async () => {
    const made = webClient();
    const { c, disk, onDisk } = made;
    const context = (await edit.prepare?.(made)) || {};
    assert.equal(edit.seen(c.state, context), false);
    disk.fail = 1;
    await assert.rejects(
      Promise.resolve(edit.run(c, context)).then(() => c.durable()),
    );
    await made.writer.settled();
    assert.equal(edit.seen(c.state, context), false, "undone in memory");
    // Both backups (with and without integrations) leave it out.
    if (!edit.local) {
      assert.equal(edit.seen(backupOf(c, true), context), false);
      if (!edit.secret)
        assert.equal(edit.seen(backupOf(c, false), context), false);
    }
    // The unrelated save Codex made, then a reload.
    c.settings({ uiLanguage: "en" });
    await c.durable();
    assert.equal(edit.seen(onDisk(), context), false, "never written");
    assert.equal(edit.seen(reload(made).state, context), false);
    // A retry that is written stays, across a reload and in a backup.
    await Promise.resolve(edit.run(c, context));
    await c.durable();
    assert.equal(edit.seen(c.state, context), true);
    assert.equal(edit.seen(reload(made).state, context), true);
    if (!edit.local) assert.equal(edit.seen(backupOf(c, true), context), true);
  });
}

for (const edit of EDITS.filter((e) => e.name !== "a Live TV source added")) {
  test(`V2 desktop: ${edit.name}, refused by the encrypted file, is undone at once`, async () => {
    const made = desktopClient();
    const { c, disk, onDisk } = made;
    const context = (await edit.prepare?.(made)) || {};
    disk.fail = 1;
    await assert.rejects(Promise.resolve().then(() => edit.run(c, context)));
    assert.equal(edit.seen(c.state, context), false);
    c.settings({ uiLanguage: "en" });
    assert.equal(edit.seen(onDisk(), context), false);
  });
}

test("V2 desktop: a Live TV source whose add is refused is not kept and not loaded", async () => {
  const { c, disk, onDisk } = desktopClient();
  disk.fail = 1;
  await assert.rejects(
    c.live.addSource({ kind: "m3u", name: "Refused", url: PLAYLIST }),
    /تشفير ويندوز/,
  );
  assert.deepEqual(c.state.live.sources, []);
  assert.deepEqual(c.live.allChannels(), []);
  c.settings({ uiLanguage: "en" });
  assert.deepEqual(onDisk().live.sources, []);
});

test("V2: a QuotaExceededError is a refusal like an abort", async () => {
  const made = webClient();
  const { c, disk, onDisk } = made;
  const [key] = await withSource(made);
  disk.fail = 1;
  disk.error = Object.assign(new Error("The quota has been exceeded."), {
    name: "QuotaExceededError",
  });
  c.live.favorite(key);
  await assert.rejects(c.durable(), (e) => e.name === "QuotaExceededError");
  assert.deepEqual(c.state.live.favorites, []);
  c.settings({ uiLanguage: "en" });
  await c.durable();
  assert.deepEqual(onDisk().live.favorites, []);
});

test("V2: two overlapping edits: a refused first one takes the one built on it with it; an unrelated plain save is kept", async () => {
  const made = webClient();
  const { c, disk, onDisk } = made;
  const [k1, k2] = await withSource(made);
  const slot = disk.hold();
  c.live.favorite(k1);
  const first = c.durable();
  await slot.started.promise;
  c.live.favorite(k2); // written after the first, built on it
  const second = c.durable();
  c.state.live.sources[0].refreshedAt = 123; // a plain save meanwhile
  c.persist();
  disk.fail = 1;
  slot.resolve();
  await assert.rejects(first);
  await assert.rejects(second);
  await made.writer.settled();
  assert.deepEqual(c.state.live.favorites, []);
  assert.equal(c.state.live.sources[0].refreshedAt, 123);
  await c.durable();
  assert.deepEqual(onDisk().live.favorites, []);
  assert.equal(onDisk().live.sources[0].refreshedAt, 123);
  // Accepted in order: both stay, once each.
  c.live.favorite(k1);
  c.live.favorite(k2);
  await c.durable();
  assert.deepEqual(onDisk().live.favorites, [k1, k2]);
});

test("V2: an undo after a profile switch and a lock lands in the profile the import was made for", async () => {
  const made = webClient({}, {});
  const { c, disk } = made;
  c.state.providers = { tmdb: { key: "fixture" } };
  c.dataHub.resolve = async (name) => ({
    id: "tt" + name,
    type: "movie",
    name,
  });
  const a = c.profiles.store.active;
  c.profiles.create({ name: "B" });
  await c.durable();
  const b = c.profiles.store.list.find((p) => p.id !== a).id;
  const slot = disk.hold();
  const importing = c.integrations.importLetterboxd(
    "Name,Year\n0000001,2001\n0000002,2002\n",
  );
  await slot.started.promise;
  c.profiles.switch({ id: b });
  c.profiles.lock();
  disk.fail = 1;
  slot.resolve();
  await assert.rejects(importing);
  await made.writer.settled();
  const listsOf = (id) =>
    c.profiles.store.active === id
      ? c.state.connectedLists
      : c.profiles.store.data[id].connectedLists;
  assert.equal(listsOf(a).length, 0, "A's import was undone in A");
  assert.equal(listsOf(b).length, 0, "and nothing landed in B");
});

test("V2: a refused credentials change brings the old Trakt account back, and its remote revoke waits for the write", async () => {
  const requests = [];
  const made = webClient(
    {},
    {
      request: async (url) => {
        requests.push(new URL(url).pathname);
        return {};
      },
    },
  );
  const { c, disk } = made;
  c.state.integrations = {
    simkl: {
      clientId: "old-client",
      token: { access_token: "simkl-access", v2: true },
    },
  };
  c.persist();
  await c.durable();
  disk.fail = 1;
  c.integrations.save({ id: "simkl", clientId: "new-client" });
  await assert.rejects(c.durable());
  await made.writer.settled();
  await tick();
  assert.equal(c.state.integrations.simkl.clientId, "old-client");
  assert.equal(c.state.integrations.simkl.token.access_token, "simkl-access");
  assert.deepEqual(requests, [], "nothing was revoked");
  // Written: the old account ends, and only then is it revoked.
  c.integrations.save({ id: "simkl", clientId: "new-client" });
  await c.durable();
  await tick();
  assert.equal(c.state.integrations.simkl.clientId, "new-client");
  assert.equal(c.state.integrations.simkl.token, undefined);
  assert.deepEqual(requests, ["/oauth2/revoke"]);
});

test("V2: a Stremio sync is gathered first and written as one commit; refused, addons, library and positions stay as they were", async () => {
  const api = async (method) => {
    if (method === "addonCollectionGet")
      return {
        addons: [
          {
            transportUrl: "https://addon.example.test/manifest.json",
            manifest: {
              id: "fixture.addon",
              version: "1.0.0",
              name: "Fixture addon",
              resources: ["catalog"],
              types: ["movie"],
              catalogs: [],
            },
          },
        ],
      };
    if (method === "datastoreMeta") return [["tt0000099", 1]];
    if (method === "datastoreGet")
      return [
        {
          _id: "tt0000099",
          type: "movie",
          name: "From Stremio",
          _mtime: "2026-01-01T00:00:00Z",
          state: { timeOffset: 60000, duration: 600000, video_id: "tt0000099" },
        },
      ];
    throw new Error("unexpected " + method);
  };
  const made = webClient({}, { api });
  const { c, disk, onDisk } = made;
  c.state.auth = { authKey: "fixture-auth-key", email: "", name: "" };
  c.persist();
  await c.durable();
  const addons = JSON.stringify(c.state.addons);
  disk.fail = 1;
  await assert.rejects(c.sync());
  await made.writer.settled();
  assert.equal(JSON.stringify(c.state.addons), addons);
  assert.deepEqual(c.state.favorites, []);
  assert.deepEqual(c.state.progress, {});
  c.settings({ uiLanguage: "en" });
  await c.durable();
  assert.ok(!JSON.stringify(onDisk()).includes("tt0000099"));
  assert.ok(!JSON.stringify(backupOf(c, true)).includes("fixture.addon"));
  // Retried and written: once each, and a second sync adds nothing twice.
  await c.sync();
  await c.sync();
  assert.equal(c.state.favorites.filter((m) => m.id === "tt0000099").length, 1);
  assert.equal(
    c.state.addons.filter((a) => a.manifest.id === "fixture.addon").length,
    1,
  );
  assert.ok(c.state.progress["movie:tt0000099"]);
  assert.ok(JSON.stringify(reload(made).state).includes("fixture.addon"));
});

/* Two devices on one account (the real Worker over SQLite). */

function accountEnv() {
  const env = {
    DB: sqliteD1(":memory:"),
    AUTH_PEPPER: randomBytes(32).toString("hex"),
  };
  const log = { puts: 0, down: 0 };
  const accountRequest = async (url, init) => {
    if (log.down > 0) {
      log.down--;
      throw new TypeError("fetch failed");
    }
    const response = await handle(new Request(url, init), env);
    if (init.method === "PUT" && response.ok) log.puts++;
    return {
      status: response.status,
      revision: response.headers.get("X-Riwaq-Revision"),
      text: await response.text(),
    };
  };
  return {
    env,
    log,
    revision: async () =>
      (await env.DB.prepare("SELECT revision FROM users").first())?.revision,
    options: {
      ...options,
      accountServer: "https://accounts.example.test",
      accountRequest,
    },
  };
}
async function twoDevices({ secrets = true } = {}) {
  const account = accountEnv();
  const deviceA = webClient({}, account.options);
  const keys = await withSource(deviceA);
  const login = {
    username: "fixture-" + randomBytes(5).toString("hex"),
    password: randomBytes(24).toString("base64url"),
  };
  await deviceA.c.account.signup({ ...login, secrets });
  await deviceA.writer.settled();
  deviceA.c.account.restWait = 400;
  const deviceB = new Client({
    load: () => ({}),
    save: () => {},
    ...account.options,
  });
  await deviceB.account.login(login);
  return { account, deviceA, deviceB, keys, login };
}
const STREMIO_ADDON = {
  transportUrl: "https://addon.example.test/manifest.json",
  manifest: {
    id: "fixture.addon",
    version: "1.0.0",
    name: "Fixture addon",
    resources: ["catalog"],
    types: ["movie"],
    catalogs: [],
  },
};
const SYNCED = [
  {
    name: "a Live TV favorite (Codex's reproduction)",
    run: (c, { keys }) => c.live.favorite(keys[0]),
    seen: (c, { keys }) => c.state.live.favorites.includes(keys[0]),
  },
  {
    name: "a Live TV source removed",
    // An account carries a removal only while another source is left (a
    // payload without sources keeps the device's own, core/backup.mjs).
    before: async (c) => {
      await c.live.addSource({ kind: "m3u", name: "Second", url: PLAYLIST });
      await c.durable();
      await c.account.sync();
    },
    run: (c) =>
      c.live.updateSource({
        id: c.state.live.sources.find((s) => s.name === "Fixture").id,
        action: "remove",
      }),
    seen: (c) => !c.state.live.sources.some((s) => s.name === "Fixture"),
  },
  {
    name: "an integration preference",
    before: async (c) => {
      (c.state.integrations ||= {}).trakt = structuredClone(TRAKT);
      c.persist();
      await c.durable();
      await c.account.sync();
    },
    run: (c) => c.integrations.save({ id: "trakt", trackHistory: true }),
    seen: (c) => c.state.integrations?.trakt?.trackHistory === true,
  },
  {
    name: "a Stremio addon import",
    before: async (c) => {
      c.api = async (method) => {
        if (method === "addonCollectionGet") return { addons: [STREMIO_ADDON] };
        if (method === "datastoreMeta") return [];
        throw new Error("unexpected " + method);
      };
      c.state.auth = { authKey: "fixture-auth-key", email: "", name: "" };
      c.persist();
      await c.durable();
      await c.account.sync();
    },
    run: (c) => c.sync(),
    seen: (c) => c.state.addons.some((a) => a.manifest.id === "fixture.addon"),
  },
];
for (const edit of SYNCED) {
  test(`V2 sync: ${edit.name}, refused while a manual sync waits, never goes up or reaches device B; accepted, it goes once`, async () => {
    const { account, deviceA, deviceB, keys } = await twoDevices();
    const { c, disk } = deviceA;
    await edit.before?.(c);
    await deviceB.account.sync();
    const revision = await account.revision();
    const puts = account.log.puts;
    // Refused. (The action's own write is the one held.)
    let slot = disk.hold();
    const action = Promise.resolve(edit.run(c, { keys })).catch(() => {});
    await slot.started.promise;
    const refused = assert.rejects(c.durable());
    const syncing = c.account.sync();
    await tick();
    assert.equal(account.log.puts, puts, "nothing while the write is out");
    disk.fail = 1;
    slot.resolve();
    await refused;
    await action;
    await syncing;
    assert.equal(edit.seen(c, { keys }), false);
    assert.equal(account.log.puts, puts, "no PUT");
    assert.equal(await account.revision(), revision, "no new revision");
    await deviceB.account.sync();
    assert.equal(edit.seen(deviceB, { keys }), false, "device B unchanged");
    // Accepted.
    slot = disk.hold();
    const again = Promise.resolve(edit.run(c, { keys }));
    await slot.started.promise;
    const kept = c.durable();
    const syncAgain = c.account.sync();
    await tick();
    assert.equal(account.log.puts, puts);
    slot.resolve();
    await kept;
    await again;
    await syncAgain;
    assert.equal(account.log.puts, puts + 1, "sent once, after it was durable");
    await c.account.sync();
    assert.equal(account.log.puts, puts + 1, "a second sync sends nothing");
    await deviceB.account.sync();
    assert.equal(edit.seen(deviceB, { keys }), true, "device B gets it");
  });
}

test("V2 sync: one accepted and one refused change out together: only the accepted one goes up", async () => {
  const { account, deviceA, deviceB, keys } = await twoDevices();
  const { c, disk } = deviceA;
  const puts = account.log.puts;
  // The favorite is written alone and kept; the source removal after it
  // is refused.
  c.live.favorite(keys[0]);
  const first = c.durable();
  await first;
  const slot = disk.hold();
  const id = c.state.live.sources[0].id;
  c.live.updateSource({ id, action: "remove" });
  const second = assert.rejects(c.durable());
  await slot.started.promise;
  const syncing = c.account.sync();
  disk.fail = 1;
  slot.resolve();
  await second;
  await syncing;
  assert.equal(account.log.puts, puts + 1);
  await deviceB.account.sync();
  assert.ok(deviceB.state.live.favorites.includes(keys[0]));
  assert.ok(deviceB.state.live.sources.some((s) => s.id === id));
});

test("V2 sync: a stale base (409) and a network failure retry with only what is durable", async () => {
  const { account, deviceA, deviceB, keys } = await twoDevices();
  const { c, disk } = deviceA;
  // Device B moves the account first.
  deviceB.live.favorite(keys[1]);
  await deviceB.account.sync();
  // A's refused favorite, then a sync over a stale base and a network
  // failure.
  disk.fail = 1;
  c.live.favorite(keys[0]);
  await assert.rejects(c.durable());
  account.log.down = 1;
  await assert.rejects(c.account.sync());
  await c.account.sync(); // 409 on the stale base, pull, merge, retry
  assert.deepEqual(c.state.live.favorites, [keys[1]]);
  await deviceB.account.sync();
  assert.deepEqual(deviceB.state.live.favorites, [keys[1]]);
  // Accepted: it merges with B's and goes up once.
  c.live.favorite(keys[0]);
  await c.durable();
  await c.account.sync();
  await deviceB.account.sync();
  assert.deepEqual([...deviceB.state.live.favorites].sort(), [...keys].sort());
});

test("V2 sync: signing out while a change is being written sends nothing; the kept change stays on the device", async () => {
  const { account, deviceA, deviceB, keys } = await twoDevices();
  const { c, disk } = deviceA;
  const puts = account.log.puts;
  const slot = disk.hold();
  c.live.favorite(keys[0]);
  const kept = c.durable();
  await slot.started.promise;
  const syncing = c.account.sync();
  const out = c.account.logout();
  slot.resolve();
  await kept;
  await Promise.allSettled([syncing, out]);
  assert.equal(account.log.puts, puts);
  assert.ok(c.state.live.favorites.includes(keys[0]));
  await deviceB.account.sync();
  assert.ok(!deviceB.state.live.favorites.includes(keys[0]));
});

/* Category B: a token the provider already rotated is an external fact. */

test("V2 policy: a refused opt-in never rolls back a refresh token the provider rotated meanwhile", async () => {
  const made = webClient();
  const { c, disk, onDisk } = made;
  c.state.integrations = { trakt: structuredClone(TRAKT) };
  c.persist();
  await c.durable();
  const slot = disk.hold();
  c.integrations.save({ id: "trakt", trackHistory: true });
  const refused = assert.rejects(c.durable());
  await slot.started.promise;
  // Trakt rotated its single-use refresh token while the opt-in was out:
  // a plain save, never undone.
  c.state.integrations.trakt.token = {
    access_token: "access-2",
    refresh_token: "refresh-2",
  };
  c.persist();
  disk.fail = 1;
  slot.resolve();
  await refused;
  await made.writer.settled();
  const s = c.state.integrations.trakt;
  assert.equal(s.trackHistory, undefined, "the opt-in was undone");
  assert.equal(s.token.refresh_token, "refresh-2", "the rotated token was not");
  // Written with the next snapshot; never in a backup without secrets.
  c.settings({ uiLanguage: "en" });
  await c.durable();
  assert.equal(onDisk().integrations.trakt.token.refresh_token, "refresh-2");
  assert.equal(onDisk().integrations.trakt.trackHistory, undefined);
  assert.equal(backupOf(c, false).integrations, undefined);
  assert.ok(!JSON.stringify(backupOf(c, false)).includes("refresh-2"));
  assert.equal(
    backupOf(c, true).integrations.trakt.token.refresh_token,
    "refresh-2",
  );
});

test("V2 policy: a rotated token whose own write is refused stays in memory and goes with the next save (desktop)", () => {
  const { c, disk, onDisk } = desktopClient();
  c.state.integrations = { trakt: structuredClone(TRAKT) };
  c.persist();
  c.state.integrations.trakt.token = {
    access_token: "access-2",
    refresh_token: "refresh-2",
  };
  disk.fail = 1;
  assert.throws(() => c.persist());
  // Not undone: the old refresh token is spent at the provider.
  assert.equal(c.state.integrations.trakt.token.refresh_token, "refresh-2");
  assert.equal(onDisk().integrations.trakt.token.refresh_token, "refresh-1");
  c.settings({ uiLanguage: "en" });
  assert.equal(onDisk().integrations.trakt.token.refresh_token, "refresh-2");
});
