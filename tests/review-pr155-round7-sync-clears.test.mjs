// Codex's sixth review of PR #155 (docs/REVIEW-PR-155.md, "Seventh pass"),
// W4: under secrets sync, removing the last Live TV source or signing out of
// Stremio on device A was undone by device B. restoreState read the empty
// list and the null sign-in as "not carried" and kept B's, and B's next
// sync pushed them back to A and to every new device. The same held for a
// removed configured addon and a cleared Discord app ID.
//
// Real clients and the real accounts service over in-memory SQLite, one
// synthetic account per test; no outside request is made.
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Client } from "../core/client.mjs";
import { DurableWriter } from "../core/durable.mjs";
import { collectBackup, restoreState } from "../core/backup.mjs";
import { handle } from "../server/accounts/service.mjs";
import { sqliteD1 } from "../server/accounts/local.mjs";

const origin = "https://riwaq-review.example.test";
const manifest = {
  id: "fixture.configured",
  name: "Configured fixture",
  version: "1.0.0",
  types: ["movie"],
  resources: ["stream"],
  catalogs: [],
};

function world() {
  const db = sqliteD1(":memory:");
  const env = { DB: db, AUTH_PEPPER: randomBytes(32).toString("hex") };
  const wire = [];
  let conflictNext = null;
  const config = {
    accountServer: origin,
    request: async () => assert.fail("no outside request"),
    requestText: async (url) => {
      assert.match(url, /^https:\/\/riwaq-review\.example\.test\/p\d+\.m3u$/);
      return "#EXTM3U\n#EXTINF:-1,Fixture channel\n" + origin + "/v.ts\n";
    },
    api: async (op, payload) => {
      assert.equal(op, "getUser");
      return { fullname: "Synthetic " + payload.authKey.slice(-1) };
    },
    accountRequest: async (url, init) => {
      assert.equal(new URL(url).origin, origin);
      // A device that moves first while this one is between pull and push.
      if (conflictNext && init.method === "PUT") {
        const before = conflictNext;
        conflictNext = null;
        await before();
      }
      const reply = await handle(new Request(url, init), env);
      if (new URL(url).pathname === "/v1/data")
        wire.push({ method: init.method, status: reply.status });
      return {
        status: reply.status,
        revision: reply.headers.get("X-Riwaq-Revision"),
        text: await reply.text(),
      };
    },
  };
  function device() {
    let current;
    let written = {};
    const writer = new DurableWriter({
      snapshot: () => ({ text: JSON.stringify(current) }),
      write: async (text) => {
        written = JSON.parse(text);
      },
    });
    const boot = () =>
      new Client({
        ...config,
        load: () => structuredClone(written),
        save(state, undo) {
          current = state;
          return writer.request(undo);
        },
      });
    const d = {
      client: boot(),
      written: () => written,
      settled: () => writer.settled(),
      async sync() {
        await d.client.account.sync();
        await writer.settled();
      },
      /** A restart: the client reads what was written. */
      reload() {
        d.client = boot();
        return d.client;
      },
    };
    return d;
  }
  const account = (secrets = true) => ({
    username: "fixture-" + randomBytes(5).toString("hex"),
    password: randomBytes(24).toString("base64url"),
    secrets,
  });
  return {
    db,
    wire,
    device,
    account,
    beforeNextPut(fn) {
      conflictNext = fn;
    },
  };
}
const add = (c, i) =>
  c.live.addSource({
    kind: "m3u",
    name: "Disposable " + i,
    url: `${origin}/p${i}.m3u`,
  });
const removeFirst = (c) =>
  c.live.updateSource({ id: c.state.live.sources[0].id, action: "remove" });
const sources = (state) => state.live?.sources?.length || 0;
const signedIn = (state) => Boolean(state.auth?.authKey);
const configured = (state) =>
  (state.addons || []).filter((a) => a.transportUrl.includes("token-abc"))
    .length;

/** A signs up with `prepare` done, B signs in, both synced. */
async function pair(w, prepare, { secrets = true } = {}) {
  const a = w.device();
  const b = w.device();
  const acct = w.account(secrets);
  await prepare?.(a.client);
  await a.client.account.signup(acct);
  await a.settled();
  await b.client.account.login(acct);
  await b.settled();
  await a.sync();
  await b.sync();
  return { a, b, acct };
}

