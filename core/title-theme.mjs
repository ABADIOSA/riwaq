/**
 * A title's own theme on its page (`titleTheme`): the accent colours follow
 * the title, taken from its artwork when the picture can be read, else from
 * its genres. They apply as variables on the title page element only, never
 * on the app root, so nothing outside the page repaints. "off" keeps the
 * viewer's own palette. Browser-safe; the page samples the picture.
 */
import { tasteGenres } from "./taste.mjs";
import { contrast } from "./appearance.mjs";

export const TITLE_THEME_MODES = ["artwork", "genre", "off"];

/** A colour per genre, in the order genres are looked at. */
export const GENRE_THEMES = [
  ["horror", "#C8323C"],
  ["thriller", "#2BB3A3"],
  ["crime", "#7D8FB3"],
  ["scifi", "#3FA9F5"],
  ["fantasy", "#9B6CF2"],
  ["animation", "#F2709C"],
  ["family", "#5CC8F0"],
  ["comedy", "#F5C342"],
  ["romance", "#EE6A8D"],
  ["action", "#F28A2E"],
  ["adventure", "#E6A23C"],
  ["mystery", "#6F7BD9"],
  ["history", "#C9A46A"],
  ["documentary", "#5DBB7A"],
  ["music", "#E05FD0"],
  ["drama", "#D9A15B"],
];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const hex = (rgb) =>
  `#${rgb.map((c) => clamp(Math.round(c), 0, 255).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
const rgbOf = (value) =>
  [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));

export function rgbToHsl([r, g, b]) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r
      ? (g - b) / d + (g < b ? 6 : 0)
      : max === g
        ? (b - r) / d + 2
        : (r - g) / d + 4;
  return [h * 60, s, l];
}

export function hslToRgb([h, s, l]) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/**
 * The picture's most present vivid colour, from RGBA pixels (a small canvas
 * sample): pixels are grouped by hue, weighted by saturation, and the
 * heaviest group's average wins. Null when the picture is nearly grey.
 */
export function dominantColor(pixels, { step = 4 } = {}) {
  if (!pixels || pixels.length < 4) return null;
  const buckets = Array.from({ length: 12 }, () => ({
    w: 0,
    r: 0,
    g: 0,
    b: 0,
  }));
  let sampled = 0,
    vivid = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4 * step) {
    if (pixels[i + 3] < 128) continue;
    sampled++;
    const rgb = [pixels[i], pixels[i + 1], pixels[i + 2]];
    const [h, s, l] = rgbToHsl(rgb);
    if (s < 0.25 || l < 0.12 || l > 0.88) continue;
    vivid++;
    const w = s * (1 - Math.abs(l - 0.5));
    const bucket = buckets[Math.floor(h / 30) % 12];
    bucket.w += w;
    bucket.r += rgb[0] * w;
    bucket.g += rgb[1] * w;
    bucket.b += rgb[2] * w;
  }
  // Fewer than 4% vivid pixels: a grey or monochrome picture says nothing.
  if (!sampled || vivid / sampled < 0.04) return null;
  const best = buckets.reduce((a, b) => (b.w > a.w ? b : a));
  return best.w ? [best.r / best.w, best.g / best.w, best.b / best.w] : null;
}

/** A colour from the title's genres, or null. */
export function genreColor(meta) {
  const genres = tasteGenres(meta);
  return GENRE_THEMES.find(([id]) => genres.includes(id))?.[1] || null;
}

/**
 * An accent that reads well on the page: vivid but not neon, light enough on
 * a dark palette (or dark enough on a light one).
 */
export function readableAccent(rgb, { light = false } = {}) {
  const [h, s, l] = rgbToHsl(rgb);
  return hex(
    hslToRgb([
      h,
      clamp(s, 0.45, 0.82),
      light ? clamp(l, 0.36, 0.46) : clamp(l, 0.56, 0.68),
    ]),
  );
}

/**
 * The page's variables for a title, or null (theme off, or nothing to go
 * on). `rgb` is the sampled artwork colour when there is one.
 */
export function titleTheme(
  meta,
  { mode = "artwork", rgb = null, light = false, gradient = "diagonal" } = {},
) {
  if (mode === "off" || !TITLE_THEME_MODES.includes(mode)) return null;
  const fromArt = mode === "artwork" && Array.isArray(rgb) ? rgb : null;
  const genre = genreColor(meta);
  if (!fromArt && !genre) return null;
  const accent = readableAccent(fromArt || rgbOf(genre), { light });
  const [h, s, l] = rgbToHsl(rgbOf(accent));
  const end = hex(hslToRgb([h + 28, s, clamp(l - 0.08, 0.3, 0.6)]));
  const ink =
    contrast(accent, "#111111") >= contrast(accent, "#FFFFFF")
      ? "#141210"
      : "#FFFFFF";
  const direction = { horizontal: "90deg", vertical: "180deg" }[gradient];
  return {
    accent,
    source: fromArt ? "artwork" : "genre",
    vars: {
      "--accent": accent,
      "--accent-end": end,
      "--accent-soft": `${accent}26`,
      "--accent-ink": ink,
      "--accent-fill":
        gradient === "off"
          ? accent
          : `linear-gradient(${direction || "135deg"}, ${accent}, ${end})`,
      "--title-tint": `${accent}1F`,
    },
  };
}
