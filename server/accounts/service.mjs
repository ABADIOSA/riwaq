import { usageRoute } from "./usage.mjs";
/**
 * Riwaq accounts: a Cloudflare Worker with a D1 database (docs/ACCOUNTS.md).
 * The Worker's entry is worker.mjs, which exports only its handlers; this
 * module holds the service, for it and for the tests (local.mjs).
 *
 * Accounts are optional and end-to-end encrypted. The device derives two
 * secrets from the password (core/account.mjs): one proves the password to
 * this server, the other never leaves the device and unwraps the account's
 * data key. The server keeps only:
 *
 * - a peppered hash of the proof (and of the recovery code's proof);
 * - the data key wrapped by the password, and wrapped by the recovery code;
 * - the account's data, sealed on the device, as opaque base64 text.
 *
 * It cannot read anyone's library, settings or keys, and a stolen database
 * gives an attacker hashes of secrets that already cost a scrypt per guess.
 *
 * Bindings: DB (D1), AUTH_PEPPER (secret, ≥ 32 characters), ALLOWED_ORIGINS
 * (comma-separated web origins; requests without an Origin, such as the
 * desktop app's, are always accepted).
 */

export const API_VERSION = 1;
const USERNAME = /^[a-z0-9][a-z0-9_.-]{2,31}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;
const WRAPPED = /^[A-Za-z0-9_-]{40,200}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const MAX_JSON = 16 * 1024;
// About 5 MB of sealed data, carried as base64 text.
export const MAX_DATA = 7 * 1024 * 1024;
const CHUNK = 1_500_000;
const DAY = 86400000;
const SESSION_DAYS = 180;
const MAX_SESSIONS = 20;
// [attempts, window]
const LIMITS = {
  login: [10, 15 * 60000],
  loginAddress: [30, 15 * 60000],
  signupAddress: [5, 60 * 60000],
  recover: [5, 60 * 60000],
};

const encoder = new TextEncoder();
const hex = (buffer) =>
  [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
async function sha256(...parts) {
  return hex(
    await crypto.subtle.digest("SHA-256", encoder.encode(parts.join("\u0000"))),
  );
}
function randomText(bytes) {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...raw))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
/** Equal-length strings compared without an early exit. */
function equal(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length)
    return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

class Refusal extends Error {
  constructor(status, code, extra = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
const refuse = (status, code, extra) => {
  throw new Refusal(status, code, extra);
};

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return {};
  const allowed = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  if (!allowed.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, If-None-Match, X-Riwaq-Base",
    "Access-Control-Expose-Headers": "X-Riwaq-Revision",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
const BASE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
const reply = (status, body, headers = {}) =>
  new Response(
    body === null || body === undefined
      ? null
      : typeof body === "string"
        ? body
        : JSON.stringify(body),
    {
      status,
      headers: {
        ...BASE_HEADERS,
        ...(typeof body === "string"
          ? { "Content-Type": "text/plain; charset=utf-8" }
          : body
            ? { "Content-Type": "application/json" }
            : {}),
        ...headers,
      },
    },
  );

/**
 * The body as text, read piece by piece and cut off past `max` bytes, so
 * a request without a Content-Length (chunked) cannot make the Worker hold
 * more than the limit (database audit 2026-11-18, CF3).
 */
export async function readBounded(request, max) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > max) refuse(413, "too_large");
  const reader = request.body?.getReader();
  if (!reader) return "";
  const parts = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > max) refuse(413, "too_large");
      parts.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const all = new Uint8Array(bytes);
  let at = 0;
  for (const part of parts) {
    all.set(part, at);
    at += part.byteLength;
  }
  return new TextDecoder().decode(all);
}

async function readJson(request) {
  const text = await readBounded(request, MAX_JSON);
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw 0;
    return body;
  } catch {
    refuse(400, "bad_request");
  }
}
const field = (body, name, pattern) => {
  const value = body[name];
  if (typeof value !== "string" || !pattern.test(value))
    refuse(400, "bad_request", { field: name });
  return value;
};

// --- Limits --------------------------------------------------------------