test("W4: the last Live TV source removed on A stays removed on A, B, a new device, after reloads and repeated syncs", async () => {
  const w = world();
  try {
    const { a, b, acct } = await pair(w, (c) => add(c, 1));
    assert.deepEqual([sources(a.written()), sources(b.written())], [1, 1]);
    removeFirst(a.client);
    await a.client.durable();
    await a.sync();
    await b.sync();
    await a.sync();
    assert.equal(sources(b.written()), 0);
    assert.equal(sources(a.written()), 0);
    const c = w.device();
    await c.client.account.login(acct);
    await c.settled();
    assert.equal(sources(c.written()), 0);
    // Repeated syncs change nothing and send nothing new.
    w.wire.length = 0;
    for (const d of [a, b, c, a, b]) await d.sync();
    assert.equal(w.wire.filter((x) => x.method === "PUT").length, 0);
    assert.equal(sources(b.reload().state), 0);
    assert.equal(sources(a.reload().state), 0);
  } finally {
    w.db.close();
  }
});

test("W4: removing one of two sources stays as it was (the control)", async () => {
  const w = world();
  try {
    const { a, b } = await pair(w, async (c) => {
      await add(c, 1);
      await add(c, 2);
    });
    removeFirst(a.client);
    await a.client.durable();
    await a.sync();
    await b.sync();
    await a.sync();
    assert.deepEqual([sources(a.written()), sources(b.written())], [1, 1]);
  } finally {
    w.db.close();
  }
});

test("W4: a 409 between pull and push is merged and retried; the clear and B's own change both stand", async () => {
  const w = world();
  try {
    const { a, b } = await pair(w, (c) => add(c, 1));
    removeFirst(a.client);
    await a.client.durable();
    // B pushes an unrelated change just before A's push.
    w.beforeNextPut(async () => {
      b.client.settings({ uiLanguage: "en" });
      await b.client.durable();
      await b.sync();
    });
    await a.sync();
    assert.ok(w.wire.some((x) => x.status === 409));
    await b.sync();
    await a.sync();
    assert.deepEqual([sources(a.written()), sources(b.written())], [0, 0]);
    assert.equal(a.client.state.settings.uiLanguage, "en");
  } finally {
    w.db.close();
  }
});

test("W4: a device that was offline while the source was removed drops it when it comes back", async () => {
  const w = world();
  try {
    const { a, b } = await pair(w, (c) => add(c, 1));
    removeFirst(a.client);
    await a.client.durable();
    await a.sync();
    // B, offline meanwhile, restarts and syncs later.
    b.reload();
    assert.equal(sources(b.client.state), 1);
    await b.sync();
    await a.sync();
    assert.deepEqual([sources(a.written()), sources(b.written())], [0, 0]);
  } finally {
    w.db.close();
  }
});

test("W4: a Stremio sign-out under secrets sync signs out B and new devices and is not undone; signing in again goes to both", async () => {
  const w = world();
  try {
    const { a, b, acct } = await pair(w, (c) =>
      c.authenticate("synthetic-key-1"),
    );
    assert.deepEqual(
      [signedIn(a.written()), signedIn(b.written())],
      [true, true],
    );
    a.client.logout();
    await a.client.durable();
    await a.sync();
    await b.sync();
    await a.sync();
    assert.deepEqual(
      [signedIn(a.written()), signedIn(b.written())],
      [false, false],
    );
    const c = w.device();
    await c.client.account.login(acct);
    await c.settled();
    assert.equal(signedIn(c.written()), false);
    for (const d of [b, a, c]) await d.sync();
    assert.equal(signedIn(a.reload().state), false);
    // An intentional sign-in afterwards is a new value and travels.
    await a.client.authenticate("synthetic-key-2");
    await a.client.durable();
    await a.sync();
    await b.sync();
    assert.equal(b.client.state.auth?.authKey, "synthetic-key-2");
  } finally {
    w.db.close();
  }
});

