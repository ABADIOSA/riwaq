# Verification — Riwaq 0.2.0

Date: 2026-09-17. Host: Windows x64. This is a tested beta, not a claim of exhaustive compatibility.

## Completed

- `npm test`: 28 passing tests. Includes real local HTTP addon protocol requests, URL/config preservation, resource filtering, Stremio import units and merge behavior, source ordering and MPV argument isolation.
- Provider/integration tests: private/public state separation, rejected API keys, independent provider failure, device-code timing and 429 backoff, current Trakt auth hostname, concurrent single-use refresh rotation, watchlist replacement only after success, opt-in history queue retry/deduplication, credential-change reset, public Letterboxd config, CSV quoting/exact match and Simkl PIN/import.
- `npm run build`: successful React/Vite production build.
- Windows source smoke: live Cinemeta catalogs (84 cards), real metadata, favorites and library, addon installation through the UI, seven-theme settings/gallery navigation, API data cards, integration cards, top-navigation layout.
- Native playback: actual MPV decoding of local fixtures; pause, seek, external Arabic subtitle, DPAPI encrypted progress and resume. The Win32 surface has the main window as parent. Native bounds follow full/mini layout; fullscreen enters/exits. The native surface hides under the HTML player-settings dialog.
- No uncaught React errors in the completed smoke run. A native Windows window capture visually confirms the video and Arabic subtitle inside Riwaq. The visual review found Chromium's D3D sibling painting over video after resize; parent/child clipping styles fixed it, and the smoke now asserts native visibility and sibling clipping.

## Portable and public-service verification

- Final portable `Riwaq-0.2.0-win-x64.exe`: passed launch, live catalogs, clean isolated profile, DPAPI, bundled MPV and actual Y4M video decoding. The packaged Koffi module creates the embedded child surface, and active visibility/clipping assertions passed.
- Live public Stremboxd manifest request returned HTTP 200 with watchlist, liked-films and search catalogs. This verifies the configured public bridge contract, not a private Letterboxd account.

## Account and hardware limits

- Real Trakt/Simkl authorization and revocation, real provider API keys/quotas and real Letterboxd account exports have not been exercised. Authenticated service behavior was verified with mocks against the documented API shapes.
- HDR display output, multi-monitor mixed DPI and unusual audio devices are not certified.
- Torrent playback was not tested with a real user torrent; it requires an external Stremio Service.
- Binaries are unsigned. No auto-update path is provided.

