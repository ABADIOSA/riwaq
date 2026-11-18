// The accounts Worker after Codex's third review of PR #155 (CF1, CF2, N9;
// docs/CLOUDFLARE-DATABASE-AUDIT-2026-11-18.md, "Fourth pass"): sessions
// and writes bound to an account INSTANCE and credential GENERATION, never
// to a username that can be deleted and taken again; a pull whose revision
// and data come from one committed state; migration 0003 on data written
// before it, including by the Worker before this one. Real Worker code
// over Node's SQLite (server/accounts/local.mjs), where a D1 batch is one
// transaction too. Every race is landed exactly where it would fall.
import test from "node:test";
import assert from "node:assert/strict";
import { handle, cleanup, MAX_DATA } from "../server/accounts/service.mjs";
import { sqliteD1 } from "../server/accounts/local.mjs";

const secret = (c) => c.repeat(43);
const wrapped = "W".repeat(80);

function setup({ db = sqliteD1() } = {}) {
  const env = { DB: db, AUTH_PEPPER: "p".repeat(40) };
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
    return {
      status: response.status,
      json,
      text,
      revision: response.headers.get("X-Riwaq-Revision"),
    };
  };
  const signup = async (username, c = "A", r = "R") =>
    (
      await call("POST", "/v1/signup", {
        body: {
          username,
          authSecret: secret(c),
          wrappedKey: wrapped,
          recoveryAuth: secret(r),
          recoveryKey: wrapped,
        },
      })
    ).json?.token;
  const login = (username, c = "A") =>
    call("POST", "/v1/login", { body: { username, authSecret: secret(c) } });
  const put = (token, base, text) =>
    call("PUT", "/v1/data", {
      token,
      body: text,
      headers: { "X-Riwaq-Base": String(base) },
    });
  const get = (token, seen) =>
    call("GET", "/v1/data", {
      token,
      headers: seen === undefined ? {} : { "If-None-Match": String(seen) },
    });
  const changePassword = (token, from, to) =>
    call("POST", "/v1/password", {
      token,
      body: {
        authSecret: secret(from),
        newAuthSecret: secret(to),
        wrappedKey: wrapped,
      },
    });
  const recover = (username, to, r = "R") =>
    call("POST", "/v1/recover/finish", {
      body: {
        username,
        recoveryAuth: secret(r),
        authSecret: secret(to),
        wrappedKey: wrapped,
      },
    });
  const remove = (token, c = "A") =>
    call("DELETE", "/v1/account", { token, body: { authSecret: secret(c) } });
  const count = async (sql, ...args) =>
    (
      await db
        .prepare(sql)
        .bind(...args)
        .first()
    ).n;
  /** Runs `hook` once, right before the next batch's transaction. */
  const beforeNextBatch = (hook) => {
    const batch = db.batch;
    db.batch = async (statements) => {
      db.batch = batch;
      await hook();
      return batch(statements);
    };
  };
  return {
    db,
    call,
    signup,
    login,
    put,
    get,
    changePassword,
    recover,
    remove,
    count,
    beforeNextBatch,
    later: (ms) => (now += ms),
  };
}

/* CF1: a session is issued only for the instance and generation checked. */

test("CF1: a sign-in racing a deletion and a new account of the same name issues nothing for the new account", async () => {
  const t = setup();
  const first = await t.signup("abadi", "A");
  t.beforeNextBatch(async () => {
    assert.equal((await t.remove(first, "A")).status, 204);
    assert.ok(await t.signup("abadi", "B"), "the name is taken again");
  });
  const r = await t.login("abadi", "A");
  assert.equal(r.status, 401);
  // Only the new owner's own session exists.
  assert.equal(await t.count("SELECT COUNT(*) AS n FROM sessions"), 1);
  assert.equal((await t.login("abadi", "A")).status, 401);
  assert.equal((await t.login("abadi", "B")).status, 200);
});

