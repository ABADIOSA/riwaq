import test from "node:test";
import assert from "node:assert/strict";
import {
  parseVersion,
  compareVersions,
  pickLatest,
  releaseUrlOk,
  Updates,
} from "../core/updates.mjs";
import { Client } from "../core/client.mjs";

const release = (tag, extra = {}) => ({
  tag_name: tag,
  name: `رِواق ${tag}`,
  html_url: `https://github.com/ABADIOSA/riwaq/releases/tag/${tag}`,
  prerelease: true,
  published_at: "2026-09-26T00:00:00Z",
  ...extra,
});

test("versions parse with or without v and prerelease tags", () => {
  assert.deepEqual(parseVersion("v1.2.3"), {
    major: 1,
    minor: 2,
    patch: 3,
    pre: [],
  });
  assert.deepEqual(parseVersion("0.5.0-beta.2").pre, ["beta", "2"]);
  for (const bad of ["nightly", "1.2", "v1.2.3.4", "", null])
    assert.equal(parseVersion(bad), null);
});

test("comparison follows semantic versioning precedence", () => {
  assert.equal(compareVersions("0.5.0", "0.4.9"), 1);
  assert.equal(compareVersions("0.4.0", "0.10.0"), -1);
  assert.equal(compareVersions("v1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("1.0.0", "1.0.0-rc.1"), 1);
  assert.equal(compareVersions("1.0.0-beta.10", "1.0.0-beta.2"), 1);
  assert.equal(compareVersions("1.0.0-alpha", "1.0.0-alpha.1"), -1);
  assert.equal(compareVersions("1.0.0-1", "1.0.0-alpha"), -1);
});

test("only release pages of this repository may be opened", () => {
  assert.equal(
    releaseUrlOk("https://github.com/ABADIOSA/riwaq/releases/tag/v1.0.0"),
    true,
  );
  assert.equal(
    releaseUrlOk("https://github.com/abadiosa/riwaq/releases/tag/v1.0.0"),
    true,
  );
  assert.equal(
    releaseUrlOk("https://github.com/someone/riwaq/releases/tag/v1"),
    false,
  );
  assert.equal(
    releaseUrlOk("http://github.com/ABADIOSA/riwaq/releases/tag/v1"),
    false,
  );
  assert.equal(
    releaseUrlOk("https://github.com.evil.test/ABADIOSA/riwaq/releases/"),
    false,
  );
  assert.equal(releaseUrlOk("javascript:alert(1)"), false);
});

test("the newest real release wins: drafts, odd tags and foreign links are ignored", () => {
  const latest = pickLatest([
    release("v0.3.0"),
    release("v0.9.0", { draft: true }),
    release("v0.8.0", {
      html_url: "https://evil.test/ABADIOSA/riwaq/releases/tag/v0.8.0",
    }),
    release("nightly"),
    release("v0.4.1"),
    release("v0.4.1-beta.1"),
  ]);
  assert.equal(latest.version, "0.4.1");
  assert.equal(latest.prerelease, true);
  assert.equal(pickLatest([]), null);
  assert.equal(pickLatest("not a list"), null);
});

function rig(responses) {
  const requests = [];
  const client = new Client({
    load: () => ({}),
    save: () => {},
    version: "0.4.0",
    request: async (url, init) => {
      requests.push({ url, init });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  });
  return { client, requests };
}

test("a newer release is reported as available, and published through state", async () => {
  const { client, requests } = rig([[release("v0.3.0"), release("v0.5.0")]]);
  const result = await client.updates.check({ current: "0.4.0" });
  assert.equal(result.available, true);
  assert.equal(result.latest.version, "0.5.0");
  assert.equal(client.publicState().update.available, true);
  assert.equal(requests.length, 1);
  assert.ok(
    requests[0].url.startsWith(
      "https://api.github.com/repos/ABADIOSA/riwaq/releases",
    ),
  );
  // No credential or viewer data travels with the check: only the app's name.
  assert.deepEqual(Object.keys(requests[0].init.headers).sort(), [
    "Accept",
    "User-Agent",
  ]);
  assert.equal(requests[0].init.headers["User-Agent"], "Riwaq/0.4.0");
});

test("being on the newest release is not an update", async () => {
  const { client } = rig([[release("v0.4.0")]]);
  assert.equal(
    (await client.updates.check({ current: "0.4.0" })).available,
    false,
  );
});

test("checks happen at most once a day unless forced", async () => {
  const now = Date.UTC(2026, 8, 26);
  const { client, requests } = rig([
    [release("v0.4.0")],
    [release("v0.5.0")],
    [release("v0.5.0")],
  ]);
  await client.updates.check({ current: "0.4.0", now });
  await client.updates.check({ current: "0.4.0", now: now + 3600000 });
  assert.equal(requests.length, 1);
  await client.updates.check({
    current: "0.4.0",
    now: now + 3600000,
    force: true,
  });
  assert.equal(requests.length, 2);
  await client.updates.check({ current: "0.4.0", now: now + 2 * 86400000 });
  assert.equal(requests.length, 3);
});

test("turning checks off stops automatic requests, a manual check still works", async () => {
  const { client, requests } = rig([[release("v0.5.0")]]);
  client.updates.setEnabled(false);
  await client.updates.check({ current: "0.4.0" });
  assert.equal(requests.length, 0);
  const forced = await client.updates.check({ current: "0.4.0", force: true });
  assert.equal(forced.available, true);
  assert.equal(client.publicState().update.enabled, false);
});

test("a failed check is recorded quietly and keeps the last known release", async () => {
  const now = Date.UTC(2026, 8, 26);
  const { client } = rig([[release("v0.5.0")], new Error("offline")]);
  await client.updates.check({ current: "0.4.0", now });
  const failed = await client.updates.check({
    current: "0.4.0",
    now: now + 2 * 86400000,
  });
  assert.equal(failed.failed, true);
  assert.equal(failed.latest.version, "0.5.0");
});

test("the page main opens is always a validated release page", () => {
  const updates = new Updates({ state: {}, persist() {}, publicState() {} });
  assert.equal(
    updates.releaseUrl(),
    "https://github.com/ABADIOSA/riwaq/releases",
  );
  updates.store.latest = { url: "https://evil.test/x" };
  assert.equal(
    updates.releaseUrl(),
    "https://github.com/ABADIOSA/riwaq/releases",
  );
  updates.store.latest = {
    url: "https://github.com/ABADIOSA/riwaq/releases/tag/v0.5.0",
  };
  assert.equal(
    updates.releaseUrl(),
    "https://github.com/ABADIOSA/riwaq/releases/tag/v0.5.0",
  );
});

test("a malformed version cannot inject into the User-Agent header", async () => {
  const { client, requests } = rig([[]]);
  await client.updates.check({ current: "0.4.0\r\nX-Evil: 1", force: true });
  assert.equal(requests[0].init.headers["User-Agent"], "Riwaq/0.4.0X-Evil1");
});
