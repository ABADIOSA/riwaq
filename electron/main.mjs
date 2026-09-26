import {
  app,
  BrowserWindow,
  ipcMain,
  safeStorage,
  dialog,
  shell,
  session,
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
import { randomBytes } from "node:crypto";
import { Client } from "../core/client.mjs";
import { torrentUrl, webUrl } from "../core/protocol.mjs";
import { inputConf } from "../core/hotkeys.mjs";
import { readBackupHeader } from "../core/backup.mjs";
import { DiscordPresence, buildActivity } from "../core/presence.mjs";
import { Player } from "./player.mjs";
import { VideoHost } from "./video-host.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
if (process.env.RIWAQ_DATA_DIR)
  app.setPath("userData", process.env.RIWAQ_DATA_DIR);
app.setName("Riwaq");
let window, client, player, videoHost, loginServer, loginTimer, presence;
// A picked backup stays in main between "preview" and "restore"; the renderer
// only ever holds the opaque token.
let pendingBackup = null;
const emit = (name, data) => {
  if (window && !window.isDestroyed())
    window.webContents.send("riwaq:" + name, data);
};
const broadcast = () => emit("state", client.publicState());
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
  });
}
async function playChannel({ key, start = 0, stop = 0 }) {
  client.profiles.gate("live");
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
  });
}
const methods = {
  init: () => client.init(),
  catalog: (a) => client.catalog(a),
  metadata: (a) => client.metadata(a),
  streams: (a) => client.getStreams(a),
  subtitles: (a) => client.getSubtitles(a),
  install: (a) => client.install(a.url),
  updateAddon: (a) => client.updateAddon(a),
  settings: async (a) => {
    const state = client.settings(a);
    // Presence and the key map are derived from settings, so they follow.
    await applyPresence().catch(() => {});
    return state;
  },
  providerSave: (a) => client.dataHub.save(a),
  providerTest: (a) => client.dataHub.test(a.id),
  integrationSave: (a) => client.integrations.save(a),
  integrationSync: (a) => client.integrations.sync(a.id),
  integrationDisconnect: (a) => client.integrations.disconnect(a.id),
  traktLogin: (a) => client.integrations.begin(a?.id || "trakt"),
  traktPoll: (a) => client.integrations.poll(a?.id || "trakt"),
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
      trakt: "https://app.trakt.tv/settings/apps",
      traktActivate: "https://auth.trakt.tv/activate",
      simkl: "https://simkl.com/settings/developer/",
      simklActivate: "https://simkl.com/pin/",
      letterboxd: "https://letterboxd.com/settings/data/",
      stremboxd: "https://stremboxd.com",
      discord: "https://support.discord.com/hc/articles/228383668",
      telegram: "https://core.telegram.org/bots#how-do-i-create-a-bot",
      discordApp: "https://discord.com/developers/applications",
    };
    if (!urls[id]) throw new Error("رابط الخدمة غير معروف");
    await shell.openExternal(urls[id]);
    return true;
  },
  favorite: (a) => client.favorite(a),
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
    if (client.profiles.store.active === a.id) await player.stop();
    return client.profiles.remove(a);
  },
  profileSwitch: async (a) => {
    // A wrong PIN must be refused before playback is touched. Then save the
    // outgoing viewer's last position before replacing their bucket.
    client.profiles.check({ ...a, intent: "switch" });
    await player.stop();
    const result = client.profiles.switch(a);
    await applyPresence().catch(() => {});
    return result;
  },
  profilePin: (a) => client.profiles.setPin(a),
  profileUnlock: (a) => client.profiles.unlock(a?.pin),
  profileLock: () => client.profiles.lock(),
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
  videoBounds: (a) =>
    player.state.active ? videoHost.bounds(a) : (videoHost.hide(), false),
  playerCommand: (a) => player.command(a),
  stop: async () => {
    await player.stop();
    return true;
  },
  subtitle: (a) => {
    const url = client.subtitles.get(a.key);
    if (!url) throw new Error("الترجمة غير متاحة");
    player.subtitle(url);
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
    const path = r.filePaths[0];
    return player.start({
      executable: executable(),
      settings: client.state.settings,
      url: path,
      local: true,
      meta: { id: path, type: "local", name: basename(path) },
      videoId: path,
    });
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
  updatesCheck: async () => {
    await client.updates.check({ current: app.getVersion(), force: true });
    return client.publicState();
  },
  updatesSetEnabled: (a) => client.updates.setEnabled(a?.enabled),
  openUpdate: async () => {
    // The page comes from the validated store, never from the renderer.
    await shell.openExternal(client.updates.releaseUrl());
    return true;
  },
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
      window = new BrowserWindow({
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
      videoHost = new VideoHost(window);
      player = new Player({
        host: videoHost,
        inputConf: join(root, "assets", "player-input.conf"),
        onFullscreen: () => window.setFullScreen(!window.isFullScreen()),
        onState: (s) => {
          emit("player", s);
          updatePresence();
          client.integrations.observePlayback(s);
          if (!s.active) {
            videoHost.hide();
            if (window.isFullScreen()) window.setFullScreen(false);
          }
        },
        onProgress: (...args) => {
          client.recordProgress(...args);
          client.integrations.queueHistory(...args);
          broadcast();
        },
        onEnded: (data) => {
          emit("ended", data);
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
        onEvent: (event) => emit("playerRequest", event),
      });
      player.onLoaded = ({ meta, videoId }) => {
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
      // One anonymous check a day, after startup settles; never in smoke runs.
      if (!process.env.RIWAQ_SMOKE)
        setTimeout(async () => {
          const update = await client.updates.check({
            current: app.getVersion(),
          });
          if (
            update.available &&
            client.state.updates.notified !== update.latest.version
          ) {
            client.state.updates.notified = update.latest.version;
            client.persist();
            emit(
              "notice",
              `يتوفر إصدار جديد من رِواق: ${update.latest.version}. تجده في الإعدادات ← الاتصال والتطبيق.`,
            );
          }
          broadcast();
        }, 8000);
      window.on("minimize", () => {
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
      window.webContents.on("will-navigate", (event) => event.preventDefault());
      session.defaultSession.setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false),
      );
      ipcMain.handle("riwaq", async (event, method, args) => {
        if (
          !window ||
          window.isDestroyed() ||
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame ||
          !Object.hasOwn(methods, method)
        )
          return { ok: false, error: "الطلب غير مسموح" };
        try {
          return { ok: true, value: await methods[method](args) };
        } catch (error) {
          return { ok: false, error: cleanError(error) };
        }
      });
      await window.loadFile(page);
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
  return "تعذّر إكمال العملية. تحقق من الاتصال والإعدادات ثم أعد المحاولة.";
}
app.on("window-all-closed", () => app.quit());
let closing = false;
app.on("before-quit", (event) => {
  if (closing) return;
  event.preventDefault();
  closing = true;
  cancelLogin();
  // Stopping the player sends the final scrobble; give it a moment to land so
  // a play finished just before closing is recorded rather than queued.
  Promise.resolve(player?.stop())
    .then(() => client?.integrations?.settle(3000))
    .finally(() => app.quit());
});
