// Issues #125 (showcase gutters), #122 (row arrows as one pair) and #111
// (dragging up and down over posters). Behaviour is checked in Chromium by
// scripts/test-ui-overhaul.mjs; these keep the wiring from regressing.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (p) =>
  readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");

test("the showcase has one gutter for its top and both sides (#125)", () => {
  const css = read("src/hero.css");
  assert.match(css, /--showcase-gutter: 12px;/);
  assert.match(
    css,
    /\.app:not\(\.layout-cinematic\) \.hero \{\s*margin: var\(--showcase-gutter\) var\(--showcase-gutter\) 0;/,
  );
});

test("every row under a heading draws its arrows there (#122)", () => {
  const ui = read("src/components/UI.jsx");
  assert.match(ui, /export function RowHeading\(/);
  // A row with no heading gets one adjacent pair at its end.
  assert.match(ui, /const pair = arrows && !shared;/);
  assert.match(ui, /\{pair && <RowArrows row=\{row\} \/>\}/);
  assert.match(ui, /arrows-in-heading/);
  for (const [file, count] of [
    ["src/components/Credits.jsx", 3],
    ["src/components/Countdown.jsx", 1],
    ["src/components/Episodes.jsx", 1],
    ["src/components/Collections.jsx", 1],
    ["src/components/Music.jsx", 1],
  ])
    assert.equal((read(file).match(/<RowHeading/g) || []).length, count, file);
  assert.match(
    read("src/components/Suggestions.jsx"),
    /<RowArrows row=\{row\} \/>/,
  );
  assert.match(
    read("src/components/Details.jsx"),
    /<RowArrows row=\{episodeRow\} \/>/,
  );
  // Every <ScrollRow> under a section heading shares its row.
  for (const file of [
    "src/components/Credits.jsx",
    "src/components/Countdown.jsx",
    "src/components/Episodes.jsx",
    "src/components/Collections.jsx",
    "src/components/Suggestions.jsx",
  ]) {
    const src = read(file);
    for (const m of src.matchAll(
      /<ScrollRow className="(poster-row|credits-cast-row|countdown-row|folder-row)"[^>]*>/g,
    ))
      assert.match(m[0], /row=\{row\}/, `${file}: ${m[0]}`);
  }
  // rowArrows: header hides the edge arrows of every such row; edges hides
  // the pairs.
  assert.match(
    read("src/appearance.css"),
    /\.rowarrows-header :is\(\.has-pair, \.arrows-in-heading\) > \.scroll-arrow \{\s*display: none;/,
  );
  assert.match(read("src/appearance.css"), /\.rowarrows-edges \.rail-arrows/);
});

test("mouse dragging moves posters up and down too (#111)", () => {
  const drag = read("src/lib/drag-scroll.js");
  assert.match(drag, /export function attachGridDrag\(root = document\)/);
  assert.match(drag, /export function verticalScroller\(el\)/);
  // A mostly vertical drag on a row hands over to the page instead of
  // being dropped; the axis is decided once, after 8 px.
  assert.match(
    drag,
    /gesture\.scroller = scroller;\s*gesture\.top = scroller\.scrollTop;/,
  );
  assert.match(
    drag,
    /if \(gesture\.scroller\) scrollTop\(gesture\.scroller, gesture\.top - dy\);/,
  );
  // A drag never opens a card; listeners are removed on detach.
  assert.match(drag, /root\.removeEventListener\("click", click, true\);/);
  assert.match(drag, /window\.removeEventListener\("pointermove", move\);/);
  assert.match(
    read("src/App.jsx"),
    /useEffect\(\(\) => attachGridDrag\(document\), \[\]\);/,
  );
  const css = read("src/studio.css");
  assert.match(css, /\.poster-grid img \{\s*-webkit-user-drag: none;/);
});

// Issue #123 follow-up: pieces a crash left behind go at start-up.
test("start-up sweeps only leftover info-hash folders of the torrent cache", () => {
  const main = read("electron/main.mjs");
  const sweep = main.slice(
    main.indexOf("async function sweepTorrentCache()"),
    main.indexOf("// TorrServer (core/torrserver.mjs)"),
  );
  assert.match(sweep, /!== "viewing"\) return;/);
  assert.match(sweep, /join\(app\.getPath\("userData"\), "torrent-cache"\)/);
  assert.match(sweep, /if \(torrentHost\) return;/);
  assert.match(sweep, /if \(!validHash\(name\)\) continue;/);
  assert.match(sweep, /info\.isSymbolicLink\(\)/);
  // Folder by folder, never the whole cache directory at once.
  assert.doesNotMatch(sweep, /rm\(dir/);
  assert.match(main, /await sweepTorrentCache\(\)\.catch\(/);
  // Downloads never share the viewing engine's folder.
  assert.match(
    main,
    /join\(app\.getPath\("userData"\), "offline-torrent-cache"\)/,
  );
});
