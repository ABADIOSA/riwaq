/**
 * The web edition's "main process".
 *
 * On the desktop, React talks to electron/main.mjs through the narrow
 * `window.riwaq` bridge (electron/preload.cjs). Here the same bridge is
 * installed in the page, and `methods` below answers it with the same
 * core/Client, so the interface, the stream engine, profiles, collections,
 * trackers and everything else in core/ are the very code the desktop runs.
 * A release changes both editions at once.
 *
 * Every method in preload's allowlist is answered here, or listed in
 * DESKTOP_ONLY with the reason the browser cannot do it
 * (tests/web-parity.test.mjs keeps the two in step).
 *
 * As in main: calls and events are copied (structured clone) on the way in
 * and out, errors reach the interface as Arabic sentences without
 * addresses, provider keys and addon URLs stay on this side of the bridge,
 * and addresses are opened only after the same checks main makes.
 */
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
  authorizeUrl as spotifyAuthorizeUrl,
  pkce as spotifyPkce,
} from "../core/spotify.mjs";
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
import { HUD_REQUESTS } from "../core/hud.mjs";
import { parseStream } from "../core/stream-engine.mjs";
import { sourceTags } from "../core/player-tuning.mjs";
import { measureDownload, suggestCap } from "../core/speed-test.mjs";
import { nextSource, playableKeys } from "../core/failover.mjs";
import { trailerOf } from "../core/credits.mjs";
import { toNuvio } from "../core/collections.mjs";
import {
  nuvioDiagnostics,
  nuvioPreview,
  readNuvioZip,
} from "../core/nuvio.mjs";
import {
  ErrorLog,
  cleanRendererErrors,
  formatReport,
  reportSettings,
  runCheck,
} from "../core/diagnose.mjs";
import { healthSummary, probeAddons, probeUrl } from "../core/addon-health.mjs";
import { SUBTITLE_EXTENSIONS, VIDEO_EXTENSIONS } from "../core/drop.mjs";
import { WebPlayer, browserCodecs } from "./player.js";
import { AUDIO_TYPES, WebMusicLibrary } from "./music.js";
import { WebUpdates } from "./updates.js";
import {
  copyText,
  fileKind,
  openExternal,
  pickFile,
  saveFile,
} from "./files.js";
import { DESKTOP_ONLY } from "./desktop-only.js";

const EVENTS = new Set([
  "state",
  "musicStop",
  "player",
  "notice",
  "ended",
  "playerRequest",
  "hudCommand",
  "sources",
  "window",
]);

/** The same sentence rules as main's cleanError: Arabic, never an address. */
export function cleanError(error) {
  const message = error?.message || "";
  if (/[؀-ۿ]/.test(message) && !/https?:|\\\\/.test(message)) return message;
  const status = /^HTTP (\d{3})$/.exec(message)?.[1];
  if (status)
    return `تعذّر إكمال العملية: ردّ الخادم برمز ${status}. تحقق من الاتصال والإعدادات ثم أعد المحاولة.`;
  return "تعذّر إكمال العملية. تحقق من الاتصال والإعدادات ثم أعد المحاولة.";
}

/** IPC copies everything that crosses it; so does the web bridge. */
const copy = (value) => {
  if (value === undefined) return undefined;
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
};

/**
 * Browsers refuse some headers (User-Agent among them) and others turn a
 * simple request into a CORS preflight that addon hosts rarely answer. The
 * browser sends its own User-Agent, so core's identifying header is dropped
 * here; everything else in the request is unchanged.
 */
export function browserFetch(nativeFetch) {
  return (input, init) => {
    if (init?.headers) {
      const headers = new Headers(init.headers);
      for (const name of ["user-agent", "referer", "origin", "cookie"])
        headers.delete(name);
      init = { ...init, headers };
    }
    return nativeFetch(input, init);
  };
}

