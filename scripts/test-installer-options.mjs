// Windows-only inspection of our own NSIS wizard. Never clicks Install,
// chooses all-users or approves UAC; the test cancels before installation.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import koffi from "koffi";
if (process.platform !== "win32") throw Error("Windows required");
const exe = resolve(process.argv[2]);
const dll = koffi.load("user32.dll");
const find = dll.func(
  "void * __stdcall FindWindowExW(void *parent, void *after, str16 cls, str16 title)",
);
const pidOf = dll.func(
  "uint32 __stdcall GetWindowThreadProcessId(void *hwnd, _Out_ uint32 *pid)",
);
const text = dll.func(
  "int __stdcall GetWindowTextW(void *hwnd, _Out_ uint16 *buffer, int max)",
);
const cls = dll.func(
  "int __stdcall GetClassNameW(void *hwnd, _Out_ uint16 *buffer, int max)",
);
const style = dll.func("int32 __stdcall GetWindowLongW(void *hwnd, int index)");
const enabled = dll.func("bool __stdcall IsWindowEnabled(void *hwnd)");
const post = dll.func(
  "bool __stdcall PostMessageW(void *hwnd, uint32 msg, uintptr_t wp, intptr_t lp)",
);
const idOf = dll.func("int __stdcall GetDlgCtrlID(void *hwnd)");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const title = (h) => {
  const b = Buffer.alloc(8192);
  const n = text(h, b, 4096);
  return b.subarray(0, n * 2).toString("utf16le");
};
const classOf = (h) => {
  const b = Buffer.alloc(256);
  const n = cls(h, b, 128);
  return b.subarray(0, n * 2).toString("utf16le");
};
const children = (parent, depth = 0) => {
  if (depth > 6) return [];
  const found = [];
  for (
    let h = find(parent, null, null, null), i = 0;
    h && i < 200;
    h = find(parent, h, null, null), i++
  )
    found.push({ h, label: title(h), id: idOf(h) }, ...children(h, depth + 1));
  return found;
};
const child = spawn(exe, ["/NCRC"], {
  stdio: "ignore",
  shell: false,
  windowsHide: true,
});
let failure;
child.on("error", (e) => {
  failure = e;
});
const window = () => {
  for (
    let h = find(null, null, "#32770", null), i = 0;
    h && i < 512;
    h = find(null, h, "#32770", null), i++
  ) {
    const pid = [0];
    pidOf(h, pid);
    if (pid[0] === child.pid) return h;
  }
  return null;
};
try {
  let dialog;
  for (let i = 0; !dialog && i < 150; i++) {
    if (failure) throw failure;
    dialog = window();
    if (!dialog) await pause(100);
  }
  assert.ok(dialog, "this installer opens its own wizard");
  let option;
  for (let page = 0; page < 4; page++) {
    const controls = children(dialog);
    option = controls.find(
      (c) =>
        classOf(c.h) === "Button" &&
        [4, 9].includes(style(c.h, -16) & 15) &&
        /anyone|all users/i.test(c.label),
    );
    if (option) break;
    const next = controls.find((c) => c.id === 1 && /next/i.test(c.label));
    assert.ok(
      next && !/install/i.test(next.label),
      "only a verified Next button may be clicked, never Install",
    );
    post(dialog, 0x111, 1, 0);
    await pause(300);
  }
  assert.ok(option, "all-users option is present");
  assert.equal(enabled(option.h), true, "all-users option is enabled (#86)");
  console.log(
    JSON.stringify({
      passed: true,
      allUsersEnabled: true,
      label: option.label,
      installed: false,
    }),
  );
} finally {
  const dialog = window();
  if (dialog) post(dialog, 0x10, 0, 0);
  // A hidden cancellation confirmation is never allowed to keep the test
  // installer alive; terminate only the process we just spawned.
  await pause(500);
  if (child.exitCode === null) child.kill();
}
