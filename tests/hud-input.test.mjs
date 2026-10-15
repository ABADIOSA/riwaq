import test from "node:test";
import assert from "node:assert/strict";
import { hudKey, keyboardBinding, publicHotkeys } from "../core/hotkeys.mjs";

const key = (value, extra = {}, custom = {}) =>
  hudKey(
    { key: value, target: { tagName: "DIV" }, ...extra },
    publicHotkeys(custom),
  );

test("focused HUD uses the same key map as MPV, including recovery and custom bindings", () => {
  assert.equal(key(" "), "SPACE");
  assert.equal(key("c"), "c");
  assert.equal(key("Escape"), "ESC");
  assert.equal(key("F8"), "F8");
  assert.equal(key("ArrowRight", { shiftKey: true }), "Shift+RIGHT");
  assert.equal(key("Z", { shiftKey: true }), "Shift+z");
  assert.equal(key(">", { shiftKey: true }), ">");
  assert.equal(key("c", {}, { panel: "Ctrl+y" }), null);
  assert.equal(key("y", { ctrlKey: true }, { panel: "Ctrl+y" }), "Ctrl+y");
  assert.equal(key("q"), null);
});

test("editing, composing, button activation and accessible navigation keep their keys", () => {
  for (const tagName of ["INPUT", "SELECT", "TEXTAREA"])
    assert.equal(key(" ", { target: { tagName } }), null);
  assert.equal(key("c", { target: { isContentEditable: true } }), null);
  assert.equal(key("c", { isComposing: true }), null);
  assert.equal(key("Escape", { defaultPrevented: true }), null);
  const button = {
    tagName: "BUTTON",
    closest: (selector) => selector === "button",
  };
  assert.equal(key(" ", { target: button }), null);
  assert.equal(key("Enter", { target: button }), null);
  assert.equal(key("c", { target: button }), "c");
  assert.equal(key("ArrowRight", { target: { closest: () => true } }), null);
  assert.equal(key("Tab"), null);
});

test("HUD key forwarding accepts only one keyboard binding, never input commands", () => {
  for (const binding of ["SPACE", "Shift+LEFT", "Ctrl+y", "F8", ">"])
    assert.ok(keyboardBinding(binding));
  for (const binding of [
    null,
    {},
    "",
    "MBTN_LEFT",
    "Ctrl+MBTN_RIGHT",
    "WHEEL_UP",
    "a b",
    "a; quit",
    "SPACE\nquit",
  ])
    assert.equal(keyboardBinding(binding), false);
});
