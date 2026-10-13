/**
 * Discord Rich Presence.
 *
 * Off unless a viewer turns it on, and it needs their own Discord application
 * id rather than one baked into Riwaq. The detail level decides how much the
 * people in their server learn: the actual title, a generic line, or nothing.
 */

import net from "node:net";
import { t } from "./i18n.mjs";

const HANDSHAKE = 0;
const FRAME = 1;

/** Riwaq's icon, public on GitHub: Discord shows images by https address. */
export const RIWAQ_ICON =
  "https://raw.githubusercontent.com/ABADIOSA/riwaq/main/assets/icon.png";

/** An https picture without credentials that Discord can fetch, or "". */
function picture(url) {
  try {
    const u = new URL(String(url || ""));
    return u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      u.toString().length <= 300
      ? u.toString()
      : "";
  } catch {
    return "";
  }
}
/** Discord wants 2 to 128 characters in its text fields. */
const line = (value, max = 128) => {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return text.length >= 2 ? text : "";
};

/** "S1 · E3 — Title" for an episode; an older plain label passes through. */
export function episodeLine({ season, number, episodeTitle, episode } = {}) {
  if (Number(season) >= 0 && Number(number) > 0 && season !== "")
    return [`S${Number(season)} · E${Number(number)}`, line(episodeTitle, 80)]
      .filter(Boolean)
      .join(" — ");
  return line(episode);
}

/**
 * The activity object Discord renders, pure so the copy can be tested.
 * A viewing shows as "Watching" with the title in the member list
 * (`status_display_type` 2), the poster, the episode, a progress bar from
 * start and end times, and an IMDb button. The detail level decides how
 * much the people in their server learn: the actual title, a generic line,
 * or nothing.
 */
export function buildActivity({
  playing = false,
  paused = false,
  live = false,
  title = "",
  year = "",
  poster = "",
  imdb = "",
  season,
  number,
  episodeTitle = "",
  episode = "",
  position = 0,
  duration = 0,
  detail = "title",
  at = Date.now(),
} = {}) {
  if (detail === "off") return null;
  if (!playing)
    return {
      type: 0,
      details: t("يتصفّح رِواق"),
      assets: { large_image: RIWAQ_ICON, large_text: t("رِواق") },
      instance: false,
    };
  const generic = detail !== "title";
  const name = line(title) || t("بلا عنوان");
  const art = generic ? "" : picture(poster);
  const status = paused ? t("متوقف مؤقتاً") : live ? t("بث مباشر") : "";
  const activity = {
    type: 3, // Watching
    status_display_type: generic ? 0 : 2,
    details: generic ? t("يشاهد شيئاً") : name,
    state: generic
      ? t("على رِواق")
      : [episodeLine({ season, number, episodeTitle, episode }), status]
          .filter(Boolean)
          .join(" · ")
          .slice(0, 128) ||
        line(year) ||
        t("على رِواق"),
    assets: {
      large_image: art || RIWAQ_ICON,
      large_text: generic
        ? t("رِواق")
        : line(year ? `${name} (${year})` : name) || t("رِواق"),
      ...(art
        ? {
            small_image: RIWAQ_ICON,
            small_text: paused ? t("متوقف مؤقتاً") : t("على رِواق"),
          }
        : {}),
    },
    instance: false,
  };
  const imdbId = /^tt\d{5,}$/.exec(String(imdb || ""))?.[0];
  if (!generic && imdbId)
    activity.buttons = [
      {
        label: t("صفحة العمل على IMDb"),
        url: `https://www.imdb.com/title/${imdbId}/`,
      },
    ];
  // Start and end make Discord draw a progress bar for a viewing; a live
  // stream only counts up, and a paused one shows no clock.
  if (!paused && !live && duration > 0 && position >= 0)
    activity.timestamps = {
      start: Math.round(at - position * 1000),
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