async function limited(db, key, [max], now) {
  const row = await db
    .prepare("SELECT count, reset_at FROM attempts WHERE key = ?1")
    .bind(key)
    .first();
  return !!row && row.reset_at > now && row.count >= max;
}
async function count(db, key, [, window], now) {
  await db
    .prepare(
      `INSERT INTO attempts (key, count, reset_at) VALUES (?1, 1, ?2)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN reset_at > ?3 THEN count + 1 ELSE 1 END,
         reset_at = CASE WHEN reset_at > ?3 THEN reset_at ELSE ?2 END`,
    )
    .bind(key, now + window, now)
    .run();
}

// --- Sessions ------------------------------------------------------------
//
// An account is an instance: a random `account_id` never reused, and a
// credential generation `auth_gen` that a password change or a recovery
// moves on (migration 0003; PR #155 third review, CF1/CF2). A username can
// be deleted and taken again, so it is never the identity a session or a
// write is bound to. A session records the instance and generation it was
// issued for, and is valid only while the account still has both.

/** The SQL condition "the account `?u` is still instance `?i`, generation `?g`". */
const instance = (u, i, g) =>
  `EXISTS (SELECT 1 FROM users WHERE username = ${u} AND account_id = ${i} AND auth_gen = ${g})`;
/**
 * "This transaction's own credential change took effect": the instance at
 * the generation it moved to WITH the salt it wrote. A generation alone is
 * not enough: a password change and a recovery racing from the same
 * generation both move it to the same next number.
 */
const changed = (u, i, g, salt) =>
  `EXISTS (SELECT 1 FROM users WHERE username = ${u} AND account_id = ${i} AND auth_gen = ${g} AND auth_salt = ${salt})`;

/**
 * Gives an account written without an instance (by the Worker that ran
 * before migration 0003, between the migration and this Worker's
 * deployment) its instance, once.
 */
async function adopt(db, user) {
  if (!user || user.account_id) return user;
  await db
    .prepare(
      "UPDATE users SET account_id = ?1 WHERE username = ?2 AND account_id IS NULL",
    )
    .bind(randomText(16), user.username)
    .run();
  return userRow(db, user.username);
}

/**
 * Issues a session for the account instance and generation whose secret
 * was just checked, in one transaction that writes it only while the
 * account is still that instance at that generation: a sign-in racing a
 * deletion, a deletion and a new account of the same name, a password
 * change or a recovery leaves no session (CF1).
 */
async function openSession(db, username, accountId, authGen, now) {
  const token = randomText(32);
  const [made] = await db.batch([
    db
      .prepare(
        `INSERT INTO sessions (token_hash, username, created_at, seen_at, account_id, auth_gen)
         SELECT ?1, ?2, ?3, ?3, ?4, ?5 WHERE ${instance("?2", "?4", "?5")}`,
      )
      .bind(await sha256(token), username, now, accountId, authGen),
    // A user keeps at most MAX_SESSIONS devices signed in; the oldest go.
    db
      .prepare(
        `DELETE FROM sessions WHERE username = ?1 AND token_hash NOT IN
         (SELECT token_hash FROM sessions WHERE username = ?1 ORDER BY seen_at DESC LIMIT ?2)`,
      )
      .bind(username, MAX_SESSIONS),
  ]);
  if (made?.meta?.changes !== 1) refuse(401, "unauthorized");
  return token;
}
async function session(db, request, now) {
  const token = /^Bearer (\S+)$/.exec(
    request.headers.get("Authorization") || "",
  )?.[1];
  if (!token || !TOKEN.test(token)) refuse(401, "unauthorized");
  const hash = await sha256(token);
  const row = await db
    .prepare(
      `SELECT s.username, s.seen_at, s.created_at, s.account_id, s.auth_gen,
         u.created_at AS since, u.account_id AS current_id,
         u.auth_gen AS current_gen
       FROM sessions s LEFT JOIN users u ON u.username = s.username
       WHERE s.token_hash = ?1`,
    )
    .bind(hash)
    .first();
  if (!row) refuse(401, "unauthorized");
  const gone = async () => {
    await db
      .prepare("DELETE FROM sessions WHERE token_hash = ?1")
      .bind(hash)
      .run();
    refuse(401, "unauthorized");
  };
  if (row.since === null || row.since === undefined) return gone();
  if (now - row.seen_at > SESSION_DAYS * DAY) return gone();
  if (row.account_id === null || row.account_id === undefined) {
    // Issued before migration 0003 (or by the Worker before this one in
    // the window after it): the old rule decides, a session not older
    // than its account, and it is bound to that account's instance now.
    if (row.since > row.created_at) return gone();
    const user = await adopt(db, await userRow(db, row.username));
    if (!user) return gone();
    await db
      .prepare(
        "UPDATE sessions SET account_id = ?1, auth_gen = ?2 WHERE token_hash = ?3 AND account_id IS NULL",
      )
      .bind(user.account_id, user.auth_gen, hash)
      .run();
    row.account_id = user.account_id;
    row.auth_gen = user.auth_gen;
  } else if (
    row.account_id !== row.current_id ||
    Number(row.auth_gen) !== Number(row.current_gen)
  )
    // Another account of the same name, or a password changed since.
    return gone();
  // Written at most once a day per device, to spare the database.
  if (now - row.seen_at > DAY)
    await db
      .prepare("UPDATE sessions SET seen_at = ?1 WHERE token_hash = ?2")
      .bind(now, hash)
      .run();
  return {
    username: row.username,
    hash,
    accountId: row.account_id,
    authGen: Number(row.auth_gen),
  };
}

