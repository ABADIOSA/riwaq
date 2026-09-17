# Verification — Riwaq 0.3.0

Date: 2026-09-17. This file separates what was actually executed for this release from what was carried over from 0.2.0 and what remains untested. A tested beta, not a claim of exhaustive compatibility.

## Executed for 0.3.0

Host: Linux x64 container, Node.js 24. No Windows desktop session, no GPU and no MPV binary were available in this environment, so everything below is the portable part of the suite.

- `npm test`: **95 passing tests, 0 failing**, across `protocol`, `client`, `integrations`, `stream-engine`, `livetv`, `player-extras` and `profiles`. 0.2.0 shipped 28.
- `npm run build`: successful React/Vite production build (330 kB JS, 46 kB CSS).
- `npm run check`: Prettier clean across `src`, `core`, `electron`, `tests` and `scripts`.

New coverage added for this release:

- **Stream engine** (19 tests): resolution, HDR flavour, codec, source, audio and channel parsing; a file size not being read as a channel layout; `WEB-DL` not being read as a Debrid-Link cache hit; `[RD+]` versus `[RD download]`; Arabic subtitle and Arabic dub as separate facts; regional flag emoji resolving to languages; `.ts` containers not read as telesyncs; season/episode in both notations; rejection of samples, trailers, promotional junk, the wrong episode, cams and undersized files; season packs surviving the episode check; the three safety levels; the size ceiling; the quality ceiling; an Arabic dub only winning when Arabic audio was asked for; cached offers being demotable; tier assignment; stable ordering for equal offers.
- **Live TV** (16 tests): M3U attributes, groups, `#EXTVLCOPT` options and malformed entries; header rejection; XMLTV offsets, language selection, CDATA and entity decoding; now/next; guide block positioning; catchup detection and URL construction for all five conventions; Xtream endpoint and channel mapping; diacritic-tolerant Arabic search; source add/toggle/remove; a missing guide not costing the channels; and an assertion that neither the subscription password nor the stream URL appears in anything published to the interface.
- **Player extras** (15 tests): chapter-named and Arabic-named segments; the shape heuristic and its refusal to guess; the skip button's three-second cutoff; outro skipping staying opt-in; MPV binding validation; no collisions among the shipped defaults; invalid overrides falling back; conflict reporting; `input.conf` rendering; picture profiles adding only MPV scaler options; an unknown profile name never reaching MPV; the custom shader path only applying to the custom profile; live buffering and reconnection arguments; tone mapping rejecting names MPV does not know.
- **Profiles, presence and notifications** (16 tests): first-run migration of pre-profile data; per-profile isolation of library, progress and settings; isolation surviving a reload from the stored profile; PIN-gated switching with the hash absent from both the published state and the saved file; current-PIN enforcement; PIN format rules; room gating and re-locking on switch; the last profile being undeletable; Discord activity per detail level; no countdown while paused or live; presence refusing a malformed application id and surviving no Discord; the handshake and activity frame encoding; notification payloads; Discord webhook host and Telegram token validation; delivery refusing redirects; disabled targets and the finish-notice setting.
- **Client integration** (2 tests): tiers, reasons and the dropped list reaching the IPC response, and the safety setting reaching the engine through the client.

## Carried over from 0.2.0, not re-run here

These passed on Windows for 0.2.0 and the code paths they cover are unchanged or extended, but they were **not** re-executed for 0.3.0 because this environment has no Windows desktop session:

- Windows source smoke: live Cinemeta catalogs, real metadata, favorites, addon installation through the UI, theme navigation.
- Native playback: actual MPV decoding, pause, seek, external Arabic subtitle, DPAPI-encrypted progress and resume; the Win32 child surface parented to the main window; fullscreen enter/exit; native video hiding under the HTML player dialog; sibling clipping after resize.
- The packaged portable executable and its bundled Koffi and MPV.
- The live public Stremboxd manifest request.

## Added to the smoke run but not yet executed

`tests/smoke-runner.mjs` gained four new assertions groups for 0.3.0. They are written and parse, but **have never run**, because running them requires `npm run build`, `node scripts/fetch-mpv.mjs` and a Windows desktop session:

- Stream engine returning tiers and inspectable reasons through IPC.
- An M3U source with an XMLTV guide serving a channel grid and EPG blocks, live playback by opaque key, and the channel URL never crossing the bridge.
- Profiles isolating library and progress, the PIN absent from the encrypted file, and a locked room refusing access until unlocked.

Run them on Windows with a fresh `RIWAQ_DATA_DIR` and `RIWAQ_SMOKE=1`, per the README.

## Not tested at all

- **Real accounts and keys.** No Trakt, Simkl, TMDB, OMDb, MDBList, Fanart or Letterboxd account or key was used. Authenticated behavior is verified against the documented API shapes with mocks.
- **Real IPTV.** No real M3U subscription, Xtream provider or catchup server was contacted. Parsing and URL construction are verified against fixtures and the published conventions; a provider that deviates from them will need a fix.
- **Discord.** The presence client is tested against a fake socket. It has not talked to a running Discord client, and the `riwaq` asset key it references must exist in the user's own Discord application or the artwork will be blank.
- **Real webhooks.** No message has been delivered to an actual Discord channel or Telegram chat.
- **Hardware.** HDR display output, tone mapping results, multi-monitor mixed DPI, unusual audio devices and the picture profiles' real cost on a GPU are all uncertified.
- **Torrents.** Not tested with a real user torrent; requires an external Stremio Service.
- **Packaging.** `npm run package` was not run for 0.3.0. Binaries are unsigned and there is no auto-update path.
