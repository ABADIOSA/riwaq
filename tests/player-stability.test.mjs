import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Player } from "../electron/player.mjs";

const source = (file) =>
  readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8");

test("auto-skip sends one seek per entry into a segment, not one per frame", () => {
  const sent = [];
  const p = new Player({
    onState: () => {},
    skipPrefs: () => ({ skipIntro: "auto", skipOutro: "off" }),
  });
  p.send = (c) => sent.push(c);
  p.state = {
    active: true,
    abLoop: null,
    position: 50,
    segments: [{ kind: "intro", start: 45, end: 135, source: "chapter" }],
    skip: null,
  };
  // MPV keeps reporting positions inside the intro until the seek lands.
  for (const position of [50, 50.2, 50.4, 51]) {
    p.state.position = position;
    p.refreshSkip();
  }
  assert.equal(sent.filter((c) => c[0] === "seek").length, 1);
  // Past the intro, then back into it by hand: it skips again, once.
  p.state.position = 200;
  p.refreshSkip();
  p.state.position = 60;
  p.refreshSkip();
  p.state.position = 61;
  p.refreshSkip();
  assert.equal(sent.filter((c) => c[0] === "seek").length, 2);
});

test("with no segments the skip check reads no preferences", () => {
  let reads = 0;
  const p = new Player({ onState: () => {}, skipPrefs: () => (reads++, {}) });
  p.send = () => {};
  p.state = { active: true, position: 10, segments: [], skip: null };
  for (let i = 0; i < 50; i++) p.refreshSkip();
  assert.equal(reads, 0);
});

test("only the newest of two close starts may spawn MPV", async () => {
  const p = new Player({ onState: () => {} });
  // An old viewing that takes a moment to exit: both starts wait on it.
  let release;
  const exiting = new Promise((resolve) => (release = resolve));
  p.stop = () => exiting;
  const exe = fileURLToPath(import.meta.url); // any file that exists
  const base = {
    executable: exe,
    settings: {},
    url: "https://cdn.example/a.mkv",
    meta: { id: "tt1", type: "movie", name: "A" },
    videoId: "tt1",
  };
  const outcome = (promise) =>
    promise.then(
      () => "started",
      (e) => e.message,
    );
  const first = outcome(p.start(base));
  const second = outcome(
    p.start({ ...base, url: "https://cdn.example/b.mkv" }),
  );
  release();
  assert.equal(await first, "بدأ تشغيل مصدر آخر");
  // The newest went on to spawn (this test file is not a player, so it
  // fails to launch; what matters is that it, not the first, tried).
  assert.notEqual(await second, "بدأ تشغيل مصدر آخر");
  assert.equal(p.source.url, "https://cdn.example/b.mkv");
});

test("player sources of shutdown and failure are guarded", () => {
  const player = source("electron/player.mjs");
  assert.match(player, /if \(token !== this\.startToken\) throw/);
  // A pipe that never connects does not leave MPV playing unowned.
  assert.match(
    player,
    /if \(this\.child === child && !processError\) child\.kill\(\);/,
  );
  // A second subtitle line is set by MPV's own track ID.
  assert.doesNotMatch(player, /"secondary-sid", 2\]/);
  // MPV exiting after the window closed does not touch the window.
  const main = source("electron/main.mjs");
  assert.match(
    main,
    /if \(!window \|\| window\.isDestroyed\(\)\) return;\s+if \(!s\.active\)/,
  );
});