test("CF1: a sign-in with the old password racing a password change issues nothing", async () => {
  const t = setup();
  const device = await t.signup("abadi", "A");
  t.beforeNextBatch(async () => {
    assert.equal((await t.changePassword(device, "A", "N")).status, 204);
  });
  const r = await t.login("abadi", "A");
  assert.equal(r.status, 401);
  // The device that changed it stays signed in, alone.
  assert.equal((await t.get(device)).status, 204);
  assert.equal(await t.count("SELECT COUNT(*) AS n FROM sessions"), 1);
  assert.equal((await t.login("abadi", "N")).status, 200);
});

test("CF1: a sign-in racing a recovery issues nothing; the recovered device is the only one signed in", async () => {
  const t = setup();
  const before = await t.signup("abadi", "A");
  let recovered;
  t.beforeNextBatch(async () => {
    recovered = await t.recover("abadi", "N");
    assert.equal(recovered.status, 200);
  });
  assert.equal((await t.login("abadi", "A")).status, 401);
  assert.equal((await t.get(before)).status, 401, "signed out by recovery");
  assert.equal((await t.get(recovered.json.token)).status, 204);
  assert.equal(await t.count("SELECT COUNT(*) AS n FROM sessions"), 1);
});

test("CF1: a recovery racing a password change changes nothing and is refused", async () => {
  const t = setup();
  const device = await t.signup("abadi", "A");
  t.beforeNextBatch(async () => {
    assert.equal((await t.changePassword(device, "A", "N")).status, 204);
  });
  const r = await t.recover("abadi", "X");
  assert.equal(r.status, 401);
  assert.equal((await t.login("abadi", "N")).status, 200);
  assert.equal((await t.login("abadi", "X")).status, 401);
  assert.equal((await t.get(device)).status, 204);
});

test("CF1: a session from a deleted account never opens a new account of the same name, whatever the clocks say", async () => {
  const t = setup();
  const old = await t.signup("abadi", "A");
  assert.equal((await t.remove(old, "A")).status, 204);
  // A new account registered from an edge whose clock is behind: its
  // created_at is EARLIER than the old session's (the old rule's gap).
  t.later(-3_600_000);
  const fresh = await t.signup("abadi", "B");
  // The old token's row was deleted with its account; put it back as a
  // stale row with the old instance, as a lost race would have.
  const [row] = (
    await t.db
      .prepare("SELECT account_id FROM users WHERE username = 'abadi'")
      .all()
  ).results;
  assert.ok(row.account_id);
  await t.db
    .prepare(
      "INSERT INTO sessions (token_hash, username, created_at, seen_at, account_id, auth_gen) VALUES ('stale', 'abadi', 1, 1, 'old-instance', 0)",
    )
    .run();
  assert.equal((await t.get(old)).status, 401);
  assert.equal((await t.put(fresh, 0, "new owner")).status, 200);
  await cleanup(t.db);
  assert.equal(
    await t.count(
      "SELECT COUNT(*) AS n FROM sessions WHERE token_hash = 'stale'",
    ),
    0,
  );
});

