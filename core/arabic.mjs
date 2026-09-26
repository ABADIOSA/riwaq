// Shared by main and React. No network or platform dependencies.

// Arabic-Indic and Extended Arabic-Indic (Persian/Urdu) digits.
const DIGITS = /[٠-٩۰-۹]/g;

/**
 * Folds text for search. Library titles and channel names are typed by people
 * who drop diacritics, write ه for ة, ا for أ/إ/آ and ي for ى, mix Persian
 * letter forms and Arabic-Indic digits, and space or hyphenate names
 * inconsistently. Two spellings a reader would call the same word fold to the
 * same string, so "القاهره" finds "القاهرة" and "mbc 2" finds "إم بي سي ٢".
 */
export function foldArabic(value) {
  return (
    String(value ?? "")
      // NFKD splits أ إ آ ؤ ئ into a base letter plus a hamza or madda mark,
      // which the next step removes along with harakat and Latin accents.
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[̀-ًͯ-ٰٟـ]/g, "")
      .replace(/ٱ/g, "ا")
      .replace(/[ىی]/g, "ي")
      .replace(/ک/g, "ك")
      .replace(/ة/g, "ه")
      .replace(DIGITS, (digit) => String(digit.charCodeAt(0) & 0xf))
      .replace(/[^\p{L}\p{N}]/gu, "")
  );
}

/** True when `haystack` contains `needle` once both are folded. */
export function matchesArabic(haystack, needle) {
  const folded = foldArabic(needle);
  return !folded || foldArabic(haystack).includes(folded);
}

const plural = new Intl.PluralRules("ar");
/**
 * Arabic counts agree with their number: حلقة واحدة، حلقتان، 3 حلقات، 11 حلقة،
 * 103 حلقات. `forms` gives each plural category; `{n}` is replaced by the
 * number, and a missing category falls back to `other`.
 */
export function arabicCount(n, forms) {
  const form = forms[plural.select(n)] ?? forms.other;
  return String(form).replace("{n}", String(n));
}
export const EPISODES = {
  zero: "لا حلقات",
  one: "حلقة واحدة",
  two: "حلقتان",
  few: "{n} حلقات",
  many: "{n} حلقة",
  other: "{n} حلقة",
};
export const MINUTES = {
  zero: "أقل من دقيقة",
  one: "دقيقة واحدة",
  two: "دقيقتان",
  few: "{n} دقائق",
  many: "{n} دقيقة",
  other: "{n} دقيقة",
};
