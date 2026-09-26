/**
 * Appearance: palettes, type, density, cards and pages. Browser-safe.
 *
 * Everything the viewer can shape is validated here, turned into CSS
 * variables and classes, and can travel as a short text code so a design
 * can be shared with a friend.
 */

const HEX = /^#[0-9A-Fa-f]{6}$/;
const FONT = /^[\p{L}\p{N} ._-]{1,40}$/u;

export const COLOR_KEYS = [
  "bg",
  "panel",
  "raised",
  "text",
  "muted",
  "line",
  "accent",
  "accentEnd",
];

export const COLOR_LABELS = {
  bg: "الخلفية",
  panel: "الألواح",
  raised: "العناصر المرتفعة",
  text: "النص",
  muted: "النص الثانوي",
  line: "الحدود",
  accent: "لون التمييز",
  accentEnd: "نهاية التدرّج",
};

/** Fonts that ship with Windows and carry Arabic glyphs. */
export const FONTS = [
  ["Segoe UI", "Segoe UI · افتراضي"],
  ["Tahoma", "Tahoma"],
  ["Arial", "Arial"],
  ["Sakkal Majalla", "Sakkal Majalla"],
  ["Traditional Arabic", "Traditional Arabic"],
  ["Simplified Arabic", "Simplified Arabic"],
  ["Aldhabi", "Aldhabi"],
  ["Calibri", "Calibri"],
  ["custom", "خط آخر مثبّت على جهازي"],
];

const palette = (bg, panel, raised, text, muted, line, accent, accentEnd) => ({
  bg,
  panel,
  raised,
  text,
  muted,
  line,
  accent,
  accentEnd,
});

export const PRESETS = [
  {
    id: "riwaq",
    name: "رِواق",
    caption: "دفء ذهبي",
    colors: palette(
      "#101215",
      "#191C20",
      "#23272D",
      "#EEEDE9",
      "#919397",
      "#2A2E34",
      "#E7B66E",
      "#F3D39B",
    ),
  },
  {
    id: "noir",
    name: "نوار",
    caption: "أسود سينمائي",
    colors: palette(
      "#0A0B0D",
      "#151619",
      "#1E2024",
      "#F2F2F0",
      "#8E9094",
      "#26282C",
      "#EEEEEC",
      "#B8B8B6",
    ),
  },
  {
    id: "oled",
    name: "OLED",
    caption: "أسود حقيقي للشاشات العضوية",
    colors: palette(
      "#000000",
      "#0B0B0C",
      "#161618",
      "#F4F4F5",
      "#8B8B90",
      "#1F1F22",
      "#E7B66E",
      "#F3D39B",
    ),
  },
  {
    id: "royal-green",
    name: "الأخضر الملكي",
    caption: "أخضر وأبيض بروح جدة",
    colors: palette(
      "#07140E",
      "#0E2218",
      "#153024",
      "#F3FAF6",
      "#9DB7A8",
      "#1D3A2C",
      "#1FB36B",
      "#8BE3B4",
    ),
    gradient: "diagonal",
  },
  {
    id: "harbor",
    name: "المرفأ",
    caption: "هدوء البحر",
    colors: palette(
      "#0D1517",
      "#152125",
      "#1D2C31",
      "#EAF3F3",
      "#8CA3A6",
      "#24363B",
      "#5FC4C0",
      "#9BE2DE",
    ),
  },
  {
    id: "midnight",
    name: "منتصف الليل",
    caption: "أزرق ليلي عميق",
    colors: palette(
      "#0B1020",
      "#131A2E",
      "#1B2440",
      "#E8ECF8",
      "#8C96B4",
      "#232E4F",
      "#7C9CFF",
      "#B7C7FF",
    ),
    gradient: "horizontal",
  },
  {
    id: "aurora",
    name: "الشفق",
    caption: "ليل بنفسجي",
    colors: palette(
      "#120F1A",
      "#1C1728",
      "#261F36",
      "#EFEAF8",
      "#9A91AE",
      "#2E2640",
      "#B28CFF",
      "#FF8CC6",
    ),
    gradient: "diagonal",
  },
  {
    id: "desert",
    name: "رمال",
    caption: "صحراء عند الغروب",
    colors: palette(
      "#17120D",
      "#221A13",
      "#2D231A",
      "#F6EEE4",
      "#AE9D88",
      "#382B1F",
      "#E0925A",
      "#F2C38B",
    ),
    gradient: "horizontal",
  },
  {
    id: "nord",
    name: "نورد",
    caption: "شمال هادئ",
    colors: palette(
      "#151B25",
      "#202A36",
      "#2A3644",
      "#ECEFF4",
      "#98A3B3",
      "#313E4E",
      "#A4C9E8",
      "#C8DDF0",
    ),
  },
  {
    id: "velvet",
    name: "مخمل",
    caption: "ورد مخملي",
    colors: palette(
      "#191317",
      "#251D22",
      "#30262C",
      "#F6ECF0",
      "#AE97A1",
      "#3A2D34",
      "#E7A7B8",
      "#F5CAD6",
    ),
  },
];

