// Windows input regression helper. Only sends input after hit-testing the
// exact HUD of the isolated Electron process under test. CDP clicks bypass
// Windows activation/capture, so they cannot establish that this path works.
import assert from "node:assert/strict";
import koffi from "koffi";

const user32 = koffi.load("user32.dll");
user32.func("void * __stdcall SetThreadDpiAwarenessContext(intptr_t context)")(
  -4,
);
const Point = koffi.struct("HudInputPoint", { x: "long", y: "long" });
const at = user32.func("void * __stdcall WindowFromPoint(HudInputPoint point)");
const root = user32.func("void * __stdcall GetAncestor(void *h, uint32 flags)");
const cursor = user32.func("bool __stdcall SetCursorPos(int x, int y)");
const position = user32.func(
  "bool __stdcall GetCursorPos(_Out_ HudInputPoint *point)",
);
const send = user32.func(
  "uint32 __stdcall SendInput(uint32 count, void *input, int size)",
);
const previous = {};
position(previous);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const mouse = (flags) => {
  const input = Buffer.alloc(40);
  input.writeUInt32LE(flags, 20);
  assert.equal(send(1, input, input.length), 1, "Windows accepts mouse input");
};
export const restoreCursor = () => cursor(previous.x, previous.y);
export async function nativeHudKey(app, vk, holdMs = 60, during) {
  const handle = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().endsWith("#hud"),
    );
    return w.getNativeWindowHandle().readBigUInt64LE().toString();
  });
  const foreground = user32.func("void * __stdcall GetForegroundWindow()");
  assert.equal(
    String(foreground()),
    handle,
    "keyboard input belongs to the owned HUD",
  );
  const input = Buffer.alloc(40);
  input.writeUInt32LE(1, 0);
  input.writeUInt16LE(vk, 8);
  // A real keyboard supplies its scan code. Omitting it leaves DOM `code`
  // empty, hiding layout-dependent shortcut failures from this test.
  const scan = user32.func(
    "uint32 __stdcall MapVirtualKeyW(uint32 code, uint32 map)",
  )(vk, 0);
  input.writeUInt16LE(scan, 10);
  assert.equal(send(1, input, input.length), 1);
  try {
    await delay(holdMs);
    await during?.();
  } finally {
    input.writeUInt32LE(2, 12);
    assert.equal(send(1, input, input.length), 1);
  }
  await delay(200);
}
export async function nativeHudClick(app, hud, locator, ratio = 0.5) {
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find(
      (w) => !w.webContents.getURL().endsWith("#hud"),
    );
    if (!BrowserWindow.getAllWindows().some((w) => w.isFocused())) w.focus();
    const h = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().endsWith("#hud"),
    );
    h.setAlwaysOnTop(true, "screen-saver");
    h.moveTop();
  });
  const box = await locator.boundingBox();
  assert.ok(box, "the control has a visible rectangle");
  const target = await app.evaluate(
    ({ BrowserWindow, screen }, point) => {
      const w = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().endsWith("#hud"),
      );
      const bounds = w.getContentBounds();
      const scale = w.webContents.getZoomFactor();
      const pos = screen.dipToScreenPoint({
        x: Math.round(bounds.x + point.x * scale),
        y: Math.round(bounds.y + point.y * scale),
      });
      return {
        ...pos,
        handle: w.getNativeWindowHandle().readBigUInt64LE().toString(),
      };
    },
    { x: box.x + box.width * ratio, y: box.y + box.height / 2 },
  );
  // Wake sleeping controls even when a previous click left the cursor at
  // exactly this point (SetCursorPos to the same point emits no movement).
  cursor(target.x + 3, target.y);
  await delay(30);
  cursor(target.x, target.y);
  await delay(150);
  // A host/browser can itself be topmost in a remote test desktop. Raise
  // only our test HUD again if a player update restored its normal level.
  if (String(root(at({ x: target.x, y: target.y }), 2)) !== target.handle) {
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().endsWith("#hud"),
      );
      w.setAlwaysOnTop(true, "screen-saver");
      w.moveTop();
    });
  }
  const hit = root(at({ x: target.x, y: target.y }), 2);
  assert.equal(
    String(hit),
    target.handle,
    "Windows hit-tests the owned HUD, never another app",
  );
  mouse(2);
  await delay(80);
  mouse(4);
  await delay(200);
}
