/**
 * One lock on the page's scrolling for everything that covers it (issue
 * #135): dialogs (Modal, the narrow navigation drawer), the title page and
 * See all, and the gallery viewer. Each holder takes the lock and gives it
 * back; the page scrolls again only when the last one is gone, so closing
 * an inner dialog never frees the page under an outer one. The offset and
 * the inline styles it found are put back when it is released.
 *
 * Besides the document, a holder may name other scrollers to freeze (the
 * gallery viewer freezes the title page it sits on).
 */
const holders = new Set();
let saved = null;
const frozen = new Map();

function freeze(el) {
  const entry = frozen.get(el);
  if (entry) return void entry.count++;
  frozen.set(el, {
    count: 1,
    overflow: el.style.overflow,
    gutter: el.style.scrollbarGutter,
    top: el.scrollTop,
    left: el.scrollLeft,
  });
  el.style.scrollbarGutter = "stable";
  el.style.overflow = "hidden";
}

function thaw(el) {
  const entry = frozen.get(el);
  if (!entry || --entry.count > 0) return;
  frozen.delete(el);
  el.style.overflow = entry.overflow;
  el.style.scrollbarGutter = entry.gutter;
  if (el.scrollTop !== entry.top) el.scrollTop = entry.top;
  if (el.scrollLeft !== entry.left) el.scrollLeft = entry.left;
}

export function lockScroll(...scrollers) {
  if (typeof document === "undefined") return () => {};
  const root = document.documentElement;
  const holder = {};
  if (!holders.size)
    saved = {
      overflow: root.style.overflow,
      gutter: root.style.scrollbarGutter,
      x: window.scrollX,
      y: window.scrollY,
    };
  holders.add(holder);
  root.style.scrollbarGutter = "stable";
  root.style.overflow = "hidden";
  const own = scrollers.filter(Boolean);
  for (const el of own) freeze(el);
  return () => {
    if (!holders.delete(holder)) return;
    for (const el of own) thaw(el);
    if (holders.size) return;
    root.style.overflow = saved.overflow;
    root.style.scrollbarGutter = saved.gutter;
    if (window.scrollX !== saved.x || window.scrollY !== saved.y)
      window.scrollTo(saved.x, saved.y);
    saved = null;
  };
}

/** How many holders keep the page still (for tests). */
export const scrollLocks = () => holders.size;
