import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shuffleCandidates, shufflePick } from "../core/shuffle.mjs";
import { watchedTitles, withoutWatched } from "../core/library.mjs";
import { dropKind } from "../core/drop.mjs";
import { DEFAULT_SETTINGS, safeSettings } from "../core/protocol.mjs";

const day = 86400000;
const now = Date.parse("2026-09-30T00:00:00Z");
const show = {
  id: "tt1",
  type: "series",
  videos: [
    { id: "tt1:0:1", season: 0, episode: 1 },
    { id: "tt1:1:1", season: 1, episode: 1 },
    { id: "tt1:1:2", season: 1, episode: 2 },
    { id: "tt1:1:2b", season: 1, episode: 2 },
    { id: "tt1:1:3", season: 1, episode: 3 },
    {
      id: "tt1:2:1",
      season: 2,
      episode: 1,
      released: new Date(now + 5 * day).toISOString(),
    },
  ],
};
const done = { completed: true };

test("shuffle takes released, numbered, unwatched episodes once each", () => {
  const progress = { "series:tt1:1:1": done };
  assert.deepEqual(
    shuffleCandidates(show, progress, { now }).map((v) => v.id),
    ["tt1:1:2", "tt1:1:3"],
    "no specials, no duplicates, no future episode, no watched one",
  );
  assert.deepEqual(
    shuffleCandidates(show, progress, { includeWatched: true, now }).map(
      (v) => v.id,
    ),
    ["tt1:1:1", "tt1:1:2", "tt1:1:3"],
  );
});

test("shuffle never repeats until every episode has come up", () => {
  const candidates = shuffleCandidates(show, {}, { now });
  const history = new Set();
  const seen = [];
  for (let i = 0; i < 3; i++)
    seen.push(shufflePick(candidates, { history, random: () => 0 }).id);
  assert.equal(new Set(seen).size, 3, "three picks, three different episodes");
  const again = shufflePick(candidates, {
    history,
    current: seen[2],
    random: () => 0,
  });
  assert.notEqual(again.id, seen[2], "never the episode already chosen");
  assert.equal(shufflePick([], { history }), null);
  assert.equal(
    shufflePick([candidates[0]], { current: candidates[0].id }),
    null,
    "nothing else to pick",
  );
});

test("hidden watched titles are finished films only, and only where rows are", () => {
  const progress = {
    "movie:tt9": { meta: { id: "tt9", type: "movie" }, completed: true },
    "movie:tt8": {
      meta: { id: "tt8", type: "movie" },
      position: 96,
      duration: 100,
    },
    "movie:tt7": {
      meta: { id: "tt7", type: "movie" },
      position: 10,
      duration: 100,
    },
    "series:tt1:1:1": { meta: { id: "tt1", type: "series" }, completed: true },
  };
  const watched = watchedTitles(progress);
  assert.deepEqual([...watched].sort(), ["movie:tt8", "movie:tt9"]);
  const row = [
    { id: "tt9", type: "movie" },
    { id: "tt7", type: "movie" },
    { id: "tt1", type: "series" },
  ];
  assert.deepEqual(
    withoutWatched(row, watched).map((m) => m.id),
    ["tt7", "tt1"],
    "a series stays: a row cannot know every episode",
  );
  assert.equal(withoutWatched(row, new Set()), row);
  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(app, /view !== "search"/, "search keeps finished titles");
});

test("only videos and subtitles dropped as files are accepted", () => {
  assert.equal(dropKind("file:///C:/Films/Heat%20(1995).mkv"), "video");
  assert.equal(dropKind("file:///home/a/b.MP4"), "video");
  assert.equal(dropKind("file:///C:/Subs/heat.ar.srt"), "subtitle");
  assert.equal(dropKind("file:///C:/x.ass"), "subtitle");
  assert.equal(dropKind("file:///C:/evil.exe"), null);
  assert.equal(dropKind("file:///C:/list.m3u"), null, "no playlists");
  assert.equal(dropKind("https://host/x.mkv"), null, "only files");
  assert.equal(dropKind(undefined), null);
  const main = readFileSync(
    new URL("../electron/main.mjs", import.meta.url),
    "utf8",
  );
  assert.equal(
    (main.match(/"will-navigate", onDropNavigate/g) || []).length,
    2,
    "the main window and the HUD both refuse navigation and take drops",
  );
});

test("holding the picture speeds it up, and the speed is validated", () => {
  assert.equal(DEFAULT_SETTINGS.holdSpeed, 2);
  assert.equal(safeSettings({ holdSpeed: 3 }, DEFAULT_SETTINGS).holdSpeed, 3);
  assert.equal(safeSettings({ holdSpeed: 0 }, DEFAULT_SETTINGS).holdSpeed, 0);
  assert.equal(safeSettings({ holdSpeed: 16 }, DEFAULT_SETTINGS).holdSpeed, 2);
  const hud = readFileSync(
    new URL("../src/components/Hud.jsx", import.meta.url),
    "utf8",
  );
  assert.match(hud, /onPointerDown=\{onStageDown\}/);
  assert.match(hud, /swallow/, "the click ending a hold does not pause");
});
