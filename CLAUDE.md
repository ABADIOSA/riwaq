# Riwaq contributor handoff

Riwaq is an Arabic-first Windows x64 Stremio HTTP addon client. Read README.md, docs/ARCHITECTURE.md, docs/REFERENCE-REVIEW.md and VERIFICATION.md before changing behavior.

## Commands

- Node.js 24, npm, Windows x64. `npm ci`, `node scripts/fetch-mpv.mjs`, `npm run build`, `npm start`.
- `npm test` checks protocol, imports, providers, device authentication, token rotation, opt-in history queues, the stream engine, live TV parsing, skip segments, hotkeys, profiles, presence and notifications.
- `npm run check` checks formatting. `npm run format` formats source.
- `npm run package` builds an unsigned portable Windows executable.
- Native smoke: set a NEW `RIWAQ_DATA_DIR` under `.cache`, set `RIWAQ_SMOKE=1`, then `npm start`. Build first. Requires a Windows desktop session; a restrictive process sandbox may block DPAPI or GPU initialization.
- Packaged smoke: `node scripts/test-packaged.mjs release/Riwaq-0.4.0-win-x64.exe`.

## Design and invariants

- Keep the Arabic interface, RTL geometry and all three navigation layouts usable at 980×680 and larger.
- `electron/video-host.mjs` owns a Win32 WS_CHILD surface. MPV receives its HWND using `--wid`. React reports its viewport rectangle; main calculates the physical scale. Native video must hide beneath HTML dialogs and restore afterward.
- Use only the narrow `riwaq` IPC allowlist. Never expose filesystem, shell, raw native handles or provider URLs with secrets to React.
- Persist secrets using Electron safeStorage on Windows; never add a plaintext fallback or commit profiles, addon exports or credentials.
- Providers are optional. A failing data provider must not block addon metadata or playback. Reject credential-bearing API redirects.
- Stremio sync is additive, one-way import. Do not claim two-way sync.
- Trakt uses `auth.trakt.tv` for device/token endpoints and `api.trakt.tv` for data. Respect polling intervals, expiry, 429 backoff and single-use refresh-token rotation.
- Tracker history is opt-in and account-scoped. Do not silently send playback activity. Disconnect must remove credentials and queued writes.
- Letterboxd uses a disclosed public Stremboxd addon bridge or CSV import matched with TMDB. It is NOT official unrestricted Letterboxd OAuth. Do not request Letterboxd passwords.
- Reference apps were studied for behavior; their implementation code is not copied into this MIT application. Harbor is MIT, Nuvio Desktop and Stremio Community v5 are GPL-3.0. Keep third-party notices and MPV build provenance.
- The stream engine must stay explainable: every rejection and every point carries a label the interface can show. Arabic subtitles and Arabic dubs are separate facts, and a dub is never promoted to someone who asked for the original audio.
- Live TV sources are the viewer's own. Playlist and Xtream URLs carry credentials, so channels cross the IPC bridge as opaque keys and are resolved to URLs only in main. Riwaq supplies no channels or subscriptions.
- Profiles namespace favorites, progress, connected lists and settings. Addons, provider keys, platform accounts, live sources and hotkeys stay shared. The parental PIN is scrypt-hashed and an unlock lives in memory only.
- Ship no third-party shader files. Picture profiles are built from MPV's own options; a viewer supplies their own GLSL chain if they want one.
- Discord presence and webhooks are off by default and use credentials the viewer supplies.
- No user account was authenticated in provider tests. Distinguish mocked tests, live catalog tests and actual native playback in reports.

## Good next contributions

1. Extend the Windows native smoke suite and account/hardware coverage; the 0.3 Live TV and profile paths have now run on Windows. Read VERIFICATION.md for 0.4 results.
2. Test real user-owned API credentials, OAuth accounts and an actual IPTV subscription; exercise expired/revoked sessions, provider rate limits and a catchup server without logging secrets.
3. Extend Windows mixed-DPI, multi-monitor and HDR verification on real hardware, including the cost of the picture profiles on a real GPU.
4. Turn Trakt history into a live scrobble (start/pause/stop) rather than a completion queue.
5. Add trickplay seek previews and metadata-source precedence. The 0.4 queue and ordering are implemented in core/library.mjs and LibraryView.jsx; preserve per-profile storage, file-loaded consumption and opt-in autoplay.
6. Add a full external OS PiP mode if desired; the current mini player stays inside Riwaq.
7. Add installer/signing/update infrastructure and consider a bundled Stremio Service after reviewing distribution requirements.

Use focused branches and pull requests. Keep changes reviewable and update tests and limitations whenever a behavior changes.
