/**
 * The element that scrolls vertically around `el`: its nearest scrolling
 * ancestor (a title page, See all), else the page itself.
 */
export function verticalScroller(el) {
  for (
    let n = el?.parentElement;
    n && n !== document.body;
    n = n.parentElement
  ) {
    const overflow = getComputedStyle(n).overflowY;
    if (
      (overflow === "auto" || overflow === "scroll") &&
      n.scrollHeight > n.clientHeight + 1
    )
      return n;
  }
  return document.scrollingElement || document.documentElement;
}
const canScroll = (n) => n && n.scrollHeight > n.clientHeight + 1;
// Instant, so a smooth-scrolling page still follows the pointer exactly.
const scrollTop = (n, top) => n.scrollTo({ top, behavior: "instant" });

/**
 * Mouse dragging complements native touch/trackpad scrolling and row
 * arrows. A sideways drag moves the row; a drag that is mostly up or down
 * moves the page around it instead (issue #111), so dragging over posters
 * moves what is under the pointer in every direction.
 */
export function attachDragScroll(el) {
  let gesture = null;
  let suppressClick = false;
  const reset = () => {
    const previous = gesture;
    gesture = null;
    el.classList.remove("is-dragging");
    if (previous && el.hasPointerCapture?.(previous.id))
      el.releasePointerCapture(previous.id);
  };
  const down = (e) => {
    suppressClick = false;
    if (
      e.pointerType !== "mouse" ||
      e.button !== 0 ||
      e.ctrlKey ||
      e.metaKey ||
      e.shiftKey ||
      e.altKey
    )
      return;
    if (
      e.target.closest(
        "input,select,textarea,[contenteditable=true],.poster-remove",
      )
    )
      return;
    gesture = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      left: el.scrollLeft,
      dragging: false,
    };
    // Prevent window-drag-anywhere from moving the entire application.
    e.stopPropagation();
  };
  const move = (e) => {
    if (!gesture || e.pointerId !== gesture.id) return;
    if (!(e.buttons & 1)) return reset();
    const dx = e.clientX - gesture.x;
    const dy = e.clientY - gesture.y;
    if (!gesture.dragging) {
      if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) {
        const scroller = verticalScroller(el);
        if (!canScroll(scroller)) return reset();
        gesture.scroller = scroller;
        gesture.top = scroller.scrollTop;
      } else if (Math.abs(dx) < 8 || el.scrollWidth <= el.clientWidth) return;
      gesture.dragging = true;
      suppressClick = true;
      el.classList.add("is-dragging");
      el.setPointerCapture(e.pointerId);
    }
    e.preventDefault();
    if (gesture.scroller) scrollTop(gesture.scroller, gesture.top - dy);
    else el.scrollLeft = gesture.left - dx;
  };
  const up = (e) => {
    if (gesture?.id === e.pointerId) reset();
  };
  const click = (e) => {
    if (!suppressClick || e.detail === 0) return;
    suppressClick = false;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const nativeDrag = (e) => {
    if (gesture) e.preventDefault();
  };
  const mouseDown = (e) => {
    if (gesture) e.stopPropagation();
  };
  el.addEventListener("pointerdown", down);
  el.addEventListener("mousedown", mouseDown);
  el.addEventListener("click", click, true);
  el.addEventListener("dragstart", nativeDrag);
  el.addEventListener("lostpointercapture", up);
  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
  window.addEventListener("blur", reset);
  return () => {
    reset();
    el.removeEventListener("pointerdown", down);
    el.removeEventListener("mousedown", mouseDown);
    el.removeEventListener("click", click, true);
    el.removeEventListener("dragstart", nativeDrag);
    el.removeEventListener("lostpointercapture", up);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    window.removeEventListener("blur", reset);
  };
}