test("CF1: two simultaneous sign-ins both work; revoking one leaves the other", async () => {
  const t = setup();
  await t.signup("abadi");
  const [a, b] = await Promise.all([t.login("abadi"), t.login("abadi")]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(
    (await t.call("POST", "/v1/logout", { token: a.json.token })).status,
    204,
  );
  assert.equal((await t.get(a.json.token)).status, 401);
  assert.equal((await t.get(b.json.token)).status, 204);
});

test("CF1: a password change keeps this device, signs out the others, and an old-generation session is refused", async () => {
  const t = setup();
  const mine = await t.signup("abadi", "A");
  const other = (await t.login("abadi", "A")).json.token;
  assert.equal((await t.changePassword(mine, "A", "N")).status, 204);
  assert.equal((await t.get(mine)).status, 204);
  assert.equal((await t.get(other)).status, 401);
  // A row at the old generation (a lost race) is refused and cleaned.
  const [{ account_id }] = (
    await t.db.prepare("SELECT account_id FROM users").all()
  ).results;
  await t.db
    .prepare(
      "INSERT INTO sessions (token_hash, username, created_at, seen_at, account_id, auth_gen) VALUES ('oldgen', 'abadi', 1, 1, ?1, 0)",
    )
    .bind(account_id)
    .run();
  await cleanup(t.db);
  assert.equal(
    await t.count(
      "SELECT COUNT(*) AS n FROM sessions WHERE token_hash = 'oldgen'",
    ),
    0,
  );
});

/* CF2: every write is bound to the session's instance and generation. */

test("CF2: an upload whose session is signed out meanwhile writes nothing and is told 401", async () => {
  const t = setup();
  const token = await t.signup("abadi");
  t.beforeNextBatch(() => t.call("POST", "/v1/logout", { token }));
  const r = await t.put(token, 0, "sealed");
  assert.equal(r.status, 401);
  assert.equal(await t.count("SELECT COUNT(*) AS n FROM chunks"), 0);
  assert.equal(
    await t.count("SELECT revision AS n FROM users WHERE username = 'abadi'"),
    0,
  );
});

test("CF2: an upload racing a password change from another device writes nothing", async () => {
  const t = setup();
  const mine = await t.signup("abadi", "A");
  const other = (await t.login("abadi", "A")).json.token;
  t.beforeNextBatch(async () => {
    assert.equal((await t.changePassword(other, "A", "N")).status, 204);
  });
  const r = await t.put(mine, 0, "sealed");
  assert.equal(r.status, 401);
  assert.equal(await t.count("SELECT COUNT(*) AS n FROM chunks"), 0);
  assert.equal((await t.get(other)).status, 204);
});

test("CF2: an upload racing a deletion and a new account of the same name never writes into the new account", async () => {
  const t = setup();
  const old = await t.signup("abadi", "A");
  let fresh;
  t.beforeNextBatch(async () => {
    assert.equal((await t.remove(old, "A")).status, 204);
    fresh = await t.signup("abadi", "B");
  });
  const r = await t.put(old, 0, "old owner's data");
  assert.equal(r.status, 401);
  assert.equal(await t.count("SELECT COUNT(*) AS n FROM chunks"), 0);
  assert.equal((await t.get(fresh)).status, 204, "the new account is empty");
  assert.equal((await t.put(fresh, 0, "new owner's first")).status, 200);
  assert.equal((await t.get(fresh)).text, "new owner's first");
});

test("CF2: an account deletion racing a recovery deletes nothing", async () => {
  const t = setup();
  const token = await t.signup("abadi", "A");
  assert.equal((await t.put(token, 0, "kept")).status, 200);
  t.beforeNextBatch(async () => {
    assert.equal((await t.recover("abadi", "N")).status, 200);
  });
  assert.equal((await t.remove(token, "A")).status, 401);
  assert.equal(await t.count("SELECT COUNT(*) AS n FROM users"), 1);
  assert.equal(await t.count("SELECT COUNT(*) AS n FROM chunks"), 1);
});

test("CF2: concurrent uploads from one base: one wins, the other is a conflict, the retry wins", async () => {
  const t = setup();
  const a = await t.signup("abadi");
  const b = (await t.login("abadi")).json.token;
  const [first, second] = await Promise.all([
    t.put(a, 0, "from a"),
    t.put(b, 0, "from b"),
  ]);
  const statuses = [first.status, second.status].sort();
  assert.deepEqual(statuses, [200, 409]);
  const loser = first.status === 409 ? first : second;
  assert.deepEqual(loser.json, { error: "conflict", revision: 1 });
  const retry = await t.put(first.status === 409 ? a : b, 1, "retried");
  assert.equal(retry.status, 200);
  assert.equal((await t.get(a)).text, "retried");
  assert.equal(await t.count("SELECT COUNT(*) AS n FROM chunks"), 1);
});

test("CF2: a batch that fails inside its transaction leaves revision and data as they were", async () => {
  const t = setup();
  const token = await t.signup("abadi");
  assert.equal((await t.put(token, 0, "first")).status, 200);
  const batch = t.db.batch;
  t.db.batch = (statements) =>
    batch([...statements, t.db.prepare("SELECT * FROM missing_table")]);
  const r = await t.put(token, 1, "second");
  t.db.batch = batch;
  assert.equal(r.status, 409);
  assert.equal(r.json.revision, 1);
  const pulled = await t.get(token);
  assert.equal(pulled.revision, "1");
  assert.equal(pulled.text, "first");
});

/* N9: a pull is one committed state, never an old revision with no data. */

function pauseAfter(db, match) {
  const prepare = db.prepare;
  let paused;
  let release;
  const reached = new Promise((r) => (paused = r));
  const resume = new Promise((r) => (release = r));
  db.prepare = (sql) => {
    const statement = prepare(sql);
    if (!match(sql)) return statement;
    db.prepare = prepare;
    return {
      bind: (...args) => {
        const bound = statement.bind(...args);
        return {
          ...bound,
          first: async () => {
            const row = await bound.first();
            paused();
            await resume;
            return row;
          },
        };
      },
    };
  };
  return { reached, release };
}

test("N9: a pull racing another device's upload returns one committed revision with its whole data", async () => {
  const t = setup();
  const a = await t.signup("abadi");
  const b = (await t.login("abadi")).json.token;
  const first = "B".repeat(MAX_DATA);
  assert.equal((await t.put(a, 0, first)).status, 200);
  const second = "C".repeat(4_500_000);
  // Pause the pull right after it read the revision (where the reviewer
  // paused it), and let the other device's upload commit meanwhile.
  const pause = pauseAfter(t.db, (sql) =>
    sql.startsWith("SELECT revision FROM users"),
  );
  const pending = t.get(a);
  await pause.reached;
  const upload = await t.put(b, 1, second);
  pause.release();
  assert.equal(upload.status, 200);
  const pulled = await pending;
  assert.equal(pulled.status, 200);
  assert.equal(pulled.revision, "2");
  assert.equal(pulled.text, second);
});

test("N9: a pull whose stored pieces do not add up is refused (503), never a 200 with partial or empty data", async () => {
  const t = setup();
  const token = await t.signup("abadi");
  const text = "D".repeat(3_200_000); // three pieces
  assert.equal((await t.put(token, 0, text)).status, 200);
  await t.db.prepare("DELETE FROM chunks WHERE idx = 1").run();
  const r = await t.get(token);
  assert.equal(r.status, 503);
  assert.equal(r.json.error, "try_again");
  await t.db.prepare("DELETE FROM chunks").run();
  assert.equal((await t.get(token)).status, 503, "no data at a revision > 0");
});

test("N9: a deletion during a pull answers 401, an unchanged revision 304, an empty account 204", async () => {
  const t = setup();
  const token = await t.signup("abadi");
  assert.equal((await t.get(token)).status, 204);
  assert.equal((await t.put(token, 0, "x")).status, 200);
  assert.equal((await t.get(token, 1)).status, 304);
  const pause = pauseAfter(t.db, (sql) =>
    sql.startsWith("SELECT revision FROM users"),
  );
  const pending = t.get(token);
  await pause.reached;
  await t.db.prepare("DELETE FROM chunks").run();
  await t.db.prepare("DELETE FROM sessions").run();
  await t.db.prepare("DELETE FROM users").run();
  pause.release();
  assert.equal((await pending).status, 401);
});

test("N9: a large multi-piece envelope round-trips exactly, and the revision header names it", async () => {
  const t = setup();
  const token = await t.signup("abadi");
  let text = "";
  for (let i = 0; text.length < MAX_DATA - 64; i++)
    text += i.toString(36).padStart(8, "-");
  text = text.slice(0, MAX_DATA);
  assert.equal((await t.put(token, 0, text)).status, 200);
  const r = await t.get(token);
  assert.equal(r.revision, "1");
  assert.equal(r.text, text);
});

/* Migration 0003 on the data production holds today. */

test("0003: rows written by the Worker before it, then migrated, keep their sessions and data", async () => {
  const db = sqliteD1(":memory:", { upTo: "0002_usage.sql" });
  // The old Worker's own statements (72e2ffc server/accounts/service.mjs),
  // a day before the requests below.
  const now = 1_800_000_000_000 - 86_400_000;
  await db
    .prepare(
      `INSERT INTO users (username, auth_salt, auth_hash, wrapped_key,
         recovery_salt, recovery_hash, recovery_key, revision, size,
         created_at, updated_at)
       VALUES ('legacy', 's', 'h', 'w', 'rs', 'rh', 'rk', 1, 5, ?1, ?1)`,
    )
    .bind(now)
    .run();
  await db
    .prepare(
      "INSERT INTO chunks (username, revision, idx, data) VALUES ('legacy', 1, 0, 'hello')",
    )
    .run();
  const tokenText = "T".repeat(43);
  const hash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(tokenText),
      ),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  await db
    .prepare(
      "INSERT INTO sessions (token_hash, username, created_at, seen_at) VALUES (?1, 'legacy', ?2, ?2)",
    )
    .bind(hash, now + 1000)
    .run();
  // A stale session older than the account (a lost race of old).
  await db
    .prepare(
      "INSERT INTO sessions (token_hash, username, created_at, seen_at) VALUES ('older', 'legacy', ?1, ?1)",
    )
    .bind(now - 1000)
    .run();
  db.migrate();
  const users = (await db.prepare("SELECT account_id FROM users").all())
    .results;
  assert.match(users[0].account_id, /^[0-9a-f]{32}$/);
  const sessions = (
    await db
      .prepare(
        "SELECT token_hash, account_id FROM sessions ORDER BY token_hash",
      )
      .all()
  ).results;
  assert.equal(
    sessions.find((s) => s.token_hash === hash).account_id,
    users[0].account_id,
  );
  assert.equal(sessions.find((s) => s.token_hash === "older").account_id, null);
  const t = setup({ db });
  const pulled = await t.get(tokenText);
  assert.equal(pulled.status, 200);
  assert.equal(pulled.text, "hello");
  assert.equal((await t.put(tokenText, 1, "world")).status, 200);
  await cleanup(db);
  assert.equal(
    await t.count(
      "SELECT COUNT(*) AS n FROM sessions WHERE token_hash = 'older'",
    ),
    0,
  );
  assert.equal(
    await t.count(
      "SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?1",
      hash,
    ),
    1,
  );
});

