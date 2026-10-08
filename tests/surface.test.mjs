import test from "node:test";
import assert from "node:assert/strict";
import {
  SURFACE_FIX_LIMIT,
  SurfaceWatch,
  childFix,
  outputFits,
  surfaceRect,
} from "../core/surface.mjs";

test("the surface's rectangle follows the reported layout in physical pixels", () => {
  const layout = { x: 10, y: 20, width: 800, height: 450, viewportWidth: 1000 };
  assert.deepEqual(surfaceRect(layout, { right: 1500, bottom: 900 }), {
    left: 15,
    top: 30,
    width: 1200,
    height: 675,
  });
  // Clamped to the client area, and empty when the window is minimized.
  assert.deepEqual(surfaceRect(layout, { right: 1000, bottom: 300 }), {
    left: 10,
    top: 20,
    width: 800,
    height: 280,
  });
  assert.deepEqual(surfaceRect(layout, { right: 0, bottom: 0 }), {
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  });
  for (const bad of [
    null,
    { ...layout, width: 0 },
    { ...layout, viewportWidth: 0 },
    { ...layout, x: Number.NaN },
  ])
    assert.equal(surfaceRect(bad, { right: 1500, bottom: 900 }), null);
});

test("MPV's window stuck at 1×1 is brought to the surface's size", () => {
  const host = { visible: true, width: 1600, height: 900 };
  assert.deepEqual(childFix(host, { visible: true, width: 1, height: 1 }), {
    resize: true,
    show: false,
    width: 1600,
    height: 900,
  });
  assert.deepEqual(
    childFix(host, { visible: false, width: 1600, height: 900 }),
    { resize: false, show: true, width: 1600, height: 900 },
  );
  // A pixel of rounding is not worth a resize.
  assert.equal(
    childFix(host, { visible: true, width: 1599, height: 901 }),
    null,
  );
  // Nothing to do without a shown surface or without MPV's window.
  assert.equal(childFix({ ...host, visible: false }, { width: 1 }), null);
  assert.equal(childFix({ visible: true, width: 1, height: 1 }, {}), null);
  assert.equal(childFix(host, null), null);
});

test("the diagnostic counts MPV's window only when it covers the surface", () => {
  const size = { width: 1280, height: 720 };
  assert.equal(
    outputFits(size, [{ visible: true, width: 1, height: 1 }]),
    false,
  );
  assert.equal(
    outputFits(size, [{ visible: false, width: 1280, height: 720 }]),
    false,
  );
  assert.equal(
    outputFits(size, [{ visible: true, width: 1279, height: 719 }]),
    true,
  );
  // Without the surface's size, any shown window with an area counts.
  assert.equal(
    outputFits(undefined, [{ visible: true, width: 5, height: 5 }]),
    true,
  );
  assert.equal(outputFits(size, []), false);
});

test("a window that keeps needing correction restarts the viewing once", () => {
  const watch = new SurfaceWatch();
  assert.equal(watch.note(true), "fixed");
  assert.equal(watch.note(false), "ok", "a correction that took resets");
  const verdicts = [];
  for (let i = 0; i < SURFACE_FIX_LIMIT * 3; i++)
    verdicts.push(watch.note(true));
  assert.equal(verdicts.filter((v) => v === "restart").length, 1);
  assert.equal(verdicts[SURFACE_FIX_LIMIT - 1], "restart");
  // The restart itself keeps that one restart; a fresh viewing gets a new one.
  watch.reset({ keepRestart: true });
  for (let i = 0; i < SURFACE_FIX_LIMIT; i++)
    assert.notEqual(watch.note(true), "restart");
  watch.reset();
  for (let i = 1; i < SURFACE_FIX_LIMIT; i++) watch.note(true);
  assert.equal(watch.note(true), "restart");
});
