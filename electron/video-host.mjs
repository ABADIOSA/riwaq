import koffi from "koffi";
import { childFix, surfaceRect } from "../core/surface.mjs";

// A true WS_CHILD surface. MPV renders here, inside the Electron client area.
// Handles and Win32 calls never cross the renderer bridge.
const user32 = koffi.load("user32.dll");
const createWindow = user32.func("__stdcall", "CreateWindowExW", "void *", [
  "uint32",
  "str16",
  "str16",
  "uint32",
  "int",
  "int",
  "int",
  "int",
  "void *",
  "void *",
  "void *",
  "void *",
]);
const move = user32.func(
  "bool __stdcall SetWindowPos(void *h, void *after, int x, int y, int w, int hgt, uint32 flags)",
);
const show = user32.func("bool __stdcall ShowWindow(void *h, int command)");
// MPV's window belongs to another process: never wait on its thread.
const showAsync = user32.func(
  "bool __stdcall ShowWindowAsync(void *h, int command)",
);
const destroy = user32.func("bool __stdcall DestroyWindow(void *h)");
const parentOf = user32.func("void * __stdcall GetParent(void *h)");
const isVisible = user32.func("bool __stdcall IsWindowVisible(void *h)");
const getStyle = user32.func(
  "int32 __stdcall GetWindowLongW(void *h, int index)",
);
const setStyle = user32.func(
  "int32 __stdcall SetWindowLongW(void *h, int index, int32 value)",
);
const getWindow = user32.func(
  "void * __stdcall GetWindow(void *h, uint32 command)",
);
// Win32 BOOL is an int. Called on the Electron UI thread, which owns the main
// window and the HUD, so the counter applies over the picture; see core/cursor.mjs.
const showCursorApi = user32.func("int __stdcall ShowCursor(int show)");
export const showSystemCursor = (visible) => showCursorApi(visible ? 1 : 0);
const rect = koffi.struct("RiwaqRect", {
  left: "long",
  top: "long",
  right: "long",
  bottom: "long",
});
const clientRect = user32.func(
  "bool __stdcall GetClientRect(void *h, _Out_ RiwaqRect *r)",
);

