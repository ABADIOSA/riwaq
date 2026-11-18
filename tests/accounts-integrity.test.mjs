// The accounts Worker's data integrity (docs/CLOUDFLARE-DATABASE-AUDIT-2026-11-18.md):
// sessions bound to the account as it was when they began (CF1), data
// writes that leave nothing behind on a conflict or a deleted account
// (CF2), bodies cut off at their limit even without a length (CF3), the
// daily clean-up (CF4), and account isolation, revocation and replays.
// Real Worker code over Node's SQLite (server/accounts/local.mjs); D1's
// batch is one transaction there too.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cleanup, handle } from "../server/accounts/service.mjs";
import { sqliteD1 } from "../server/accounts/local.mjs";

const secret = (c) => c.repeat(43);
const wrapped = "W".repeat(80);
const migrations = fileURLToPath(
  new URL("../server/accounts/migrations/", import.meta.url),
);

function setup() {
  const db = sqliteD1();
  // Raw access for checks and for landing a "concurrent" change exactly
  // where a race would put it.
  const env = {
    DB: db,
    AUTH_PEPPER: "p".repeat(40),
    ALLOWED_ORIGINS: "https://abadiosa.github.io",
  };
  let now = 1_800_000_000_000;
  const call = async (method, path, { body, headers = {}, token } = {}) => {
    const response = await handle(
      new Request(`https://accounts.test${path}`, {
        method,
        headers: {
          "CF-Connecting-IP": "1.1.1.1",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
        body:
          body === undefined
            ? undefined
            : typeof body === "string"
              ? body
              : JSON.stringify(body),
      }),
      env,
      { now },
    );
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: response.status, json, text };
  };
  const signup = async (username, c = "A") => {
    const r = await call("POST", "/v1/signup", {
      body: {
        username,
        authSecret: secret(c),
        wrappedKey: wrapped,
        recoveryAuth: secret("R"),
        recoveryKey: wrapped,
      },
    });
    return r.json?.token;
  };
  const login = (username, c = "A") =>
    call("POST", "/v1/login", { body: { username, authSecret: secret(c) } });
  const put = (token, base, text) =>
    call("PUT", "/v1/data", {
      token,
      body: text,
      headers: { "X-Riwaq-Base": String(base) },
    });
  const count = async (sql, ...args) =>
    (
      await db
        .prepare(sql)
        .bind(...args)
        .first()
    ).n;
  /** Runs `hook` once, inside the next batch, before its statements. */
  const beforeNextBatch = (hook) => {
    const batch = db.batch;
    db.batch = async (statements) => {
      db.batch = batch;
      await hook();
      return batch(statements);
    };
  };
  const removeAccount = async (username) => {
    await db
      .prepare("DELETE FROM chunks WHERE username = ?1")
      .bind(username)
      .run();
    await db
      .prepare("DELETE FROM sessions WHERE username = ?1")
      .bind(username)
      .run();
    await db
      .prepare("DELETE FROM users WHERE username = ?1")
      .bind(username)
      .run();
  };
  return {
    db,
    env,
    call,
    signup,
    login,
    put,
    count,
    beforeNextBatch,
    removeAccount,
    later: (ms) => (now += ms),
    now: () => now,
  };
}

test("CF1: a sign-in racing the account's deletion leaves no session", async () => {
  const t = setup();
  await t.signup("abadi");
  t.beforeNextBatch(() => t.removeAccount("abadi"));
  const r = await t.login("abadi");
  assert.equal(r.status, 401);
  assert.equal(await t.count("SELECT COUNT(*) AS n FROM sessions"), 0);
});

