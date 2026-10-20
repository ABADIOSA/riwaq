/**
 * The web edition's player: an HTML5 <video> standing in for MPV.
 *
 * It keeps electron/player.mjs's contract with the rest of the app: the same
 * `state` shape goes to the interface, the same `command()` actions arrive,
 * and progress, end of file, skip segments, sleep timers and A/B loops work
 * the same way. The interface (PlayerView.jsx) is unchanged: the bridge
 * places this player's picture inside the theater's `.video-surface`, the
 * rectangle that MPV's window covers on the desktop.
 *
 * What a browser cannot do is said plainly instead of pretended: no MPV
 * filters, no audio delay, no volume above 100%, no embedded MKV subtitle
 * tracks. Formats the browser cannot decode (MKV with HEVC, AC-3, DTS…) and
 * plain-HTTP addresses that an HTTPS page may not load are handed to the
 * viewer's own Stremio streaming server, when it runs, which converts them
 * to HLS on the viewer's machine. Nothing goes through a server of ours.
 */
import {
  activeSegment,
  detectSegments,
  mergeSegments,
  skipMode,
} from "../core/skip-segments.mjs";
import {
  DEFAULT_SUBTITLE_STYLE,
  parseCues,
  safeSubtitleStyle,
} from "../core/subtitles.mjs";

const POSITION_MS = 250;
const SAVE_MS = 5000;
const LOOPBACK = /^(127\.\d+\.\d+\.\d+|localhost|\[::1\])$/i;
const FAILED = "تعذّر تشغيل هذا المصدر. جرّب مصدراً آخر.";
const BROWSER_FAILED =
  "المتصفح ما يقدر يشغّل صيغة هذا المصدر. شغّل Stremio Service على جهازك ليحوّلها، أو جرّب مصدراً آخر، أو استخدم نسخة سطح المكتب.";
const MIXED_FAILED =
  "هذا المصدر يستخدم HTTP غير مشفّر، والمتصفح يمنعه داخل صفحة آمنة. شغّل Stremio Service على جهازك ليمرّره، أو استخدم نسخة سطح المكتب.";

const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};
export const isLoopback = (url) => LOOPBACK.test(hostOf(url));

/** Whether an HTTPS page would refuse to load this address as media. */
export function blockedAsMixed(
  url,
  pageProtocol = globalThis.location?.protocol,
) {
  try {
    const u = new URL(url);
    return (
      pageProtocol === "https:" &&
      u.protocol === "http:" &&
      !LOOPBACK.test(u.hostname)
    );
  } catch {
    return false;
  }
}

export const isHlsUrl = (url) => /\.m3u8?(?:$|[?#])/i.test(String(url || ""));

/** What this browser decodes, as the streaming server's codec names. */
export function browserCodecs(probe = document.createElement("video")) {
  const can = (type) => {
    try {
      return !!probe.canPlayType(type);
    } catch {
      return false;
    }
  };
  const video = ["h264"];
  if (can('video/mp4; codecs="hvc1.1.6.L150.B0"')) video.push("h265", "hevc");
  if (can('video/webm; codecs="vp9"')) video.push("vp9");
  if (can('video/mp4; codecs="av01.0.08M.08"')) video.push("av1");
  const audio = ["aac", "mp3"];
  if (can('audio/webm; codecs="opus"')) audio.push("opus");
  if (can('audio/mp4; codecs="ac-3"')) audio.push("ac3");
  if (can('audio/mp4; codecs="ec-3"')) audio.push("eac3");
  if (can("audio/flac")) audio.push("flac");
  return { video, audio };
}

/**
 * The viewer's own streaming server converting an address it can read into
 * HLS this browser plays (the same conversion Stremio's web player asks of
 * it). The address stays between this page and the viewer's machine.
 */
export function serverHlsUrl(server, mediaURL, { id, video, audio }) {
  const base = new URL(server);
  base.pathname = `${base.pathname.replace(/\/$/, "")}/hlsv2/${encodeURIComponent(id)}/master.m3u8`;
  const params = new URLSearchParams();
  params.append("mediaURL", mediaURL);
  for (const codec of video) params.append("videoCodecs", codec);
  for (const codec of audio) params.append("audioCodecs", codec);
  params.append("maxAudioChannels", "2");
  base.search = params.toString();
  return base.toString();
}

/** The ways one address may be played, in order (see the file comment). */
export function playPlan(url, { local = false, server = "", page } = {}) {
  if (local) return [{ kind: "direct", url }];
  const plan = [];
  const mixed = blockedAsMixed(url, page);
  if (!mixed) plan.push({ kind: isHlsUrl(url) ? "hls" : "direct", url });
  if (server) plan.push({ kind: "convert", url, mixed });
  return plan;
}

/** MPV's colour #AARRGGBB is #RRGGBB plus opacity here. */
const rgba = (hex, opacity = 100) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${opacity / 100})`;
};
/** The subtitle style as ::cue rules, the browser's counterpart of styleProperties. */
export function cueCss(style, size = 44) {
  const s = safeSubtitleStyle(style || DEFAULT_SUBTITLE_STYLE);
  const outline = s.outline
    ? [-1, 0, 1]
        .flatMap((x) => [-1, 0, 1].map((y) => [x, y]))
        .filter(([x, y]) => x || y)
        .map(
          ([x, y]) =>
            `${x * Math.min(3, s.outline / 1.5)}px ${y * Math.min(3, s.outline / 1.5)}px 0 ${s.outlineColor}`,
        )
    : [];
  if (s.shadow) outline.push(`${s.shadow}px ${s.shadow}px 2px #00000099`);
  return [
    `color: ${s.color}`,
    `background-color: ${rgba(s.background, s.backgroundOpacity)}`,
    `text-shadow: ${outline.join(", ") || "none"}`,
    `font-weight: ${s.bold ? 700 : 400}`,
    `font-size: ${Math.round((Math.max(18, Math.min(80, size)) / 44) * 100)}%`,
    `font-family: "Segoe UI", Tahoma, "Noto Naskh Arabic", sans-serif`,
  ].join("; ");
}

