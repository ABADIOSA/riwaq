// The web edition in a real Chromium: the built site (dist-web), a local
// Stremio addon with CORS, real playback, the encrypted browser store, a
// backup the desktop's core/backup.mjs opens, and the one-tab lock.
//
//   npm run build:web && node scripts/test-web.mjs
//
// Needs Playwright with its Chromium (`npm i -g playwright`, or set
// RIWAQ_PLAYWRIGHT to its folder). Nothing here reaches the internet; the
// addon, the video and the subtitle are served from this machine.
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { execFileSync, execSync } from "node:child_process";
import assert from "node:assert/strict";
import { decryptBackup } from "../core/backup.mjs";
import { serveLocally, sqliteD1 } from "../server/accounts/local.mjs";

const require = createRequire(import.meta.url);
function loadPlaywright() {
  const candidates = [
    process.env.RIWAQ_PLAYWRIGHT,
    "playwright",
    (() => {
      try {
        return join(execSync("npm root -g").toString().trim(), "playwright");
      } catch {
        return "";
      }
    })(),
  ].filter(Boolean);
  for (const name of candidates) {
    try {
      return require(name);
    } catch {}
  }
  throw new Error(
    "Playwright not found: npm i -g playwright, or set RIWAQ_PLAYWRIGHT",
  );
}
const { chromium } = loadPlaywright();

const site = resolve("dist-web");
if (!existsSync(join(site, "index.html")))
  throw new Error("Build the site first: npm run build:web");
const output = resolve(".cache/web-smoke");
mkdirSync(output, { recursive: true });

// --- The site, as GitHub Pages serves it --------------------------------
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};
const serveDir = (site) => (req, res) => {
  let path = join(
    site,
    decodeURIComponent(new URL(req.url, "http://x").pathname),
  );
  if (!path.startsWith(site)) path = site;
  if (existsSync(path) && statSync(path).isDirectory())
    path = join(path, "index.html");
  if (!existsSync(path)) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.setHeader(
    "Content-Type",
    TYPES[extname(path)] || "application/octet-stream",
  );
  res.end(readFileSync(path));
};
const siteServer = createServer(serveDir(site));

// --- A Stremio addon on this machine --------------------------------------
let video = Buffer.alloc(0);
let base;
const titles = [
  ["last-train", "القطار الأخير"],
  ["blue-hour", "الساعة الزرقاء"],
  ["quiet-city", "مدينة هادئة"],
];
const metas = () =>
  titles.map(([id, name]) => ({
    id: `webfix:${id}`,
    name,
    type: "movie",
    runtime: "1 min",
    genres: ["Drama"],
    poster: `${base}/poster/${id}.svg`,
    releaseInfo: "2025",
    description: "عنوان تجريبي لاختبار نسخة الويب من رِواق.",
  }));
const SRT = `1\n00:00:00,500 --> 00:00:30,000\nترجمة تجريبية من الإضافة\n\n`;
const addon = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const url = decodeURIComponent(req.url);
  if (url.startsWith("/poster/")) {
    res.setHeader("Content-Type", "image/svg+xml");
    res.end(
      `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#25394b"/><circle cx="240" cy="175" r="94" fill="#af8660"/><text x="30" y="540" fill="#f8eddf" font-size="30" font-family="Georgia">RIWAQ WEB</text></svg>`,
    );
    return;
  }
  if (url === "/video.webm") {
    res.setHeader("Content-Type", "video/webm");
    res.end(video);
    return;
  }
  if (url === "/subs/ar.srt") {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(SRT);
    return;
  }
  let data = {};
  if (url === "/manifest.json")
    data = {
      id: "riwaq.web-fixture",
      name: "Riwaq web fixture",
      version: "1.0.0",
      resources: ["catalog", "meta", "stream", "subtitles"],
      types: ["movie"],
      idPrefixes: ["webfix:"],
      catalogs: [{ id: "webfix", type: "movie", name: "أعمال تجريبية" }],
    };
  else if (url.startsWith("/catalog/")) data = { metas: metas() };
  else if (url.startsWith("/meta/"))
    data = { meta: metas().find((m) => url.includes(m.id)) };
  else if (url.startsWith("/stream/"))
    data = {
      streams: [
        {
          url: `${base}/video.webm`,
          name: "Fixture",
          title: "Fixture WEB-DL",
        },
      ],
    };
  else if (url.startsWith("/subtitles/"))
    data = {
      subtitles: [{ id: "fix-ar", url: `${base}/subs/ar.srt`, lang: "ara" }],
    };
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
});

