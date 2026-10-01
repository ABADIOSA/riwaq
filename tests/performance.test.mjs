import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Player, POSITION_MS } from "../electron/player.mjs";

function rig() {
  const states = [];
  const player = new Player({ onState: (s) => states.push(s.position) });
  player.send = () => {};
  player.save = () => {};
  player.lastSaved = Date.now();
  player.state = { active: true, segments: [], skip: null, position: 0 };
  return { player, states };
}
const tick = (player, name, data) =>
  player.event({ event: "property-change", name, data });

test("a stream of positions reaches the interface four times a second", async () => {
  const { player, states } = rig();
  // MPV reports time-pos on every frame: sixty in one second.
  for (let i = 1; i <= 60; i++) tick(player, "time-pos", i / 60);
  assert.equal(states.length, 1, "the first goes out at once");
  await new Promise((r) => setTimeout(r, POSITION_MS + 40));
  assert.equal(states.length, 2, "the rest wait and go out as one");
  assert.equal(states[1], 1, "carrying the latest position");
  clearTimeout(player.publishTimer);
});

test("any other change goes out at once with the latest position", () => {
  const { player, states } = rig();
  tick(player, "time-pos", 5);
  tick(player, "time-pos", 6);
  tick(player, "pause", true);
  assert.deepEqual(states, [5, 6]);
  assert.equal(player.publishTimer, null, "a pending position is folded in");
  assert.equal(player.state.pause, true);
});

test("a position waiting when the viewing stops is dropped", async () => {
  const { player, states } = rig();
  tick(player, "time-pos", 1);
  tick(player, "time-pos", 2);
  player.state.active = false;
  await new Promise((r) => setTimeout(r, POSITION_MS + 40));
  assert.deepEqual(states, [1]);
});

test("rows render in steps and card styles carry no per-card blur", () => {
  const ui = readFileSync(
    new URL("../src/components/UI.jsx", import.meta.url),
    "utf8",
  );
  assert.match(ui, /export const Rail = memo\(/);
  assert.match(ui, /export const Poster = memo\(/);
  assert.match(ui, /RAIL_FIRST = 12/);
  const studio = readFileSync(
    new URL("../src/studio.css", import.meta.url),
    "utf8",
  );
  const rating = studio.match(/\.cardstyle-glass \.rating \{[^}]*\}/)[0];
  assert.doesNotMatch(rating, /backdrop-filter/);
  const hero = readFileSync(
    new URL("../src/hero.css", import.meta.url),
    "utf8",
  );
  assert.match(hero, /\.rail \{\s*content-visibility: auto;/);
  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(
    app.slice(
      app.indexOf("className={`app "),
      app.indexOf("className={`app ") + 10,
    ) +
      app.slice(
        app.indexOf("themeVariables(appearance)") - 40,
        app.indexOf("themeVariables(appearance)") + 80,
      ),
    /--ambient-image/,
    "the artwork variable stays off the app root",
  );
});

test("sources open in a window by default, and the viewer can keep them on the page", async () => {
  const { DEFAULT_SETTINGS, safeSettings } =
    await import("../core/protocol.mjs");
  assert.equal(DEFAULT_SETTINGS.sourcesPopup, true);
  assert.equal(safeSettings({ sourcesPopup: false }).sourcesPopup, false);
  assert.equal(safeSettings({ sourcesPopup: "no" }).sourcesPopup, true);
  const details = readFileSync(
    new URL("../src/components/Details.jsx", import.meta.url),
    "utf8",
  );
  // Showing sources on opening keeps them on the page; a started stream
  // closes the window.
  assert.match(
    details,
    /sourcesPopup !== false &&\s*state\.settings\.sourcesOnOpen !== true/,
  );
  assert.match(details, /if \(ok\) setSourcesOpen\(false\)/);
  assert.match(details, /className="sources-modal"/);
});
