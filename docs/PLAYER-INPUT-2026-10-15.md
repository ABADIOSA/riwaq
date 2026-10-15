# Windows player input after 0.46.0

The owner reports that control tooltips appear, but clicking any button has no effect. Latest published release checked: v0.46.0, main dc0b7e37358e2fa645dfcea34e94d70d48211f09. No open PR remained when this work started.

The previous HUD was explicitly non-focusable and relied on the main window or MPV for keyboard input. Chromium/CDP mouse tests bypass Windows activation and capture. A clean local baseline accepted native clicks, so the owner's persistent failure is still not reproduced. An activation failure was observed during native testing: only `pointerup` arrived, without `pointerdown` or `click`. Making a window focusable alone is insufficient; it must receive the player's focus before the first press.

## Changes

- Make the interactive transparent HUD focusable. Keep `showInactive`, then transfer focus only if Riwaq's main window or its own MPV window currently owns it. Periodic placement must not take focus from another application.
- Route keyboard bindings through MPV's existing input map using one validated keyboard binding, not raw commands. The HUD receives public hotkeys with its reduced state. Keep editing, button activation, slider arrows and Tab focus navigation local. Escape closes a panel or menu first.
- Handle the default F8 recovery key in Electron main before the renderer sees it. This continues to work when the focused HUD renderer is frozen. HDR recovery retains the existing per-viewing SDR fallback and saved preference.
- Release the hold-speed gesture on focus loss. Include focusability/focus flags in local diagnostics.

## Verification

`npm test`: 842 passing tests, including custom/default keys, symbols/modifiers, editing/native widgets, and rejection of mouse bindings or command-shaped input at the keyboard boundary.

Build first, then on Windows x64:

```powershell
$env:RIWAQ_PLAYWRIGHT = '<path to playwright>'
node scripts/test-player-hud.mjs
```

This launches an isolated profile and a byte-range local video/subtitle fixture with real Electron and bundled MPV. It uses Windows `SendInput`, verifies the exact owned HUD HWND with `WindowFromPoint` before mouse presses and checks the foreground HWND before keys. It raises its own HUD above the remote desktop browser and activates it through its harmless title area before testing controls. The cursor is restored on completion. This is purpose-built app integration, not a driver for arbitrary desktop windows.

Passing cases: embedded fullscreen and separate-window playback, native subtitle/audio tab clicks and real tracks, timeline seeking, actual MPV volume and slider keys, Space/C/Escape while the HUD owns focus, Pause/Stop after reload, missed-heartbeat fallback and recovery. Native F8 also recovers a separate-window viewing while Chromium's debugger deliberately suspends the HUD renderer, retaining position and the saved HDR setting. Browser/CDP is still used to inspect state and suspend/resume the renderer, not to substitute for the control clicks under test.

Evidence is local under `.cache/player-hud-test` and `.cache/hud-native-final.log`. The media is SDR even when labelled HDR to select the separate-window path. This is not HDR colour certification, a live provider/torrent test, or confirmation from the affected user's machine. No release or merge is implied by these results.
