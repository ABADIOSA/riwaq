import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "../core/client.mjs";
import { DEFAULT_SETTINGS, safeSettings } from "../core/protocol.mjs";
import { Player, playerArgs } from "../electron/player.mjs";
import { inputConf } from "../core/hotkeys.mjs";

// Many addons with one catalog each, the shape of a large Stremio setup.
function rig(count, request) {
  const c = new Client({ load: () => ({}), save: () => {}, request });
  c.state.addons = Array.from({ length: count }, (_, i) => ({
    transportUrl: `https://addon${i}.test/secret-token/manifest.json`,
    enabled: true,
    manifest: {
      id: `a${i}`,
      name: `Addon ${i}`,
      version: "1.0.0",
      resources: ["catalog"],
      types: ["movie"],
      catalogs: [{ type: "movie", id: `c${i}`, name: `Catalog ${i}` }],
    },
  }));
  return c;
}
const metasFor = (url) => ({
  metas: [{ id: `tt${url.match(/addon(\d+)/)[1]}`, name: "Title" }],
});

test("one slow addon never holds up the catalogs queued behind it", async () => {
  const total = 30;
  let requested = 0;
  let releaseSlow;
  const slowDone = new Promise((resolve) => (releaseSlow = resolve));
  const c = rig(total, async (url) => {
    requested++;
    // The slow addon answers only once every other catalog was requested.
    // Lockstep batches would wait for it forever; a pool keeps going.
    if (requested === total) releaseSlow();
    if (url.includes("addon0.")) await slowDone;
    return metasFor(url);
  });
  const result = await c.catalog();
  assert.equal(requested, total);
  assert.equal(result.rows.length, total);
  assert.deepEqual(
    result.rows.map((row) => row.name),
    Array.from({ length: total }, (_, i) => `Catalog ${i}`),
    "rows keep the viewer's addon order",
  );
});

test("catalog requests are pooled, bounded and given a shorter timeout", async () => {
  let inFlight = 0;
  let peak = 0;
  const timeouts = new Set();
  const c = rig(40, async (url, init) => {
    timeouts.add(init?.timeout);
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight--;
    return metasFor(url);
  });
  await c.catalog();
  assert.ok(peak <= 10, `peak concurrency ${peak}`);
  assert.ok(peak >= 5, "requests actually run side by side");
  assert.deepEqual([...timeouts], [10000]);
});

test("the plan names each catalog by an opaque key and never exposes addon URLs", async () => {
  const c = rig(3, async (url) => metasFor(url));
  const plan = c.catalogPlan();
  assert.deepEqual(
    plan.map(({ name, provider, type }) => ({ name, provider, type })),
    [0, 1, 2].map((i) => ({
      name: `Catalog ${i}`,
      provider: `Addon ${i}`,
      type: "movie",
    })),
  );
  assert.ok(!JSON.stringify(plan).includes("http"));
  assert.ok(!JSON.stringify(plan).includes("secret-token"));
  // Loading one planned key returns exactly that row.
  const one = await c.catalog({ catalogKey: plan[1].key });
  assert.equal(one.rows.length, 1);
  assert.equal(one.rows[0].key, plan[1].key);
  assert.equal(one.rows[0].metas[0].id, "tt1");
});

test("a failing addon is remembered briefly instead of timing out on every screen", async () => {
  const calls = {};
  const c = rig(2, async (url) => {
    const id = url.match(/addon(\d+)/)[1];
    calls[id] = (calls[id] || 0) + 1;
    if (id === "1") throw new Error("HTTP 503");
    return metasFor(url);
  });
  const first = await c.catalog();
  const second = await c.catalog();
  assert.deepEqual(first.failures, ["Addon 1"]);
  assert.deepEqual(second.failures, ["Addon 1"], "still reported as failing");
  assert.equal(calls["1"], 1, "not asked again within the failure window");
  assert.equal(calls["0"], 1, "working catalogs come from the cache too");
  assert.equal(second.rows.length, 1);
});