export const DEFAULT_APPEARANCE = {
  preset: "riwaq",
  colors: { ...PRESETS[0].colors },
  gradient: "off",
  font: "Segoe UI",
  customFont: "",
  uiScale: 100,
  radius: "rounded",
  density: "comfortable",
  posterRadius: 12,
  posterHover: "lift",
  posterTitles: true,
  heroStyle: "full",
  detailBackground: "backdrop",
  navHidden: [],
};

const choose = (value, options, fallback) =>
  options.includes(value) ? value : fallback;
const number = (value, min, max, fallback) =>
  Number.isFinite(Number(value))
    ? Math.round(Math.max(min, Math.min(max, Number(value))))
    : fallback;

export const HIDEABLE_NAV = [
  ["discover", "اكتشف"],
  ["library", "مكتبتي"],
  ["live", "بث مباشر"],
  ["addons", "الإضافات"],
];

/** Validates appearance from the interface, a backup or a shared code. */
export function safeAppearance(input, current = DEFAULT_APPEARANCE) {
  const base = { ...DEFAULT_APPEARANCE, ...current };
  base.colors = { ...DEFAULT_APPEARANCE.colors, ...(current?.colors || {}) };
  if (!input || typeof input !== "object") return base;
  const next = { ...base, colors: { ...base.colors } };
  if (input.colors && typeof input.colors === "object")
    for (const key of COLOR_KEYS)
      if (HEX.test(input.colors[key]))
        next.colors[key] = input.colors[key].toUpperCase();
  if (typeof input.preset === "string")
    next.preset =
      input.preset === "custom" || PRESETS.some((p) => p.id === input.preset)
        ? input.preset
        : "custom";
  next.gradient = choose(
    input.gradient,
    ["off", "horizontal", "vertical", "diagonal"],
    next.gradient,
  );
  if (FONTS.some(([id]) => id === input.font)) next.font = input.font;
  if (typeof input.customFont === "string")
    next.customFont = FONT.test(input.customFont.trim())
      ? input.customFont.trim()
      : "";
  if ("uiScale" in input)
    next.uiScale = number(input.uiScale, 80, 125, next.uiScale);
  next.radius = choose(input.radius, ["sharp", "rounded", "soft"], next.radius);
  next.density = choose(
    input.density,
    ["compact", "comfortable", "spacious"],
    next.density,
  );
  if ("posterRadius" in input)
    next.posterRadius = number(input.posterRadius, 0, 28, next.posterRadius);
  next.posterHover = choose(
    input.posterHover,
    ["off", "lift", "glow", "shine"],
    next.posterHover,
  );
  if (typeof input.posterTitles === "boolean")
    next.posterTitles = input.posterTitles;
  next.heroStyle = choose(input.heroStyle, ["full", "compact"], next.heroStyle);
  next.detailBackground = choose(
    input.detailBackground,
    ["backdrop", "blur", "solid"],
    next.detailBackground,
  );
  if (Array.isArray(input.navHidden))
    next.navHidden = [
      ...new Set(
        input.navHidden.filter((id) => HIDEABLE_NAV.some(([n]) => n === id)),
      ),
    ];
  return next;
}

// The accent themes before 0.7 map onto the preset closest to each.
const LEGACY = {
  amber: "riwaq",
  noir: "noir",
  teal: "harbor",
  violet: "aurora",
  nord: "nord",
  rose: "velvet",
  forest: "royal-green",
};

/** A saved appearance, or the one matching an older accent choice. */
export function resolveAppearance(settings = {}) {
  if (settings.appearance && typeof settings.appearance === "object")
    return safeAppearance(settings.appearance);
  return applyPreset(DEFAULT_APPEARANCE, LEGACY[settings.accent] || "riwaq");
}

