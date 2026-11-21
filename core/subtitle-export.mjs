/**
 * Saving a viewing's subtitle to a file (issue #157, the player menu's
 * "تنزيل الترجمة"). Main fetches or reads the file and writes it where the
 * viewer chose in the system's Save dialog (electron/subtitle-save.mjs);
 * nothing here touches the disk, and no address or path reaches the page.
 *
 * - An addon's subtitle address is untrusted. `subtitleUrl` takes http or
 *   https without credentials. A loopback or private-network address is
 *   accepted only at a trusted origin: the own origin (scheme, host, port)
 *   of the configured, enabled addon that supplied the subtitle, when that
 *   addon is itself local (`trustedOrigin`; main names it, the address
 *   alone never does). Once a chain leaves the trusted origins it stays
 *   out: a public address can never redirect into the viewer's network.
 *   At most three redirects, each checked again; the body is read up to
 *   `SUBTITLE_MAX` bytes and the request ends at a timeout.
 * - Main's transport (electron/subtitle-http.mjs) enforces the same rule
 *   where the socket connects (Codex's final acceptance, 2026-11-21): a
 *   name outside the trusted origins may resolve only to public addresses,
 *   so DNS cannot point a public-looking name at this computer.
 * - The bytes must be a subtitle file (`subtitleFormat`: SRT, WebVTT or
 *   ASS/SSA with at least one cue), whatever the server called them, and
 *   they are kept as they came: an Arabic file in Windows-1256 stays one.
 * - `subtitleFileName` builds the name the dialog suggests, valid on
 *   Windows (no reserved characters or names, no trailing dot or space).
 *
 * Browser-safe: fetch and TextDecoder only.
 */
import { parseCues } from "./subtitles.mjs";

export const SUBTITLE_MAX = 5 * 1024 * 1024;
export const SUBTITLE_TIMEOUT = 15000;
export const SUBTITLE_EXTENSIONS = ["srt", "vtt", "ass", "ssa", "sub"];
/** The error code main's transport gives a destination it refused. */
export const SUBTITLE_HOST_BLOCKED = "ERR_RIWAQ_SUBTITLE_HOST";
const REDIRECTS = 3;

/** True for a host on this computer or the viewer's own network. */
export function localHost(hostname) {
  const host = String(hostname || "")
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(
      host,
    ) ||
    host === "::" ||
    host === "::1" ||
    /^::ffff:/.test(host) ||
    /^f[cd][0-9a-f]{0,2}:/.test(host) ||
    /^fe[89ab][0-9a-f]?:/.test(host) ||
    (!host.includes(".") && !host.includes(":"))
  );
}

/**
 * The origin a configured addon's subtitles may use locally: the addon's own
 * scheme, host and port, only when that host is local (a Stremio Service
 * or home-server addon). "" for a public addon or a malformed address.
 */
export function trustedOrigin(transportUrl) {
  try {
    const url = new URL(String(transportUrl || ""));
    if (!["http:", "https:"].includes(url.protocol)) return "";
    if (url.username || url.password) return "";
    return localHost(url.hostname) ? url.origin : "";
  } catch {
    return "";
  }
}

/**
 * A subtitle address that may be fetched: http or https, no credentials.
 * A local one only at one of the `trusted` origins.
 */
export function subtitleUrl(input, { trusted = [] } = {}) {
  let url;
  try {
    url = new URL(String(input || ""));
  } catch {
    throw new Error("عنوان الترجمة غير صالح");
  }
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("عنوان الترجمة غير مدعوم");
  if (url.username || url.password) throw new Error("عنوان الترجمة غير مدعوم");
  if (localHost(url.hostname) && !trusted.includes(url.origin))
    throw new Error("حُوّلت الترجمة إلى عنوان على شبكتك، فلم تُحفظ");
  url.hash = "";
  return url.toString();
}

async function readCapped(response, max) {
  const length = Number(response.headers.get("content-length") || 0);
  if (length > max) throw new Error("ملف الترجمة كبير جداً");
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > max) throw new Error("ملف الترجمة كبير جداً");
    return bytes;
  }
  const reader = response.body.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new Error("ملف الترجمة كبير جداً");
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const drop = (response) => {
  try {
    response?.body?.cancel?.().catch?.(() => {});
  } catch {
    /* already closed */
  }
};

/**
 * The subtitle's bytes from an addon's address. Never sends cookies or
 * headers of its own beyond Accept; `signal` cancels it. `trusted`: the
 * origins where a local address is allowed (main's trustedOrigin of the
 * supplying addon); the transport gets them too, as `init.trusted`.
 */
