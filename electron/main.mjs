import {
  app,
  BrowserWindow,
  ipcMain,
  safeStorage,
  dialog,
  shell,
  session,
  screen,
  clipboard,
  globalShortcut,
  powerMonitor,
  nativeImage,
  protocol,
} from "electron";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  renameSync,
  copyFileSync,
  statSync,
} from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { Client, fetchText } from "../core/client.mjs";
import {
  automaticSubtitle,
  cuesAround,
  parseCues,
  preferredLanguages,
} from "../core/subtitles.mjs";
import { matchTrack, seriesOf, trackIdentity } from "../core/series-memory.mjs";
import { skipPreferences } from "../core/skip-segments.mjs";
import { torrentUrl, webUrl } from "../core/protocol.mjs";
import { musicLink, musicSearchUrl } from "../core/music.mjs";
import {
  SPOTIFY_PORT,
  authorizeUrl as spotifyAuthorizeUrl,
  pkce as spotifyPkce,
} from "../core/spotify.mjs";
import { inputConf } from "../core/hotkeys.mjs";
import { DEBRID } from "../core/services.mjs";
import { fetchPackText } from "../core/badges.mjs";
import { artworkHost } from "../core/artwork.mjs";
import {
  FIVE,
  PRAYER_NAMES,
  clockAt,
  prayerPlace,
  prayerTimes,
} from "../core/prayer.mjs";
import { AI_PROVIDERS } from "../core/ai-search.mjs";
import { readBackupHeader } from "../core/backup.mjs";
import { effectiveZoom, resolveAppearance } from "../core/appearance.mjs";
import {
  HUD_METHODS,
  HUD_REQUESTS,
  hudRect,
  hudVisible,
} from "../core/hud.mjs";
import { DiscordPresence, buildActivity } from "../core/presence.mjs";
import { Player } from "./player.mjs";
import { parseAudioDevices } from "../core/player-tuning.mjs";
import { measureDownload, suggestCap } from "../core/speed-test.mjs";
import { Thumbnailer } from "./thumbnails.mjs";
import { dropKind } from "../core/drop.mjs";
import { nextSource, playableKeys } from "../core/failover.mjs";
import { VideoHost, showSystemCursor } from "./video-host.mjs";
import { CursorGate, cursorHidden } from "../core/cursor.mjs";
import { trailerOf } from "../core/credits.mjs";
import { toNuvio } from "../core/collections.mjs";
import {
  NUVIO_STORES,
  nuvioDiagnostics,
  nuvioFolders,
  nuvioPreview,
  parseProperties,
  readNuvioZip,
} from "../core/nuvio.mjs";
import { DesktopUpdates } from "./updater.mjs";
import { probeAddons, runDiagnostics } from "./diagnose.mjs";
import { ErrorLog, formatReport } from "../core/diagnose.mjs";
import { homedir } from "node:os";
import { MusicLibrary, AUDIO_TYPES } from "./music-library.mjs";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "riwaq-audio",
    privileges: { standard: true, secure: true, stream: true },
  },
]);

const root = dirname(dirname(fileURLToPath(import.meta.url)));
if (process.env.RIWAQ_DATA_DIR)
  app.setPath("userData", process.env.RIWAQ_DATA_DIR);
app.setName("Riwaq");
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on("second-instance", () => {
  if (window?.isMinimized()) window.restore();
  window?.show();
  window?.focus();
});
let window, client, player, videoHost, loginServer, loginTimer, presence;
let musicLibrary;
function stopLocalMusic() {
  musicLibrary?.revoke();
  emit("musicStop", {});
}
// A picked backup stays in main between "preview" and "restore"; the renderer
// only ever holds the opaque token.
let pendingBackup = null;
// A Nuvio snapshot between its preview and the import, held in main only.
let pendingNuvio = null;
const nuvioReply = (stores, source) => {
  const profiles = nuvioPreview(stores);
  if (!profiles.length) throw new Error("لم نجد ملفات شخصية في بيانات نوفيو");
  pendingNuvio = { token: randomBytes(16).toString("hex"), stores };
  return { token: pendingNuvio.token, source, profiles };
};
let watching = { active: false, pip: false, error: false };
// What is playing from an addon stream: subtitle requests need its stream key.
let nowPlaying = null;
// Recent errors for the diagnostic report, sanitized as they are recorded:
// the interface only ever shows a generic sentence for most of them.
const errorLog = new ErrorLog();
const logError = (where, error) =>
  errorLog.add(where, error, { home: homedir() });
process.on("unhandledRejection", (error) => logError("main:promise", error));
process.on("uncaughtExceptionMonitor", (error) =>
  logError("main:crash", error),
);
// The last full diagnostic, kept in main for copying and saving.
let lastDiagnosis = null;
// Playable sources per title in ranked order, for automatic failover.
const ranked = new Map();
function remember({ type, id }, result) {
  const keys = playableKeys(result);
  ranked.delete(`${type}:${id}`);
  if (ranked.size >= 20) ranked.delete(ranked.keys().next().value);
  ranked.set(`${type}:${id}`, keys);
}
// Sources already tried for the title that is failing over.
let failover = { id: null, tried: new Set() };
/**
 * When a source fails, play the next ranked one from the same position.
 * At most three attempts per title, and only for addon streams.
 */
async function tryNextSource() {
  if (client.state.settings.autoFailover === false || !nowPlaying) return;
  const current = nowPlaying;
  if (failover.id !== current.id)
    failover = { id: current.id, tried: new Set() };
  failover.tried.add(current.key);
  const next = nextSource(
    ranked.get(`${current.type}:${current.id}`),
    failover.tried,
  );
  if (!next || !player.meta) return;
  emit("notice", "تعذّر هذا المصدر؛ نجرّب المصدر التالي تلقائياً…");
  try {
    await play({ key: next, meta: player.meta, videoId: current.id });
  } catch {
    /* The viewer can still pick a source by hand. */
  }
}
// Media keys control playback only while something plays.
let mediaKeys = false;
function setMediaKeys(on) {
  if (on === mediaKeys) return;
  mediaKeys = on;
  const keys = {
    MediaPlayPause: () => player.command({ action: "pause" }),
    MediaStop: () => player.stop(),
    MediaNextTrack: () => emit("playerRequest", { type: "next" }),
    MediaPreviousTrack: () => emit("playerRequest", { type: "previous" }),
  };
  for (const [key, run] of Object.entries(keys)) {
    try {
      if (on) globalShortcut.register(key, () => player.state.active && run());
      else globalShortcut.unregister(key);
    } catch {
      /* Another application may own the key. */
    }
  }
}
// Parsed addon subtitles for quick sync, a few at a time.
const cueCache = new Map();
// The HUD: a transparent window over the video surface; see core/hud.mjs.
let hud = null;
let hudReady = false;
let surfaceShown = false;
// Whether the HUD's controls are asleep, reported by the HUD page.
let hudIdle = false;
let cursorCheck = () => {};
const cursorGate = new CursorGate((visible) => {
  if (process.platform === "win32") showSystemCursor(visible);
});
const HUD_EVENTS = new Set(["player", "state", "notice", "hudCommand"]);
const emit = (name, data) => {
  if (window && !window.isDestroyed() && name !== "hudCommand")
    window.webContents.send("riwaq:" + name, data);
  if (hud && !hud.isDestroyed() && hudReady && HUD_EVENTS.has(name))
    hud.webContents.send("riwaq:" + name, data);
};
/**
 * During a viewing: a heads-up five minutes before a prayer and a notice at
 * its time; when the viewer asked for it, the viewing pauses at the adhan.
 * Times come from core/prayer.mjs on this machine; nothing is sent anywhere.
 */
const prayerSeen = new Set();
function checkPrayer(now = new Date()) {
  const s = client?.state.settings;
  if (!s?.prayerOn || !player?.state.active) return;
  const place = prayerPlace(s);
  const times = prayerTimes(now, {
    ...place,
    method: s.prayerMethod,
    asr: s.prayerAsr,
  });
  for (const key of FIVE) {
    const at = times[key];
    if (!at) continue;
    const diff = now - at;
    const id = `${at.toISOString()}:${key}`;
    const name = PRAYER_NAMES[key];
    if (
      s.prayerHeadsUp &&
      diff >= -5 * 60000 &&
      diff < -4 * 60000 &&
      !prayerSeen.has(`${id}:soon`)
    ) {
      prayerSeen.add(`${id}:soon`);
      emit("notice", `أذان ${name} بعد خمس دقائق (${clockAt(at, place.tz)})`);
    }
    if (diff >= 0 && diff < 2 * 60000 && !prayerSeen.has(id)) {
      prayerSeen.add(id);
      if (s.prayerPause && !player.state.pause) {
        player.send(["set_property", "pause", true]);
        emit(
          "notice",
          `حان وقت صلاة ${name}. أوقفنا المشاهدة مؤقتاً، وتكمل من نفس اللحظة متى ما رجعت.`,
        );
      } else emit("notice", `حان وقت صلاة ${name} (${clockAt(at, place.tz)})`);
    }
  }
  if (prayerSeen.size > 60) prayerSeen.clear();
}
const overlayEnabled = () =>
  !process.env.RIWAQ_SMOKE && client?.state.settings.playerOverlay !== false;
