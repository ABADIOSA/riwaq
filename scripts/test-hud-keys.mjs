// The HUD's keyboard in a real Chromium: the built page (dist, #hud) over a
// stub bridge that records what would reach main. Any OS; no Electron, MPV
// or Windows input (scripts/test-player-hud.mjs covers those on Windows).
//
//   npm run build && node scripts/test-hud-keys.mjs
//
// After a mouse press on the volume slider, Space, Esc, F and M still reach
// the player while the arrows stay the slider's. After a click on a button,
// Space reaches the player instead of pressing that button again, and the
// click itself still works. A button reached with Tab keeps Enter.
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { execSync } from "node:child_process";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "../core/protocol.mjs";
import { publicHotkeys } from "../core/hotkeys.mjs";

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

const dist = resolve("dist");
if (!existsSync(join(dist, "index.html")))
  throw new Error("Build first: npm run build");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};
const server = createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/") path = "/index.html";
  const file = join(dist, path);
  if (!file.startsWith(dist + sep) || !existsSync(file)) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] || "" });
  res.end(readFileSync(file));
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));

const state = {
  settings: { ...DEFAULT_SETTINGS },
  progress: {},
  hotkeys: publicHotkeys({}),
};
const player = {
  active: true,
  name: "Fixture",
  videoId: "tt0000001",
  mediaType: "movie",
  meta: { id: "tt0000001", type: "movie", name: "Fixture" },
  position: 300,
  duration: 3000,
  volume: 60,
  volumeMax: 150,
  speed: 1,
  pause: false,
  tracks: [],
};
const browser = await chromium.launch({
  executablePath: process.env.RIWAQ_CHROMIUM || undefined,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    ({ state, player }) => {
      window.__calls = [];
      const listeners = {};
      window.__emit = (event, value) =>
        listeners[event]?.forEach((fn) => fn(value));
      window.__player = player;
      window.__state = state;
      window.riwaq = {
        call: async (method, args) => {
          window.__calls.push([method, args]);
          if (method === "hudSnapshot") return { state, player };
          if (method === "trickplay")
            return new Promise((resolve) =>
              (window.__previewWaits ||= []).push(resolve),
            );
          if (method === "subtitles") return [];
          if (method === "playerSources") return { streams: [] };
          return true;
        },
        on: (event, fn) => {
          (listeners[event] ||= []).push(fn);
          return () => listeners[event].splice(listeners[event].indexOf(fn), 1);
        },
      };
    },
    { state, player },
  );
  await page.goto(`http://127.0.0.1:${server.address().port}/#hud`);
  await page.waitForSelector(".hud-stage.awake, .hud-stage.asleep");
  const sent = () =>
    page.evaluate(() =>
      window.__calls
        .filter(([method]) => method !== "hudIdle")
        .map(([method, a]) =>
          method === "playerKey"
            ? `key:${a.binding}`
            : `${method}:${a?.action || a?.type || ""}`,
        ),
    );
  const press = async (key) => {
    await page.evaluate(() => (window.__calls.length = 0));
    await page.keyboard.press(key);
    await page.waitForTimeout(80);
    return sent();
  };
  const wake = async () => {
    await page.mouse.move(640, 300);
    await page.mouse.move(650, 310);
    await page.waitForTimeout(150);
  };

  await wake();
  const slider = page.locator(".hud-stage .volume-control");
  const box = await slider.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  assert.equal(
    await page.evaluate(() => document.activeElement.role),
    "slider",
  );
  assert.deepEqual(await press("Space"), ["key:SPACE"], "Space after volume");
  assert.deepEqual(await press("f"), ["key:f"]);
  assert.deepEqual(await press("m"), ["key:m"]);
  await page.evaluate(() => {
    window.__calls.length = 0;
    document.activeElement.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ؤ", code: "KeyC", bubbles: true }),
    );
  });
  assert.deepEqual(
    await sent(),
    ["key:c"],
    "Arabic layout forwards the physical panel shortcut",
  );
  assert.deepEqual(await press("Escape"), ["key:ESC"], "Esc after volume");
  assert.deepEqual(
    await press("ArrowRight"),
    ["playerCommand:volume"],
    "the arrow stays the slider's",
  );
  console.log(
    "- the volume slider keeps its arrows, the player every other key",
  );

  await press("Home");
  await page.waitForTimeout(80);
  assert.equal(await slider.getAttribute("aria-valuenow"), "0");
  await press("End");
  await page.waitForTimeout(80);
  assert.equal(await slider.getAttribute("aria-valuenow"), "150");
  const spacing = await slider.evaluate((el) => {
    const knob = el.querySelector(".volume-knob").getBoundingClientRect();
    const value = el.nextElementSibling.getBoundingClientRect();
    return Math.max(value.left - knob.right, knob.left - value.right);
  });
  assert.ok(spacing >= 8, "volume text has clearance from the knob at maximum");

  await wake();
  await page.getByTitle("سرعة التشغيل", { exact: true }).click();
  await page.waitForFunction(
    () => document.activeElement?.textContent === "1×",
  );
  await page.evaluate(() => (window.__calls.length = 0));
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  assert.deepEqual(
    await page.evaluate(() =>
      window.__calls.filter(([m]) => m === "playerCommand"),
    ),
    [["playerCommand", { action: "speed", value: 1.25 }]],
  );
  console.log(
    "- compact choices keep arrow/Enter navigation away from player volume",
  );

  const commands = () =>
    page.evaluate(() =>
      window.__calls.filter(
        ([m]) => m === "playerCommand" || m === "playerKey",
      ),
    );
  const clear = () => page.evaluate(() => (window.__calls.length = 0));
  for (const title of ["سرعة التشغيل", "مؤقت النوم"]) {
    await wake();
    await page.getByTitle(title, { exact: true }).click();
    await page.getByRole("menu").waitFor();
    await clear();
    await page
      .getByRole("menu")
      .dispatchEvent("wheel", { deltaY: 120, bubbles: true });
    assert.deepEqual(
      await commands(),
      [],
      "scrolling a menu must not change volume",
    );
    await page.mouse.click(640, 300);
    await page.getByRole("menu").waitFor({ state: "detached" });
    await page.waitForTimeout(500);
    assert.deepEqual(
      await commands(),
      [],
      `${title}: dismissing must not pause`,
    );
  }
  await clear();
  await page.mouse.move(640, 300);
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(100);
  assert.deepEqual(
    await commands(),
    [["playerCommand", { action: "volume", value: 65 }]],
    "wheel on bare picture still adjusts volume",
  );
  assert.equal(
    await page.getByTitle("إعدادات المشغل", { exact: true }).count(),
    0,
  );
  await page.evaluate(() => {
    window.__player.speed = 1.25;
    window.__emit("player", { ...window.__player });
    document.activeElement?.blur();
  });
  await clear();
  await page.keyboard.down("Space");
  await page.waitForTimeout(420);
  await page.keyboard.down("Space");
  await page.keyboard.up("Space");
  assert.deepEqual(
    await commands(),
    [
      ["playerCommand", { action: "speed", value: 2 }],
      ["playerCommand", { action: "speed", value: 1.25 }],
    ],
    "Space hold restores previous speed without pause or repeat",
  );
  await clear();
  await page.keyboard.down("Space");
  await page.waitForTimeout(420);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.keyboard.up("Space");
  assert.deepEqual(
    await commands(),
    [
      ["playerCommand", { action: "speed", value: 2 }],
      ["playerCommand", { action: "speed", value: 1.25 }],
    ],
    "losing focus restores speed",
  );
  await clear();
  await page.keyboard.down("Space");
  await page.evaluate(() => {
    window.__player.videoId = "tt0000002";
    window.__emit("player", { ...window.__player });
  });
  await page.waitForTimeout(450);
  await page.keyboard.up("Space");
  assert.deepEqual(
    await commands(),
    [],
    "retired pending hold must not change or pause the next video",
  );
  console.log(
    "- outside clicks only dismiss speed/sleep; wheel stays in controls; Space hold restores speed on release/blur and cancels for replacement video",
  );

  await wake();
  await page.getByTitle("الترجمة (C أو الزر الأيمن)").click();
  await page.locator(".player-side").waitFor();
  await clear();
  await page
    .locator(".player-side")
    .dispatchEvent("wheel", { deltaY: 120, bubbles: true });
  assert.deepEqual(
    await commands(),
    [],
    "scrolling subtitles/audio does not change volume",
  );
  assert.equal(
    await page.evaluate(() => document.activeElement.tagName),
    "BODY",
  );
  assert.deepEqual(await press("Space"), ["key:SPACE"]);
  assert.equal(
    await page.locator(".player-side").count(),
    1,
    "Space did not press the panel button again",
  );
  await page.keyboard.press("Escape");
  await wake();
  await page.getByTitle("تشغيل أو إيقاف مؤقت (Space)").click();
  assert.deepEqual(await press("Space"), ["key:SPACE"]);
  console.log("- a clicked button still works, then Space reaches the player");

  await wake();
  await page.evaluate(() => document.activeElement?.blur());
  let tag = "";
  for (let i = 0; i < 12 && tag !== "BUTTON"; i++) {
    await page.keyboard.press("Tab");
    tag = await page.evaluate(() => document.activeElement.tagName);
  }
  assert.equal(tag, "BUTTON", "Tab reaches a button");
  const enter = await press("Enter");
  assert.ok(enter.length > 0, "Enter pressed the focused button");
  assert.ok(!enter.some((call) => call.startsWith("key:")), enter.join());
  console.log("- a button reached with Tab keeps Enter");

  await wake();
  if (await page.locator(".player-side").count())
    await page.getByTitle("إغلاق اللوحة").click();
  const timeline = page.locator(".hud-track"),
    track = await timeline.boundingBox();
  await page.mouse.move(
    track.x + track.width * 0.3,
    track.y + track.height / 2,
  );
  await page.getByRole("status", { name: "جاري تحميل المعاينة" }).waitFor();
  assert.ok(
    (await page.locator(".hud-seek-thumb").boundingBox()).height > 100,
    "preview reserves its frame before loading",
  );
  await page.waitForFunction(() => window.__previewWaits?.length === 1);
  await page.mouse.move(
    track.x + track.width * 0.7,
    track.y + track.height / 2,
  );
  await page.waitForFunction(() => window.__previewWaits?.length === 2);
  await page.evaluate(() => window.__previewWaits[0]("old-scene"));
  await page.getByRole("status", { name: "جاري تحميل المعاينة" }).waitFor();
  assert.equal(
    await page.locator(".hud-seek-thumb img").count(),
    0,
    "retired reply cannot show the previous scene",
  );
  await page.screenshot({
    path: join(dist, "../.cache/user-fixes-2026-10-18/preview-loading.png"),
  });
  await page.evaluate(() => window.__previewWaits[1](null));
  await page.getByRole("status", { name: "المعاينة غير متاحة" }).waitFor();
  await page.mouse.move(650, 300);
  await page.locator(".hud-seek-thumb").waitFor({ state: "detached" });
  console.log(
    "- preview frame appears immediately, ignores retired replies and reports unavailable results",
  );
  assert.deepEqual(errors, []);
  console.log("HUD keyboard: OK");
} finally {
  await browser.close();
  server.close();
}
