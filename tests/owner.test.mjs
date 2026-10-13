import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NoticePublisher } from "../core/notice-publisher.mjs";
import { OwnerDevice, ownerProblem } from "../electron/owner.mjs";
import { HUD_METHODS } from "../core/hud.mjs";
import { DESKTOP_ONLY } from "../web/desktop-only.js";

// Owner devices (electron/owner.mjs): the public app becomes the owner's
// notice tool only on devices where the owner's own GitHub token was entered.
const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const TOKEN = "github_pat_" + "a".repeat(60);

/** Windows' safeStorage stand-in: sealed bytes never hold the plain text. */
const seal = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (text) =>
    Buffer.from(
      "sealed:" +
        Buffer.from(text).toString("base64").split("").reverse().join(""),
    ),
  decryptString: (bytes) =>
    Buffer.from(
      String(bytes)
        .replace(/^sealed:/, "")
        .split("")
        .reverse()
        .join(""),
      "base64",
    ).toString(),
});

function github({ login = "ABADIOSA", push = true, fail = null } = {}) {
  const calls = [];
  const request = async (url, args = {}) => {
    calls.push({
      url,
      method: args.method || "GET",
      auth: args.headers?.Authorization,
    });
    if (fail) throw new Error(fail);
    if (url.endsWith("/user")) return { login };
    if (url.endsWith("/repos/ABADIOSA/riwaq"))
      return { private: false, default_branch: "main", permissions: { push } };
    if (args.method === "PUT") return { commit: { sha: "c".repeat(40) } };
    return {
      sha: "a".repeat(40),
      encoding: "base64",
      size: 24,
      content: Buffer.from(JSON.stringify({ schema: 1, items: [] })).toString(
        "base64",
      ),
    };
  };
  return { publisher: new NoticePublisher({ request }), calls };
}

function device({ confirm = async () => true, ...options } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "riwaq-owner-"));
  const file = join(dir, "owner.bin");
  const { publisher, calls } = github(options);
  const owner = new OwnerDevice({
    file,
    safeStorage: seal(options.encryption !== false),
    publisher,
    confirm,
  });
  return { owner, file, calls, publisher };
}

const draft = {
  ar: { title: "تحديث جديد", body: "نزل إصدار جديد من رِواق." },
  platform: "all",
  expires: Date.now() + 7 * 86400000,
};

test("only the owner's token makes a device an owner device", async () => {
  const { owner, file } = device();
  assert.deepEqual(owner.state(), {
    owner: false,
    remembered: false,
    login: "",
  });
  const state = await owner.activate({ token: TOKEN, remember: true });
  assert.deepEqual(state, { owner: true, remembered: true, login: "ABADIOSA" });
  assert.ok(
    !JSON.stringify(state).includes(TOKEN),
    "the token never comes back",
  );
  // Sealed by Windows: the file does not hold the token as text.
  assert.ok(existsSync(file));
  assert.ok(!readFileSync(file, "utf8").includes(TOKEN));

  for (const [why, options, message] of [
    ["another account", { login: "someone" }, /مو لحساب مالك رِواق/],
    ["no write access", { push: false }, /مو لحساب مالك رِواق/],
    ["revoked token", { fail: "HTTP 401" }, /GitHub رفض الرمز/],
  ]) {
    const other = device(options);
    await assert.rejects(other.owner.activate({ token: TOKEN }), message, why);
    assert.equal(existsSync(other.file), false, `${why}: nothing is kept`);
    assert.equal(other.owner.state().owner, false);
  }
  const short = device();
  await assert.rejects(short.owner.activate({ token: "abc" }), /رمز GitHub/);
});

test("a remembered device stays an owner device after a restart, until its token goes", async () => {
  const { owner, file } = device();
  await owner.activate({ token: TOKEN, remember: true });
  // A restart: a new device object over the same sealed file.
  const { publisher, calls } = github();
  const again = new OwnerDevice({ file, safeStorage: seal(), publisher });
  assert.deepEqual(again.state(), {
    owner: false,
    remembered: true,
    login: "",
  });
  assert.equal(calls.length, 0, "no GitHub request until the tools open");
  const opened = await again.open();
  assert.equal(opened.owner, true);
  assert.equal(calls[0].auth, `Bearer ${TOKEN}`);

  // Deleting the token on GitHub takes the device out on its next use.
  const revoked = new OwnerDevice({
    file,
    safeStorage: seal(),
    publisher: github({ fail: "HTTP 401" }).publisher,
  });
  const out = await revoked.open();
  assert.equal(out.owner, false);
  assert.match(out.problem, /GitHub رفض الرمز/);
  assert.equal(existsSync(file), false, "a refused token is deleted here");
});

