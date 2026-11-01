// Issue #126: light, dark and the system's mode. Dark keeps every saved
// palette exactly as before; light draws Pure White with the preset's
// accent deepened until it reads on white.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_APPEARANCE,
  PRESETS,
  PURE_WHITE,
  contrast,
  decodeTheme,
  deepenFor,
  displayedAppearance,
  effectiveMode,
  encodeTheme,
  isLight,
  lightColors,
  safeAppearance,
  themeClasses,
  themeVariables,
} from "../core/appearance.mjs";
import { DEFAULT_SETTINGS, safeSettings } from "../core/protocol.mjs";

const read = (p) =>
  readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");

test("the mode is validated and defaults to dark", () => {
  assert.equal(DEFAULT_APPEARANCE.mode, "dark");
  for (const mode of ["dark", "light", "system"])
    assert.equal(safeAppearance({ mode }).mode, mode);
  assert.equal(safeAppearance({ mode: "sepia" }).mode, "dark");
  assert.equal(safeAppearance({ mode: 1 }).mode, "dark");
  // A saved appearance from before 0.54 has no mode and stays dark.
  const old = { ...DEFAULT_APPEARANCE };
  delete old.mode;
  assert.equal(safeAppearance(old).mode, "dark");
  // It travels with a backup or an account like any appearance choice.
  const s = safeSettings({
    appearance: { ...DEFAULT_APPEARANCE, mode: "light" },
  });
  assert.equal(s.appearance.mode, "light");
  assert.ok(!("mode" in DEFAULT_SETTINGS));
  // And with a shared design code.
  assert.equal(decodeTheme(encodeTheme({ mode: "system" })).mode, "system");
});

test("system follows the operating system; light and dark do not", () => {
  assert.equal(effectiveMode({ mode: "dark" }, false), "dark");
  assert.equal(effectiveMode({ mode: "light" }, true), "light");
  assert.equal(effectiveMode({ mode: "system" }, true), "dark");
  assert.equal(effectiveMode({ mode: "system" }, false), "light");
  assert.equal(effectiveMode(undefined), "dark");
});

test("dark mode draws the saved colours exactly as before", () => {
  for (const preset of PRESETS) {
    const a = safeAppearance({ preset: preset.id, colors: preset.colors });
    assert.deepEqual(displayedAppearance(a, false).colors, a.colors);
    assert.deepEqual(displayedAppearance({ ...a, mode: "system" }, true), {
      ...a,
      mode: "system",
    });
  }
});

test("Pure White keeps its text readable on every surface", () => {
  for (const surface of ["bg", "panel", "raised"]) {
    assert.ok(contrast(PURE_WHITE.text, PURE_WHITE[surface]) >= 7, surface);
    assert.ok(contrast(PURE_WHITE.muted, PURE_WHITE[surface]) >= 4.5, surface);
  }
  assert.ok(isLight(PURE_WHITE));
});

test("every preset's light accent reads on white, with white button text", () => {
  for (const preset of PRESETS) {
    const light = lightColors(preset.colors);
    assert.equal(light.bg, PURE_WHITE.bg, preset.id);
    for (const key of ["accent", "accentEnd"]) {
      assert.ok(contrast(light[key], PURE_WHITE.panel) >= 4.5, preset.id);
      assert.ok(contrast(light[key], "#FFFFFF") >= 4.5, preset.id);
    }
    assert.equal(themeVariables({ colors: light })["--accent-ink"], "#FFFFFF");
  }
  // The hue survives: gold stays warm, not grey or brown-black.
  const gold = lightColors(PRESETS[0].colors).accent;
  const [r, , b] = [1, 3, 5].map((i) => parseInt(gold.slice(i, i + 2), 16));
  assert.ok(r > b + 80, gold);
  // A colour that already reads is left alone.
  assert.equal(deepenFor("#123456", "#FFFFFF", 4.5), "#123456");
});

test("a custom light palette stays the viewer's own in light mode", () => {
  const colors = {
    ...PURE_WHITE,
    bg: "#FDF6E3",
    accent: "#268BD2",
    accentEnd: "#2AA198",
  };
  assert.deepEqual(lightColors(colors), colors);
  const a = safeAppearance({ preset: "custom", colors, mode: "dark" });
  // Its pages are light even in dark mode, and the stylesheet knows it.
  assert.match(themeClasses(a), /\bscheme-light\b/);
  assert.equal(themeVariables(a).colorScheme, "light");
});

test("the root class names the scheme the stylesheet keys off", () => {
  assert.match(themeClasses(DEFAULT_APPEARANCE), /\bscheme-dark\b/);
  const light = displayedAppearance({ ...DEFAULT_APPEARANCE, mode: "light" });
  assert.match(themeClasses(light), /\bscheme-light\b/);
  // Root classes never reuse an element class.
  const css = read("src/scheme-light.css");
  assert.doesNotMatch(css, /class="scheme-/);
  assert.match(read("src/main.jsx"), /import "\.\/scheme-light\.css";/);
});

test("the interface, main and the title page draw the displayed colours", () => {
  const app = read("src/App.jsx");
  assert.match(
    app,
    /displayedAppearance\(\s*resolveAppearance\(state\.settings\),\s*systemDark,?\s*\)/,
  );
  const main = read("electron/main.mjs");
  assert.match(main, /nativeTheme\.shouldUseDarkColors/);
  assert.match(main, /nativeTheme\.on\("updated", applyTitleOverlay\)/);
  assert.match(main, /backgroundColor: look\.colors\.bg/);
  const details = read("src/components/Details.jsx");
  assert.match(details, /displayedAppearance\(/);
  // Settings still edit the saved appearance, never the displayed one.
  assert.doesNotMatch(
    read("src/components/AppearanceStudio.jsx"),
    /displayedAppearance/,
  );
});

test("light overrides never touch surfaces drawn over pictures or video", () => {
  const css = read("src/scheme-light.css");
  for (const kept of [
    ".hero ",
    ".poster-shade",
    ".theater",
    ".player-side",
    ".player-menu",
    ".hud",
    ".screensaver",
    ".gallery-viewer",
  ])
    assert.doesNotMatch(
      css,
      new RegExp(
        `\\.app\\.scheme-light ${kept.trim().replace(/[.]/g, "\\.")}(?![\\w-])`,
      ),
      kept,
    );
  // The toggle's on state keeps the accent.
  assert.match(css, /\.toggle:not\(\.on\)/);
});
