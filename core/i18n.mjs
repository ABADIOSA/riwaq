/**
 * The interface language (Arabic, the default, or English).
 *
 * Riwaq's strings are written in Arabic in the code, and the Arabic text is
 * the key: core/i18n/en.mjs maps it to English. A string with no entry stays
 * Arabic, so a missing translation is visible but never breaks a screen.
 * Entries with `{name}` placeholders are patterns for strings built from
 * parts ("بعد {n} دقيقة"); each pattern must keep Arabic words outside its
 * placeholders, so it never matches a viewer's own text. `{n}`, `{n1}`,
 * `{n2}`… match a number only (counts, hours, episode numbers).
 *
 * src/lib/jsx-runtime.js translates the text and labels of every element
 * as it renders; code that writes text elsewhere (the window title, a
 * notification) calls t(). Browser-safe.
 */
import EN from "./i18n/en.mjs";

export const LANGUAGES = ["ar", "en"];
const ARABIC = /[؀-ۿ]/;
const PLACEHOLDER = /\{(\w+)\}/g;

let current = "ar";
let cache = new Map();
let patterns = null;

/** Validates a language code: anything but "en" reads as Arabic. */
export const cleanLanguage = (value) => (value === "en" ? "en" : "ar");

export function setLanguage(value) {
  const next = cleanLanguage(value);
  if (next === current) return false;
  current = next;
  cache = new Map();
  return true;
}
export const language = () => current;
export const direction = (value = current) =>
  cleanLanguage(value) === "en" ? "ltr" : "rtl";
/** The locale dates and numbers are written in (Latin digits either way). */
export const locale = (value = current) =>
  cleanLanguage(value) === "en" ? "en-GB" : "ar-SA";

const escape = (text) => text.replace(/[.*+?^$()|[\]\\]/g, "\\$&");

/** Patterns from the dictionary's placeholder entries, longest first. */
function compiled(dictionary = EN) {
  if (patterns && dictionary === EN) return patterns;
  const list = [];
  for (const [key, value] of Object.entries(dictionary)) {
    if (!key.includes("{")) continue;
    const names = [];
    const source = key
      .split(PLACEHOLDER)
      .map((part, i) => {
        if (i % 2) {
          names.push(part);
          return /^n\d*$/.test(part) ? "([\\d٠-٩][\\d٠-٩,.]*)" : "(.+?)";
        }
        return escape(part);
      })
      .join("");
    list.push({ key, value, names, regex: new RegExp(`^${source}$`, "s") });
  }
  list.sort((a, b) => b.key.length - a.key.length);
  if (dictionary === EN) patterns = list;
  return list;
}

/** The Arabic words of an entry outside its placeholders. */
export const anchorOf = (key) =>
  key.replace(PLACEHOLDER, "").replace(/[^؀-ۿ]/g, "");

/**
 * The English for an Arabic interface string, or the string itself. Leading
 * and trailing spaces are kept, so text beside an expression still reads.
 */
export function translate(text, lang = current, dictionary = EN) {
  if (lang !== "en" || typeof text !== "string" || !ARABIC.test(text))
    return text;
  const useCache = dictionary === EN && lang === current;
  if (useCache && cache.has(text)) return cache.get(text);
  const start = text.match(/^\s*/)[0];
  const end = text.slice(start.length).match(/\s*$/)[0];
  const core = text.slice(start.length, text.length - end.length);
  let out = dictionary[core];
  if (out === undefined)
    for (const p of compiled(dictionary)) {
      const m = p.regex.exec(core);
      if (!m) continue;
      out = p.value.replace(PLACEHOLDER, (all, name) => {
        const at = p.names.indexOf(name);
        return at < 0 ? all : translate(m[at + 1], lang, dictionary);
      });
      break;
    }
  // Riwaq joins labels with " · " ("فيلم · 2024 · دراما"): with no entry
  // for the whole line, each part is translated on its own.
  if (out === undefined && core.includes(" · ")) {
    const parts = core.split(" · ");
    const next = parts.map((part) => translate(part, lang, dictionary));
    if (next.some((part, i) => part !== parts[i])) out = next.join(" · ");
  }
  const result = out === undefined ? text : start + out + end;
  if (useCache) {
    if (cache.size > 5000) cache = new Map();
    cache.set(text, result);
  }
  return result;
}

/**
 * For code that writes text outside React: the Arabic string with its
 * `{name}` values filled in, translated first when the language is English.
 */
export function t(text, vars = {}) {
  const base = current === "en" ? (EN[text] ?? text) : text;
  return base.replace(PLACEHOLDER, (all, name) =>
    vars[name] === undefined ? all : String(vars[name]),
  );
}
