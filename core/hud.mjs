/**
 * The player HUD: a transparent window laid exactly over the video surface,
 * so controls can be drawn over the picture (HTML cannot paint over the
 * native MPV surface inside the main window) and the pointer is hidden by
 * our own page rather than by MPV.
 */

/**
 * The HUD's screen rectangle in DIPs. `surface` is the rectangle React
 * reported in CSS pixels, `content` the main window's content bounds in
 * DIPs, and `zoom` the page zoom that turns CSS pixels into DIPs.
 */
export function hudRect({ content, surface, zoom = 1 }) {
  if (!content || !surface) return null;
  const z = Number(zoom) > 0 ? Number(zoom) : 1;
  const x = Math.round(content.x + surface.x * z);
  const y = Math.round(content.y + surface.y * z);
  const right = Math.min(
    content.x + content.width,
    Math.round(content.x + (surface.x + surface.width) * z),
  );
  const bottom = Math.min(
    content.y + content.height,
    Math.round(content.y + (surface.y + surface.height) * z),
  );
  const width = right - x;
  const height = bottom - y;
  if (!(width >= 40 && height >= 40)) return null;
  return { x, y, width, height };
}

/** Whether two rectangles are the same (a placement that changes nothing). */
export const sameRect = (a, b) =>
  !!a &&
  !!b &&
  a.x === b.x &&
  a.y === b.y &&
  a.width === b.width &&
  a.height === b.height;

/**
 * The part of the app's state the HUD page reads: settings (subtitles,
 * controls, language), key bindings and progress (watched marks).
 * The whole state (addons, library, lists, collections) can run to
 * megabytes, and the HUD gets it on every change while a title plays.
 */
export function hudState(state) {
  if (!state || typeof state !== "object") return null;
  return {
    settings: state.settings,
    progress: state.progress,
    hotkeys: state.hotkeys,
  };
}

/**
 * Whether the HUD should be on screen: a full-size viewing whose surface is
 * visible, with the overlay enabled and the main window not minimised. In
 * MPV's own true-HDR window there is no surface inside Riwaq: the HUD lies
 * over that window instead (main finds it, `separateRect`).
 */
export function hudVisible({
  enabled,
  player = {},
  surfaceVisible,
  minimized,
}) {
  return (
    enabled !== false &&
    !!player.active &&
    !player.pip &&
    (!!player.separate || !!surfaceVisible) &&
    !minimized
  );
}

/**
 * The HUD's rectangle over MPV's own window, in DIPs. `client` is that
 * window's client area in physical pixels (Win32), `toDip` converts it
 * (Electron's screen.screenToDipRect). Null while the window is missing,
 * minimised or too small to carry the controls.
 */
export function separateRect(client, toDip) {
  if (!client || client.minimized || !client.visible) return null;
  if (!(client.width >= 40 && client.height >= 40)) return null;
  const dip = toDip({
    x: client.x,
    y: client.y,
    width: client.width,
    height: client.height,
  });
  if (!dip || !(dip.width >= 40 && dip.height >= 40)) return null;
  return {
    x: Math.round(dip.x),
    y: Math.round(dip.y),
    width: Math.round(dip.width),
    height: Math.round(dip.height),
  };
}

/**
 * HUD controls that act on Riwaq's own window, which sits behind MPV's
 * true-HDR window: they are left out there. Its full screen still follows a
 * double click and the full screen key.
 */
export const SEPARATE_HIDDEN = new Set(["pip", "settings", "fullscreen"]);

/** A loaded transparent page is not proof that its controls are alive. */
export class HudHealth {
  constructor({ now = () => Date.now(), maxAge = 3500 } = {}) {
    this.now = now;
    this.maxAge = maxAge;
    this.reset();
  }
  /** A new viewing, a reload or a new page: its heartbeat starts again. */
  reset() {
    this.at = -Infinity;
    this.videoId = null;
    this.since = this.now();
  }
  report(viewing, report = {}) {
    if (
      !viewing?.active ||
      !report.active ||
      report.videoId !== viewing.videoId
    ) {
      // A mismatched report never extends the grace below.
      this.at = -Infinity;
      this.videoId = null;
      return false;
    }
    this.at = this.now();
    this.videoId = report.videoId;
    return true;
  }
  /** Whether the HUD may cover MPV's window: it reported this viewing. */
  usable(viewing) {
    return (
      !!viewing?.active &&
      viewing.videoId === this.videoId &&
      this.now() - this.at <= this.maxAge
    );
  }
  /**
   * Whether the theater may keep the HUD layout. A viewing that has just
   * begun (or a page that has just loaded) gets the same grace as a missed
   * heartbeat, so the layout does not switch to the fallback and back at
   * every start; a page that stays silent past it loses the layout.
   */
  alive(viewing) {
    if (!viewing?.active) return true;
    const now = this.now();
    return now - this.at <= this.maxAge || now - this.since <= this.maxAge;
  }
}

/**
 * The only actions the HUD page may ask of main. It is a second renderer, so
 * it gets less than the main window: playback, subtitles and its own panel.
 */
export const HUD_METHODS = new Set([
  "playbackMenu",
  "playbackAction",
  "init",
  "playerCommand",
  "playerKey",
  "trickplay",
  "stop",
  "subtitles",
  "subtitle",
  "subtitleCues",
  "localSubtitle",
  "settings",
  "hudRequest",
  "hudIdle",
  "hudSnapshot",
  "metadata",
  "playerSources",
  "switchSource",
]);

/** Requests the HUD may forward to the main window's interface. */
export const HUD_REQUESTS = new Set([
  "settings",
  "next",
  "previous",
  "episode",
]);
