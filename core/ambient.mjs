/**
 * The artwork glow behind the app (appearance `ambient: "artwork"`), and
 * how it follows the viewer.
 *
 * - `ambientFollow`: `hover` (the default) takes the glow from the title
 *   under the pointer or keyboard focus; `hero` keeps it on the hero, or on
 *   the open title page.
 * - `ambientDelay`: how long the pointer rests on a card before the glow
 *   changes, so sweeping across a row does not flicker.
 * - `ambientLeave`: `return` goes back to the hero when the pointer leaves
 *   the cards; `stay` keeps the last title.
 * - `ambientImage`: the title's backdrop or its poster.
 * - `ambientStrength`, `ambientBlur`, `ambientFade`: how strong, how soft
 *   and how slow the change is.
 *
 * The glow is drawn tiny and scaled up: a few-percent layer blurred by 2 to
 * 3 px and stretched twenty to forty times reads as a 40 to 120 px blur of
 * the window at a fraction of the cost. Pure functions; Ambient.jsx draws.
 */

export const AMBIENT_BLURS = {
  // [layer size in viewport percent, scale, blur in px of the small layer]
  soft: [6, 20, 2],
  medium: [4.1, 30, 3],
  strong: [3, 40, 3],
};

/** The glow's settings from a validated appearance, in drawable form. */
export function ambientOptions(a = {}) {
  const [size, scale, blur] =
    AMBIENT_BLURS[a.ambientBlur] || AMBIENT_BLURS.medium;
  return {
    on: a.ambient === "artwork",
    follow: a.ambientFollow === "hero" ? "hero" : "hover",
    leave: a.ambientLeave === "stay" ? "stay" : "return",
    image: a.ambientImage === "poster" ? "poster" : "backdrop",
    delay: clamp(a.ambientDelay, 0, 1500, 250),
    fade: clamp(a.ambientFade, 0, 2000, 700),
    opacity: clamp(a.ambientStrength, 5, 60, 24) / 100,
    size,
    scale,
    blur,
  };
}

const clamp = (value, min, max, fallback) =>
  Number.isFinite(Number(value))
    ? Math.max(min, Math.min(max, Number(value)))
    : fallback;

const https = (value) => {
  if (typeof value !== "string" || value.length > 2000) return "";
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && !url.username && !url.password
      ? url.toString()
      : "";
  } catch {
    return "";
  }
};

/**
 * The picture a card offers the glow: its backdrop (or metahub's by IMDb
 * ID when the addon sent none), or its poster when the viewer prefers it.
 */
export function cardArt(meta = {}) {
  const imdb = String(meta.id || "").split(":")[0];
  const metahub = /^tt\d{5,12}$/.test(imdb)
    ? `https://images.metahub.space/background/medium/${imdb}/img`
    : "";
  return {
    backdrop: https(meta.background) || metahub || https(meta.poster),
    poster: https(meta.poster) || https(meta.background) || metahub,
  };
}

/** What a card element offers, read from its data attributes. */
export function artOfElement(element, image = "backdrop") {
  const data = element?.dataset || {};
  return image === "poster"
    ? https(data.ambientPoster) || https(data.ambient)
    : https(data.ambient) || https(data.ambientPoster);
}

/** The layer's inline style: geometry from the blur choice, never a root variable. */
export function layerStyle(url, options, visible) {
  return {
    backgroundImage: url ? `url("${url}")` : undefined,
    width: `${options.size}vw`,
    height: `${options.size}vh`,
    transform: `scale(${options.scale})`,
    filter: `blur(${options.blur}px) saturate(1.5)`,
    opacity: visible ? options.opacity : 0,
    transition: `opacity ${options.fade}ms ease`,
  };
}