export class WebPlayer {
  constructor({
    onState = () => {},
    onProgress = () => {},
    onEnded = () => {},
    onEvent = () => {},
    onLoaded,
    onStall,
    settingsNow = () => ({}),
    skipPrefs,
    server = async () => "",
    loadHls = () => import("hls.js").then((m) => m.default),
  } = {}) {
    this.onState = onState;
    this.onProgress = onProgress;
    this.onEnded = onEnded;
    this.onEvent = onEvent;
    this.onLoaded = onLoaded;
    this.onStall = onStall;
    this.settingsNow = settingsNow;
    this.skipPrefs = skipPrefs;
    this.server = server;
    this.loadHls = loadHls;
    this.state = { active: false };
    this.sleepEpisodes = 0;
    this.startToken = 0;
    this.visible = true;
    this.fullscreen = false;
    if (typeof document !== "undefined")
      document.addEventListener("fullscreenchange", () => {
        this.fullscreen = !!document.fullscreenElement;
        document.documentElement.classList.toggle(
          "web-fullscreen",
          this.fullscreen,
        );
      });
  }

  // --- The picture's place ------------------------------------------------

  /**
   * The interface reports the theater's surface (videoBounds). The picture
   * joins that element, under its loading text, skip button and statistics.
   */
  place({ visible = true } = {}) {
    this.visible = visible !== false;
    const box = this.box;
    if (!box || !this.state.active) return false;
    const surface = document.querySelector(".theater .video-surface");
    if (surface && box.parentElement !== surface) surface.prepend(box);
    box.hidden = !this.visible || !surface;
    return !!surface && this.visible;
  }

  // --- Starting and stopping ----------------------------------------------

  async start({
    url,
    meta,
    videoId,
    start = 0,
    startPercent,
    live = false,
    local = false,
    settings = {},
    tags = [],
    restart = false,
  }) {
    const token = ++this.startToken;
    await this.stop({ cancelStart: false });
    if (token !== this.startToken) throw new Error("بدأ تشغيل مصدر آخر");
    if (!restart) this.stallRetries = 0;
    // A Simkl resume point starts at its percentage once the length is
    // known; a restart before that keeps it (core/resume.mjs).
    if (!restart)
      this.pendingPercent =
        Number.isFinite(startPercent) && startPercent > 0 && startPercent < 95
          ? startPercent
          : undefined;
    this.meta = meta;
    this.videoId = videoId;
    this.settings = settings;
    this.lastStart = { url, meta, videoId, live, local, settings, tags };
    this.lastSaved = 0;
    this.onlineSegments = [];
    this.subs = [];
    this.autoSkipped = null;
    this.loadedOnce = false;
    this.state = {
      active: true,
      loading: true,
      name: meta.name,
      videoId,
      mediaType: meta.type,
      meta: {
        id: meta.id,
        type: meta.type,
        name: meta.name,
        poster: meta.poster,
      },
      position: start,
      duration: 0,
      pause: false,
      volume: this.volume ?? 100,
      muted: false,
      speed: 1,
      tracks: [],
      chapters: [],
      segments: [],
      skip: null,
      pip: false,
      // The browser's full screen is the page's, and the theater keeps its
      // own controls in it (web.css), so the interface never goes immersive.
      fullscreen: false,
      overlay: false,
      fill: !!settings.videoFill,
      pictureMode: settings.videoFill ? "crop" : "fit",
      live,
      abLoop: null,
      sleepAt: null,
      sleepEpisodes: this.sleepEpisodes,
      rtx: null,
      volumeMax: 100,
      separate: false,
      sourceTags: Array.isArray(tags)
        ? tags.filter((t) => typeof t === "string").slice(0, 6)
        : [],
      stats: false,
      compatibilityStage: 0,
      shader: "none",
      decoder: "browser",
      subtitleDelay: 0,
      subtitleSize: settings.subtitleSize || 44,
      subtitlePosition: settings.subtitlePosition ?? 95,
      subtitleVisible: true,
      subtitleStyle: settings.subtitleStyle,
      audioDelay: 0,
      brightness: 0,
      contrast: 0,
      saturation: 0,
      gamma: 0,
      zoom: 0,
      aspect: "-1",
      web: true,
    };
    this.applyCueStyle();
    this.emit();
    const server = local || live ? "" : await this.server().catch(() => "");
    if (token !== this.startToken) throw new Error("بدأ تشغيل مصدر آخر");
    this.plan = playPlan(url, { local, server });
    this.serverUrl = server;
    if (!this.plan.length) {
      this.fail(MIXED_FAILED);
      return this.state;
    }
    this.attempt(0, start, token);
    return this.state;
  }

