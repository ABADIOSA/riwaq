import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { handle, MAX_DATA } from "../server/accounts/worker.mjs";
import { sqliteD1 } from "../server/accounts/local.mjs";

// The accounts Worker (server/accounts/worker.mjs) over Node's SQLite.

const secret = (c) => c.repeat(43);
const wrapped = "W".repeat(80);
function setup(extra = {}) {
  const env = {
    DB: sqliteD1(),
    AUTH_PEPPER: "p".repeat(40),
    ALLOWED_ORIGINS: "https://abadiosa.github.io",
    ...extra,
  };
  let now = 1_800_000_000_000;
  const call = async (
    method,
    path,
    { body, headers = {}, ip = "1.1.1.1" } = {},
  ) => {
    const response = await handle(
      new Request(`https://accounts.test${path}`, {
        method,
        headers: {
          "CF-Connecting-IP": ip,
          ...(body && typeof body === "object"
            ? { "Content-Type": "application/json" }
            : {}),
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
    return { status: response.status, json, text, headers: response.headers };
  };
  const signup = (username, ip) =>
    call("POST", "/v1/signup", {
      ip,
      body: {
        username,
        authSecret: secret("A"),
        wrappedKey: wrapped,
        recoveryAuth: secret("R"),
        recoveryKey: wrapped,
      },
    });
  return { env, call, signup, later: (ms) => (now += ms) };
}

test("sign-in failures are limited per account and per address", async () => {
  const { call, signup, later } = setup();
  assert.equal((await signup("abadi")).status, 201);
  const wrong = (ip) =>
    call("POST", "/v1/login", {
      ip,
      body: { username: "abadi", authSecret: secret("X") },
    });
  for (let i = 0; i < 10; i++)
    assert.equal((await wrong(`10.0.0.${i}`)).status, 401);
  // The right password is refused too until the window passes.
  const right = () =>
    call("POST", "/v1/login", {
      body: { username: "abadi", authSecret: secret("A") },
    });
  assert.equal((await right()).status, 429);
  later(16 * 60000);
  assert.equal((await right()).status, 200);
  // Unknown names fail the same way as wrong passwords.
  const unknown = await call("POST", "/v1/login", {
    body: { username: "nobody", authSecret: secret("A") },
  });
  assert.deepEqual(
    [unknown.status, unknown.json.error],
    [401, "invalid_credentials"],
  );
  // Five sign-ups an hour from one address.
  for (let i = 0; i < 4; i++)
    assert.equal((await signup(`user${i}`)).status, 201);
  assert.equal((await signup("user9")).status, 429);
  assert.equal((await signup("user9", "2.2.2.2")).status, 201);
});

test("web origins are checked; the desktop sends none", async () => {
  const { call, env } = setup();
  const own = await call("GET", "/v1/health", {
    headers: { Origin: "https://abadiosa.github.io" },
  });
  assert.equal(
    own.headers.get("Access-Control-Allow-Origin"),
    "https://abadiosa.github.io",
  );
  assert.equal(
    (
      await call("GET", "/v1/health", {
        headers: { Origin: "https://evil.example" },
      })
    ).status,
    403,
  );
  assert.equal((await call("GET", "/v1/health")).status, 200);
  const preflight = await call("OPTIONS", "/v1/data", {
    headers: { Origin: "https://abadiosa.github.io" },
  });
  assert.equal(preflight.status, 204);
  assert.match(
    preflight.headers.get("Access-Control-Allow-Headers"),
    /X-Riwaq-Base/,
  );
  // A missing or short pepper is refused rather than run weakly.
  env.AUTH_PEPPER = "short";
  assert.equal((await call("GET", "/v1/health")).status, 500);
});

test("data is versioned, bounded and replaced whole", async () => {
  const { call, signup, env, later } = setup();
  const { token } = (await signup("abadi")).json;
  const auth = { Authorization: `Bearer ${token}` };
  const put = (text, base) =>
    call("PUT", "/v1/data", {
      body: text,
      headers: { ...auth, "X-Riwaq-Base": String(base) },
    });
  assert.equal((await call("GET", "/v1/data", { headers: auth })).status, 204);
  assert.equal((await put("a".repeat(MAX_DATA + 1), 0)).status, 413);
  assert.equal((await put("first", 0)).json.revision, 1);
  const stale = await put("late", 0);
  assert.deepEqual([stale.status, stale.json.revision], [409, 1]);
  assert.equal((await put("b".repeat(4_000_000), 1)).json.revision, 2);
  const got = await call("GET", "/v1/data", { headers: auth });
  assert.equal(got.text.length, 4_000_000);
  assert.equal(got.headers.get("X-Riwaq-Revision"), "2");
  // Only the current revision's pieces remain.
  const rows = (
    await env.DB.prepare("SELECT DISTINCT revision FROM chunks").all()
  ).results;
  assert.deepEqual(
    rows.map((r) => r.revision),
    [2],
  );
  assert.equal(
    (
      await call("GET", "/v1/data", {
        headers: { ...auth, "If-None-Match": "2" },
      })
    ).status,
    304,
  );
  // Sessions end after 180 days without use, and a bad token is refused.
  later(181 * 86400000);
  assert.equal((await call("GET", "/v1/data", { headers: auth })).status, 401);
  assert.equal(
    (
      await call("GET", "/v1/data", {
        headers: { Authorization: "Bearer nope" },
      })
    ).status,
    401,
  );
});

test("an account keeps at most twenty signed-in devices", async () => {
  const { call, signup, env } = setup();
  await signup("abadi");
  for (let i = 0; i < 25; i++)
    await call("POST", "/v1/login", {
      ip: `9.9.9.${i}`,
      body: { username: "abadi", authSecret: secret("A") },
    });
  const { n } = await env.DB.prepare("SELECT count(*) n FROM sessions").first();
  assert.equal(n, 20);
});

test("the deployment config binds D1 and allows only the site's origin", () => {
  const root = fileURLToPath(new URL("../server/accounts/", import.meta.url));
  const toml = readFileSync(root + "wrangler.toml", "utf8");
  assert.match(toml, /binding = "DB"/);
  assert.match(toml, /ALLOWED_ORIGINS = "https:\/\/abadiosa\.github\.io"/);
  assert.match(toml, /main = "worker\.mjs"/);
  const worker = readFileSync(root + "worker.mjs", "utf8");
  // Request bodies carry proofs; nothing logs them.
  assert.doesNotMatch(worker, /console\.\w+\([^)]*(body|request|secret)/i);
});
