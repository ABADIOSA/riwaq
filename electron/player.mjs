import { styleArgs, styleProperties } from "../core/subtitles.mjs";
import { spawn } from "node:child_process";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { webUrl } from "../core/protocol.mjs";
import {
  activeSegment,
  detectSegments,
  mergeSegments,
  skipMode,
} from "../core/skip-segments.mjs";
import { seekAmount } from "../core/hotkeys.mjs";
import { SurfaceWatch } from "../core/surface.mjs";
import {
  audioArgs,
  bufferArgs,
  liveTuning,
  rtxFilters,
  videoArgs,
  volumeMax,
} from "../core/player-tuning.mjs";

/**
 * Picture profiles built from MPV's own scalers and filters. Riwaq ships no
 * third-party shader files; a viewer who owns a .glsl chain points at it with
 * the custom profile instead.
 */
const PICTURE_PROFILES = {
  none: [],
  sharp: [
    "--scale=ewa_lanczossharp",
    "--cscale=ewa_lanczossoft",
    "--dscale=mitchell",
  ],
  anime: [
    "--scale=ewa_lanczossharp",
    "--cscale=ewa_lanczossoft",
    "--dscale=mitchell",
    "--sigmoid-upscaling=yes",
    "--deband=yes",
    "--deband-iterations=2",
  ],
  film: [
    "--scale=ewa_lanczos",
    "--dscale=mitchell",
    "--deband=yes",
    "--dither-depth=auto",
  ],
  custom: [],
};
const TONE_MAPPING = ["bt.2446a", "hable", "mobius", "reinhard"];

export function playerArgs({
  pipe,
  settings,
  url,
  title,
  start = 0,
  headers = {},
  host,
  inputConf,
  live = false,
  screenshotDir = "",
  logFile = "",
  separate = false,
  local = false,
  bufferMiB = 512,
  deferLoad = false,
}) {
  const args = [
    "--no-config",
    "--load-scripts=no",
    "--ytdl=no",
    "--input-terminal=no",
    "--terminal=no",
    `--input-ipc-server=${pipe}`,
    "--force-window=yes",
    "--keep-open=no",
    "--idle=yes",
    // MPV's own controller draws over the picture, which HTML cannot do over a
    // native surface. It stays hidden until the player goes full screen.
    // MPV starts idle and gets the source over IPC: its idle logo stays off,
    // or it would flash on the surface before every viewing.
    "--osc=yes",
    "--script-opts=osc-visibility=never,osc-layout=bottombar,osc-windowcontrols=no,osc-hidetimeout=1800,osc-idlescreen=no",
    "--osd-font=Segoe UI",
    // Main decides when the pointer hides; see setCursorHidden.
    "--cursor-autohide=no",
    "--osd-bar=yes",
    `--title=${title}`,
    `--force-media-title=${title}`,
    "--save-position-on-quit=no",
    ...videoArgs(settings, { separate }),
    ...audioArgs(settings),
    `--slang=${settings.subtitleLanguage}`,
    `--alang=${settings.audioLanguage}`,
    `--sub-font-size=${settings.subtitleSize}`,
    `--sub-delay=${settings.subtitleDelay}`,
    "--sub-font=Segoe UI",
    ...styleArgs(settings.subtitleStyle),
    `--sub-pos=${settings.subtitlePosition ?? 95}`,
    `--start=${Math.max(0, Number(start) || 0)}`,
    `--panscan=${settings.videoFill ? "1.0" : "0.0"}`,
  ];
  const profile = PICTURE_PROFILES[settings.shader] ? settings.shader : "none";
  args.push(...PICTURE_PROFILES[profile]);
  if (
    profile === "custom" &&
    typeof settings.shaderPath === "string" &&
    settings.shaderPath
  )
    args.push(`--glsl-shaders=${settings.shaderPath}`);
  if (settings.toneMapping && settings.toneMapping !== "off") {
    if (TONE_MAPPING.includes(settings.toneMapping))
      args.push(`--tone-mapping=${settings.toneMapping}`);
    args.push("--hdr-compute-peak=yes");
  }
  if (screenshotDir) {
    args.push(
      `--screenshot-directory=${screenshotDir}`,
      "--screenshot-format=png",
    );
  }
  // Network sources keep a large buffer and reconnect on a dropped
  // connection (core/player-tuning.mjs bufferArgs); live keeps its own.
  if (!live) args.push(...bufferArgs({ mib: bufferMiB, local }));
  if (live) {
    // Broadcast sources stall rather than end. Buffer ahead and reconnect
    // instead of tearing the window down on the first hiccup.
    const seconds = Math.max(
      0,
      Math.min(30, Number(settings.liveBufferSeconds) || 4),
    );
    args.push(
      "--cache=yes",
      `--cache-secs=${seconds}`,
      `--demuxer-readahead-secs=${seconds}`,
      "--stream-lavf-o=reconnect=1,reconnect_streamed=1,reconnect_delay_max=5",
      "--keep-open=yes",
    );
  }
  // The last viewing's MPV log, for the diagnostic (its lines are filtered
  // and sanitized before they enter a report).
  if (logFile) args.push(`--log-file=${logFile}`);
  if (separate)
    // True HDR in MPV's own window (core/player-tuning.mjs HDR_MODES):
    // full screen and on top, with MPV's controller and pointer hiding,
    // since Riwaq's HUD cannot sit over another program's window.
    args.push(
      "--fullscreen=yes",
      "--ontop=yes",
      "--cursor-autohide=1000",
      "--script-opts=osc-visibility=auto,osc-layout=bottombar,osc-windowcontrols=no,osc-hidetimeout=1800,osc-idlescreen=no",
    );
  else if (host) args.push(`--wid=${host}`);
  if (inputConf) args.push(`--input-conf=${inputConf}`);
  const entries = Object.entries(headers).filter(
    ([k, v]) =>
      /^[\w-]+$/.test(k) && typeof v === "string" && !/[\r\n]/.test(v),
  );
  if (entries.length)
    args.push(
      "--http-header-fields=" +
        entries
          .map(([k, v]) =>
            `${k}: ${v}`.replace(/\\/g, "\\\\").replace(/,/g, "\\,"),
          )
          .join(","),
    );
  if (!deferLoad) args.push("--", url);
  return args;
}