/** The address Spotify and Stremio send the viewer back to: this page. */
const pageAddress = () => `${location.origin}${location.pathname}`;
const randomHex = (n) =>
  [...crypto.getRandomValues(new Uint8Array(n))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

export async function startBridge({ version, store }) {
  globalThis.fetch = browserFetch(globalThis.fetch.bind(globalThis));
  const listeners = new Map();
  const emit = (name, data) => {
    for (const fn of listeners.get(name) || []) {
      try {
        fn(copy(data));
      } catch {}
    }
  };
  const errorLog = new ErrorLog();
  const logError = (where, error) => errorLog.add(where, error, {});
  window.addEventListener("unhandledrejection", (event) =>
    logError("web:promise", event.reason),
  );

  const client = new Client({
    load: store.load,
    save: store.save,
    version,
    spotifyRedirect: pageAddress(),
    // Set at build time for tests and development (vite.web.config.mjs).
    accountServer: import.meta.env.RIWAQ_ACCOUNT_SERVER || undefined,
  });
  const broadcast = () => emit("state", client.publicState());
  client.updates = new WebUpdates(client, {
    current: version,
    onChange: broadcast,
  });
  client.onLateSources = (info) => emit("sources", info);
  client.account.onChange = (kind) => {
    broadcast();
    if (kind === "remote")
      emit("notice", "وصلت تحديثات من جهازك الآخر عبر حساب رِواق");
  };
  client.onThemeError = (message) => logError("themeSong", message);
  const music = new WebMusicLibrary(client);
  const stopLocalMusic = () => {
    music.revoke();
    emit("musicStop", {});
  };
  // The streaming server is the viewer's own (Stremio Service); this page
  // only uses it when it answers.
  const serverUp = async () => {
    try {
      const base = client.state.settings.serverUrl;
      const response = await fetch(`${base}/settings`, {
        signal: AbortSignal.timeout(2000),
      });
      return response.ok ? base : "";
    } catch {
      return "";
    }
  };

  // --- Playback, as main wires the native player -------------------------
  let nowPlaying = null;
  let watching = { active: false, error: false };
  const ranked = new Map();
  const remember = ({ type, id }, result) => {
    const keys = playableKeys(result);
    ranked.delete(`${type}:${id}`);
    if (ranked.size >= 20) ranked.delete(ranked.keys().next().value);
    ranked.set(`${type}:${id}`, keys);
  };
  let failover = { id: null, tried: new Set() };
  const player = new WebPlayer({
    settingsNow: () => client.state.settings,
    skipPrefs: () => skipPreferences(client.state.settings, nowPlaying?.series),
    server: serverUp,
    onState: (s) => {
      const failed = s.active && s.error && !watching.error;
      if (failed) logError("player", s.error);
      if (s.active && !watching.active) {
        stopLocalMusic();
        if (
          client.state.settings.autoFullscreen !== false &&
          !document.fullscreenElement
        )
          document.documentElement.requestFullscreen?.().catch(() => {});
      }
      if (
        !s.active &&
        watching.active &&
        document.fullscreenElement &&
        !client.state.settings.keepFullscreen
      )
        document.exitFullscreen?.().catch(() => {});
      watching = { active: !!s.active, error: !!s.error };
      client.account.playbackChanged(!!s.active);
      mediaSession(s);
      if (failed) tryNextSource();
      emit("player", s);
      client.integrations.observePlayback(s);
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
    onEvent: (event) =>
      event.type === "notice"
        ? emit("notice", event.text)
        : emit("playerRequest", event),
    onStall: ({ buffering, startup }) => {
      logError(
        "player",
        startup
          ? "المصدر لم يبدأ خلال 60 ثانية"
          : buffering
            ? "التشغيل توقف ينتظر الشبكة أكثر من 30 ثانية"
            : "التشغيل علق: الموضع لم يتحرك 15 ثانية",
      );
      if ((player.stallRetries || 0) < 1) {
        player.stallRetries = 1;
        emit("notice", "التشغيل علق، فأعدنا الاتصال من نفس اللحظة.");
        player.restartSame()?.catch((error) => logError("player", error));
        return;
      }
      emit(
        "notice",
        buffering
          ? "المصدر أبطأ من اتصالك؛ نجرّب المصدر التالي."
          : "المصدر ما زال عالقاً؛ نجرّب المصدر التالي.",
      );
      tryNextSource();
    },
    onLoaded: ({ meta, videoId }) => {
      autoSubtitle(videoId);
      if (
        ["series", "movie"].includes(meta?.type) &&
        client.state.settings.skipOnline
      )
        (async () => {
          for (let i = 0; i < 20 && !(player.state.duration > 0); i++) {
            if (player.videoId !== videoId) return [];
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
          return client.skipTimes(videoId, { duration: player.state.duration });
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
    },
  });

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

  // Media keys and the system's media controls drive the viewing.
  function mediaSession(s) {
    const session = navigator.mediaSession;
    if (!session) return;
    const handlers = {
      play: () => player.state.active && player.command({ action: "pause" }),
      pause: () => player.state.active && player.command({ action: "pause" }),
      stop: () => player.stop(),
      nexttrack: () => emit("playerRequest", { type: "next" }),
      previoustrack: () => emit("playerRequest", { type: "previous" }),
    };
    for (const [key, fn] of Object.entries(handlers)) {
      try {
        session.setActionHandler(key, s.active ? fn : null);
      } catch {}
    }
    if (s.active && typeof window.MediaMetadata !== "undefined")
      session.metadata = new window.MediaMetadata({
        title: s.name || "",
        artist: "رِواق",
        artwork: /^https:/.test(s.meta?.poster || "")
          ? [{ src: s.meta.poster }]
          : [],
      });
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
      openExternal(url);
      return { external: true };
    }
    let url = stream.url;
    if (!url && stream.infoHash) {
      if (!(await serverUp()))
        throw new Error(
          "هذا المصدر تورنت ويحتاج Stremio Service يعمل على جهازك. شغّل ستريميو الرسمي أو Stremio Service ثم أعد المحاولة، أو اختر مصدراً مباشراً.",
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
    const series = seriesOf(meta);
    nowPlaying = { key, type: meta.type, id: videoId, series };
    if (series && stream.memory)
      client.rememberSeries(series, { source: stream.memory });
    client.rememberResume(meta, videoId, { key, memory: stream.memory });
    if (stream.behaviorHints?.proxyHeaders?.request && !(await serverUp()))
      emit(
        "notice",
        "هذا المصدر يطلب ترويسات خاصة لا يرسلها المتصفح؛ قد لا يعمل إلا في نسخة سطح المكتب.",
      );
    return player.start({
      tags: sourceTags(parseStream(stream)),
      settings: client.state.settings,
      url,
      meta,
      videoId,
      start,
    });
  }

  async function playChannel({ key, start = 0, stop = 0 }) {
    client.profiles.gate("live");
    nowPlaying = null;
    const channel = client.live.resolve(key, { start, stop });
    await player.stop();
    return player.start({
      settings: client.state.settings,
      url: channel.url,
      meta: {
        id: `live:${key}`,
        type: "live",
        name: channel.name,
        poster: channel.logo,
      },
      videoId: `live:${key}`,
      live: channel.live,
    });
  }

  async function playLocalFile(file) {
    nowPlaying = null;
    const name = file.name.slice(0, 200);
    return player.start({
      settings: client.state.settings,
      url: URL.createObjectURL(file),
      local: true,
      meta: { id: `local:${name}`, type: "local", name },
      videoId: `local:${name}:${file.size}`,
    });
  }

  /** As main's autoSubtitle: the series' remembered tracks, then an addon's. */
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
        if (sub !== null) return;
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
        await player.addSubtitle(client.subtitles.get(pick.key), {
          key: pick.key,
          ...client.subtitleInfo.get(pick.key),
          fetchText: subtitleText,
        });
        emit(
          "notice",
          `اخترنا ترجمة ${pick.provider ? `من ${pick.provider}` : "من إضافاتك"}. غيّرها من لوحة الترجمة (C).`,
        );
      } catch {
        /* Subtitles are a convenience; playback carries on without them. */
      }
    }, 1500);
  }
  const subtitleText = async (url) => {
    const text = await fetchText(url, { timeout: 15000 });
    if (text.length > 5_000_000) throw new Error("ملف الترجمة كبير جداً");
    return text;
  };

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

  // Prayer times during a viewing (core/prayer.mjs), as main's checkPrayer.
  const prayerSeen = new Set();
  function checkPrayer(now = new Date()) {
    const s = client.state.settings;
    if (!s?.prayerOn || !player.state.active) return;
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
          player.command({ action: "pause" });
          emit(
            "notice",
            `حان وقت صلاة ${name}. أوقفنا المشاهدة مؤقتاً، وتكمل من نفس اللحظة متى ما رجعت.`,
          );
        } else
          emit("notice", `حان وقت صلاة ${name} (${clockAt(at, place.tz)})`);
      }
    }
    if (prayerSeen.size > 60) prayerSeen.clear();
  }
  setInterval(() => checkPrayer(), 15000);
  document.addEventListener("visibilitychange", () => {
    // Back on the page: look for changes from other devices; leaving it:
    // send what is waiting.
    if (document.visibilityState === "visible") client.account.nudge();
    else client.account.flush();
    if (document.visibilityState !== "hidden") return;
    // The settings say "pause when minimized"; a hidden tab is the web's.
    if (
      client.state.settings.pauseOnMinimize &&
      player.state.active &&
      !player.state.pause
    )
      player.command({ action: "pause" });
    client.persist();
  });
  window.addEventListener("pagehide", () => {
    player.save();
    client.persist();
  });
  const windowState = () => ({
    frame: "native",
    wanted: "native",
    maximized: false,
    fullscreen: !!document.fullscreenElement,
    web: true,
  });
  document.addEventListener("fullscreenchange", () =>
    emit("window", windowState()),
  );

  // --- Sign-in callbacks (Stremio, Spotify) arrive from a popup -----------
  // The popup lands on this same page with the answer in its address; the
  // page passes it here over a same-origin channel (web/main.jsx) and
  // closes. Only an answer carrying this attempt's nonce is taken.
  const channel =
    "BroadcastChannel" in globalThis
      ? new globalThis.BroadcastChannel("riwaq-callback")
      : null;
  let loginAttempt = null;
  let spotifyAttempt = null;
  channel?.addEventListener("message", async ({ data }) => {
    if (
      data?.kind === "stremio" &&
      loginAttempt &&
      data.nonce === loginAttempt.nonce
    ) {
      clearTimeout(loginAttempt.timer);
      loginAttempt = null;
      try {
        await client.authenticate(String(data.authKey || ""));
        broadcast();
        const result = await client.sync();
        broadcast();
        emit(
          "notice",
          `تم استيراد ${result.imported} إضافة${result.libraryWarning ? "؛ تعذّر استيراد المكتبة" : ""}${result.skipped.length ? "؛ بعض الإضافات القديمة غير مدعومة" : ""}`,
        );
      } catch (error) {
        emit("notice", cleanError(error));
      }
    }
    if (
      data?.kind === "spotify" &&
      spotifyAttempt &&
      data.state === spotifyAttempt.nonce
    ) {
      const { verifier, timer } = spotifyAttempt;
      clearTimeout(timer);
      spotifyAttempt = null;
      if (!data.code || String(data.code).length > 2048) {
        emit("notice", "ألغيت ربط Spotify أو رفضه الحساب");
        return;
      }
      try {
        await client.spotify.exchange(String(data.code), verifier);
        emit("notice", "تم ربط Spotify");
        broadcast();
      } catch (error) {
        logError("spotify", error);
        emit("notice", cleanError(error));
      }
    }
  });
  const popup = (url) => {
    const opened = window.open(
      url,
      "riwaq-signin",
      "popup,width=560,height=760",
    );
    if (!opened)
      throw new Error(
        "المتصفح منع نافذة تسجيل الدخول. اسمح بالنوافذ المنبثقة لهذا الموقع ثم أعد المحاولة.",
      );
  };
  function cancelLogin() {
    clearTimeout(loginAttempt?.timer);
    loginAttempt = null;
  }
  function cancelSpotifyLink() {
    clearTimeout(spotifyAttempt?.timer);
    spotifyAttempt = null;
  }

  // --- Held between two calls, as main holds them -------------------------
  let pendingBackup = null;
  let pendingNuvio = null;
  let lastDiagnosis = null;
  const cueCache = new Map();
  const nuvioReply = (stores, source) => {
    const profiles = nuvioPreview(stores);
    if (!profiles.length) throw new Error("لم نجد ملفات شخصية في بيانات نوفيو");
    pendingNuvio = { token: randomHex(16), stores };
    return { token: pendingNuvio.token, source, profiles };
  };
  const tooBig = (file, max, message) => {
    if (file.size > max) throw new Error(message);
  };

  async function diagnoseRun(a) {
    client.profiles.gate("settings");
    const s = client.state.settings;
    const checks = await Promise.all([
      runCheck("storage", "التخزين المشفّر في المتصفح", () =>
        store.persistent && !store.failed
          ? {
              status: "ok",
              detail: "بياناتك مشفّرة بمفتاح لا يخرج من هذا المتصفح",
            }
          : {
              status: "warn",
              detail:
                "هذا المتصفح لا يسمح بالتخزين المشفّر هنا، فلن تُحفظ بياناتك بعد إغلاق الصفحة",
            },
      ),
      runCheck("addons", "الإضافات", async () => {
        const { results } = await probeAddons(client.state.addons, { version });
        const counts = healthSummary(results);
        return {
          status: counts.down || counts.gone ? "warn" : "ok",
          detail: `${results.length} إضافة · ${counts.ok || 0} تعمل${counts.down ? ` · ${counts.down} لا ترد` : ""}${counts.gone ? ` · ${counts.gone} حُذفت من مصدرها` : ""}`,
        };
      }),
      runCheck("server", "Stremio Service", async () =>
        (await serverUp())
          ? { status: "ok", detail: "يعمل على جهازك: التورنت والتحويل متاحان" }
          : {
              status: "warn",
              detail:
                "لا يعمل: مصادر التورنت والصيغ غير المدعومة في المتصفح لن تعمل",
            },
      ),
      runCheck("internet", "الاتصال بالإنترنت", async () => {
        const r = await probeUrl(
          fetch,
          "https://v3-cinemeta.strem.io/manifest.json",
          { timeout: 8000 },
        );
        return r.status === 200
          ? { status: "ok", detail: `${r.ms} ms` }
          : { status: "warn", detail: `HTTP ${r.status}` };
      }),
      runCheck("codecs", "الصيغ التي يشغلها المتصفح", () => {
        const c = browserCodecs();
        return {
          status: "ok",
          detail: `فيديو: ${c.video.join("، ")} · صوت: ${c.audio.join("، ")}`,
        };
      }),
    ]);
    const state = client.publicState();
    const report = {
      generatedAt: new Date().toISOString(),
      app: { version, edition: "web", language: navigator.language || "" },
      system: {
        screen: `${screen.width}×${screen.height}`,
        scale: devicePixelRatio,
        cores: navigator.hardwareConcurrency || "",
        memoryGB: navigator.deviceMemory || "",
        secure: window.isSecureContext,
      },
      checks,
      counts: {
        addons: `${client.state.addons.filter((x) => x.enabled !== false).length} مفعّلة من ${client.state.addons.length}`,
        profiles: state.profiles?.list?.length || 0,
        favorites: (client.state.favorites || []).length,
        progress: Object.keys(client.state.progress || {}).length,
        collections: (client.state.collections || []).length,
        player: player.state.active
          ? `يعمل${player.state.error ? "، مع خطأ" : ""}`
          : "متوقف",
        streamServer: s.serverUrl ? "مضبوط" : "غير مضبوط",
      },
      settings: reportSettings(s),
      errors: {
        main: errorLog.list(),
        renderer: cleanRendererErrors(a?.rendererErrors),
      },
    };
    const text = formatReport(report);
    lastDiagnosis = { report, text };
    return { report, text };
  }

  const methods = {
    musicLocalLibrary: async (a) => {
      await music.tagSome(a?.profileId);
      return music.view(a?.profileId);
    },
    musicLocalCover: (a) => music.cover(a || {}),
    musicLocalImport: async (a) => {
      music.gate(a?.profileId);
      const files = await pickFile({
        accept: Object.keys(AUDIO_TYPES).join(","),
        multiple: true,
      });
      return music.importFiles(a.profileId, files || []);
    },
    musicLocalEdit: (a) => music.edit(a || {}),
    musicLocalSource: async (a) => {
      if (player.state.active)
        throw new Error("أوقف المشاهدة قبل تشغيل الموسيقى");
      return music.source(a || {});
    },
    init: () => client.init(),
    windowInfo: () => windowState(),
    windowControl: () => windowState(),
    windowDrag: () => false,
    relaunch: () => {
      client.persist();
      store.settled().then(() => location.reload());
      return true;
    },
    // The tab's icon follows the accent, as the taskbar icon does.
    setAppIcon: (a) => {
      const url = typeof a?.dataUrl === "string" ? a.dataUrl : "";
      if (
        url &&
        (!url.startsWith("data:image/png;base64,") || url.length > 400000)
      )
        throw new Error("أيقونة غير صالحة");
      let link = document.querySelector('link[rel="icon"]');
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.append(link);
      }
      link.href = url || link.dataset.default || link.href;
      return true;
    },
    catalog: (a) => client.catalog(a),
    catalogPlan: (a) => client.catalogPlan(a),
    badgePackFetch: (a) => fetchPackText(String(a?.url || "")),
    copyBadgePack: async (a) => {
      const json = String(a?.json || "");
      let data;
      try {
        data = JSON.parse(json);
      } catch {
        throw new Error("حزمة غير صالحة");
      }
      if (data?.format !== "riwaq-badges" || json.length > 400000)
        throw new Error("حزمة غير صالحة");
      return copyText(json);
    },
    copyThemeCode: async (a) => {
      const code = String(a?.code || "");
      if (!code.startsWith("RIWAQ-THEME-1:") || code.length > 6000)
        throw new Error("رمز التصميم غير صالح");
      return copyText(code);
    },
    metadata: (a) => client.metadata(a),
    titleCredits: (a) =>
      client.credits.title({
        type: a?.type === "series" ? "series" : "movie",
        id: typeof a?.id === "string" ? a.id : "",
      }),
    searchPeople: (a) =>
      client.credits.searchPeople({
        query: typeof a?.query === "string" ? a.query : "",
      }),
    themeSong: (a) =>
      client.themeSong({
        type: a?.type === "series" ? "series" : "movie",
        id: typeof a?.id === "string" ? a.id.slice(0, 200) : "",
      }),
    spotifyConnect: (a) => {
      cancelSpotifyLink();
      const id = client.spotify.setClientId(a?.clientId);
      const { verifier, challenge } = spotifyPkce();
      const nonce = randomHex(24);
      popup(
        spotifyAuthorizeUrl({
          clientId: id,
          challenge,
          state: nonce,
          redirect: pageAddress(),
        }),
      );
      spotifyAttempt = {
        nonce,
        verifier,
        timer: setTimeout(() => {
          spotifyAttempt = null;
          emit("notice", "انتهت مهلة ربط Spotify. يمكنك المحاولة مجدداً.");
        }, 300000),
      };
      return true;
    },
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
      await new Promise((resolve) => setTimeout(resolve, 400));
      return client.spotify.playback().catch(() => null);
    },
    // Spotify's own web player stands in for the desktop app.
    spotifyOpenApp: () => openExternal("https://open.spotify.com/"),
    musicOpen: (a) => {
      const url = a?.url
        ? musicLink(a.url)
        : musicSearchUrl(a?.platform, a?.query);
      if (!url) throw new Error("رابط الموسيقى غير صالح");
      return openExternal(url);
    },
    openTrailer: (a) => {
      const id = trailerOf(client.metas.get(`${a?.type}:${a?.id}`));
      if (!id) throw new Error("لا يتوفر إعلان لهذا العمل");
      return openExternal(`https://www.youtube.com/watch?v=${id}`);
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
    playerSources: async () => {
      if (!nowPlaying || !player.state.active) return { streams: [] };
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
      if (
        !player.state.active ||
        !nowPlaying ||
        nowPlaying.id !== player.videoId
      )
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
        cues = parseCues(await subtitleText(url));
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
    addonsHealth: async () => {
      client.profiles.gate("addons");
      return probeAddons(client.state.addons, { version });
    },
    removeAddons: (a) => client.removeAddons({ keys: a?.keys }),
    settings: async (a) => {
      const state = client.settings(a);
      player.applyCueStyle();
      return state;
    },
    providerSave: (a) => client.dataHub.save(a),
    debridSave: (a) => {
      client.profiles.gate("settings");
      return client.services.debridSave({
        id: String(a?.id || ""),
        key: typeof a?.key === "string" ? a.key : undefined,
        clear: a?.clear === true,
      });
    },
    debridCheck: (a) =>
      client.services.debridCheck({ id: String(a?.id || "") }),
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
    releaseDates: (a) => client.releaseDates({ id: String(a?.id || "") }),
    titleLogos: (a) =>
      client.titleLogos({
        type: String(a?.type || ""),
        id: String(a?.id || "").slice(0, 120),
      }),
    seasonDetails: (a) =>
      client.seasonDetails({
        id: String(a?.id || ""),
        season: Number(a?.season),
      }),
    artwork: (a) =>
      client.artwork({ type: String(a?.type || ""), id: String(a?.id || "") }),
    openArtwork: (a) => {
      const url = String(a?.url || "");
      if (!artworkHost(url)) throw new Error("رابط الصورة غير مسموح");
      return openExternal(url);
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
    anilistConnect: (a) => client.integrations.anilistConnect(a?.token),
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
      const file = await pickFile({ accept: ".csv,text/csv" });
      if (!file) return null;
      tooBig(file, 20 * 1024 * 1024, "الملف كبير جداً");
      return client.integrations.importLetterboxd(await file.text());
    },
    openService: ({ id }) => {
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
        anilist: "https://anilist.co/settings/developer",
        letterboxd: "https://letterboxd.com/settings/data/",
        stremboxd: "https://stremboxd.com",
        discord: "https://support.discord.com/hc/articles/228383668",
        telegram: "https://core.telegram.org/bots#how-do-i-create-a-bot",
        discordApp: "https://discord.com/developers/applications",
        ...Object.fromEntries(DEBRID.map((d) => [d.id, d.url])),
        ...Object.fromEntries(AI_PROVIDERS.map((p) => [p.id, p.keys])),
      };
      if (id === "anilistActivate")
        urls.anilistActivate = client.integrations.anilistAuthorizeUrl();
      if (!urls[id]) throw new Error("رابط الخدمة غير معروف");
      return openExternal(urls[id]);
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
      music.forget(a.id);
      return client.profiles.remove(a);
    },
    profileSwitch: async (a) => {
      client.profiles.check({ ...a, intent: "switch" });
      stopLocalMusic();
      await player.stop();
      return client.profiles.switch(a);
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
    // A screenshot is already a download in the browser's own folder.
    openScreenshots: () => true,
    login: () => {
      cancelLogin();
      const nonce = randomHex(24);
      const callback = `${pageAddress()}?riwaq-login=${nonce}`;
      popup(
        "https://www.stremio.com/login?" +
          new URLSearchParams({ appName: "Riwaq", appCallback: callback }),
      );
      loginAttempt = {
        nonce,
        timer: setTimeout(() => {
          loginAttempt = null;
          emit("notice", "انتهت مهلة تسجيل الدخول. يمكنك المحاولة مجدداً.");
        }, 300000),
      };
      return true;
    },
    cancelLogin: () => {
      cancelLogin();
      return true;
    },
    logout: () => {
      cancelLogin();
      return client.logout();
    },
    sync: () => client.sync(),
    configure: (a) => openExternal(client.configureUrl(a.key)),
    play,
    videoBounds: (a) => player.place(a || {}),
    // The web edition has no separate HUD window: the theater draws the
    // controls, so these keep the same answers with nothing to forward to.
    hudPanel: () => true,
    hudIdle: () => true,
    hudRequest: (a) => {
      if (!HUD_REQUESTS.has(a?.type)) throw new Error("الطلب غير مسموح");
      if (a.type === "episode") {
        if (
          typeof a.videoId !== "string" ||
          !/^[\w:.-]{1,200}$/.test(a.videoId)
        )
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
    // Seek previews need a second MPV; the browser shows the time alone.
    trickplay: () => null,
    stop: async () => {
      player.setSleepEpisodes(0);
      await player.stop();
      return true;
    },
    speedTest: async () => {
      const mbps = await measureDownload();
      return { mbps, suggest: suggestCap(mbps) };
    },
    subtitle: async (a) => {
      const url = client.subtitles.get(a?.key);
      if (!url) throw new Error("الترجمة غير متاحة");
      const info = client.subtitleInfo.get(a.key) || {};
      await player.addSubtitle(url, {
        key: a.key,
        ...info,
        secondary: a.secondary === true,
        fetchText: subtitleText,
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
      const file = await pickFile({
        accept: SUBTITLE_EXTENSIONS.map((x) => `.${x}`).join(","),
      });
      if (!file) return false;
      await player.addSubtitleFile(file);
      return true;
    },
    localVideo: async () => {
      const file = await pickFile({
        accept: `video/*,${VIDEO_EXTENSIONS.map((x) => `.${x}`).join(",")}`,
      });
      if (!file) return false;
      return playLocalFile(file);
    },
    diagnostics: async () => ({
      mpv: false,
      server: !!(await serverUp()),
      encryption: !!store.persistent,
      version,
      web: true,
    }),
    diagnoseRun,
    diagnoseCopy: () => {
      if (!lastDiagnosis) throw new Error("شغّل التشخيص أولاً");
      return copyText(lastDiagnosis.text);
    },
    diagnoseSave: () => {
      if (!lastDiagnosis) throw new Error("شغّل التشخيص أولاً");
      const stamp = lastDiagnosis.report.generatedAt
        .slice(0, 16)
        .replace(/[:T]/g, "-");
      return saveFile(`riwaq-diagnostics-${stamp}.txt`, lastDiagnosis.text);
    },
    updatesCheck: async () => {
      client.profiles.gate("settings");
      await client.updates.check({ force: true });
      return client.publicState();
    },
    updatesSetEnabled: (a) => client.updates.setEnabled(a?.enabled),
    updatesConfigure: (a) => client.updates.configure(a || {}),
    // A newer site is one reload away; nothing is downloaded or installed.
    updatesDownload: () => client.publicState(),
    updatesCancel: () => client.publicState(),
    updatesInstall: async () => {
      client.profiles.gate("settings");
      await player.stop();
      await client.integrations.settle(3000);
      client.persist();
      await store.settled();
      location.reload();
      return true;
    },
    openUpdate: () => openExternal(client.updates.releaseUrl()),
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
    collectionsCopyNuvio: () =>
      copyText(
        JSON.stringify(toNuvio(client.state.collections || []), null, 2),
      ),
    collectionsSaveNuvio: () =>
      saveFile(
        "riwaq-collections.json",
        JSON.stringify(toNuvio(client.state.collections || []), null, 2),
        "application/json",
      ),
    importNuvioCollections: (a) =>
      client.importNuvioCollections({
        text: typeof a?.text === "string" ? a.text : "",
      }),
    nuvioPickBackup: async () => {
      client.profiles.gate("settings");
      const file = await pickFile({ accept: ".zip,application/zip" });
      if (!file) return null;
      tooBig(file, 200 * 1024 * 1024, "الملف كبير جداً");
      return nuvioReply(
        readNuvioZip(new Uint8Array(await file.arrayBuffer())),
        file.name,
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
    nuvioDiagnostics: (a) => {
      client.profiles.gate("settings");
      if (!pendingNuvio || pendingNuvio.token !== a?.token)
        throw new Error("اقرأ بيانات نوفيو من جديد");
      const index = Number(a?.profile);
      if (!Number.isInteger(index) || index < 1)
        throw new Error("اختر ملف نوفيو");
      return copyText(nuvioDiagnostics(pendingNuvio.stores, index));
    },
    removeNuvioPlugin: (a) =>
      client.removeNuvioPlugin({
        key: typeof a?.key === "string" ? a.key : "",
      }),
    backupExport: ({ passphrase, includeSecrets = false } = {}) => {
      const { text, left } = client.exportBackup({
        passphrase,
        includeSecrets: includeSecrets === true,
        app: version,
      });
      const stamp = new Date().toISOString().slice(0, 10);
      saveFile(`riwaq-backup-${stamp}.riwaq`, text);
      return { saved: true, left };
    },
    backupPick: async () => {
      const file = await pickFile({ accept: ".riwaq" });
      if (!file) return null;
      tooBig(file, 64 * 1024 * 1024, "ملف النسخة الاحتياطية كبير جداً");
      const text = await file.text();
      const { header } = readBackupHeader(text);
      pendingBackup = { token: randomHex(16), text };
      return {
        token: pendingBackup.token,
        name: file.name,
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
      client.inspectBackup({ text: pendingBackup.text, passphrase });
      stopLocalMusic();
      await player.stop();
      // An undo kept in this browser, sealed like the profile itself.
      client.profiles.capture();
      await store.saveBeforeRestore(client.state);
      const state = client.restoreBackup({
        text: pendingBackup.text,
        passphrase,
      });
      pendingBackup = null;
      return state;
    },
    backupCancel: () => {
      pendingBackup = null;
      return true;
    },
    // Riwaq accounts (core/account.mjs), as in main.
    accountSignup: async (a) => {
      const { recoveryCode } = await client.account.signup({
        username: String(a?.username || ""),
        password: typeof a?.password === "string" ? a.password : "",
        secrets: a?.secrets === true,
      });
      return { recoveryCode };
    },
    accountLogin: (a) =>
      client.account.login({
        username: String(a?.username || ""),
        password: typeof a?.password === "string" ? a.password : "",
      }),
    accountRecover: (a) =>
      client.account.recover({
        username: String(a?.username || ""),
        code: String(a?.code || ""),
        password: typeof a?.password === "string" ? a.password : "",
      }),
    accountPassword: (a) =>
      client.account.changePassword({
        password: typeof a?.password === "string" ? a.password : "",
        newPassword: typeof a?.newPassword === "string" ? a.newPassword : "",
      }),
    accountDelete: (a) =>
      client.account.deleteAccount({
        password: typeof a?.password === "string" ? a.password : "",
      }),
    accountLogout: () => client.account.logout(),
    accountConfigure: (a) =>
      client.account.configure({
        secrets: typeof a?.secrets === "boolean" ? a.secrets : undefined,
      }),
    accountSync: async () => {
      await client.account.sync();
      return client.publicState();
    },
    exportAddons: () =>
      saveFile(
        "riwaq-addons.json",
        JSON.stringify(
          {
            format: "riwaq-addons-v1",
            addons: client.state.addons.map((a) => a.transportUrl),
          },
          null,
          2,
        ),
        "application/json",
      ),
    importAddons: async () => {
      const file = await pickFile({ accept: ".json,application/json" });
      if (!file) return null;
      tooBig(file, 2_000_000, "الملف كبير جداً");
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.addons)) throw new Error("ملف الإضافات غير صالح");
      let count = 0,
        failed = 0;
      for (const url of data.addons.slice(0, 200)) {
        try {
          await client.install(
            typeof url === "string" ? url : url.transportUrl,
          );
          count++;
        } catch {
          failed++;
        }
      }
      return { state: client.publicState(), count, failed };
    },
  };
  for (const [name, reason] of Object.entries(DESKTOP_ONLY))
    methods[name] = () => {
      throw new Error(reason);
    };

  // Files dropped on the page: a video plays, a subtitle joins the viewing.
  window.addEventListener("dragover", (event) => {
    if ([...(event.dataTransfer?.types || [])].includes("Files"))
      event.preventDefault();
  });
  window.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    event.preventDefault();
    const kind = fileKind(file.name, {
      video: VIDEO_EXTENSIONS,
      subtitle: SUBTITLE_EXTENSIONS,
    });
    if (kind === "subtitle") {
      if (!player.state.active) {
        emit("notice", "شغّل عملاً أولاً، ثم اسحب ملف الترجمة إلى الصورة.");
        return;
      }
      player
        .addSubtitleFile(file)
        .then(() =>
          emit("notice", `أُضيفت الترجمة «${file.name.slice(0, 80)}»`),
        )
        .catch((error) => emit("notice", cleanError(error)));
    } else if (kind === "video")
      playLocalFile(file).catch((error) => emit("notice", cleanError(error)));
  });

  client.updates.start((text) => emit("notice", text));
  client.account.start();
  if (!store.persistent)
    setTimeout(
      () =>
        emit(
          "notice",
          "هذا المتصفح لا يسمح بحفظ بيانات رِواق المشفّرة هنا (ربما نافذة خاصة)، فستضيع إضافاتك وإعداداتك عند إغلاق الصفحة.",
        ),
      1500,
    );

  const riwaq = {
    platform: "web",
    call: async (method, args) => {
      if (!Object.hasOwn(methods, method)) throw new Error("الطلب غير مسموح");
      try {
        return copy(await methods[method](copy(args)));
      } catch (error) {
        logError(`ipc:${method}`, error);
        throw new Error(cleanError(error));
      }
    },
    on: (name, fn) => {
      if (!EVENTS.has(name)) return () => {};
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
      return () => listeners.get(name)?.delete(fn);
    },
  };
  window.riwaq = riwaq;
  return { riwaq, client, player, methods };
}
