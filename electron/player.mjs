import { styleArgs, styleProperties } from "../core/subtitles.mjs";
import { spawn } from "node:child_process";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { webUrl } from "../core/protocol.mjs";
import { detectSegments, activeSegment } from "../core/skip-segments.mjs";

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
    "--osc=yes",
    "--script-opts=osc-visibility=never,osc-layout=bottombar,osc-windowcontrols=no,osc-hidetimeout=1800",
    "--osd-font=Segoe UI",
    // Main decides when the pointer hides; see setCursorHidden.
    "--cursor-autohide=no",
    "--osd-bar=yes",
    `--title=${title}`,
    `--force-media-title=${title}`,
    "--save-position-on-quit=no",
    `--hwdec=${settings.hardwareDecoding ? "auto-safe" : "no"}`,
    "--vo=gpu-next",
    `--target-colorspace-hint=${settings.hdr ? "yes" : "no"}`,
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
  if (host) args.push(`--wid=${host}`);
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
  args.push("--", url);
  return args;
}

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
];

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
  }) {
    this.host = host;
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
  }) {
    if (!local) webUrl(url);
    if (!existsSync(executable))
      throw new Error("لم يتم العثور على MPV. اختر ملف mpv.exe من الإعدادات.");
    await this.stop();
    // Kept in main only, for seek previews; never part of the HUD's state.
    this.source = { url, headers, local, live };
    this.meta = meta;
    this.videoId = videoId;
    this.settings = settings;
    this.lastSaved = 0;
    this.externalSubs = new Map();
    this.rawTracks = [];
    this.cursorHidden = false;
    this.pendingSecondary = null;
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
      stats: false,
      shader: settings.shader || "none",
    };
    const child = spawn(
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
      }),
      { windowsHide: true, stdio: "ignore", shell: false },
    );
    this.child = child;
    let processError = false;
    child.once("error", () => {
      processError = true;
      this.state = { ...this.state, active: false, error: "تعذّر تشغيل MPV" };
      this.onState(this.state);
    });
    child.once("exit", () => {
      if (this.child !== child) return;
      this.save();
      this.child = null;
      this.socket?.destroy();
      this.clearSleep();
      this.state = { ...this.state, active: false };
      this.host?.hide();
      this.onState(this.state);
    });
    this.onState(this.state);
    await new Promise((resolve, reject) => {
      let attempts = 0;
      const connect = () => {
        if (processError || this.child !== child || attempts++ > 60) {
          reject(new Error("تعذّر الاتصال بالمشغل"));
          return;
        }
        const socket = net.createConnection(pipe);
        socket.once("error", () => {
          socket.destroy();
          setTimeout(connect, 100);
        });
        socket.once("connect", () => {
          socket.removeAllListeners("error");
          socket.on("error", () => {});
          this.socket = socket;
          this.attach(socket);
          resolve();
        });
      };
      connect();
    });
    if (Number(settings.sleepTimer) > 0)
      this.setSleep(Number(settings.sleepTimer));
    return this.state;
  }
  attach(socket) {
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
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
      this.state.fullscreen && !this.state.pip && !this.state.overlay
        ? "auto"
        : "never",
      "no-osd",
    ]);
  }
  message(name) {
    if (name === "riwaq-fullscreen") this.onFullscreen?.();
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
  event(event) {
    if (event.event === "client-message" && typeof event.args?.[0] === "string")
      this.message(event.args[0]);
    if (event.event === "property-change") {
      if (event.name === "track-list") this.rawTracks = event.data || [];
      const mapping = PROPERTIES.find(([name]) => name === event.name);
      if (mapping && event.data !== undefined) {
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
      if (event.name === "core-idle" || event.name === "pause")
        this.state.loading = !!this.coreIdle && !this.state.pause;
      this.onState(this.state);
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
    }
    if (event.event === "end-file") {
      this.save();
      if (event.reason === "error") {
        this.state.error = "تعذّر تشغيل هذا المصدر. جرّب مصدراً آخر.";
        this.onState(this.state);
      }
      if (event.reason === "eof") {
        this.onEnded({ meta: this.meta, videoId: this.videoId });
        this.send(["quit"]);
      }
    }
  }
  refreshSegments() {
    if (this.state.live) return;
    this.state.segments = detectSegments({
      chapters: this.state.chapters,
      duration: this.state.duration,
    });
    this.refreshSkip();
  }
  refreshSkip() {
    const next = activeSegment(
      this.state.segments,
      this.state.position,
      this.settings || {},
    );
    const changed = JSON.stringify(next) !== JSON.stringify(this.state.skip);
    this.state.skip = next;
    if (changed) this.onState(this.state);
    if (
      next &&
      this.state.abLoop === null &&
      ((next.kind === "intro" && this.settings?.skipIntro === "auto") ||
        (next.kind === "outro" && this.settings?.skipOutro === "auto"))
    )
      this.send(["seek", next.end, "absolute"]);
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
    const number = Number(value);
    if (action === "pause") this.send(["cycle", "pause"]);
    else if (action === "seek" && Number.isFinite(number))
      this.send(["seek", Math.max(0, number), "absolute"]);
    else if (action === "seekBy" && Number.isFinite(number))
      this.send(["seek", Math.max(-600, Math.min(600, number)), "relative"]);
    else if (action === "volume" && Number.isFinite(number))
      this.send(["set_property", "volume", Math.max(0, Math.min(150, number))]);
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
    this.send(["sub-add", path, secondary ? "auto" : "select"]);
    if (secondary) this.send(["set_property", "secondary-sid", 2]);
  }
  async stop() {
    const child = this.child;
    this.clearSleep();
    if (!child) return;
    this.save();
    this.send(["quit"]);
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill();
        resolve();
      }, 1500);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    this.socket?.destroy();
    if (this.child === child) this.child = null;
  }
}
