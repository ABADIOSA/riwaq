// The November 2026 beta (issues #144–#154 and the work that came with
// them). The player bar's issues live in tests/player-bar.test.mjs and the
// wheel's in tests/wheel.test.mjs; the Chromium checks are in
// scripts/test-ui-beta.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULT_SETTINGS, safeSettings } from "../core/protocol.mjs";

const read = (file) =>
  readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8");

test("the taste compass can be hidden again, per profile (#148)", () => {
  assert.equal(DEFAULT_SETTINGS.tasteCompass, true);
  assert.equal(safeSettings({ tasteCompass: false }).tasteCompass, false);
  assert.equal(safeSettings({ tasteCompass: "no" }).tasteCompass, true);
  const app = read("src/App.jsx");
  // Both places that draw it read the switch.
  const draws = app.split("<TasteDiscovery").length - 1;
  assert.equal(draws, 2);
  assert.equal(
    app.match(/settings\.tasteCompass !== false/g)?.length,
    2,
    "Discover and Home",
  );
  // One control, on the Home & showcase page.
  const studio = read("src/components/SettingsStudio.jsx");
  assert.equal(studio.match(/"tasteCompass",/g)?.length, 1);
  assert.match(studio, /"إظهار بوصلة ذوقك"/);
});

test("Discover's tabs sit inside the block they switch, one separator (#148)", () => {
  const page = read("src/components/DiscoverSections.jsx");
  assert.match(page, /<section className="discover-sections"/);
  assert.match(page, /className="filter-tabs discover-tabs"/);
  // The first row (Riwaq's, else the first blended one) drops its own line.
  assert.match(page, /first=\{index === 0\}/);
  assert.match(page, /className=\{first \? "discover-first" : ""\}/);
  const css = read("src/smart.css");
  const block = css.slice(css.indexOf(".discover-sections {"));
  assert.match(block, /border-top: 1px solid var\(--line\)/);
  assert.match(
    css,
    /\.discover-sections > \.scroll-row-wrap > \.discover-tabs \{[^}]*border-bottom: 0/,
  );
  assert.match(
    css,
    /\.app \.discover-sections > \.rail\.discover-first \{[^}]*border-top: 0;[^}]*margin-top: 0/,
  );
});

test("the scroll lock leaves no empty band beside the scrollbar (#149)", () => {
  const lock = read("src/lib/scroll-lock.js");
  // The root no longer keeps its scrollbar's strip; the page pads instead.
  assert.doesNotMatch(lock, /root\.style\.scrollbarGutter = "stable"/);
  assert.match(lock, /export function scrollbarSides/);
  assert.match(lock, /--lock-gutter-right/);
  assert.match(lock, /removeProperty\("--lock-gutter-right"\)/);
  const tokens = read("src/tokens.css");
  assert.match(
    tokens,
    /body \{\s*padding-left: var\(--lock-gutter-left\);\s*padding-right: var\(--lock-gutter-right\);/,
  );
  // The masthead pads too, so its search never moves.
  assert.match(
    read("src/session.css"),
    /padding-right: calc\(20px \+ var\(--lock-gutter-right, 0px\)\)/,
  );
  // Element scrollers frozen under the gallery keep theirs: inside a box
  // the strip is that box's own.
  assert.match(lock, /el\.style\.scrollbarGutter = "stable"/);
});
