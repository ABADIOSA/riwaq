import test from "node:test";
import assert from "node:assert/strict";
import { UsagePulse, USAGE_INTERVAL } from "../core/usage.mjs";
import { Client } from "../core/client.mjs";
import { collectBackup } from "../core/backup.mjs";
import { sqliteD1 } from "../server/accounts/local.mjs";
import { handle } from "../server/accounts/worker.mjs";
import { AdminMetrics } from "../admin/metrics.mjs";
import { AdminGithub } from "../admin/github.mjs";

test("usage is off by default; consent and random identity stay outside accounts/backups", async () => {
  const c = new Client({ load: () => ({}), save: () => {}, version: "0.47.0" });
  const sent = [];
  let now = 1000000;
  const usage = new UsagePulse(c, {
    request: async (u, a) => {
      sent.push({ u, ...a });
      return new Response(null, { status: 204 });
    },
    now: () => now,
  });
  await usage.tick();
  assert.equal(sent.length, 0);
  await usage.edit(true);
  assert.equal(sent.length, 1);
  const payload = JSON.parse(sent[0].body);
  assert.deepEqual(Object.keys(payload).sort(), [
    "platform",
    "token",
    "version",
  ]);
  assert.match(payload.token, /^[a-f0-9]{64}$/);
  assert.deepEqual(usage.publicState(), { enabled: true });
  assert.ok(
    !JSON.stringify(collectBackup(c.state, { includeSecrets: true })).includes(
      payload.token,
    ),
  );
  assert.ok(!JSON.stringify(c.publicState()).includes(payload.token));
  await usage.tick();
  assert.equal(sent.length, 1);
  now += USAGE_INTERVAL;
  usage.active = () => false;
  await usage.tick();
  assert.equal(sent.length, 1);
  usage.active = () => true;
  await usage.tick();
  assert.equal(sent.length, 2);
  await usage.edit(false);
  assert.equal(sent.at(-1).method, "DELETE");
  now += USAGE_INTERVAL;
  await usage.tick();
  assert.equal(sent.length, 3);
  await usage.edit(true);
  assert.notEqual(JSON.parse(sent.at(-1).body).token, payload.token);
  usage.stop();
});

test("opt-out aborts a delayed pulse and late completion cannot restore consent", async () => {
  const c = { state: {}, version: "0.47.0", persist() {} };
  let finish;
  let signal;
  const u = new UsagePulse(c, {
    request: async (_url, args) => {
      if (args.method === "DELETE") return new Response(null, { status: 204 });
      signal = args.signal;
      return new Promise((r) => (finish = r));
    },
  });
  const enabling = u.edit(true);
  await new Promise((r) => setImmediate(r));
  await u.edit(false);
  assert.equal(signal.aborted, true);
  finish(new Response(null, { status: 204 }));
  await enabling;
  assert.deepEqual(u.publicState(), { enabled: false });
  u.stop();
});

