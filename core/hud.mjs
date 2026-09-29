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

/**
 * Whether the HUD should be on screen: a full-size viewing whose surface is
 * visible, with the overlay enabled and the main window not minimised.
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
    !!surfaceVisible &&
    !minimized
  );
}

/**
 * The only actions the HUD page may ask of main. It is a second renderer, so
 * it gets less than the main window: playback, subtitles and its own panel.
 */
export const HUD_METHODS = new Set([
  "init",
  "playerCommand",
  "trickplay",
  "stop",
  "subtitles",
  "subtitle",
  "subtitleCues",
  "localSubtitle",
  "settings",
  "hudRequest",
  "hudIdle",
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