/** The preset's palette, applied as a fresh starting point. */
export function applyPreset(appearance, id) {
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) return safeAppearance(appearance);
  return safeAppearance(
    {
      preset: id,
      colors: preset.colors,
      gradient: preset.gradient || "off",
    },
    appearance,
  );
}

const channels = (hex) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** WCAG relative luminance, used to pick legible text on the accent. */
export function luminance(hex) {
  const [r, g, b] = channels(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

const DIRECTIONS = {
  horizontal: "90deg",
  vertical: "180deg",
  diagonal: "135deg",
};

/** CSS custom properties for the app root. */
export function themeVariables(input) {
  const a = safeAppearance(input);
  const c = a.colors;
  const ink =
    contrast(c.accent, "#111111") >= contrast(c.accent, "#FFFFFF")
      ? "#141210"
      : "#FFFFFF";
  const radius = { sharp: 4, rounded: 10, soft: 18 }[a.radius];
  const gap = { compact: 10, comfortable: 16, spacious: 24 }[a.density];
  const font =
    a.font === "custom" && a.customFont
      ? a.customFont
      : a.font === "custom"
        ? "Segoe UI"
        : a.font;
  return {
    "--bg": c.bg,
    "--panel": c.panel,
    "--raised": c.raised,
    "--text": c.text,
    "--muted": c.muted,
    "--line": `${c.line}`,
    "--accent": c.accent,
    "--accent-end": c.accentEnd,
    "--accent-soft": `${c.accent}26`,
    "--accent-ink": ink,
    "--accent-fill":
      a.gradient === "off"
        ? c.accent
        : `linear-gradient(${DIRECTIONS[a.gradient]}, ${c.accent}, ${c.accentEnd})`,
    "--radius": `${radius}px`,
    "--radius-lg": `${radius + 6}px`,
    "--poster-radius": `${a.posterRadius}px`,
    "--gap": `${gap}px`,
    "--app-font": `"${font}", "Segoe UI", Tahoma, sans-serif`,
    color: c.text,
    background: c.bg,
    colorScheme: luminance(c.bg) > 0.4 ? "light" : "dark",
  };
}

/**
 * Classes the stylesheet keys off for shapes that are not colours. They sit
 * on the app root, so none may reuse an element class from the stylesheets.
 */
export function themeClasses(input) {
  const a = safeAppearance(input);
  return [
    `radius-${a.radius}`,
    `density-${a.density}`,
    `hover-${a.posterHover}`,
    a.posterTitles ? "" : "no-poster-titles",
    `hero-${a.heroStyle}`,
    `detailbg-${a.detailBackground}`,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * The zoom that honours the viewer's scale without shrinking the layout's
 * CSS viewport below 980 by 680, where every layout is designed to fit.
 */
export function effectiveZoom(uiScale, width, height) {
  const wanted = number(uiScale, 80, 125, 100) / 100;
  const fits = Math.min(width / 980, height / 680);
  return (
    Math.round(Math.max(0.8, Math.min(wanted, Math.max(1, fits))) * 100) / 100
  );
}

// --- Sharing ---------------------------------------------------------------

const PREFIX = "RIWAQ-THEME-1:";

const toBase64 = (text) =>
  typeof btoa === "function"
    ? btoa(unescape(encodeURIComponent(text)))
    : Buffer.from(text, "utf8").toString("base64");
const fromBase64 = (text) =>
  typeof atob === "function"
    ? decodeURIComponent(escape(atob(text)))
    : Buffer.from(text, "base64").toString("utf8");

/** A short text code for a design; carries appearance only, nothing else. */
export function encodeTheme(input) {
  const a = safeAppearance(input);
  return PREFIX + toBase64(JSON.stringify(a));
}

/** Reads a shared code; anything invalid is refused or cleaned. */
export function decodeTheme(code) {
  const text = String(code || "").trim();
  if (!text.startsWith(PREFIX) || text.length > 6000)
    throw new Error("هذا ليس رمز تصميم من رِواق");
  let data;
  try {
    data = JSON.parse(fromBase64(text.slice(PREFIX.length)));
  } catch {
    throw new Error("رمز التصميم تالف");
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("رمز التصميم تالف");
  return safeAppearance(data, DEFAULT_APPEARANCE);
}
