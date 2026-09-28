import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HUD_METHODS,
  HUD_REQUESTS,
  hudRect,
  hudVisible,
} from "../core/hud.mjs";
import { FAILOVER_LIMIT, nextSource, playableKeys } from "../core/failover.mjs";
import { DEFAULT_SETTINGS, safeSettings } from "../core/protocol.mjs";
import { Player } from "../electron/player.mjs";

const preload = readFileSync(
  new URL("../electron/preload.cjs", import.meta.url),
  "utf8",
);

test("the HUD sits exactly over the video surface in screen DIPs", () => {
  const content = { x: 100, y: 50, width: 1440, height: 900 };
  assert.deepEqual(
    hudRect({ content, surface: { x: 0, y: 0, width: 1440, height: 900 } }),
    { x: 100, y: 50, width: 1440, height: 900 },
  );
  // CSS pixels are scaled by the page zoom.
  assert.deepEqual(
    hudRect({
      content,
      surface: { x: 24, y: 78, width: 1000, height: 500 },
      zoom: 1.25,
    }),
    { x: 130, y: 148, width: 1250, height: 625 },
  );
  // Never past the window's edge.
  const clipped = hudRect({
    content,
    surface: { x: 0, y: 0, width: 5000, height: 5000 },
  });
  assert.equal(clipped.width, 1440);
  assert.equal(clipped.height, 900);
  assert.equal(hudRect({ content, surface: null }), null);
  assert.equal(
    hudRect({ content, surface: { x: 0, y: 0, width: 10, height: 10 } }),
    null,
    "a sliver of surface gets no HUD",
  );
});

test("the HUD shows only for a visible, full-size viewing", () => {
  const base = {
    enabled: true,
    player: { active: true, pip: false },
    surfaceVisible: true,
    minimized: false,
  };
  assert.equal(hudVisible(base), true);
  assert.equal(hudVisible({ ...base, enabled: false }), false);
  assert.equal(hudVisible({ ...base, player: { active: false } }), false);
  assert.equal(
    hudVisible({ ...base, player: { active: true, pip: true } }),
    false,
    "the mini player keeps its own controls",
  );
  assert.equal(
    hudVisible({ ...base, surfaceVisible: false }),
    false,
    "a dialog in the main window hides the HUD with the video",
  );
  assert.equal(hudVisible({ ...base, minimized: true }), false);
});

test("the HUD page gets a narrower bridge than the main window", () => {
  for (const method of HUD_METHODS)
    assert.ok(
      preload.includes(`"${method}"`),
      `${method} must exist in the preload allowlist`,
    );
  for (const sensitive of [
    "backupExport",
    "backupRestore",
    "providerSave",
    "login",
    "install",
    "liveSourceAdd",
    "openUpdate",
    "copyThemeCode",
    "profileSwitch",
    "hudPanel",
  ])
    assert.ok(!HUD_METHODS.has(sensitive), `${sensitive} stays main-only`);
  assert.deepEqual([...HUD_REQUESTS].sort(), [
    "episode",
    "next",
    "previous",
    "settings",
  ]);
  assert.match(preload, /"hudCommand"/);
});

test("failover plays the next ranked playable source, and gives up", () => {
  const result = {
    streams: [
      { key: "a", supported: true },
      { key: "yt", supported: true, external: true },
      { key: "b", supported: false },
      { key: "c", supported: true },
      { key: "d", supported: true },
      { key: "e", supported: true },
      { key: "f", supported: true },
    ],
  };
  const ranked = playableKeys(result);
  assert.deepEqual(ranked, ["a", "c", "d", "e", "f"]);
  assert.equal(nextSource(ranked, new Set(["a"])), "c");
  assert.equal(nextSource(ranked, new Set(["a", "c"])), "d");
  assert.equal(
    nextSource(ranked, new Set(["a", "c", "d", "e"])),
    null,
    `no more than ${FAILOVER_LIMIT} failures per title`,
  );
  assert.equal(nextSource([], new Set(["a"])), null);
  assert.equal(nextSource(undefined, new Set(["a"])), null);
});

test("the overlay, failover and HUD settings default on and validate", () => {
  assert.equal(DEFAULT_SETTINGS.playerOverlay, true);
  assert.equal(DEFAULT_SETTINGS.autoFailover, true);
  const off = safeSettings(
    { playerOverlay: false, autoFailover: false },
    DEFAULT_SETTINGS,
  );
  assert.equal(off.playerOverlay, false);
  assert.equal(off.autoFailover, false);
  assert.equal(
    safeSettings({ playerOverlay: "no" }, DEFAULT_SETTINGS).playerOverlay,
    true,
  );
});

test("with the HUD drawing controls, MPV's own controller stays hidden", () => {
  const sent = [];
  const states = [];
  const player = new Player({ onState: (s) => states.push({ ...s }) });
  player.send = (c) => sent.push(c);
  player.state = { active: true, pip: false, fullscreen: true };
  player.setOverlay(true);
  assert.equal(player.state.overlay, true);
  assert.deepEqual(sent.at(-1), [
    "script-message",
    "osc-visibility",
    "never",
    "no-osd",
  ]);
  assert.equal(states.length, 1);
  player.setOverlay(true);
  assert.equal(states.length, 1, "no change, no event");
  player.setOverlay(false);
  assert.equal(sent.at(-1)[2], "auto", "full screen without HUD uses MPV's");
  // The overlay state carries over to the next viewing.
  player.state = { active: false };
  player.setOverlay(true);
  assert.equal(player.overlay, true);
});