/**
 * The compatibility mode a viewing falls back to when no picture appears,
 * in two steps: first the older renderer without the optional picture
 * features, then decoding on the processor as well. Dolby Vision keeps
 * gpu-next, the only renderer that reads its colours correctly.
 */
export function safeVideo(stage = 2, { dolbyVision = false } = {}) {
  const settings = {
    renderer: dolbyVision ? "gpu-next" : "gpu",
    videoQuality: "balanced",
    simpleColor: false,
    displayPanel: "auto",
    rtxUpscale: false,
    rtxHdr: false,
    hdr: false,
    hdrMode: "tonemap",
    shader: "none",
    shaderPath: "",
    toneMapping: "off",
  };
  if (stage >= 2)
    Object.assign(settings, { hwdec: "off", hardwareDecoding: false });
  return settings;
}
export const SAFE_VIDEO = safeVideo(2);

/** A viewing whose position has not moved for this long is stuck. */
export const STALL_MS = 15000;
/** Waiting on the network counts as stuck only after this long. */
export const BUFFER_STALL_MS = 30000;
/** A connection that never finishes loading must not wait forever. */
export const STARTUP_STALL_MS = 60000;
/** How long MPV may take to answer the command that hands it the source. */
export const LOAD_REPLY_MS = 20000;

/** How often a change of position alone reaches the interface. */
export const POSITION_MS = 250;

const PROPERTIES = [
  ["time-pos", "position"],
  ["duration", "duration"],
  ["pause", "pause"],
  ["volume", "volume"],
  ["mute", "muted"],
  ["track-list", "tracks"],
  ["chapter-list", "chapters"],
  ["core-idle", "loading"],
  ["speed", "speed"],
  ["brightness", "brightness"],
  ["contrast", "contrast"],
  ["saturation", "saturation"],
  ["gamma", "gamma"],
  ["video-aspect-override", "aspect"],
  ["sub-delay", "subtitleDelay"],
  ["sub-font-size", "subtitleSize"],
  ["sub-visibility", "subtitleVisible"],
  ["audio-delay", "audioDelay"],
  ["video-zoom", "zoom"],
  ["secondary-sid", "secondarySid"],
  ["sub-pos", "subtitlePosition"],
  ["video-pan-x", "panX"],
  ["video-pan-y", "panY"],
  ["video-params/w", "width"],
  ["video-params/h", "height"],
  ["container-fps", "fps"],
  ["video-bitrate", "videoBitrate"],
  ["hwdec-current", "decoder"],
  ["cache-buffering-state", "buffering"],
  ["demuxer-cache-time", "bufferedUntil"],
  ["video-params/gamma", "transfer"],
  ["vo-configured", "voConfigured"],
  ["paused-for-cache", "cachePaused"],
  // The picture as the video output shows it, after filters: absent when
  // MPV has no picture on screen.
  ["video-out-params/w", "outWidth"],
  // Frames leaving the filter chain each second: absent when none reach
  // the output, though the sound and the clock carry on.
  ["estimated-vf-fps", "vfFps"],
];
// Properties whose absence is itself the news: an unavailable value is
// recorded as null instead of keeping the last one seen.
const NULLABLE = new Set(["video-out-params/w", "estimated-vf-fps"]);
const THROTTLED = new Set(["time-pos", "estimated-vf-fps"]);

