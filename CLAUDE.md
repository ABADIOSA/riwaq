# Riwaq contributor handoff

Riwaq is an Arabic-first Windows x64 Stremio HTTP addon client. Read README.md, docs/ARCHITECTURE.md, docs/REFERENCE-REVIEW.md and VERIFICATION.md before changing behavior.

## Commands

- Node.js 24, npm, Windows x64. `npm ci`, `node scripts/fetch-mpv.mjs`, `npm run build`, `npm start`.
- `npm test` checks protocol, imports, providers, device authentication, token rotation, opt-in history queues, Trakt scrobbling, the stream engine, live TV parsing, skip segments, hotkeys, profiles, presence, notifications, the library queue, backups, up next and the calendar, update checks and Arabic folding.
- `npm run check` checks formatting. `npm run format` formats source.
- `npm run package` builds a per-user NSIS installer and portable Windows executable. Update packages use Ed25519 signatures; Windows Authenticode remains unconfigured.
- Native smoke: set a NEW `RIWAQ_DATA_DIR` under `.cache`, set `RIWAQ_SMOKE=1`, then `npm start`. Build first. Requires a Windows desktop session; a restrictive process sandbox may block DPAPI or GPU initialization.
- Packaged smoke: `node scripts/test-packaged.mjs release/Riwaq-0.8.0-win-x64.exe`.

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
- Backups are always passphrase-encrypted, exclude secrets unless the viewer opts in, carry PIN hashes, never carry machine paths, and are validated field by field on restore. Backup export, preview and restore are gated by the Settings room lock in core.
- Scrobbling is a mode of opt-in history tracking. One viewing is one play: in scrobble mode the completion queue stands down, and a write-ahead entry is held while its stop is in flight. A reply may only write into the account that sent the request.
- A manual watched mark is not playback: it keeps the record's `updated` time and stores `markedAt`.
- Library and Live TV search use `core/arabic.mjs`; counts shown to viewers use `arabicCount()`. Dates added from 0.5 use the Gregorian calendar with Latin digits.
- Updates authenticate Ed25519 metadata with assets/update-public-key.pem and verify package size/SHA-512 after download AND before execution. Never accept renderer paths, change the trust key casually, or publish unsigned metadata. Only installed NSIS copies self-update. Preserve shutdown deferral, opt-out controls and progress saving before installation. Read docs/UPDATES.md.
- Version labels in the interface come from the running version, never a literal.
- Listings load one catalog per request through `catalogPlan`, so rows appear as addons answer. Keep catalog requests pooled, never in lockstep batches, and keep addon URLs out of the plan.
- Subtitles and audio live in a side panel beside the picture (`PlayerDock.jsx`); the surface shrinks for it and is never hidden. Addon subtitle URLs stay in main: the interface sees opaque keys, and MPV tracks report an addon subtitle by that key. `core/subtitles.mjs` owns language names, ranking (language first, kind as tiebreaker), cue parsing, quick sync and style validation.
- Appearance lives in `core/appearance.mjs`: validated palettes, type, scale, cards and pages become CSS variables and classes on the app root. Root classes must never reuse an element class (a test checks). The interface scale is applied by main and never shrinks the CSS viewport below 980×680. Shared design codes carry appearance only.
- HTML cannot paint over the native video surface. In full screen the surface takes the whole window and MPV's own controller (OSC) is the on-picture control; it is hidden otherwise. Escape leaves full screen before it closes the player.
- No user account was authenticated in provider tests. Distinguish mocked tests, live catalog tests and actual native playback in reports.

## Good next contributions

1. Exercise the remaining 0.5 surfaces on a Windows desktop: backup export and restore through real dialogs and DPAPI (including `profile.before-restore.bin`), the up next rail and calendar against live Cinemeta, and scrobbling against a real Trakt account. The 0.8 update UI now passes native smoke, and an isolated real NSIS upgrade preserves encrypted data. Extend verification only with flows actually run. See VERIFICATION.md.
2. Test real user-owned API credentials, OAuth accounts and an actual IPTV subscription; exercise expired/revoked sessions, provider rate limits and a catchup server without logging secrets.
3. Extend Windows mixed-DPI, multi-monitor and HDR verification on real hardware, including the cost of the picture profiles on a real GPU.
4. Add trickplay seek previews and metadata-source precedence.
5. Add a full external OS PiP mode if desired; the current mini player stays inside Riwaq.
6. Add trusted Windows Authenticode signing. In-app update authentication now uses a separate pinned Ed25519 key; retain it when adding Windows publisher verification. Keep the matching private key in the Actions secret, never the repository.

Use focused branches and pull requests. Keep changes reviewable and update tests and limitations whenever a behavior changes.
