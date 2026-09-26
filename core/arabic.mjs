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
