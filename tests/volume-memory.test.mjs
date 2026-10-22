import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "../core/client.mjs";
import { safeSettings } from "../core/protocol.mjs";
import { audioArgs, initialVolume } from "../core/player-tuning.mjs";

test("remembered volume survives restart, remains optional and respects engine ceilings", () => {
  let saved = {};
  let writes = 0;
  const options = {
    load: () => structuredClone(saved),
    save: (s) => {
      saved = structuredClone(s);
      writes++;
    },
  };
  const client = new Client(options);
  client.recordVolume(150);
  assert.equal(writes, 0);
  assert.equal(initialVolume(client.state.settings), 100);
  client.settings({ rememberVolume: true });
  const before = writes;
  for (const value of [105, 115, 130, 150]) client.recordVolume(value);
  assert.equal(
    writes,
    before,
    "volume drags do not rewrite the encrypted vault for every event",
  );
  client.flushProgress();
  assert.equal(writes, before + 1);
  const restarted = new Client(options);
  assert.equal(initialVolume(restarted.state.settings), 150);
  assert.ok(audioArgs(restarted.state.settings).includes("--volume=150"));
  assert.equal(initialVolume(restarted.state.settings, 100), 100);
  restarted.settings({ volumeMax: 100 });
  assert.equal(initialVolume(restarted.state.settings), 100);
  restarted.settings({ rememberVolume: false });
  restarted.recordVolume(50);
  assert.equal(initialVolume(restarted.state.settings), 100);
  restarted.settings({ rememberVolume: true });
  restarted.recordVolume(0);
  restarted.flushProgress();
  assert.equal(
    initialVolume(new Client(options).state.settings),
    0,
    "zero volume is retained",
  );
});

test("volume settings reject nonnumbers and constrain saved/imported values", () => {
  assert.equal(safeSettings({ lastVolume: Infinity }).lastVolume, 100);
  assert.equal(safeSettings({ lastVolume: "150" }).lastVolume, 100);
  assert.equal(safeSettings({ lastVolume: -3 }).lastVolume, 0);
  assert.equal(safeSettings({ lastVolume: 900 }).lastVolume, 600);
  assert.equal(initialVolume({ rememberVolume: true, lastVolume: NaN }), 100);
  assert.equal(initialVolume({ rememberVolume: "true", lastVolume: 150 }), 100);
});

test("volume above 300% is retained for supported boost ceilings", () => {
  const c = new Client({ load: () => ({}), save() {} });
  c.settings({ rememberVolume: true, volumeMax: 600 });
  c.recordVolume(550);
  c.flushProgress();
  assert.equal(initialVolume(c.state.settings), 550);
  c.recordVolume(900);
  c.flushProgress();
  assert.equal(initialVolume(c.state.settings), 600);
});

test("enabling memory during playback captures the current level only on opt-in", () => {
  const c = new Client({ load: () => ({}), save() {} });
  assert.equal(
    c.settings({ rememberVolume: true }, { active: true, volume: 145 }).settings
      .lastVolume,
    145,
  );
  c.settings({ rememberVolume: true }, { active: true, volume: 50 });
  assert.equal(c.state.settings.lastVolume, 145);
  c.settings({ rememberVolume: false });
  c.settings({ rememberVolume: true }, { active: false, volume: 80 });
  assert.equal(c.state.settings.lastVolume, 145);
});
