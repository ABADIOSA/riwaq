/**
 * Released apps against the accounts Worker across migration 0003 (PR #155
 * third review, CF1/CF2; docs/CLOUDFLARE-DATABASE-AUDIT-2026-11-18.md,
 * "Fourth pass"). Everything is local: Node's SQLite stands in for D1, and
 * nothing is sent to Cloudflare.
 *
 *   node scripts/test-accounts-released.mjs [tags…]   (default v0.40.0 v0.54.0 v0.55.0)
 *
 * For each released version, its own core/ (git archive of the tag) signs
 * up and syncs against the previous Worker (by default the one released
 * with v0.55.0, the code production runs; RIWAQ_PREVIOUS_WORKER names
 * another commit, such as the reviewed head 72e2ffc) on the schema
 * production has today (0001–0002); then migration 0003 is applied
 * while that old Worker keeps serving (the window between the workflow's
 * migration step and its deploy step); then this checkout's Worker takes
 * over the same database. The established session must survive, and every
 * account action the released app has must keep working: login, pull,
 * push, conflict, logout, password change, recovery, deletion, a fresh
 * sign-up. Needs the tags fetched (git fetch origin tag v0.55.0 …).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { handle as currentHandle } from "../server/accounts/service.mjs";
import { sqliteD1 } from "../server/accounts/local.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const PREVIOUS = process.env.RIWAQ_PREVIOUS_WORKER || "v0.55.0";
const tags = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["v0.40.0", "v0.54.0", "v0.55.0"];
const work = mkdtempSync(join(tmpdir(), "riwaq-released-"));
const extract = (ref, into, paths) => {
  execFileSync("git", [
    "-C",
    root,
    "archive",
    "-o",
    `${into}.tar`,
    ref,
    ...paths,
  ]);
  execFileSync("mkdir", ["-p", into]);
  execFileSync("tar", ["-xf", `${into}.tar`, "-C", into]);
  // Released code imports its own dependencies (buffer shims, etc.).
  symlinkSync(join(root, "node_modules"), join(into, "node_modules"), "dir");
};
const results = [];
try {
  extract(PREVIOUS, join(work, "previous"), ["server", "package.json"]);
  // The Worker's code moved from worker.mjs to service.mjs in PR #155.
  const previousModule = await import(
    pathToFileURL(join(work, "previous/server/accounts/service.mjs"))
  ).catch(
    () =>
      import(pathToFileURL(join(work, "previous/server/accounts/worker.mjs"))),
  );
  const previousHandle = previousModule.handle;
  for (const tag of tags) {
    const dir = join(work, tag);
    extract(tag, dir, ["core", "package.json"]);
    const { Client } = await import(
      pathToFileURL(join(dir, "core/client.mjs"))
    );
    const db = sqliteD1(":memory:", { upTo: "0002_usage.sql" });
    const env = { DB: db, AUTH_PEPPER: "local-fixture-only".repeat(3) };
    let worker = previousHandle;
    const calls = [];
    const url = "https://fixture.invalid";
    const request = async (address, init = {}) => {
      const req = new Request(address, init);
      const response = await worker(req, env);
      calls.push(
        `${worker === currentHandle ? "new" : "old"} ${req.method} ${new URL(address).pathname} ${response.status}`,
      );
      return {
        status: response.status,
        revision: response.headers.get("X-Riwaq-Revision"),
        text: await response.text(),
      };
    };
    const device = () =>
      new Client({
        version: tag.slice(1),
        load: () => ({}),
        save() {},
        accountServer: url,
        accountRequest: request,
      });
    const movie = (id, name) => ({ id, type: "movie", name });
    const username = "released_fixture";
    const password = "fixture-only-long-password";
    const replacement = "fixture-only-replacement";
    const recovered = "fixture-only-recovered";
    const [first, second, third, fourth] = [
      device(),
      device(),
      device(),
      device(),
    ];

    // 1. Today: the old Worker, the old schema.
    first.favorite(movie("tt0111161", "Before migration"));
    const { recoveryCode } = await first.account.signup({ username, password });
    // 2. Migration 0003 applied; the old Worker still serves.
    db.migrate();
    first.favorite(movie("tt0068646", "In the window"));
    await first.account.sync();
    const windowLogin = device();
    await windowLogin.account.login({ username, password });
    // 3. The new Worker takes over the same database.
    worker = currentHandle;
    await first.account.sync();
    assert.equal(first.account.publicState().signedIn, true);
    await windowLogin.account.sync();
    assert.equal(windowLogin.account.publicState().signedIn, true);
    await second.account.login({ username, password });
    assert.deepEqual(second.state.favorites.map((f) => f.name).sort(), [
      "Before migration",
      "In the window",
    ]);
    first.favorite(movie("tt0071562", "After deploy"));
    await first.account.sync();
    await second.account.sync();
    assert.equal(second.state.favorites.length, 3);
    // A stale base is a conflict, as released apps expect.
    const token = second.state.account.token;
    const { text } = await second.account.api("GET", "/v1/data", { token });
    const conflict = await second.account.api("PUT", "/v1/data", {
      token,
      text,
      headers: { "X-Riwaq-Base": "0" },
      conflict: true,
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.data.error, "conflict");
    await second.account.logout();
    assert.equal(second.account.publicState().signedIn, false);
    await first.account.changePassword({ password, newPassword: replacement });
    // The other devices were signed out by the password change.
    await windowLogin.account.sync().catch(() => {});
    assert.equal(windowLogin.account.publicState().signedIn, false);
    await third.account.login({ username, password: replacement });
    assert.equal(third.state.favorites.length, 3);
    await fourth.account.recover({
      username,
      code: recoveryCode,
      password: recovered,
    });
    assert.equal(fourth.state.favorites.length, 3);
    await third.account.sync().catch(() => {});
    assert.equal(third.account.publicState().signedIn, false);
    await fourth.account.deleteAccount({ password: recovered });
    assert.equal(fourth.account.publicState().signedIn, false);
    const fresh = device();
    await fresh.account.signup({ username, password });
    assert.ok(fresh.state.account.revision > 0);
    // The deleted account's devices never reach the new one.
    await first.account.sync().catch(() => {});
    assert.equal(first.account.publicState().signedIn, false);
    results.push({ tag, ok: true, calls: [...new Set(calls)] });
    db.close();
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(JSON.stringify(results, null, 2));
console.log(`\n${results.length}/${tags.length} released versions passed`);
