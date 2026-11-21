// Codex's fourth review of PR #155 (Q9, docs/CLOUDFLARE-DATABASE-AUDIT-
// 2026-11-18.md, "Fifth pass"): the accounts Worker checked a session, then
// acted in later statements that did not all prove it again. A session
// issued before migration 0003 was bound to whatever account held its name
// when a second read ran; a pull read the data with a session revoked
// after the check; an upload's clean-up ran whether the upload was
// authorized or not; a failed database batch answered 409. Every race here
// is landed exactly between the check and the statement that acts. Real
// Worker code over Node's SQLite (server/accounts/local.mjs), where a D1
// batch is one transaction too.
import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../server/accounts/service.mjs";
import { sqliteD1 } from "../server/accounts/local.mjs";

const secret = (c) => c.repeat(43);
const wrapped = "W".repeat(80);
const NOW = 1_800_000_000_000;

async function sha(text) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function setup({ db = sqliteD1() } = {}) {
  const env = { DB: db, AUTH_PEPPER: "p".repeat(40) };
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
      { now: NOW },
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
  const login = async (username, c = "A") =>
    (
      await call("POST", "/v1/login", {
        body: { username, authSecret: secret(c) },
      })
    ).json?.token;
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
  const logout = (token) => call("POST", "/v1/logout", { token });
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
  const rows = async (sql, ...args) =>
    (
      await db
        .prepare(sql)
        .bind(...args)
        .all()
    ).results;
  return {
    db,
    signup,
    login,
    put,
    get,
    logout,
    changePassword,
    recover,
    remove,
    rows,
  };
}

/**
 * Pauses the request whose next statement matches `match`, right after that
 * statement answered, until `release()`: the moment another request lands.
 */
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
/** The moment a request has read its session and not yet acted. */
const afterSessionRead = (db) =>
  pauseAfter(db, (sql) => /^\s*SELECT s\.username, s\.seen_at/.test(sql));

/**
 * An account and a session as the Worker before migration 0003 left them
 * (no instance on the session; the account migrated or not), the session
 * issued a second after the account.
 */
async function legacy(db, username, { migratedUser = true } = {}) {
  const created = NOW - 86_400_000;
  await db
    .prepare(
      `INSERT INTO users (username, auth_salt, auth_hash, wrapped_key,
         recovery_salt, recovery_hash, recovery_key, revision, size,
         created_at, updated_at, account_id, auth_gen)
       VALUES (?1, 's', 'h', 'w', 'rs', 'rh', 'rk', 1, 6, ?2, ?2, ?3, 0)`,
    )
    .bind(username, created, migratedUser ? "a".repeat(32) : null)
    .run();
  await db
    .prepare(
      "INSERT INTO chunks (username, revision, idx, data) VALUES (?1, 1, 0, 'legacy')",
    )
    .bind(username)
    .run();
  const token = "L".repeat(43);
  await db
    .prepare(
      "INSERT INTO sessions (token_hash, username, created_at, seen_at) VALUES (?1, ?2, ?3, ?3)",
    )
    .bind(await sha(token), username, created + 1000)
    .run();
  return token;
}

/* 7.1: a session issued before 0003 is bound only where it is proved. */

test("Q9: a pre-0003 session is still adopted and works when nothing races it", async () => {
  for (const migratedUser of [true, false]) {
    const t = setup();
    const token = await legacy(t.db, "legacy", { migratedUser });
    const pulled = await t.get(token);
    assert.equal(pulled.status, 200);
    assert.equal(pulled.text, "legacy");
    const [session] = await t.rows("SELECT account_id, auth_gen FROM sessions");
    const [user] = await t.rows("SELECT account_id, auth_gen FROM users");
    assert.ok(user.account_id);
    assert.equal(session.account_id, user.account_id);
    assert.equal(session.auth_gen, user.auth_gen);
    assert.equal((await t.put(token, 1, "next")).status, 200);
  }
});

test("Q9: a pre-0003 session older than its account stays refused (ambiguous history)", async () => {
  const t = setup();
  const token = await legacy(t.db, "legacy");
  await t.db
    .prepare("UPDATE sessions SET created_at = created_at - 5000")
    .run();
  assert.equal((await t.get(token)).status, 401);
  assert.equal((await t.rows("SELECT * FROM sessions")).length, 0);
});

