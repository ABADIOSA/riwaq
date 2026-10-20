import test from "node:test";
import assert from "node:assert/strict";
import { holdSpeed } from "../core/hold-speed.mjs";

function fixture() {
  const calls = [],
    timers = new Map();
  let id = 0;
  const gesture = holdSpeed({
    speed: (value) => calls.push(value),
    tap: () => calls.push("tap"),
    later: (fn) => {
      timers.set(++id, fn);
      return id;
    },
    clear: (id) => timers.delete(id),
  });
  return {
    gesture,
    calls,
    run: () => {
      for (const fn of [...timers.values()]) fn();
      timers.clear();
    },
  };
}
test("short press toggles once and cannot later start a speed hold", () => {
  const { gesture, calls, run } = fixture();
  gesture.down();
  gesture.down();
  gesture.up();
  gesture.up();
  run();
  assert.deepEqual(calls, ["tap"]);
});
test("holding ignores repeats, restores the exact previous speed and never pauses", () => {
  const { gesture, calls, run } = fixture();
  gesture.down({ rate: 2, previous: 1.25 });
  run();
  gesture.down();
  gesture.up();
  assert.deepEqual(calls, [2, 1.25]);
});
test("blur restores speed; cancelled or replaced video never receives an old timer or speed", () => {
  const { gesture, calls, run } = fixture();
  gesture.down({ previous: 1.5 });
  run();
  gesture.cancel();
  gesture.down();
  gesture.cancel(false);
  run();
  gesture.down();
  run();
  gesture.cancel(false);
  gesture.up();
  assert.deepEqual(calls, [2, 1.5, 2]);
});
test("a speed selected just before keydown is read when the hold actually activates", () => {
  const { gesture, calls, run } = fixture();
  let speed = 1;
  gesture.down({ previous: () => speed });
  speed = 1.5;
  run();
  gesture.up();
  assert.deepEqual(calls, [2, 1.5]);
});
test("disabled hold (live or paused) remains one short-press action without changing speed", () => {
  const { gesture, calls, run } = fixture();
  gesture.down({ rate: 0 });
  run();
  gesture.up();
  assert.deepEqual(calls, ["tap"]);
});