test("full screen and fill are settings with safe defaults", () => {
  assert.equal(DEFAULT_SETTINGS.autoFullscreen, true);
  assert.equal(DEFAULT_SETTINGS.videoFill, false);
  const next = safeSettings(
    { autoFullscreen: false, videoFill: true },
    DEFAULT_SETTINGS,
  );
  assert.equal(next.autoFullscreen, false);
  assert.equal(next.videoFill, true);
  const ignored = safeSettings(
    { autoFullscreen: "yes", videoFill: 1 },
    DEFAULT_SETTINGS,
  );
  assert.equal(ignored.autoFullscreen, true);
  assert.equal(ignored.videoFill, false);
});

test("MPV starts with its controller hidden and the chosen fill mode", () => {
  const args = (settings) =>
    playerArgs({ pipe: "p", settings, url: "https://a.test/v", title: "t" });
  const fit = args(DEFAULT_SETTINGS);
  assert.ok(fit.includes("--osc=yes"));
  assert.ok(!fit.includes("--osc=no"));
  assert.ok(
    fit.some(
      (arg) =>
        arg.startsWith("--script-opts=") &&
        arg.includes("osc-visibility=never"),
    ),
  );
  assert.ok(fit.includes("--panscan=0.0"));
  assert.ok(
    args({ ...DEFAULT_SETTINGS, videoFill: true }).includes("--panscan=1.0"),
  );
  // The stream stays the last argument, after the option terminator.
  assert.deepEqual(fit.slice(-2), ["--", "https://a.test/v"]);
});

function playerRig() {
  const sent = [];
  const events = { escape: 0, stop: 0, states: 0 };
  const player = new Player({
    onState: () => events.states++,
    onEscape: () => events.escape++,
  });
  player.send = (command) => sent.push(command);
  player.stop = async () => {
    events.stop++;
  };
  player.state = { active: true, pip: false, fullscreen: false };
  return { player, sent, events };
}

test("full screen shows MPV's controller and says how to leave", () => {
  const { player, sent, events } = playerRig();
  player.setFullscreen(true);
  assert.equal(player.state.fullscreen, true);
  assert.deepEqual(sent[0], [
    "script-message",
    "osc-visibility",
    "auto",
    "no-osd",
  ]);
  assert.equal(sent[1][0], "show-text");
  assert.equal(events.states, 1);
  player.setFullscreen(true);
  assert.equal(events.states, 1, "no change, no state event");
  player.setFullscreen(false);
  assert.deepEqual(sent.at(-1), [
    "script-message",
    "osc-visibility",
    "never",
    "no-osd",
  ]);
});

test("the mini player never shows the full screen controller", () => {
  const { player, sent } = playerRig();
  player.state.pip = true;
  player.setFullscreen(true);
  assert.equal(sent[0][2], "never");
  assert.ok(!sent.some((command) => command[0] === "show-text"));
});

test("Escape leaves full screen first and closes the player only after", () => {
  const { player, events } = playerRig();
  player.state.fullscreen = true;
  player.message("riwaq-stop");
  assert.equal(events.escape, 1);
  assert.equal(events.stop, 0);
  player.state.fullscreen = false;
  player.message("riwaq-stop");
  assert.equal(events.stop, 1);
  // The interface's exit button takes the same path.
  player.state.fullscreen = true;
  player.command({ action: "exitFullscreen" });
  assert.equal(events.escape, 2);
});

test("fill crops the picture live and a later start remembers the window state", () => {
  const { player, sent } = playerRig();
  player.command({ action: "fill", value: true });
  assert.deepEqual(sent.at(-1), ["set_property", "panscan", 1]);
  assert.equal(player.state.fill, true);
  player.command({ action: "fill", value: false });
  assert.deepEqual(sent.at(-1), ["set_property", "panscan", 0]);
  // Main reports full screen even between viewings; the next one starts in it.
  player.state = { active: false };
  player.setFullscreen(true);
  assert.equal(player.fullscreen, true);
});

test("Escape in MPV still reaches the player", () => {
  assert.match(inputConf(), /^ESC script-message riwaq-stop$/m);
});
