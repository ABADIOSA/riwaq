/**
 * Discord Rich Presence.
 *
 * Off unless a viewer turns it on, and it needs their own Discord application
 * id rather than one baked into Riwaq. The detail level decides how much the
 * people in their server learn: the actual title, a generic line, or nothing.
 */

import net from "node:net";

const HANDSHAKE = 0;
const FRAME = 1;

/** The activity object Discord renders. Pure, so the copy can be tested. */
export function buildActivity({
  playing = false,
  paused = false,
  live = false,
  title = "",
  episode = "",
  position = 0,
  duration = 0,
  detail = "title",
  at = Date.now(),
} = {}) {
  if (detail === "off") return null;
  if (!playing)
    return {
      details: "يتصفّح رِواق",
      assets: { large_image: "riwaq", large_text: "رِواق" },
      instance: false,
    };
  const generic = detail !== "title";
  const activity = {
    details: generic
      ? "يشاهد شيئاً"
      : String(title || "بلا عنوان").slice(0, 128),
    state: generic
      ? "رِواق"
      : [episode, paused ? "متوقف مؤقتاً" : live ? "بث مباشر" : ""]
          .filter(Boolean)
          .join(" · ")
          .slice(0, 128) || "رِواق",
    assets: { large_image: "riwaq", large_text: "رِواق" },
    instance: false,
  };
  // Discord renders a countdown from an end timestamp and a stopwatch from a
  // start one. A paused or live stream has neither.
  if (!paused && !live && duration > 0 && position >= 0)
    activity.timestamps = {
      end: Math.round(at + (duration - position) * 1000),
    };
  else if (!paused && live)
    activity.timestamps = { start: Math.round(at - position * 1000) };
  return activity;
}

function encode(opcode, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const header = Buffer.alloc(8);
  header.writeInt32LE(opcode, 0);
  header.writeInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

function socketPaths() {
  if (process.platform === "win32")
    return Array.from(
      { length: 10 },
      (_, index) => `\\\\?\\pipe\\discord-ipc-${index}`,
    );
  const base =
    process.env.XDG_RUNTIME_DIR ||
    process.env.TMPDIR ||
    process.env.TMP ||
    "/tmp";
  return Array.from(
    { length: 10 },
    (_, index) => `${base.replace(/\/$/, "")}/discord-ipc-${index}`,
  );
}

export class DiscordPresence {
  constructor({
    connect = (path) => net.createConnection(path),
    paths = socketPaths,
  } = {}) {
    this.connectTo = connect;
    this.paths = paths;
    this.socket = null;
    this.ready = false;
    this.clientId = "";
    this.pending = null;
  }
  /** Connects to whichever Discord IPC pipe answers first. Never throws. */
  async enable(clientId) {
    if (!/^\d{17,20}$/.test(String(clientId || "")))
      throw new Error("معرّف تطبيق Discord غير صالح");
    if (this.clientId === clientId && this.ready) return true;
    this.disable();
    this.clientId = String(clientId);
    for (const path of this.paths()) {
      const socket = await this.tryPath(path).catch(() => null);
      if (socket) {
        this.socket = socket;
        this.ready = true;
        socket.on("error", () => this.disable());
        socket.on("close", () => {
          this.socket = null;
          this.ready = false;
        });
        socket.write(encode(HANDSHAKE, { v: 1, client_id: this.clientId }));
        if (this.pending) this.set(this.pending);
        return true;
      }
    }
    this.clientId = "";
    throw new Error("لم يتم العثور على تطبيق Discord يعمل على هذا الجهاز");
  }
  tryPath(path) {
    return new Promise((resolve, reject) => {
      const socket = this.connectTo(path);
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error("timeout"));
      }, 1200);
      socket.once("error", (error) => {
        clearTimeout(timer);
        socket.destroy();
        reject(error);
      });
      socket.once("connect", () => {
        clearTimeout(timer);
        socket.removeAllListeners("error");
        resolve(socket);
      });
    });
  }
  set(activity) {
    this.pending = activity;
    if (!this.ready || !this.socket?.writable) return false;
    this.socket.write(
      encode(FRAME, {
        cmd: "SET_ACTIVITY",
        args: { pid: process.pid, activity: activity || undefined },
        nonce: String(Date.now()),
      }),
    );
    return true;
  }
  disable() {
    this.pending = null;
    this.ready = false;
    this.clientId = "";
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
  }
}