test("Q9: adopting a pre-0003 session racing a deletion and a new account of the same name binds nothing to the new account", async () => {
  const t = setup();
  const token = await legacy(t.db, "legacy");
  const pause = afterSessionRead(t.db);
  const pending = t.get(token);
  await pause.reached;
  // Meanwhile the account goes and someone else takes its name.
  await t.db.prepare("DELETE FROM chunks").run();
  await t.db
    .prepare("DELETE FROM sessions WHERE token_hash <> ?1")
    .bind(await sha(token))
    .run();
  await t.db.prepare("DELETE FROM users").run();
  const stranger = await t.signup("legacy", "S");
  assert.equal((await t.put(stranger, 0, "the new owner's")).status, 200);
  pause.release();
  const pulled = await pending;
  assert.equal(
    pulled.status,
    401,
    "the old session never opens the new account",
  );
  assert.notEqual(pulled.text, "the new owner's");
  const [owner] = await t.rows("SELECT account_id FROM users");
  const bound = await t.rows(
    "SELECT * FROM sessions WHERE account_id = ?1",
    owner.account_id,
  );
  assert.equal(bound.length, 1, "only the new owner's own session");
  assert.equal((await t.get(token)).status, 401, "and it stays refused");
});

for (const [name, change] of [
  [
    "a password change",
    async (t, other) =>
      assert.equal((await t.changePassword(other, "A", "B")).status, 204),
  ],
  [
    "a recovery",
    async (t) => assert.equal((await t.recover("legacy", "B")).status, 200),
  ],
]) {
  test(`Q9: adopting a pre-0003 session racing ${name} binds nothing and is refused`, async () => {
    const t = setup();
    // An account the new Worker knows, with a session the old one issued.
    const other = await t.signup("legacy");
    await t.db
      .prepare("UPDATE users SET created_at = ?1")
      .bind(NOW - 5000)
      .run();
    const token = "L".repeat(43);
    await t.db
      .prepare(
        "INSERT INTO sessions (token_hash, username, created_at, seen_at) VALUES (?1, 'legacy', ?2, ?2)",
      )
      .bind(await sha(token), NOW - 1000)
      .run();
    const pause = afterSessionRead(t.db);
    const pending = t.get(token);
    await pause.reached;
    await change(t, other);
    pause.release();
    assert.equal((await pending).status, 401);
    assert.equal(
      (
        await t.rows(
          "SELECT * FROM sessions WHERE token_hash = ?1",
          await sha(token),
        )
      ).length,
      0,
    );
  });
}

/* 7.2: a pull proves the session in the statement that reads. */

const revocations = [
  ["its own sign-out (another tab)", async (t, token) => t.logout(token)],
  [
    "a password change on another device",
    async (t, token, other) => t.changePassword(other, "A", "B"),
  ],
  ["a recovery", async (t) => t.recover("abadi", "B")],
  ["the account's deletion", async (t, token, other) => t.remove(other)],
];
for (const [name, revoke] of revocations)
  for (const [state, prepare, seen] of [
    ["data", async (t, a) => t.put(a, 0, "secret data"), undefined],
    ["no data (204)", async () => {}, undefined],
    ["an unchanged revision (304)", async (t, a) => t.put(a, 0, "x"), 1],
  ])
    test(`Q9: a pull of ${state} racing ${name} answers 401`, async () => {
      const t = setup();
      const a = await t.signup("abadi");
      const other = await t.login("abadi");
      await prepare(t, a);
      const pause = afterSessionRead(t.db);
      const pending = t.get(a, seen);
      await pause.reached;
      await revoke(t, a, other);
      pause.release();
      const pulled = await pending;
      assert.equal(pulled.status, 401, JSON.stringify(pulled));
      assert.equal(pulled.text.includes("secret data"), false);
    });