/** Creates the HUD once; it stays hidden until a viewing needs it. */
function ensureHud() {
  if (!overlayEnabled() || !window || window.isDestroyed()) return null;
  if (hud && !hud.isDestroyed()) return hud;
  hudReady = false;
  try {
    hud = new BrowserWindow({
      parent: window,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      // Clicks never take focus from the main window, which keeps the
      // keyboard shortcuts working while the HUD handles the mouse.
      focusable: false,
      webPreferences: {
        preload: join(root, "electron", "preload.cjs"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });
  } catch {
    hud = null;
    player?.setOverlay(false);
    return null;
  }
  hud.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  hud.webContents.on("will-navigate", onDropNavigate);
  hud.webContents.on("did-finish-load", () => {
    hudReady = true;
    player?.setOverlay(true);
    placeHud();
  });
  hud.webContents.on("render-process-gone", () => closeHud());
  hud.on("closed", () => {
    hud = null;
    hudReady = false;
    hudIdle = false;
    cursorGate.release();
    player?.setOverlay(false);
  });
  hud
    .loadFile(fileURLToPath(new URL("../dist/index.html", import.meta.url)), {
      hash: "hud",
    })
    .catch(() => closeHud());
  return hud;
}
function closeHud() {
  hudIdle = false;
  cursorGate.release();
  if (hud && !hud.isDestroyed()) hud.destroy();
  hud = null;
  hudReady = false;
  player?.setOverlay(false);
}
/** Lays the HUD exactly over the video surface, or hides it. */
function placeHud() {
  if (!hud || hud.isDestroyed() || !hudReady || !window || window.isDestroyed())
    return;
  const rect = hudRect({
    content: window.getContentBounds(),
    surface: videoHost?.last,
    zoom: appliedZoom || 1,
  });
  const show =
    rect &&
    hudVisible({
      enabled: overlayEnabled(),
      player: player?.state,
      surfaceVisible: surfaceShown,
      minimized: window.isMinimized(),
    });
  if (!show) {
    if (hud.isVisible()) hud.hide();
    hudIdle = false;
    cursorGate.release();
    return;
  }
  hud.setBounds(rect);
  if (!hud.isVisible()) hud.showInactive();
}
let appliedZoom = 1;
/** The viewer's interface scale, never shrinking the layout below 980×680. */
function applyZoom() {
  if (!window || window.isDestroyed() || !client) return;
  const [width, height] = window.getContentSize();
  const zoom = effectiveZoom(
    resolveAppearance(client.state.settings).uiScale,
    width,
    height,
  );
  if (zoom === appliedZoom) return;
  appliedZoom = zoom;
  window.webContents.setZoomFactor(zoom);
}
const broadcast = () => {
  applyZoom();
  applyTitleOverlay();
  emit("state", client.publicState());
};
// The frame the window was created with; a changed setting waits for a start.
let runningFrame = "native";
/** The hybrid bar's native buttons follow the current theme. */
function applyTitleOverlay() {
  if (runningFrame !== "hybrid" || !window || window.isDestroyed()) return;
  const look = resolveAppearance(client.state.settings);
  try {
    window.setTitleBarOverlay({
      color: look.colors.panel,
      symbolColor: look.colors.text,
      height: 36,
    });
  } catch {
    /* Older systems draw their own colours. */
  }
}
function windowState() {
  return {
    frame: runningFrame,
    wanted: client?.state.settings.windowFrame || "native",
    maximized: !!window?.isMaximized(),
    fullscreen: !!window?.isFullScreen(),
  };
}
let dragTimer = null;
/**
 * "Drag the window from anywhere": the page reports a press on empty space
 * and its release; main follows the pointer in between. It stops on its own
 * after fifteen seconds or when the window loses focus.
 */
function windowDrag(a) {
  clearInterval(dragTimer);
  dragTimer = null;
  if (a?.phase !== "start") return true;
  if (
    !client.state.settings.dragAnywhere ||
    !window ||
    window.isMaximized() ||
    window.isFullScreen()
  )
    return false;
  const start = screen.getCursorScreenPoint();
  const [x, y] = window.getPosition();
  const began = Date.now();
  dragTimer = setInterval(() => {
    if (!window || window.isDestroyed() || Date.now() - began > 15000) {
      clearInterval(dragTimer);
      dragTimer = null;
      return;
    }
    const point = screen.getCursorScreenPoint();
    window.setPosition(x + point.x - start.x, y + point.y - start.y);
  }, 12);
  return true;
}
function save(data) {
  if (!safeStorage.isEncryptionAvailable())
    throw new Error("تشفير ويندوز غير متاح، تعذّر حفظ البيانات بأمان.");
  const file = join(app.getPath("userData"), "profile.bin");
  writeFileSync(file + ".tmp", safeStorage.encryptString(JSON.stringify(data)));
  renameSync(file + ".tmp", file);
}
function load() {
  const file = join(app.getPath("userData"), "profile.bin");
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(safeStorage.decryptString(readFileSync(file)));
  } catch {
    throw new Error(
      "تعذّر قراءة ملف البيانات المشفر. احتفظ بالملف الأصلي واستخدم حساب ويندوز الذي أنشأه.",
    );
  }
}
function cancelLogin() {
  clearTimeout(loginTimer);
  loginServer?.close();
  loginServer?.closeAllConnections();
  loginServer = null;
}
async function beginLogin() {
  cancelLogin();
  const nonce = randomBytes(24).toString("hex");
  loginServer = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method !== "GET" || url.pathname !== `/callback/${nonce}`) {
      res.writeHead(404);
      res.end();
      return;
    }
    const authKey =
      url.searchParams.get("authKey") || url.searchParams.get("key");
    if (!authKey) {
      res.writeHead(400);
      res.end("Missing sign-in key.");
      return;
    }
    try {
      await client.authenticate(authKey);
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'",
      });
      res.end(
        '<html dir="rtl"><meta charset="UTF-8"><title>Riwaq</title><body style="background:#111316;color:#f5ead9;font:22px Segoe UI;text-align:center;padding:100px">تم تسجيل الدخول. ارجع إلى رِواق.</body></html>',
      );
      cancelLogin();
      broadcast();
      window?.show();
      window?.focus();
      try {
        const result = await client.sync();
        broadcast();
        emit(
          "notice",
          `تم استيراد ${result.imported} إضافة${result.libraryWarning ? "؛ تعذّر استيراد المكتبة" : ""}${result.skipped.length ? "؛ بعض الإضافات القديمة غير مدعومة" : ""}`,
        );
      } catch (error) {
        emit("notice", error.message);
      }
    } catch (error) {
      res.writeHead(400);
      res.end("Sign-in could not be completed. Return to Riwaq and retry.");
      emit("notice", error.message);
    }
  });
  await new Promise((resolve, reject) => {
    loginServer.once("error", reject);
    loginServer.listen(0, "127.0.0.1", resolve);
  });
  const port = loginServer.address().port;
  loginTimer = setTimeout(() => {
    cancelLogin();
    emit("notice", "انتهت مهلة تسجيل الدخول. يمكنك المحاولة مجدداً.");
  }, 300000);
  await shell.openExternal(
    "https://www.stremio.com/login?" +
      new URLSearchParams({
        appName: "Riwaq",
        appCallback: `http://127.0.0.1:${port}/callback/${nonce}`,
      }),
  );
  return true;
}
/**
 * Linking Spotify (core/spotify.mjs): the viewer's own Client ID, PKCE, and
 * a one-shot loopback server on the fixed port the viewer registered as the
 * redirect URI. The browser does the sign-in; Riwaq sees only the code.
 */
let spotifyServer = null;
let spotifyTimer = null;
function cancelSpotifyLink() {
  clearTimeout(spotifyTimer);
  spotifyServer?.close();
  spotifyServer?.closeAllConnections();
  spotifyServer = null;
}
async function beginSpotifyLink(clientId) {
  cancelSpotifyLink();
  const id = client.spotify.setClientId(clientId);
  const { verifier, challenge } = spotifyPkce();
  const nonce = randomBytes(24).toString("hex");
  const page = (res, status, message) => {
    res.writeHead(status, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'",
    });
    res.end(
      `<html dir="rtl"><meta charset="UTF-8"><title>Riwaq</title><body style="background:#111316;color:#f5ead9;font:22px Segoe UI;text-align:center;padding:100px">${message}</body></html>`,
    );
  };
  spotifyServer = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method !== "GET" || url.pathname !== "/callback") {
      res.writeHead(404);
      res.end();
      return;
    }
    // The state ties the answer to this attempt; anything else is refused.
    if (url.searchParams.get("state") !== nonce) {
      page(res, 400, "طلب غير متوقع. ارجع إلى رِواق وجرّب الربط مجدداً.");
      return;
    }
    const code = url.searchParams.get("code");
    if (!code || code.length > 2048) {
      page(res, 400, "ما تم الربط. ارجع إلى رِواق وجرّب مجدداً.");
      cancelSpotifyLink();
      emit("notice", "ألغيت ربط Spotify أو رفضه الحساب");
      return;
    }
    try {
      await client.spotify.exchange(code, verifier);
      page(res, 200, "تم ربط Spotify. ارجع إلى رِواق.");
      emit("notice", "تم ربط Spotify");
      broadcast();
      window?.show();
      window?.focus();
    } catch (error) {
      logError("spotify", error);
      page(res, 400, "ما اكتمل الربط. ارجع إلى رِواق وجرّب مجدداً.");
      emit("notice", error.message);
    } finally {
      cancelSpotifyLink();
    }
  });
  await new Promise((resolve, reject) => {
    spotifyServer.once("error", () =>
      reject(
        new Error(
          `المنفذ ${SPOTIFY_PORT} مستخدم من برنامج ثاني. أغلقه ثم جرّب الربط.`,
        ),
      ),
    );
    spotifyServer.listen(SPOTIFY_PORT, "127.0.0.1", resolve);
  }).catch((error) => {
    cancelSpotifyLink();
    throw error;
  });
  spotifyTimer = setTimeout(() => {
    cancelSpotifyLink();
    emit("notice", "انتهت مهلة ربط Spotify. يمكنك المحاولة مجدداً.");
  }, 300000);
  await shell.openExternal(
    spotifyAuthorizeUrl({ clientId: id, challenge, state: nonce }),
  );
  return true;
}
function hotkeyFile() {
  const path = join(app.getPath("userData"), "input.conf");
  writeFileSync(path, inputConf(client.state.hotkeys), "utf8");
  return path;
}
function screenshotDir() {
  const path = join(app.getPath("userData"), "screenshots");
  mkdirSync(path, { recursive: true });
  return path;
}
/**
 * Rich Presence mirrors whatever the player is doing. It is rebuilt on every
 * player state change, which is cheap, and skipped entirely when the viewer
 * has not opted in.
 */
