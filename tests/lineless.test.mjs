import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  retireLineless,
  safeSettings,
} from "../core/protocol.mjs";
import { playerArgs } from "../electron/player.mjs";
import { separateWindow } from "../core/player-tuning.mjs";
import { Client } from "../core/client.mjs";

// The 0.38.3 report's own picture settings, with "lineless video" on.
const reported = {
  ...DEFAULT_SETTINGS,
  videoQuality: "high",
  renderer: "gpu-next",
  linelessVideo: true,
  displayPanel: "oled",
  hdrMode: "window",
  rtxUpscale: true,
  rtxHdr: true,
  hdr: true,
};

test("no viewing ever asks MPV for a BitBlt swapchain", () => {
  for (const separate of [false, true]) {
    const args = playerArgs({
      pipe: "p",
      host: 7,
      settings: reported,
      url: "https://cdn.example/v.mkv",
      title: "t",
      separate,
      deferLoad: true,
    });
    assert.ok(!args.some((a) => a.startsWith("--d3d11-flip")), `${separate}`);
  }
});

test("a profile that had it keeps watching inside Riwaq, and the option is gone", () => {
  const migrated = retireLineless(reported);
  assert.equal("linelessVideo" in migrated, false);
  assert.equal(migrated.hdrMode, "tonemap");
  assert.equal(separateWindow(migrated, { hdrSource: true }), false);
  // Everything else the viewer chose stays.
  for (const key of ["videoQuality", "renderer", "displayPanel", "rtxHdr"])
    assert.equal(migrated[key], reported[key], key);
  // Without the old option, a chosen window is left alone.
  assert.equal(
    retireLineless({ ...reported, linelessVideo: false }).hdrMode,
    "window",
  );
  assert.equal(retireLineless({ hdrMode: "window" }).hdrMode, "window");
});

test("the migration runs when a profile loads and when an old backup is restored", () => {
  const c = new Client({
    load: () => ({ settings: { ...reported } }),
    save: () => {},
  });
  assert.equal(c.state.settings.hdrMode, "tonemap");
  assert.equal("linelessVideo" in c.state.settings, false);
  // Choosing the window afterwards is respected.
  const chosen = safeSettings({ hdrMode: "window" }, c.state.settings);
  assert.equal(chosen.hdrMode, "window");
  // A pre-0.38.4 backup carrying the option comes back the same way.
  const restored = safeSettings(
    { hdrMode: "window", linelessVideo: true },
    DEFAULT_SETTINGS,
  );
  assert.equal(restored.hdrMode, "tonemap");
  assert.equal("linelessVideo" in restored, false);
});