export class VideoHost {
  constructor(window) {
    this.window = window;
    const native = window.getNativeWindowHandle();
    this.parent =
      native.length === 8
        ? native.readBigUInt64LE()
        : BigInt(native.readUInt32LE());
    setStyle(this.parent, -16, getStyle(this.parent, -16) | 0x02000000);
    // WS_CHILD | WS_CLIPCHILDREN | WS_CLIPSIBLINGS, hidden until React reports layout.
    this.handle = createWindow(
      0,
      "STATIC",
      "",
      0x46000000,
      0,
      0,
      1,
      1,
      this.parent,
      null,
      null,
      null,
    );
    if (!this.handle) throw new Error("تعذّر تجهيز سطح الفيديو المدمج");
    this.visible = false;
  }
  bounds(input = {}) {
    if (!this.handle) return false;
    if (input.visible === false) {
      this.hide();
      return true;
    }
    const { x, y, width, height, viewportWidth } = input;
    this.last = { x, y, width, height, viewportWidth };
    const client = {};
    clientRect(this.parent, client);
    const place = surfaceRect(this.last, client);
    if (!place) return false;
    if (place.width < 1 || place.height < 1) {
      this.hide();
      return false;
    }
    const { left, top, width: w, height: h } = place;
    if (!move(this.handle, 0n, left, top, w, h, 0x0010 | 0x0040)) return false;
    // Chromium's D3D child otherwise paints over the native surface after resize.
    setStyle(this.parent, -16, getStyle(this.parent, -16) | 0x02000000);
    for (
      let child = getWindow(this.parent, 5), i = 0;
      child && i < 10;
      child = getWindow(child, 2), i++
    ) {
      if (child !== this.handle)
        setStyle(child, -16, getStyle(child, -16) | 0x04000000);
    }
    this.visible = true;
    this.rectangle = { x: left, y: top, width: w, height: h };
    this.syncChild();
    return true;
  }
  /**
   * Gives the hidden surface its size before MPV starts: MPV creates its
   * window at the surface's size of that moment, and one made at 1×1 could
   * stay that small (core/surface.mjs). The last layout is used, or the whole
   * client area before the first viewing.
   */
  prepare() {
    if (!this.handle || this.visible) return false;
    const client = {};
    clientRect(this.parent, client);
    const place = surfaceRect(this.last, client) || {
      left: 0,
      top: 0,
      width: client.right,
      height: client.bottom,
    };
    if (!(place.width > 1) || !(place.height > 1)) return false;
    // SWP_NOACTIVATE | SWP_NOZORDER, and no SWP_SHOWWINDOW: it stays hidden.
    return move(
      this.handle,
      0n,
      place.left,
      place.top,
      place.width,
      place.height,
      0x0010 | 0x0004,
    );
  }
  /**
   * Keeps MPV's window at the surface's size and shown, instead of relying on
   * MPV catching the surface's resize. Returns what was corrected, or null.
   */
  syncChild() {
    if (!this.handle || !this.visible) return null;
    const host = {};
    clientRect(this.handle, host);
    for (
      let child = getWindow(this.handle, 5), i = 0;
      child && i < 4;
      child = getWindow(child, 2), i++
    ) {
      const size = {};
      clientRect(child, size);
      const fix = childFix(
        { visible: true, width: host.right, height: host.bottom },
        { visible: isVisible(child), width: size.right, height: size.bottom },
      );
      if (!fix) continue;
      // SWP_ASYNCWINDOWPOS | SWP_NOOWNERZORDER | SWP_NOACTIVATE | SWP_NOZORDER
      if (fix.resize) move(child, 0n, 0, 0, fix.width, fix.height, 0x4214);
      // SW_SHOWNA
      if (fix.show) showAsync(child, 8);
      return { ...fix, from: { width: size.right, height: size.bottom } };
    }
    return null;
  }
  hide() {
    if (this.handle) show(this.handle, 0);
    this.visible = false;
  }
  /**
   * Places the surface again from the last reported layout with a fresh
   * client rectangle. During a full screen transition the client area keeps
   * changing after React reported, and a scale taken mid-change leaves the
   * picture smaller than its frame.
   */
  refresh() {
    clearTimeout(this.settleTimer);
    clearTimeout(this.lateTimer);
    const again = () => {
      if (this.visible && this.last) this.bounds(this.last);
    };
    this.settleTimer = setTimeout(again, 60);
    this.lateTimer = setTimeout(again, 400);
  }
  inspect() {
    const outputWindows = [];
    for (
      let child = this.handle ? getWindow(this.handle, 5) : null, i = 0;
      this.handle && child && i < 10;
      child = getWindow(child, 2), i++
    ) {
      const size = {};
      clientRect(child, size);
      outputWindows.push({
        visible: isVisible(child),
        width: size.right,
        height: size.bottom,
      });
    }
    let siblingsClipped = true;
    for (
      let child = getWindow(this.parent, 5), i = 0;
      child && i < 10;
      child = getWindow(child, 2), i++
    ) {
      if (child !== this.handle && !(getStyle(child, -16) & 0x04000000))
        siblingsClipped = false;
    }
    const size = {};
    if (this.handle) clientRect(this.handle, size);
    return {
      embedded: !!this.handle && parentOf(this.handle) === this.parent,
      size: { width: size.right || 0, height: size.bottom || 0 },
      visible: this.visible,
      rectangle: this.rectangle,
      nativeVisible: !!this.handle && isVisible(this.handle),
      parentVisible: isVisible(this.parent),
      siblingsClipped,
      outputWindows,
    };
  }
  dispose() {
    clearTimeout(this.settleTimer);
    clearTimeout(this.lateTimer);
    if (this.handle) destroy(this.handle);
    this.handle = null;
  }
}