function updatePresence() {
  const settings = client?.state.settings || {};
  if (!presence?.ready) return;
  if (!settings.discordPresence || settings.presenceDetail === "off") {
    presence.set(null);
    return;
  }
  const state = player?.state || {};
  presence.set(
    buildActivity({
      playing: !!state.active,
      paused: !!state.pause,
      live: !!state.live,
      title: state.name || "",
      episode:
        state.mediaType === "series"
          ? String(state.videoId || "")
              .split(":")
              .slice(1)
              .join("×")
          : "",
      position: Number(state.position) || 0,
      duration: Number(state.duration) || 0,
      detail: settings.presenceDetail || "title",
    }),
  );
}
async function applyPresence() {
  const settings = client.state.settings;
  if (!presence) presence = new DiscordPresence();
  if (!settings.discordPresence || settings.presenceDetail === "off") {
    presence.disable();
    return false;
  }
  await presence.enable(client.state.discordAppId || "");
  updatePresence();
  return true;
}
/** The last viewing's MPV log; the diagnostic reads its problem lines. */
function mpvLogFile() {
  const dir = join(app.getPath("userData"), "logs");
  mkdirSync(dir, { recursive: true });
  return join(dir, "mpv-last.log");
}
/** A video file on this PC, chosen in a dialog or dropped on the window. */
function playLocalFile(path) {
  nowPlaying = null;
  return player.start({
    executable: executable(),
    logFile: mpvLogFile(),
    settings: client.state.settings,
    url: path,
    local: true,
    meta: { id: path, type: "local", name: basename(path) },
    videoId: path,
  });
}
/**
 * Every navigation away from the app page is refused. A file dropped on the
 * window arrives as one: a video plays and a subtitle joins the viewing.
 * The path comes from Chromium's navigation, never from the page's scripts.
 */
function onDropNavigate(event, legacyUrl) {
  event.preventDefault();
  const url = event.url || legacyUrl;
  const kind = dropKind(url);
  if (!kind) return;
  let path;
  try {
    path = fileURLToPath(url);
    if (!statSync(path).isFile()) return;
  } catch {
    return;
  }
  if (kind === "subtitle") {
    if (!player?.state.active) {
      emit("notice", "شغّل عملاً أولاً، ثم اسحب ملف الترجمة إلى الصورة.");
      return;
    }
    player.subtitle(path);
    emit("notice", `أُضيفت الترجمة «${basename(path)}»`);
    return;
  }
  playLocalFile(path).catch((error) => emit("notice", cleanError(error)));
}
let thumbnails = null;
/** Seek previews for the current viewing; main keeps the source address. */
async function trickplay(a) {
  if (!player?.state.active || !player.source) return null;
  thumbnails ||= new Thumbnailer({
    tmpDir: join(app.getPath("temp"), "riwaq-thumbs"),
  });
  if (thumbnails.source !== player.source) thumbnails.reset(player.source);
  return thumbnails.frame({
    at: Number(a?.at) || 0,
    duration: Number(player.state.duration) || 0,
    executable: executable(),
    mode: client.state.settings.seekThumbnails || "local",
    serverUrl: client.state.settings.serverUrl,
  });
}
function executable() {
  return (
    client.state.settings.mpvPath ||
    join(
      app.isPackaged ? process.resourcesPath : join(root, "vendor"),
      "mpv",
      "mpv.exe",
    )
  );
}
/** MPV lists the audio outputs it can open; asked once per run. */
let audioDeviceList = null;
function listAudioDevices() {
  audioDeviceList ||= new Promise((resolve) => {
    execFile(
      executable(),
      ["--no-config", "--terminal=yes", "--audio-device=help"],
      { timeout: 8000, windowsHide: true, maxBuffer: 256 * 1024 },
      (_error, stdout) => resolve(parseAudioDevices(stdout)),
    );
  }).then((list) => {
    if (!list.length) audioDeviceList = null;
    return list;
  });
  return audioDeviceList;
}
async function diagnostics() {
  let server = false;
  try {
    const response = await fetch(
      client.state.settings.serverUrl + "/settings",
      { signal: AbortSignal.timeout(2000) },
    );
    server = response.ok;
  } catch {}
  return {
    mpv: existsSync(executable()),
    server,
    encryption: safeStorage.isEncryptionAvailable(),
    version: app.getVersion(),
    video: videoHost?.inspect(),
  };
}
async function play({ key, meta, videoId, resume = true, profileId }) {
  const owner = profileId || client.profiles.store.active;
  const checkOwner = () => {
    if (owner !== client.profiles.store.active)
      throw new Error("تغير الملف الشخصي؛ اختر المصدر مجدداً");
  };
  checkOwner();
  const stream = client.streams.get(key);
  if (!stream) throw new Error("أعد تحميل المصادر أولاً");
  if (!meta?.id || !meta?.type || !meta?.name || typeof videoId !== "string")
    throw new Error("العنوان غير صالح");
  if (stream.externalUrl || stream.ytId) {
    const url =
      stream.externalUrl ||
      `https://www.youtube.com/watch?v=${encodeURIComponent(stream.ytId)}`;
    webUrl(url);
    await shell.openExternal(url);
    return { external: true };
  }
  let url = stream.url;
  if (!url && stream.infoHash) {
    if (!(await diagnostics()).server)
      throw new Error(
        "هذا المصدر يحتاج Stremio Service. شغّل ستريميو الرسمي أو اضبط عنوان الخدمة في الإعدادات.",
      );
    url = torrentUrl(stream, client.state.settings.serverUrl);
  }
  if (!url) throw new Error("نوع المصدر غير مدعوم في هذه النسخة");
  checkOwner();
  await player.stop();
  checkOwner();
  const progress = client.state.progress[`${meta.type}:${videoId}`];
  const start =
    resume &&
    progress &&
    !progress.completed &&
    (!progress.duration || progress.position / progress.duration < 0.95)
      ? progress.position
      : 0;
  // A new object per viewing: late replies compare it by identity.
  const series = seriesOf(meta);
  nowPlaying = { key, type: meta.type, id: videoId, series };
  if (series && stream.memory)
    client.rememberSeries(series, { source: stream.memory });
  return player.start({
    executable: executable(),
    settings: client.state.settings,
    url,
    meta,
    videoId,
    start,
    headers: stream.behaviorHints?.proxyHeaders?.request || {},
    inputConf: hotkeyFile(),
    screenshotDir: screenshotDir(),
    logFile: mpvLogFile(),
  });
}
async function playChannel({ key, start = 0, stop = 0 }) {
  client.profiles.gate("live");
  nowPlaying = null;
  const channel = client.live.resolve(key, { start, stop });
  await player.stop();
  return player.start({
    executable: executable(),
    settings: client.state.settings,
    url: channel.url,
    meta: {
      id: `live:${key}`,
      type: "live",
      name: channel.name,
      poster: channel.logo,
    },
    videoId: `live:${key}`,
    headers: channel.headers,
    live: channel.live,
    inputConf: hotkeyFile(),
    screenshotDir: screenshotDir(),
    logFile: mpvLogFile(),
  });
}
/**
 * After a file loads: the series' remembered audio and subtitle choices
 * first (core/series-memory.mjs), then, when the file carries no subtitle in
 * the viewer's first language, the best one an addon offers. Track lists
 * arrive just after the file loads. The viewing is captured by identity and
 * checked after every wait, so a reply for an earlier source of the same
 * episode is never applied to the one now playing.
 */
