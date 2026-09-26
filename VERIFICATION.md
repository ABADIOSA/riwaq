# Verification — Riwaq 0.5.0

Date: 2026-09-26. Linux x64 container, Node.js 22 for the test run, Chromium 1194 (headless) for rendering. Built on pull request #3 (head `3068f05`), whose own Windows results are kept below because the paths they cover are unchanged or extended.

This environment has **no Windows desktop session, no MPV binary and no DPAPI**, so nothing below is a native or packaged run.

## Executed for 0.5

- `npm test`: **169 passing, 0 failing**. The 105 tests from 0.4 plus 64 new:
  - Arabic folding (5): spelling drift, digits and spacing, empty queries, library and Live TV search agreeing, and plural agreement including 103 → "103 حلقات".
  - Review fixes (4): a manual mark on an earlier episode leaves the episode in progress in continue watching; marking the episode in progress keeps its playback time; `Profiles.check()` answers without changing state; removing the last profile is refused before anything stops.
  - Backup (13): addon classification; a data-only payload carrying no secret and counting what it left; the file being ciphertext; wrong passphrase, edited header and edited ciphertext all refused; an Arabic passphrase opening regardless of Unicode composition; the eight-character minimum; version and KDF bounds checked before scrypt; a full restore on a new machine including the child profile's PIN; a data-only restore keeping this machine's keys, configured addons and MPV path; restored state starting locked with caches reset; a crafted payload cleaned field by field; a payload without a valid profile refused; a locked Settings room blocking export, preview and restore.
  - Up next and calendar (14): followed series; no "next" for an unstarted series; the first released episode after the furthest one finished; the fresh flag; an episode in progress left to continue watching; caught up until the next airing; specials excluded; ordering; the calendar window; undated episodes left out; day grouping in Asia/Riyadh versus UTC; labels; the overview skipping a series whose metadata fails; watched-up-to-here.
  - Trakt scrobbling (17): body shapes; opt-in and dependence on history tracking; play/pause/resume/stop mapping; the completion queue standing down; an early stop saving position only; offline fallback to the queue; 409 as recorded; a held entry not sent while its stop is in flight; an abandoned hold lapsing; never-started playback; live, local and non-IMDb titles excluded; switching titles without a gap; bounded settle; disconnect clearing the session; the final frame's position counting; no Trakt entry created by observing; a late reply never writing into a newly connected account.
  - Update checks (11): version parsing; semantic-version precedence including prerelease identifiers; only this repository's release pages accepted; drafts, odd tags and foreign links ignored; availability; the daily limit and forcing; turning checks off; a failed check keeping the last known release; the page main opens always validated; the request carrying only Accept and `User-Agent: Riwaq/<version>`; a malformed version unable to inject a header.
- `npm run check` (Prettier) and `npm run build` (Vite) pass.
- **Rendered in headless Chromium** at 980×680 and 1440×960 against state produced by the real `Client`, with the preload bridge stubbed: the up next rail, the library calendar tab, Details with the episode watched actions, the backup room with a passphrase entered and secrets ticked, and the updates card with an available release and the Settings badge. Zero page errors, zero console errors, zero horizontal overflow at both sizes. The screenshots were reviewed by eye and surfaced five defects that a green build did not, all fixed before this record: Arabic number agreement, an invisible Settings badge, a checkbox laid out above its label, Umm al-Qura dates beside Gregorian ones, and hardcoded version labels that had drifted to 0.3 and 0.2.0.
- **Live GitHub contract**: the real release list for this repository parsed, and its only release, the prerelease `v0.3.0`, was picked, which `/releases/latest` would have skipped. A direct check from this network returned HTTP 403 "API rate limit exceeded" (60 unauthenticated calls per hour per IP); the checker recorded the failure quietly and kept its last known release, as tested.

## Not executed for 0.5

- The Windows source smoke run and the packaged portable. None of the 0.5 surfaces (backup, up next, calendar, scrobbling, update checks) has run inside Electron on Windows. `tests/smoke-runner.mjs` was not extended, to avoid adding assertions that have never run.
- The file dialogs, the DPAPI round trip of a restored profile, and `profile.before-restore.bin` being written.
- A real Trakt account: scrobble requests were verified against the documented API shape with a stubbed client.
- A real update notice inside the app; the live check was run from Node, not from Electron.

## Executed for 0.4 (Codex, pull request #3)

- 105 Node tests passed, zero failures. Includes the 97 existing 0.3 tests plus queue validation/deduplication/order/capacity, migration and profile isolation, locked-library mutations, completion history, independent title identity, Arabic search and future-episode exclusion.
- Production React/Vite build passed; formatting check passed.
- Windows source smoke passed 12 scenario groups: live Cinemeta catalogs (84 posters), metadata/library/queue UI, addon and settings navigation, real MPV playback/pause/seek, Arabic subtitle selection, encrypted saved progress/resume, native video decode, full/mini child-surface geometry, fullscreen, HTML modal visibility, native clipping and zero uncaught renderer errors.
- A real MPV EOF advanced to a queued title through addon metadata and stream requests, and consumed the entry only after file-loaded. Autoplay remains disabled by default.
- Switching profiles during playback stopped and saved the outgoing viewer first; the incoming viewer retained empty progress and queue.
- The existing 0.3 live TV fixture now ran on Windows: local M3U + XMLTV → channel grid → EPG blocks → live playback by opaque key. The previous smoke setup called IPC directly without applying the returned UI state; the fixture now publishes the state update the real UI normally applies.
- Profile PIN hashing, room gating and stream ranking explanations passed in the native smoke run.
- Queue screen captured and visually reviewed at 1440×960. Latest playback records are grouped by type and ID before completed records are excluded.

## Portable (0.4)

The final Windows-built portable passed launch/version 0.4.0, live catalogs, a clean isolated profile, DPAPI encryption, packaged Koffi/MPV, actual Y4M video decoding, native visibility/Chromium sibling clipping and file-loaded queue consumption. The test waits for the native surface separately from video decoding because React may report its bounds after decoding starts. The initial immediate assertion exposed that test timing race; the bounded visibility check passed.

Executable: `Riwaq-0.4.0-win-x64.exe` (134,586,752 bytes), unsigned. SHA-256: `cbf1b1cc047f1e8aeec6a80a020da64da7d4d756d29536d3c937dddfccc5de15`. Final build used `electron-builder --win portable --x64 --config.directories.output=release-final` after a sandbox EPERM when replacing an earlier build directory; it used the final production assets and unmodified build configuration otherwise.

## Remaining limits (0.4, still apply)

No real third-party accounts/API keys, IPTV subscriptions, Discord client/webhooks or torrent media were used. Authenticated flows, notification delivery and parsing use test fixtures; no messages were sent to real recipients. HDR output, mixed-DPI/multi-monitor behavior, picture profiles on varied GPUs and unusual audio devices remain unverified. The application remains unsigned, with no automatic updater. Torrent playback still requires a separate Stremio Service.

Queue and manual history edits are local per-profile data. Manual completion does not write tracker history. GitHub CI results are reported separately from local checks.
