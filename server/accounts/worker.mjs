/**
 * Riwaq accounts: a Cloudflare Worker with a D1 database (docs/ACCOUNTS.md).
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

async function readJson(request) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > MAX_JSON) refuse(413, "too_large");
  const text = await request.text();
  if (text.length > MAX_JSON) refuse(413, "too_large");
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

async function openSession(db, username, now) {
  const token = randomText(32);
  await db.batch([
    db
      .prepare(
        "INSERT INTO sessions (token_hash, username, created_at, seen_at) VALUES (?1, ?2, ?3, ?3)",
      )
      .bind(await sha256(token), username, now),
    // A user keeps at most MAX_SESSIONS devices signed in; the oldest go.
    db
      .prepare(
        `DELETE FROM sessions WHERE username = ?1 AND token_hash NOT IN
         (SELECT token_hash FROM sessions WHERE username = ?1 ORDER BY seen_at DESC LIMIT ?2)`,
      )
      .bind(username, MAX_SESSIONS),
  ]);
  return token;
}
async function session(db, request, now) {
  const token = /^Bearer (\S+)$/.exec(
    request.headers.get("Authorization") || "",
  )?.[1];
  if (!token || !TOKEN.test(token)) refuse(401, "unauthorized");
  const hash = await sha256(token);
  const row = await db
    .prepare("SELECT username, seen_at FROM sessions WHERE token_hash = ?1")
    .bind(hash)
    .first();
  if (!row) refuse(401, "unauthorized");
  if (now - row.seen_at > SESSION_DAYS * DAY) {
    await db
      .prepare("DELETE FROM sessions WHERE token_hash = ?1")
      .bind(hash)
      .run();
    refuse(401, "unauthorized");
  }
  // Written at most once a day per device, to spare the database.
  if (now - row.seen_at > DAY)
    await db
      .prepare("UPDATE sessions SET seen_at = ?1 WHERE token_hash = ?2")
      .bind(now, hash)
      .run();
  return { username: row.username, hash };
}

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
  // Expired counters go now and then.
  if (Math.random() < 0.02)
    await db
      .prepare("DELETE FROM attempts WHERE reset_at < ?1")
      .bind(now)
      .run();

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
    try {
      await db
        .prepare(
          `INSERT INTO users (username, auth_salt, auth_hash, wrapped_key,
             recovery_salt, recovery_hash, recovery_key, revision, size,
             created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, 0, ?8, ?8)`,
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
        )
        .run();
    } catch {
      refuse(409, "taken");
    }
    return reply(201, {
      token: await openSession(db, username, now),
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
    const user = await userRow(db, username);
    if (!(await proves(pepper, user?.auth_salt, user?.auth_hash, authSecret))) {
      await count(db, `login:${username}`, LIMITS.login, now);
      await count(db, addressKey("login"), LIMITS.loginAddress, now);
      refuse(401, "invalid_credentials");
    }
    return reply(200, {
      token: await openSession(db, username, now),
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
    const authSalt = randomText(16);
    // A new password signs every device out.
    await db.batch([
      db
        .prepare(
          "UPDATE users SET auth_salt = ?1, auth_hash = ?2, wrapped_key = ?3, updated_at = ?4 WHERE username = ?5",
        )
        .bind(
          authSalt,
          await sha256(pepper, authSalt, authSecret),
          wrappedKey,
          now,
          username,
        ),
      db.prepare("DELETE FROM sessions WHERE username = ?1").bind(username),
    ]);
    return reply(200, {
      token: await openSession(db, username, now),
      revision: user.revision,
    });
  }

  // Everything below needs a signed-in device.
  const { username, hash } = await session(db, request, now);

  if (method === "POST" && path === "/v1/logout") {
    await db
      .prepare("DELETE FROM sessions WHERE token_hash = ?1")
      .bind(hash)
      .run();
    return reply(204, null);
  }

  if (method === "GET" && path === "/v1/data") {
    const user = await userRow(db, username);
    if (!user) refuse(401, "unauthorized");
    const revision = String(user.revision);
    const headers = { "X-Riwaq-Revision": revision };
    if (user.revision === 0) return reply(204, null, headers);
    if (request.headers.get("If-None-Match") === revision)
      return reply(304, null, headers);
    const { results } = await db
      .prepare(
        "SELECT data FROM chunks WHERE username = ?1 AND revision = ?2 ORDER BY idx",
      )
      .bind(username, user.revision)
      .all();
    return reply(200, results.map((r) => r.data).join(""), headers);
  }

  if (method === "PUT" && path === "/v1/data") {
    const base = Number(request.headers.get("X-Riwaq-Base"));
    if (!Number.isInteger(base) || base < 0) refuse(400, "bad_request");
    if (Number(request.headers.get("Content-Length") || 0) > MAX_DATA)
      refuse(413, "too_large");
    const text = await request.text();
    if (!text || text.length > MAX_DATA)
      refuse(text ? 413 : 400, text ? "too_large" : "bad_request");
    const next = base + 1;
    const pieces = [];
    for (let at = 0; at < text.length; at += CHUNK)
      pieces.push(text.slice(at, at + CHUNK));
    let results;
    try {
      // One transaction: the new pieces, the revision moved only from the
      // base this device saw, then every piece not of the current revision
      // removed (the old data on success, the new pieces on a conflict).
      results = await db.batch([
        ...pieces.map((data, idx) =>
          db
            .prepare(
              "INSERT INTO chunks (username, revision, idx, data) VALUES (?1, ?2, ?3, ?4)",
            )
            .bind(username, next, idx, data),
        ),
        db
          .prepare(
            "UPDATE users SET revision = ?1, size = ?2, updated_at = ?3 WHERE username = ?4 AND revision = ?5",
          )
          .bind(next, text.length, now, username, base),
        db
          .prepare(
            "DELETE FROM chunks WHERE username = ?1 AND revision <> (SELECT revision FROM users WHERE username = ?1)",
          )
          .bind(username),
      ]);
    } catch {
      results = null;
    }
    const moved = results?.[pieces.length]?.meta?.changes === 1;
    if (!moved) {
      const user = await userRow(db, username);
      refuse(409, "conflict", { revision: user?.revision ?? 0 });
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
    if (!(await proves(pepper, user?.auth_salt, user?.auth_hash, authSecret))) {
      await count(db, `login:${username}`, LIMITS.login, now);
      refuse(401, "invalid_credentials");
    }
    const authSalt = randomText(16);
    // Other devices must sign in again with the new password.
    await db.batch([
      db
        .prepare(
          "UPDATE users SET auth_salt = ?1, auth_hash = ?2, wrapped_key = ?3, updated_at = ?4 WHERE username = ?5",
        )
        .bind(
          authSalt,
          await sha256(pepper, authSalt, newAuthSecret),
          wrappedKey,
          now,
          username,
        ),
      db
        .prepare(
          "DELETE FROM sessions WHERE username = ?1 AND token_hash <> ?2",
        )
        .bind(username, hash),
    ]);
    return reply(204, null);
  }

  if (method === "DELETE" && path === "/v1/account") {
    const body = await readJson(request);
    const authSecret = field(body, "authSecret", SECRET);
    if (await limited(db, `login:${username}`, LIMITS.login, now))
      refuse(429, "rate_limited");
    const user = await userRow(db, username);
    if (!(await proves(pepper, user?.auth_salt, user?.auth_hash, authSecret))) {
      await count(db, `login:${username}`, LIMITS.login, now);
      refuse(401, "invalid_credentials");
    }
    await db.batch([
      db.prepare("DELETE FROM chunks WHERE username = ?1").bind(username),
      db.prepare("DELETE FROM sessions WHERE username = ?1").bind(username),
      db.prepare("DELETE FROM users WHERE username = ?1").bind(username),
    ]);
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

export default {
  fetch: (request, env) => handle(request, env),
};