export class Player {
  constructor({
    onState,
    onProgress,
    onEnded,
    onEvent,
    host,
    inputConf,
    onFullscreen,
    onEscape,
    settingsNow,
    skipPrefs,
    displayHeight,
    spawnProcess = spawn,
    connectSocket = (pipe) => net.createConnection(pipe),
  }) {
    this.spawnProcess = spawnProcess;
    this.connectSocket = connectSocket;
    // Corrections to MPV's window inside the surface (core/surface.mjs).
    this.surfaceWatch = new SurfaceWatch();
    this.host = host;
    // The display's height in pixels, for RTX upscaling's factor.
    this.displayHeight = displayHeight;
    this.pending = new Map();
    this.requestId = 0;
    // "End after N episodes" outlives one file: autoplay starts the next.
    this.sleepEpisodes = 0;
    this.skipPrefs = skipPrefs;
    // The viewer's settings as they are now; seek keys read the step here.
    this.settingsNow = settingsNow;
    this.inputConf = inputConf;
    this.onFullscreen = onFullscreen;
    this.onEscape = onEscape;
    this.fullscreen = false;
    this.externalSubs = new Map();
    this.onState = onState;
    this.onProgress = onProgress;
    this.onEnded = onEnded;
    this.onEvent = onEvent || (() => {});
    this.state = { active: false };
    this.sleepTimer = null;
  }
  async start({
    executable,
    settings,
    url,
    meta,
    videoId,
    start = 0,
    headers = {},
    local = false,
    live = false,
    inputConf = "",
    screenshotDir = "",
    logFile = "",
    safe = false,
    separate = false,
    bufferMiB = 512,
    tags = [],
  }) {
    if (!local) webUrl(url);
    // A new viewing starts its fallbacks afresh: the compatibility steps
    // after a missing picture, and the reconnect after a stall.
    if (!safe) {
      this.safeStage = 0;
      this.stallRetries = 0;
    }
    this.surfaceWatch.reset({ keepRestart: !!safe });
    if (!existsSync(executable))
      throw new Error("لم يتم العثور على MPV. اختر ملف mpv.exe من الإعدادات.");
    // Starts are serialized: two plays close together (a double click, a
    // pick while failover or autoplay starts one) both wait on the same old
    // MPV, and only the newest may spawn, or the older one would keep
    // playing into the surface with nothing owning it.
    const token = (this.startToken = (this.startToken || 0) + 1);
    await this.stop({ cancelStart: false });
    if (token !== this.startToken) throw new Error("بدأ تشغيل مصدر آخر");
    // Kept in main only, for seek previews; never part of the HUD's state.
    this.source = { url, headers, local, live };
    // Everything this start needed, so a viewing whose picture never came up
    // can start again in the compatibility mode (restartSafe).
    this.lastStart = {
      executable,
      settings,
      url,
      meta,
      videoId,
      headers,
      local,
      live,
      inputConf,
      screenshotDir,
      logFile,
      separate,
      bufferMiB,
      tags,
    };
    this.stopWatchdog();
    this.meta = meta;
    this.videoId = videoId;
    this.settings = settings;
    // Live preferences must never re-enable RTX during a compatibility retry.
    this.compatibility = !!safe && (this.safeStage || 0) > 0;
    this.lastSaved = 0;
    this.externalSubs = new Map();
    this.rawTracks = [];
    this.cursorHidden = false;
    this.pendingSecondary = null;
    this.rtxApplied = "";
    this.rtxAdded = false;
    this.onlineSegments = [];
    // What MPV started with, so a later settings change sends only changes.
    this.tuningSent = new Map(
      liveTuning(settings).map(([name, value]) => [name, String(value)]),
    );
    const pipe = `\\\\.\\pipe\\riwaq-${randomUUID()}`;
    this.state = {
      active: true,
      loading: true,
      name: meta.name,
      videoId,
      mediaType: meta.type,
      // The interface needs the title identity to work out the next episode.
      meta: {
        id: meta.id,
        type: meta.type,
        name: meta.name,
        poster: meta.poster,
      },
      position: start,
      duration: 0,
      pause: false,
      volume: 100,
      tracks: [],
      chapters: [],
      segments: [],
      skip: null,
      pip: false,
      fullscreen: this.fullscreen,
      overlay: !!this.overlay,
      fill: !!settings.videoFill,
      live,
      abLoop: null,
      sleepAt: null,
      sleepEpisodes: this.sleepEpisodes,
      rtx: null,
      volumeMax: volumeMax(settings),
      separate: !!separate,
      // Words from the source's label (core/player-tuning.mjs sourceTags).
      sourceTags: Array.isArray(tags)
        ? tags.filter((t) => typeof t === "string").slice(0, 6)
        : [],
      stats: false,
      compatibilityStage: this.compatibility ? this.safeStage : 0,
      shader: settings.shader || "none",
    };
    // MPV creates its window at the surface's size of the moment: give the
    // hidden surface its size first, so that window never starts at 1×1.
    if (!separate) this.host?.prepare?.();
    const child = this.spawnProcess(
      executable,
      playerArgs({
        pipe,
        settings,
        url,
        title: `${meta.name} · Riwaq`,
        start,
        headers,
        host: this.host?.handle?.toString(),
        inputConf: inputConf || this.inputConf,
        live,
        screenshotDir,
        logFile,
        separate,
        local,
        bufferMiB,
        deferLoad: true,
      }),
      // MPV is a GUI process. SW_HIDE can also hide its child video window;
      // the host owns visibility of embedded playback.
      { windowsHide: false, stdio: "ignore", shell: false },
    );
    this.child = child;
    let processError = false;
    let connected = false;
    child.on("error", () => {
      // After the pipe is up, an error (a failed kill) is not a failed start.
      if (connected || this.child !== child) return;
      processError = true;
      // A process that never started never exits: let it go, so the next
      // play does not wait out the stop timeout on it.
      this.child = null;
      this.state = { ...this.state, active: false, error: "تعذّر تشغيل MPV" };
      this.onState(this.state);
    });
    child.once("exit", () => {
      if (this.child !== child) return;
      this.save();
      this.child = null;
      this.disconnect();
      this.clearSleep();
      this.stopWatchdog();
      this.state = { ...this.state, active: false };
      this.host?.hide();
      this.onState(this.state);
    });
    this.onState(this.state);
    await new Promise((resolve, reject) => {
      let attempts = 0;
      const connect = () => {
        if (
          processError ||
          this.child !== child ||
          token !== this.startToken ||
          attempts++ > 60
        ) {
          // MPV may still be opening the stream: without its pipe nothing can
          // pause or stop it, so it must not be left playing. Its exit
          // handler marks the viewing inactive.
          if (this.child === child && !processError) child.kill();
          reject(new Error("تعذّر الاتصال بالمشغل"));
          return;
        }
        const socket = this.connectSocket(pipe);
        socket.once("error", () => {
          socket.destroy();
          setTimeout(connect, 100);
        });
        socket.once("connect", () => {
          if (this.child !== child || token !== this.startToken) {
            socket.destroy();
            // Nothing will ever own this MPV: it goes now, instead of the
            // newer start or stop waiting out the quit timeout on it.
            if (this.child === child) child.kill();
            reject(new Error("بدأ تشغيل مصدر آخر"));
            return;
          }
          connected = true;
          socket.removeAllListeners("error");
          socket.on("error", () => {});
          this.socket = socket;
          this.attach(socket);
          resolve();
        });
      };
      connect();
    });
    if (token !== this.startToken || this.child !== child)
      throw new Error("بدأ تشغيل مصدر آخر");
    // Subscribe before loading: local/cached files can finish loading before
    // the IPC pipe opens, and file-loaded is not replayed for late clients.
    this.startWatchdog();
    // MPV answers only after creating its window and graphics device, which
    // a waking or busy GPU can stretch past the usual reply time.
    const loaded = await this.request(["loadfile", url], LOAD_REPLY_MS);
    if (token !== this.startToken || this.child !== child)
      throw new Error("بدأ تشغيل مصدر آخر");
    if (!loaded) {
      await this.stop();
      throw new Error("تعذّر إرسال المصدر إلى MPV");
    }
    if (Number(settings.sleepTimer) > 0)
      this.setSleep(Number(settings.sleepTimer));
    return this.state;
  }
  attach(socket) {
    let buffer = "";
    socket.on("data", (chunk) => {
      if (this.socket !== socket) return;
      buffer += chunk.toString();
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        if (this.socket !== socket) break;
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        try {
          this.event(JSON.parse(line));
        } catch {
          /* Ignore malformed IPC events. */
        }
      }
    });
    PROPERTIES.forEach(([name], id) =>
      this.send(["observe_property", id + 1, name]),
    );
  }
  /**
   * Tracks for the interface. An addon subtitle is recognised by the file MPV
   * loaded and reported by its opaque key; the URL itself never leaves here.
   */
  mapTracks(list) {
    const tracks = list.map((t) => ({
      id: t.id,
      type: t.type,
      lang: t.lang,
      selected: !!t.selected,
      secondary: t["main-selection"] === 1,
      codec: t.codec,
      forced: !!t.forced,
      default: !!t.default,
      hearingImpaired: !!t["hearing-impaired"],
      external: !!t.external,
      // Cover art and still images are video tracks without a picture to
      // play; the picture check ignores them.
      image: !!(t.image || t.albumart),
      channels: t["demux-channel-count"] || undefined,
      addonKey: t["external-filename"]
        ? this.externalSubs.get(t["external-filename"])?.key
        : undefined,
      title:
        typeof t.title === "string" && !/https?:\/\//i.test(t.title)
          ? t.title.slice(0, 160)
          : undefined,
    }));
    // A subtitle added as the second line becomes secondary once MPV has it.
    if (this.pendingSecondary) {
      const found = list.find(
        (t) => t["external-filename"] === this.pendingSecondary,
      );
      if (found) {
        this.pendingSecondary = null;
        this.send(["set_property", "secondary-sid", found.id]);
      }
    }
    return tracks;
  }
  /**
   * Loads an addon subtitle, or selects it if it is already loaded, as the
   * main or the secondary line.
   */
  addSubtitle(url, { key, label = "", lang = "", secondary = false } = {}) {
    const loaded = (this.rawTracks || []).find(
      (t) => t.type === "sub" && t["external-filename"] === url,
    );
    this.externalSubs.set(url, { key });
    if (loaded) {
      this.send([
        "set_property",
        secondary ? "secondary-sid" : "sid",
        loaded.id,
      ]);
      return;
    }
    if (secondary) this.pendingSecondary = url;
    this.send([
      "sub-add",
      url,
      secondary ? "auto" : "select",
      String(label || "").slice(0, 120),
      String(lang || "").slice(0, 12),
    ]);
  }
  /**
   * Hides the pointer over the picture after it has been still, and shows it
   * again on the first movement. Only changes are sent to MPV.
   */
  setCursorHidden(hidden) {
    if (!this.state.active || this.cursorHidden === !!hidden) return;
    this.cursorHidden = !!hidden;
    this.send([
      "set_property",
      "cursor-autohide",
      this.cursorHidden ? "always" : "no",
    ]);
  }
  /** Whether the HUD draws the controls; the theater layout follows it. */
  setOverlay(on) {
    this.overlay = !!on;
    if (!this.state.active || this.state.overlay === this.overlay) return;
    this.state.overlay = this.overlay;
    this.applyController();
    this.onState(this.state);
  }
  /** Main reports the window's full screen state; the controller follows it. */
  setFullscreen(on) {
    this.fullscreen = !!on;
    if (!this.state.active || this.state.fullscreen === this.fullscreen) return;
    this.state.fullscreen = this.fullscreen;
    this.applyController();
    if (this.fullscreen && !this.state.pip)
      this.send(["show-text", "Esc للخروج من ملء الشاشة", 2500]);
    this.onState(this.state);
  }
  applyController() {
    this.send([
      "script-message",
      "osc-visibility",
      this.state.separate ||
      (this.state.fullscreen && !this.state.pip && !this.state.overlay)
        ? "auto"
        : "never",
      "no-osd",
    ]);
  }
  message(name, arg) {
    if (name === "riwaq-seek") {
      const seconds = seekAmount(
        arg,
        this.settingsNow?.() || this.settings || {},
      );
      if (seconds && this.state.active)
        this.send(["seek", seconds, "relative"]);
    } else if (name === "riwaq-fullscreen")
      // MPV's own HDR window toggles its own full screen.
      this.state.separate
        ? this.send(["cycle", "fullscreen"])
        : this.onFullscreen?.();
    // Escape leaves full screen before it closes anything.
    else if (name === "riwaq-stop")
      this.state.fullscreen && this.onEscape ? this.onEscape() : this.stop();
    else if (name === "riwaq-screenshot")
      this.command({ action: "screenshot" });
    else if (name === "riwaq-stats") this.command({ action: "stats" });
    else if (name === "riwaq-skip") this.command({ action: "skipSegment" });
    else if (name === "riwaq-loop") this.command({ action: "abLoop" });
    else if (name === "riwaq-shader") this.command({ action: "cycleShader" });
    else if (name === "riwaq-mini") this.command({ action: "pip" });
    else if (name === "riwaq-panel") this.onEvent({ type: "panel" });
    else if (name === "riwaq-next" || name === "riwaq-prev")
      this.onEvent({ type: name === "riwaq-next" ? "next" : "previous" });
  }
  /**
   * MPV reports the position on every frame. Sending each one redrew the
   * whole interface and the HUD up to sixty times a second, so a change of
   * position alone goes out at most every POSITION_MS; any other change goes
   * out at once and carries the latest position with it.
   */
  publish(positionOnly = false) {
    const now = Date.now();
    if (!positionOnly) {
      clearTimeout(this.publishTimer);
      this.publishTimer = null;
      this.lastPublish = now;
      this.onState(this.state);
      return;
    }
    if (this.publishTimer) return;
    const wait = POSITION_MS - (now - (this.lastPublish || 0));
    if (wait <= 0) {
      this.lastPublish = now;
      this.onState(this.state);
      return;
    }
    this.publishTimer = setTimeout(() => {
      this.publishTimer = null;
      this.lastPublish = Date.now();
      if (this.state.active) this.onState(this.state);
    }, wait);
  }
  event(event) {
    if (event.request_id && this.pending.has(event.request_id)) {
      const done = this.pending.get(event.request_id);
      this.pending.delete(event.request_id);
      done(event.error === "success");
      return;
    }
    if (event.event === "client-message" && typeof event.args?.[0] === "string")
      this.message(event.args[0], event.args[1]);
    if (event.event === "property-change") {
      if (event.name === "track-list") this.rawTracks = event.data || [];
      const mapping = PROPERTIES.find(([name]) => name === event.name);
      if (mapping && event.data === undefined && NULLABLE.has(event.name))
        this.state[mapping[1]] = null;
      else if (mapping && event.data !== undefined) {
        this.state[mapping[1]] =
          event.name === "track-list"
            ? this.mapTracks(event.data || [])
            : event.name === "chapter-list"
              ? (event.data || []).map(({ time, title }) => ({
                  time,
                  title: typeof title === "string" ? title.slice(0, 120) : "",
                }))
              : event.data;
      }
      if (event.name === "chapter-list" || event.name === "duration")
        this.refreshSegments();
      if (event.name === "time-pos") this.refreshSkip();
      if (
        ["hwdec-current", "video-params/h", "video-params/gamma"].includes(
          event.name,
        )
      )
        this.refreshRtx();
      if (Date.now() - this.lastSaved > 5000) this.save();
      if (event.name === "video-aspect-override") {
        const n = Number(event.data);
        this.state.aspect =
          Math.abs(n - 16 / 9) < 0.001
            ? "16:9"
            : Math.abs(n - 4 / 3) < 0.001
              ? "4:3"
              : Math.abs(n - 2.35) < 0.001
                ? "2.35:1"
                : "-1";
      }
      if (event.name === "core-idle") this.coreIdle = event.data;
      // MPV's window is ready for the picture: make sure it fills the surface.
      if (event.name === "vo-configured" && event.data) this.syncSurface();
      if (event.name === "core-idle" || event.name === "pause")
        this.state.loading = !!this.coreIdle && !this.state.pause;
      // The position and the frame rate change every frame: throttled.
      this.publish(THROTTLED.has(event.name));
    }
    if (event.event === "file-loaded") {
      // The controller script may not have been listening when full screen
      // began, so its visibility is stated again once the file is up.
      this.applyController();
      this.state.loading = false;
      this.state.error = null;
      this.onLoaded?.({ meta: this.meta, videoId: this.videoId });
      this.refreshSegments();
      this.onState(this.state);
      this.watchVideo();
      this.fileLoaded = true;
      this.syncSurface();
    }
    // A playlist hands over to its first entry with reason "redirect": the
    // viewing goes on, and that entry's file-loaded follows.
    if (event.event === "end-file" && event.reason !== "redirect") {
      this.stopWatchdog();
      this.fileLoaded = false;
      this.save();
      if (event.reason === "error") {
        this.state.error = "تعذّر تشغيل هذا المصدر. جرّب مصدراً آخر.";
        this.onState(this.state);
      }
      if (event.reason === "eof") {
        // "End after N episodes": this one counts, and the last one stops
        // autoplay from starting another.
        let sleep = false;
        if (this.sleepEpisodes > 0) {
          this.sleepEpisodes--;
          this.state.sleepEpisodes = this.sleepEpisodes;
          sleep = this.sleepEpisodes === 0;
        }
        this.onEnded({ meta: this.meta, videoId: this.videoId, sleep });
        this.send(["quit"]);
      }
    }
  }
  refreshSegments() {
    if (this.state.live) return;
    this.state.segments = mergeSegments(
      detectSegments({
        chapters: this.state.chapters,
        duration: this.state.duration,
      }),
      this.onlineSegments || [],
    );
    this.refreshSkip();
  }
  refreshSkip() {
    // Runs on every position update: with no segments there is nothing to
    // work out (and no preferences to read).
    if (!this.state.segments?.length) {
      if (this.state.skip) {
        this.state.skip = null;
        this.onState(this.state);
      }
      this.autoSkipped = null;
      return;
    }
    // Main's live preferences (a series excluded from skipping, a changed
    // setting) when it supplies them, else those the viewing started with.
    const prefs = this.skipPrefs?.() || this.settings || {};
    const next = activeSegment(this.state.segments, this.state.position, prefs);
    const was = this.state.skip;
    const changed = JSON.stringify(next) !== JSON.stringify(was);
    this.state.skip = next;
    if (changed) this.onState(this.state);
    const segment = next ? `${next.kind}:${next.start}:${next.end}` : null;
    // One seek per entry into a segment: MPV keeps reporting the old
    // position until the seek lands, and a source that cannot seek would
    // otherwise get a seek on every frame. Leaving the segment re-arms it.
    if (!segment) this.autoSkipped = null;
    if (
      next &&
      segment !== this.autoSkipped &&
      this.state.abLoop === null &&
      ["intro", "outro", "recap"].includes(next.kind) &&
      skipMode(prefs, next.kind) === "auto"
    ) {
      this.autoSkipped = segment;
      this.send(["seek", next.end, "absolute"]);
    }
  }
  /**
   * A settings change during a viewing: everything MPV can take live
   * (core/player-tuning.mjs). The rest applies to the next viewing.
   */
  applyTuning(settings) {
    if (!this.state.active) return;
    // Re-sending an unchanged filter or device would rebuild MPV's audio and
    // drop a moment of sound, so only changes go out.
    this.tuningSent ||= new Map();
    for (const [name, value] of liveTuning(settings)) {
      if (this.tuningSent.get(name) === String(value)) continue;
      this.tuningSent.set(name, String(value));
      this.send(["set_property", name, value]);
    }
    this.state.volumeMax = volumeMax(settings);
    this.refreshRtx();
    this.onState(this.state);
  }
  /**
   * Whether the viewing shows a picture: null for a file without a moving
   * picture (sound, cover art), true when MPV's output is configured and
   * reports the displayed size, false otherwise.
   */
  hasPicture(state = this.state) {
    const video = (state.tracks || []).some(
      (t) => t.type === "video" && !t.image,
    );
    if (!video) return null;
    return (
      !!state.voConfigured &&
      Number(state.outWidth) > 0 &&
      // Not yet reported (undefined) is not a failure; reported absent is.
      (state.vfFps === undefined || Number(state.vfFps) > 0)
    );
  }
  /**
   * Sound without a picture, checked by the watchdog from the moment the
   * file loads and throughout the viewing: a file with a video track whose
   * output shows nothing for six seconds is reported once (main restarts it
   * in the compatibility mode). Kept as a name for the first check.
   */
  watchVideo() {
    this.noPictureSince = null;
    this.pictureReported = false;
  }
  checkPicture(now = Date.now()) {
    if (!this.fileLoaded || this.pictureReported || this.state.live) return;
    // Paused or waiting on the network, no frames are expected.
    const waiting =
      this.state.pause || this.state.cachePaused || this.state.loading;
    if (waiting || this.hasPicture() !== false) {
      this.noPictureSince = null;
      return;
    }
    if (this.noPictureSince == null) this.noPictureSince = now;
    else if (now - this.noPictureSince >= 6000) {
      this.pictureReported = true;
      this.onVideoFailed?.({ videoId: this.videoId });
    }
  }
  /**
   * Starts the same viewing again from where it is, with the picture in its
   * most compatible form: the older renderer, decoding on the processor, and
   * none of the optional picture features.
   */
  restartSafe(stage = 2) {
    if (!this.lastStart || !this.state.active) return null;
    const dolbyVision = (this.lastStart.tags || []).includes("Dolby Vision");
    this.safeStage = stage;
    return this.start({
      ...this.lastStart,
      start: Math.max(0, Number(this.state.position) || 0),
      settings: {
        ...this.lastStart.settings,
        ...safeVideo(stage, { dolbyVision }),
      },
      safe: true,
      separate: false,
    });
  }
  /** The same viewing again from where it is, as it was (after a stall). */
  restartSame() {
    if (!this.lastStart || !this.state.active) return null;
    return this.start({
      ...this.lastStart,
      start: Math.max(0, Number(this.state.position) || 0),
      safe: true,
    });
  }
  /**
   * The watchdog: a playing (not paused) viewing whose position has not
   * moved for STALL_MS, or BUFFER_STALL_MS while MPV waits on the network,
   * is reported once until it moves again. Main reconnects, then moves to
   * the next source.
   */
  startWatchdog() {
    this.stopWatchdog();
    this.fileLoaded = false;
    this.lastMove = Date.now();
    this.lastPos = null;
    this.stallReported = false;
    this.noPictureSince = null;
    this.pictureReported = false;
    this.watchdog = setInterval(() => this.checkStall(), 2000);
    this.watchdog.unref?.();
  }
  stopWatchdog() {
    clearInterval(this.watchdog);
    this.watchdog = null;
  }
  /**
   * Keeps MPV's window at the surface's size and shown (electron/video-host.mjs
   * syncChild). A window that needs correcting on several checks in a row is
   * not taking it, and the viewing restarts once with the same settings: the
   * surface has its size by then, so MPV's new window starts right.
   */
  syncSurface() {
    if (!this.state.active || this.state.separate) return;
    const fixed = this.host?.syncChild?.() || null;
    if (fixed) this.onSurfaceFixed?.(fixed);
    if (this.surfaceWatch.note(!!fixed) === "restart") {
      this.onSurfaceFixed?.({ ...fixed, restart: true });
      this.restartSame()?.catch(() => {});
    }
  }
  checkStall(now = Date.now()) {
    const state = this.state;
    if (!state.active) return;
    this.syncSurface();
    // A restart may have synchronously stopped this viewing.
    if (this.state !== state || !state.active) return;
    this.checkPicture(now);
    // A picture recovery may have synchronously stopped this viewing.
    if (this.state !== state || !state.active) return;
    const position = Number(state.position) || 0;
    if (!this.fileLoaded && !state.pause) {
      if (!this.stallReported && now - this.lastMove >= STARTUP_STALL_MS) {
        this.stallReported = true;
        this.onStall?.({
          videoId: this.videoId,
          buffering: true,
          position,
          startup: true,
        });
      }
      return;
    }
    if (state.pause || position !== this.lastPos) {
      this.lastPos = position;
      this.lastMove = now;
      if (!state.pause) this.stallReported = false;
      return;
    }
    const limit = state.cachePaused ? BUFFER_STALL_MS : STALL_MS;
    if (this.stallReported || now - this.lastMove < limit) return;
    this.stallReported = true;
    this.onStall?.({
      videoId: this.videoId,
      buffering: !!state.cachePaused,
      position,
    });
  }
  /** Segments from AniSkip for this viewing (core/skip-online.mjs). */
  setOnlineSegments(videoId, segments) {
    if (!this.state.active || this.videoId !== videoId) return;
    this.onlineSegments = Array.isArray(segments) ? segments : [];
    this.refreshSegments();
    this.onState(this.state);
  }
  /** Sends a command and resolves with whether MPV accepted it. */
  request(command, timeout = 3000) {
    if (!this.socket?.writable) return Promise.resolve(false);
    const id = ++this.requestId;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(false);
      }, timeout);
      this.pending.set(id, (ok) => {
        clearTimeout(timer);
        resolve(ok);
      });
      this.socket.write(JSON.stringify({ command, request_id: id }) + "\n");
    });
  }
  /**
   * NVIDIA RTX Video (core/player-tuning.mjs): set once the decoder, the
   * picture height and its transfer are known, and again when they or the
   * settings change. Each candidate filter is tried until MPV accepts one;
   * MPV keeps the old chain when one cannot start.
   */
  refreshRtx() {
    const viewing = this.state;
    this.rtxRevision = (this.rtxRevision || 0) + 1;
    if (this.rtxJob?.viewing === viewing) return this.rtxJob.promise;
    const job = { viewing };
    this.rtxJob = job;
    job.promise = (async () => {
      let revision;
      do {
        revision = this.rtxRevision;
        await this.applyRtx();
      } while (
        this.state === viewing &&
        viewing.active &&
        revision !== this.rtxRevision
      );
    })().finally(() => {
      if (this.rtxJob === job) this.rtxJob = null;
    });
    return job.promise;
  }
  async applyRtx() {
    if (!this.state.active || this.state.live) return;
    const settings = this.compatibility
      ? this.settings || {}
      : this.settingsNow?.() || this.settings || {};
    const candidates = rtxFilters(settings, {
      decoder: this.state.decoder,
      height: this.state.height,
      transfer: this.state.transfer,
      separate: this.state.separate,
      displayHeight: this.displayHeight?.() || 0,
    });
    const wanted = JSON.stringify(candidates);
    if (wanted === this.rtxApplied) return;
    this.rtxApplied = wanted;
    const viewing = this.state;
    // MPV's video filter chain is touched only for RTX: a filter command on
    // a viewing that never asked for one can rebuild the chain and lose the
    // picture on some builds (the 0.37 report).
    if (!candidates.length && !this.rtxAdded) return;
    if (this.rtxAdded) {
      const removed = await this.request(["vf", "remove", "@riwaqrtx"]);
      if (this.state !== viewing) return;
      if (!removed) return;
      this.rtxAdded = false;
    }
    let status = null;
    if (candidates.length) {
      status = "unavailable";
      for (const filter of candidates) {
        if (this.state !== viewing || this.rtxApplied !== wanted) return;
        const added = await this.request(["vf", "add", filter]);
        if (this.state !== viewing) return;
        if (added) {
          this.rtxAdded = true;
          status = filter.includes("nvidia-true-hdr")
            ? filter.includes("scaling-mode")
              ? "upscale+hdr"
              : "hdr"
            : "upscale";
          break;
        }
      }
    }
    if (this.state !== viewing || this.rtxApplied !== wanted) return;
    if (this.state.rtx !== status) {
      this.state.rtx = status;
      this.onState(this.state);
    }
  }
  setSleep(minutes) {
    this.clearSleep();
    const ms = Math.max(1, Math.min(240, Math.round(minutes))) * 60000;
    this.state.sleepAt = Date.now() + ms;
    this.sleepTimer = setTimeout(() => {
      this.state.sleepAt = null;
      this.stop();
    }, ms);
  }
  /** Stop after this many episodes end (0 cancels), at most five. */
  setSleepEpisodes(count) {
    const n = Number.isInteger(count) ? Math.max(0, Math.min(5, count)) : 0;
    this.sleepEpisodes = n;
    this.state.sleepEpisodes = n;
  }
  clearSleep() {
    clearTimeout(this.sleepTimer);
    this.sleepTimer = null;
    this.state.sleepAt = null;
  }
  save() {
    if (this.state.live) return;
    if (this.meta && Number.isFinite(this.state.position)) {
      this.onProgress(
        this.meta,
        this.videoId,
        this.state.position,
        this.state.duration,
      );
      this.lastSaved = Date.now();
    }
  }
  send(command) {
    if (this.socket?.writable)
      this.socket.write(JSON.stringify({ command }) + "\n");
  }
  command({ action, value }) {
    if (!this.state.active) throw new Error("لا توجد مشاهدة حالية");
    if (action === "repairVideo")
      return this.restartSafe(Math.min(2, (this.safeStage || 0) + 1));
    const number = Number(value);
    if (action === "pause") this.send(["cycle", "pause"]);
    else if (action === "seek" && Number.isFinite(number))
      this.send(["seek", Math.max(0, number), "absolute"]);
    else if (action === "seekBy" && Number.isFinite(number))
      this.send(["seek", Math.max(-600, Math.min(600, number)), "relative"]);
    else if (action === "volume" && Number.isFinite(number))
      this.send([
        "set_property",
        "volume",
        Math.max(
          0,
          Math.min(
            volumeMax(this.settingsNow?.() || this.settings || {}),
            number,
          ),
        ),
      ]);
    else if (action === "mute") this.send(["cycle", "mute"]);
    else if (action === "fullscreen") this.onFullscreen?.();
    else if (action === "exitFullscreen") this.onEscape?.();
    else if (action === "fill") {
      this.state.fill = value === true;
      this.send(["set_property", "panscan", this.state.fill ? 1 : 0]);
    } else if (action === "pip") {
      this.state.pip = !this.state.pip;
      this.applyController();
      // The mini player remains embedded while browsing the app.
    } else if (action === "subtitleDelay" && Number.isFinite(number))
      this.send([
        "set_property",
        "sub-delay",
        Math.max(-60, Math.min(60, number)),
      ]);
    else if (action === "subtitleSize" && Number.isFinite(number))
      this.send([
        "set_property",
        "sub-font-size",
        Math.max(18, Math.min(80, number)),
      ]);
    else if (action === "subtitlePosition" && Number.isFinite(number))
      this.send([
        "set_property",
        "sub-pos",
        Math.max(0, Math.min(150, number)),
      ]);
    else if (action === "subtitleStyle" && value && typeof value === "object")
      for (const [name, v] of styleProperties(value))
        this.send(["set_property", name, v]);
    else if (action === "subtitleVisible")
      this.send(["set_property", "sub-visibility", value !== false]);
    else if (action === "audioDelay" && Number.isFinite(number))
      this.send([
        "set_property",
        "audio-delay",
        Math.max(-30, Math.min(30, number)),
      ]);
    else if (
      ["brightness", "contrast", "saturation", "gamma"].includes(action) &&
      Number.isFinite(number)
    )
      this.send([
        "set_property",
        action,
        Math.max(-100, Math.min(100, number)),
      ]);
    else if (action === "speed" && Number.isFinite(number))
      this.send(["set_property", "speed", Math.max(0.25, Math.min(4, number))]);
    else if (action === "zoom" && Number.isFinite(number))
      this.send([
        "set_property",
        "video-zoom",
        Math.max(-1, Math.min(1.5, number)),
      ]);
    else if (action === "pan" && value && Number.isFinite(Number(value.x))) {
      this.send([
        "set_property",
        "video-pan-x",
        Math.max(-1, Math.min(1, Number(value.x))),
      ]);
      this.send([
        "set_property",
        "video-pan-y",
        Math.max(-1, Math.min(1, Number(value.y) || 0)),
      ]);
    } else if (
      action === "aspect" &&
      ["-1", "16:9", "4:3", "2.35:1", "1.85:1"].includes(value)
    )
      this.send(["set_property", "video-aspect-override", value]);
    else if (
      ["sid", "aid"].includes(action) &&
      (value === "no" || Number.isInteger(value))
    )
      this.send(["set_property", action, value]);
    else if (
      action === "secondarySubtitle" &&
      (value === "no" || Number.isInteger(value))
    )
      this.send(["set_property", "secondary-sid", value]);
    else if (action === "chapter" && Number.isFinite(number))
      this.send(["add", "chapter", number > 0 ? 1 : -1]);
    else if (action === "skipSegment") {
      if (this.state.skip) this.send(["seek", this.state.skip.end, "absolute"]);
    } else if (action === "screenshot") this.send(["screenshot", "video"]);
    else if (action === "stats") {
      this.state.stats = value === undefined ? !this.state.stats : !!value;
    } else if (action === "shader") {
      const profile = PICTURE_PROFILES[value] ? value : "none";
      this.state.shader = profile;
      this.applyShader(profile);
    } else if (action === "cycleShader") {
      const names = Object.keys(PICTURE_PROFILES);
      const next = names[(names.indexOf(this.state.shader) + 1) % names.length];
      this.state.shader = next;
      this.applyShader(next);
    } else if (action === "abLoop") {
      this.toggleLoop(Number.isFinite(number) ? number : this.state.position);
    } else if (action === "clearLoop") {
      this.state.abLoop = null;
      this.send(["set_property", "ab-loop-a", "no"]);
      this.send(["set_property", "ab-loop-b", "no"]);
    } else if (action === "sleep") {
      if (Number.isFinite(number) && number > 0) this.setSleep(number);
      else this.clearSleep();
      this.setSleepEpisodes(0);
    } else if (action === "sleepEpisodes") {
      this.clearSleep();
      this.setSleepEpisodes(number);
    }
    this.onState(this.state);
    return this.state;
  }
  applyShader(profile) {
    // MPV cannot swap a whole profile live, but the pieces that matter can be
    // set one by one on the running instance.
    const settings = {
      none: { scale: "bilinear", deband: "no", "sigmoid-upscaling": "no" },
      sharp: {
        scale: "ewa_lanczossharp",
        deband: "no",
        "sigmoid-upscaling": "no",
      },
      anime: {
        scale: "ewa_lanczossharp",
        deband: "yes",
        "sigmoid-upscaling": "yes",
      },
      film: { scale: "ewa_lanczos", deband: "yes", "sigmoid-upscaling": "no" },
      custom: {},
    }[profile];
    for (const [key, value] of Object.entries(settings || {}))
      this.send(["set_property", key, value]);
  }
  toggleLoop(at) {
    const loop = this.state.abLoop;
    if (!loop) {
      this.state.abLoop = { a: at, b: null };
      this.send(["set_property", "ab-loop-a", at]);
    } else if (loop.b === null) {
      if (at <= loop.a) return;
      this.state.abLoop = { a: loop.a, b: at };
      this.send(["set_property", "ab-loop-b", at]);
    } else {
      this.state.abLoop = null;
      this.send(["set_property", "ab-loop-a", "no"]);
      this.send(["set_property", "ab-loop-b", "no"]);
    }
  }
  subtitle(path, { secondary = false } = {}) {
    // The second line is set once MPV lists the file, by its own track ID
    // (a file with embedded tracks would make any fixed number wrong).
    if (secondary) this.pendingSecondary = path;
    this.send(["sub-add", path, secondary ? "auto" : "select"]);
  }
  disconnect() {
    const socket = this.socket;
    this.socket = null;
    socket?.destroy();
    for (const done of this.pending.values()) done(false);
    this.pending.clear();
  }
  async stop({ cancelStart = true } = {}) {
    if (cancelStart) this.startToken = (this.startToken || 0) + 1;
    const child = this.child;
    this.clearSleep();
    this.stopWatchdog();
    clearTimeout(this.publishTimer);
    this.publishTimer = null;
    if (this.stopping) return this.stopping;
    if (!child) {
      this.disconnect();
      return;
    }
    this.save();
    const socket = this.socket;
    // Retire the viewing before an asynchronous exit: no more recovery or
    // late property events may act on it while Stop is in progress.
    this.state = { ...this.state, active: false, loading: false };
    this.host?.hide();
    this.onState(this.state);
    this.stopping = new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        child.removeListener("exit", finish);
        if (this.child === child) this.child = null;
        if (this.socket === socket) this.disconnect();
        resolve();
      };
      const timer = setTimeout(() => {
        child.kill();
        finish();
      }, 1500);
      child.once("exit", finish);
    });
    this.send(["quit"]);
    this.disconnect();
    try {
      await this.stopping;
    } finally {
      this.stopping = null;
    }
  }
}
