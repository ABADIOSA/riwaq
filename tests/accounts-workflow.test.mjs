// The account service's deployment gate (PR #155 third review): merging
// or pushing must never deploy the Worker or touch the production D1; only
// the manual, owner-only, confirmed workflow may, and it fails closed.
// These read the workflow files as text: what triggers them, what they
// run, and in what shell. actionlint is run separately (VERIFICATION.md).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../.github/workflows/", import.meta.url));
const read = (name) => readFileSync(dir + name, "utf8");
const code = (text) =>
  text
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
/** The keys directly under the top-level `on:`. */
function triggers(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^on:\s*$/.test(l));
  assert.ok(start >= 0, "an `on:` block");
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const m = /^ {2}([a-z_]+):/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}
const PRODUCTION =
  /wrangler\s+deploy(?![a-z])(?!\s+--dry-run)|migrations\s+apply[^\n]*--remote|d1\s+create|secret\s+put|d1\s+execute[^\n]*--remote/;

test("the tests workflow can never change production", () => {
  const text = code(read("accounts.yml"));
  assert.doesNotMatch(text, PRODUCTION);
  assert.doesNotMatch(text, /CLOUDFLARE_API_TOKEN|secrets\./);
  assert.doesNotMatch(text, /environment:/);
  assert.match(text, /shell: bash/);
});

test("no workflow but the manual deploy holds a Cloudflare token or a production command", () => {
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".yml"))) {
    if (name === "accounts-deploy.yml") continue;
    const text = code(read(name));
    assert.doesNotMatch(text, PRODUCTION, name);
    assert.doesNotMatch(text, /CLOUDFLARE_API_TOKEN/, name);
    assert.doesNotMatch(text, /accounts-deploy\.yml/, name);
  }
});

test("the deploy workflow runs only by hand, on main, for the owner, behind its environment", () => {
  const text = read("accounts-deploy.yml");
  assert.deepEqual(triggers(text), ["workflow_dispatch"]);
  assert.match(
    text,
    /if: github\.ref == 'refs\/heads\/main' && github\.actor == github\.repository_owner/,
  );
  assert.match(text, /environment: accounts-production/);
  assert.match(text, /permissions:\n {2}contents: read/);
  assert.match(text, /cancel-in-progress: false/);
});

test("the deploy workflow fails closed: confirmation first, dry run by default, every change behind it", () => {
  const text = read("accounts-deploy.yml");
  // bash for every step: -e and -o pipefail, so `wrangler deploy | tee`
  // fails when Wrangler fails.
  assert.match(text, /defaults:\n\s+run:\n\s+shell: bash/);
  const steps = text.split(/\n {6}- /).slice(1);
  assert.match(steps[0], /exact confirmation/);
  assert.match(steps[0], /expected="deploy \$\{GITHUB_SHA::7\}"/);
  assert.match(steps[0], /exit 1/);
  assert.match(text, /dry_run:\n(?:.*\n)*?\s+type: boolean\n\s+default: true/);
  for (const step of steps) {
    const body = code(step);
    if (
      /wrangler deploy(?![a-z])(?! --dry-run)|migrations apply|test-account-live|curl /.test(
        body,
      )
    )
      assert.match(step, /if: \$\{\{ !inputs\.dry_run \}\}/, step.slice(0, 80));
  }
  assert.doesNotMatch(code(text), /d1 create|secret put/);
  // The target is checked before anything changes.
  const order = (pattern) => text.search(pattern);
  assert.ok(order(/found\.length === 1/) < order(/migrations apply/));
  assert.ok(order(/\$id" != "\$DATABASE_ID"/) < order(/migrations apply/));
  assert.ok(order(/pending" != "\$expected"/) < order(/migrations apply/));
  assert.ok(order(/AUTH_PEPPER/) < order(/migrations apply/));
  assert.ok(order(/time-travel info/) < order(/migrations apply/));
  assert.ok(order(/migrations apply/) < order(/wrangler deploy 2>&1/));
  // A missing or different address and a silent health check fail.
  assert.match(
    text,
    /if \[ "\$url" != "\$EXPECTED_URL" \]; then[\s\S]*?exit 1/,
  );
  assert.match(text, /if \[ "\$healthy" != "yes" \]; then[\s\S]*?exit 1/);
  assert.match(
    text,
    /EXPECTED_URL: https:\/\/riwaq-accounts\.abadiosa2007\.workers\.dev/,
  );
  const server = readFileSync(
    new URL("../core/account-server.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    server,
    /ACCOUNT_SERVER = "https:\/\/riwaq-accounts\.abadiosa2007\.workers\.dev"/,
  );
});

test("the local workerd harness keeps Cloudflare credentials out and uses --local only", () => {
  const text = readFileSync(
    new URL("../scripts/test-accounts-workerd.mjs", import.meta.url),
    "utf8",
  );
  assert.match(text, /CLOUDFLARE_\|CF_/);
  assert.doesNotMatch(text, /"--remote"/);
  for (const m of text.matchAll(/wrangler\(\s*"d1",\s*"[a-z]+",([^)]*)\)/g))
    assert.match(m[1], /"--local"/);
});
