/**
 * The full diagnostic report (Settings → النظام → تشخيص كامل): what the
 * viewer copies and sends so a problem on their Windows machine can be found
 * without access to it.
 *
 * Everything that enters the report goes through `sanitize` first: no
 * addon URLs (they can carry tokens), no query strings, no keys or tokens,
 * no e-mail addresses, and the user's folder replaced by "~". Addons and
 * services appear by name and status only. Browser-safe; electron/diagnose.mjs
 * runs the checks.
 */

export const STATUS_ICON = { ok: "✓", warn: "!", fail: "✗", skip: "–" };
export const STATUS_LABEL = {
  ok: "سليم",
  warn: "تنبيه",
  fail: "مشكلة",
  skip: "لم يُفحص",
};
export const ERROR_LIMIT = 40;

const LONG_SECRET = /\b[A-Za-z0-9_-]{32,}\b/g;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const URL_RX = /\b([a-z][a-z\d+.-]*):\/\/[^\s"'<>)]+/gi;
const WINDOWS_USER =
  /([A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/])[^\\/\s"']+/gi;
const UNIX_USER = /(\/(?:home|Users)\/)[^/\s"']+/g;

/** A URL reduced to its scheme and host, never its path, user or query. */
function hostOnly(match, scheme) {
  try {
    const url = new URL(match);
    return url.hostname ? `${scheme}://${url.hostname}/…` : `${scheme}://…`;
  } catch {
    return `${scheme}://…`;
  }
}

/**
 * Text safe to share: addresses reduced to their host, long tokens and
 * e-mails replaced, the user folder hidden. `home` is the user's folder
 * when known, replaced wherever it appears.
 */
export function sanitize(value, { home = "", max = 400 } = {}) {
  let text = String(value ?? "");
  if (home && home.length > 3) text = text.split(home).join("~");
  text = text
    .replace(URL_RX, hostOnly)
    .replace(JWT, "[رمز]")
    .replace(EMAIL, "[بريد]")
    .replace(WINDOWS_USER, "$1~")
    .replace(UNIX_USER, "$1~")
    .replace(LONG_SECRET, "[مفتاح]")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ");
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** One captured error, sanitized and dated. */
export function errorEntry(where, error, { home = "", now = Date.now() } = {}) {
  const message =
    error instanceof Error
      ? `${error.name !== "Error" ? `${error.name}: ` : ""}${error.message}`
      : String(error ?? "");
  const stack =
    error instanceof Error && error.stack
      ? error.stack.split("\n").slice(1, 4).join(" | ")
      : "";
  return {
    at: new Date(now).toISOString(),
    where: sanitize(where, { home, max: 60 }),
    message: sanitize(message, { home, max: 300 }),
    ...(stack ? { stack: sanitize(stack, { home, max: 300 }) } : {}),
  };
}

/** A ring of recent errors, newest last. */
export class ErrorLog {
  constructor(limit = ERROR_LIMIT) {
    this.limit = limit;
    this.items = [];
  }
  add(where, error, options) {
    this.items.push(errorEntry(where, error, options));
    if (this.items.length > this.limit) this.items.shift();
  }
  list() {
    return [...this.items];
  }
}

/** Renderer errors sent with the request, re-sanitized and capped. */
export function cleanRendererErrors(input, options = {}) {
  if (!Array.isArray(input)) return [];
  return input
    .slice(-ERROR_LIMIT)
    .filter((e) => e && typeof e === "object")
    .map((e) => ({
      at: typeof e.at === "string" ? e.at.slice(0, 30) : "",
      where: sanitize(e.where, { ...options, max: 60 }),
      message: sanitize(e.message, { ...options, max: 300 }),
    }));
}

/** The worst status among checks, and how many of each. */
export function summarize(checks = []) {
  const counts = { ok: 0, warn: 0, fail: 0, skip: 0 };
  for (const c of checks) counts[c.status in counts ? c.status : "skip"]++;
  const status = counts.fail ? "fail" : counts.warn ? "warn" : "ok";
  return { status, counts };
}

/** A check result with its timing, never throwing. */
export async function runCheck(id, label, fn, { timeout = 15000 } = {}) {
  const started = Date.now();
  let timer;
  try {
    const result = await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`انتهت المهلة (${timeout / 1000} ث)`)),
          timeout,
        );
      }),
    ]);
    clearTimeout(timer);
    return {
      id,
      label,
      status: result?.status || "ok",
      detail: result?.detail || "",
      ...(result?.data ? { data: result.data } : {}),
      ms: Date.now() - started,
    };
  } catch (error) {
    clearTimeout(timer);
    return {
      id,
      label,
      status: "fail",
      detail: error?.message || String(error),
      ms: Date.now() - started,
    };
  }
}

