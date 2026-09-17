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
} from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { Client } from "../core/client.mjs";
import { torrentUrl, webUrl } from "../core/protocol.mjs";
import { Player } from "./player.mjs";
import { VideoHost } from "./video-host.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
if (process.env.RIWAQ_DATA_DIR)
  app.setPath("userData", process.env.RIWAQ_DATA_DIR);
app.setName("Riwaq");
let window, client, player, videoHost, loginServer, loginTimer;
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
async function play({ key, meta, videoId, resume = true }) {
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
  await player.stop();
  const progress = client.state.progress[`${meta.type}:${videoId}`];
  const start =
    resume &&
    progress &&
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
  settings: (a) => client.settings(a),
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
    };
    if (!urls[id]) throw new Error("رابط الخدمة غير معروف");
    await shell.openExternal(urls[id]);
    return true;
  },
  favorite: (a) => client.favorite(a),
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
      client = new Client({ load, save });
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
        onEnded: (data) => emit("ended", data),
      });
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
  Promise.resolve(player?.stop()).finally(() => app.quit());
});