/** One deliberate horizontal showcase gesture; native vertical page scroll stays free. */
export function attachHeroSwipe(el, navigate, held) {
  let gesture = null;
  let suppressClick = false;
  const reset = () => {
    const previous = gesture;
    gesture = null;
    el.classList.remove("is-dragging");
    held(false);
    if (previous && el.hasPointerCapture?.(previous.id))
      el.releasePointerCapture(previous.id);
  };
  const down = (e) => {
    suppressClick = false;
    if (
      e.isPrimary === false ||
      e.button !== 0 ||
      e.ctrlKey ||
      e.metaKey ||
      e.shiftKey ||
      e.altKey ||
      e.target.closest(
        "button,a,input,select,textarea,[role=button],[contenteditable=true]",
      )
    )
      return;
    gesture = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      dx: 0,
      dragging: false,
    };
    held(true);
    e.stopPropagation();
  };
  const move = (e) => {
    if (!gesture || e.pointerId !== gesture.id) return;
    if (e.pointerType === "mouse" && !(e.buttons & 1)) return reset();
    const dx = e.clientX - gesture.x;
    const dy = e.clientY - gesture.y;
    if (!gesture.dragging) {
      if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) return reset();
      if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy)) return;
      gesture.dragging = true;
      suppressClick = true;
      el.classList.add("is-dragging");
      el.setPointerCapture(e.pointerId);
    }
    gesture.dx = dx;
    e.preventDefault();
  };
  const up = (e) => {
    if (gesture?.id !== e.pointerId) return;
    const previous = gesture;
    reset();
    if (previous.dragging && Math.abs(previous.dx) >= 48) {
      const rtl = getComputedStyle(el).direction === "rtl";
      navigate(previous.dx > 0 === rtl ? 1 : -1);
    }
  };
  const cancel = (e) => {
    if (gesture?.id === e.pointerId) reset();
  };
  const click = (e) => {
    if (!suppressClick || e.detail === 0) return;
    suppressClick = false;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const mouseDown = (e) => {
    if (gesture) e.stopPropagation();
  };
  const nativeDrag = (e) => {
    if (gesture) e.preventDefault();
  };
  el.addEventListener("pointerdown", down);
  el.addEventListener("mousedown", mouseDown);
  el.addEventListener("dragstart", nativeDrag);
  el.addEventListener("click", click, true);
  el.addEventListener("lostpointercapture", cancel);
  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("blur", reset);
  return () => {
    reset();
    el.removeEventListener("pointerdown", down);
    el.removeEventListener("mousedown", mouseDown);
    el.removeEventListener("dragstart", nativeDrag);
    el.removeEventListener("click", click, true);
    el.removeEventListener("lostpointercapture", cancel);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("blur", reset);
  };
}

/**
 * Vertical mouse dragging over poster grids (issue #111): See all, the
 * library, Discover's catalog grid, folders and collections. One listener
 * on `root` serves every grid, present or mounted later. A drag that is
 * mostly up or down moves the grid's scroller; a short press still opens
 * the card, a drag never does, and right-click keeps the poster actions.
 * Rows handle their own gestures (attachDragScroll stops their presses).
 */
export function attachGridDrag(root = document) {
  let gesture = null;
  let suppressClick = false;
  const reset = () => {
    gesture?.grid.classList.remove("is-dragging");
    gesture = null;
  };
  const down = (e) => {
    suppressClick = false;
    if (
      e.pointerType !== "mouse" ||
      e.button !== 0 ||
      e.ctrlKey ||
      e.metaKey ||
      e.shiftKey ||
      e.altKey
    )
      return;
    const grid = e.target.closest?.(".poster-grid");
    if (
      !grid ||
      e.target.closest(
        "input,select,textarea,[contenteditable=true],.poster-remove,.scroll-row",
      )
    )
      return;
    gesture = { id: e.pointerId, x: e.clientX, y: e.clientY, grid };
  };
  const move = (e) => {
    if (!gesture || e.pointerId !== gesture.id) return;
    if (!(e.buttons & 1)) return reset();
    const dx = e.clientX - gesture.x;
    const dy = e.clientY - gesture.y;
    if (!gesture.scroller) {
      if (Math.abs(dx) > 8 && Math.abs(dx) >= Math.abs(dy)) return reset();
      if (Math.abs(dy) < 8) return;
      const scroller = verticalScroller(gesture.grid);
      if (!canScroll(scroller)) return reset();
      gesture.scroller = scroller;
      gesture.top = scroller.scrollTop;
      suppressClick = true;
      gesture.grid.classList.add("is-dragging");
    }
    e.preventDefault();
    scrollTop(gesture.scroller, gesture.top - dy);
  };
  const up = (e) => {
    if (gesture?.id === e.pointerId) reset();
  };
  const click = (e) => {
    if (!suppressClick || e.detail === 0) return;
    suppressClick = false;
    if (!e.target.closest?.(".poster-grid")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const nativeDrag = (e) => {
    if (gesture) e.preventDefault();
  };
  const select = (e) => {
    if (gesture?.scroller) e.preventDefault();
  };
  root.addEventListener("pointerdown", down);
  root.addEventListener("click", click, true);
  root.addEventListener("dragstart", nativeDrag);
  root.addEventListener("selectstart", select);
  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
  window.addEventListener("blur", reset);
  return () => {
    reset();
    root.removeEventListener("pointerdown", down);
    root.removeEventListener("click", click, true);
    root.removeEventListener("dragstart", nativeDrag);
    root.removeEventListener("selectstart", select);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    window.removeEventListener("blur", reset);
  };
}
