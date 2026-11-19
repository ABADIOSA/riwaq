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

/**
 * The page's own scrollbar before the lock: its width on each side, in CSS
 * pixels (0 when there is none, or it floats over the page). The lock hides
 * it and the page pads by exactly that much instead (src/tokens.css), so
 * nothing underneath moves and nothing is left beside the layers on top.
 *
 * Issue #149: the lock used to keep the scrollbar's strip with
 * `scrollbar-gutter: stable`. Chromium paints that strip over everything,
 * fixed layers included, so the title page and See all showed their own
 * scrollbar with an empty band after it at the window's edge.
 */
export function scrollbarSides(win = window) {
  const doc = win.document;
  const width = win.innerWidth - doc.documentElement.clientWidth;
  if (!(width > 0 && width < 64)) return { left: 0, right: 0 };
  const probe = doc.createElement("div");
  probe.style.cssText =
    "position:fixed;inset:0;visibility:hidden;pointer-events:none";
  doc.body.append(probe);
  const onLeft = probe.getBoundingClientRect().left > 0.5;
  probe.remove();
  return onLeft ? { left: width, right: 0 } : { left: 0, right: width };
}

export function lockScroll(...scrollers) {
  if (typeof document === "undefined") return () => {};
  const root = document.documentElement;
  const holder = {};
  if (!holders.size) {
    saved = {
      overflow: root.style.overflow,
      x: window.scrollX,
      y: window.scrollY,
    };
    const { left, right } = document.body
      ? scrollbarSides()
      : { left: 0, right: 0 };
    root.style.setProperty("--lock-gutter-left", `${left}px`);
    root.style.setProperty("--lock-gutter-right", `${right}px`);
  }
  holders.add(holder);
  root.style.overflow = "hidden";
  const own = scrollers.filter(Boolean);
  for (const el of own) freeze(el);
  return () => {
    if (!holders.delete(holder)) return;
    for (const el of own) thaw(el);
    if (holders.size) return;
    root.style.overflow = saved.overflow;
    root.style.removeProperty("--lock-gutter-left");
    root.style.removeProperty("--lock-gutter-right");
    if (window.scrollX !== saved.x || window.scrollY !== saved.y)
      window.scrollTo(saved.x, saved.y);
    saved = null;
  };
}

/**
 * Issue #156: the page's start. A destination chosen in the navigation (or
 * the logo) opens at its top, also when it is the page already shown. While
 * something holds the lock (the title page or See all being closed by that
 * same choice, the narrow drawer, a dialog), the offset its release puts
 * back becomes the top, so the release lands there instead of where the old
 * page was; otherwise the page goes there now, smoothly when asked.
 */
export function scrollPageToTop({ smooth = false } = {}) {
  if (typeof window === "undefined") return;
  if (saved) saved.y = 0;
  if (holders.size) return;
  window.scrollTo({
    left: window.scrollX,
    top: 0,
    behavior: smooth ? "smooth" : "instant",
  });
}

/** How many holders keep the page still (for tests). */
export const scrollLocks = () => holders.size;