const line = (key, value) =>
  value === undefined || value === null || value === ""
    ? ""
    : `${key}: ${typeof value === "object" ? JSON.stringify(value) : value}\n`;

/**
 * The report as plain text to paste in a message: a summary first, then
 * every check, the counts, the settings that matter and recent errors. The
 * same sanitizer runs over the finished text as a last guard.
 */
export function formatReport(report, { home = "" } = {}) {
  const { status, counts } = summarize(report.checks);
  let out = "";
  out += `=== تقرير تشخيص رِواق ===\n`;
  out += `الحالة العامة: ${STATUS_LABEL[status]} · ${counts.ok} سليم، ${counts.warn} تنبيه، ${counts.fail} مشكلة\n`;
  out += line("وقت التقرير", report.generatedAt);
  out += "\n--- التطبيق والنظام ---\n";
  for (const [k, v] of Object.entries(report.app || {})) out += line(k, v);
  for (const [k, v] of Object.entries(report.system || {})) out += line(k, v);
  out += "\n--- الفحوص ---\n";
  for (const c of report.checks || []) {
    out += `[${STATUS_ICON[c.status] || "?"}] ${c.label} (${c.id}, ${c.ms} ms)${c.detail ? ` — ${c.detail}` : ""}\n`;
    if (c.data) out += `    ${JSON.stringify(c.data)}\n`;
  }
  out += "\n--- البيانات ---\n";
  for (const [k, v] of Object.entries(report.counts || {})) out += line(k, v);
  out += "\n--- الإعدادات ---\n";
  for (const [k, v] of Object.entries(report.settings || {})) out += line(k, v);
  const errors = [
    ...(report.errors?.main || []).map((e) => ({ ...e, side: "main" })),
    ...(report.errors?.renderer || []).map((e) => ({ ...e, side: "ui" })),
  ];
  out += `\n--- آخر الأخطاء (${errors.length}) ---\n`;
  for (const e of errors)
    out += `${e.at} [${e.side}] ${e.where}: ${e.message}${e.stack ? `\n    ${e.stack}` : ""}\n`;
  out += "\n(لا يحتوي التقرير مفاتيح أو روابط إضافات أو كلمات مرور)\n";
  return sanitize(out, { home, max: 200000 });
}

/**
 * Settings worth knowing in a report: choices only. Lists of titles,
 * themes, memories, rules and anything free-text stay out.
 */
export function reportSettings(settings = {}) {
  const out = {};
  for (const [key, value] of Object.entries(settings)) {
    if (
      [
        "seriesMemory",
        "countdowns",
        "savedThemes",
        "badgeRules",
        "badgeArt",
        "streamFilters",
        "homeOrder",
        "homeHidden",
        "mpvPath",
        "customShader",
        "prayerCustom",
        "serverUrl",
      ].includes(key)
    )
      continue;
    if (key === "appearance" && value && typeof value === "object") {
      const { colors, wallpaper, logoImage, customFont, ...rest } = value;
      out.appearance = {
        ...rest,
        wallpaper: !!wallpaper,
        logoImage: !!logoImage,
      };
      continue;
    }
    if (["boolean", "number"].includes(typeof value)) out[key] = value;
    else if (typeof value === "string" && value.length <= 40) out[key] = value;
    else if (Array.isArray(value)) out[key] = `[${value.length}]`;
  }
  if (settings.mpvPath) out.mpvPath = "مخصّص";
  if (settings.serverUrl)
    out.serverUrl = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(
      settings.serverUrl,
    )
      ? settings.serverUrl
      : "مخصّص";
  return out;
}