test("CF1: an old session never opens a later account of the same name", async () => {
  const t = setup();
  const old = await t.signup("abadi");
  // What the race above used to leave: a session row outliving its account.
  const [row] = (
    await t.db.prepare("SELECT * FROM sessions WHERE username = 'abadi'").all()
  ).results;
  await t.removeAccount("abadi");
  await t.db
    .prepare(
      "INSERT INTO sessions (token_hash, username, created_at, seen_at) VALUES (?1, ?2, ?3, ?3)",
    )
    .bind(row.token_hash, "abadi", row.created_at)
    .run();
  t.later(60_000);
  const fresh = await t.signup("abadi", "B");
  assert.equal((await t.put(fresh, 0, "new owner's data")).status, 200);
  for (const [method, path] of [
    ["GET", "/v1/data"],
    ["PUT", "/v1/data"],
    ["POST", "/v1/logout"],
  ]) {
    const r = await t.call(method, path, {
      token: old,
      body: method === "PUT" ? "overwrite" : undefined,
      headers: { "X-Riwaq-Base": "1" },
    });
    assert.equal(r.status, 401, `${method} ${path}`);
  }
  // The stale row is gone; the new owner's data and session are intact.
  assert.equal(
    await t.count(
      "SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?1",
      row.token_hash,
    ),
    0,
  );
  const mine = await t.call("GET", "/v1/data", { token: fresh });
  assert.equal(mine.text, "new owner's data");
});

test("CF2: an upload racing the account's deletion leaves no data, and the name works again", async () => {
  const t = setup();
  const token = await t.signup("abadi");
  t.beforeNextBatch(() => t.removeAccount("abadi"));
  const r = await t.put(token, 0, "sealed data");
  assert.equal(r.status, 409);
  assert.equal(await t.count("SELECT COUNT(*) AS n FROM chunks"), 0);
  // Before the fix the orphaned pieces at revision 1 made every upload
  // of a new account with this name conflict for ever.
  const fresh = await t.signup("abadi", "B");
  assert.equal((await t.put(fresh, 0, "fresh")).status, 200);
});

test("CF2: pieces left at the next revision by an older failure are healed", async () => {
  const t = setup();
  const token = await t.signup("abadi");
  await t.db
    .prepare(
      "INSERT INTO chunks (username, revision, idx, data) VALUES ('abadi', 1, 0, 'stale')",
    )
    .run();
  const r = await t.put(token, 0, "current");
  assert.equal(r.status, 200);
  assert.equal((await t.call("GET", "/v1/data", { token })).text, "current");
  assert.equal(await t.count("SELECT COUNT(*) AS n FROM chunks"), 1);
});

test("CF2: a conflict writes no pieces at all", async () => {
  const t = setup();
  const a = await t.signup("abadi");
  const b = (await t.login("abadi")).json.token;
  assert.equal((await t.put(a, 0, "x".repeat(4_000_000))).status, 200);
  // Another device moved on twice, so this one's next revision is free:
  // the old code wrote every piece there and deleted it again.
  assert.equal((await t.put(a, 1, "x".repeat(4_000_000))).status, 200);
  let inserted = 0;
  const prepare = t.db.prepare;
  t.db.prepare = (sql) => {
    const s = prepare(sql);
    if (!/INSERT INTO chunks/.test(sql)) return s;
    const bind = s.bind;
    return {
      ...s,
      bind: (...v) => {
        const bound = bind(...v);
        const runNow = bound.runNow;
        return {
          ...bound,
          runNow: () => {
            const r = runNow();
            inserted += r.meta.changes;
            return r;
          },
        };
      },
    };
  };
  const r = await t.put(b, 0, "y".repeat(4_000_000));
  t.db.prepare = prepare;
  assert.equal(r.status, 409);
  assert.equal(r.json.revision, 2);
  assert.equal(inserted, 0, "no piece written only to be deleted again");
  assert.equal(
    (await t.call("GET", "/v1/data", { token: b })).text.length,
    4_000_000,
  );
});

test("CF2: a replayed upload is a conflict, never a lost update", async () => {
  const t = setup();
  const token = await t.signup("abadi");
  assert.equal((await t.put(token, 0, "first")).status, 200);
  assert.equal((await t.put(token, 1, "second")).status, 200);
  const replay = await t.put(token, 0, "first");
  assert.equal(replay.status, 409);
  assert.equal(replay.json.revision, 2);
  assert.equal((await t.call("GET", "/v1/data", { token })).text, "second");
});

test("CF3: a body without a length is cut off at the limit", async () => {
  const t = setup();
  const big = new TextEncoder().encode(`{"username":"${"a".repeat(20_000)}"}`);
  const stream = new ReadableStream({
    start(controller) {
      for (let at = 0; at < big.length; at += 4096)
        controller.enqueue(big.slice(at, at + 4096));
      controller.close();
    },
  });
  const response = await handle(
    new Request("https://accounts.test/v1/login", {
      method: "POST",
      body: stream,
      duplex: "half",
      headers: { "CF-Connecting-IP": "1.1.1.1" },
    }),
    t.env,
  );
  assert.equal(response.status, 413);
});

