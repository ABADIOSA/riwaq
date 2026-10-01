import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DesktopUpdates } from "../electron/updater.mjs";
import {
  RELEASES_FEED,
  describeUpdateError,
  parseReleaseFeed,
  pickLatest,
} from "../core/updates.mjs";
import { installerName } from "../core/update-package.mjs";

const keys = generateKeyPairSync("ed25519");
const binary = Buffer.from("installer fixture; never executed");
function signed(version, channel = "beta") {
  const bytes = Buffer.from(
    JSON.stringify({
      schema: 1,
      repo: "ABADIOSA/riwaq",
      version,
      platform: "win32-x64",
      channel,
      publishedAt: "2026-10-01T00:00:00Z",
      filename: installerName(version),
      size: binary.length,
      sha512: createHash("sha512").update(binary).digest("hex"),
      notes: "جديد",
    }),
  );
  return JSON.stringify({
    payload: bytes.toString("base64"),
    signature: sign(null, bytes, keys.privateKey).toString("base64"),
  });
}
// Shaped like GitHub's releases.atom.
const feed = (...versions) => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/" xml:lang="en-US">
  <id>tag:github.com,2008:https://github.com/ABADIOSA/riwaq/releases</id>
  <title>Release notes from riwaq</title>
${versions
  .map(
    (v) => `  <entry>
    <id>tag:github.com,2008:Repository/1/v${v}</id>
    <updated>2026-10-01T10:00:00Z</updated>
    <link rel="alternate" type="text/html" href="https://github.com/ABADIOSA/riwaq/releases/tag/v${v}"/>
    <title>Riwaq ${v}: notes &amp; more</title>
    <content type="html">&lt;p&gt;x&lt;/p&gt;</content>
  </entry>`,
  )
  .join("\n")}
</feed>`;

async function rig({ api, files = {}, current = "0.16.0", preferences = {} }) {
  const directory = await mkdtemp(join(tmpdir(), "riwaq-fallback-"));
  const requests = [];
  let updater;
  const client = {
    state: { updates: { autoDownload: false, ...preferences } },
    profiles: { gate() {} },
    persist() {},
    publicState: () => ({ update: updater.publicState() }),
    request: async (url) => {
      requests.push(url);
      return api();
    },
  };
  updater = new DesktopUpdates(client, {
    current,
    directory,
    publicKey: keys.publicKey,
    installed: true,
    fetcher: async (url, init = {}) => {
      requests.push(url);
      if (url === RELEASES_FEED) assert.equal(init.redirect, "error");
      const body = files[url];
      if (body instanceof Error) throw body;
      return body === undefined
        ? new Response("missing", { status: 404 })
        : typeof body === "number"
          ? new Response("x", { status: body })
          : new Response(body);
    },
  });
  return { updater, requests };
}
const asset = (v) =>
  `https://github.com/ABADIOSA/riwaq/releases/download/v${v}/riwaq-update.json`;
const limited = () => {
  throw new Error("HTTP 403");
};

test("the releases feed is read like the API's list", () => {
  const list = parseReleaseFeed(feed("0.17.0", "0.16.0", "0.18.0-beta.1"));
  assert.deepEqual(
    list.map((r) => [r.tag_name, r.prerelease]),
    [
      ["v0.17.0", false],
      ["v0.16.0", false],
      ["v0.18.0-beta.1", true],
    ],
  );
  assert.equal(list[0].name, "Riwaq 0.17.0: notes & more");
  assert.equal(pickLatest(list).version, "0.18.0-beta.1");
  assert.deepEqual(parseReleaseFeed("not xml"), []);
  assert.deepEqual(parseReleaseFeed(null), []);
});

test("a rate-limited API falls back to the feed and still verifies the signature", async () => {
  const r = await rig({
    api: limited,
    files: {
      [RELEASES_FEED]: feed("0.17.0", "0.16.0"),
      [asset("0.17.0")]: signed("0.17.0"),
    },
  });
  await r.updater.check({ force: true });
  const s = r.updater.publicState();
  assert.equal(s.status, "available");
  assert.equal(s.verified, true);
  assert.equal(s.latest.version, "0.17.0");
  assert.match(s.detail, /موجز الإصدارات.*HTTP 403/);
});

test("a tampered manifest found through the feed is still refused", async () => {
  const good = JSON.parse(signed("0.17.0"));
  good.signature = Buffer.alloc(64).toString("base64");
  const r = await rig({
    api: limited,
    files: {
      [RELEASES_FEED]: feed("0.17.0"),
      [asset("0.17.0")]: JSON.stringify(good),
    },
  });
  await r.updater.check({ force: true });
  assert.equal(r.updater.publicState().status, "error");
  assert.match(r.updater.publicState().error, /توقيع/);
});

test("through the feed, a release without a manifest is manual and a beta never reaches stable", async () => {
  const manual = await rig({
    api: limited,
    files: { [RELEASES_FEED]: feed("0.17.0") },
  });
  await manual.updater.check({ force: true });
  assert.equal(manual.updater.publicState().status, "manual");
  const stable = await rig({
    api: limited,
    preferences: { channel: "stable" },
    files: {
      [RELEASES_FEED]: feed("0.17.0"),
      [asset("0.17.0")]: signed("0.17.0", "beta"),
    },
  });
  await stable.updater.check({ force: true });
  assert.equal(stable.updater.publicState().status, "current");
});

test("when both routes fail the reason is specific and a retry comes sooner", async () => {
  const r = await rig({
    api: limited,
    files: { [RELEASES_FEED]: new Error("fetch failed") },
  });
  const now = Date.now();
  await r.updater.check({ force: true, now });
  const s = r.updater.publicState();
  assert.equal(s.status, "error");
  assert.match(s.error, /60 طلباً/);
  assert.equal(s.detail, "GitHub API · HTTP 403 · موجز الإصدارات · لا اتصال");
  assert.ok(!/https?:/.test(s.detail));
  // Not before the retry window, but well before the four-hour interval.
  const before = r.requests.length;
  await r.updater.check({ now: now + 10 * 60000 });
  assert.equal(r.requests.length, before);
  await r.updater.check({ now: now + 21 * 60000 });
  assert.ok(r.requests.length > before);
});

test("update errors are described without addresses", () => {
  assert.match(
    describeUpdateError(new Error("HTTP 429")).message,
    /عدد الطلبات/,
  );
  assert.match(describeUpdateError(new Error("HTTP 503")).message, /لا تستجيب/);
  const timeout = new Error("The operation was aborted due to timeout");
  timeout.name = "TimeoutError";
  assert.match(describeUpdateError(timeout).message, /مهلة/);
  assert.equal(
    describeUpdateError(new Error("حجم ملف التحديث غير صحيح؛ أعد تنزيله"))
      .message,
    "حجم ملف التحديث غير صحيح؛ أعد تنزيله",
  );
  assert.doesNotMatch(
    describeUpdateError(new Error("failed https://x.example/a")).message,
    /https/,
  );
});
