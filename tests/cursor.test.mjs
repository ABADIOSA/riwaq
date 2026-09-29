import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CURSOR_IDLE_MS, CursorGate, cursorHidden } from "../core/cursor.mjs";
import { HUD_METHODS } from "../core/hud.mjs";

const region = { x: 100, y: 100, width: 800, height: 450 };
const base = {
  active: true,
  pip: false,
  minimized: false,
  region,
  point: { x: 400, y: 300 },
  stillFor: CURSOR_IDLE_MS + 1,
  hud: true,
  hudIdle: true,
  focused: false,
  paused: false,
};

test("the pointer hides only when still over the picture", () => {
  assert.equal(cursorHidden(base), true, "HUD asleep, pointer still");
  assert.equal(cursorHidden({ ...base, stillFor: 1000 }), false);
  assert.equal(
    cursorHidden({ ...base, point: { x: 50, y: 300 } }),
    false,
    "outside the picture, e.g. on the side panel or another window",
  );
  assert.equal(
    cursorHidden({ ...base, point: { x: 900, y: 300 } }),
    false,
    "the right edge is outside",
  );
  assert.equal(cursorHidden({ ...base, active: false }), false);
  assert.equal(cursorHidden({ ...base, pip: true }), false);
  assert.equal(cursorHidden({ ...base, minimized: true }), false);
  assert.equal(cursorHidden({ ...base, region: null }), false);
});

test("with the HUD, its controls decide; without it, focus and pause do", () => {
  assert.equal(
    cursorHidden({ ...base, hudIdle: false }),
    false,
    "paused, a panel open or the pointer on a control keeps it",
  );
  assert.equal(
    cursorHidden({ ...base, focused: false }),
    true,
    "the HUD never takes focus, so focus does not matter",
  );
  const bare = { ...base, hud: false, hudIdle: false };
  assert.equal(cursorHidden({ ...bare, focused: true }), true);
  assert.equal(cursorHidden({ ...bare, focused: false }), false);
  assert.equal(cursorHidden({ ...bare, focused: true, paused: true }), false);
});

test("the Win32 display counter stays balanced", () => {
  let counter = 0;
  const calls = [];
  const gate = new CursorGate((visible) => {
    calls.push(visible);
    counter += visible ? 1 : -1;
    return counter;
  });
  gate.set(true);
  gate.set(true);
  gate.set(true);
  assert.equal(counter, -1, "one hide however often it is asked");
  gate.set(false);
  gate.set(false);
  assert.equal(counter, 0);
  gate.set(true);
  gate.release();
  gate.release();
  assert.equal(counter, 0, "release restores exactly what was hidden");
  assert.deepEqual(calls, [false, true, false, true]);
  const broken = new CursorGate(() => {
    throw new Error("no user32");
  });
  assert.equal(broken.set(true), false);
  assert.equal(broken.hidden, false, "a failed call is not counted");
});

test("the HUD reports its idle state and main releases the pointer", () => {
  assert.ok(HUD_METHODS.has("hudIdle"));
  const main = readFileSync(
    new URL("../electron/main.mjs", import.meta.url),
    "utf8",
  );
  const hud = readFileSync(
    new URL("../src/components/Hud.jsx", import.meta.url),
    "utf8",
  );
  assert.match(hud, /call\("hudIdle"/);
  for (const where of ["function closeHud", 'hud.on("closed"', "will-quit"]) {
    const at = main.indexOf(where);
    assert.ok(at > 0, where);
    assert.ok(
      main.slice(at, at + 400).includes("cursorGate.release()"),
      `${where} gives the pointer back`,
    );
  }
});
