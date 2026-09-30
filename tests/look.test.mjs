import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  THEME_LIMIT,
  cleanSavedThemes,
  decodeTheme,
  encodeTheme,
  imageUrl,
  safeAppearance,
  themeClasses,
  themeVariables,
} from "../core/appearance.mjs";
import { DEFAULT_SETTINGS, safeSettings } from "../core/protocol.mjs";
import { HUD_METHODS } from "../core/hud.mjs";

test("wallpaper and logo images are plain HTTPS without credentials", () => {
  assert.equal(imageUrl("https://i.example/a.jpg"), "https://i.example/a.jpg");
  for (const bad of [
    "http://i.example/a.jpg",
    "https://u:p@i.example/a.jpg",
    "javascript:alert(1)",
    "file:///C:/a.jpg",
    "",
    5,
  ])
    assert.equal(imageUrl(bad), "", String(bad));
});

test("ambience, logo and icon are validated and reach the root", () => {
  const a = safeAppearance({
    wallpaper: "https://i.example/w.jpg",
    wallpaperDim: 400,
    wallpaperBlur: -3,
    ambient: "artwork",
    logoStyle: "mark",
    logoTint: "gold",
    appIcon: "accent",
  });
  assert.equal(a.wallpaperDim, 95);
  assert.equal(a.wallpaperBlur, 0);
  const vars = themeVariables(a);
  assert.equal(vars["--wallpaper"], 'url("https://i.example/w.jpg")');
  assert.equal(vars["--wallpaper-dim"], "0.95");
  const classes = themeClasses(a).split(" ");
  for (const c of [
    "wall-on",
    "ambience-glow",
    "logostyle-mark",
    "logotint-gold",
  ])
    assert.ok(classes.includes(c), c);
  assert.equal(
    safeAppearance({ logoStyle: "image", logoImage: "" }).logoStyle,
    "full",
    "no image, no image logo",
  );
  assert.equal(safeAppearance({ appIcon: "rainbow" }).appIcon, "classic");
  assert.equal(
    decodeTheme(encodeTheme(a)).wallpaper,
    "https://i.example/w.jpg",
    "a shared design carries its ambience",
  );
});

test("saved themes are named, unique, limited and validated", () => {
  const list = cleanSavedThemes([
    {
      id: "a",
      name: "  ليالي جدة ",
      appearance: { colors: { accent: "#123456" } },
    },
    { id: "a", name: "duplicate" },
    { id: "bad id!", name: "x" },
    { id: "b", name: "" },
    { id: "c", name: "<script>", appearance: { wallpaper: "javascript:1" } },
  ]);
  assert.deepEqual(
    list.map((t) => t.name),
    ["ليالي جدة", "<script>"],
  );
  assert.equal(list[0].appearance.colors.accent, "#123456");
  assert.equal(list[1].appearance.wallpaper, "");
  const many = Array.from({ length: 40 }, (_, i) => ({
    id: `t${i}`,
    name: `T${i}`,
  }));
  assert.equal(cleanSavedThemes(many).length, THEME_LIMIT);
  assert.equal(
    safeSettings({ savedThemes: many }, DEFAULT_SETTINGS).savedThemes.length,
    THEME_LIMIT,
  );
});

test("window, frost, drag and screensaver settings are validated", () => {
  assert.equal(DEFAULT_SETTINGS.windowFrame, "native");
  assert.equal(DEFAULT_SETTINGS.dragAnywhere, false);
  assert.equal(DEFAULT_SETTINGS.frostTopBar, false);
  assert.equal(DEFAULT_SETTINGS.screensaver, 0);
  const next = safeSettings(
    {
      windowFrame: "riwaq",
      windowControls: "glass",
      frostTopBar: true,
      dragAnywhere: true,
      screensaver: 5,
      screensaverClock: false,
    },
    DEFAULT_SETTINGS,
  );
  assert.deepEqual(
    [
      next.windowFrame,
      next.windowControls,
      next.frostTopBar,
      next.dragAnywhere,
      next.screensaver,
      next.screensaverClock,
    ],
    ["riwaq", "glass", true, true, 5, false],
  );
  const bad = safeSettings(
    { windowFrame: "x", windowControls: "y", screensaver: 7 },
    DEFAULT_SETTINGS,
  );
  assert.deepEqual(
    [bad.windowFrame, bad.windowControls, bad.screensaver],
    ["native", "filled", 0],
  );
});

test("window actions are main-window only, and the icon accepts only a small PNG", () => {
  const preload = readFileSync(
    new URL("../electron/preload.cjs", import.meta.url),
    "utf8",
  );
  for (const m of [
    "windowInfo",
    "windowControl",
    "windowDrag",
    "relaunch",
    "setAppIcon",
  ]) {
    assert.ok(preload.includes(`"${m}"`), m);
    assert.ok(!HUD_METHODS.has(m), `${m} stays off the HUD`);
  }
  assert.match(preload, /"window",\s*\]\.includes\(name\)/);
  const main = readFileSync(
    new URL("../electron/main.mjs", import.meta.url),
    "utf8",
  );
  assert.match(main, /data:image\/png;base64,/);
  assert.match(main, /url\.length > 400000/);
  assert.match(main, /size\.width > 512/);
  assert.match(
    main,
    /!client\.state\.settings\.dragAnywhere/,
    "drag only when the viewer turned it on",
  );
});