/** The SQL condition "this session is still valid for that instance". */
const stillSigned = (h, i, g) =>
  `EXISTS (SELECT 1 FROM sessions WHERE token_hash = ${h} AND account_id = ${i} AND auth_gen = ${g})`;

// --- Users ---------------------------------------------------------------

const userRow = (db, username) =>
  db.prepare("SELECT * FROM users WHERE username = ?1").bind(username).first();

/** Checks a proof against a stored hash; unknown users cost the same. */
async function proves(pepper, salt, hash, secret) {
  const candidate = await sha256(pepper, salt || "0".repeat(32), secret);
  return equal(candidate, hash || "x".repeat(64)) && !!salt;
}

async function routes(request, env, now) {
  const db = env.DB;
  const pepper = String(env.AUTH_PEPPER || "");
  if (!db || pepper.length < 32) refuse(500, "server_misconfigured");
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  const method = request.method;
  const address = await sha256(
    pepper,
    "address",
    request.headers.get("CF-Connecting-IP") || "unknown",
  );
  const addressKey = (kind) => `${kind}:${address.slice(0, 32)}`;
  if (["/v1/usage", "/v1/admin/usage"].includes(path))
    return usageRoute(request, env, now, {
      reply,
      sha256,
      equal,
      limited,
      count,
      addressKey,
    });

  if (method === "GET" && path === "/v1/health")
    return reply(200, { ok: true, version: API_VERSION });

  if (method === "POST" && path === "/v1/signup") {
    if (await limited(db, addressKey("signup"), LIMITS.signupAddress, now))
      refuse(429, "rate_limited");
    const body = await readJson(request);
    const username = field(body, "username", USERNAME);
    const authSecret = field(body, "authSecret", SECRET);
    const wrappedKey = field(body, "wrappedKey", WRAPPED);
    const recoveryAuth = field(body, "recoveryAuth", SECRET);
    const recoveryKey = field(body, "recoveryKey", WRAPPED);
    await count(db, addressKey("signup"), LIMITS.signupAddress, now);
    const authSalt = randomText(16);
    const recoverySalt = randomText(16);
    const accountId = randomText(16);
    try {
      await db
        .prepare(
          `INSERT INTO users (username, auth_salt, auth_hash, wrapped_key,
             recovery_salt, recovery_hash, recovery_key, revision, size,
             created_at, updated_at, account_id, auth_gen)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, 0, ?8, ?8, ?9, 0)`,
        )
        .bind(
          username,
          authSalt,
          await sha256(pepper, authSalt, authSecret),
          wrappedKey,
          recoverySalt,
          await sha256(pepper, recoverySalt, recoveryAuth),
          recoveryKey,
          now,
          accountId,
        )
        .run();
    } catch {
      refuse(409, "taken");
    }
    return reply(201, {
      token: await openSession(db, username, accountId, 0, now),
      revision: 0,
    });
  }

  if (method === "POST" && path === "/v1/login") {
    const body = await readJson(request);
    const username = field(body, "username", USERNAME);
    const authSecret = field(body, "authSecret", SECRET);
    if (
      (await limited(db, `login:${username}`, LIMITS.login, now)) ||
      (await limited(db, addressKey("login"), LIMITS.loginAddress, now))
    )
      refuse(429, "rate_limited");
    let user = await userRow(db, username);
    if (!(await proves(pepper, user?.auth_salt, user?.auth_hash, authSecret))) {
      await count(db, `login:${username}`, LIMITS.login, now);
      await count(db, addressKey("login"), LIMITS.loginAddress, now);
      refuse(401, "invalid_credentials");
    }
    // The session is for the instance and generation this secret was
    // checked against, never for whatever the name holds later (CF1).
    const checked = { id: user.account_id, gen: user.auth_gen };
    if (!checked.id) {
      // Written before migration 0003's Worker: given its instance now,
      // and only if it is still the account whose secret was checked.
      const hashChecked = user.auth_hash;
      user = await adopt(db, user);
      if (
        !user ||
        user.auth_gen !== checked.gen ||
        user.auth_hash !== hashChecked
      )
        refuse(401, "unauthorized");
      checked.id = user.account_id;
    }
    return reply(200, {
      token: await openSession(db, username, checked.id, checked.gen, now),
      wrappedKey: user.wrapped_key,
      revision: user.revision,
    });
  }

  if (method === "POST" && path === "/v1/recover/start") {
    const body = await readJson(request);
    const username = field(body, "username", USERNAME);
    const recoveryAuth = field(body, "recoveryAuth", SECRET);
    if (await limited(db, `recover:${username}`, LIMITS.recover, now))
      refuse(429, "rate_limited");
    const user = await userRow(db, username);
    if (
      !(await proves(
        pepper,
        user?.recovery_salt,
        user?.recovery_hash,
        recoveryAuth,
      ))
    ) {
      await count(db, `recover:${username}`, LIMITS.recover, now);
      refuse(401, "invalid_credentials");
    }
    return reply(200, { recoveryKey: user.recovery_key });
  }

  if (method === "POST" && path === "/v1/recover/finish") {
    const body = await readJson(request);
    const username = field(body, "username", USERNAME);
    const recoveryAuth = field(body, "recoveryAuth", SECRET);
    const authSecret = field(body, "authSecret", SECRET);
    const wrappedKey = field(body, "wrappedKey", WRAPPED);
    if (await limited(db, `recover:${username}`, LIMITS.recover, now))
      refuse(429, "rate_limited");
    const user = await userRow(db, username);
    if (
      !(await proves(
        pepper,
        user?.recovery_salt,
        user?.recovery_hash,
        recoveryAuth,
      ))
    ) {
      await count(db, `recover:${username}`, LIMITS.recover, now);
      refuse(401, "invalid_credentials");
    }
    const known = await adopt(db, user);
    if (!known || known.recovery_hash !== user.recovery_hash)
      refuse(401, "invalid_credentials");
    const authSalt = randomText(16);
    const token = randomText(32);
    const gen = known.auth_gen;
    // One transaction, bound to the instance and generation whose recovery
    // code was checked (CF1): the new password, every device signed out,
    // and this device's new session at the next generation. A deletion, a
    // new account of the name, or a password changed meanwhile changes
    // nothing and is refused.
    const done = await db.batch([
      db
        .prepare(
          `UPDATE users SET auth_salt = ?1, auth_hash = ?2, wrapped_key = ?3,
             updated_at = ?4, auth_gen = auth_gen + 1
           WHERE username = ?5 AND account_id = ?6 AND auth_gen = ?7`,
        )
        .bind(
          authSalt,
          await sha256(pepper, authSalt, authSecret),
          wrappedKey,
          now,
          username,
          known.account_id,
          gen,
        ),
      db
        .prepare(
          `DELETE FROM sessions WHERE username = ?1 AND ${changed("?1", "?2", "?3", "?4")}`,
        )
        .bind(username, known.account_id, gen + 1, authSalt),
      db
        .prepare(
          `INSERT INTO sessions (token_hash, username, created_at, seen_at, account_id, auth_gen)
           SELECT ?1, ?2, ?3, ?3, ?4, ?5 WHERE ${changed("?2", "?4", "?5", "?6")}`,
        )
        .bind(
          await sha256(token),
          username,
          now,
          known.account_id,
          gen + 1,
          authSalt,
        ),
    ]);
    if (done[0]?.meta?.changes !== 1 || done[2]?.meta?.changes !== 1)
      refuse(401, "invalid_credentials");
    return reply(200, { token, revision: known.revision });
  }

  // Everything below needs a signed-in device.
  const { username, hash, accountId, authGen } = await session(
    db,
    request,
    now,
  );

  if (method === "POST" && path === "/v1/logout") {
    await db
      .prepare("DELETE FROM sessions WHERE token_hash = ?1")
      .bind(hash)
      .run();
    return reply(204, null);
  }

  if (method === "GET" && path === "/v1/data") {
    const seen = request.headers.get("If-None-Match");
    // The revision alone first, so an unchanged account costs one row.
    const head = await db
      .prepare(
        "SELECT revision FROM users WHERE username = ?1 AND account_id = ?2",
      )
      .bind(username, accountId)
      .first();
    if (!head) refuse(401, "unauthorized");
    if (head.revision === 0)
      return reply(204, null, { "X-Riwaq-Revision": "0" });
    if (seen === String(head.revision))
      return reply(304, null, { "X-Riwaq-Revision": seen });
    // Then the revision, its size and its pieces in ONE statement, so they
    // come from one committed state (third review, N9): an upload landing
    // between two reads once returned 200 with the old revision and no
    // data. What is sent is checked whole before it goes; a state that
    // does not add up is read again, and never sent as a success.
    for (let attempt = 0; attempt < 3; attempt++) {
      const { results } = await db
        .prepare(
          `SELECT u.revision AS revision, u.size AS size, c.idx AS idx, c.data AS data
           FROM users u LEFT JOIN chunks c
             ON c.username = u.username AND c.revision = u.revision
           WHERE u.username = ?1 AND u.account_id = ?2
           ORDER BY c.idx`,
        )
        .bind(username, accountId)
        .all();
      if (!results.length) refuse(401, "unauthorized");
      const revision = results[0].revision;
      const headers = { "X-Riwaq-Revision": String(revision) };
      if (revision === 0) return reply(204, null, headers);
      if (seen === String(revision)) return reply(304, null, headers);
      const pieces = results.filter((r) => r.data !== null);
      const text = pieces.map((r) => r.data).join("");
      const whole =
        pieces.length > 0 &&
        pieces.every((r, i) => r.idx === i) &&
        text.length === results[0].size;
      if (whole) return reply(200, text, headers);
    }
    refuse(503, "try_again");
  }

  if (method === "PUT" && path === "/v1/data") {
    const base = Number(request.headers.get("X-Riwaq-Base"));
    if (!Number.isInteger(base) || base < 0) refuse(400, "bad_request");
    const text = await readBounded(request, MAX_DATA);
    if (!text) refuse(400, "bad_request");
    const next = base + 1;
    const pieces = [];
    for (let at = 0; at < text.length; at += CHUNK)
      pieces.push(text.slice(at, at + CHUNK));
    let results;
    try {
      // One transaction (database audit 2026-11-18, CF2): pieces left at
      // the next revision by an older failure are cleared; the new pieces
      // are written only while the account still exists at the base this
      // device saw (a conflict or a deleted account writes nothing, where
      // it once wrote every piece and deleted it again); the revision
      // moves only from that base; then every piece not of the current
      // revision goes, all of them when the account is gone (NULL once
      // matched nothing and left a deleted account's data behind).
      //
      // Fourth pass (CF2): every statement also requires the account to be
      // the instance and credential generation this session was issued
      // for, and the session itself to be valid, at the moment the
      // transaction runs: a deletion, a new account of the same name, a
      // password change or a revoked session (another device's sign-out
      // of this one) during the upload writes nothing.
      const current = `EXISTS (SELECT 1 FROM users WHERE username = ?1 AND revision = ?3 AND account_id = ?6 AND auth_gen = ?7) AND ${stillSigned("?8", "?6", "?7")}`;
      const bound = (statement, ...values) =>
        statement.bind(...values, accountId, authGen, hash);
      results = await db.batch([
        bound(
          db.prepare(
            `DELETE FROM chunks WHERE username = ?1 AND revision = ?2 AND ${current}`,
          ),
          username,
          next,
          base,
          null,
          null,
        ),
        ...pieces.map((data, idx) =>
          bound(
            db.prepare(
              `INSERT INTO chunks (username, revision, idx, data)
               SELECT ?1, ?2, ?4, ?5 WHERE ${current}`,
            ),
            username,
            next,
            base,
            idx,
            data,
          ),
        ),
        bound(
          db.prepare(
            `UPDATE users SET revision = ?2, size = ?4, updated_at = ?5
             WHERE username = ?1 AND ${current}`,
          ),
          username,
          next,
          base,
          text.length,
          now,
        ),
        db
          .prepare(
            "DELETE FROM chunks WHERE username = ?1 AND revision <> COALESCE((SELECT revision FROM users WHERE username = ?1), -1)",
          )
          .bind(username),
      ]);
    } catch {
      results = null;
    }
    const moved = results?.[pieces.length + 1]?.meta?.changes === 1;
    if (!moved) {
      // A session that ended meanwhile is told so; a newer revision of the
      // same account is a conflict, as before.
      const still = await db
        .prepare(
          `SELECT u.revision AS revision FROM users u
           WHERE u.username = ?1 AND u.account_id = ?2 AND u.auth_gen = ?3
             AND ${stillSigned("?4", "?2", "?3")}`,
        )
        .bind(username, accountId, authGen, hash)
        .first();
      if (!still) refuse(401, "unauthorized");
      refuse(409, "conflict", { revision: still.revision ?? 0 });
    }
    return reply(200, { revision: next }, { "X-Riwaq-Revision": String(next) });
  }

  if (method === "POST" && path === "/v1/password") {
    const body = await readJson(request);
    const authSecret = field(body, "authSecret", SECRET);
    const newAuthSecret = field(body, "newAuthSecret", SECRET);
    const wrappedKey = field(body, "wrappedKey", WRAPPED);
    if (await limited(db, `login:${username}`, LIMITS.login, now))
      refuse(429, "rate_limited");
    const user = await userRow(db, username);
    if (
      user?.account_id !== accountId ||
      !(await proves(pepper, user?.auth_salt, user?.auth_hash, authSecret))
    ) {
      await count(db, `login:${username}`, LIMITS.login, now);
      refuse(401, "invalid_credentials");
    }
    const authSalt = randomText(16);
    // One transaction, bound to this session's instance and generation
    // (CF1): the new password and the next generation; every other device
    // signed out; this device's session moved to the new generation. A
    // sign-in that checked the old password meanwhile issues nothing.
    const done = await db.batch([
      db
        .prepare(
          `UPDATE users SET auth_salt = ?1, auth_hash = ?2, wrapped_key = ?3,
             updated_at = ?4, auth_gen = auth_gen + 1
           WHERE username = ?5 AND account_id = ?6 AND auth_gen = ?7
             AND ${stillSigned("?8", "?6", "?7")}`,
        )
        .bind(
          authSalt,
          await sha256(pepper, authSalt, newAuthSecret),
          wrappedKey,
          now,
          username,
          accountId,
          authGen,
          hash,
        ),
      db
        .prepare(
          `DELETE FROM sessions WHERE username = ?1 AND token_hash <> ?2
             AND ${changed("?1", "?3", "?4", "?5")}`,
        )
        .bind(username, hash, accountId, authGen + 1, authSalt),
      db
        .prepare(
          `UPDATE sessions SET auth_gen = ?2 WHERE token_hash = ?1
             AND ${changed("?3", "?4", "?2", "?5")}`,
        )
        .bind(hash, authGen + 1, username, accountId, authSalt),
    ]);
    if (done[0]?.meta?.changes !== 1) refuse(401, "unauthorized");
    return reply(204, null);
  }

  if (method === "DELETE" && path === "/v1/account") {
    const body = await readJson(request);
    const authSecret = field(body, "authSecret", SECRET);
    if (await limited(db, `login:${username}`, LIMITS.login, now))
      refuse(429, "rate_limited");
    const user = await userRow(db, username);
    if (
      user?.account_id !== accountId ||
      !(await proves(pepper, user?.auth_salt, user?.auth_hash, authSecret))
    ) {
      await count(db, `login:${username}`, LIMITS.login, now);
      refuse(401, "invalid_credentials");
    }
    // Only the instance this session belongs to, at its generation, with
    // the session still valid; its data and sessions first (CF2).
    const owned = `${instance("?1", "?2", "?3")} AND ${stillSigned("?4", "?2", "?3")}`;
    const done = await db.batch([
      db
        .prepare(`DELETE FROM chunks WHERE username = ?1 AND ${owned}`)
        .bind(username, accountId, authGen, hash),
      db
        .prepare(
          `DELETE FROM sessions WHERE username = ?1 AND token_hash <> ?4 AND ${owned}`,
        )
        .bind(username, accountId, authGen, hash),
      db
        .prepare(
          `DELETE FROM users WHERE username = ?1 AND account_id = ?2 AND auth_gen = ?3
             AND ${stillSigned("?4", "?2", "?3")}`,
        )
        .bind(username, accountId, authGen, hash),
      db
        .prepare(
          `DELETE FROM sessions WHERE token_hash = ?4 AND NOT EXISTS
             (SELECT 1 FROM users WHERE username = ?1 AND account_id = ?2 AND auth_gen = ?3)`,
        )
        .bind(username, accountId, authGen, hash),
    ]);
    if (done[2]?.meta?.changes !== 1) refuse(401, "unauthorized");
    return reply(204, null);
  }

  refuse(404, "not_found");
}

