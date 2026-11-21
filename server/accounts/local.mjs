/**
 * The accounts Worker on this machine, for tests and development: the same
 * handler (worker.mjs) over Node's own SQLite in place of D1.
 *
 *   node server/accounts/local.mjs [port]
 *
 * Data lives in memory unless RIWAQ_ACCOUNTS_DB names a file.
 */
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { handle } from "./service.mjs";

const migrations = fileURLToPath(new URL("./migrations/", import.meta.url));

/**
 * Applies the migrations not yet applied, each once and in order, recorded
 * in the table Wrangler keeps for D1 (d1_migrations), so a file database
 * from an earlier run takes only the new ones (0003 alters tables).
 * `upTo` stops after the named file (tests of an older schema).
 */
export function migrate(db, { upTo } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS d1_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)`);
  const done = new Set(
    db
      .prepare("SELECT name FROM d1_migrations")
      .all()
      .map((r) => r.name),
  );
  for (const file of readdirSync(migrations).sort()) {
    if (!file.endsWith(".sql")) continue;
    if (!done.has(file)) {
      db.exec("BEGIN");
      try {
        db.exec(readFileSync(migrations + file, "utf8"));
        db.prepare("INSERT INTO d1_migrations (name) VALUES (?)").run(file);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
    if (file === upTo) break;
  }
}

/** A D1-shaped binding (prepare/bind/first/all/run, batch) over SQLite. */
export function sqliteD1(path = ":memory:", { upTo } = {}) {
  const db = new DatabaseSync(path);
  migrate(db, { upTo });
  const statement = (sql, args = []) => ({
    bind: (...values) => statement(sql, values),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => ({
      meta: { changes: Number(db.prepare(sql).run(...args).changes) },
    }),
    runNow: () => ({
      meta: { changes: Number(db.prepare(sql).run(...args).changes) },
    }),
  });
  return {
    prepare: (sql) => statement(sql),
    // D1 runs a batch as one transaction.
    batch: async (statements) => {
      db.exec("BEGIN");
      try {
        const results = statements.map((s) => s.runNow());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    close: () => db.close(),
    // Applies the remaining migrations (an older schema's test moves on).
    migrate: () => migrate(db),
  };
}

/** Serves the Worker over HTTP; resolves to { url, close }. */
export async function serveLocally({
  port = 0,
  pepper = "local-development-pepper-0123456789abcdef",
  origins = "",
  metricsKey = "",
  db = sqliteD1(process.env.RIWAQ_ACCOUNTS_DB || ":memory:"),
} = {}) {
  const env = {
    DB: db,
    AUTH_PEPPER: pepper,
    ALLOWED_ORIGINS: origins,
    METRICS_ADMIN_KEY: metricsKey,
  };
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const request = new Request(`http://${req.headers.host}${req.url}`, {
      method: req.method,
      headers: Object.entries(req.headers).flatMap(([k, v]) =>
        Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]],
      ),
      body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
    });
    const response = await handle(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await serveLocally({
    port: Number(process.argv[2]) || 8787,
    origins: "http://127.0.0.1:5173",
  });
  console.log(`Riwaq accounts (local) on ${url}`);
}
