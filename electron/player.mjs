import { spawn } from "node:child_process";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { webUrl } from "../core/protocol.mjs";

export function playerArgs({
  pipe,
  settings,
  url,
  title,
  start = 0,
  headers = {},
  host,
  inputConf,
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
    "--osc=no",
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
    "--sub-border-size=2",
    `--sub-pos=${settings.subtitlePosition ?? 95}`,
    `--start=${Math.max(0, Number(start) || 0)}`,
  ];
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
export class Player {
  constructor({ onState, onProgress, onEnded, host, inputConf, onFullscreen }) {
    this.host = host;
    this.inputConf = inputConf;
    this.onFullscreen = onFullscreen;
    this.onState = onState;
    this.onProgress = onProgress;
    this.onEnded = onEnded;
    this.state = { active: false };
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
  }) {
    if (!local) webUrl(url);
    if (!existsSync(executable))
      throw new Error("لم يتم العثور على MPV. اختر ملف mpv.exe من الإعدادات.");
    await this.stop();
    this.meta = meta;
    this.videoId = videoId;
    this.lastSaved = 0;
    const pipe = `\\\\.\\pipe\\riwaq-${randomUUID()}`;
    this.state = {
      active: true,
      loading: true,
      name: meta.name,
      videoId,
      mediaType: meta.type,
      position: start,
      duration: 0,
      pause: false,
      volume: 100,
      tracks: [],
      pip: false,
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
        inputConf: this.inputConf,
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
    [
      "time-pos",
      "duration",
      "pause",
      "volume",
      "track-list",
      "core-idle",
      "eof-reached",
      "speed",
      "brightness",
      "contrast",
      "saturation",
      "gamma",
      "video-aspect-override",
      "sub-delay",
      "sub-font-size",
    ].forEach((name, id) => this.send(["observe_property", id + 1, name]));
  }
  event(event) {
    if (
      event.event === "client-message" &&
      event.args?.[0] === "riwaq-fullscreen"
    )
      this.onFullscreen?.();
    if (event.event === "client-message" && event.args?.[0] === "riwaq-stop")
      this.stop();
    if (event.event === "property-change") {
      const keys = {
        "time-pos": "position",
        duration: "duration",
        pause: "pause",
        volume: "volume",
        "track-list": "tracks",
        "core-idle": "loading",
        speed: "speed",
        brightness: "brightness",
        contrast: "contrast",
        saturation: "saturation",
        gamma: "gamma",
        "video-aspect-override": "aspect",
        "sub-delay": "subtitleDelay",
        "sub-font-size": "subtitleSize",
      };
      if (keys[event.name] && event.data !== undefined) {
        this.state[keys[event.name]] =
          event.name === "track-list"
            ? (event.data || []).map(({ id, type, lang, title, selected }) => ({
                id,
                type,
                lang,
                selected,
                title:
                  typeof title === "string" && !/https?:\/\//i.test(title)
                    ? title
                    : undefined,
              }))
            : event.data;
      }
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
      this.state.loading = false;
      this.state.error = null;
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
  save() {
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
    if (action === "pause") this.send(["cycle", "pause"]);
    else if (action === "seek" && Number.isFinite(value))
      this.send(["seek", Math.max(0, value), "absolute"]);
    else if (action === "volume" && Number.isFinite(value))
      this.send(["set_property", "volume", Math.max(0, Math.min(100, value))]);
    else if (action === "fullscreen") this.onFullscreen?.();
    else if (action === "pip") {
      this.state.pip = !this.state.pip;
      // The mini player remains embedded while browsing the app.
    } else if (action === "subtitleDelay" && Number.isFinite(value))
      this.send([
        "set_property",
        "sub-delay",
        Math.max(-60, Math.min(60, value)),
      ]);
    else if (action === "subtitleSize" && Number.isFinite(value))
      this.send([
        "set_property",
        "sub-font-size",
        Math.max(18, Math.min(80, value)),
      ]);
    else if (
      ["brightness", "contrast", "saturation", "gamma"].includes(action) &&
      Number.isFinite(value)
    )
      this.send(["set_property", action, Math.max(-100, Math.min(100, value))]);
    else if (action === "speed" && Number.isFinite(value))
      this.send(["set_property", "speed", Math.max(0.25, Math.min(3, value))]);
    else if (
      action === "aspect" &&
      ["-1", "16:9", "4:3", "2.35:1"].includes(value)
    )
      this.send(["set_property", "video-aspect-override", value]);
    else if (
      ["sid", "aid"].includes(action) &&
      (value === "no" || Number.isInteger(value))
    )
      this.send(["set_property", action, value]);
    this.onState(this.state);
    return this.state;
  }
  subtitle(path) {
    this.send(["sub-add", path, "select"]);
  }
  async stop() {
    const child = this.child;
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