test("usage service authenticates aggregates, deduplicates devices, rejects extra data, deletes and expires records", async () => {
  const db = sqliteD1(),
    key = "a".repeat(64),
    token = "b".repeat(64),
    other = "c".repeat(64);
  const env = {
    DB: db,
    AUTH_PEPPER: "p".repeat(40),
    METRICS_ADMIN_KEY: key,
    ALLOWED_ORIGINS: "https://riwaq.test",
  };
  let now = 1800000000000;
  const call = (path, method = "GET", body, auth = "") =>
    handle(
      new Request("https://service.test" + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(auth ? { Authorization: "Bearer " + auth } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      env,
      { now },
    );
  try {
    assert.equal((await call("/v1/admin/usage")).status, 401);
    assert.equal(
      (
        await call("/v1/usage", "POST", {
          token,
          platform: "desktop",
          version: "0.47.0",
          title: "private",
        })
      ).status,
      400,
    );
    for (let i = 0; i < 3; i++)
      assert.equal(
        (
          await call("/v1/usage", "POST", {
            token,
            platform: "desktop",
            version: "0.47.0",
          })
        ).status,
        204,
      );
    await call("/v1/usage", "POST", {
      token: other,
      platform: "web",
      version: "0.47.0",
    });
    let stats = await (await call("/v1/admin/usage", "GET", null, key)).json();
    assert.equal(stats.online, 2);
    assert.equal(stats.month, 2);
    const rows = (await db.prepare("SELECT * FROM usage_devices").all())
      .results;
    assert.equal(rows.length, 2);
    assert.ok(!JSON.stringify(rows).includes(token));
    assert.ok(!JSON.stringify(stats).includes(rows[0].token_hash));
    now += 11 * 60000;
    stats = await (await call("/v1/admin/usage", "GET", null, key)).json();
    assert.equal(stats.online, 0);
    assert.equal(stats.day, 2);
    await call("/v1/usage", "DELETE", { token });
    // A pulse already in flight when opt-out happened must not resurrect the device.
    await call("/v1/usage", "POST", {
      token,
      platform: "desktop",
      version: "0.47.0",
    });
    stats = await (await call("/v1/admin/usage", "GET", null, key)).json();
    assert.equal(stats.month, 1);
    now += 33 * 86400000;
    stats = await (await call("/v1/admin/usage", "GET", null, key)).json();
    assert.equal(stats.month, 0);
    assert.equal(
      (await db.prepare("SELECT COUNT(*) AS n FROM usage_devices").first()).n,
      0,
    );
    const foreign = await handle(
      new Request("https://service.test/v1/admin/usage", {
        headers: {
          Origin: "https://evil.test",
          Authorization: "Bearer " + key,
        },
      }),
      env,
      { now },
    );
    assert.equal(foreign.status, 403);
  } finally {
    db.close();
  }
});

test("metrics stays unavailable without a secret and enforces payload size and rate limits", async () => {
  const db = sqliteD1(),
    env = { DB: db, AUTH_PEPPER: "p".repeat(40) },
    now = 1800000000000;
  const request = (body) =>
    new Request("https://service.test/v1/usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
  try {
    assert.equal((await handle(request("{}"), env, { now })).status, 503);
    env.METRICS_ADMIN_KEY = "a".repeat(64);
    assert.equal(
      (await handle(request(" ".repeat(1100)), env, { now })).status,
      400,
    );
    for (let i = 0; i < 59; i++) await handle(request("{}"), env, { now });
    assert.equal((await handle(request("{}"), env, { now })).status, 429);
  } finally {
    db.close();
  }
});

test("Admin pages through releases and counts installer/portable assets, never signatures, updates or drafts", async () => {
  const calls = [];
  const github = new AdminGithub({
    now: () => 123,
    request: async (url) => {
      calls.push(url);
      const release = {
        tag_name: "v0.47.0",
        published_at: "2026-10-18",
        assets: [
          { name: "Riwaq-Setup-0.47.0-win-x64.exe", download_count: 5 },
          { name: "Riwaq-0.47.0-win-x64.exe", download_count: 3 },
          { name: "update.zip", download_count: 99 },
          { name: "Riwaq-Admin-0.47.0-win-x64.exe", download_count: 50 },
        ],
      };
      return url.endsWith("page=1")
        ? [
            release,
            ...Array.from({ length: 29 }, () => ({ ...release, draft: true })),
          ]
        : [{ ...release, tag_name: "v0.46.1" }];
    },
  });
  const counts = await github.downloadStats();
  assert.equal(calls.length, 2);
  assert.equal(counts.total, 16);
  assert.equal(counts.installer, 10);
  assert.equal(counts.portable, 6);
  assert.equal(counts.complete, true);
});

test("Admin's usage credential never leaves main state; disconnect invalidates pending reads", async () => {
  let finish;
  const key = "d".repeat(64);
  const admin = new AdminMetrics({
    request: async (_url, args) => {
      assert.equal(args.headers.Authorization, "Bearer " + key);
      return new Promise((r) => (finish = r));
    },
  });
  assert.deepEqual(admin.connect(key), { connected: true });
  const pending = admin.read();
  admin.disconnect();
  finish({
    at: 100,
    online: 1,
    day: 2,
    month: 3,
    windowMinutes: 10,
    versions: [],
  });
  await assert.rejects(pending, /cancelled/);
  await assert.rejects(admin.read(), /Connect/);
});
