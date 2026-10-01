/**
 * The home page's arrangement: which sections appear and in what order, and
 * which addon catalog rows are hidden or moved. Catalog rows are named by the
 * opaque keys `catalogPlan` already gives the interface, never by addon URLs.
 * Browser-safe; `safeSettings` validates with the same rules.
 */

export const HOME_SECTIONS = [
  ["hero", "الواجهة الكبيرة"],
  ["countdowns", "العد التنازلي"],
  ["continue", "نكمل الحكاية"],
  ["upnext", "الحلقات التالية"],
  ["collections", "المجموعات المثبّتة"],
  ["services", "خدماتك للبث"],
  ["catalogs", "كتالوجات الإضافات"],
];
export const DEFAULT_HOME_SECTIONS = HOME_SECTIONS.map(([id]) => id);
const KEY = /^[a-f\d]{24}$/;

/** Visible sections in order; unknown and repeated entries are dropped. */
export function safeHomeSections(value) {
  if (!Array.isArray(value)) return [...DEFAULT_HOME_SECTIONS];
  const known = new Set(DEFAULT_HOME_SECTIONS);
  return [...new Set(value.filter((id) => known.has(id)))];
}

/** A list of catalog keys, deduplicated and bounded. */
export function safeCatalogKeys(value) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(value.filter((k) => typeof k === "string" && KEY.test(k))),
  ].slice(0, 500);
}

/**
 * Catalog rows as the viewer arranged them: hidden rows removed, ordered rows
 * first in their order, the rest after in the addons' own order (so a newly
 * installed addon still shows up).
 */
export function arrangeRows(rows, { order = [], hidden = [] } = {}) {
  const hide = new Set(hidden);
  const rank = new Map(order.map((key, i) => [key, i]));
  return rows
    .map((row, i) => ({ row, i }))
    .filter(({ row }) => !hide.has(row.key))
    .sort((a, b) => {
      const ra = rank.has(a.row.key) ? rank.get(a.row.key) : Infinity;
      const rb = rank.has(b.row.key) ? rank.get(b.row.key) : Infinity;
      return ra - rb || a.i - b.i;
    })
    .map(({ row }) => row);
}

/** Moves one catalog in the full plan order and returns the new order. */
export function moveCatalog(plan, order, key, direction) {
  const keys = arrangeRows(plan, { order }).map((p) => p.key);
  const index = keys.indexOf(key);
  const target = index + (direction === "up" ? -1 : 1);
  if (index < 0 || target < 0 || target >= keys.length) return keys;
  [keys[index], keys[target]] = [keys[target], keys[index]];
  return keys;
}
