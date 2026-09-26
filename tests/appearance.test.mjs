import test from "node:test";
import assert from "node:assert/strict";
import {
  PRESETS,
  DEFAULT_APPEARANCE,
  safeAppearance,
  applyPreset,
  resolveAppearance,
  themeVariables,
  themeClasses,
  effectiveZoom,
  encodeTheme,
  decodeTheme,
  contrast,
} from "../core/appearance.mjs";
import { DEFAULT_SETTINGS, safeSettings } from "../core/protocol.mjs";
import { Player, playerArgs } from "../electron/player.mjs";
import { readFileSync } from "node:fs";

test("every preset keeps text readable on its background", () => {
  for (const preset of PRESETS) {
    assert.ok(
      contrast(preset.colors.text, preset.colors.bg) >= 7,
      `${preset.id} body text`,
    );
    assert.ok(
      contrast(preset.colors.muted, preset.colors.panel) >= 4.5,
      `${preset.id} secondary text`,
    );
  }
  assert.equal(new Set(PRESETS.map((p) => p.id)).size, PRESETS.length);
});

test("appearance is validated field by field", () => {
  const a = safeAppearance({
    preset: "made-up",
    colors: { accent: "#ff3366", bg: "red", text: "#FFFFFF;background:url(x)" },
    gradient: "spiral",
    font: "Comic Sans",
    customFont: "Dubai; } body { display:none",
    uiScale: 400,
    radius: "soft",
    density: "spacious",
    posterRadius: -5,
    posterHover: "glow",
    posterTitles: "no",
    heroStyle: "compact",
    detailBackground: "blur",
    navHidden: ["live", "settings", "home", "live"],
  });
  assert.equal(a.preset, "custom");
  assert.equal(a.colors.accent, "#FF3366");
  assert.equal(a.colors.bg, DEFAULT_APPEARANCE.colors.bg);
  assert.equal(a.colors.text, DEFAULT_APPEARANCE.colors.text);
  assert.equal(a.gradient, "off");
  assert.equal(a.font, "Segoe UI");
  assert.equal(a.customFont, "", "a font name cannot carry CSS");
  assert.equal(a.uiScale, 125);
  assert.equal(a.radius, "soft");
  assert.equal(a.density, "spacious");
  assert.equal(a.posterRadius, 0);
  assert.equal(a.posterHover, "glow");
  assert.equal(a.posterTitles, true);
  assert.equal(a.heroStyle, "compact");
  assert.equal(a.detailBackground, "blur");
  assert.deepEqual(a.navHidden, ["live"], "home and settings cannot be hidden");
  assert.deepEqual(safeAppearance(null), DEFAULT_APPEARANCE);
});

test("a preset is a fresh palette, and older accent choices carry over", () => {
  const green = applyPreset(DEFAULT_APPEARANCE, "royal-green");
  assert.equal(green.preset, "royal-green");
  assert.equal(green.colors.accent, "#1FB36B");
  assert.equal(green.gradient, "diagonal");
  assert.equal(resolveAppearance({ accent: "violet" }).preset, "aurora");
  assert.equal(resolveAppearance({ accent: "teal" }).preset, "harbor");
  assert.equal(resolveAppearance({}).preset, "riwaq");
  assert.equal(
    resolveAppearance({ accent: "violet", appearance: green }).preset,
    "royal-green",
    "a designed appearance wins over the old accent",
  );
});

test("variables and classes follow the design", () => {
  const a = safeAppearance({
    colors: { accent: "#1FB36B", accentEnd: "#8BE3B4" },
    gradient: "horizontal",
    radius: "sharp",
    density: "compact",
    posterRadius: 20,
    posterTitles: false,
    detailBackground: "solid",
    font: "custom",
    customFont: "Dubai",
  });
  const v = themeVariables(a);
  assert.equal(v["--accent"], "#1FB36B");
  assert.equal(v["--accent-fill"], "linear-gradient(90deg, #1FB36B, #8BE3B4)");
  assert.equal(v["--radius"], "4px");
  assert.equal(v["--poster-radius"], "20px");
  assert.equal(v["--gap"], "10px");
  assert.match(v["--app-font"], /^"Dubai", "Segoe UI"/);
  // Dark text on a light accent, light text on a dark one.
  assert.equal(v["--accent-ink"], "#141210");
  assert.equal(
    themeVariables({ colors: { accent: "#3B0764" } })["--accent-ink"],
    "#FFFFFF",
  );
  const classes = themeClasses(a).split(" ");
  assert.ok(classes.includes("radius-sharp"));
  assert.ok(classes.includes("no-poster-titles"));
  assert.ok(classes.includes("detailbg-solid"));
});

