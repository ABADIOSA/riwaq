// Issue #131: right-clicking a text field showed nothing (Electron draws no
// menu of its own). Main now offers the usual text menu in the main window
// only; the player's menu stays HTML (tests/review083.test.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { attachTextMenu, textMenuItems } from "../electron/text-menu.mjs";
import { setLanguage, t } from "../core/i18n.mjs";

const ALL = {
  canCut: true,
  canCopy: true,
  canPaste: true,
  canDelete: true,
  canSelectAll: true,
};
const roles = (items) =>
  items.map((i) => (i.type === "separator" ? "-" : i.role));

test("a text field offers cut, copy, paste, delete and select all", () => {
  const items = textMenuItems({ isEditable: true, editFlags: ALL });
  assert.deepEqual(roles(items), [
    "cut",
    "copy",
    "paste",
    "delete",
    "-",
    "selectAll",
  ]);
  assert.ok(items.filter((i) => i.role).every((i) => i.enabled));
});

test("Chromium decides what applies; a password never offers cut or copy", () => {
  const empty = textMenuItems({
    isEditable: true,
    editFlags: { canPaste: true, canSelectAll: true },
  });
  assert.deepEqual(
    empty.filter((i) => i.enabled).map((i) => i.role),
    ["paste", "selectAll"],
  );
  const secret = textMenuItems({
    isEditable: true,
    inputFieldType: "password",
    editFlags: ALL,
  });
  assert.equal(secret.find((i) => i.role === "cut").enabled, false);
  assert.equal(secret.find((i) => i.role === "copy").enabled, false);
  assert.equal(secret.find((i) => i.role === "paste").enabled, true);
});

test("selected text elsewhere offers copy; a plain right-click offers nothing", () => {
  assert.deepEqual(
    roles(textMenuItems({ selectionText: "Dune", editFlags: ALL })),
    ["copy"],
  );
  assert.deepEqual(textMenuItems({ selectionText: "  " }), []);
  assert.deepEqual(textMenuItems({}), []);
});

test("labels follow the interface language", () => {
  setLanguage("en");
  try {
    const labels = textMenuItems({ isEditable: true, editFlags: ALL }, t)
      .filter((i) => i.label)
      .map((i) => i.label);
    assert.deepEqual(labels, ["Cut", "Copy", "Paste", "Delete", "Select all"]);
  } finally {
    setLanguage("ar");
  }
});

test("the menu pops up at the pointer for the main window only", async () => {
  const contents = new EventEmitter();
  const shown = [];
  const Menu = {
    buildFromTemplate: (items) => ({
      popup: (at) => shown.push({ items, at }),
    }),
  };
  attachTextMenu(contents, { t: (x) => x, Menu });
  contents.emit(
    "context-menu",
    {},
    { isEditable: true, editFlags: ALL, x: 5, y: 9 },
  );
  contents.emit("context-menu", {}, { x: 1, y: 1 });
  await new Promise((r) => setImmediate(r));
  assert.equal(shown.length, 1);
  assert.equal(shown[0].at.x, 5);
  const main = readFileSync(
    fileURLToPath(new URL("../electron/main.mjs", import.meta.url)),
    "utf8",
  );
  assert.equal(main.match(/attachTextMenu\(/g).length, 1);
  assert.match(main, /attachTextMenu\(window\.webContents/);
  assert.doesNotMatch(main, /attachTextMenu\(hud/);
});
