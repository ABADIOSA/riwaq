// The wheel: Riwaq's default navigation since November 2026 (core/wheel.mjs,
// src/components/RiwaqWheel.jsx), its migration and the glass setting.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  WHEEL,
  rimPath,
  wheelKey,
  wheelLayout,
  wheelTurn,
} from "../core/wheel.mjs";
import {
  DEFAULT_APPEARANCE,
  adoptWheel,
  resolveAppearance,
  safeAppearance,
  themeClasses,
} from "../core/appearance.mjs";
import {
  DEFAULT_SETTINGS,
  safeSettings,
  retireLineless,
} from "../core/protocol.mjs";

const read = (file) =>
  readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8");

test("destinations sit on one circle around a hub beyond the window edge", () => {
  for (const open of [false, true]) {
    const layout = wheelLayout({ count: 9, height: 520, open });
    assert.equal(layout.items.length, 9);
    assert.ok(layout.hub.x < 0, "the hub lies beyond the edge");
    for (const item of layout.items) {
      const r = Math.hypot(item.x - layout.hub.x, item.y - layout.hub.y);
      assert.ok(Math.abs(r - layout.radius) < 0.2, `${r} vs ${layout.radius}`);
      // Whole targets inside the rail.
      assert.ok(item.x - WHEEL.item / 2 >= 0, `${item.x}`);
      assert.ok(item.x + WHEEL.item / 2 <= layout.width, `${item.x}`);
    }
    // The middle reaches furthest; the arc is symmetric.
    const xs = layout.items.map((i) => i.x);
    assert.equal(Math.max(...xs), xs[4]);
    assert.ok(Math.abs(xs[0] - xs[8]) < 0.2);
    assert.ok(Math.abs(layout.items[0].angle + layout.items[8].angle) < 0.05);
    // Targets never overlap, and stay comfortable.
    assert.ok(layout.step >= WHEEL.minStep && layout.step <= WHEEL.maxStep);
  }
});

test("a short window keeps the minimum spacing and lets the wheel scroll", () => {
  const layout = wheelLayout({ count: 9, height: 300 });
  assert.equal(layout.step, WHEEL.minStep);
  assert.ok(layout.height > 300);
  const roomy = wheelLayout({ count: 3, height: 900 });
  assert.equal(roomy.step, WHEEL.maxStep);
  assert.equal(roomy.height, 900);
});

test("the wheel turns to the chosen destination, mirrored on the right", () => {
  const layout = wheelLayout({ count: 9, height: 520 });
  const angle = layout.items[7].angle;
  assert.ok(angle > 0);
  assert.equal(wheelTurn(layout, 7), angle);
  assert.equal(wheelTurn(layout, 7, { rtl: true }), -angle);
  // A page that is not on the wheel keeps the last turn.
  assert.equal(wheelTurn(layout, -1, { previous: 12 }), 12);
  assert.match(rimPath(layout), /^M [\d.]+ [\d.-]+ A /);
  assert.notEqual(rimPath(layout, { rtl: true }), rimPath(layout));
});

test("arrows, Home and End move between destinations predictably", () => {
  assert.equal(wheelKey("ArrowDown", 0, 9), 1);
  assert.equal(wheelKey("ArrowDown", 8, 9), 8);
  assert.equal(wheelKey("ArrowUp", 0, 9), 0);
  assert.equal(wheelKey("ArrowUp", 4, 9), 3);
  assert.equal(wheelKey("Home", 5, 9), 0);
  assert.equal(wheelKey("End", 2, 9), 8);
  assert.equal(wheelKey("Enter", 2, 9), null);
  assert.equal(wheelKey("ArrowDown", 0, 0), null);
});

test("the wheel and glass are the default; the old sidebar stays a choice", () => {
  assert.equal(DEFAULT_APPEARANCE.navStyle, "wheel");
  assert.equal(DEFAULT_APPEARANCE.glass, "on");
  assert.equal(safeAppearance({ navStyle: "rail" }).navStyle, "rail");
  assert.equal(safeAppearance({ navStyle: "spiral" }).navStyle, "wheel");
  assert.equal(safeAppearance({ glass: "solid" }).glass, "solid");
  assert.equal(safeAppearance({ glass: "frosted" }).glass, "on");
  const classes = themeClasses({ navStyle: "rail", glass: "solid" }).split(" ");
  assert.ok(classes.includes("nav-rail") && classes.includes("glass-solid"));
  assert.ok(themeClasses({}).split(" ").includes("nav-wheel"));
  // The card shapes are their own choice (issue #117).
  const both = safeAppearance({ identity: "classic", navStyle: "wheel" });
  assert.equal(both.identity, "classic");
  assert.equal(both.navStyle, "wheel");
  assert.equal(DEFAULT_SETTINGS.wheelOpen, false);
  assert.equal(safeSettings({ wheelOpen: true }).wheelOpen, true);
  assert.equal(safeSettings({ wheelOpen: "yes" }).wheelOpen, false);
});