test("root classes never reuse an element class from the stylesheets", () => {
  const css = ["styles.css", "studio.css", "library.css"]
    .map((f) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8"))
    .join("\n");
  const every = [
    ...["sharp", "rounded", "soft"].map((r) => ({ radius: r })),
    ...["compact", "comfortable", "spacious"].map((d) => ({ density: d })),
    ...["off", "lift", "glow", "shine"].map((h) => ({ posterHover: h })),
    ...["full", "compact"].map((h) => ({ heroStyle: h })),
    ...["backdrop", "blur", "solid"].map((d) => ({ detailBackground: d })),
    { posterTitles: false },
  ].flatMap((input) => themeClasses(input).split(" "));
  for (const name of new Set(every))
    assert.ok(
      !new RegExp(`\\.${name}(?![\\w-])`).test(css),
      `.${name} is already an element class`,
    );
});

test("the interface scale never shrinks the layout below 980 by 680", () => {
  assert.equal(effectiveZoom(125, 980, 680), 1);
  assert.equal(effectiveZoom(125, 1600, 1000), 1.25);
  assert.equal(effectiveZoom(110, 1200, 700), 1.03);
  assert.equal(effectiveZoom(80, 980, 680), 0.8);
  assert.equal(effectiveZoom(100, 2560, 1440), 1);
  assert.equal(effectiveZoom("x", 1600, 1000), 1);
});

test("a design travels as a code carrying appearance only", () => {
  const design = applyPreset(DEFAULT_APPEARANCE, "midnight");
  const code = encodeTheme({ ...design, trakt: "secret-token" });
  assert.ok(code.startsWith("RIWAQ-THEME-1:"));
  assert.ok(!code.includes("secret"));
  const back = decodeTheme(code);
  assert.deepEqual(back, design);
  assert.ok(!("trakt" in back));
  assert.throws(() => decodeTheme("hello"), /ليس رمز تصميم/);
  assert.throws(() => decodeTheme("RIWAQ-THEME-1:!!!"), /تالف/);
  assert.throws(() => decodeTheme("RIWAQ-THEME-1:" + "A".repeat(7000)));
  // Arabic survives the round trip.
  const arabic = encodeTheme({
    ...design,
    customFont: "خط دبي",
    font: "custom",
  });
  assert.equal(decodeTheme(arabic).customFont, "خط دبي");
});

test("settings carry appearance and the new card style", () => {
  assert.equal(DEFAULT_SETTINGS.appearance, null);
  const next = safeSettings(
    { appearance: { preset: "noir", radius: "soft" }, cardStyle: "outline" },
    DEFAULT_SETTINGS,
  );
  assert.equal(next.appearance.radius, "soft");
  assert.equal(next.cardStyle, "outline");
  assert.equal(
    safeSettings({ cardStyle: "neon" }, DEFAULT_SETTINGS).cardStyle,
    "glass",
  );
});

test("main decides when the pointer hides over the picture", () => {
  const args = playerArgs({
    pipe: "p",
    settings: DEFAULT_SETTINGS,
    url: "https://a.test/v",
    title: "t",
  });
  assert.ok(args.includes("--cursor-autohide=no"));
  const sent = [];
  const player = new Player({ onState: () => {} });
  player.send = (c) => sent.push(c);
  player.state = { active: true };
  player.setCursorHidden(true);
  player.setCursorHidden(true);
  player.setCursorHidden(false);
  assert.deepEqual(sent, [
    ["set_property", "cursor-autohide", "always"],
    ["set_property", "cursor-autohide", "no"],
  ]);
  player.state = { active: false };
  player.setCursorHidden(true);
  assert.equal(sent.length, 2, "nothing is sent without a viewing");
});