test("W4: without secrets sync a Stremio sign-out, a removed source and a configured addon stay local to each device", async () => {
  const w = world();
  try {
    const both = async (c) => {
      await c.authenticate("synthetic-key-1");
      await add(c, 1);
    };
    const a = w.device();
    const b = w.device();
    const acct = w.account(false);
    await both(a.client);
    await both(b.client);
    a.client.state.addons.push({
      transportUrl: origin + "/token-abc/manifest.json",
      manifest,
      enabled: true,
    });
    a.client.persist();
    await a.client.account.signup(acct);
    await b.client.account.login(acct);
    await a.sync();
    await b.sync();
    // B never received A's configured addon: it is a secret.
    assert.equal(configured(b.client.state), 0);
    a.client.logout();
    removeFirst(a.client);
    await a.client.durable();
    await a.sync();
    await b.sync();
    await a.sync();
    // B keeps its own sign-in and source; A stays as it chose.
    assert.equal(signedIn(b.written()), true);
    assert.equal(sources(b.written()), 1);
    assert.equal(signedIn(a.written()), false);
    assert.equal(sources(a.written()), 0);
    assert.equal(configured(a.written()), 1);
  } finally {
    w.db.close();
  }
});

test("W4: a new device signed in to Stremio on its own keeps that sign-in when it joins a secrets account that has none", async () => {
  const w = world();
  try {
    const a = w.device();
    const acct = w.account(true);
    await a.client.account.signup(acct);
    await a.settled();
    const c = w.device();
    await c.client.authenticate("synthetic-key-3");
    await c.client.account.login(acct);
    await c.settled();
    assert.equal(c.client.state.auth?.authKey, "synthetic-key-3");
    await c.sync();
    // The account now carries it (secrets sync is on), as any sign-in.
    await a.sync();
    assert.equal(a.client.state.auth?.authKey, "synthetic-key-3");
  } finally {
    w.db.close();
  }
});

test("W4: a removed configured addon and a cleared Discord app ID stay cleared under secrets sync", async () => {
  const w = world();
  try {
    const { a, b, acct } = await pair(w, (c) => {
      c.state.addons.push({
        transportUrl: origin + "/token-abc/manifest.json",
        manifest,
        enabled: true,
      });
      c.state.discordAppId = "123456789012345678";
      c.persist();
    });
    assert.equal(configured(b.written()), 1);
    assert.equal(b.written().discordAppId, "123456789012345678");
    a.client.state.addons = a.client.state.addons.filter(
      (x) => !x.transportUrl.includes("token-abc"),
    );
    a.client.state.discordAppId = "";
    a.client.persist();
    await a.client.durable();
    await a.sync();
    await b.sync();
    await a.sync();
    assert.deepEqual(
      [configured(a.written()), configured(b.written())],
      [0, 0],
    );
    assert.deepEqual(
      [a.written().discordAppId || "", b.written().discordAppId || ""],
      ["", ""],
    );
    const c = w.device();
    await c.client.account.login(acct);
    await c.settled();
    assert.equal(configured(c.written()), 0);
  } finally {
    w.db.close();
  }
});

test("W4: restoreState reads released clients' payloads as they were written: without secrets nothing local is cleared, with secrets a clear is a clear", () => {
  const current = {
    auth: { authKey: "synthetic-local-key", email: "", name: "" },
    addons: [{ transportUrl: origin + "/token-abc/manifest.json", manifest }],
    live: {
      sources: [
        {
          id: "a".repeat(24),
          kind: "m3u",
          name: "Local",
          url: origin + "/p1.m3u",
        },
      ],
    },
    discordAppId: "123456789012345678",
    profiles: { list: [{ id: "p1", name: "One" }], active: "p1", data: {} },
  };
  // A data-only payload, as every release since 0.5 writes it (0.55 here).
  const plain = collectBackup({
    ...current,
    auth: null,
    live: { sources: [] },
    addons: [],
  }).payload;
  assert.equal(Object.hasOwn(plain, "auth"), false);
  plain.discordAppId = current.discordAppId;
  const kept = restoreState(current, plain);
  assert.equal(kept.auth.authKey, "synthetic-local-key");
  assert.equal(kept.live.sources.length, 1);
  assert.equal(configured(kept), 1);
  // A secrets payload from a signed-out device with nothing configured.
  const secrets = collectBackup(
    {
      ...current,
      auth: null,
      live: { sources: [] },
      addons: [],
      discordAppId: "",
    },
    { includeSecrets: true },
  ).payload;
  assert.equal(secrets.auth, null);
  const cleared = restoreState(current, secrets);
  assert.equal(cleared.auth, null);
  assert.equal(cleared.live.sources.length, 0);
  assert.equal(configured(cleared), 0);
  assert.equal(cleared.discordAppId, "");
  // A malformed sign-in in a secrets payload never replaces a good one.
  const odd = restoreState(current, { ...secrets, auth: { authKey: 42 } });
  assert.equal(odd.auth.authKey, "synthetic-local-key");
});
