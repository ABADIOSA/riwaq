/**
 * Hiding the pointer over the picture.
 *
 * Neither MPV's cursor-autohide inside the embedded surface nor CSS
 * `cursor: none` in the HUD hides the pointer reliably on Windows: the HUD
 * never takes focus, and Windows applies a new cursor only on the next mouse
 * message, which is the movement that should wake it anyway. Main therefore
 * hides it with Win32 ShowCursor on the thread that owns both windows, the
 * way native players do, and decides when from the pointer position.
 */

export const CURSOR_IDLE_MS = 2500;

const inside = (point, rect) =>
  !!point &&
  !!rect &&
  point.x >= rect.x &&
  point.y >= rect.y &&
  point.x < rect.x + rect.width &&
  point.y < rect.y + rect.height;

/**
 * Whether the pointer should be hidden now.
 * - `region`: the picture's screen rectangle (the HUD's bounds, or the
 *   surface when the HUD is off), in DIPs.
 * - `stillFor`: how long the pointer has not moved.
 * - `hud`: whether the HUD draws the controls; then `hudIdle` (the HUD's own
 *   controls are asleep: not paused, no panel, pointer not over a control)
 *   decides, and focus does not matter because the HUD never takes it.
 * - otherwise the main window must be focused and the viewing not paused.
 */
export function cursorHidden({
  active,
  pip,
  minimized,
  region,
  point,
  stillFor,
  hud,
  hudIdle,
  focused,
  paused,
}) {
  if (!active || pip || minimized || !inside(point, region)) return false;
  if (!(stillFor >= CURSOR_IDLE_MS)) return false;
  return hud ? hudIdle === true : !!focused && !paused;
}

/**
 * Keeps our share of the Win32 cursor display counter balanced: one hide,
 * one matching show, however often it is asked. `showCursor(bool)` is the
 * Win32 function and returns the new counter.
 */
export class CursorGate {
  constructor(showCursor) {
    this.showCursor = showCursor;
    this.hidden = false;
  }
  set(hidden) {
    const want = !!hidden;
    if (want === this.hidden) return false;
    try {
      this.showCursor(!want);
    } catch {
      return false;
    }
    this.hidden = want;
    return true;
  }
  release() {
    return this.set(false);
  }
}