function autoSubtitle(videoId) {
  const settings = client.state.settings;
  const viewing = nowPlaying;
  if (viewing?.id !== videoId) return;
  const current = () =>
    nowPlaying === viewing &&
    player.videoId === videoId &&
    !!player.state.active;
  setTimeout(async () => {
    try {
      if (!current()) return;
      const memory = client.seriesChoice(viewing.series);
      const tracks = player.state.tracks || [];
      const restored = [];
      // Track IDs repeat across types, so "already selected" checks both.
      const selected = (type, id) =>
        tracks.some((t) => t.type === type && t.id === id && t.selected);
      const audio = matchTrack(tracks, "audio", memory?.audio);
      if (audio !== null && !selected("audio", audio)) {
        player.command({ action: "aid", value: audio });
        restored.push("الصوت");
      }
      const sub = matchTrack(tracks, "sub", memory?.subtitle);
      const subOn = tracks.some((t) => t.type === "sub" && t.selected);
      if (sub === "no" ? subOn : sub !== null && !selected("sub", sub)) {
        player.command({ action: "sid", value: sub });
        restored.push(sub === "no" ? "إيقاف الترجمة" : "الترجمة");
      }
      if (restored.length)
        emit(
          "notice",
          `رجّعنا اختيارك السابق في هذا المسلسل: ${restored.join(" و")}.`,
        );
      // A subtitle restored from the file, or turned off on purpose, stands.
      if (sub !== null) return;
      // An addon subtitle chosen last episode asks the addons again in that
      // language, even with automatic subtitles off.
      const wanted =
        memory?.subtitle?.external && memory.subtitle.lang
          ? [memory.subtitle.lang]
          : [];
      if (settings.autoSubtitles === "off" && !wanted.length) return;
      const list = await client.getSubtitles({
        type: viewing.type,
        id: viewing.id,
        streamKey: viewing.key,
      });
      if (!current()) return;
      const languages = [
        ...wanted,
        ...preferredLanguages(settings.subtitleLanguage).filter(
          (code) => !wanted.includes(code),
        ),
      ];
      const pick = automaticSubtitle({
        tracks: player.state.tracks || [],
        addons: list,
        languages,
        kind: memory?.subtitle?.forced
          ? "forced"
          : memory?.subtitle?.hi
            ? "sdh"
            : settings.subtitleKind,
      });
      if (!pick || !current()) return;
      player.addSubtitle(client.subtitles.get(pick.key), {
        key: pick.key,
        ...client.subtitleInfo.get(pick.key),
      });
      emit(
        "notice",
        `اخترنا ترجمة ${pick.provider ? `من ${pick.provider}` : "من إضافاتك"}. غيّرها من لوحة الترجمة (C أو الزر الأيمن).`,
      );
    } catch {
      /* Subtitles are a convenience; playback carries on without them. */
    }
  }, 1500);
}
/**
 * The viewer picked an audio or subtitle track in a series: remember it by
 * language, title and flags for the next episode. Only the viewer's own
 * choices arrive here; tracks Riwaq selects itself are never recorded.
 */
