import test from "node:test";
import assert from "node:assert/strict";
import {
  Announcements,
  cleanFeed,
  cleanAnnouncement,
  announcementLink,
  audience,
  boundedJson,
  ANNOUNCEMENT_URL,
} from "../core/announcements.mjs";
import { AdminGithub } from "../admin/github.mjs";
import { workspaceTask, sandboxDirectory } from "../admin/workspace.mjs";
import { collectBackup } from "../core/backup.mjs";
import { readFileSync } from "node:fs";

const now = 1800000000000;
const item = (extra = {}) => ({
  id: "notice_123456",
  at: now - 1000,
  expires: now + 86400000,
  ar: { title: "عنوان تجريبي", body: "رسالة تجريبية" },
  platform: "all",
  minVersion: "",
  maxVersion: "",
  ...extra,
});
function hub(request) {
  let saved = 0;
  const client = { version: "0.43.1", state: {}, saveData: () => saved++ };
  const inbox = new Announcements(client, { request, now: () => now });
  return { client, inbox, saved: () => saved };
}
test("announcement validation rejects duplicates, unsafe links, invalid windows and oversized messages", () => {
  for (const value of [
    { ...item(), id: "x" },
    { ...item(), expires: now - 2000 },
    { ...item(), expires: now + 91 * 86400000 },
    { ...item(), platform: "linux" },
    { ...item(), minVersion: "newest" },
    { ...item(), ar: { title: "x", body: "x".repeat(3001) } },
    { ...item(), minVersion: "2.0.0", maxVersion: "1.0.0" },
  ])
    assert.throws(() => cleanAnnouncement(value));
  assert.throws(() => cleanFeed({ schema: 1, items: [item(), item()] }));
  assert.throws(() => cleanFeed({ schema: 1, items: Array(81).fill(item()) }));
  for (const url of [
    "javascript:alert(1)",
    "https://github.com/evil/riwaq/",
    "https://github.com/ABADIOSA/riwaq.evil/",
    "https://github.com:8443/ABADIOSA/riwaq/",
    "https://a:b@github.com/ABADIOSA/riwaq/",
    "https://github.com/ABADIOSA/riwaq/../../evil/",
  ])
    assert.throws(() => announcementLink(url));
  assert.equal(
    announcementLink("https://github.com/ABADIOSA/riwaq/releases"),
    "https://github.com/ABADIOSA/riwaq/releases",
  );
  assert.equal(
    cleanFeed({
      schema: 1,
      items: [item({ ar: { title: " <script> ", body: " plain text " } })],
    }).items[0].ar.title,
    "<script>",
  );
});
test("audience filters platform, scheduled, expired and version ranges including prereleases", () => {
  const target = { now, platform: "desktop", version: "0.43.1" };
  assert.ok(audience(item(), target));
  for (const n of [
    item({ platform: "web" }),
    item({ at: now + 1000 }),
    item({ expires: now }),
    item({ minVersion: "0.44.0" }),
    item({ maxVersion: "0.43.0" }),
  ])
    assert.ok(!audience(n, target));
  assert.ok(
    !audience(item({ minVersion: "0.43.1" }), {
      ...target,
      version: "0.43.1-beta.1",
    }),
  );
  assert.ok(
    !audience(item({ minVersion: "0.43.0" }), { ...target, version: "" }),
  );
});
test("inbox keeps read state across relaunch, failed refresh keeps cache, local state stays out of backup", async () => {
  let fail = false,
    clock = now;
  const { client, inbox, saved } = hub(async (url) => {
    assert.equal(url, ANNOUNCEMENT_URL);
    if (fail) throw Error("offline");
    return { schema: 1, items: [item()] };
  });
  inbox.now = () => clock;
  assert.equal((await inbox.refresh()).unread, 1);
  inbox.edit({ action: "read", id: item().id });
  assert.equal(
    new Announcements(client, { now: () => clock }).publicState().unread,
    0,
  );
  clock += 61000;
  fail = true;
  const offline = await inbox.refresh();
  assert.ok(offline.error);
  assert.equal(offline.items.length, 1);
  assert.ok(saved() > 0);
  assert.ok(
    !JSON.stringify(
      collectBackup(client.state, { includeSecrets: true }),
    ).includes("notice_123456"),
  );
});
test("single-flight polling, throttled manual retry and disabling ignore late responses", async () => {
  let resolve,
    count = 0;
  const { inbox } = hub(() => {
    count++;
    return new Promise((r) => (resolve = r));
  });
  const a = inbox.refresh(),
    b = inbox.refresh();
  assert.equal(count, 1);
  inbox.edit({ action: "enabled", enabled: false });
  resolve({ schema: 1, items: [item()] });
  await Promise.all([a, b]);
  assert.equal(inbox.publicState().items.length, 0);
  await inbox.refresh();
  assert.equal(count, 1);
});
test("malformed remote feed never replaces valid cached content", async () => {
  const { inbox } = hub(async () => ({ schema: 1, items: [item()] }));
  await inbox.refresh();
  inbox.attempt = null;
  inbox.request = async () => ({
    schema: 1,
    items: [item({ link: "http://evil.test" })],
  });
  const result = await inbox.refresh();
  assert.ok(result.error);
  assert.equal(result.items.length, 1);
});
test("bounded JSON cancels oversized streams and refuses HTTP failure and redirects", async () => {
  const original = globalThis.fetch;
  let options,
    cancelled = false;
  try {
    globalThis.fetch = async (_url, opt) => {
      options = opt;
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(40));
          },
          cancel() {
            cancelled = true;
          },
        }),
      );
    };
    await assert.rejects(boundedJson("https://example.test", {}, 20), /large/);
    assert.ok(cancelled);
    assert.equal(options.redirect, "error");
    assert.equal(options.credentials, "omit");
    globalThis.fetch = async () => new Response("no", { status: 403 });
    await assert.rejects(boundedJson("https://example.test"), /403/);
  } finally {
    globalThis.fetch = original;
  }
});
function admin(options = {}) {
  const calls = [];
  const request = async (url, args) => {
    calls.push({ url, args });
    if (url.endsWith("/user")) return { login: options.login || "ABADIOSA" };
    if (url.endsWith("/repos/ABADIOSA/riwaq"))
      return {
        private: false,
        default_branch: "main",
        permissions: { push: true },
      };
    if (args.method === "PUT") {
      if (options.conflict) throw Error("HTTP 409");
      return { commit: { sha: "c".repeat(40) } };
    }
    return {
      sha: "a".repeat(40),
      encoding: "base64",
      size: 24,
      content: Buffer.from(
        JSON.stringify(options.feed || { schema: 1, items: [] }),
      ).toString("base64"),
    };
  };
  return { github: new AdminGithub({ request, now: () => now }), calls };
}
test("admin cannot preview without owner authentication, token never returned", async () => {
  const { github } = admin();
  await assert.rejects(github.preview(item()));
  await assert.rejects(
    admin({ login: "someone" }).github.connect("a".repeat(40)),
    /Owner/,
  );
  const pub = await github.connect("a".repeat(40));
  assert.deepEqual(pub, { connected: true, login: "ABADIOSA" });
  assert.ok(!JSON.stringify(pub).includes("a".repeat(40)));
  github.disconnect();
  assert.equal(github.token, "");
});
test("publish writes only the previewed feed to fixed main path with SHA lease; review is consumed", async () => {
  const { github, calls } = admin();
  await github.connect("a".repeat(40));
  const preview = await github.preview(item());
  await assert.rejects(github.publish("invalid"));
  assert.equal(calls.filter((c) => c.args.method === "PUT").length, 0);
  const result = await github.publish(preview.nonce);
  assert.ok(result.published);
  const write = calls.find((c) => c.args.method === "PUT");
  assert.equal(
    write.url,
    "https://api.github.com/repos/ABADIOSA/riwaq/contents/announcements/feed.json",
  );
  const body = JSON.parse(write.args.body);
  assert.equal(body.sha, "a".repeat(40));
  assert.equal(body.branch, "main");
  assert.deepEqual(
    JSON.parse(Buffer.from(body.content, "base64").toString()).items,
    [preview.item],
  );
  await assert.rejects(github.publish(preview.nonce));
});
test("conflicting publication never retries with a new SHA and requires fresh review", async () => {
  const { github, calls } = admin({ conflict: true });
  await github.connect("a".repeat(40));
  const { nonce } = await github.preview(item());
  await assert.rejects(github.publish(nonce), /409/);
  await assert.rejects(github.publish(nonce));
  assert.equal(calls.filter((c) => c.args.method === "PUT").length, 1);
});
test("publication trims oldest notices so the actual UTF-8 file fits the viewer fetch limit", async () => {
  const body = "x".repeat(3000);
  const existing = {
    schema: 1,
    items: Array.from({ length: 20 }, (_, i) =>
      item({ id: `notice_large_${i}`, ar: { title: "Long", body } }),
    ),
  };
  const { github, calls } = admin({ feed: existing });
  await github.connect("a".repeat(40));
  const reviewed = await github.preview(
    item({ ar: { title: "New", body }, en: { title: "New", body } }),
  );
  await github.publish(reviewed.nonce);
  const bytes = Buffer.from(
    JSON.parse(calls.find((c) => c.args.method === "PUT").args.body).content,
    "base64",
  );
  assert.ok(bytes.length <= 65536);
  assert.ok(reviewed.count < 21);
  assert.equal(
    cleanFeed(JSON.parse(bytes.toString())).items[0].id,
    reviewed.item.id,
  );
});
test("disconnect invalidates outstanding preview and expired previews cannot publish", async () => {
  const { github } = admin();
  await github.connect("a".repeat(40));
  const { nonce } = await github.preview(item());
  github.disconnect();
  await assert.rejects(github.publish(nonce));
  await github.connect("a".repeat(40));
  const again = await github.preview(item());
  github.now = () => now + 11 * 60000;
  await assert.rejects(github.publish(again.nonce));
});
test("workspace tasks are fixed argv, isolated data and no inherited admin or signing secrets", () => {
  process.env.RIWAQ_ADMIN_TEST_SECRET = "secret";
  try {
    const dir = sandboxDirectory("C:/admin", "C:/repo");
    const run = workspaceTask("C:/repo", "launch", dir, "electron.exe");
    assert.equal(run.options.shell, false);
    assert.equal(run.options.env.ELECTRON_RUN_AS_NODE, undefined);
    assert.equal(run.options.env.RIWAQ_ADMIN_TEST_SECRET, undefined);
    assert.ok(run.options.env.RIWAQ_DATA_DIR.includes("sandboxes"));
    assert.notEqual(dir, sandboxDirectory("C:/admin", "D:/repo"));
    assert.throws(() => workspaceTask("repo", "npm rm -rf", dir, "electron"));
    assert.deepEqual(workspaceTask("repo", "build", dir, "electron").args, [
      "node_modules/vite/bin/vite.js",
      "build",
    ]);
  } finally {
    delete process.env.RIWAQ_ADMIN_TEST_SECRET;
  }
});
test("standard release excludes admin app; renderer has neither network nor Node, inbox links use trusted IDs", () => {
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  assert.ok(
    !JSON.parse(read("package.json")).build.files.some((p) =>
      p.startsWith("admin/"),
    ),
  );
  assert.match(read("admin/main.mjs"), /nodeIntegration:\s*false/);
  assert.match(read("admin/index.html"), /connect-src 'none'/);
  assert.ok(!read("admin/preload.cjs").includes("token:"));
  assert.match(
    read("electron/main.mjs"),
    /items.find\(\s*\(n\) => n.id === id/,
  );
});
test("the admin's releases list has room for full release notes", async () => {
  // Ten releases came to 206,858 bytes at 0.43.1, about 12 KB more with each
  // release: the general 256 KB cap would refuse them within a few releases.
  const { RELEASES_LIMIT } = await import("../admin/github.mjs");
  const seen = [];
  const notes = "ن".repeat(15000);
  const github = new AdminGithub({
    request: async (url, options, limit) => {
      seen.push({ url, limit, auth: options.headers.Authorization });
      return Array.from({ length: 10 }, (_, i) => ({
        tag_name: `v0.${50 + i}.0`,
        name: `رِواق v0.${50 + i}.0`,
        published_at: "2026-10-13T08:59:00Z",
        prerelease: true,
        draft: i === 9,
        body: notes,
      }));
    },
  });
  const list = await github.releases();
  assert.equal(list.length, 9, "drafts are left out");
  assert.deepEqual(Object.keys(list[0]).sort(), [
    "at",
    "name",
    "prerelease",
    "tag",
  ]);
  assert.equal(seen[0].limit, RELEASES_LIMIT);
  assert.ok(RELEASES_LIMIT >= 1024 * 1024);
  assert.equal(seen[0].auth, undefined, "read without the owner's token");
  // Every other call keeps the tighter cap.
  await github.api("/user", {}, "");
  assert.equal(seen[1].limit, 256 * 1024);
});
test("a notice's link is checked again where it is opened", () => {
  for (const file of ["../electron/main.mjs", "../web/bridge.js"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    const open = source.slice(source.indexOf("announcementOpen:"));
    assert.match(
      open.slice(0, 400),
      /announcementLink\(item\.link\)/,
      `${file} opens only a re-checked link`,
    );
  }
});
