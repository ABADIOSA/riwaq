// Windows source integration: real Electron, its transparent controls window,
// MPV's embedded and separate-window paths, IPC and a local media fixture.
// The fixture is SDR even when labelled HDR to select the window path: this
// tests controls and lifecycle, not HDR luminance or Dolby Vision hardware.
// Build first. Needs Playwright (RIWAQ_PLAYWRIGHT or globally installed).
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  nativeHudClick,
  nativeHudKey,
  restoreCursor,
} from "./native-hud-input.mjs";

if (process.platform !== "win32")
  throw new Error("Run the native HUD test on Windows");
const require = createRequire(import.meta.url);
const candidates = [
  process.env.RIWAQ_PLAYWRIGHT,
  "playwright",
  join(execSync("npm root -g").toString().trim(), "playwright"),
].filter(Boolean);
let playwright;
for (const candidate of candidates) {
  try {
    playwright = require(candidate);
    break;
  } catch {}
}
assert.ok(playwright, "Playwright must be installed for the native HUD test");
const output = resolve(".cache/player-hud-test");
mkdirSync(output, { recursive: true });
const frame = Buffer.concat([
  Buffer.from("FRAME\n"),
  Buffer.alloc(320 * 180, 95),
  Buffer.alloc(160 * 90, 115),
  Buffer.alloc(160 * 90, 145),
]);
writeFileSync(
  join(output, "video.y4m"),
  Buffer.concat([
    Buffer.from("YUV4MPEG2 W320 H180 F5:1 Ip A1:1 C420jpeg\n"),
    ...Array(300).fill(frame),
  ]),
);
const samples = Buffer.alloc(60 * 8000 * 2);
const wav = Buffer.alloc(44);
wav.write("RIFF");
wav.writeUInt32LE(36 + samples.length, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24);
wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(samples.length, 40);
writeFileSync(join(output, "audio.wav"), Buffer.concat([wav, samples]));
// Encode a tiny file with a real audio track using the bundled MPV itself.
execFileSync(
  resolve("vendor/mpv/mpv.exe"),
  [
    "--no-config",
    "--terminal=yes",
    "--ovc=ffv1",
    "--oac=pcm_s16le",
    "--of=matroska",
    "--o=" + join(output, "fixture.mkv"),
    "--audio-file=" + join(output, "audio.wav"),
    join(output, "video.y4m"),
  ],
  { timeout: 20000, windowsHide: true, stdio: "pipe" },
);
const video = readFileSync(join(output, "fixture.mkv"));
const subtitle = "1\n00:00:00,000 --> 00:01:00,000\nHUD subtitle fixture\n";
let base;
const server = createServer((req, res) => {
  if (req.url.endsWith(".mkv")) {
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
    const start = range ? Number(range[1]) : 0;
    const end =
      range && range[2]
        ? Math.min(Number(range[2]), video.length - 1)
        : video.length - 1;
    if (start > end || start >= video.length) {
      res.writeHead(416, { "Content-Range": `bytes */${video.length}` });
      return res.end();
    }
    res.writeHead(range ? 206 : 200, {
      "Content-Type": "video/x-matroska",
      "Content-Length": end - start + 1,
      "Accept-Ranges": "bytes",
      ...(range
        ? { "Content-Range": `bytes ${start}-${end}/${video.length}` }
        : {}),
    });
    return res.end(video.subarray(start, end + 1));
  }
  if (req.url === "/ar.srt") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end(subtitle);
  }
  const data =
    req.url === "/manifest.json"
      ? {
          id: "riwaq.hud-fixture",
          name: "HUD fixture",
          version: "1.0.0",
          resources: ["stream", "subtitles"],
          types: ["movie"],
          catalogs: [],
          idPrefixes: ["hudfix:"],
        }
      : req.url.startsWith("/subtitles/")
        ? {
            subtitles: [
              { id: "fixture-ar", lang: "ara", url: base + "/ar.srt" },
            ],
          }
        : {
            streams: [
              { name: "Fixture 1080p", url: base + "/sdr.mkv" },
              { name: "Fixture 2160p HDR10", url: base + "/hdr.mkv" },
            ],
          };
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
base = "http://127.0.0.1:" + server.address().port;
const env = {
  ...process.env,
  RIWAQ_DATA_DIR: join(output, "profile-" + Date.now()),
};
delete env.RIWAQ_SMOKE;
delete env.ELECTRON_RUN_AS_NODE;
const app = await playwright._electron.launch({
  executablePath: resolve("node_modules/electron/dist/electron.exe"),
  args: ["."],
  cwd: process.cwd(),
  env,
  timeout: 20000,
});
const errors = [],
  checks = [];
try {
  const main = await app.firstWindow();
  main.setDefaultTimeout(10000);
  main.on("pageerror", (e) => errors.push(e.message));
  await main.waitForFunction(() => !!window.riwaq);
  await main.waitForSelector(".app", { timeout: 20000 });
  const call = (method, args) =>
    main.evaluate(([m, a]) => window.riwaq.call(m, a), [method, args]);
  // A fresh viewer completes or skips setup before it can click Play.
  // Do the same here instead of starting MPV beneath a live modal.
  const welcome = main.locator("dialog.first-run[open]");
  await welcome.waitFor({ timeout: 25000 });
  assert.equal((await call("usageState")).enabled, false);
  await main.screenshot({ path: join(output, "first-run-native.png") });
  await welcome
    .getByRole("button", { name: "الدخول مباشرة، أكمل لاحقاً", exact: true })
    .click();
  await welcome.waitFor({ state: "hidden" });
  assert.equal((await call("init")).onboarding.required, false);
  assert.equal((await call("usageState")).enabled, false);
  checks.push(
    "Windows first-run guide can be skipped without enabling usage sharing",
  );
  await call("settings", {
    hdrMode: "window",
    autoFullscreen: true,
    playerOverlay: true,
    seekThumbnails: "off",
  });
  await call("install", { url: base + "/manifest.json" });
  let hud = app.windows().find((p) => p.url().endsWith("#hud"));
  for (let i = 0; !hud && i < 100; i++) {
    await main.waitForTimeout(100);
    hud = app.windows().find((p) => p.url().endsWith("#hud"));
  }
  assert.ok(hud, "the HUD page navigates after its window is created");
  hud.setDefaultTimeout(10000);
  hud.on("pageerror", (e) => errors.push(e.message));
  const snapshot = () => hud.evaluate(() => window.riwaq.call("hudSnapshot"));
  const waitFor = async (predicate, message) => {
    for (let i = 0; i < 100; i++) {
      if (await predicate()) return;
      await main.waitForTimeout(100);
    }
    throw new Error(message);
  };
  await call("settings", { rememberVolume: true });
  for (const separate of [false, true]) {
    const streams = await call("streams", {
      type: "movie",
      id: "hudfix:video",
    });
    const source = streams.streams.find((s) =>
      s.name.includes(separate ? "HDR10" : "1080p"),
    );
    await call("play", {
      key: source.key,
      meta: { id: "hudfix:video", type: "movie", name: "HUD fixture" },
      videoId: "hudfix:video",
    });
    await waitFor(async () => {
      const s = await snapshot();
      return (
        s.player.duration > 0 && s.player.tracks.some((t) => t.type === "audio")
      );
    }, "MPV loads the duration and audio track");
    if (!(await snapshot()).player.pause)
      await call("playerCommand", { action: "pause" });
    await waitFor(async () => {
      const d = await call("diagnostics");
      return (
        d.controls.ready &&
        d.controls.visible &&
        d.controls.covered === separate
      );
    }, "the native HUD covers the viewing");
    const controls = (await call("diagnostics")).controls;
    if (separate)
      assert.ok(
        controls.separateWindow.width > 800,
        "Win32 finds MPV's actual window",
      );
    assert.equal((await snapshot()).player.separate, separate);
    assert.equal(
      Math.round((await snapshot()).player.volume),
      separate ? 150 : 100,
      "MPV restores the previous viewing volume",
    );
    // Activate our isolated test app through Windows before testing its
    // controls. A remote host's foreground browser is outside this test.
    await nativeHudClick(app, hud, hud.locator(".hud-title"));
    await hud.evaluate(() => {
      window.nativeEvents = [];
      window.nativeKeys = [];
      window.addEventListener("keydown", (event) =>
        window.nativeKeys.push({ key: event.key, code: event.code }),
      );
      for (const type of ["pointerdown", "pointerup", "click"])
        document.addEventListener(
          type,
          (e) =>
            window.nativeEvents.push({
              type,
              title: e.target.closest("button")?.title,
            }),
          true,
        );
    });
    await nativeHudClick(
      app,
      hud,
      hud.getByTitle("الترجمة (C أو الزر الأيمن)"),
    );
    console.log(
      JSON.stringify({
        separate,
        nativeEvents: await hud.evaluate(() => window.nativeEvents),
      }),
    );
    await hud.locator(".player-side").waitFor();
    assert.equal(
      await hud.evaluate(() => document.hasFocus()),
      true,
      "a Windows click activates the HUD",
    );
    await nativeHudClick(
      app,
      hud,
      hud.getByTitle("المسار الصوتي", { exact: true }),
    );
    assert.ok(
      await hud.getByText("المسار الصوتي", { exact: true }).isVisible(),
    );
    await nativeHudClick(
      app,
      hud,
      hud.getByTitle("الترجمة (C أو الزر الأيمن)", { exact: true }),
    );
    const subs = await call("subtitles");
    assert.ok(subs.length, "local subtitle addon is available");
    await call("subtitle", { key: subs[0].key });
    await waitFor(
      async () =>
        (await snapshot()).player.tracks.some((t) => t.type === "sub"),
      "MPV loads the subtitle",
    );
    await hud.screenshot({
      path: join(
        output,
        separate ? "separate-panel.png" : "embedded-panel.png",
      ),
    });
    await nativeHudKey(app, 27);
    await waitFor(
      async () => !(await hud.locator(".player-side").count()),
      "native Escape closes the panel before stopping playback",
    );
    assert.equal((await snapshot()).player.active, true);
    await nativeHudClick(
      app,
      hud,
      hud.getByTitle("المسار الصوتي", { exact: true }),
    );
    await hud.getByRole("tab", { name: "الصوت", exact: true }).waitFor();
    assert.equal(
      await hud
        .getByRole("tab", { name: "الصوت", exact: true })
        .getAttribute("aria-selected"),
      "true",
    );
    await nativeHudKey(app, 27);
    await nativeHudClick(
      app,
      hud,
      hud.getByTitle("سرعة التشغيل", { exact: true }),
    );
    await nativeHudClick(
      app,
      hud,
      hud.getByRole("menuitemradio", { name: "1.5×", exact: true }),
    );
    await waitFor(
      async () => (await snapshot()).player.speed === 1.5,
      "direct picker changes actual MPV speed",
    );
    // Native Windows keydown/up, not synthetic DOM events.
    await hud.evaluate(() => document.activeElement?.blur());
    const holdWasPaused = (await snapshot()).player.pause;
    if (holdWasPaused) await call("playerCommand", { action: "pause" });
    await waitFor(
      async () => !(await snapshot()).player.pause,
      "hold starts playing",
    );
    await nativeHudKey(app, 32, 500, async () => {
      await waitFor(
        async () => (await snapshot()).player.speed === 2,
        "native held Space accelerates MPV",
      );
    });
    await waitFor(
      async () => (await snapshot()).player.speed === 1.5,
      "released Space restores actual MPV speed",
    );
    assert.equal(
      (await snapshot()).player.pause,
      false,
      "hold never pauses MPV",
    );
    if (holdWasPaused) await call("playerCommand", { action: "pause" });
    await call("playerCommand", { action: "speed", value: 1 });
    for (const mode of ["crop", "stretch", "fit"]) {
      await nativeHudClick(app, hud, hud.locator("[data-picture-mode]"));
      await waitFor(async () => {
        const p = (await snapshot()).player;
        return (
          p.pictureMode === mode &&
          p.keepAspect === (mode !== "stretch") &&
          p.panscan === (mode === "crop" ? 1 : 0)
        );
      }, "native fit button changes actual MPV keepaspect and panscan");
    }
    const timeline = hud.locator(".hud-track");
    await nativeHudClick(app, hud, timeline, 0.25);
    await waitFor(
      async () => (await snapshot()).player.position >= 10,
      "the HUD seeks the video",
    );
    await waitFor(async () => {
      const clock = await hud.locator(".hud-seek > span").first().textContent();
      const parts = clock.trim().split(":").map(Number);
      return (
        parts.every(Number.isFinite) &&
        parts.reduce((time, part) => time * 60 + part, 0) >= 10
      );
    }, "the visible clock follows the actual seek");
    await nativeHudClick(app, hud, hud.getByRole("slider"), 0.6);
    await waitFor(
      async () => Math.abs((await snapshot()).player.volume - 80) <= 2,
      "native input sets real MPV volume",
    );
    await nativeHudKey(app, 39);
    await waitFor(
      async () => Math.abs((await snapshot()).player.volume - 85) <= 2,
      "slider arrow changes volume once, without seeking",
    );
    await nativeHudClick(app, hud, hud.locator(".hud-title"), 0.5);
    assert.equal(
      (await snapshot()).player.pause,
      true,
      "title click preserves paused playback before Space",
    );
    await nativeHudKey(app, 32);
    await waitFor(
      async () => !(await snapshot()).player.pause,
      "Space still resumes after clicking the picture",
    );
    await nativeHudKey(app, 32);
    await waitFor(
      async () => (await snapshot()).player.pause,
      "Space pauses exactly once",
    );
    await nativeHudKey(app, 67);
    console.log(
      JSON.stringify({
        separate,
        nativeKeys: await hud.evaluate(() => window.nativeKeys),
      }),
    );
    await hud.locator(".player-side").waitFor();
    await nativeHudKey(app, 27);
    await waitFor(
      async () => !(await hud.locator(".player-side").count()),
      "C opens and Escape closes the panel while HUD owns focus",
    );
    await call("playerCommand", { action: "volume", value: 150 });
    await waitFor(
      async () => (await snapshot()).player.volume === 150,
      "MPV applies boosted volume",
    );
    assert.equal((await call("init")).settings.lastVolume, 150);
    await hud.screenshot({
      path: join(
        output,
        separate ? "separate-controls.png" : "embedded-controls.png",
      ),
    });
    if (!(await snapshot()).player.pause)
      await call("playerCommand", { action: "pause" });
    await waitFor(
      async () => (await snapshot()).player.pause,
      "the viewing pauses before reload",
    );
    await hud.reload();
    await hud.getByTitle("إيقاف المشاهدة").waitFor();
    assert.equal(
      (await snapshot()).player.pause,
      true,
      "reload hydrates paused playback",
    );
    await nativeHudClick(
      app,
      hud,
      hud.getByTitle("تشغيل أو إيقاف مؤقت (Space)"),
    );
    await waitFor(
      async () => !(await snapshot()).player.pause,
      "native Pause button resumes after reload",
    );
    await nativeHudClick(
      app,
      hud,
      hud.getByTitle("تشغيل أو إيقاف مؤقت (Space)"),
    );
    await waitFor(
      async () => (await snapshot()).player.pause,
      "native Pause button pauses after reload",
    );
    if (separate) {
      const debug = await hud.context().newCDPSession(hud);
      await debug.send("Debugger.enable");
      await debug.send("Debugger.pause");
      try {
        await waitFor(async () => {
          const d = await call("diagnostics");
          return (
            !d.controls.ready && !d.controls.covered && !d.controls.visible
          );
        }, "the frozen HUD releases fallback controls");
      } finally {
        await debug.send("Debugger.resume");
        await debug.detach();
      }
      await waitFor(
        async () => (await call("diagnostics")).controls.covered,
        "the HUD recovers after resume",
      );
      checks.push(
        "frozen HDR HUD releases fallback controls and recovers after resume",
      );
    }
    await nativeHudClick(app, hud, hud.getByTitle("إيقاف المشاهدة"));
    await waitFor(
      async () => !(await call("hudSnapshot")).player.active,
      "the HUD Stop ends MPV",
    );
    checks.push(
      (separate ? "separate" : "embedded") +
        ": visible controls, subtitle/audio panels, real tracks, seek, paused reload and Stop",
    );
    if (separate) {
      await call("play", {
        key: source.key,
        meta: { id: "hudfix:video", type: "movie", name: "HUD fixture" },
        videoId: "hudfix:video",
      });
      await waitFor(
        async () => (await snapshot()).player.duration > 0,
        "the recovery viewing starts",
      );
      await call("playerCommand", { action: "seek", value: 12 });
      await waitFor(
        async () => (await snapshot()).player.position >= 10,
        "the recovery position is saved",
      );
      await nativeHudClick(app, hud, hud.locator(".hud-title"));
      const recoveryDebug = await hud.context().newCDPSession(hud);
      await recoveryDebug.send("Debugger.enable");
      await recoveryDebug.send("Debugger.pause");
      try {
        await nativeHudKey(app, 119); // Real Windows F8, renderer suspended.
        await waitFor(async () => {
          const p = (await call("hudSnapshot")).player;
          return p.active && !p.separate && !p.loading && p.position >= 10;
        }, "native F8 recovers playback even while the HUD renderer is frozen");
      } finally {
        await recoveryDebug.send("Debugger.resume");
        await recoveryDebug.detach();
      }
      assert.equal(
        (await call("init")).settings.hdrMode,
        "window",
        "saved HDR preference is preserved",
      );
      await waitFor(async () => {
        const controls = (await call("diagnostics")).controls;
        return controls.ready && controls.visible && !controls.covered;
      }, "the resumed renderer and embedded HUD finish the recovery transition");
      await hud.getByTitle("تصغير ومتابعة التصفح").waitFor();
      await hud.evaluate(() => {
        window.recoveryClicks = [];
        document.addEventListener(
          "click",
          (event) =>
            window.recoveryClicks.push(
              event.target.closest("button")?.title || event.target.className,
            ),
          { capture: true, once: true },
        );
      });
      await hud.mouse.move(20, 20);
      await hud.mouse.move(60, 60);
      await nativeHudClick(app, hud, hud.getByTitle("إيقاف المشاهدة"));
      console.log(
        JSON.stringify({
          recoveryClicks: await hud.evaluate(() => window.recoveryClicks),
        }),
      );
      await waitFor(
        async () => !(await call("hudSnapshot")).player.active,
        "recovered playback stops",
      );
      checks.push(
        "native Windows F8 with the HUD renderer frozen resumes inside Riwaq and preserves the saved HDR preference",
      );
    }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks, errors, output }));
} finally {
  restoreCursor();
  await app.close();
  server.close();
}
