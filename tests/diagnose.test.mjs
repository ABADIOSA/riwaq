import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ErrorLog,
  cleanRendererErrors,
  errorEntry,
  formatReport,
  reportSettings,
  runCheck,
  sanitize,
  summarize,
} from "../core/diagnose.mjs";
import { runDiagnostics } from "../electron/diagnose.mjs";
import { DEFAULT_SETTINGS } from "../core/protocol.mjs";

const source = (file) =>
  readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8");

const SECRET = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8";

test("anything entering a report loses addresses, keys, e-mails and the user folder", () => {
  const text = sanitize(
    `GET https://torrentio.strem.fun/realdebrid=${SECRET}/manifest.json?x=1 failed; ` +
      `token eyJhbGciOi.eyJzdWIiOiIx.c2lnbmF0dXJl, mail me@example.com, ` +
      `file C:\\Users\\Abdoualelah\\AppData\\Roaming\\Riwaq\\profile.bin, ` +
      `key ${SECRET}`,
  );
  assert.match(text, /https:\/\/torrentio\.strem\.fun\/…/);
  assert.doesNotMatch(text, /realdebrid|manifest\.json|x=1/);
  assert.doesNotMatch(text, new RegExp(SECRET));
  assert.doesNotMatch(text, /eyJ|example\.com|Abdoualelah/);
  assert.match(text, /C:\\Users\\~\\AppData/);
  assert.equal(sanitize("/home/me/riwaq/x", { home: "/home/me" }), "~/riwaq/x");
  assert.ok(sanitize("x".repeat(1000), { max: 50 }).length <= 51);
});

test("errors are kept sanitized, dated and capped", () => {
  const log = new ErrorLog(3);
  for (let i = 0; i < 5; i++)
    log.add(`ipc:m${i}`, new Error(`boom ${i} https://a.example/${SECRET}`));
  const items = log.list();
  assert.equal(items.length, 3);
  assert.equal(items[0].where, "ipc:m2");
  assert.ok(items.every((e) => !e.message.includes(SECRET)));
  assert.match(
    errorEntry("x", new TypeError("bad")).message,
    /^TypeError: bad/,
  );
  const ui = cleanRendererErrors([
    { at: "2026-10-03T00:00:00Z", where: "call:x", message: `t ${SECRET}` },
    "junk",
  ]);
  assert.equal(ui.length, 1);
  assert.doesNotMatch(ui[0].message, new RegExp(SECRET));
  assert.deepEqual(cleanRendererErrors(null), []);
});

test("checks never throw, time out on their own and report their status", async () => {
  const ok = await runCheck("a", "A", async () => ({ detail: "fine" }));
  assert.equal(ok.status, "ok");
  const warn = await runCheck("b", "B", async () => ({ status: "warn" }));
  assert.equal(warn.status, "warn");
  const thrown = await runCheck("c", "C", async () => {
    throw new Error("nope");
  });
  assert.deepEqual([thrown.status, thrown.detail], ["fail", "nope"]);
  const slow = await runCheck("d", "D", () => new Promise(() => {}), {
    timeout: 50,
  });
  assert.equal(slow.status, "fail");
  assert.match(slow.detail, /المهلة/);
  assert.deepEqual(summarize([ok, warn, thrown]).counts, {
    ok: 1,
    warn: 1,
    fail: 1,
    skip: 0,
  });
  assert.equal(summarize([ok]).status, "ok");
});

test("settings in a report are choices only, never lists, paths or images", () => {
  const out = reportSettings({
    ...DEFAULT_SETTINGS,
    mpvPath: "C:\\Users\\me\\mpv.exe",
    serverUrl: "http://192.168.1.5:11470",
    seriesMemory: { tt1: {} },
    appearance: { identity: "riwaq", wallpaper: "https://x/y.jpg", colors: {} },
  });
  assert.equal(out.mpvPath, "مخصّص");
  assert.equal(out.serverUrl, "مخصّص");
  assert.equal(out.seriesMemory, undefined);
  assert.equal(out.appearance.wallpaper, true);
  assert.equal(out.appearance.colors, undefined);
  assert.equal(out.interfaceStyle, "riwaq");
  assert.equal(
    reportSettings({ serverUrl: "http://127.0.0.1:11470" }).serverUrl,
    "http://127.0.0.1:11470",
  );
});