export async function fetchSubtitle(
  input,
  {
    fetch: get = globalThis.fetch,
    timeout = SUBTITLE_TIMEOUT,
    max = SUBTITLE_MAX,
    signal,
    trusted = [],
  } = {},
) {
  // Trust holds only while the chain stays at a trusted origin: once a hop
  // leaves, no later hop may be local, trusted or not.
  let allowed = (Array.isArray(trusted) ? trusted : []).filter(
    (origin) => typeof origin === "string" && origin,
  );
  let url = subtitleUrl(input, { trusted: allowed });
  const stop = AbortSignal.any
    ? AbortSignal.any([AbortSignal.timeout(timeout), signal].filter(Boolean))
    : AbortSignal.timeout(timeout);
  for (let hop = 0; hop <= REDIRECTS; hop++) {
    if (!allowed.includes(new URL(url).origin)) allowed = [];
    let response;
    try {
      response = await get(url, {
        redirect: "manual",
        credentials: "omit",
        headers: { Accept: "text/plain, text/vtt, application/x-subrip, */*" },
        signal: stop,
        trusted: allowed,
      });
    } catch (error) {
      if (error?.code === SUBTITLE_HOST_BLOCKED)
        throw new Error("مصدر الترجمة يشير إلى عنوان على شبكتك، فلم تُحفظ");
      throw new Error(
        stop.aborted
          ? "انتهت مهلة تحميل الترجمة"
          : "تعذّر تحميل الترجمة من مصدرها",
      );
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = response.headers.get("location");
      drop(response);
      if (!next) throw new Error("تعذّر تحميل الترجمة من مصدرها");
      url = subtitleUrl(new URL(next, url).toString(), { trusted: allowed });
      continue;
    }
    if (!response.ok) {
      drop(response);
      throw new Error(`تعذّر تحميل الترجمة (HTTP ${response.status})`);
    }
    const type = String(response.headers.get("content-type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (/^(text\/html|image\/|video\/|audio\/|font\/)/.test(type)) {
      drop(response);
      throw new Error("المصدر لم يرسل ملف ترجمة");
    }
    try {
      return await readCapped(response, max);
    } catch (error) {
      if (stop.aborted) throw new Error("انتهت مهلة تحميل الترجمة");
      throw error;
    }
  }
  throw new Error("تعذّر تحميل الترجمة: تحويلات كثيرة");
}

/** The text of a subtitle file for checking its shape (not for saving). */
function textOf(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (b[0] === 0xff && b[1] === 0xfe)
    return new TextDecoder("utf-16le").decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff)
    return new TextDecoder("utf-16be").decode(b.subarray(2));
  // Timings and section names are ASCII in every encoding these use.
  return new TextDecoder("latin1").decode(b);
}

/**
 * What the bytes are: "srt", "vtt", "ass" or "ssa", or null when they are
 * not a subtitle file with at least one cue (an error page, a binary).
 */
export function subtitleFormat(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (!b.length || b.length > SUBTITLE_MAX) return null;
  const utf16 =
    (b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff);
  if (!utf16 && b.subarray(0, 4096).includes(0)) return null;
  const text = textOf(b).replace(/^(\uFEFF|ï»¿)/, "");
  if (/^\s*<(!doctype|html|\?xml|svg)/i.test(text)) return null;
  if (/^\s*\[Script Info\]/i.test(text))
    return /^Dialogue:/m.test(text)
      ? /ScriptType:\s*v4\.00\+/i.test(text)
        ? "ass"
        : "ssa"
      : null;
  if (/^WEBVTT(\s|$)/.test(text)) return parseCues(text).length ? "vtt" : null;
  return /\d\d:\d\d:\d\d,\d{1,3}\s*-->/.test(text) && parseCues(text).length
    ? "srt"
    : null;
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** A file name Windows accepts, from any text, never empty. */
export function safeFileName(input, fallback = "subtitles") {
  let name = String(input || "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "")
    .replace(/^[. ]+/, "");
  if (name.length > 120)
    name = name
      .slice(0, 120)
      .trim()
      .replace(/[. ]+$/, "");
  if (!name || RESERVED.test(name.split(".")[0])) name = fallback;
  return name;
}

/**
 * The name the Save dialog suggests: the title, the episode when the video
 * ID names one (S01E02), the language code and the format's extension.
 */
export function subtitleFileName({ title, videoId, lang, format } = {}) {
  const parts = [safeFileName(title, "Riwaq")];
  const episode = /:(\d{1,4}):(\d{1,5})$/.exec(String(videoId || ""));
  if (episode)
    parts.push(
      `S${episode[1].padStart(2, "0")}E${episode[2].padStart(2, "0")}`,
    );
  const base = safeFileName(parts.join(" "), "Riwaq");
  const code = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i.test(String(lang || ""))
    ? `.${String(lang).toLowerCase()}`
    : "";
  const ext = SUBTITLE_EXTENSIONS.includes(format) ? format : "srt";
  return `${base}${code}.${ext}`;
}
