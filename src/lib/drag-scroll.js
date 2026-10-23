/** Mouse dragging complements native touch/trackpad scrolling and row arrows. */
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
      if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) return reset();
      if (Math.abs(dx) < 8 || el.scrollWidth <= el.clientWidth) return;
      gesture.dragging = true;
      suppressClick = true;
      el.classList.add("is-dragging");
      el.setPointerCapture(e.pointerId);
    }
    e.preventDefault();
    el.scrollLeft = gesture.left - dx;
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
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    window.removeEventListener("blur", reset);
  };
}
