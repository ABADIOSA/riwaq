# Riwaq contributor handoff

Riwaq is an Arabic-first Windows x64 Stremio HTTP addon client. Read README.md, docs/ARCHITECTURE.md, docs/REFERENCE-REVIEW.md and VERIFICATION.md before changing behavior.

## Commands

- Node.js 24, npm, Windows x64. `npm ci`, `node scripts/fetch-mpv.mjs`, `npm run build`, `npm start`.
- `npm test` checks protocol, imports, providers, device authentication, token rotation and opt-in history queues.
- `npm run check` checks formatting. `npm run format` formats source.
- `npm run package` builds an unsigned portable Windows executable.
- Native smoke: set a NEW `RIWAQ_DATA_DIR` under `.cache`, set `RIWAQ_SMOKE=1`, then `npm start`. Build first. Requires a Windows desktop session; a restrictive process sandbox may block DPAPI or GPU initialization.
- Packaged smoke: `node scripts/test-packaged.mjs release/Riwaq-0.2.0-win-x64.exe`.

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
- GPL reference apps were studied for behavior; their implementation code is not copied into this MIT application. Keep third-party notices and MPV build provenance.
- No user account was authenticated in provider tests. Distinguish mocked tests, live catalog tests and actual native playback in reports.

## Good next contributions

1. Test real user-owned API credentials and OAuth accounts; exercise expired/revoked sessions and provider rate limits without logging secrets.
2. Extend Windows mixed-DPI, multi-monitor and HDR verification on real hardware.
3. Add a queue UI, playlist ordering, metadata-source precedence and preview images for themes.
4. Add a full external OS PiP mode if desired; the current mini player stays inside Riwaq.
5. Add installer/signing/update infrastructure and consider a bundled Stremio Service after reviewing distribution requirements.

Use focused branches and pull requests. Keep changes reviewable and update tests and limitations whenever a behavior changes.
