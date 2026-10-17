import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  hudKey,
  keyboardBinding,
  pointerFocus,
  publicHotkeys,
} from "../core/hotkeys.mjs";

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

test("Arabic and other non-Latin layouts keep physical player shortcuts outside text fields", () => {
  assert.equal(key("ؤ", { code: "KeyC" }), "c");
  assert.equal(key("ب", { code: "KeyF" }), "f");
  assert.equal(key("Ъ", { code: "KeyM" }), "m");
  assert.equal(key("ب", { code: "KeyF", target: { tagName: "INPUT" } }), null);
  assert.equal(key("ؤ", { code: "KeyC", isComposing: true }), null);
  assert.equal(key("ؤ", { code: "KeyC" }, { panel: "Ctrl+y" }), null);
  assert.equal(
    key("z", { code: "KeyY", ctrlKey: true }, { panel: "Ctrl+z" }),
    "Ctrl+z",
    "Latin layouts keep the character the viewer bound",
  );
});

test("a focused slider or tab list keeps only the keys it moves with", () => {
  // After the volume is touched with the mouse, its slider keeps the focus:
  // Space, Esc, F and M must still reach the player.
  const inside = (role) => ({
    tagName: "DIV",
    closest: (selector) =>
      selector.includes(`[role="${role}"]`) ? { role } : null,
  });
  for (const role of ["slider", "tablist"]) {
    const target = inside(role);
    for (const move of [
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "Home",
      "End",
      "PageUp",
      "PageDown",
    ])
      assert.equal(key(move, { target }), null, `${role} keeps ${move}`);
    assert.equal(key(" ", { target }), "SPACE");
    assert.equal(key("Escape", { target }), "ESC");
    assert.equal(key("f", { target }), "f");
    assert.equal(key("m", { target }), "m");
  }
});

test("a button a pointer pressed gives its focus back, so Space pauses instead of pressing it again", () => {
  const button = { tagName: "BUTTON" };
  assert.equal(pointerFocus(button), button);
  assert.equal(
    pointerFocus({ tagName: "DIV" }),
    null,
    "the volume slider keeps its focus for its arrows",
  );
  assert.equal(pointerFocus({ tagName: "INPUT" }), null);
  assert.equal(pointerFocus(null), null);
  // Without that focus, Space goes to the player, not to the button.
  assert.equal(key(" ", { target: { tagName: "BODY" } }), "SPACE");
  const hud = readFileSync(
    fileURLToPath(new URL("../src/components/Hud.jsx", import.meta.url)),
    "utf8",
  );
  assert.match(hud, /pointerFocus\(document\.activeElement\)\?\.blur\(\)/);
  assert.match(hud, /addEventListener\("pointerup", unfocus, true\)/);
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