const listen = (server) =>
  new Promise((r) =>
    server.listen(0, "127.0.0.1", () => r(server.address().port)),
  );
const sitePort = await listen(siteServer);
base = `http://127.0.0.1:${await listen(addon)}`;
const siteUrl = `http://127.0.0.1:${sitePort}/`;

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  acceptDownloads: true,
});
const problems = [];
const watch = (page) => {
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (m) => {
    // Hosts outside this machine (Cinemeta, Wikidata…) may be unreachable
    // where this runs; only the page's own errors count.
    if (m.type() === "error" && !/Failed to load resource/.test(m.text()))
      problems.push(`console: ${m.text()}`);
  });
};
const step = (name) => console.log(`- ${name}`);

try {
  // A short WebM recorded by Chromium itself: no video tool is needed.
  const recorder = await context.newPage();
  await recorder.goto(`${base}/manifest.json`);
  const recorded = await recorder.evaluate(async () => {
    const canvas = Object.assign(document.createElement("canvas"), {
      width: 320,
      height: 180,
    });
    const g = canvas.getContext("2d");
    const stream = canvas.captureStream(25);
    const chunks = [];
    const rec = new MediaRecorder(stream, {
      mimeType: "video/webm;codecs=vp8",
    });
    rec.ondataavailable = (e) => chunks.push(e.data);
    let frame = 0;
    const timer = setInterval(() => {
      g.fillStyle = `hsl(${frame++ * 7}, 60%, 40%)`;
      g.fillRect(0, 0, 320, 180);
      g.fillStyle = "#fff";
      g.font = "40px sans-serif";
      g.fillText(String(frame), 130, 105);
    }, 40);
    rec.start(500);
    await new Promise((r) => setTimeout(r, 8000));
    rec.stop();
    clearInterval(timer);
    await new Promise((r) => (rec.onstop = r));
    const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
    let text = "";
    for (const b of bytes) text += String.fromCharCode(b);
    return btoa(text);
  });
  video = Buffer.from(recorded, "base64");
  await recorder.close();
  assert.ok(video.length > 1000, "a test video was recorded");

  const page = await context.newPage();
  watch(page);
  await page.goto(siteUrl);
  await page.waitForFunction(() => window.riwaq?.platform === "web");
  await page.waitForSelector(".app", { timeout: 20000 });
  step("the site starts with the web bridge and Riwaq's interface");
  await page.screenshot({ path: join(output, "home.png") });

  const call = (method, args) =>
    page.evaluate(([m, a]) => window.riwaq.call(m, a), [method, args]);
  const installed = await call("install", { url: `${base}/manifest.json` });
  assert.ok(
    installed.addons.some((a) => a.id === "riwaq.web-fixture"),
    "the addon installs through the bridge",
  );
  step("an addon installs through the same core/Client as the desktop");

  // The store is sealed: the addon's name is nowhere in what is saved.
  await page.waitForTimeout(500);
  const sealed = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("riwaq-web");
        open.onsuccess = () => {
          const get = open.result
            .transaction("vault")
            .objectStore("vault")
            .get("profile");
          get.onsuccess = () => {
            const r = get.result;
            const text = new TextDecoder().decode(r.data);
            resolve({
              binary: r.data instanceof ArrayBuffer,
              plain: text.includes("Riwaq web fixture"),
              keyType: typeof r.iv,
            });
          };
          get.onerror = () => reject(get.error);
        };
        open.onerror = () => reject(open.error);
      }),
  );
  assert.deepEqual(sealed, { binary: true, plain: false, keyType: "object" });
  step("the saved profile is AES-GCM ciphertext, never plaintext");

  // A second tab is refused, as the desktop allows one instance.
  const second = await context.newPage();
  await second.goto(siteUrl);
  await second.waitForSelector(".web-boot[role=alert]");
  assert.match(await second.innerText("body"), /تبويب آخر/);
  await second.close();
  step("a second tab is refused while the first owns the store");

  // Reload: the addon is still there (the store opened and decrypted).
  await page.reload();
  await page.waitForSelector(".app", { timeout: 20000 });
  const after = await call("init");
  assert.ok(after.addons.some((a) => a.id === "riwaq.web-fixture"));
  step("after a reload the encrypted store opens with the addon in it");

  // The catalog reaches the interface: open Discover and find a poster.
  await page.getByText("اكتشف", { exact: true }).first().click();
  await page.waitForSelector(`img[src*="/poster/last-train.svg"]`, {
    timeout: 20000,
  });
  await page.screenshot({ path: join(output, "discover.png") });
  step("Discover shows the addon's titles");

  // Sources and playback: the bridge picks the stream, the interface shows
  // the theater, and the HTML5 player plays inside its surface.
  const meta = await call("metadata", {
    type: "movie",
    id: "webfix:last-train",
  });
  assert.equal(meta?.name, "القطار الأخير");
  const sources = await call("streams", {
    type: "movie",
    id: "webfix:last-train",
  });
  const key = sources.streams?.[0]?.key;
  assert.ok(key, "the addon's stream is ranked and keyed");
  await call("play", {
    key,
    meta: { id: meta.id, type: "movie", name: meta.name },
    videoId: "webfix:last-train",
  });
  await page.waitForSelector(".theater .video-surface video.riwaq-video");
  await page.waitForFunction(
    () => document.querySelector("video.riwaq-video")?.currentTime > 1.5,
    null,
    { timeout: 20000 },
  );
  step("the stream plays in the theater's surface");

  // An addon subtitle, as the panel adds it.
  const subs = await call("subtitles");
  assert.ok(subs.length >= 1, "the addon's subtitle is listed");
  await call("subtitle", { key: subs[0].key });
  const track = await page.evaluate(() => {
    const t = [...document.querySelector("video.riwaq-video").textTracks].find(
      (x) => x.mode === "showing",
    );
    return t ? t.cues.length : 0;
  });
  assert.ok(track >= 1, "the subtitle shows as a text track");
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(output, "player.png") });
  step("an addon subtitle is fetched, parsed by core/subtitles and shown");

  await call("playerCommand", { action: "pause" });
  await page.waitForFunction(
    () => document.querySelector("video.riwaq-video")?.paused,
  );
  await call("stop");
  await page.waitForFunction(() => !document.querySelector(".theater"));
  const progress = (await call("init")).progress["movie:webfix:last-train"];
  assert.ok(progress?.position > 1, "progress is saved");
  step("pause and stop work, and the position is saved for resuming");

  // A backup made on the web opens with the desktop's own code.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    call("backupExport", { passphrase: "riwaq-web-test" }),
  ]);
  const file = join(output, "web.riwaq");
  await download.saveAs(file);
  const { payload } = decryptBackup(
    readFileSync(file, "utf8"),
    "riwaq-web-test",
  );
  assert.ok(
    JSON.stringify(payload).includes("riwaq.web-fixture"),
    "the backup carries the addon",
  );
  step(
    "a web backup decrypts with core/backup.mjs under Node, as on the desktop",
  );

  // --- Riwaq accounts: two devices, one account -------------------------
  // A copy of the site pointed at the account service (server/accounts)
  // running here over SQLite; each device is its own browser context.
  const accountSite = join(output, "site-accounts");
  const accountServer = createServer(serveDir(accountSite));
  const accountOrigin = `http://127.0.0.1:${await listen(accountServer)}`;
  const db = sqliteD1();
  const service = await serveLocally({ origins: accountOrigin, db });
  execFileSync(
    process.execPath,
    [
      resolve("node_modules/vite/bin/vite.js"),
      "build",
      "--config",
      "vite.web.config.mjs",
      "--outDir",
      accountSite,
      "--emptyOutDir",
      "--logLevel",
      "error",
    ],
    {
      env: { ...process.env, RIWAQ_ACCOUNT_SERVER: service.url },
      stdio: "inherit",
    },
  );
  const openDevice = async () => {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const tab = await ctx.newPage();
    watch(tab);
    await tab.goto(`${accountOrigin}/`);
    await tab.waitForFunction(() => window.riwaq?.platform === "web");
    await tab.waitForSelector(".app", { timeout: 20000 });
    // The first init settles before navigating (it can send the view home).
    await tab.evaluate(() => window.riwaq.call("init"));
    await tab.waitForTimeout(500);
    return {
      tab,
      call: (method, args) =>
        tab.evaluate(([m, a]) => window.riwaq.call(m, a), [method, args]),
      openAccount: async () => {
        await tab.click('button.riwaq-tool[aria-label="الإعدادات"]');
        await tab.getByText("الحسابات والربط", { exact: true }).first().click();
        await tab.getByText("حساب رِواق", { exact: true }).first().click();
      },
    };
  };
  const password = "riwaq web account test";
  const pc = await openDevice();
  await pc.call("install", { url: `${base}/manifest.json` });
  await pc.call("favorite", {
    id: "webfix:blue-hour",
    type: "movie",
    name: "الساعة الزرقاء",
  });
  await pc.call("settings", { seekStep: 30 });
  await pc.openAccount();
  await pc.tab.getByLabel("اسم المستخدم (حروف إنجليزية وأرقام)").fill("Abadi");
  await pc.tab
    .getByLabel("كلمة المرور الجديدة (10 أحرف على الأقل)")
    .fill(password);
  await pc.tab.getByLabel("أعد كتابتها").fill(password);
  await pc.tab.screenshot({ path: join(output, "account-signup.png") });
  await pc.tab.getByRole("button", { name: "سوّ حسابي" }).click();
  await pc.tab.waitForSelector(".recovery-code", { timeout: 60000 });
  const code = await pc.tab.inputValue(".recovery-code");
  assert.match(code, /^([0-9A-Z]{4}-){5}[0-9A-Z]{4}$/);
  await pc.tab.screenshot({ path: join(output, "account-recovery.png") });
  await pc.tab.getByRole("button", { name: "حفظته في مكان آمن" }).click();
  await pc.tab.getByText("حسابك:").waitFor();
  step("an account is made in the interface and shows its recovery code once");

  const stored = JSON.stringify([
    (await db.prepare("SELECT * FROM users").all()).results,
    (await db.prepare("SELECT * FROM chunks").all()).results,
  ]);
  for (const plain of ["الساعة الزرقاء", "webfix", password, "seekStep"])
    assert.ok(!stored.includes(plain), `the server holds no ${plain}`);
  step("the account service holds only hashes and ciphertext");

  const phone = await openDevice();
  await phone.openAccount();
  await phone.tab.getByText("تسجيل الدخول", { exact: true }).click();
  await phone.tab
    .getByLabel("اسم المستخدم (حروف إنجليزية وأرقام)")
    .fill("abadi");
  await phone.tab.getByLabel("كلمة المرور", { exact: true }).fill(password);
  await phone.tab.getByRole("button", { name: "ادخل" }).click();
  await phone.tab.getByText("حسابك:").waitFor({ timeout: 60000 });
  await phone.tab.screenshot({ path: join(output, "account-signed-in.png") });
  const arrived = await phone.call("init");
  assert.ok(arrived.favorites.some((f) => f.name === "الساعة الزرقاء"));
  assert.equal(arrived.settings.seekStep, 30);
  assert.ok(arrived.addons.some((a) => a.id === "riwaq.web-fixture"));
  step("a second device signs in and gets the library, settings and addons");

  await phone.call("favorite", {
    id: "webfix:quiet-city",
    type: "movie",
    name: "مدينة هادئة",
  });
  await phone.call("accountSync");
  await pc.call("accountSync");
  const back = await pc.call("init");
  assert.ok(back.favorites.some((f) => f.name === "مدينة هادئة"));
  step("a change on one device reaches the other");
  await service.close();
  accountServer.close();

  assert.deepEqual(problems, []);
  console.log(`\nWeb smoke passed. Screenshots in ${output}`);
} finally {
  await browser.close();
  siteServer.close();
  addon.close();
}
