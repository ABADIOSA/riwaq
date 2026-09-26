# Verification — Riwaq 0.4.0

Date: 2026-09-26. Windows x64, Node.js 24, Electron 44.4.1. Based on main commit 60b2924b6c851f49f352b29514f890ddef03a573.

## Executed

- 105 Node tests passed, zero failures. Includes the 97 existing 0.3 tests plus queue validation/deduplication/order/capacity, migration and profile isolation, locked-library mutations, completion history, independent title identity, Arabic search and future-episode exclusion.
- Production React/Vite build passed; formatting check passed.
- Windows source smoke passed 12 scenario groups: live Cinemeta catalogs (84 posters), metadata/library/queue UI, addon and settings navigation, real MPV playback/pause/seek, Arabic subtitle selection, encrypted saved progress/resume, native video decode, full/mini child-surface geometry, fullscreen, HTML modal visibility, native clipping and zero uncaught renderer errors.
- A real MPV EOF advanced to a queued title through addon metadata and stream requests, and consumed the entry only after file-loaded. Autoplay remains disabled by default.
- Switching profiles during playback stopped and saved the outgoing viewer first; the incoming viewer retained empty progress and queue.
- The existing 0.3 live TV fixture now ran on Windows: local M3U + XMLTV → channel grid → EPG blocks → live playback by opaque key. The previous smoke setup called IPC directly without applying the returned UI state; the fixture now publishes the state update the real UI normally applies.
- Profile PIN hashing, room gating and stream ranking explanations passed in the native smoke run.
- Queue screen captured and visually reviewed at 1440×960. Latest playback records are grouped by type and ID before completed records are excluded.

## Portable

The final Windows-built portable passed launch/version 0.4.0, live catalogs, a clean isolated profile, DPAPI encryption, packaged Koffi/MPV, actual Y4M video decoding, native visibility/Chromium sibling clipping and file-loaded queue consumption. The test waits for the native surface separately from video decoding because React may report its bounds after decoding starts. The initial immediate assertion exposed that test timing race; the bounded visibility check passed.

Executable: `Riwaq-0.4.0-win-x64.exe` (134,586,752 bytes), unsigned. SHA-256: `cbf1b1cc047f1e8aeec6a80a020da64da7d4d756d29536d3c937dddfccc5de15`. Final build used `electron-builder --win portable --x64 --config.directories.output=release-final` after a sandbox EPERM when replacing an earlier build directory; it used the final production assets and unmodified build configuration otherwise.

## Remaining limits

No real third-party accounts/API keys, IPTV subscriptions, Discord client/webhooks or torrent media were used. Authenticated flows, notification delivery and parsing use test fixtures; no messages were sent to real recipients. HDR output, mixed-DPI/multi-monitor behavior, picture profiles on varied GPUs and unusual audio devices remain unverified. The application remains unsigned, with no automatic updater. Torrent playback still requires a separate Stremio Service.

Queue and manual history edits are local per-profile data. Manual completion does not write tracker history. GitHub CI results are reported separately from local checks.
