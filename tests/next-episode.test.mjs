import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  PREFETCH_TTL,
  prefetchDue,
  prefetchTarget,
  prefetched,
} from "../core/prefetch.mjs";
import {
  SKIP_EXCEPT_LIMIT,
  cleanSkipExcept,
  skipPreferences,
} from "../core/skip-segments.mjs";
import { DEFAULT_SETTINGS, safeSettings } from "../core/protocol.mjs";
import { Player } from "../electron/player.mjs";

const source = (file) =>
  readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8");

const episode = (over = {}) => ({
  active: true,
  meta: { id: "tt5", type: "series", name: "مسلسل" },
  videoId: "tt5:1:3",
  duration: 2700,
  position: 100,
  ...over,
});

test("the next title is fetched only in an episode's last minutes, with autoplay", () => {
  const on = { autoplay: true };
  assert.equal(prefetchDue(episode(), on), false);
  assert.equal(prefetchDue(episode({ position: 2700 - 240 }), on), true);
  assert.equal(prefetchDue(episode({ position: 2430 }), on), true, "90%");
  assert.equal(prefetchDue(episode({ position: 2600 }), {}), false);
  assert.equal(prefetchDue(episode({ position: 2600, live: true }), on), false);
  assert.equal(
    prefetchDue(
      episode({ position: 2600, meta: { id: "tt1", type: "movie" } }),
      on,
    ),
    false,
  );
  // A short clip or an unknown duration never triggers it.
  assert.equal(prefetchDue(episode({ duration: 90, position: 80 }), on), false);
  assert.equal(prefetchDue(episode({ duration: 0, position: 80 }), on), false);
  assert.equal(
    prefetchDue(episode({ active: false, position: 2600 }), on),
    false,
  );
});

test("the target is what autoplay will play: the queue head, else the next episode", () => {
  const videos = ["tt5:1:2", "tt5:1:3", "tt5:1:4"].map((id) => ({ id }));
  const meta = { id: "tt5", type: "series" };
  assert.deepEqual(prefetchTarget({ meta, videoId: "tt5:1:3", videos }), {
    type: "series",
    id: "tt5:1:4",
    seriesId: "tt5",
  });
  assert.equal(prefetchTarget({ meta, videoId: "tt5:1:4", videos }), null);
  assert.equal(prefetchTarget({ meta, videoId: "tt9:1:1", videos }), null);
  assert.deepEqual(
    prefetchTarget({
      queue: [{ meta: { id: "tt7", type: "movie" }, videoId: "tt7" }],
      meta,
      videoId: "tt5:1:3",
      videos,
    }),
    { type: "movie", id: "tt7", seriesId: "tt7" },
  );
  assert.equal(
    prefetchTarget({ meta: { id: "tt1", type: "movie" }, videoId: "tt1" }),
    null,
  );
});

test("a prefetched answer serves only the same title, profile and ten minutes", () => {
  const promise = Promise.resolve({ streams: [] });
  const entry = { id: "tt5:1:4", profileId: "p1", at: 1000, promise };
  assert.equal(
    prefetched(entry, { id: "tt5:1:4", profileId: "p1", now: 2000 }),
    promise,
  );
  assert.equal(
    prefetched(entry, { id: "tt5:1:5", profileId: "p1", now: 2000 }),
    null,
  );
  assert.equal(
    prefetched(entry, { id: "tt5:1:4", profileId: "p2", now: 2000 }),
    null,
  );
  assert.equal(
    prefetched(entry, {
      id: "tt5:1:4",
      profileId: "p1",
      now: 1000 + PREFETCH_TTL,
    }),
    null,
  );
  assert.equal(prefetched(null, { id: "x", profileId: "p1" }), null);
});

test("autoplay uses the early answer and asks again when it has nothing playable", () => {
  const app = source("src/App.jsx");
  const advance = app.slice(
    app.indexOf("const advance = async"),
    app.indexOf("const act = async"),
  );
  assert.match(
    advance,
    /prefetched\(prefetchRef\.current, \{\s*id: targetId,\s*profileId,?\s*\}\)/,
  );
  assert.match(advance, /prefetchRef\.current = null;/);
  assert.match(
    advance,
    /if \(!result\?\.streams\?\.some\(\(s\) => s\.supported && !s\.external\)\)\s*result = await call\("streams"/,
  );
  // The effect asks once per episode and profile, and drops stale work.
  assert.match(app, /prefetchDue\(player, state\.settings\)/);
  assert.match(app, /was\?\.from === from && was\.profileId === profileId/);
  assert.match(app, /prefetchRef\.current !== entry/);
});

test("a series can be excluded from automatic skipping, keeping the button", () => {
  const auto = { skipIntro: "auto", skipOutro: "auto", skipExcept: ["tt5"] };
  assert.equal(skipPreferences(auto, "tt9"), auto);
  assert.equal(skipPreferences(auto, ""), auto);
  const kept = skipPreferences(auto, "tt5");
  assert.equal(kept.skipIntro, "button");
  assert.equal(kept.skipOutro, "button");
  const off = skipPreferences(
    { skipIntro: "off", skipOutro: "button", skipExcept: ["tt5"] },
    "tt5",
  );
  assert.equal(off.skipIntro, "off");
  assert.equal(off.skipOutro, "button");
  assert.deepEqual(cleanSkipExcept(["tt1", "tt1", "bad id", 5, "kitsu:9"]), [
    "tt1",
    "kitsu:9",
  ]);
  assert.equal(
    cleanSkipExcept(Array.from({ length: 400 }, (_, i) => `tt${i}`)).length,
    SKIP_EXCEPT_LIMIT,
  );
  assert.deepEqual(DEFAULT_SETTINGS.skipExcept, []);
  assert.deepEqual(safeSettings({ skipExcept: ["tt2", "x y"] }).skipExcept, [
    "tt2",
  ]);
});

test("the player reads live skip preferences, so an exclusion applies at once", () => {
  const sent = [];
  let prefs = { skipIntro: "auto", skipOutro: "off" };
  const p = new Player({ onState: () => {}, skipPrefs: () => prefs });
  p.send = (c) => sent.push(c);
  p.state = {
    active: true,
    abLoop: null,
    position: 50,
    segments: [{ kind: "intro", start: 45, end: 135, source: "chapter" }],
    skip: null,
  };
  prefs = skipPreferences(
    { skipIntro: "auto", skipOutro: "off", skipExcept: ["tt5"] },
    "tt5",
  );
  p.refreshSkip();
  assert.equal(p.state.skip?.kind, "intro", "the button is still offered");
  assert.deepEqual(sent, [], "but nothing is skipped on its own");
  prefs = { skipIntro: "auto", skipOutro: "off" };
  p.refreshSkip();
  assert.deepEqual(sent, [["seek", 135, "absolute"]]);
  // Main supplies the preferences for what is playing now.
  assert.match(
    source("electron/main.mjs"),
    /skipPreferences\(client\.state\.settings, nowPlaying\?\.series\)/,
  );
});
