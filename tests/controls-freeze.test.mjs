import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Player, POSITION_MS, playerArgs } from "../electron/player.mjs";
import { hudState, sameRect } from "../core/hud.mjs";
import { samePresence } from "../core/presence.mjs";
import { Client, PROGRESS_SAVE_MS } from "../core/client.mjs";

const read = (p) =>
  readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");

// Player controls freezing during a viewing (after 0.45.1). See
// VERIFICATION.md: MPV's window-drag loop, and main's work on every update.

test("MPV never starts a move loop on its window, in Riwaq's or its own", () => {
  for (const separate of [false, true]) {
    const args = playerArgs({
      url: "https://example.com/a.mkv",
      pipe: "\\\\.\\pipe\\x",
      host: separate ? undefined : "1234",
      settings: {},
      separate,
    });
    assert.ok(args.includes("--window-dragging=no"), `separate: ${separate}`);
    // A build a viewer picks may be older than 0.39 and refuse an option it
    // does not know; window-dragging also stops 0.41's built-in dragging.
    assert.equal(
      args.some((a) => a.startsWith("--input-builtin-dragging")),
      false,
    );
  }
});

function rig() {
  const states = [];
  const player = new Player({ onState: () => states.push(Date.now()) });
  player.send = () => {};
  player.save = () => {};
  player.lastSaved = Date.now();
  player.state = { active: true, segments: [], skip: null, position: 0 };
  return { player, states };
}
const tick = (player, name, data) =>
  player.event({ event: "property-change", name, data });

test("the network cache filling does not redraw the controls on every report", async () => {
  const { player, states } = rig();
  // MPV reports the cache every 0.25 s and on each buffering step, and the
  // bitrate every second, beside the position on every frame.
  for (let i = 1; i <= 20; i++) {
    tick(player, "demuxer-cache-time", i);
    tick(player, "cache-buffering-state", i * 5);
    tick(player, "video-bitrate", 1e6 + i);
    tick(player, "time-pos", i / 10);
  }
  assert.equal(states.length, 1, "the first update goes out at once");
  await new Promise((r) => setTimeout(r, POSITION_MS + 40));
  assert.equal(states.length, 2, "the rest go out together");
  assert.equal(player.state.bufferedUntil, 20, "with the latest values");
  assert.equal(player.state.buffering, 100);
  // Waiting for the network is news: it still goes out at once.
  tick(player, "paused-for-cache", true);
  assert.equal(states.length, 3);
  clearTimeout(player.publishTimer);
});

test("the HUD gets only the state it reads, and is placed only when it moved", () => {
  const full = {
    settings: { uiLanguage: "en" },
    progress: { "series:tt1:1:1": { position: 5 } },
    addons: [{ name: "big" }],
    favorites: [1, 2, 3],
    connectedLists: [1],
  };
  assert.deepEqual(hudState(full), {
    settings: full.settings,
    progress: full.progress,
    hotkeys: full.hotkeys,
  });
  assert.equal(hudState(null), null);
  const rect = { x: 1, y: 2, width: 300, height: 200 };
  assert.equal(sameRect(rect, { ...rect }), true);
  assert.equal(sameRect(rect, { ...rect, width: 301 }), false);
  assert.equal(sameRect(null, rect), false);
  const hud =
    read("src/components/Hud.jsx") + read("src/components/PlayerDock.jsx");
  // What the HUD reads from state: settings and progress, nothing else.
  const fields = new Set(
    [...hud.matchAll(/\bstate\??\.([a-zA-Z]+)/g)].map((m) => m[1]),
  );
  assert.deepEqual([...fields].sort(), ["hotkeys", "progress", "settings"]);
});

test("Discord hears an activity once, not on every player update", () => {
  const at = 1_000_000;
  const activity = (start, extra = {}) => ({
    type: 3,
    details: "Film",
    timestamps: { start, end: start + 6_000_000 },
    ...extra,
  });
  assert.equal(samePresence(activity(at), activity(at + 900)), true);
  assert.equal(
    samePresence(activity(at), activity(at + 60_000)),
    false,
    "a seek",
  );
  assert.equal(
    samePresence(activity(at), activity(at, { details: "Other" })),
    false,
  );
  const paused = { type: 3, details: "Film" };
  assert.equal(samePresence(activity(at), paused), false, "a pause");
  assert.equal(samePresence(paused, { ...paused }), true);
  assert.equal(samePresence(null, null), true);
  assert.equal(samePresence(paused, undefined), false);
});

test("a viewing's position reaches the encrypted file at most every 20 s", async () => {
  let saves = 0;
  const client = new Client({ save: () => saves++, load: () => ({}) });
  const film = { id: "tt1", type: "movie", name: "Film" };
  assert.equal(PROGRESS_SAVE_MS, 20000);
  client.progressSaved = 0;
  client.recordProgress(film, "tt1", 10, 100);
  assert.equal(saves, 1, "the first position is written at once");
  client.recordProgress(film, "tt1", 15, 100);
  client.recordProgress(film, "tt1", 20, 100);
  assert.equal(saves, 1, "the next ones wait");
  assert.equal(client.state.progress["movie:tt1"].position, 20, "in memory");
  assert.ok(client.progressTimer, "and are written later");
  client.flushProgress();
  assert.equal(saves, 2, "the end of a viewing writes it");
  assert.equal(client.progressTimer, null);
  client.flushProgress();
  assert.equal(saves, 2, "nothing waiting, nothing written");
  // Any other change writes everything, the waiting position included.
  client.recordProgress(film, "tt1", 25, 100);
  client.persist();
  assert.equal(saves, 3);
  assert.equal(client.progressTimer, null);
});

test("main saves and shows positions without stalling the controls", () => {
  const main = read("electron/main.mjs");
  const progress = main.slice(main.indexOf("onProgress: (...args) => {"));
  assert.match(
    progress.slice(0, 600),
    /if \(!player\.state\.active \|\| Date\.now\(\) - progressShown >= 30000\)/,
  );
  // The viewing's end writes the waiting position and shows it.
  assert.match(main, /const ended = !s\.active && watching\.active;/);
  assert.match(
    main,
    /if \(!s\.active && ended\) \{\s*client\.flushProgress\(\);\s*broadcast\(\);/,
  );
  // Quitting writes everything.
  assert.match(
    main,
    /client\?\.persist\(\);\s*await client\?\.updates\.install/,
  );
  assert.match(
    main,
    /if \(!sameRect\(hud\.getBounds\(\), rect\)\) hud\.setBounds\(rect\);/,
  );
  assert.match(main, /state: hudState\(client\.publicState\(\)\)/);
  assert.match(main, /if \(samePresence\(activity, lastActivity\)\) return;/);
  const bridge = read("web/bridge.js");
  assert.match(bridge, /client\.flushProgress\(\);/);
  assert.match(bridge, /Date\.now\(\) - progressShown >= 30000/);
});