test("Q9: a pull racing another device's upload of the same account still reads one committed state (N9 kept)", async () => {
  const t = setup();
  const a = await t.signup("abadi");
  const b = await t.login("abadi");
  assert.equal((await t.put(a, 0, "one")).status, 200);
  const pause = pauseAfter(t.db, (sql) =>
    sql.startsWith("SELECT revision FROM users"),
  );
  const pending = t.get(a);
  await pause.reached;
  assert.equal((await t.put(b, 1, "two")).status, 200);
  pause.release();
  const pulled = await pending;
  assert.equal(pulled.status, 200);
  assert.equal(pulled.revision, "2");
  assert.equal(pulled.text, "two");
});

/* 7.3 and 7.4: an upload's clean-up is its own; a failure is not a conflict. */

async function withLeftovers(t, token) {
  assert.equal((await t.put(token, 0, "kept")).status, 200);
  // Pieces a crash left at a revision that is not current.
  await t.db
    .prepare(
      "INSERT INTO chunks (username, revision, idx, data) VALUES ('abadi', 7, 0, 'left')",
    )
    .run();
}
const leftovers = (t) =>
  t.rows("SELECT revision, data FROM chunks WHERE revision = 7");
const current = (t) =>
  t.rows(
    "SELECT u.revision, c.data FROM users u JOIN chunks c ON c.username = u.username AND c.revision = u.revision",
  );

test("Q9: an upload whose session is signed out meanwhile deletes nothing, writes nothing, and is told 401", async () => {
  const t = setup();
  const token = await t.signup("abadi");
  await withLeftovers(t, token);
  const pause = afterSessionRead(t.db);
  const pending = t.put(token, 1, "never");
  await pause.reached;
  await t.logout(token);
  pause.release();
  assert.equal((await pending).status, 401);
  assert.equal((await leftovers(t)).length, 1, "its clean-up did not run");
  assert.deepEqual(
    (await current(t)).map((r) => [r.revision, r.data]),
    [[1, "kept"]],
  );
});

test("Q9: a conflicting upload (an old base) deletes nothing; an upload that moves the revision cleans up", async () => {
  const t = setup();
  const token = await t.signup("abadi");
  await withLeftovers(t, token);
  const stale = await t.put(token, 0, "stale");
  assert.equal(stale.status, 409);
  assert.equal(stale.json.revision, 1);
  assert.equal((await leftovers(t)).length, 1);
  assert.equal((await t.put(token, 1, "moved")).status, 200);
  assert.equal((await leftovers(t)).length, 0, "its own clean-up ran");
  assert.deepEqual(
    (await t.rows("SELECT revision, data FROM chunks")).map((r) => [
      r.revision,
      r.data,
    ]),
    [[2, "moved"]],
  );
});

test("Q9: an upload racing a password change from another device deletes nothing", async () => {
  const t = setup();
  const token = await t.signup("abadi");
  const other = await t.login("abadi");
  await withLeftovers(t, token);
  const pause = afterSessionRead(t.db);
  const pending = t.put(token, 1, "never");
  await pause.reached;
  assert.equal((await t.changePassword(other, "A", "B")).status, 204);
  pause.release();
  assert.equal((await pending).status, 401);
  assert.equal((await leftovers(t)).length, 1);
  assert.deepEqual(
    (await current(t)).map((r) => r.data),
    ["kept"],
  );
});

test("Q9: a database batch that fails answers 503, not a conflict, and changes nothing", async () => {
  const t = setup();
  const token = await t.signup("abadi");
  await withLeftovers(t, token);
  const batch = t.db.batch;
  t.db.batch = (statements) =>
    batch([...statements, t.db.prepare("SELECT * FROM missing_table")]);
  const r = await t.put(token, 1, "second");
  t.db.batch = batch;
  assert.equal(r.status, 503);
  assert.equal(r.json.error, "try_again");
  assert.equal((await leftovers(t)).length, 1);
  const pulled = await t.get(token);
  assert.equal(pulled.revision, "1");
  assert.equal(pulled.text, "kept");
  // A genuine conflict stays a conflict, and the device's retry works.
  const b = await t.login("abadi");
  assert.equal((await t.put(b, 1, "from b")).status, 200);
  const conflict = await t.put(token, 1, "from a");
  assert.equal(conflict.status, 409);
  assert.equal(conflict.json.revision, 2);
  assert.equal((await t.put(token, 2, "from a")).status, 200);
});