test("CF4: the daily clean-up removes only what has no use", async () => {
  const t = setup();
  const keep = await t.signup("keeper");
  await t.put(keep, 0, "kept");
  await t.signup("gone");
  const run = (sql) => t.db.prepare(sql).run();
  const now = t.now();
  const day = 86_400_000;
  await run(
    `INSERT INTO attempts (key, count, reset_at) VALUES ('old', 3, ${now - 1}), ('live', 3, ${now + day})`,
  );
  await run(
    `INSERT INTO sessions (token_hash, username, created_at, seen_at) VALUES ('idle', 'keeper', ${now - 200 * day}, ${now - 181 * day})`,
  );
  await run(
    `INSERT INTO sessions (token_hash, username, created_at, seen_at) VALUES ('orphan', 'nobody', ${now}, ${now})`,
  );
  await run(
    `INSERT INTO chunks (username, revision, idx, data) VALUES ('nobody', 1, 0, 'x'), ('keeper', 7, 0, 'stale')`,
  );
  await run(
    `INSERT INTO usage_devices (token_hash, platform, version, seen_at) VALUES ('u-old', 'web', '0.55.0', ${now - 40 * day}), ('u-new', 'web', '0.55.0', ${now})`,
  );
  await cleanup(t.db, now);
  const keys = async (sql) =>
    (await t.db.prepare(sql).all()).results.map((r) => Object.values(r)[0]);
  // The sign-ups' own live counters stay too.
  assert.deepEqual(
    await keys("SELECT key FROM attempts WHERE key IN ('old', 'live')"),
    ["live"],
  );
  assert.deepEqual(
    (await keys("SELECT token_hash FROM sessions ORDER BY username")).filter(
      (h) => h === "idle" || h === "orphan",
    ),
    [],
  );
  assert.equal(
    await t.count("SELECT COUNT(*) AS n FROM sessions"),
    2,
    "the two real sessions",
  );
  assert.deepEqual(await keys("SELECT data FROM chunks"), ["kept"]);
  assert.deepEqual(await keys("SELECT token_hash FROM usage_devices"), [
    "u-new",
  ]);
  assert.equal((await t.call("GET", "/v1/data", { token: keep })).text, "kept");
});

test("isolation: one account's token reads and writes only its own data", async () => {
  const t = setup();
  const a = await t.signup("alpha");
  const b = await t.signup("bravo", "B");
  await t.put(a, 0, "alpha's");
  await t.put(b, 0, "bravo's");
  assert.equal((await t.call("GET", "/v1/data", { token: a })).text, "alpha's");
  assert.equal((await t.call("GET", "/v1/data", { token: b })).text, "bravo's");
  // A's password proves nothing for B.
  const wrong = await t.call("DELETE", "/v1/account", {
    token: a,
    body: { authSecret: secret("B") },
  });
  assert.equal(wrong.status, 401);
  // Deleting A ends A's sessions and data, nothing of B's.
  const gone = await t.call("DELETE", "/v1/account", {
    token: a,
    body: { authSecret: secret("A") },
  });
  assert.equal(gone.status, 204);
  assert.equal((await t.call("GET", "/v1/data", { token: a })).status, 401);
  assert.equal((await t.call("GET", "/v1/data", { token: b })).text, "bravo's");
  assert.equal(
    await t.count("SELECT COUNT(*) AS n FROM chunks WHERE username = 'alpha'"),
    0,
  );
});