  /** Starts the same viewing again from where it is (the stall watchdog). */
  restartSame() {
    if (!this.lastStart) return null;
    return this.start({
      ...this.lastStart,
      start: this.state.position || 0,
      restart: true,
    });
  }

  /** Moves to a pending resume percentage once the length is known. */
  seekPercent(video) {
    const percent = this.pendingPercent;
    if (
      !percent ||
      this.state.live ||
      !Number.isFinite(video.duration) ||
      !(video.duration > 0)
    )
      return false;
    this.pendingPercent = undefined;
    try {
      video.currentTime = (video.duration * percent) / 100;
    } catch {}
    return true;
  }

  attempt(index, start, token) {
    const step = this.plan[index];
    this.planIndex = index;
    this.teardown();
    const box = document.createElement("div");
    box.className = "riwaq-web-video";
    const video = document.createElement("video");
    video.className = "riwaq-video";
    video.playsInline = true;
    video.preload = "auto";
    video.volume = Math.min(1, (this.state.volume ?? 100) / 100);
    video.muted = !!this.state.muted;
    box.append(video);
    this.box = box;
    this.video = video;
    this.applyPicture();
    this.place({ visible: this.visible });
    // A resume point's percentage replaces its estimated seconds outright:
    // Chromium reports the length (durationchange) before loadedmetadata.
    const viewing = {
      token,
      index,
      start: this.pendingPercent ? 0 : start,
      failed: false,
    };
    this.viewing = viewing;
    const live = () => this.viewing === viewing && this.state.active;
    const on = (name, fn) =>
      video.addEventListener(name, (event) => live() && fn(event));
    on("loadedmetadata", () => {
      this.readVideo();
      if (
        !this.seekPercent(video) &&
        viewing.start > 0 &&
        !this.state.live &&
        step.kind !== "hls"
      ) {
        try {
          video.currentTime = viewing.start;
        } catch {}
      }
      if (!this.loadedOnce) {
        this.loadedOnce = true;
        this.onLoaded?.({ meta: this.meta, videoId: this.videoId });
      }
      this.refreshTracks();
      this.refreshSegments();
      this.emit();
      this.checkDecoding(viewing);
    });
    on("durationchange", () => {
      // A length learnt late (some WebM files) still places a resume point.
      this.seekPercent(video);
      this.readVideo();
      this.refreshSegments();
      this.emit();
    });
    on("timeupdate", () => this.tick());
    on("play", () => {
      this.state.pause = false;
      this.emit();
    });
    on("pause", () => {
      this.state.pause = true;
      this.save();
      this.emit();
    });
    on("waiting", () => {
      this.state.loading = true;
      this.state.cachePaused = !video.paused;
      this.emit();
    });
    for (const name of ["playing", "canplay"])
      on(name, () => {
        this.state.loading = false;
        this.state.cachePaused = false;
        this.state.error = null;
        this.emit();
      });
    on("volumechange", () => {
      this.state.volume = Math.round(video.volume * 100);
      this.state.muted = video.muted;
      this.volume = this.state.volume;
      this.emit();
    });
    on("ratechange", () => {
      this.state.speed = video.playbackRate;
      this.emit();
    });
    on("progress", () => this.readBuffer());
    on("ended", () => this.ended());
    on("error", () => this.next(viewing));
    if (step.kind === "direct") {
      video.src = step.url;
      this.play();
    } else this.attachHls(step, viewing, viewing.start);
    this.startWatchdog();
  }

