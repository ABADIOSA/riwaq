/**
 * Riwaq's video surface (electron/video-host.mjs) and MPV's own window inside
 * it. MPV creates its window at the surface's size of that moment and follows
 * later changes through a Windows event it can miss. A window created while
 * the surface was still 1×1 (MPV starts idle and opens its window at once)
 * stayed one pixel: the sound played, MPV reported frames, and the viewer saw
 * the surface's grey background until a restart. Riwaq therefore places the
 * surface before MPV starts and keeps MPV's window at the surface's size
 * itself. Browser-safe: the Win32 calls stay in electron/video-host.mjs.
 */

/**
 * The surface's rectangle in physical pixels from the layout React reported
 * (CSS pixels) and the window's client area. Null when the report is unusable;
 * a zero width or height means "nothing to show".
 */
export function surfaceRect(layout, client) {
  if (!layout || !client) return null;
  const { x, y, width, height, viewportWidth } = layout;
  if (
    ![x, y, width, height, viewportWidth].every(Number.isFinite) ||
    width < 1 ||
    height < 1 ||
    viewportWidth < 1
  )
    return null;
  // A minimized window has no client area: the rectangle is then empty.
  const right = Math.max(0, Number(client.right) || 0),
    bottom = Math.max(0, Number(client.bottom) || 0);
  const scale = right / viewportWidth;
  const left = Math.max(0, Math.round(x * scale)),
    top = Math.max(0, Math.round(y * scale));
  return {
    left,
    top,
    width: Math.max(0, Math.min(right - left, Math.round(width * scale))),
    height: Math.max(0, Math.min(bottom - top, Math.round(height * scale))),
  };
}

/**
 * What MPV's window needs to fill a shown surface: a new size, showing, both,
 * or null when it already fits (a pixel of rounding is allowed).
 */
export function childFix(host, child) {
  if (!host?.visible || !(host.width > 1) || !(host.height > 1) || !child)
    return null;
  const resize =
    Math.abs((Number(child.width) || 0) - host.width) > 1 ||
    Math.abs((Number(child.height) || 0) - host.height) > 1;
  const show = !child.visible;
  return resize || show
    ? { resize, show, width: host.width, height: host.height }
    : null;
}

/** Whether one of MPV's windows covers the surface (the diagnostic's test). */
export function outputFits(size, outputs = []) {
  return outputs.some(
    (o) =>
      o?.visible &&
      (size?.width > 0 && size?.height > 0
        ? o.width >= size.width - 2 && o.height >= size.height - 2
        : o.width > 0 && o.height > 0),
  );
}

/** Checks in a row that had to correct MPV's window before one restart. */
export const SURFACE_FIX_LIMIT = 3;

/**
 * Counts corrections per viewing: a window that needs fixing on several
 * checks in a row is not taking the new size, and the viewing restarts once
 * (the surface then already has its size, so MPV's new window starts right).
 */
export class SurfaceWatch {
  constructor(limit = SURFACE_FIX_LIMIT) {
    this.limit = limit;
    this.reset();
  }
  /** A fresh start forgets everything; a restart keeps the one restart. */
  reset({ keepRestart = false } = {}) {
    this.fixes = 0;
    if (!keepRestart) this.restarted = false;
  }
  /** "ok", "fixed", or "restart" (at most once until a fresh start). */
  note(fixed) {
    if (!fixed) {
      this.fixes = 0;
      return "ok";
    }
    this.fixes++;
    if (this.fixes >= this.limit && !this.restarted) {
      this.restarted = true;
      this.fixes = 0;
      return "restart";
    }
    return "fixed";
  }
}
