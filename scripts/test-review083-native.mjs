// Windows Electron/MPV integration. External services are offline fixtures.
// A native Menu really opens; its selection is driven programmatically.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { resolve, join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url),
  { _electron } = require(process.env.RIWAQ_PLAYWRIGHT || "playwright");
if (process.platform !== "win32") throw Error("Windows is required");
const media = readFileSync(resolve(".cache/player-hud-test/fixture.mkv"));
const out = resolve(".cache/review083-native");
mkdirSync(out, { recursive: true });
let online = true;
const server = createServer((req, res) => {
  if (req.url.includes("video.mkv")) {
    if (!online) {
      res.writeHead(503);
      return res.end();
    }
    res.writeHead(200, {
      "content-type": "video/x-matroska",
      "content-length": media.length,
    });
    return res.end(media);
  }
  const body =
    req.url === "/manifest.json"
      ? {
          id: "review083.fixture",
          name: "Review fixture",
          version: "1.0.0",
          types: ["movie"],
          resources: ["stream"],
          catalogs: [],
        }
      : {
          streams: [
            { name: "Fixture direct", url: base + "/video.mkv" },
            { name: "Fixture pending torrent", infoHash: "a".repeat(40) },
          ],
        };
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const bootstrap = join(out, "bootstrap.mjs"),
  profile = join(out, `profile-${Date.now()}`);
writeFileSync(
  bootstrap,
  `
import {app,Menu} from "electron";import {TorrentHost} from ${JSON.stringify(pathToFileURL(resolve("electron/torrent.mjs")).href)};
import childProcess from "node:child_process";import {syncBuiltinESMExports} from "node:module";
app.getVersion=()=>"0.45.0";
const spawn=childProcess.spawn;childProcess.spawn=(file,args,opts)=>{const proc=spawn(file,args,opts);if(String(file).endsWith("mpv.exe"))globalThis.reviewMpv=proc.pid;return proc;};syncBuiltinESMExports();
const getUrl=TorrentHost.prototype.url;TorrentHost.prototype.url=function(stream,settings){if(stream.infoHash==="a".repeat(40))return new Promise(r=>globalThis.reviewResolve=r);return getUrl.call(this,stream,settings);};
const build=Menu.buildFromTemplate;Menu.buildFromTemplate=function(items){const menu=build.call(this,items);globalThis.reviewMenu=menu;menu.on("menu-will-show",()=>{globalThis.reviewPopup=true;});return menu;};
const originalFetch=globalThis.fetch;globalThis.fetch=(url,opts)=>String(url).startsWith(${JSON.stringify(base)})?originalFetch(url,opts):String(url).includes("raw.githubusercontent.com")?Promise.resolve(new Response('{"schema":1,"items":[]}')):String(url).endsWith("manifest.json")?Promise.resolve(new Response(JSON.stringify({id:"offline.fixture",name:"Offline",version:"1.0.0",types:["movie"],resources:["catalog"],catalogs:[]}))):Promise.resolve(new Response('{"metas":[]}'));
await import(${JSON.stringify(pathToFileURL(resolve("electron/main.mjs")).href)});
`,
);
const env = { ...process.env, RIWAQ_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.RIWAQ_SMOKE;
const app = await _electron.launch({
  executablePath: resolve("node_modules/electron/dist/electron.exe"),
  args: [bootstrap],
  cwd: process.cwd(),
  env,
  timeout: 20000,
});
const errors = [];
const wait = async (fn, label) => {
  for (let n = 0; n < 150; n++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error(label);
};
try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.waitForSelector(".app");
  const call = (m, a) =>
    page.evaluate(([m, a]) => window.riwaq.call(m, a), [m, a]);
  const player = async () => (await call("hudSnapshot")).player;
  if (await page.locator(".whats-new").count())
    await page.locator(".whats-new .primary").click();
  await call("settings", {
    autoFullscreen: false,
    playerOverlay: true,
    torrentEngine: "builtin",
    hdrMode: "tone-map",
    holdSpeed: 2,
  });
  await call("install", { url: base + "/manifest.json" });
  const streams = await call("streams", { type: "movie", id: "fixture:083" });
  const raw = streams.streams || streams;
  const direct = raw.find((s) => s.name.includes("direct")),
    torrent = raw.find((s) => s.name.includes("pending"));
  assert.ok(direct && torrent);
  const args = {
    meta: { type: "movie", id: "fixture:083", name: "Review 083" },
    videoId: "fixture:083",
  };
  const pending = call("play", { ...args, key: torrent.key });
  await wait(
    () => app.evaluate(() => typeof globalThis.reviewResolve === "function"),
    "engine preparation begins",
  );
  await call("stop");
  await app.evaluate(
    ({}, url) => globalThis.reviewResolve(url),
    base + "/video.mkv",
  );
  const cancelled = await pending;
  console.log(
    JSON.stringify({
      lateRequestCancelled: !!cancelled?.cancelled,
      activeAfterStop: (await player()).active,
    }),
  );
  assert.ok(
    cancelled?.cancelled,
    "a stopped pre-player request must not start MPV late",
  );
  assert.equal((await player()).active, false);
  console.log("Stop during pending engine preparation prevents late playback.");
  if (!process.argv.includes("--race-only")) {
    await call("play", { ...args, key: direct.key });
    await wait(async () => {
      const p = await player();
      return p.active && !p.loading && p.duration > 0;
    }, "real fixture playback");
    let hud;
    await wait(async () => {
      hud = app.windows().find((p) => p.url().endsWith("#hud"));
      return !!hud;
    }, "HUD ready");
    hud.on("pageerror", (e) => errors.push(e.message));
    await wait(
      async () => (await hud.locator(".volume-control").count()) > 0,
      "volume control",
    );
    const volume = hud.locator(".volume-control"),
      rect = await volume.boundingBox();
    await hud.mouse.move(rect.x + rect.width * 0.2, rect.y + rect.height / 2);
    await hud.mouse.down();
    await hud.mouse.move(rect.x + rect.width * 0.6, rect.y + rect.height / 2, {
      steps: 5,
    });
    await hud.mouse.up();
    await wait(
      async () => Math.abs((await player()).volume - 80) <= 3,
      "real MPV volume follows the drag",
    );
    const pauseBefore = (await player()).pause;
    await volume.focus();
    await hud.keyboard.press("ArrowRight");
    await wait(
      async () => (await player()).volume >= 83,
      "slider arrow updates MPV",
    );
    assert.equal((await player()).pause, pauseBefore);
    const bounds = await hud.locator(".hud-stage").boundingBox(),
      x = bounds.width * 0.5,
      y = bounds.height * 0.4;
    await hud.mouse.click(x, y);
    await wait(
      async () => (await player()).pause !== pauseBefore,
      "single-click pauses",
    );
    if ((await player()).pause)
      await call("playerCommand", { action: "pause" });
    await call("playerCommand", { action: "speed", value: 1 });
    await wait(async () => (await player()).speed === 1, "initial speed");
    await hud.mouse.move(x, y);
    await hud.mouse.down();
    await wait(async () => (await player()).speed === 2, "hold accelerates");
    await hud.mouse.up();
    await wait(
      async () => (await player()).speed === 1,
      "release restores speed",
    );
    assert.equal((await player()).pause, false);
    await hud.mouse.click(x, y, { button: "right" });
    await wait(
      () => app.evaluate(() => !!globalThis.reviewPopup),
      "right-click opens native menu",
    );
    await app.evaluate(() => globalThis.reviewMenu.closePopup());
    // A direct address can carry credentials (a home server's api_key, a
    // debrid key in an addon's path): only a torrent's magnet is offered.
    assert.equal(
      await app.evaluate(() =>
        globalThis.reviewMenu.items.some((x) => /نسخ رابط/.test(x.label)),
      ),
      false,
      "no copy item for a direct source",
    );
    await app.evaluate(() =>
      globalThis.reviewMenu.items
        .find((x) => x.label === "تنزيل الفيديو للمشاهدة لاحقًا")
        .click(),
    );
    const p = (await call("init")).profiles.active;
    let downloaded;
    await wait(async () => {
      downloaded = (await call("offlineList", { profileId: p })).items[0];
      return downloaded?.status === "ready";
    }, "download completes through real HTTP and disk");
    await call("stop");
    online = false;
    await call("offlinePlay", { profileId: p, id: downloaded.id });
    await wait(async () => {
      const p = await player();
      return p.active && !p.loading && p.duration > 0;
    }, "offline file plays with the source unavailable");
    await assert.rejects(
      call("offlineRemove", { profileId: p, id: downloaded.id }),
    );
    await call("stop");
    await call("offlineRemove", { profileId: p, id: downloaded.id });
    online = true;
    await page
      .getByRole("button", { name: "الإعدادات", exact: true })
      .first()
      .click();
    await page.getByText("الأساسيات أولًا", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "واجهة هادئة", exact: true })
      .click();
    await wait(
      async () => (await call("init")).settings.quietInterface === true,
      "quiet interface saved",
    );
    assert.equal(await page.locator(".profile-button").count(), 0);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => !w.webContents.getURL().endsWith("#hud"))
        .setSize(980, 680),
    );
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document.querySelector(".content")?.scrollTo(0, 0);
    });
    await page.screenshot({ path: join(out, "basic-ar-980.png") });
    await page
      .getByRole("button", { name: "إعدادات متقدمة", exact: true })
      .click();
    await page.locator(".studio-index").waitFor();
    // The new CSS is scoped to new screens. Existing Arabic navigation
    // must render identically with these rules enabled and disabled.
    await page.evaluate(() => {
      window.reviewCSS = [];
      for (const sheet of document.styleSheets) {
        for (let i = sheet.cssRules.length - 1; i >= 0; i--) {
          const rule = sheet.cssRules[i];
          if (
            /\.(quick-settings|settings-mode|offline-library)\b/.test(
              rule.selectorText || "",
            )
          ) {
            window.reviewCSS.push({ sheet, i, text: rule.cssText });
            sheet.deleteRule(i);
          }
        }
      }
    });
    const before = await page.locator(".studio-index").screenshot({
      animations: "disabled",
      path: join(out, "advanced-ar-css-before.png"),
    });
    await page.evaluate(() => {
      for (const { sheet, i, text } of window.reviewCSS.reverse())
        sheet.insertRule(text, i);
      delete window.reviewCSS;
    });
    const after = await page.locator(".studio-index").screenshot({
      animations: "disabled",
      path: join(out, "advanced-ar-css-after.png"),
    });
    assert.ok(
      before.equals(after),
      "new screen CSS must not change the Arabic advanced navigation pixels",
    );
    await page
      .getByRole("button", { name: "إعدادات أساسية", exact: true })
      .click();
    await page.getByRole("radio", { name: "English", exact: true }).click();
    await page.getByText("Essentials first", { exact: true }).waitFor();
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document.querySelector(".content")?.scrollTo(0, 0);
    });
    await page.screenshot({ path: join(out, "basic-en-980.png") });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await call("play", { ...args, key: direct.key });
    await wait(
      async () => (await player()).active && !(await player()).loading,
      "closing fixture plays",
    );
    const pid = await app.evaluate(() => globalThis.reviewMpv);
    await page
      .evaluate(() => window.riwaq.call("windowControl", { action: "close" }))
      .catch(() => {});
    await wait(async () => {
      try {
        process.kill(pid, 0);
        return false;
      } catch {
        return true;
      }
    }, "MPV exits after closing main while playing");
    assert.deepEqual(errors, []);
    console.log(
      "Windows review passed: volume drag/keys, click/hold, native menu callbacks, direct download, offline playback, basic/advanced and quiet UI in Arabic/English, closing during playback.",
    );
  }
} finally {
  await app.close().catch(() => {});
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
