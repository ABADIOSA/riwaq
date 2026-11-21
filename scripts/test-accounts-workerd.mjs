/**
 * The accounts Worker in workerd with a LOCAL D1 (Wrangler's miniflare),
 * across migration 0003 (PR #155 third review; docs/CLOUDFLARE-DATABASE-
 * AUDIT-2026-11-18.md, "Fourth pass"). Nothing reaches Cloudflare: a
 * throwaway config with a random database ID, --local everywhere, no
 * Cloudflare credentials in the environment, and a temporary state folder.
 *
 *   RIWAQ_WRANGLER=<path to wrangler.js> node scripts/test-accounts-workerd.mjs
 *
 * Steps: migrations 0001–0002 only (production's schema today); rows as
 * the previous Worker writes them (an account, a session, its data); 0003
 * applied, twice (the second applies nothing); the Worker started in
 * workerd; the legacy session pulls its data and pushes, a stale base is a
 * conflict, a new account signs up, password change and deletion work, the
 * scheduled clean-up answers; then the live smoke the deploy workflow runs
 * (scripts/test-account-live.mjs) against this local Worker.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = process.env.RIWAQ_WRANGLER;
if (!cli) {
  console.error("Set RIWAQ_WRANGLER to wrangler's bin/wrangler.js (4.141.0).");
  process.exit(2);
}
const work = mkdtempSync(join(tmpdir(), "riwaq-workerd-"));
const worker = join(work, "worker");
cpSync(join(root, "server/accounts"), worker, { recursive: true });
const held = join(work, "held-migrations");
mkdirSync(held);
renameSync(
  join(worker, "migrations/0003_account_instances.sql"),
  join(held, "0003_account_instances.sql"),
);
const config = join(worker, "wrangler.local.toml");
writeFileSync(
  config,
  `name = "riwaq-accounts-local-test"
main = "worker.mjs"
compatibility_date = "2025-09-01"
workers_dev = false

[vars]
ALLOWED_ORIGINS = "https://abadiosa.github.io"

[[d1_databases]]
binding = "DB"
database_name = "riwaq-accounts-local-test"
database_id = "${crypto.randomUUID()}"
migrations_dir = "migrations"

[triggers]
crons = ["17 2 * * *"]
`,
);
writeFileSync(
  join(worker, ".dev.vars"),
  `AUTH_PEPPER=${randomBytes(32).toString("hex")}\n`,
);
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) => !/^(CLOUDFLARE_|CF_|RIWAQ_ACCOUNT)/i.test(k),
  ),
);
Object.assign(env, {
  CI: "1",
  NO_COLOR: "1",
  WRANGLER_SEND_METRICS: "false",
  XDG_CONFIG_HOME: join(work, "xdg"),
  WRANGLER_LOG_PATH: join(work, "wrangler.log"),
});
const state = join(work, "state");
const wrangler = (...args) =>
  spawnSync(process.execPath, [cli, "--config", config, ...args], {
    cwd: worker,
    env,
    encoding: "utf8",
    timeout: 120000,
  });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sql = (command) => {
  const r = wrangler(
    "d1",
    "execute",
    "DB",
    "--local",
    "--persist-to",
    state,
    "--json",
    "--command",
    command,
  );
  if (r.status) throw new Error(`d1 execute failed: ${r.stderr.slice(-400)}`);
  return JSON.parse(r.stdout)[0]?.results || [];
};
const apply = () =>
  wrangler("d1", "migrations", "apply", "DB", "--local", "--persist-to", state);
const freePort = () =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

let dev = null;
try {
  const version = wrangler("--version");
  check("wrangler version", version.status === 0, version.stdout.trim());
  let r = apply();
  check("0001–0002 applied (production's schema today)", r.status === 0);
  // Rows as the previous Worker writes them (72e2ffc's statements).
  const now = Date.now();
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  sql(
    `INSERT INTO users (username, auth_salt, auth_hash, wrapped_key, recovery_salt, recovery_hash, recovery_key, revision, size, created_at, updated_at) VALUES ('legacy_fixture', 's', 'h', 'w', 'rs', 'rh', 'rk', 1, 11, ${now - 60000}, ${now - 60000})`,
  );
  sql(
    `INSERT INTO chunks (username, revision, idx, data) VALUES ('legacy_fixture', 1, 0, 'legacy-data')`,
  );
  sql(
    `INSERT INTO sessions (token_hash, username, created_at, seen_at) VALUES ('${hash}', 'legacy_fixture', ${now - 30000}, ${now - 30000})`,
  );
  renameSync(
    join(held, "0003_account_instances.sql"),
    join(worker, "migrations/0003_account_instances.sql"),
  );
  r = apply();
  check("0003 applied on that data", r.status === 0, r.stderr.slice(-200));
  r = apply();
  check(
    "0003 a second time applies nothing",
    r.status === 0 && /No migrations to apply/i.test(r.stdout + r.stderr),
  );
  const [user] = sql(
    "SELECT account_id, auth_gen FROM users WHERE username = 'legacy_fixture'",
  );
  const [session] = sql(
    `SELECT account_id, auth_gen FROM sessions WHERE token_hash = '${hash}'`,
  );
  check(
    "0003 gave the account an instance and its session that instance",
    /^[0-9a-f]{32}$/.test(user?.account_id || "") &&
      session?.account_id === user.account_id &&
      session?.auth_gen === 0 &&
      user.auth_gen === 0,
    JSON.stringify({ user, session }),
  );

  const port = await freePort();
  dev = spawn(
    process.execPath,
    [
      cli,
      "--config",
      config,
      "dev",
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--inspector-port",
      "0",
      "--test-scheduled",
      "--persist-to",
      state,
    ],
    { cwd: worker, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let log = "";
  dev.stdout.on("data", (d) => (log += d));
  dev.stderr.on("data", (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  let health = null;
  for (let i = 0; i < 150 && !health; i++) {
    try {
      const res = await fetch(`${base}/v1/health`);
      if (res.ok) health = await res.json();
    } catch {}
    if (!health) await new Promise((res) => setTimeout(res, 200));
  }
  check("workerd answers health", health?.ok === true, JSON.stringify(health));
  if (!health) throw new Error(`workerd did not start:\n${log.slice(-2000)}`);
  const call = (method, path, { token: t, body, headers = {} } = {}) =>
    fetch(base + path, {
      method,
      headers: {
        ...(t ? { Authorization: `Bearer ${t}` } : {}),
        ...headers,
      },
      body,
    });
  let res = await call("GET", "/v1/data", { token });
  check(
    "the legacy session pulls its data",
    res.status === 200 && (await res.text()) === "legacy-data",
  );
  res = await call("PUT", "/v1/data", {
    token,
    body: "legacy-next",
    headers: { "X-Riwaq-Base": "1" },
  });
  check("the legacy session pushes", res.status === 200);
  res = await call("PUT", "/v1/data", {
    token,
    body: "stale",
    headers: { "X-Riwaq-Base": "1" },
  });
  const conflict = await res.json();
  check(
    "a stale base is a conflict with the current revision",
    res.status === 409 && conflict.revision === 2,
  );
  res = await call("GET", "/v1/data", {
    token,
    headers: { "If-None-Match": "2" },
  });
  check("an unchanged revision is 304", res.status === 304);
  const secret = (c) => c.repeat(43);
  res = await call("POST", "/v1/signup", {
    body: JSON.stringify({
      username: "fresh_fixture",
      authSecret: secret("A"),
      wrappedKey: "W".repeat(80),
      recoveryAuth: secret("R"),
      recoveryKey: "W".repeat(80),
    }),
  });
  const fresh = (await res.json()).token;
  check("a new account signs up", res.status === 201 && !!fresh);
  const other = (
    await (
      await call("POST", "/v1/login", {
        body: JSON.stringify({
          username: "fresh_fixture",
          authSecret: secret("A"),
        }),
      })
    ).json()
  ).token;
  res = await call("POST", "/v1/password", {
    token: fresh,
    body: JSON.stringify({
      authSecret: secret("A"),
      newAuthSecret: secret("N"),
      wrappedKey: "W".repeat(80),
    }),
  });
  const keeps = (await call("GET", "/v1/data", { token: fresh })).status;
  const other401 = (await call("GET", "/v1/data", { token: other })).status;
  check(
    "a password change keeps this device and signs the other out",
    res.status === 204 && keeps === 204 && other401 === 401,
  );
  res = await call("DELETE", "/v1/account", {
    token: fresh,
    body: JSON.stringify({ authSecret: secret("N") }),
  });
  check(
    "the account is deleted and its session ends",
    res.status === 204 &&
      (await call("GET", "/v1/data", { token: fresh })).status === 401,
  );
  res = await fetch(`${base}/__scheduled?cron=17+2+*+*+*`);
  check("the scheduled clean-up runs", res.status === 200);
  const live = spawnSync(
    process.execPath,
    [join(root, "scripts/test-account-live.mjs")],
    {
      cwd: root,
      env: { ...env, RIWAQ_ACCOUNT_SERVER: base },
      encoding: "utf8",
      timeout: 120000,
    },
  );
  check(
    "the deploy workflow's live smoke passes against this local Worker",
    live.status === 0,
    (live.stdout + live.stderr).trim().split("\n").slice(-1)[0],
  );
  const leftover = sql(
    "SELECT (SELECT COUNT(*) FROM users WHERE username <> 'legacy_fixture') AS users",
  )[0];
  check("the smoke left no account behind", leftover?.users === 0);
} finally {
  if (dev) dev.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 500));
  rmSync(work, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