function rememberTrack(kind, value, info) {
  const series = nowPlaying?.series;
  if (!series || !player.state.active) return;
  const track =
    info ||
    (value === "no"
      ? "no"
      : (player.state.tracks || []).find(
          (t) =>
            t.type === (kind === "audio" ? "audio" : "sub") && t.id === value,
        ));
  const identity = trackIdentity(track);
  if (!identity || (kind === "audio" && identity.off)) return;
  client.rememberSeries(series, { [kind]: identity });
}
const methods = {
  musicLocalLibrary: (a) => musicLibrary.view(a?.profileId),
  musicLocalImport: async (a) => {
    musicLibrary.gate(a?.profileId);
    const picked = await dialog.showOpenDialog(window, {
      title: "أضف أغاني إلى رِواق",
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "الصوت",
          extensions: Object.keys(AUDIO_TYPES).map((x) => x.slice(1)),
        },
      ],
    });
    return musicLibrary.importFiles(
      a.profileId,
      picked.canceled ? [] : picked.filePaths,
    );
  },
  musicLocalEdit: (a) => musicLibrary.edit(a || {}),
  musicLocalSource: async (a) => {
    if (player.state.active)
      throw new Error("أوقف المشاهدة قبل تشغيل الموسيقى");
    return musicLibrary.source(a || {});
  },
  init: () => client.init(),
  windowInfo: () => windowState(),
  windowControl: (a) => {
    if (!window) return windowState();
    if (a?.action === "minimize") window.minimize();
    else if (a?.action === "maximize")
      window.isMaximized() ? window.unmaximize() : window.maximize();
    else if (a?.action === "close") window.close();
    return windowState();
  },
  windowDrag,
  // A frame change needs a new window; the usual shutdown path saves first.
  relaunch: () => {
    app.relaunch();
    app.quit();
    return true;
  },
  // The taskbar icon: Riwaq's own, or the mark drawn in the accent colour by
  // the interface. Only a small PNG is accepted; nothing else reaches Windows.
  setAppIcon: (a) => {
    if (!window) return false;
    const url = typeof a?.dataUrl === "string" ? a.dataUrl : "";
    if (!url) {
      window.setIcon(join(root, "assets", "icon.png"));
      return true;
    }
    if (!url.startsWith("data:image/png;base64,") || url.length > 400000)
      throw new Error("أيقونة غير صالحة");
    const image = nativeImage.createFromDataURL(url);
    const size = image.getSize();
    if (image.isEmpty() || size.width > 512 || size.height > 512)
      throw new Error("أيقونة غير صالحة");
    window.setIcon(image);
    return true;
  },
  catalog: (a) => client.catalog(a),
  catalogPlan: (a) => client.catalogPlan(a),
  // A badge pack is copied only as Riwaq's own pack JSON.
  // A badge pack from a link (harbor.site, GitHub, a gist...): HTTPS only,
  // never a machine on the viewer's network, and only its text comes back.
  badgePackFetch: (a) => fetchPackText(String(a?.url || "")),
  copyBadgePack: (a) => {
    const json = String(a?.json || "");
    let data;
    try {
      data = JSON.parse(json);
    } catch {
      throw new Error("حزمة غير صالحة");
    }
    if (data?.format !== "riwaq-badges" || json.length > 400000)
      throw new Error("حزمة غير صالحة");
    clipboard.writeText(json);
    return true;
  },
  // Only a design code may be copied; nothing else reaches the clipboard.
  copyThemeCode: (a) => {
    const code = String(a?.code || "");
    if (!code.startsWith("RIWAQ-THEME-1:") || code.length > 6000)
      throw new Error("رمز التصميم غير صالح");
    clipboard.writeText(code);
    return true;
  },
  metadata: (a) => client.metadata(a),
  // Credits and the people, companies and places behind a title.
  titleCredits: (a) =>
    client.credits.title({
      type: a?.type === "series" ? "series" : "movie",
      id: typeof a?.id === "string" ? a.id : "",
    }),
  searchPeople: (a) =>
    client.credits.searchPeople({
      query: typeof a?.query === "string" ? a.query : "",
    }),
  // A title's theme song: a preview chosen in main from its own copy of the
  // title (core/theme-song.mjs); only the song's names, picture and preview
  // address (Apple's or Deezer's preview hosts) reach the page.
  themeSong: (a) =>
    client.themeSong({
      type: a?.type === "series" ? "series" : "movie",
      id: typeof a?.id === "string" ? a.id.slice(0, 200) : "",
    }),
  // Spotify Connect (core/spotify.mjs): main-window only.
  spotifyConnect: (a) => beginSpotifyLink(a?.clientId),
  spotifyDisconnect: () => {
    cancelSpotifyLink();
    client.spotify.disconnect();
    return client.publicState();
  },
  spotifyState: async () => {
    const pub = client.spotify.publicState();
    if (!pub.connected) return { ...pub, playback: null, devices: [] };
    const [playback, devices] = await Promise.all([
      client.spotify.playback().catch((e) => ({ error: e.message })),
      client.spotify.devices().catch(() => []),
    ]);
    const failed = playback && "error" in playback;
    return {
      ...client.spotify.publicState(),
      playback: failed ? null : playback,
      error: failed ? playback.error : "",
      devices,
    };
  },
  spotifyPlaylists: () => client.spotify.playlists(),
  spotifyControl: async (a) => {
    if (["play", "transfer"].includes(a?.action)) stopLocalMusic();
    await client.spotify.control({
      action: a?.action,
      uri: a?.uri,
      deviceId: a?.deviceId,
      volume: a?.volume,
      state: a?.state === true,
    });
    // Spotify applies a command a moment later; read the state after it.
    await new Promise((resolve) => setTimeout(resolve, 400));
    return client.spotify.playback().catch(() => null);
  },
  // Only this fixed address: it starts the Spotify app when installed.
  spotifyOpenApp: async () => {
    await shell.openExternal("spotify:");
    return true;
  },
  // Music (core/music.mjs): a saved link or a platform's search page, each
  // re-checked here to be HTTPS on that platform's own hosts before the
  // system opens it. These links are separate from local audio playback.
  musicOpen: async (a) => {
    const url = a?.url
      ? musicLink(a.url)
      : musicSearchUrl(a?.platform, a?.query);
    if (!url) throw new Error("رابط الموسيقى غير صالح");
    await shell.openExternal(url);
    return true;
  },
  // The trailer ID comes from main's own copy of the metadata, never the
  // interface, and only a YouTube watch page on the fixed host is opened.
  openTrailer: async (a) => {
    const meta = client.metas.get(`${a?.type}:${a?.id}`);
    const id = trailerOf(meta);
    if (!id) throw new Error("لا يتوفر إعلان لهذا العمل");
    await shell.openExternal(`https://www.youtube.com/watch?v=${id}`);
    return true;
  },
  creditsEntity: (a) =>
    client.credits.entity({
      qid: typeof a?.qid === "string" ? a.qid : "",
      tmdb: typeof a?.tmdb === "string" ? a.tmdb : "",
    }),
  streams: async (a) => {
    const result = await client.getStreams({
      type: a?.type,
      id: a?.id,
      seriesId: a?.seriesId,
      again: a?.again === true,
    });
    remember(a, result);
    return result;
  },
  // The sources for what is playing, ranked as in Details, to switch inside
  // the player without losing the position.
  playerSources: async () => {
    if (!nowPlaying || !player.state.active) return { streams: [] };
    // The run that started this viewing, late answers included, when recent.
    const result = await client.getStreams({
      type: nowPlaying.type,
      id: nowPlaying.id,
      seriesId: nowPlaying.series,
      again: true,
    });
    remember(nowPlaying, result);
    return { ...result, current: nowPlaying.key };
  },
  switchSource: async (a) => {
    if (!nowPlaying || !player.state.active || !player.meta)
      throw new Error("لا توجد مشاهدة حالية");
    return play({
      key: a?.key,
      meta: player.meta,
      videoId: nowPlaying.id,
      resume: true,
    });
  },
  subtitles: () => {
    if (!player.state.active || !nowPlaying || nowPlaying.id !== player.videoId)
      return [];
    return client.getSubtitles({
      type: nowPlaying.type,
      id: nowPlaying.id,
      streamKey: nowPlaying.key,
    });
  },
  subtitleCues: async (a) => {
    const url = client.subtitles.get(a?.key);
    if (!url || !player.state.active) return { cues: [] };
    let cues = cueCache.get(url);
    if (!cues) {
      const text = await fetchText(url, { timeout: 15000 });
      if (text.length > 5_000_000) throw new Error("ملف الترجمة كبير جداً");
      cues = parseCues(text);
      if (cueCache.size >= 6) cueCache.delete(cueCache.keys().next().value);
      cueCache.set(url, cues);
    }
    const position = player.state.position || 0;
    const delay = player.state.subtitleDelay || 0;
    return {
      position,
      delay,
      total: cues.length,
      cues: cuesAround(cues, position, delay, { before: 7, after: 7 }),
    };
  },
  install: (a) => client.install(a.url),
  updateAddon: (a) => client.updateAddon(a),
  // Which addons still answer (core/addon-health.mjs): by key and name only,
  // their addresses stay here.
  addonsHealth: async () => {
    client.profiles.gate("addons");
    return probeAddons(client.state.addons, { version: app.getVersion() });
  },
  removeAddons: (a) => client.removeAddons({ keys: a?.keys }),
  settings: async (a) => {
    const state = client.settings(a);
    // Sound and picture changes reach a running viewing where MPV allows it.
    player?.applyTuning(client.state.settings);
    applyZoom();
    if (overlayEnabled()) ensureHud();
    else closeHud();
    // Presence and the key map are derived from settings, so they follow.
    await applyPresence().catch(() => {});
    return state;
  },
  providerSave: (a) => client.dataHub.save(a),
  // Services, home servers and the streaming server. Keys and tokens stay in
  // main; changing them is behind the Settings room lock.
  debridSave: (a) => {
    client.profiles.gate("settings");
    return client.services.debridSave({
      id: String(a?.id || ""),
      key: typeof a?.key === "string" ? a.key : undefined,
      clear: a?.clear === true,
    });
  },
  debridCheck: (a) => client.services.debridCheck({ id: String(a?.id || "") }),
  watchProviders: () => client.services.watchProviders(),
  serviceRows: () => client.services.serviceRows(),
  homeServerAdd: (a) => {
    client.profiles.gate("settings");
    return client.services.homeServerAdd({
      url: String(a?.url || ""),
      username: String(a?.username || ""),
      password: String(a?.password || ""),
    });
  },
  homeServerRemove: (a) => {
    client.profiles.gate("settings");
    return client.services.homeServerRemove({ id: String(a?.id || "") });
  },
  homeServerToggle: (a) => {
    client.profiles.gate("settings");
    return client.services.homeServerToggle({
      id: String(a?.id || ""),
      enabled: a?.enabled === true,
    });
  },
  homeServerCheck: (a) =>
    client.services.homeServerCheck({ id: String(a?.id || "") }),
  streamServerInfo: () => client.services.streamServerInfo(),
  // AI search: the key is saved behind the Settings lock and never returned.
  aiSave: (a) => {
    client.profiles.gate("settings");
    return client.ai.save({
      provider: String(a?.provider || ""),
      key: typeof a?.key === "string" ? a.key : undefined,
      model: typeof a?.model === "string" ? a.model : "",
      clear: a?.clear === true,
    });
  },
  aiTest: () => client.ai.test(),
  // A film's release date in the viewer's region, for its countdown.
  releaseDates: (a) => client.releaseDates({ id: String(a?.id || "") }),
  titleLogos: (a) =>
    client.titleLogos({
      type: String(a?.type || ""),
      id: String(a?.id || "").slice(0, 120),
    }),
  // TMDB's stills and descriptions for one season, with the viewer's key.
  seasonDetails: (a) =>
    client.seasonDetails({
      id: String(a?.id || ""),
      season: Number(a?.season),
    }),
  // A title's artwork gallery; keys stay here and only image URLs return.
  artwork: (a) =>
    client.artwork({ type: String(a?.type || ""), id: String(a?.id || "") }),
  // Opens one gallery image in the browser, only from the artwork hosts.
  openArtwork: async (a) => {
    const url = String(a?.url || "");
    if (!artworkHost(url)) throw new Error("رابط الصورة غير مسموح");
    await shell.openExternal(url);
    return true;
  },
  aiSearch: (a) => client.ai.search({ query: String(a?.query || "") }),
  streamServerSave: (a) => {
    client.profiles.gate("settings");
    return client.services.streamServerSave({
      profile: typeof a?.profile === "string" ? a.profile : undefined,
      cacheSize:
        a && "cacheSize" in a
          ? a.cacheSize === null
            ? null
            : Number(a.cacheSize)
          : undefined,
    });
  },
  providerTest: (a) => client.dataHub.test(a.id),
  integrationSave: (a) => client.integrations.save(a),
  integrationSync: (a) => client.integrations.sync(a.id),
  integrationDisconnect: (a) => client.integrations.disconnect(a.id),
  traktLogin: (a) => client.integrations.begin(a?.id || "trakt"),
  traktPoll: (a) => client.integrations.poll(a?.id || "trakt"),
  traktSuggestions: (a) =>
    client.integrations.recommendations(
      a?.kind === "shows" ? "shows" : "movies",
      { force: a?.force === true },
    ),
  traktHideSuggestion: (a) =>
    client.integrations.hideRecommendation(
      a?.kind === "shows" ? "shows" : "movies",
      String(a?.id || ""),
    ),
  letterboxdImport: async () => {
    const r = await dialog.showOpenDialog(window, {
      title: "اختيار تصدير Letterboxd",
      filters: [{ name: "Letterboxd CSV", extensions: ["csv"] }],
      properties: ["openFile"],
    });
    if (r.canceled) return null;
    return client.integrations.importLetterboxd(
      readFileSync(r.filePaths[0], "utf8"),
    );
  },
  openService: async ({ id }) => {
    const urls = {
      tmdb: "https://www.themoviedb.org/settings/api",
      omdb: "https://www.omdbapi.com/apikey.aspx",
      mdblist: "https://mdblist.com/preferences/",
      fanart: "https://fanart.tv/get-an-api-key/",
      theintrodb: "https://theintrodb.org",
      trakt: "https://trakt.tv/oauth/applications",
      traktActivate: "https://trakt.tv/activate",
      simkl: "https://simkl.com/settings/developer/",
      simklActivate: "https://simkl.com/pin/",
      letterboxd: "https://letterboxd.com/settings/data/",
      stremboxd: "https://stremboxd.com",
      discord: "https://support.discord.com/hc/articles/228383668",
      telegram: "https://core.telegram.org/bots#how-do-i-create-a-bot",
      discordApp: "https://discord.com/developers/applications",
      ...Object.fromEntries(DEBRID.map((d) => [d.id, d.url])),
      ...Object.fromEntries(AI_PROVIDERS.map((p) => [p.id, p.keys])),
    };
    if (!urls[id]) throw new Error("رابط الخدمة غير معروف");
    await shell.openExternal(urls[id]);
    return true;
  },
  favorite: (a) => client.favorite(a),
  tasteEdit: (a) => client.tasteEdit(a),
  queueEdit: (a) => client.queueEdit(a),
  historyEdit: (a) => {
    const touched = Array.isArray(a?.videoIds) ? a.videoIds : [a?.videoId];
    if (
      player.state.active &&
      player.meta?.type === a?.meta?.type &&
      touched.includes(player.videoId)
    )
      throw new Error("أوقف تشغيل هذا العنوان قبل تعديل سجله");
    return client.historyEdit(a);
  },
  episodes: (a) => client.episodes(a || {}),
  profileCreate: (a) => client.profiles.create(a),
  profileUpdate: (a) => client.profiles.update(a),
  profileRemove: async (a) => {
    client.profiles.check({ ...a, intent: "remove" });
    if (client.profiles.store.active === a.id) {
      stopLocalMusic();
      await player.stop();
    }
    if (client.state.localMusic) delete client.state.localMusic[a.id];
    return client.profiles.remove(a);
  },
  profileSwitch: async (a) => {
    // A wrong PIN must be refused before playback is touched. Then save the
    // outgoing viewer's last position before replacing their bucket.
    client.profiles.check({ ...a, intent: "switch" });
    stopLocalMusic();
    await player.stop();
    const result = client.profiles.switch(a);
    applyZoom();
    await applyPresence().catch(() => {});
    return result;
  },
  profilePin: (a) => client.profiles.setPin(a),
  profileUnlock: (a) => client.profiles.unlock(a?.pin),
  profileLock: () => {
    stopLocalMusic();
    return client.profiles.lock();
  },
  setHotkey: (a) => client.setHotkey(a),
  resetHotkeys: () => client.resetHotkeys(),
  notifySave: (a) => client.notifier.save(a),
  notifyTest: (a) => client.notifier.test(a.id),
  presenceSave: async ({ appId }) => {
    if (appId !== undefined) {
      if (appId && !/^\d{17,20}$/.test(String(appId)))
        throw new Error("معرّف تطبيق Discord غير صالح");
      client.state.discordAppId = String(appId || "");
      client.persist();
    }
    await applyPresence().catch((error) => emit("notice", error.message));
    return client.publicState();
  },
  liveAdd: (a) => {
    client.profiles.gate("live");
    return client.live.addSource(a);
  },
  liveUpdate: (a) => {
    client.profiles.gate("live");
    return client.live.updateSource(a);
  },
  liveRefresh: async (a) => {
    client.profiles.gate("live");
    await client.live.refresh(a.id);
    return client.publicState();
  },
  liveChannels: (a) => {
    client.profiles.gate("live");
    return client.live.list(a || {});
  },
  liveGuide: (a) => {
    client.profiles.gate("live");
    return client.live.guide(a || {});
  },
  liveFavorite: (a) => {
    client.profiles.gate("live");
    return client.live.favorite(a.key);
  },
  playChannel,
  openScreenshots: async () => {
    await shell.openPath(screenshotDir());
    return true;
  },
  chooseShader: async () => {
    const result = await dialog.showOpenDialog(window, {
      title: "اختيار مرشّح GLSL",
      filters: [{ name: "GLSL shader", extensions: ["glsl", "hook"] }],
      properties: ["openFile"],
    });
    if (!result.canceled) {
      client.state.settings.shaderPath = result.filePaths[0];
      client.persist();
    }
    return client.publicState();
  },
  login: beginLogin,
  cancelLogin: () => {
    cancelLogin();
    return true;
  },
  logout: () => {
    cancelLogin();
    return client.logout();
  },
  sync: () => client.sync(),
  configure: async (a) => {
    await shell.openExternal(client.configureUrl(a.key));
    return true;
  },
  play,
  videoBounds: (a) => {
    surfaceShown = !!player.state.active && a?.visible !== false;
    const placed = player.state.active
      ? videoHost.bounds(a)
      : (videoHost.hide(), false);
    placeHud();
    return placed;
  },
  // The main window asks the HUD to open or close its panel (C key).
  hudPanel: () => {
    emit("hudCommand", { type: "panel" });
    return true;
  },
  // The HUD reports when its controls fall asleep or wake.
  hudIdle: (a) => {
    hudIdle = a?.idle === true;
    cursorCheck();
    return true;
  },
  // The HUD forwards a request the main interface owns.
  hudRequest: (a) => {
    if (!HUD_REQUESTS.has(a?.type)) throw new Error("الطلب غير مسموح");
    if (a.type === "episode") {
      if (typeof a.videoId !== "string" || !/^[\w:.-]{1,200}$/.test(a.videoId))
        throw new Error("الحلقة غير صالحة");
      emit("playerRequest", { type: "episode", videoId: a.videoId });
    } else emit("playerRequest", { type: a.type });
    return true;
  },
  forgetSeries: (a) =>
    client.forgetSeries(typeof a?.seriesId === "string" ? a.seriesId : ""),
  playerCommand: (a) => {
    const result = player.command(a);
    if (a?.action === "aid") rememberTrack("audio", a.value);
    else if (a?.action === "sid") rememberTrack("subtitle", a.value);
    return result;
  },
  trickplay,
  stop: async () => {
    // Stopping by hand also cancels "end after N episodes".
    player.setSleepEpisodes(0);
    await player.stop();
    return true;
  },
  // This PC's audio outputs as MPV names them, for the Audio page.
  audioDevices: () => listAudioDevices(),
  // A short download timed in main; only the speed comes back.
  speedTest: async () => {
    const mbps = await measureDownload();
    return { mbps, suggest: suggestCap(mbps) };
  },
  subtitle: (a) => {
    const url = client.subtitles.get(a?.key);
    if (!url) throw new Error("الترجمة غير متاحة");
    const info = client.subtitleInfo.get(a.key) || {};
    player.addSubtitle(url, {
      key: a.key,
      ...info,
      secondary: a.secondary === true,
    });
    if (a.secondary !== true)
      rememberTrack("subtitle", null, {
        lang: info.lang,
        title: info.label,
        external: true,
      });
    return true;
  },
  localSubtitle: async () => {
    const r = await dialog.showOpenDialog(window, {
      title: "اختيار ملف ترجمة",
      filters: [
        { name: "Subtitles", extensions: ["srt", "ass", "ssa", "vtt", "sub"] },
      ],
      properties: ["openFile"],
    });
    if (!r.canceled) player.subtitle(r.filePaths[0]);
    return !r.canceled;
  },
  localVideo: async () => {
    const r = await dialog.showOpenDialog(window, {
      title: "تشغيل ملف فيديو",
      filters: [
        {
          name: "Video",
          extensions: ["mp4", "mkv", "avi", "webm", "mov", "m4v", "ts"],
        },
      ],
      properties: ["openFile"],
    });
    if (r.canceled) return false;
    return playLocalFile(r.filePaths[0]);
  },
  choosePlayer: async () => {
    const r = await dialog.showOpenDialog(window, {
      title: "اختيار MPV",
      filters: [{ name: "MPV executable", extensions: ["exe"] }],
      properties: ["openFile"],
    });
    if (!r.canceled) {
      client.state.settings.mpvPath = r.filePaths[0];
      client.persist();
    }
    return client.publicState();
  },
  diagnostics,
  // The full diagnostic (Settings → النظام): a sanitized report the viewer
  // can copy or save and send; behind the Settings room lock.
  diagnoseRun: async (a) => {
    client.profiles.gate("settings");
    const report = await runDiagnostics({
      app,
      client,
      executable,
      safeStorage,
      screen,
      videoHost,
      player,
      errors: errorLog,
      rendererErrors: a?.rendererErrors,
    });
    const text = formatReport(report, { home: homedir() });
    lastDiagnosis = { report, text };
    return { report, text };
  },
  diagnoseCopy: () => {
    if (!lastDiagnosis) throw new Error("شغّل التشخيص أولاً");
    clipboard.writeText(lastDiagnosis.text);
    return true;
  },
  diagnoseSave: async () => {
    if (!lastDiagnosis) throw new Error("شغّل التشخيص أولاً");
    const stamp = lastDiagnosis.report.generatedAt
      .slice(0, 16)
      .replace(/[:T]/g, "-");
    const r = await dialog.showSaveDialog(window, {
      title: "حفظ تقرير التشخيص",
      defaultPath: `riwaq-diagnostics-${stamp}.txt`,
      filters: [{ name: "Text", extensions: ["txt"] }],
    });
    if (r.canceled || !r.filePath) return false;
    writeFileSync(r.filePath, lastDiagnosis.text, "utf8");
    return true;
  },
  updatesCheck: async () => {
    client.profiles.gate("settings");
    await client.updates.check({ current: app.getVersion(), force: true });
    return client.publicState();
  },
  updatesSetEnabled: (a) => client.updates.setEnabled(a?.enabled),
  updatesConfigure: (a) => client.updates.configure(a),
  updatesDownload: async () => {
    client.profiles.gate("settings");
    await client.updates.download();
    return client.publicState();
  },
  updatesCancel: () => {
    client.profiles.gate("settings");
    client.updates.cancel();
    return client.publicState();
  },
  updatesInstall: async () => {
    client.profiles.gate("settings");
    if (client.updates.runtime.status !== "ready") return false;
    await player.stop();
    await client.integrations.settle(3000);
    client.persist();
    const started = await client.updates.install();
    if (started) app.quit();
    return started;
  },
  openUpdate: async () => {
    // The page comes from the validated store, never from the renderer.
    await shell.openExternal(client.updates.releaseUrl());
    return true;
  },
  collectionsEdit: (a) => client.collectionsEdit(a || {}),
  collectionCatalogs: () => client.collectionCatalogs(),
  collectionFolder: (a) =>
    client.collectionFolder({
      collectionId: String(a?.collectionId || ""),
      folderId: String(a?.folderId || ""),
      skip: Number(a?.skip) || 0,
    }),
  collectionSource: (a) =>
    client.collectionSource({
      collectionId: String(a?.collectionId || ""),
      folderId: String(a?.folderId || ""),
      index: String(a?.index || ""),
      skip: Number(a?.skip) || 0,
      page: Number(a?.page) || 2,
    }),
  // Collections as Nuvio JSON: to the clipboard, or to a file the viewer names.
  collectionsCopyNuvio: () => {
    clipboard.writeText(
      JSON.stringify(toNuvio(client.state.collections || []), null, 2),
    );
    return true;
  },
  collectionsSaveNuvio: async () => {
    const r = await dialog.showSaveDialog(window, {
      title: "حفظ المجموعات بصيغة نوفيو",
      defaultPath: "riwaq-collections.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (r.canceled) return null;
    writeFileSync(
      r.filePath,
      JSON.stringify(toNuvio(client.state.collections || []), null, 2),
      "utf8",
    );
    return true;
  },
  importNuvioCollections: (a) =>
    client.importNuvioCollections({
      text: typeof a?.text === "string" ? a.text : "",
    }),
  /**
   * Looks for Nuvio Desktop's data on this PC. Only the known stores are
   * read; the folder comes from the environment, never from the interface.
   */
  nuvioScan: () => {
    client.profiles.gate("settings");
    if (process.platform !== "win32")
      throw new Error("البحث عن نوفيو متاح على ويندوز فقط");
    // Both Nuvio HTPC and the official Nuvio Desktop may be installed, and an
    // old copy of either may linger: read the one written to most recently.
    let best = null;
    for (const folder of nuvioFolders(process.env, app.getPath("home"))) {
      const stores = {};
      let newest = 0;
      for (const name of NUVIO_STORES) {
        const file = join(folder.path, `${name}.properties`);
        try {
          if (!existsSync(file)) continue;
          const info = statSync(file);
          if (info.size > 40 * 1024 * 1024) continue;
          stores[name] = parseProperties(readFileSync(file, "latin1"));
          newest = Math.max(newest, info.mtimeMs);
        } catch {
          /* An unreadable store is skipped. */
        }
      }
      if (Object.keys(stores).length && (!best || newest > best.newest))
        best = { stores, newest, label: folder.label };
    }
    if (best) return nuvioReply(best.stores, best.label);
    throw new Error(
      "لم نجد نوفيو على هذا الجهاز. افتح نوفيو وسجّل دخولك مرة ليحفظ بياناتك، أو استخدم ملف النسخة الاحتياطية.",
    );
  },
  nuvioPickBackup: async () => {
    client.profiles.gate("settings");
    const r = await dialog.showOpenDialog(window, {
      title: "اختيار نسخة إعدادات نوفيو",
      filters: [{ name: "Nuvio backup", extensions: ["zip"] }],
      properties: ["openFile"],
    });
    if (r.canceled) return null;
    if (statSync(r.filePaths[0]).size > 200 * 1024 * 1024)
      throw new Error("الملف كبير جداً");
    return nuvioReply(
      readNuvioZip(readFileSync(r.filePaths[0])),
      basename(r.filePaths[0]),
    );
  },
  nuvioImport: async (a) => {
    if (!pendingNuvio || pendingNuvio.token !== a?.token)
      throw new Error("اقرأ بيانات نوفيو من جديد");
    const parts = {};
    for (const key of [
      "addons",
      "collections",
      "library",
      "plugins",
      "tmdbKey",
    ])
      parts[key] = a?.parts?.[key] === true;
    const reply = await client.importNuvio(pendingNuvio.stores, {
      profile: a?.profile,
      parts,
    });
    pendingNuvio = null;
    broadcast();
    return reply;
  },
  // A shape-only report of Nuvio's collections for troubleshooting; the
  // viewer chooses to copy it, and it carries no addresses or keys.
  nuvioDiagnostics: (a) => {
    client.profiles.gate("settings");
    if (!pendingNuvio || pendingNuvio.token !== a?.token)
      throw new Error("اقرأ بيانات نوفيو من جديد");
    const index = Number(a?.profile);
    if (!Number.isInteger(index) || index < 1)
      throw new Error("اختر ملف نوفيو");
    clipboard.writeText(nuvioDiagnostics(pendingNuvio.stores, index));
    return true;
  },
  removeNuvioPlugin: (a) =>
    client.removeNuvioPlugin({ key: typeof a?.key === "string" ? a.key : "" }),
  backupExport: async ({ passphrase, includeSecrets = false } = {}) => {
    // Seal first: a bad passphrase should fail before a file dialog opens.
    const { text, left } = client.exportBackup({
      passphrase,
      includeSecrets: includeSecrets === true,
      app: app.getVersion(),
    });
    const stamp = new Date().toISOString().slice(0, 10);
    const r = await dialog.showSaveDialog(window, {
      title: includeSecrets
        ? "حفظ نسخة احتياطية — تتضمن مفاتيحك وحساباتك"
        : "حفظ نسخة احتياطية من رِواق",
      defaultPath: `riwaq-backup-${stamp}.riwaq`,
      filters: [{ name: "Riwaq backup", extensions: ["riwaq"] }],
    });
    if (r.canceled) return null;
    writeFileSync(r.filePath, text, "utf8");
    return { saved: true, left };
  },
  backupPick: async () => {
    const r = await dialog.showOpenDialog(window, {
      title: "اختيار نسخة احتياطية من رِواق",
      filters: [{ name: "Riwaq backup", extensions: ["riwaq"] }],
      properties: ["openFile"],
    });
    if (r.canceled) return null;
    if (statSync(r.filePaths[0]).size > 64 * 1024 * 1024)
      throw new Error("ملف النسخة الاحتياطية كبير جداً");
    const text = readFileSync(r.filePaths[0], "utf8");
    const { header } = readBackupHeader(text);
    pendingBackup = { token: randomBytes(16).toString("hex"), text };
    return {
      token: pendingBackup.token,
      name: basename(r.filePaths[0]),
      createdAt: header.createdAt,
      app: header.app,
      includesSecrets: header.includesSecrets,
    };
  },
  backupPreview: ({ token, passphrase }) => {
    if (!pendingBackup || pendingBackup.token !== token)
      throw new Error("اختر ملف النسخة الاحتياطية من جديد");
    return client.inspectBackup({ text: pendingBackup.text, passphrase });
  },
  backupRestore: async ({ token, passphrase }) => {
    if (!pendingBackup || pendingBackup.token !== token)
      throw new Error("اختر ملف النسخة الاحتياطية من جديد");
    // Check the passphrase before touching playback or the profile file.
    client.inspectBackup({ text: pendingBackup.text, passphrase });
    stopLocalMusic();
    await player.stop();
    // Keep this machine's current profile beside the new one. It stays sealed
    // with DPAPI, so it is an undo on this PC and useless anywhere else.
    const file = join(app.getPath("userData"), "profile.bin");
    if (existsSync(file))
      copyFileSync(
        file,
        join(app.getPath("userData"), "profile.before-restore.bin"),
      );
    const state = client.restoreBackup({
      text: pendingBackup.text,
      passphrase,
    });
    pendingBackup = null;
    await applyPresence().catch(() => {});
    return state;
  },
  backupCancel: () => {
    pendingBackup = null;
    return true;
  },
  exportAddons: async () => {
    const r = await dialog.showSaveDialog(window, {
      title: "حفظ روابط الإضافات — قد تتضمن مفاتيح خاصة",
      defaultPath: "riwaq-addons.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (r.canceled) return false;
    writeFileSync(
      r.filePath,
      JSON.stringify(
        {
          format: "riwaq-addons-v1",
          addons: client.state.addons.map((a) => a.transportUrl),
        },
        null,
        2,
      ),
    );
    return true;
  },
  importAddons: async () => {
    const r = await dialog.showOpenDialog(window, {
      filters: [{ name: "JSON", extensions: ["json"] }],
      properties: ["openFile"],
    });
    if (r.canceled) return null;
    const raw = readFileSync(r.filePaths[0], "utf8");
    if (raw.length > 2_000_000) throw new Error("الملف كبير جداً");
    const data = JSON.parse(raw);
    if (!Array.isArray(data.addons)) throw new Error("ملف الإضافات غير صالح");
    let count = 0,
      failed = 0;
    for (const url of data.addons.slice(0, 200)) {
      try {
        await client.install(typeof url === "string" ? url : url.transportUrl);
        count++;
      } catch {
        failed++;
      }
    }
    return { state: client.publicState(), count, failed };
  },
};
app
  .whenReady()
  .then(async () => {
    mkdirSync(app.getPath("userData"), { recursive: true });
    try {
      client = new Client({ load, save, version: app.getVersion() });
    } catch (error) {
      dialog.showErrorBox("Riwaq", error.message);
      app.exit(1);
    }
    if (client) {
      musicLibrary = new MusicLibrary(client);
      protocol.handle("riwaq-audio", (request) =>
        musicLibrary.respond(request),
      );
      // Sources that arrive after the list was shown (core/source-wait.mjs):
      // counts and addon names only, for the main window.
      client.onLateSources = (info) => emit("sources", info);
      client.onThemeError = (message) => logError("themeSong", message);
      client.updates = new DesktopUpdates(client, {
        current: app.getVersion(),
        directory: join(app.getPath("userData"), "updates"),
        publicKey: readFileSync(
          join(root, "assets", "update-public-key.pem"),
          "utf8",
        ),
        installed:
          app.isPackaged &&
          process.platform === "win32" &&
          !process.env.PORTABLE_EXECUTABLE_FILE &&
          existsSync(join(dirname(process.execPath), "Uninstall Riwaq.exe")),
        installDirectory: dirname(process.execPath),
        onChange: broadcast,
      });
      await client.updates.restore();
      runningFrame = client.state.settings.windowFrame || "native";
      const look = resolveAppearance(client.state.settings);
      window = new BrowserWindow({
        ...(runningFrame === "hybrid"
          ? {
              titleBarStyle: "hidden",
              titleBarOverlay: {
                color: look.colors.panel,
                symbolColor: look.colors.text,
                height: 36,
              },
            }
          : runningFrame === "riwaq"
            ? { frame: false }
            : {}),
        width: 1440,
        height: 960,
        minWidth: 980,
        minHeight: 680,
        backgroundColor: "#101215",
        title: "رِواق — Riwaq",
        icon: join(root, "assets", "icon.png"),
        show: !process.env.RIWAQ_SMOKE,
        autoHideMenuBar: true,
        webPreferences: {
          preload: join(root, "electron", "preload.cjs"),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
        },
      });
      window.on("query-session-end", () => {
        client.updates.sessionEnding = true;
      });
      powerMonitor.on("shutdown", () => {
        client.updates.sessionEnding = true;
      });
      videoHost = new VideoHost(window);
      // Full screen changes the client area after React measured it; the
      // surface is placed again once the window has settled.
      const settle = () => videoHost.refresh();
      window.on("enter-full-screen", () => {
        player?.setFullscreen(true);
        settle();
        placeHud();
      });
      window.on("leave-full-screen", () => {
        player?.setFullscreen(false);
        settle();
        placeHud();
      });
      window.on("resize", () => {
        settle();
        applyZoom();
        placeHud();
      });
      window.on("move", () => placeHud());
      const windowChanged = () => emit("window", windowState());
      window.on("maximize", windowChanged);
      window.on("unmaximize", windowChanged);
      window.on("enter-full-screen", windowChanged);
      window.on("leave-full-screen", windowChanged);
      window.on("blur", () => windowDrag({ phase: "end" }));
      window.on("restore", () => placeHud());
      window.webContents.on("did-finish-load", () => {
        appliedZoom = 0;
        applyZoom();
      });
      player = new Player({
        host: videoHost,
        inputConf: join(root, "assets", "player-input.conf"),
        settingsNow: () => client.state.settings,
        displayHeight: () => {
          const display = screen.getDisplayMatching(window.getBounds());
          return Math.round(display.size.height * display.scaleFactor);
        },
        skipPrefs: () =>
          skipPreferences(client.state.settings, nowPlaying?.series),
        onFullscreen: () => window.setFullScreen(!window.isFullScreen()),
        onEscape: () => {
          if (window.isFullScreen()) window.setFullScreen(false);
        },
        onState: (s) => {
          // A new viewing, or the mini player opening or closing, decides the
          // window's full screen state; afterwards the viewer owns it.
          const failed = s.active && s.error && !watching.error;
          if (failed) logError("player", s.error);
          const starting = s.active && !watching.active;
          if (starting) stopLocalMusic();
          const pipChanged =
            s.active && watching.active && s.pip !== watching.pip;
          watching = { active: !!s.active, pip: !!s.pip, error: !!s.error };
          setMediaKeys(!!s.active);
          if (failed) tryNextSource();
          emit("player", s);
          placeHud();
          updatePresence();
          client.integrations.observePlayback(s);
          // At shutdown MPV exits after the window is gone: everything above
          // (scrobbling, presence) still runs, the window calls do not.
          if (!window || window.isDestroyed()) return;
          if (!s.active) {
            try {
              videoHost.hide();
            } catch {}
            if (window.isFullScreen() && !client.state.settings.keepFullscreen)
              window.setFullScreen(false);
          } else if (starting || pipChanged) {
            if (s.pip) {
              if (window.isFullScreen()) window.setFullScreen(false);
            } else if (
              // Smoke runs measure the surface in a hidden, fixed-size window.
              !process.env.RIWAQ_SMOKE &&
              client.state.settings.autoFullscreen !== false &&
              !window.isFullScreen()
            )
              window.setFullScreen(true);
          }
        },
        onProgress: (...args) => {
          client.recordProgress(...args);
          client.integrations.queueHistory(...args);
          broadcast();
        },
        onEnded: (data) => {
          emit("ended", data);
          if (data.sleep)
            emit("notice", "انتهى مؤقت النوم، فما بدأت الحلقة التالية.");
          client.notifier
            .notify({
              kind: "finished",
              title: data.meta?.name,
              episode: data.meta?.type === "series" ? data.videoId : "",
              poster: data.meta?.poster,
            })
            .catch(() => {});
        },
        // The in-player episode keys are requests: the interface owns which
        // episode comes next and which source plays it.
        // With the HUD on, the panel lives there; otherwise in the theater.
        onEvent: (event) =>
          event.type === "panel" && player.state.overlay
            ? emit("hudCommand", event)
            : emit("playerRequest", event),
      });
      // The pointer hides over a still picture; see core/cursor.mjs.
      let lastPoint = null;
      let stillSince = Date.now();
      const checkCursor = () => {
        if (window.isDestroyed()) return cursorGate.release();
        const state = player.state;
        if (!state.active) {
          lastPoint = null;
          return cursorGate.release();
        }
        const point = screen.getCursorScreenPoint();
        if (!lastPoint || point.x !== lastPoint.x || point.y !== lastPoint.y)
          stillSince = Date.now();
        lastPoint = point;
        const onHud = !!(hud && !hud.isDestroyed() && hud.isVisible());
        const region = onHud
          ? hud.getBounds()
          : surfaceShown &&
            hudRect({
              content: window.getContentBounds(),
              surface: videoHost?.last,
              zoom: appliedZoom || 1,
            });
        const hidden = cursorHidden({
          active: state.active,
          pip: state.pip,
          minimized: window.isMinimized(),
          region,
          point,
          stillFor: Date.now() - stillSince,
          hud: onHud,
          hudIdle,
          focused: window.isFocused(),
          paused: state.pause,
        });
        cursorGate.set(hidden);
        // MPV's own property as well, for the surface without the HUD.
        player.setCursorHidden(hidden && !onHud);
      };
      cursorCheck = checkCursor;
      setInterval(checkCursor, 150);
      // Sound without a picture: start again once in the compatibility
      // mode, and say so; a second failure points at the diagnostic.
      player.onVideoFailed = ({ videoId }) => {
        logError("player", "MPV لم يعرض الصورة: مخرج الفيديو لم يُهيأ");
        if (player.safeRetried === videoId) {
          emit(
            "notice",
            "الصورة ما ظهرت حتى بوضع التوافق. شغّل «تشخيص كامل» من الإعدادات وأرسل لنا التقرير.",
          );
          return;
        }
        player.safeRetried = videoId;
        emit(
          "notice",
          "الصورة ما ظهرت، فأعدنا التشغيل بوضع التوافق (العارض الأقدم وفك الترميز بالمعالج).",
        );
        player.restartSafe()?.catch((error) => {
          logError("player", error);
          emit("notice", cleanError(error));
        });
      };
      player.onLoaded = ({ meta, videoId }) => {
        autoSubtitle(videoId);
        if (
          ["series", "movie"].includes(meta?.type) &&
          client.state.settings.skipOnline
        )
          (async () => {
            // A time that runs to the end of the file needs the duration,
            // which MPV may report a moment after the file loads.
            for (let i = 0; i < 20 && !(player.state.duration > 0); i++) {
              if (player.videoId !== videoId) return [];
              await new Promise((resolve) => setTimeout(resolve, 250));
            }
            return client.skipTimes(videoId, {
              duration: player.state.duration,
            });
          })()
            .then((segments) => player.setOnlineSegments(videoId, segments))
            .catch(() => {});
        const key = JSON.stringify([meta.type, videoId]);
        if (client.state.queue?.some((item) => item.key === key)) {
          client.state.queue = client.state.queue.filter(
            (item) => item.key !== key,
          );
          client.persist();
          broadcast();
        }
      };
      applyPresence().catch(() => {});
      if (!process.env.RIWAQ_SMOKE) client.updates.start();
      setInterval(() => checkPrayer(), 15000).unref?.();
      window.on("minimize", () => {
        placeHud();
        if (
          client.state.settings.pauseOnMinimize &&
          player.state.active &&
          !player.state.pause
        )
          player.command({ action: "pause" });
      });
      const page = fileURLToPath(
        new URL("../dist/index.html", import.meta.url),
      );
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", onDropNavigate);
      session.defaultSession.setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false),
      );
      ipcMain.handle("riwaq", async (event, method, args) => {
        if (
          !window ||
          window.isDestroyed() ||
          !(
            (event.sender === window.webContents &&
              event.senderFrame === window.webContents.mainFrame) ||
            (hud &&
              !hud.isDestroyed() &&
              event.sender === hud.webContents &&
              event.senderFrame === hud.webContents.mainFrame &&
              HUD_METHODS.has(method))
          ) ||
          !Object.hasOwn(methods, method)
        )
          return { ok: false, error: "الطلب غير مسموح" };
        try {
          return { ok: true, value: await methods[method](args) };
        } catch (error) {
          logError(`ipc:${method}`, error);
          if (process.env.RIWAQ_SMOKE)
            console.error(`Smoke IPC ${method}: ${error.stack}`);
          return { ok: false, error: cleanError(error) };
        }
      });
      await window.loadFile(page);
      ensureHud();
      if (process.env.RIWAQ_SMOKE) {
        const { runSmoke } = await import("../tests/smoke-runner.mjs");
        await runSmoke({ window, client, player, app, root });
      }
    }
  })
  .catch((error) => {
    if (process.env.RIWAQ_SMOKE) console.error(error.message);
    else
      dialog.showErrorBox("Riwaq", "تعذّر بدء التطبيق. " + cleanError(error));
    app.exit(1);
  });
function cleanError(error) {
  const message = error?.message || "";
  if (/[\u0600-\u06FF]/.test(message) && !/https?:|\\\\/.test(message))
    return message;
  // A bare status code carries no address, and tells the viewer (and us)
  // far more than the generic sentence.
  const status = /^HTTP (\d{3})$/.exec(message)?.[1];
  if (status)
    return `تعذّر إكمال العملية: ردّ الخادم برمز ${status}. تحقق من الاتصال والإعدادات ثم أعد المحاولة.`;
  return "تعذّر إكمال العملية. تحقق من الاتصال والإعدادات ثم أعد المحاولة.";
}
app.on("window-all-closed", () => app.quit());
let closing = false;
app.on("will-quit", () => {
  cursorGate.release();
  thumbnails?.reset();
  globalShortcut.unregisterAll();
});
app.on("before-quit", (event) => {
  if (closing) return;
  event.preventDefault();
  closing = true;
  client?.updates.stop();
  cancelLogin();
  cancelSpotifyLink();
  // Stopping the player sends the final scrobble; give it a moment to land so
  // a play finished just before closing is recorded rather than queued.
  Promise.resolve(player?.stop())
    .then(() => client?.integrations?.settle(3000))
    .then(async () => {
      client?.persist();
      await client?.updates.install({ automatic: true, relaunch: false });
    })
    .catch(() => {})
    .finally(() => app.quit());
});