  async attachHls(step, viewing, start) {
    const video = this.video;
    let url = step.url;
    if (step.kind === "convert") {
      const codecs = browserCodecs(video);
      url = serverHlsUrl(this.serverUrl, step.url, {
        id: crypto.randomUUID(),
        ...codecs,
      });
      this.state.decoder = "Stremio Service → HLS";
    }
    // Safari plays HLS itself; elsewhere hls.js feeds Media Source.
    let Hls = null;
    try {
      Hls = await this.loadHls();
    } catch {
      Hls = null;
    }
    if (this.viewing !== viewing) return;
    if (Hls?.isSupported?.()) {
      const hls = new Hls({
        startPosition: start > 0 && !this.state.live ? start : -1,
        enableWorker: true,
        lowLatencyMode: !!this.state.live,
      });
      this.hls = hls;
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (this.viewing !== viewing || !data?.fatal) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !viewing.recovered) {
          viewing.recovered = true;
          hls.recoverMediaError();
          return;
        }
        this.next(viewing);
      });
      for (const name of [
        Hls.Events.MANIFEST_PARSED,
        Hls.Events.AUDIO_TRACKS_UPDATED,
        Hls.Events.AUDIO_TRACK_SWITCHED,
        Hls.Events.SUBTITLE_TRACKS_UPDATED,
        Hls.Events.SUBTITLE_TRACK_SWITCH,
        Hls.Events.LEVEL_SWITCHED,
      ])
        hls.on(name, () => {
          if (this.viewing !== viewing) return;
          const level = hls.levels?.[hls.currentLevel];
          if (level?.bitrate) this.state.videoBitrate = level.bitrate;
          this.refreshTracks();
          this.emit();
        });
      hls.attachMedia(video);
      hls.loadSource(url);
      this.play();
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      this.play();
    } else this.next(viewing);
  }

  play() {
    this.video?.play().catch((error) => {
      // A browser that blocks sound until the page is clicked: the viewing
      // waits paused for the viewer's play.
      if (error?.name === "NotAllowedError") {
        this.state.pause = true;
        this.state.loading = false;
        this.onEvent({
          type: "notice",
          text: "المتصفح أوقف التشغيل التلقائي. اضغط تشغيل للمتابعة.",
        });
        this.emit();
      }
    });
  }

  /** The current way failed: try the next one, or report the failure. */
  next(viewing) {
    if (this.viewing !== viewing || viewing.failed) return;
    viewing.failed = true;
    const at = this.state.position || viewing.start || 0;
    if (viewing.index + 1 < this.plan.length) {
      this.onEvent({
        type: "notice",
        text: "المتصفح ما شغّل المصدر مباشرة؛ نحوّله عبر Stremio Service على جهازك…",
      });
      this.attempt(viewing.index + 1, at, viewing.token);
      return;
    }
    const step = this.plan[viewing.index];
    this.fail(
      step?.kind === "convert"
        ? FAILED
        : step && blockedAsMixed(step.url)
          ? MIXED_FAILED
          : this.serverUrl || this.state.mediaType === "local"
            ? FAILED
            : BROWSER_FAILED,
    );
  }

  fail(message) {
    this.state.loading = false;
    this.state.error = message;
    this.emit();
  }

  /**
   * A browser that cannot decode a file's video often plays its sound and
   * says nothing; one that cannot decode its audio plays a silent picture.
   * Either is treated as a failed way, so the converted stream is tried.
   */
  checkDecoding(viewing) {
    clearTimeout(this.decodeTimer);
    this.decodeTimer = setTimeout(() => {
      const video = this.video;
      if (this.viewing !== viewing || !video || video.paused) return;
      if (!["movie", "series", "local", "live"].includes(this.state.mediaType))
        return;
      const noPicture = video.readyState >= 2 && !video.videoWidth;
      const silent =
        "webkitAudioDecodedByteCount" in video &&
        video.currentTime > 3 &&
        video.webkitAudioDecodedByteCount === 0 &&
        !video.muted;
      if (noPicture || (silent && this.planIndex + 1 < this.plan.length))
        this.next(viewing);
    }, 6000);
  }

  teardown() {
    clearTimeout(this.decodeTimer);
    this.viewing = null;
    try {
      this.hls?.destroy();
    } catch {}
    this.hls = null;
    const video = this.video;
    if (video) {
      try {
        video.pause();
        video.removeAttribute("src");
        video.load();
      } catch {}
    }
    this.box?.remove();
    this.box = null;
    this.video = null;
  }

  async stop({ cancelStart = true } = {}) {
    if (cancelStart) this.startToken++;
    this.clearSleep();
    this.stopWatchdog();
    clearTimeout(this.publishTimer);
    this.publishTimer = null;
    if (!this.state.active) return;
    this.save();
    this.teardown();
    for (const sub of this.subs || [])
      if (sub.objectUrl) URL.revokeObjectURL(sub.objectUrl);
    if (this.lastStart?.local && this.lastStart.url?.startsWith("blob:"))
      URL.revokeObjectURL(this.lastStart.url);
    this.state = { ...this.state, active: false, loading: false };
    this.emit();
  }

  ended() {
    this.save();
    let sleep = false;
    if (this.sleepEpisodes > 0) {
      this.sleepEpisodes--;
      this.state.sleepEpisodes = this.sleepEpisodes;
      sleep = this.sleepEpisodes === 0;
    }
    // As with MPV: the end is reported, then the viewing closes (MPV quits).
    this.onEnded({ meta: this.meta, videoId: this.videoId, sleep });
    this.stop();
  }

  // --- What the video reports ---------------------------------------------

  readVideo() {
    const video = this.video;
    if (!video) return;
    const duration = video.duration;
    // An unknown length (Infinity) is not taken for live: progressive
    // streams without a duration still save their position.
    this.state.duration =
      Number.isFinite(duration) && duration > 0 ? duration : 0;
    this.state.width = video.videoWidth || undefined;
    this.state.height = video.videoHeight || undefined;
  }

  readBuffer() {
    const video = this.video;
    if (!video?.buffered?.length) return;
    const t = video.currentTime;
    for (let i = 0; i < video.buffered.length; i++)
      if (video.buffered.start(i) <= t + 0.5 && video.buffered.end(i) >= t)
        this.state.bufferedUntil = video.buffered.end(i);
  }

  tick() {
    const video = this.video;
    if (!video) return;
    this.state.position = video.currentTime;
    this.lastMove = Date.now();
    this.readBuffer();
    const loop = this.state.abLoop;
    if (loop && loop.b !== null && video.currentTime >= loop.b)
      video.currentTime = loop.a;
    this.refreshSkip();
    if (Date.now() - this.lastSaved > SAVE_MS) this.save();
    this.publish();
  }

  save() {
    if (this.state.live || !this.meta) return;
    if (Number.isFinite(this.state.position)) {
      this.onProgress(
        this.meta,
        this.videoId,
        this.state.position,
        this.state.duration,
      );
      this.lastSaved = Date.now();
    }
  }

  emit() {
    clearTimeout(this.publishTimer);
    this.publishTimer = null;
    this.lastPublish = Date.now();
    this.onState(this.state);
  }

  /** Position-only changes go out at most every POSITION_MS, like MPV's. */
  publish() {
    if (this.publishTimer) return;
    const wait = POSITION_MS - (Date.now() - (this.lastPublish || 0));
    if (wait <= 0) return this.emit();
    this.publishTimer = setTimeout(() => {
      this.publishTimer = null;
      if (this.state.active) this.emit();
    }, wait);
  }

  // --- Stalls -------------------------------------------------------------

  /** Same thresholds as Player.checkStall: 15 s still, 30 s waiting for data. */
  startWatchdog() {
    this.stopWatchdog();
    this.lastMove = Date.now();
    this.stallReported = false;
    this.watchdog = setInterval(() => {
      const video = this.video;
      if (!this.state.active || !video || this.state.error) return;
      if (video.paused && !this.state.cachePaused) {
        this.lastMove = Date.now();
        return;
      }
      const still = Date.now() - this.lastMove;
      const buffering = !!this.state.cachePaused || this.state.loading;
      const limit = buffering ? 30000 : 15000;
      if (!this.loadedOnce && still > 60000 && !this.stallReported) {
        this.stallReported = true;
        this.onStall?.({ buffering, startup: true });
      } else if (this.loadedOnce && still > limit && !this.stallReported) {
        this.stallReported = true;
        this.onStall?.({ buffering, startup: false });
      }
    }, 2000);
  }
  stopWatchdog() {
    clearInterval(this.watchdog);
    this.watchdog = null;
  }

  // --- Segments -----------------------------------------------------------

  setOnlineSegments(videoId, segments) {
    if (!this.state.active || this.videoId !== videoId) return;
    this.onlineSegments = Array.isArray(segments) ? segments : [];
    this.refreshSegments();
    this.emit();
  }
  refreshSegments() {
    if (this.state.live) return;
    this.state.segments = mergeSegments(
      detectSegments({ chapters: [], duration: this.state.duration }),
      this.onlineSegments || [],
    );
    this.refreshSkip();
  }
  refreshSkip() {
    if (!this.state.segments?.length) {
      if (this.state.skip) {
        this.state.skip = null;
        this.emit();
      }
      this.autoSkipped = null;
      return;
    }
    const prefs = this.skipPrefs?.() || this.settings || {};
    const next = activeSegment(this.state.segments, this.state.position, prefs);
    const changed = JSON.stringify(next) !== JSON.stringify(this.state.skip);
    this.state.skip = next;
    if (changed) this.emit();
    const segment = next ? `${next.kind}:${next.start}:${next.end}` : null;
    if (!segment) this.autoSkipped = null;
    if (
      next &&
      segment !== this.autoSkipped &&
      this.state.abLoop === null &&
      ["intro", "outro", "recap"].includes(next.kind) &&
      skipMode(prefs, next.kind) === "auto"
    ) {
      this.autoSkipped = segment;
      this.seek(next.end);
    }
  }

  // --- Tracks and subtitles -----------------------------------------------

  refreshTracks() {
    const video = this.video;
    const tracks = [];
    if (video?.videoWidth || this.state.mediaType !== "local")
      tracks.push({ id: 1, type: "video", selected: true, image: false });
    const hls = this.hls;
    if (hls?.audioTracks?.length)
      hls.audioTracks.forEach((t, i) =>
        tracks.push({
          id: i + 1,
          type: "audio",
          lang: t.lang || "",
          title: t.name || undefined,
          selected: hls.audioTrack === i,
        }),
      );
    else if (video?.audioTracks?.length)
      for (let i = 0; i < video.audioTracks.length; i++) {
        const t = video.audioTracks[i];
        tracks.push({
          id: i + 1,
          type: "audio",
          lang: t.language || "",
          title: t.label || undefined,
          selected: t.enabled,
        });
      }
    const primary = this.primarySub;
    const secondary = this.secondarySub;
    const visible = this.state.subtitleVisible !== false;
    if (hls?.subtitleTracks?.length)
      hls.subtitleTracks.forEach((t, i) =>
        tracks.push({
          id: i + 1,
          type: "sub",
          lang: t.lang || "",
          title: t.name || undefined,
          forced: !!t.forced,
          default: !!t.default,
          selected: visible && primary === `hls:${i}`,
        }),
      );
    for (const sub of this.subs || [])
      tracks.push({
        id: sub.id,
        type: "sub",
        lang: sub.lang || "",
        title: sub.label || undefined,
        external: true,
        addonKey: sub.key,
        selected: visible && primary === `ext:${sub.id}`,
        secondary: secondary === `ext:${sub.id}`,
      });
    this.state.tracks = tracks;
  }

  /** IDs never collide with hls.js's own subtitle tracks (1…n). */
  nextSubId() {
    return 100 + (this.subs?.length || 0) + 1;
  }

  async addSubtitle(
    url,
    { key, label = "", lang = "", secondary = false, fetchText } = {},
  ) {
    const found = (this.subs || []).find((s) => s.source === url);
    if (found) return this.selectSub(`ext:${found.id}`, secondary);
    let text;
    try {
      text = await fetchText(url);
    } catch (error) {
      // A subtitle host without CORS: the viewer's streaming server reads
      // it instead, when it runs.
      const server = await this.server().catch(() => "");
      if (!server) throw error;
      const via = new URL(server);
      via.pathname = `${via.pathname.replace(/\/$/, "")}/subtitles.vtt`;
      via.search = new URLSearchParams({ from: url }).toString();
      text = await fetchText(via.toString());
    }
    return this.addCues(parseCues(text), {
      source: url,
      key,
      label,
      lang,
      secondary,
    });
  }

  /** A subtitle file the viewer picked or dropped. */
  async addSubtitleFile(file, { secondary = false } = {}) {
    if (file.size > 5_000_000) throw new Error("ملف الترجمة كبير جداً");
    const text = await file.text();
    return this.addCues(parseCues(text), {
      source: `file:${file.name}:${file.size}`,
      label: file.name.replace(/\.[^.]+$/, "").slice(0, 120),
      lang: "",
      secondary,
    });
  }

  addCues(cues, { source, key, label, lang, secondary }) {
    if (!this.state.active || !this.video)
      throw new Error("لا توجد مشاهدة حالية");
    if (!cues.length) throw new Error("ملف الترجمة فارغ أو غير مدعوم");
    const id = this.nextSubId();
    const track = this.video.addTextTrack(
      "subtitles",
      String(label || "").slice(0, 120),
      String(lang || "").slice(0, 12),
    );
    track.mode = "disabled";
    const sub = { id, source, key, label, lang, cues, track };
    this.subs.push(sub);
    this.selectSub(`ext:${id}`, secondary);
    return true;
  }

  /** Lays one track's cues out with the current delay and line. */
  layCues(sub, line) {
    const track = sub.track;
    for (const cue of [...(track.cues || [])]) track.removeCue(cue);
    const delay = this.state.subtitleDelay || 0;
    const Cue = globalThis.VTTCue || globalThis.TextTrackCue;
    for (const c of sub.cues) {
      const cue = new Cue(
        Math.max(0, c.start + delay),
        Math.max(0, c.end + delay),
        c.text,
      );
      if ("snapToLines" in cue) {
        cue.snapToLines = false;
        cue.line = line;
        cue.lineAlign = line < 50 ? "start" : "end";
      }
      track.addCue(cue);
    }
  }

  relayout() {
    const bottom = Math.max(
      5,
      Math.min(100, Number(this.state.subtitlePosition ?? 95)),
    );
    for (const sub of this.subs || []) {
      const id = `ext:${sub.id}`;
      const shown =
        this.state.subtitleVisible !== false &&
        (this.primarySub === id || this.secondarySub === id);
      if (shown) this.layCues(sub, this.secondarySub === id ? 6 : bottom);
      sub.track.mode = shown ? "showing" : "disabled";
    }
    const hls = this.hls;
    if (hls?.subtitleTracks?.length) {
      const index = /^hls:(\d+)$/.exec(this.primarySub || "")?.[1];
      hls.subtitleTrack = index === undefined ? -1 : Number(index);
      hls.subtitleDisplay =
        index !== undefined && this.state.subtitleVisible !== false;
    }
    this.refreshTracks();
  }

  selectSub(id, secondary = false) {
    if (secondary) this.secondarySub = id;
    else {
      this.primarySub = id;
      if (this.secondarySub === id) this.secondarySub = null;
    }
    this.relayout();
    this.emit();
    return true;
  }

  /** sid/secondary-sid values: "no" or a track ID from state.tracks. */
  subFromId(value) {
    if (value === "no") return null;
    if ((this.subs || []).some((s) => s.id === value)) return `ext:${value}`;
    if (this.hls?.subtitleTracks?.[value - 1]) return `hls:${value - 1}`;
    return undefined;
  }

  applyCueStyle() {
    if (typeof document === "undefined") return;
    let tag = document.getElementById("riwaq-cue-style");
    if (!tag) {
      tag = document.createElement("style");
      tag.id = "riwaq-cue-style";
      document.head.append(tag);
    }
    tag.textContent = `video.riwaq-video::cue { ${cueCss(
      this.state.subtitleStyle,
      this.state.subtitleSize,
    )} }`;
  }

  // --- The picture --------------------------------------------------------

  /** Brightness, contrast, saturation, zoom, pan and shape as CSS. */
  applyPicture() {
    const video = this.video;
    if (!video) return;
    const s = this.state;
    const f = (v) => Math.max(0, 1 + (Number(v) || 0) / 100);
    const gamma = Number(s.gamma) || 0;
    video.style.filter = `brightness(${f(s.brightness) * (1 + gamma / 400)}) contrast(${f(s.contrast)}) saturate(${f(s.saturation)})`;
    const scale = 2 ** (Number(s.zoom) || 0);
    const ratio = {
      "16:9": 16 / 9,
      "4:3": 4 / 3,
      "2.35:1": 2.35,
      "1.85:1": 1.85,
    }[s.aspect];
    const natural = video.videoWidth / video.videoHeight;
    const stretch = ratio && natural ? ratio / natural : 1;
    video.style.transform = `translate(${(Number(s.panX) || 0) * 50}%, ${(Number(s.panY) || 0) * 50}%) scale(${scale * stretch}, ${scale})`;
    video.style.objectFit =
      s.pictureMode === "stretch" ? "fill" : s.fill ? "cover" : "contain";
  }

  // --- Commands -----------------------------------------------------------

  seek(seconds) {
    const video = this.video;
    if (!video || !Number.isFinite(seconds)) return;
    const max = this.state.duration > 0 ? this.state.duration : Infinity;
    try {
      video.currentTime = Math.max(0, Math.min(max, seconds));
    } catch {}
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
  setSleepEpisodes(count) {
    const n = Number.isInteger(count) ? Math.max(0, Math.min(5, count)) : 0;
    this.sleepEpisodes = n;
    this.state.sleepEpisodes = n;
  }
  clearSleep() {
    clearTimeout(this.sleepTimer);
    this.sleepTimer = null;
    if (this.state) this.state.sleepAt = null;
  }

  toggleLoop(at) {
    const loop = this.state.abLoop;
    if (!loop) this.state.abLoop = { a: at, b: null };
    else if (loop.b === null) {
      if (at <= loop.a) return;
      this.state.abLoop = { a: loop.a, b: at };
    } else this.state.abLoop = null;
  }

  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }

  /** The current frame as a PNG download, when the host allows reading it. */
  screenshot() {
    const video = this.video;
    if (!video?.videoWidth) throw new Error("لا توجد صورة لالتقاطها بعد");
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    let url;
    try {
      url = canvas.toDataURL("image/png");
    } catch {
      throw new Error(
        "مصدر هذا الفيديو لا يسمح للمتصفح بنسخ الصورة. استخدم نسخة سطح المكتب لالتقاط الصور.",
      );
    }
    const link = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    link.href = url;
    link.download = `riwaq-${stamp}.png`;
    link.click();
  }

  command({ action, value }) {
    if (!this.state.active) throw new Error("لا توجد مشاهدة حالية");
    const video = this.video;
    const number = Number(value);
    const s = this.state;
    if (action === "pause") {
      if (!video) return s;
      if (video.paused) this.play();
      else video.pause();
    } else if (action === "seek" && Number.isFinite(number)) this.seek(number);
    else if (action === "seekBy" && Number.isFinite(number))
      this.seek((s.position || 0) + Math.max(-600, Math.min(600, number)));
    else if (action === "volume" && Number.isFinite(number)) {
      if (video) {
        video.volume = Math.max(0, Math.min(100, number)) / 100;
        if (number > 0) video.muted = false;
      }
    } else if (action === "mute") {
      if (video) video.muted = !video.muted;
    } else if (action === "fullscreen") this.toggleFullscreen();
    else if (action === "exitFullscreen") {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    } else if (
      action === "pictureMode" &&
      ["fit", "crop", "stretch"].includes(value)
    ) {
      s.pictureMode = value;
      s.fill = value === "crop";
      s.aspect = "-1";
      s.zoom = s.panX = s.panY = 0;
      this.applyPicture();
    } else if (action === "fill") {
      s.pictureMode = value === true ? "crop" : "fit";
      s.fill = value === true;
      this.applyPicture();
    } else if (action === "pip") s.pip = !s.pip;
    else if (action === "subtitleDelay" && Number.isFinite(number)) {
      s.subtitleDelay = Math.max(-60, Math.min(60, number));
      this.relayout();
    } else if (action === "subtitleSize" && Number.isFinite(number)) {
      s.subtitleSize = Math.max(18, Math.min(80, number));
      this.applyCueStyle();
    } else if (action === "subtitlePosition" && Number.isFinite(number)) {
      s.subtitlePosition = Math.max(0, Math.min(150, number));
      this.relayout();
    } else if (
      action === "subtitleStyle" &&
      value &&
      typeof value === "object"
    ) {
      s.subtitleStyle = safeSubtitleStyle(value);
      this.applyCueStyle();
    } else if (action === "subtitleVisible") {
      s.subtitleVisible = value !== false;
      this.relayout();
    } else if (
      ["brightness", "contrast", "saturation", "gamma"].includes(action) &&
      Number.isFinite(number)
    ) {
      s[action] = Math.max(-100, Math.min(100, number));
      this.applyPicture();
    } else if (action === "speed" && Number.isFinite(number)) {
      if (video) {
        video.playbackRate = Math.max(0.25, Math.min(4, number));
        // ratechange is asynchronous; publish the actual value immediately so
        // a new gesture cannot save the previous command's stale speed.
        s.speed = video.playbackRate;
      }
    } else if (action === "zoom" && Number.isFinite(number)) {
      s.zoom = Math.max(-1, Math.min(1.5, number));
      this.applyPicture();
    } else if (action === "pan" && value && Number.isFinite(Number(value.x))) {
      s.panX = Math.max(-1, Math.min(1, Number(value.x)));
      s.panY = Math.max(-1, Math.min(1, Number(value.y) || 0));
      this.applyPicture();
    } else if (
      action === "aspect" &&
      ["-1", "16:9", "4:3", "2.35:1", "1.85:1"].includes(value)
    ) {
      s.pictureMode = value === "-1" ? (s.fill ? "crop" : "fit") : "custom";
      s.aspect = value;
      this.applyPicture();
    } else if (action === "aid" && Number.isInteger(value)) {
      if (this.hls?.audioTracks?.length) this.hls.audioTrack = value - 1;
      else if (video?.audioTracks?.length)
        for (let i = 0; i < video.audioTracks.length; i++)
          video.audioTracks[i].enabled = i === value - 1;
      this.refreshTracks();
    } else if (
      action === "sid" &&
      (value === "no" || Number.isInteger(value))
    ) {
      const id = this.subFromId(value);
      if (id !== undefined) this.selectSub(id);
    } else if (
      action === "secondarySubtitle" &&
      (value === "no" || Number.isInteger(value))
    ) {
      const id = this.subFromId(value);
      if (id !== undefined) this.selectSub(id, true);
    } else if (action === "skipSegment") {
      if (s.skip) this.seek(s.skip.end);
    } else if (action === "screenshot") this.screenshot();
    else if (action === "stats")
      s.stats = value === undefined ? !s.stats : !!value;
    else if (action === "abLoop")
      this.toggleLoop(Number.isFinite(number) ? number : s.position);
    else if (action === "clearLoop") s.abLoop = null;
    else if (action === "sleep") {
      if (Number.isFinite(number) && number > 0) this.setSleep(number);
      else this.clearSleep();
      this.setSleepEpisodes(0);
    } else if (action === "sleepEpisodes") {
      this.clearSleep();
      this.setSleepEpisodes(number);
    }
    // MPV-only actions (repairVideo, shader, chapter, audioDelay) change
    // nothing here; the web edition's panels do not offer them.
    this.emit();
    return this.state;
  }
}
