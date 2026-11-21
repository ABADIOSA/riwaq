# Issue #158 — a more realistic glass interface, and Flutter

Issue: https://github.com/ABADIOSA/riwaq/issues/158 (opened 2026-11-20, a tester). It asks for two things: glass that looks more real (light gradients, reflections, balanced transparency and blur, consistent material, readable text), and adopting Flutter for more advanced interfaces and cross-platform growth.

Decision for 0.56.0 (PR #155): a small refinement of the existing glass material ships; Flutter is evaluated here and **not** adopted in this release. The issue stays open for the owner's decision on the larger work. The screenshot attached to the issue could not be opened from the review environment (GitHub's private image host is outside its network policy); the issue text was read in full.

## 1. What ships in 0.56.0

All of it is the values of existing tokens in `src/glass.css`. No new layer, component, blur, animation or token consumer; no layout, spacing, type or text colour change.

- **Light from above.** `--glass-sheen` gains a soft curved reflection (a radial highlight, white 7% fading out by 60% of the surface's height) over the existing linear sheen, in the dark scheme. It is centred, so it reads the same in Arabic and English, and it has faded before the text line. The light scheme's sheen is already 75% white and is unchanged.
- **Depth.** Every glass edge gets a faint inner shade at its foot (`--glass-floor`: black 18% in dark, the theme's `rgb(26 29 36)` at 6% in light), added to `--glass-shadow`, `--glass-shadow-lift` and the dialog's rim, so a control reads as a thickness of glass instead of a flat tint.
- **Consistency.** Buttons, choice chips, round tool buttons, dialogs, the wheel's labels and the Liquid Glass badges all read these tokens, so they change together. Glass over pictures (the showcase and the theater) keeps its own darker values, which exist for readability over any picture.
- **Fallbacks unchanged in behaviour.** "Solid" glass, Windows' or the browser's reduced transparency, forced colours and browsers without backdrop-filter flatten the new values with the old ones (`--glass-floor` is transparent under Solid and forced colours; reduced transparency drops the sheen, reflection included). Reduced motion is untouched: nothing new animates.

Verified on Linux in Chromium (the web build; not on Windows): `scripts/test-ui-feedback.mjs` 26/26 with text contrast measured from pixels unchanged before and after (dark: primary 10.07, secondary 17.47, choice 5.56, chosen 10.11, wheel label 14.71; light: 4.96, 6.74, 5.99, 4.96, 14.69); computed styles show the reflection and inner shade under Glass, and none of them under Solid or reduced transparency; screenshots at 390, 768 and 1440 px in Arabic and English, dark and light, with a dialog open: no horizontal overflow, no page error, at most 1% of pixels changed per page (about 10% inside an open dark dialog, where the reflection covers its top), the largest change 15 of 255 per channel.

Not done, and why: per-card or per-button backdrop blur (CLAUDE.md, Performance: it repaints the page on every move); animated or pointer-tracking reflections (motion cost, reduced-motion and GPU budget); refraction or displacement of the backdrop (no CSS primitive does it without SVG filters that would run per frame on every surface). These are possible later, each measured against the 100 catalogs × 60 titles home first.

## 2. Is Flutter needed for this?

No. What the issue describes — gradients, reflections, translucency, blur, edge light, contrast in both schemes — is what CSS in Chromium already draws, and the app already draws it (`src/glass.css`, `src/liquid.css`, `src/wheel.css`). Flutter's `BackdropFilter` and shaders give comparable results, not better ones, for this kind of material. The limits Riwaq has with glass come from its own rules (no per-card blur, readability over pictures, Solid and reduced-transparency modes), not from the framework.

## 3. What Flutter would change in Riwaq

Riwaq is Electron 44 + React 19, with about 31,000 lines of shared logic in `core/` (103 modules) and about 30,000 lines of interface in `src/`. The same `src/` and `core/` build the web edition. A Flutter app would be a new client:

- **Player.** MPV is embedded through a Win32 child window (`electron/video-host.mjs`, `--wid`), driven over its JSON IPC pipe, with the HUD as a transparent, focusable window laid over the picture (`core/hud.mjs`, CLAUDE.md "Player input"). Flutter on Windows would need its own embedding: a platform view or texture (media_kit/libmpv render API), a new input model, and the whole set of fixes already made for focus, click activation, the separate HDR window and the freeze reports would have to be found again.
- **Native Windows calls.** Koffi (Win32 from JavaScript: window lookup, cursor, surface sizing) becomes Dart FFI or a C++ plugin.
- **Secrets.** DPAPI through Electron's `safeStorage` becomes a Windows plugin; the encrypted state file must stay readable, so the new app has to read the same DPAPI blob and the same JSON shape, or migrate it on first run with no plaintext fallback.
- **Offline downloads and torrents.** The built-in engine is WebTorrent in an Electron utility process (Node). Flutter has no Node: it would keep a Node sidecar or move to another engine (and re-certify Stremio-compatible behaviour).
- **Updates.** Updates are Ed25519-signed metadata over NSIS (`docs/UPDATES.md`); a new app needs its own installer and update path, and a one-time handover from the Electron app.
- **Profiles, backups, accounts.** Backups and account data are the `core/backup.mjs` payload, encrypted with scrypt/AES-GCM and merged by `core/sync-merge.mjs`. A Flutter client must produce byte-compatible payloads and follow the same merge, clear-record and secrets rules, or every mixed-version issue of W4 comes back in a new form.
- **Web edition.** Today it is the same code. Flutter web is a separate rendering path with different text, RTL, accessibility and size characteristics; it would not replace the web edition without its own work.
- **Arabic and RTL.** The interface's translation runtime, logical CSS and the pixel-compared Arabic layouts would be redone in Flutter's own text and layout system.

## 4. Cost and maintenance

A Flutter client is a rewrite of the interface and of every platform seam, while `core/` either stays in JavaScript behind a bridge (two runtimes to ship) or is ported to Dart (two implementations of every rule until the old one is retired). For a project maintained by one owner with AI assistance, that is a multi-month programme with a long period of two apps, not a feature. Cross-platform reach (macOS, Linux, mobile) is the real argument for it, and it is also reachable from the current stack in parts (Electron runs on macOS and Linux; the player seam is the Windows-specific part).

## 5. If it is to be explored

- A **separate prototype repository**, never in this one and never in a release branch: a Flutter shell that plays one local file through libmpv with Riwaq's glass HUD, reads a Riwaq backup file (read only) and shows its library in Arabic, RTL.
- Measured against the Electron app on the same Windows machine: cold start, memory with a 100 × 60 home, scrolling frame time, input latency on the HUD, picture correctness (HDR, the separate window), Arabic text shaping, screen-reader output.

## 6. What would justify a migration

All of these, measured, not one:

1. A product decision to ship beyond Windows and the web (mobile or TV) that the current stack cannot serve.
2. The prototype meets or beats the Electron app on start time, memory, scrolling and HUD input on Windows, and plays MPV with HDR and the separate window at least as reliably.
3. Byte-compatible reading and writing of backups and account payloads, proven against the released clients (the same bar as `scripts/test-accounts-mixed.mjs`).
4. A migration path for installed users: the encrypted state, the update channel and the signing key carried over without a plaintext step.
5. Arabic layouts, accessibility and the web edition kept, or an explicit decision about each.

Until then, visual work continues in the current stack, measured as above.
