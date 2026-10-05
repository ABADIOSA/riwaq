import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  dominantColor,
  genreColor,
  hslToRgb,
  readableAccent,
  rgbToHsl,
  titleTheme,
} from "../core/title-theme.mjs";

const source = (file) =>
  readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8");
const pixels = (list) =>
  Uint8ClampedArray.from(list.flatMap((c) => [...c, 255]));
const fill = (rgb, n) => Array.from({ length: n }, () => rgb);

test("colour conversions round-trip", () => {
  for (const rgb of [
    [200, 50, 60],
    [63, 169, 245],
    [128, 128, 128],
  ]) {
    const back = hslToRgb(rgbToHsl(rgb)).map(Math.round);
    back.forEach((c, i) => assert.ok(Math.abs(c - rgb[i]) <= 1));
  }
});

test("the artwork's most present vivid colour wins; a grey picture gives none", () => {
  const red = dominantColor(
    pixels([
      ...fill([200, 30, 40], 60),
      ...fill([30, 60, 200], 20),
      ...fill([20, 20, 20], 20),
    ]),
    { step: 1 },
  );
  assert.ok(red[0] > 150 && red[2] < 80, `got ${red}`);
  assert.equal(
    dominantColor(pixels(fill([120, 120, 120], 100)), { step: 1 }),
    null,
  );
  assert.equal(dominantColor(null), null);
});

test("genres give a colour in Arabic or English, horror first", () => {
  assert.equal(genreColor({ genres: ["Horror", "Comedy"] }), "#C8323C");
  assert.equal(genreColor({ genres: ["خيال علمي"] }), "#3FA9F5");
  assert.equal(genreColor({ genres: [] }), null);
});

test("the accent stays readable on dark and light palettes", () => {
  const [, , darkL] = rgbToHsl(
    [1, 3, 5].map((i) =>
      parseInt(readableAccent([10, 10, 60]).slice(i, i + 2), 16),
    ),
  );
  assert.ok(darkL >= 0.55, `dark palette lightness ${darkL}`);
  const [, , lightL] = rgbToHsl(
    [1, 3, 5].map((i) =>
      parseInt(
        readableAccent([250, 240, 200], { light: true }).slice(i, i + 2),
        16,
      ),
    ),
  );
  assert.ok(lightL <= 0.47, `light palette lightness ${lightL}`);
});

test("the page theme: artwork first, genre otherwise, nothing when off", () => {
  const meta = { genres: ["Horror"] };
  const art = titleTheme(meta, { rgb: [30, 140, 220] });
  assert.equal(art.source, "artwork");
  assert.match(art.vars["--accent"], /^#[0-9A-F]{6}$/);
  assert.match(art.vars["--accent-fill"], /^linear-gradient\(135deg/);
  assert.ok(art.vars["--title-tint"].endsWith("1F"));
  const genre = titleTheme(meta, { rgb: null });
  assert.equal(genre.source, "genre");
  assert.equal(
    titleTheme(meta, { mode: "genre", rgb: [30, 140, 220] }).source,
    "genre",
  );
  assert.equal(titleTheme(meta, { mode: "off" }), null);
  assert.equal(titleTheme({ genres: [] }, { rgb: null }), null);
  assert.equal(
    titleTheme(meta, { gradient: "off" }).vars["--accent-fill"],
    genre.vars["--accent"],
  );
});

test("the theme lives on the title page, never the app root", () => {
  const details = source("src/components/Details.jsx");
  assert.match(details, /style=\{pageTheme\?\.vars\}/);
  assert.match(details, /img\.crossOrigin = "anonymous"/);
  assert.doesNotMatch(source("src/App.jsx"), /titleTheme\(/);
  assert.match(
    source("src/components/settings/LookPages.jsx"),
    /update\("settings", \{ titleTheme \}\)/,
  );
});