test("a network failure keeps the device; forgetting removes it", async () => {
  const { owner, file } = device();
  await owner.activate({ token: TOKEN, remember: true });
  const offline = new OwnerDevice({
    file,
    safeStorage: seal(),
    publisher: github({ fail: "fetch failed" }).publisher,
  });
  const state = await offline.open();
  assert.equal(state.owner, false);
  assert.match(state.problem, /الإنترنت/);
  assert.equal(existsSync(file), true, "kept for the next try");
  assert.deepEqual(owner.forget(), {
    owner: false,
    remembered: false,
    login: "",
  });
  assert.equal(existsSync(file), false);
});

test("a session-only device keeps nothing, and no encryption means no remembering", async () => {
  const once = device();
  await once.owner.activate({ token: TOKEN, remember: false });
  assert.equal(once.owner.state().owner, true);
  assert.equal(existsSync(once.file), false);
  const plain = device({ encryption: false });
  await assert.rejects(
    plain.owner.activate({ token: TOKEN, remember: true }),
    /تشفير ويندوز غير متاح/,
  );
  assert.equal(existsSync(plain.file), false);
});

test("publishing needs the owner device, a fresh preview and the owner's native yes", async () => {
  const stranger = device();
  await assert.rejects(stranger.owner.preview(draft), /افتح أدوات المالك/);

  let asked = null;
  let answer = false;
  const { owner, calls } = device({
    confirm: async (item) => {
      asked = item;
      return answer;
    },
  });
  await owner.activate({ token: TOKEN });
  const preview = await owner.preview(draft);
  await assert.rejects(
    owner.publish({ nonce: "x".repeat(48) }),
    /أعد المعاينة/,
  );
  assert.deepEqual(await owner.publish({ nonce: preview.nonce }), {
    published: false,
  });
  assert.equal(asked.ar.title, "تحديث جديد");
  assert.ok(!calls.some((c) => c.method === "PUT"), "a no writes nothing");
  answer = true;
  const again = await owner.preview(draft);
  const done = await owner.publish({ nonce: again.nonce });
  assert.equal(done.published, true);
  const put = calls.filter((c) => c.method === "PUT");
  assert.equal(put.length, 1);
  assert.match(
    put[0].url,
    /\/repos\/ABADIOSA\/riwaq\/contents\/announcements\/feed\.json$/,
  );
  // A bad draft reads as a sentence, not GitHub's or the validator's words.
  await assert.rejects(
    owner.preview({ ...draft, link: "https://example.com/" }),
    /راجع الحقول/,
  );
});

test("refusals read as sentences for the owner", () => {
  assert.match(ownerProblem(new Error("HTTP 409")), /تغيّر ملف الإشعارات/);
  assert.match(ownerProblem(new Error("HTTP 403")), /GitHub رفض الرمز/);
  assert.match(ownerProblem(new Error("boom")), /تعذّر الوصول إلى GitHub/);
});

test("owner tools stay on the main window, behind the Settings lock, desktop only", () => {
  const methods = [
    "ownerState",
    "ownerOpen",
    "ownerActivate",
    "ownerForget",
    "ownerPreview",
    "ownerPublish",
    "ownerTokenPage",
  ];
  const main = read("electron/main.mjs");
  const preload = read("electron/preload.cjs");
  for (const method of methods) {
    assert.ok(!HUD_METHODS.has(method), `${method} is not for the HUD`);
    assert.match(preload, new RegExp(`"${method}"`));
    assert.ok(DESKTOP_ONLY[method], `${method} has a web decision`);
  }
  for (const method of [
    "ownerOpen",
    "ownerActivate",
    "ownerForget",
    "ownerPreview",
    "ownerPublish",
  ]) {
    const body = main.slice(main.indexOf(`  ${method}:`));
    assert.match(
      body.slice(0, 160),
      /client\.profiles\.gate\("settings"\)/,
      method,
    );
  }
  // Only GitHub's own token page opens from here.
  assert.match(
    main,
    /"https:\/\/github\.com\/settings\/personal-access-tokens\/new"/,
  );
  // The sealed token lives in its own file, never in the profile, a backup or
  // an account: nothing else reads it.
  for (const file of [
    "core/backup.mjs",
    "core/account.mjs",
    "core/client.mjs",
    "core/diagnose.mjs",
    "electron/diagnose.mjs",
  ])
    assert.doesNotMatch(read(file), /owner\.bin|ownerDevice|OwnerDevice/, file);
  assert.match(main, /join\(app\.getPath\("userData"\), "owner\.bin"\)/);
  // Hidden: seven taps on the version badge, never on the web.
  const studio = read("src/components/SettingsStudio.jsx");
  assert.match(studio, /t\.count >= 7/);
  assert.match(studio, /if \(isWeb\) return;/);
  assert.match(studio, /\{ownerDevice && \(/);
});
