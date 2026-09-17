import koffi from "koffi";

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
    if (
      ![x, y, width, height, viewportWidth].every(Number.isFinite) ||
      width < 1 ||
      height < 1 ||
      viewportWidth < 1
    )
      return false;
    const client = {};
    clientRect(this.parent, client);
    const scale = client.right / viewportWidth;
    const left = Math.max(0, Math.round(x * scale)),
      top = Math.max(0, Math.round(y * scale));
    const w = Math.min(client.right - left, Math.round(width * scale));
    const h = Math.min(client.bottom - top, Math.round(height * scale));
    if (w < 1 || h < 1) {
      this.hide();
      return false;
    }
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
    return true;
  }
  hide() {
    if (this.handle) show(this.handle, 0);
    this.visible = false;
  }
  inspect() {
    let siblingsClipped = true;
    for (
      let child = getWindow(this.parent, 5), i = 0;
      child && i < 10;
      child = getWindow(child, 2), i++
    ) {
      if (child !== this.handle && !(getStyle(child, -16) & 0x04000000))
        siblingsClipped = false;
    }
    return {
      embedded: !!this.handle && parentOf(this.handle) === this.parent,
      visible: this.visible,
      rectangle: this.rectangle,
      nativeVisible: !!this.handle && isVisible(this.handle),
      siblingsClipped,
    };
  }
  dispose() {
    if (this.handle) destroy(this.handle);
    this.handle = null;
  }
}