/** The Worker's entry, also called directly by the tests. */
export async function handle(request, env, { now = Date.now() } = {}) {
  const cors = corsHeaders(request, env);
  if (cors === null) return reply(403, { error: "forbidden_origin" });
  if (request.method === "OPTIONS") return reply(204, null, cors);
  try {
    const response = await routes(request, env, now);
    for (const [name, value] of Object.entries(cors))
      response.headers.set(name, value);
    return response;
  } catch (error) {
    if (error instanceof Refusal)
      return reply(error.status, { error: error.code, ...error.extra }, cors);
    // The message only: request bodies carry secrets and are never logged.
    console.error("riwaq-accounts:", error?.message || "error");
    return reply(500, { error: "server_error" }, cors);
  }
}

/**
 * The daily clean-up (the cron in wrangler.toml), one transaction:
 * usage records past 31 days; rate-limit counters whose window ended (a
 * sweep that once ran on 2% of all requests and read the whole table
 * each time, CF4); sessions unused for SESSION_DAYS, which were removed
 * only when presented again; and any session or piece of data without
 * its account (CF1, CF2: none exist today; this keeps it so).
 */
export function cleanup(db, now = Date.now()) {
  return db.batch([
    db
      .prepare("DELETE FROM usage_devices WHERE seen_at < ?1")
      .bind(now - 31 * DAY),
    db.prepare("DELETE FROM attempts WHERE reset_at < ?1").bind(now),
    db
      .prepare("DELETE FROM sessions WHERE seen_at < ?1")
      .bind(now - SESSION_DAYS * DAY),
    // An account written by the Worker before migration 0003's (between
    // the migration and this Worker's deployment) gets its instance.
    db.prepare(
      "UPDATE users SET account_id = lower(hex(randomblob(16))) WHERE account_id IS NULL",
    ),
    // A session is kept only while its account is the instance, at the
    // generation, it was issued for; one issued before migration 0003 by
    // the old rule (not older than its account).
    db.prepare(
      `DELETE FROM sessions WHERE NOT EXISTS (SELECT 1 FROM users u
         WHERE u.username = sessions.username AND (
           (sessions.account_id IS NOT NULL AND u.account_id = sessions.account_id
              AND u.auth_gen = sessions.auth_gen)
           OR (sessions.account_id IS NULL AND u.created_at <= sessions.created_at)))`,
    ),
    db.prepare(
      "DELETE FROM chunks WHERE NOT EXISTS (SELECT 1 FROM users WHERE users.username = chunks.username AND users.revision = chunks.revision)",
    ),
  ]);
}