test("revocation: a new password or a recovery ends other devices; logout ends one", async () => {
  const t = setup();
  const one = await t.signup("abadi");
  const two = (await t.login("abadi")).json.token;
  const three = (await t.login("abadi")).json.token;
  const change = await t.call("POST", "/v1/password", {
    token: one,
    body: {
      authSecret: secret("A"),
      newAuthSecret: secret("N"),
      wrappedKey: wrapped,
    },
  });
  assert.equal(change.status, 204);
  assert.equal((await t.call("GET", "/v1/data", { token: one })).status, 204);
  for (const token of [two, three])
    assert.equal((await t.call("GET", "/v1/data", { token })).status, 401);
  const recovered = await t.call("POST", "/v1/recover/finish", {
    body: {
      username: "abadi",
      recoveryAuth: secret("R"),
      authSecret: secret("Z"),
      wrappedKey: wrapped,
    },
  });
  assert.equal(recovered.status, 200);
  assert.equal((await t.call("GET", "/v1/data", { token: one })).status, 401);
  const fresh = recovered.json.token;
  assert.equal(
    (await t.call("POST", "/v1/logout", { token: fresh })).status,
    204,
  );
  assert.equal((await t.call("GET", "/v1/data", { token: fresh })).status, 401);
});

test("duplicates: signing up twice keeps the first account", async () => {
  const t = setup();
  const first = await t.signup("abadi");
  await t.put(first, 0, "first's");
  const again = await t.call("POST", "/v1/signup", {
    body: {
      username: "abadi",
      authSecret: secret("Q"),
      wrappedKey: wrapped,
      recoveryAuth: secret("Q"),
      recoveryKey: wrapped,
    },
  });
  assert.equal(again.status, 409);
  assert.equal(
    (await t.call("GET", "/v1/data", { token: first })).text,
    "first's",
  );
});

test("migrations apply to an empty database and again without change", () => {
  const db = new DatabaseSync(":memory:");
  const files = readdirSync(migrations)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (let pass = 0; pass < 2; pass++)
    for (const file of files) db.exec(readFileSync(migrations + file, "utf8"));
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
    .all()
    .map((r) => r.name);
  assert.deepEqual(tables, [
    "attempts",
    "chunks",
    "sessions",
    "usage_devices",
    "users",
  ]);
});

test("every query a request makes reads by an index, never the whole table", () => {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync(migrations)
    .filter((f) => f.endsWith(".sql"))
    .sort())
    db.exec(readFileSync(migrations + file, "utf8"));
  const plan = (sql) =>
    db
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all()
      .map((r) => r.detail)
      .join(" | ");
  const perRequest = [
    "SELECT s.username, s.seen_at, s.created_at, u.created_at AS since FROM sessions s LEFT JOIN users u ON u.username = s.username WHERE s.token_hash = 'x'",
    "SELECT * FROM users WHERE username = 'x'",
    "SELECT data FROM chunks WHERE username = 'x' AND revision = 1 ORDER BY idx",
    "SELECT count, reset_at FROM attempts WHERE key = 'x'",
    "DELETE FROM sessions WHERE username = 'x' AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE username = 'x' ORDER BY seen_at DESC LIMIT 20)",
    "DELETE FROM chunks WHERE username = 'x' AND revision <> COALESCE((SELECT revision FROM users WHERE username = 'x'), -1)",
    "INSERT INTO chunks (username, revision, idx, data) SELECT 'x', 2, 0, 'd' WHERE EXISTS (SELECT 1 FROM users WHERE username = 'x' AND revision = 1)",
    "INSERT INTO sessions (token_hash, username, created_at, seen_at) SELECT 'h', 'x', 1, 1 WHERE EXISTS (SELECT 1 FROM users WHERE username = 'x')",
  ];
  for (const sql of perRequest) assert.doesNotMatch(plan(sql), /\bSCAN\b/, sql);
  // The per-request sweep of expired counters is gone: it scanned.
  const service = readFileSync(
    new URL("../server/accounts/service.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    service,
    /DELETE FROM attempts WHERE reset_at < \?1"\)\s*\.bind\(now\)\s*\.run\(\)/,
  );
  const worker = readFileSync(
    new URL("../server/accounts/worker.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    worker,
    /scheduled: \(_event, env, context\) => context\.waitUntil\(cleanup\(env\.DB\)\)/,
  );
});

test("CF5: the Worker's entry exports its handlers only", () => {
  const worker = readFileSync(
    new URL("../server/accounts/worker.mjs", import.meta.url),
    "utf8",
  );
  assert.deepEqual(
    [...worker.matchAll(/^export\s+(\w+)/gm)].map((m) => m[1]),
    ["default"],
  );
});
