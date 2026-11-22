// Issue #159 (0.57): Riwaq's brand follows the navigation, always with the
// official mark; the retired logo styles and picture links stay readable in
// saved settings, backups and shared themes, and are never drawn.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BRAND_MARK, brandLayout } from "../core/brand.mjs";
import {
  decodeTheme,
  encodeTheme,
  safeAppearance,
  themeClasses,
} from "../core/appearance.mjs";
import { DEFAULT_SETTINGS, safeSettings } from "../core/protocol.mjs";
import { translate } from "../core/i18n.mjs";

const read = (path) =>
  readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");

test("the name shows exactly where the navigation shows names", () => {
  const cases = [
    // [state, layout]
    [{ navStyle: "wheel", wheelOpen: false }, "mark"],
    [{ navStyle: "wheel", wheelOpen: true }, "full"],
    [{ navStyle: "rail", sidebarCollapsed: false }, "full"],
    [{ navStyle: "rail", sidebarCollapsed: true }, "mark"],
    // The rail's collapse does not decide for the wheel, nor the reverse.
    [{ navStyle: "wheel", wheelOpen: false, sidebarCollapsed: false }, "mark"],
    [{ navStyle: "rail", wheelOpen: true, sidebarCollapsed: true }, "mark"],
    // A narrow window folds the navigation into its drawer.
    [{ narrow: true, navStyle: "wheel", wheelOpen: true }, "mark"],
    [{ narrow: true, navStyle: "rail", sidebarCollapsed: false }, "mark"],
    [{}, "mark"],
  ];
  for (const [state, layout] of cases)
    assert.equal(brandLayout(state), layout, JSON.stringify(state));
});

test("the mark is assets/icon.svg's three arches, the middle one filled", () => {
  const svg = read("assets/icon.svg");
  const paths = [...svg.matchAll(/<path d="([^"]+)"( fill="[^"]+")?/g)];
  assert.deepEqual(
    BRAND_MARK.arches.map((a) => [a.d, a.filled]),
    paths.map((m) => [m[1], !!m[2]]),
  );
  assert.match(svg, new RegExp(`stroke-width="${BRAND_MARK.stroke}"`));
});

test("old logo styles and picture links never reach the drawing", () => {
  const nav = read("src/components/RiwaqNav.jsx");
  const page = read("src/components/settings/LookPages.jsx");
  for (const text of [nav, page]) {
    assert.doesNotMatch(text, /logoStyle|logoImage/);
    assert.doesNotMatch(text, /riwaq-custom-logo|logo-choices/);
  }
  // The only <img> left in the navigation is none at all.
  assert.doesNotMatch(nav, /<img\b/);
  assert.match(nav, /<RiwaqMark \/>/);
  // No interface code reads them; core keeps them for older devices.
  for (const file of [
    "src/App.jsx",
    "src/components/AppearanceStudio.jsx",
    "src/components/SettingsStudio.jsx",
  ])
    assert.doesNotMatch(read(file), /logoStyle|logoImage/, file);
  const css = ["src/session.css", "src/window.css", "src/studio.css"]
    .map(read)
    .join("\n");
  assert.doesNotMatch(css, /logostyle-|riwaq-monogram|riwaq-custom-logo/);
  // The Logo page offers the colour only, as a choice row in a div.
  assert.match(page, /<div className="studio-field">\s*لون الشعار/);
  assert.doesNotMatch(page, /صورة شعارك|placeholder="https:\/\/…\/logo/);
});

test("a 0.56.0 appearance with every retired logo value stays valid and keeps the rest", () => {
  const legacy = {
    logoStyle: "image",
    logoImage: "https://cdn.example/logo.png",
    logoTint: "gold",
    navStyle: "rail",
    glass: "on",
    wallpaper: "https://i.example/wall.jpg",
    appIcon: "accent",
  };
  const a = safeAppearance(legacy);
  // Kept as 0.56.0 validated them, so a device that still draws them gets
  // them back from a sync, a backup or a theme.
  assert.equal(a.logoStyle, "image");
  assert.equal(a.logoImage, "https://cdn.example/logo.png");
  // Everything else is untouched.
  assert.equal(a.logoTint, "gold");
  assert.equal(a.wallpaper, "https://i.example/wall.jpg");
  assert.equal(a.appIcon, "accent");
  assert.equal(a.navStyle, "rail");
  // Nothing on the root follows the retired style.
  const classes = themeClasses(a).split(" ");
  assert.ok(classes.includes("logotint-gold"));
  assert.ok(!classes.some((c) => c.startsWith("logostyle-")), classes);
  // Bad values still fall back as before; a credential link is refused.
  for (const style of ["full", "mark", "name"])
    assert.equal(safeAppearance({ logoStyle: style }).logoStyle, style);
  assert.equal(safeAppearance({ logoStyle: "neon" }).logoStyle, "full");
  assert.equal(
    safeAppearance({ logoStyle: "image", logoImage: "" }).logoStyle,
    "full",
  );
  assert.equal(
    safeAppearance({ logoImage: "https://u:p@cdn.example/x.png" }).logoImage,
    "",
  );
  // A shared theme from 0.56.0 decodes, and the 0.57 page cannot set them.
  const back = decodeTheme(encodeTheme(a));
  assert.equal(back.logoStyle, "image");
  assert.equal(back.logoTint, "gold");
});

test("saved settings and backups carry the retired keys through, unread", () => {
  const settings = safeSettings({
    ...DEFAULT_SETTINGS,
    wheelOpen: true,
    sidebarCollapsed: true,
    appearance: {
      ...safeAppearance({}),
      logoStyle: "name",
      logoImage: "https://cdn.example/logo.svg",
    },
  });
  assert.equal(settings.appearance.logoStyle, "name");
  assert.equal(settings.appearance.logoImage, "https://cdn.example/logo.svg");
  assert.equal(settings.wheelOpen, true);
  assert.equal(settings.sidebarCollapsed, true);
  // The navigation decides, whatever was saved.
  assert.equal(
    brandLayout({
      navStyle: settings.appearance.navStyle,
      wheelOpen: settings.wheelOpen,
      sidebarCollapsed: settings.sidebarCollapsed,
    }),
    settings.appearance.navStyle === "rail" ? "mark" : "full",
  );
});

test("the brand keeps an accessible name in both languages and its English", () => {
  const nav = read("src/components/RiwaqNav.jsx");
  assert.match(nav, /aria-label="رِواق — الرئيسية"/);
  assert.equal(translate("رِواق — الرئيسية", "en"), "Riwaq — Home");
  assert.equal(translate("رِواق", "en"), "Riwaq");
  for (const key of [
    "يظهر شعار رِواق وحده حين تُطوى القائمة، ومعه اسم رِواق حين تتّسع.",
    "القائمة مطوية",
    "القائمة موسّعة",
  ])
    assert.doesNotMatch(translate(key, "en"), /[؀-ۿ]/, key);
  // The light scheme's gold stays at 3:1 or more against white (#159).
  const css = read("src/session.css");
  assert.match(
    css,
    /\.app\.logotint-gold\.scheme-light \{\s*--brand-tint: #9c6a22/,
  );
});