test("0003: rows the old Worker writes AFTER the migration (deployment not yet done) are adopted by the new Worker", async () => {
  const db = sqliteD1();
  const now = 1_800_000_000_000;
  // The old Worker on the migrated schema: it names its columns, so the
  // new ones stay NULL / 0.
  await db
    .prepare(
      `INSERT INTO users (username, auth_salt, auth_hash, wrapped_key,
         recovery_salt, recovery_hash, recovery_key, revision, size,
         created_at, updated_at)
       VALUES ('window', 's', 'h', 'w', 'rs', 'rh', 'rk', 0, 0, ?1, ?1)`,
    )
    .bind(now)
    .run();
  const tokenText = "U".repeat(43);
  const hash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(tokenText),
      ),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  await db
    .prepare(
      "INSERT INTO sessions (token_hash, username, created_at, seen_at) VALUES (?1, 'window', ?2, ?2)",
    )
    .bind(hash, now)
    .run();
  const t = setup({ db });
  assert.equal((await t.get(tokenText)).status, 204);
  assert.equal((await t.put(tokenText, 0, "adopted")).status, 200);
  const [{ account_id }] = (
    await db.prepare("SELECT account_id FROM users").all()
  ).results;
  assert.ok(account_id);
  const [session] = (
    await db.prepare("SELECT account_id, auth_gen FROM sessions").all()
  ).results;
  assert.equal(session.account_id, account_id);
  assert.equal(session.auth_gen, 0);
  // The daily clean-up gives an instance to any account still without one.
  await db
    .prepare(
      `INSERT INTO users (username, auth_salt, auth_hash, wrapped_key,
         recovery_salt, recovery_hash, recovery_key, revision, size,
         created_at, updated_at)
       VALUES ('window2', 's', 'h', 'w', 'rs', 'rh', 'rk', 0, 0, ?1, ?1)`,
    )
    .bind(now)
    .run();
  await cleanup(db);
  assert.equal(
    await t.count("SELECT COUNT(*) AS n FROM users WHERE account_id IS NULL"),
    0,
  );
});