function rig({ mpvExists = true, encryption = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "riwaq-diag-"));
  const mpv = join(dir, "mpv.exe");
  if (mpvExists) writeFileSync(mpv, "");
  const addonUrl = (name) =>
    `https://${name}.example/realdebrid=${SECRET}/manifest.json`;
  const client = {
    state: {
      settings: { ...DEFAULT_SETTINGS },
      addons: [
        {
          enabled: true,
          transportUrl: addonUrl("good"),
          manifest: { id: "good", name: "Good Addon" },
        },
        {
          enabled: true,
          transportUrl: addonUrl("dead"),
          manifest: { id: "dead", name: "Dead Addon" },
        },
        {
          enabled: false,
          transportUrl: addonUrl("off"),
          manifest: { id: "off", name: "Off" },
        },
      ],
      favorites: [{}, {}],
      progress: { a: {} },
      collections: [],
      queue: [],
    },
    updates: {
      publicState: () => ({
        installed: true,
        channel: "beta",
        status: "error",
        error: "HTTP 403",
        enabled: true,
      }),
    },
    publicState: () => ({
      integrations: [{ id: "trakt", connected: true }],
      providers: [{ id: "tmdb", configured: true, enabled: true }],
      profiles: { active: "p", list: [{ id: "p", protected: false }] },
      live: { sources: [] },
    }),
  };
  const fetcher = async (url) => {
    if (url.includes("dead.example"))
      throw Object.assign(new Error("x"), { name: "TimeoutError" });
    if (url.includes("11470")) throw new Error("refused");
    const status = url.includes("themoviedb") ? 401 : 200;
    return {
      status,
      body: null,
      headers: { get: (h) => (h === "x-ratelimit-remaining" ? "55" : null) },
    };
  };
  const deps = {
    app: {
      getVersion: () => "0.30.0",
      isPackaged: true,
      getPath: () => dir,
      getLocale: () => "ar",
      getGPUInfo: async () => ({
        gpuDevice: [
          { active: true, vendorId: 4318, deviceId: 7, driverVersion: "31.0" },
        ],
      }),
      getGPUFeatureStatus: () => ({
        gpu_compositing: "enabled",
        video_decode: "enabled",
      }),
    },
    client,
    executable: () => mpv,
    safeStorage: {
      isEncryptionAvailable: () => encryption,
      encryptString: (t) => Buffer.from(t),
      decryptString: (b) => b.toString(),
    },
    screen: {
      getAllDisplays: () => [
        {
          id: 1,
          size: { width: 2560, height: 1440 },
          scaleFactor: 1.5,
          colorDepth: 24,
        },
      ],
      getPrimaryDisplay: () => ({ id: 1 }),
    },
    errors: new ErrorLog(),
    rendererErrors: [
      { at: "t", where: "call:catalog", message: `x ${SECRET}` },
    ],
    fetcher,
    run: async (file, args) =>
      args.includes("--version")
        ? { code: 0, out: "mpv v0.39.0 Copyright" }
        : { code: 0, out: "" },
  };
  return { deps, dir };
}

test("the full run checks every area and names addons, never their links", async () => {
  const { deps } = rig();
  deps.errors.add(
    "ipc:play",
    new Error(`HTTP 500 at https://x.example/${SECRET}`),
  );
  const report = await runDiagnostics(deps);
  const ids = report.checks.map((c) => c.id);
  for (const id of [
    "encryption",
    "data",
    "mpv-file",
    "mpv-version",
    "mpv-decode",
    "video-surface",
    "server",
    "net-cinemeta",
    "net-github",
    "net-tmdb",
    "net-trakt",
    "addons",
    "updates",
  ])
    assert.ok(ids.includes(id), id);
  const by = Object.fromEntries(report.checks.map((c) => [c.id, c]));
  assert.equal(by.encryption.status, "ok");
  assert.equal(by.data.status, "ok");
  assert.equal(by["mpv-version"].detail, "mpv v0.39.0 Copyright");
  assert.equal(by["video-surface"].status, "skip");
  assert.equal(by.server.status, "warn");
  assert.equal(by["net-tmdb"].status, "ok", "401 without a key is reachable");
  assert.equal(by.addons.status, "warn");
  assert.match(by.addons.detail, /Dead Addon \(timeout\)/);
  assert.equal(by.updates.status, "warn");
  assert.equal(report.counts.addons, "2 مفعّلة من 3");
  assert.equal(report.counts.integrations, "trakt");
  assert.equal(report.system.displays[0].scale, 1.5);
  const text = formatReport(report);
  assert.match(text, /=== تقرير تشخيص رِواق ===/);
  assert.match(text, /\[!\] الإضافات المفعّلة/);
  assert.match(text, /\[ui\] call:catalog/);
  assert.match(text, /\[main\] ipc:play: HTTP 500/);
  assert.doesNotMatch(text, new RegExp(SECRET));
  assert.doesNotMatch(text, /realdebrid|manifest\.json/);
});

test("a visible host with a hidden MPV child does not pass the surface check", async () => {
  const { deps } = rig();
  const surface = {
    embedded: true,
    visible: true,
    nativeVisible: true,
    siblingsClipped: true,
    outputWindows: [{ visible: false, width: 1280, height: 720 }],
  };
  deps.videoHost = { inspect: () => surface };
  let report = await runDiagnostics(deps);
  assert.equal(
    report.checks.find((c) => c.id === "video-surface").status,
    "warn",
  );
  surface.outputWindows[0].visible = true;
  report = await runDiagnostics(deps);
  assert.equal(
    report.checks.find((c) => c.id === "video-surface").status,
    "ok",
  );
});

test("missing encryption or MPV are reported as problems, not crashes", async () => {
  const { deps } = rig({ mpvExists: false, encryption: false });
  const report = await runDiagnostics(deps);
  const by = Object.fromEntries(report.checks.map((c) => [c.id, c]));
  assert.equal(by.encryption.status, "fail");
  assert.equal(by["mpv-file"].status, "fail");
  assert.match(by["mpv-file"].detail, /أعد تثبيت/);
  assert.equal(by["mpv-version"], undefined, "no MPV, no MPV run");
  assert.equal(summarize(report.checks).status, "fail");
});

test("main runs it behind the Settings lock, logs errors, and keeps it off the HUD", () => {
  const main = source("electron/main.mjs");
  const run = main.slice(main.indexOf("diagnoseRun: async"));
  assert.match(run.slice(0, 200), /client\.profiles\.gate\("settings"\)/);
  assert.match(main, /logError\(`ipc:\$\{method\}`, error\)/);
  assert.match(main, /process\.on\("uncaughtExceptionMonitor"/);
  assert.match(main, /if \(failed\) logError\("player", s\.error\)/);
  for (const m of ["diagnoseRun", "diagnoseCopy", "diagnoseSave"])
    assert.match(source("electron/preload.cjs"), new RegExp(`"${m}"`));
  assert.doesNotMatch(source("core/hud.mjs"), /diagnose/);
  const api = source("src/lib/api.js");
  assert.match(api, /recordError\(`call:\$\{method\}`, error\)/);
});