test("settings saved before the wheel move to it, keeping everything else", () => {
  const old = {
    uiLanguage: "en",
    appearance: {
      identity: "classic",
      mode: "light",
      preset: "riwaq",
      navHidden: ["live"],
      rowArrows: "edges",
    },
  };
  const moved = adoptWheel(old);
  assert.equal(moved.appearance.navStyle, "wheel");
  assert.equal(moved.appearance.glass, "on");
  for (const key of ["identity", "mode", "preset", "rowArrows"])
    assert.equal(moved.appearance[key], old.appearance[key], key);
  assert.deepEqual(moved.appearance.navHidden, ["live"]);
  assert.equal(moved.uiLanguage, "en");
  assert.equal(old.appearance.navStyle, undefined, "the input is not changed");
  // The load path writes it (profiles and the client use retireLineless).
  assert.equal(retireLineless(old).appearance.navStyle, "wheel");
  // A viewer who chose the sidebar keeps it.
  const chosen = { appearance: { navStyle: "rail", glass: "solid" } };
  assert.equal(adoptWheel(chosen), chosen);
  // No saved appearance: the default draws the wheel.
  assert.equal(adoptWheel({ appearance: null }).appearance, null);
  assert.equal(resolveAppearance({ appearance: null }).navStyle, "wheel");
  // A backup or another device's sync goes through the same validation.
  const synced = safeSettings({ appearance: { navStyle: "rail" } }, old);
  assert.equal(synced.appearance.navStyle, "rail");
  assert.equal(synced.appearance.identity, "classic");
});

test("the wheel keeps the destinations in order, with page semantics", () => {
  const nav = read("src/components/RiwaqNav.jsx");
  const order = [
    '"home", "الرئيسية"',
    '"discover", "اكتشف"',
    '"library", "مكتبتي"',
    '"collections", "المجموعات"',
    '"downloads", "التنزيلات"',
    '"addons", "الإضافات"',
    '"music", "موسيقى"',
    '"live", "بث مباشر"',
    '"settings", "الإعدادات"',
  ];
  const wheel = nav.slice(nav.indexOf("function wheelSidebar"));
  const at = order.map((text) => wheel.indexOf(text));
  assert.ok(
    at.every((i) => i > 0),
    at.join(),
  );
  assert.deepEqual(
    [...at].sort((a, b) => a - b),
    at,
  );
  const component = read("src/components/RiwaqWheel.jsx");
  assert.match(component, /<nav[\s\S]*aria-label=\{label\}/);
  assert.match(
    component,
    /aria-current=\{item\.current \? "page" : undefined\}/,
  );
  // Buttons are the nav's own children, in reading order, never moved by
  // the turn: only the rim's ticks and the lens rotate.
  assert.doesNotMatch(
    component.slice(component.indexOf("<button")),
    /rotate\(/,
  );
  assert.match(
    component,
    /className="wheel-ticks"[\s\S]*rotate\(\$\{turn\}deg\)/,
  );
  // No wheel-event capture: the page keeps its own scrolling.
  assert.doesNotMatch(component, /onWheel|addEventListener\("wheel"/);
  // Reduced motion stops the turn (the shared motion tokens).
  const tokens = read("src/tokens.css");
  assert.match(tokens, /\.app\.reduced-motion \{[^}]*--motion-wheel: 0ms/);
  assert.match(tokens, /prefers-reduced-motion[\s\S]*--motion-wheel: 0ms/);
  // Glass has opaque fallbacks.
  const glass = read("src/glass.css");
  for (const query of [
    "prefers-reduced-transparency",
    "forced-colors",
    "@supports not",
    ".app.glass-solid",
  ])
    assert.ok(glass.includes(query), query);
});
