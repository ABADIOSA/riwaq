# Verification — Riwaq

## 2026-10-05 — embedded local music and stability review (unreleased after 0.34.0)

- Base: `e8564b493d157bd54f4aaeca077989ed291a6597`, including released 0.31–0.34 changes. No version bump or installer is produced by this change.
- **539 Node tests pass** (528 baseline + 11 new tests), repository Prettier check and Vite build pass. New tests execute the transport with controlled audio elements, filesystem library/capability responses, byte ranges, missing files, profile/PIN gates, persistence, backup exclusion, stale starts/resumes, shuffle/repeat, and delayed Spotify credential responses after disconnect/account replacement.
- `node scripts/test-music-ui.mjs` passed in actual Electron on Windows, with an isolated encrypted profile and silent synthetic WAV files. Only the native file chooser is stubbed to return the fixture selections; library IPC, protocol streaming, Chromium decoding, time progression, pause/resume/seek/next/end-of-queue, playlist/favorite/queue persistence and navigation are real. Screenshots at 1440×1000 and 980×680 were inspected. No horizontal overflow or renderer exceptions. No autoplay on renderer reload; profile switching stops audio and exposes an empty library for the other viewer. Starting MPV with a generated Y4M fixture stops music and rejects new local music sources while video is active.
- `node scripts/test-session-ui.mjs` passed, retaining session/taste/queue/settings/navigation checks and both responsive layouts.
- `node scripts/test-packaged.mjs --source --offline` passed: Windows DPAPI, bundled MPV decoding, queue consumption and a visible native child surface at 2560×1440. This is one successful source run; it does not establish the cause of the earlier intermittent native-surface failures reported in the October 3 review.
- Limits: WAV is the codec decoded in the real fixture test; other accepted extensions were not exhaustively tested. No listening-quality measurement, gapless/crossfade, ID3/cover-art extraction, real Spotify account, system media-key hardware, native file-picker interaction, packaged installer, upgrade, HDR or multi-monitor validation. Vite emits its advisory about the existing main bundle exceeding 500 kB; build succeeds. Stock Electron playback is for the viewer's local audio; streaming subscriptions are not unlocked or downloaded.
- Local file paths remain in main and encrypted state, never general `publicState`. The scheme serves a short-lived opaque capability and rechecks profile/PIN ownership and file membership on each request. Library files/playlists are device-local and excluded from portable backups; corrupt/moved tracks report an error without an automatic skip loop.

## 2026-10-03 — local taste compass (unreleased, based on 0.30.1 / 4e161e0)

- **472 Node tests pass** (462 baseline + 10 meaningful taste tests), with Vite production build and repository Prettier validation. The tests cover genre aliases, bounded/validated storage, reasons, reversible feedback, future/watched/runtime exclusions, diverse and familiar discovery, interleaved catalogs, session affinity, profile isolation/stale owners, restart/backup sanitization, PIN gating, and home-section migration.
- Real Electron renderer/main IPC test `node scripts/test-session-ui.mjs` passed with a local HTTP addon and isolated profile: 1440×1000 and 980×680 layouts; actual horizontal row scrolling; genre ranking and explanation; like/hide/undo/reset; saved preferences after reload; hidden works absent from generated sessions. Prior session, queue, navigation, settings and classic-layout assertions also pass. Zero renderer exceptions. Screenshots use synthetic artwork and titles.
- A read-only request to Cinemeta's live movie top catalog returned HTTP 200; the first three records carried genres and runtimes. This is a narrow metadata-shape check, not verification of all addons, accounts or playable sources.
- Windows MPV source smoke eventually passed three consecutive times: DPAPI, Y4M decoding, a visible clipped native surface at 2560×1440 and consumed queue item. Two initial attempts decoded video but did not observe a visible surface, and one stopped at the local fixture install request. No production playback fix is claimed: the cause of those intermittent failures remains unresolved. The runner now captures renderer exceptions and a failure screenshot/DOM snapshot to make recurrence diagnosable. Successful runs contained no renderer exceptions.
- No new installer/release/upgrade test; no live account writes; no cross-device sync, HDR or multi-monitor validation. Local ranking is an explicit genre heuristic, not an ML model or evidence of higher recommendation quality than a commercial service.

## 2026-10-03 — Riwaq sessions and navigation (unreleased, based on 0.26.0)

- **427 Node tests pass**, zero failures (419 merged baseline + 8 session tests). New coverage includes strict runtime parsing, measured remaining time, released/unwatched episodes, budget and intermission constraints, alternatives, metadata concurrency/cancellation/failure, malformed metadata, validated profile preferences and rejection of a late queue write after a profile switch.
- Vite production build and repository Prettier check pass.
- `node scripts/test-session-ui.mjs` runs the real Electron main/IPC and production renderer with an isolated data directory and a local HTTP Stremio addon fixture. Home and settings were checked at **1440×1000 and 980×680**, with screenshots inspected, no horizontal overflow and zero renderer exceptions. It exercises session creation, replacement, queue persistence, title navigation, Escape on the tools panel, the classic/new layout switch and budget persistence across reload.
- The UI test caught a startup race that reset a saved budget to 90 before profile state loaded. The session component now mounts only once startup is ready.
- `node scripts/test-packaged.mjs --source --offline` passed on Windows: DPAPI available; MPV decoded the Y4M fixture; native child and parent visible at **2560×1440**; queue entry consumed. The runner now accepts either the classic hero or the new session home as the ready state.
- These are source Electron/production-renderer checks, **not a newly packaged installer or an upgrade test**. Fixture titles and artwork in screenshots are synthetic. Live third-party account flows, arbitrary real addon runtime metadata, HDR and multiple monitors were not revalidated here. The planner does not verify source availability before proposing a title.

## 2026-10-02 — review of 0.25.1 (unreleased fixes)

- 407 Node tests passed (402 baseline): subtitle filename requests over local HTTP, scheduler retry timing, target-profile protection edits, and list sync across profile switches.
- Vite build and repository Prettier check passed.
- Windows source smoke passed via `node scripts/test-packaged.mjs --source --offline`: DPAPI available, MPV decoded Y4M, native child surface and parent visible at 2560×1440, queue item consumed. No installer build or release in this review.
- The runner now selects the main renderer rather than the new HUD, pauses the short fixture for inspection, and avoids `windowsHide` for a GUI visibility test. `--offline` skips external-catalog assertions; it is not a network isolation flag.
- Real external account flows, HDR, multiple monitors and an NSIS upgrade remain unverified here. Review findings and community sources: [Arabic review](docs/REVIEW-2026-10-02.md).

## 0.37.1 — sound without a picture

**Report:** on 0.37.0 a 4K HDR10 HEVC episode played sound, and the HUD read its quality, but no picture appeared.

What is known:
- The default picture arguments are unchanged from 0.36. The MPV build did change, from 20260610 to 20261007 (v0.41), because the old build was removed upstream.
- Which optional picture settings the viewer had on is not known yet.
- The cause was not found: there is no Windows machine here.

What changed:
- Detection: `Player.watchVideo` (`vo-configured` false six seconds after loading, with a selected video track) triggers a single restart from the same position in `SAFE_VIDEO`.
- Logging: each viewing writes an MPV log. The diagnostic shows its sanitized problem lines (`mpvLogProblems`).

Executed:
- `npm test`: **583 passing, 0 failing**. The new tests cover:
  - reporting once after six seconds, and never with a picture or without a video track;
  - the restart keeping the URL, the position and the sound settings while applying `SAFE_VIDEO` and `safe`;
  - `--log-file` in the arguments;
  - the log filter dropping command lines and headers and reducing URLs to their host.
- `npm run check` and `npm run build` pass.

Not executed: MPV on Windows. Whether `vo-configured` stays false in the reported case (as opposed to a configured but black output) is unverified; the first diagnostic report will show it.

## 0.37.0 — the player studio (Harbor's player pages)

**Request:** the owner sent Harbor's Player engine, Audio, On-screen controls, Intro skipping and Video quality pages and asked for them to be studied, improved and added.

What was built, all from MPV options and FFmpeg filters MPV ships:

- `core/player-tuning.mjs`: quality profiles, decoder, renderer, two compatibility modes, display panel, NVIDIA RTX filters, sound profiles, normalising, downmix, volume ceiling, output device, and the HUD's quality chips.
- `Player.applyTuning` applies the live properties during a viewing. RTX filters are added at runtime and tried in order.
- HUD:
  - quality chips;
  - a sleep menu by minutes or episodes, with the episode count surviving autoplay starts and stopping the advance;
  - a volume popup while the controls sleep;
  - an option to keep the controls hidden on pause.
- Full screen can be kept after a viewing.
- Skipping: recaps have their own choice, the button can step aside after a few seconds, and AniSkip is opt-in (`core/skip-online.mjs`).
- Sources: a speed cap with a labelled penalty (`neededMbps`) and a Cloudflare speed test (`core/speed-test.mjs`).
- Settings: four new pages under watching, the speed card on the sources page, and the moved items removed from the playback page.

Bug found during the render check and fixed: after choosing a sleep option, the menu closed under the pointer and the controls never slept, because Chromium sends no leave event for a removed node. The HUD now reads hover from the pointer's target on every move.

Executed:

- `npm test`: **580 passing, 0 failing**, including 32 new tests in `tests/player-tuning.test.mjs`, `tests/skip-speed-sleep.test.mjs` and `tests/theintrodb.test.mjs`. They cover:
  - the filters are built from the profile's gains;
  - the MPV device listing is parsed and unsafe names are refused;
  - start-up options and `playerArgs` integration, with a single `--hwdec`;
  - the volume ceiling;
  - the RTX candidate order and the reported status;
  - quality chips;
  - settings validation, and the backup leaving the audio device out;
  - AniSkip and ARM parsing, including a failure returning silence;
  - TheIntroDB URLs, millisecond parsing with open ends, the Bearer key and failures not being cached;
  - TheIntroDB's key never reaching `publicState` and travelling only in a secrets backup;
  - segment merging, the recap mode, the hidden button and recap auto-skip;
  - the speed penalty and ranking, and the speed test arithmetic;
  - sleep by episodes.
- `npm run check` and `npm run build` pass.
- Mocked-bridge render (render-51), at 980×680 in Riwaq's interface and 1440×960 in classic:
  - every new page renders and writes the right setting;
  - the device list fills from the mocked `audioDevices` reply;
  - the speed test result offers and applies 50 Mbps;
  - the playback page no longer shows the moved items;
  - 0 overflow, 0 errors.
- HUD render:
  - chips read `4K · HDR10 · HEVC · E-AC3 5.1 · RTX VSR`;
  - the sleep menu sends `sleepEpisodes 1` and labels it;
  - the controls sleep, and a volume change then shows the popup in the chosen position, which leaves after 1.3 s;
  - a pause keeps the controls hidden when asked;
  - a `hidden` skip button is not drawn;
  - the slider maximum follows `volumeMax`.

MPV build: the first 0.37.0 release run failed at "Fetch the pinned MPV build" with a 404, because shinchiro removed the 20260610 release upstream (it keeps only recent builds). The pin moved to `mpv-x86_64-20261007-git-eb0ee10315.7z`, SHA-256 `6720298e…c96f81`, read from the release page's published digest. `scripts/fetch-mpv.mjs` verifies it on download, and THIRD-PARTY.md records the provenance.

Not executed:

- MPV itself on Windows, so the audio filters, the downmix, `--profile=fast/high-quality`, `--target-contrast`, `--d3d11-flip=no` and `--d3d11-output-format=rgba8` were not heard or seen on real hardware.
- RTX Video on an NVIDIA card. The true-HDR output format name varies by build, so three forms are tried.
- A real audio device listing.
- Live TheIntroDB, AniSkip, ARM or Cloudflare requests (egress is blocked here).
  - TheIntroDB's request and response shape was read from its official MPV script (github.com/TheIntroDB/mpv-script), since theintrodb.org itself is blocked here.
  - A render (render-52) checked its key field: save, show/hide, test, the site link, and its absence from the data providers page.

## 0.36.0 — official theme songs, no fan uploads

**Report:** the owner said the theme music can be a fan-made track, not the official one, and asked whether an API key would help.

**Answer in code:** no new key. Wikidata (keyless, already used for credits) knows many works' official soundtrack album (P406) with its Spotify (P2205), Apple Music (P2281) and Deezer (P2722) IDs, and the composer (P86). The viewer's existing TMDB key adds composers from the crew (`Original Music Composer`, `Music`, `Main Title Theme Composer`).

What changed:

- `officialMusicQuery` (IMDb ID validated) and `parseOfficialMusic` (IDs validated by pattern, at most three each) in `core/theme-song.mjs`.
- `client.themeSong` tries the official album first (Spotify `albumTracks` when linked, then iTunes lookup, then Deezer album tracks) through `pickOfficialTrack`, then falls back to the search.
- The `themeSongTrust` setting: `official` (default) or `relaxed`. With `official` and a known composer, other artists are refused. With no known composer, an album without soundtrack or theme words is refused.
- `BAD_WORDS` now refuses plural covers and tributes, "inspired by", piano and epic versions, lo-fi, medleys, renditions, "fan made", sleep and relaxing music.
- Details shows a «رسمية» badge with the composer in its tooltip.

Executed:

- `npm test`: **548 passing, 0 failing**, including 5 new tests in `tests/theme-song-official.test.mjs`. They cover:
  - the composer filter;
  - refusal of fan words;
  - SPARQL ID safety;
  - the pick from the official album;
  - the client using the album before any search (only the Wikidata and iTunes lookup hosts are asked).
- `npm run check` and `npm run build` pass.
- Mocked-bridge render (render-50): the chip shows «رسمية» for Spotify Premium, for the viewer's own music playing, and with no Spotify. The not-found note still offers a platform search. 0 errors.

Not executed: real Wikidata, iTunes, Deezer or Spotify requests (egress is blocked here), and audio on Windows. Wikidata coverage of soundtrack albums varies by title. Without an album or a known composer, `official` trust keeps the stricter search or stays silent.

## 0.35.0 — theme songs fixed, full tracks on Spotify

**Report:** the owner said music does not play when they open a title.

**Cause found in code:** with a TMDB key, `dataHub.enrich` replaces `name` with the title in the metadata language. "Game of Thrones" became «صراع العروش». The theme search used that name against iTunes and Deezer, whose album names are English, so `pickThemeSong` never matched and the page stayed silent.

What changed:

- **Names:** `metadataOf` keeps `addonName` and TMDB enrichment adds `originalName`. `themeNames` searches those first (Latin script first, at most two).
- **Spotify:** when linked, Spotify is searched too (`searchTracks`, `fromSpotify`) and the song carries `spotifyUri`. Details plays the full track through `src/lib/theme-spotify.js` when `themeSongSource` is `auto` and the account is Premium:
  - never while the viewer's own Spotify music plays;
  - it pauses only the theme it started;
  - it falls back to the preview when there is no device.
- **Feedback and logging:** a "not found" note offers a search on the preferred platform by the original name, and theme-search failures go to the ErrorLog.

Executed:

- `npm test`: **532 passing, 0 failing** (528 + 4 in `tests/theme-song-names.test.mjs`), including a regression test where the stored meta is named «صراع العروش» with `addonName` "Game of Thrones" and the theme is found. The page-guard test was updated to the new flow.
- `npm run check` and `npm run build` pass.
- Mocked-bridge render, four cases:
  - **Premium, Spotify idle:** `play` on the theme URI, chip "كاملة على Spotify", and `pause` on leaving.
  - **The viewer's own Spotify music playing:** no command, no preview, and their track still playing after leaving.
  - **No Spotify:** the preview played.
  - **Not found:** the note, whose button opened `youtubemusic` with "Game of Thrones soundtrack theme".
  - 0 errors.

Not executed: real iTunes, Deezer or Spotify requests (egress is blocked here), a real Spotify device, and audio on Windows.

Not done: Spotify audio decoded inside Riwaq itself. That needs a Widevine-enabled Electron (castLabs ECS) signed through a castLabs EVS account that belongs to the project.

## 0.34.0 — Spotify as Riwaq's player, and theme songs

The owner asked for:

- Riwaq as the player for linked music platforms;
- a title's theme song that plays on its page, with an off switch.

What was possible:

- Riwaq uses stock Electron 44 with `--ytdl=no`. Playing Spotify, Apple Music or TIDAL audio inside it would need a Widevine build (castLabs ECS plus VMP signing), an architectural change not made without the owner's approval.
- What was built:
  - **Spotify Connect:** Riwaq shows and controls the viewer's Spotify; the audio comes from their Spotify app.
  - **Theme songs:** Riwaq plays them itself, from official 30-second previews.

What changed:

- **`core/spotify.mjs`:**
  - PKCE with the viewer's Client ID, and a fixed loopback redirect served once by main with a state check;
  - encrypted tokens with one-in-flight refresh and rotation, removed on a refused refresh or on disconnect;
  - playback, devices, playlists and validated controls;
  - Arabic messages for Spotify's refusals.
- **Interface:** `MusicBar.jsx` and the music-room Spotify card, with playlists. Saved Spotify links play through Riwaq.
- **`core/theme-song.mjs`:** keyless iTunes and Deezer searches, strict matching, preview and art host allowlists, and a day's cache.
- **Players:**
  - `src/lib/audio.js` plays one song, never over Spotify, a viewing or a hidden window.
  - The title page has a song chip with pause and "مو هذي".
  - Settings: auto, button or off, plus volume.
  - CSP `media-src` gains exactly the two preview hosts.

Executed:

- `npm test`: **528 passing, 0 failing** (513 + 7 in `tests/theme-song.test.mjs` + 8 in `tests/spotify.test.mjs`). They cover:
  - preview and art host allowlists and the CSP;
  - queries, parsing, and strict matching: covers rejected, silence over a guess, the 1984 Dune refused for the 2021 film (this caught a real scoring bug: the year penalty was raised from −3 to −6);
  - the client's own-meta rule, day cache and retry;
  - settings;
  - the page's guards;
  - PKCE and the authorize URL (no secret);
  - the exchange, with tokens kept out of public state;
  - a single refresh with rotation, and a refused refresh removing credentials;
  - control bodies (track vs context), device query and validation;
  - Arabic refusals;
  - checked pictures, the backup secret list, and main and preload wiring.
- A second bug was found while testing: `foldArabic` joins words (it is built for search), so the theme matcher got its own normalizer that keeps word boundaries.
- `npm run check` and `npm run build` pass.
- Mocked-bridge render at 980×680 (Riwaq interface, Spotify not linked) and 1440×960 (classic, linked):
  - **Theme song:**
    - on "auto" it played on entry and paused when the page closed;
    - with Spotify playing it did not play;
    - on "button" it waited for a press;
    - "مو هذي" saved `series:tt0944947` and hid the chip.
  - **Spotify:**
    - the card asked to connect with the Client ID;
    - when linked, the bar showed the track and time;
    - playlist play, pause/play and device transfer sent the expected commands;
    - controls now read left to right, and the page is padded under the bar.
  - 0 errors and 0 overflow.

Not executed:

- linking a real Spotify account;
- real iTunes or Deezer searches (egress is blocked here);
- audio output on Windows.

## 0.33.0 — music room and title theme

What changed:

- **`core/music.mjs` and `Music.jsx` (view `music`):**
  - nine platforms with exact host lists and their own search pages;
  - saved links validated (HTTPS, no credentials or port, an exact platform host, at most 600 characters), with their kind read from the path;
  - per-profile `settings.music` (at most 120 items), validated on restore.
- **Opening:** IPC `musicOpen` re-checks every address in main before `shell.openExternal`. It is main-window only and absent from the HUD. Title pages gain "موسيقى العمل".
- **`core/title-theme.mjs`:**
  - the artwork colour comes from a 48×32 canvas sample, or the genre colour when there is none;
  - the accent is clamped to stay readable;
  - variables go on `.title-page` only.
  - The setting `titleTheme` (artwork, genre or off) lives on Settings → Ambience.

Executed:

- `npm test`: **513 passing, 0 failing** (500 + 7 in `tests/music.test.mjs` + 6 in `tests/title-theme.test.mjs`). They cover:
  - host checks, including look-alike hosts, http, credentials, ports and whitespace;
  - kinds, and encoded searches that stay on each platform's hosts;
  - the soundtrack phrase;
  - validation, limits and de-duplication;
  - add/refuse and preferred platform;
  - main and preload wiring, and HUD exclusion;
  - colour conversion, the dominant colour (vivid vs grey), genre colours in Arabic and English, readable accents on dark and light palettes, theme modes, and page scoping.
- `npm run check` and `npm run build` pass.
- Mocked-bridge render at 980×680 (Riwaq interface, through "⋯") and 1440×960 (classic sidebar):
  - choosing Anghami and Spotify, then making Spotify first, saved `["spotify","anghami"]`;
  - a foreign link was refused with the Arabic sentence;
  - two links were saved, with platform chips;
  - opening sent `{url}`, `{platform:"anghami",query}` and the soundtrack search `{platform:"spotify",query:"فيلم رعب 2024 soundtrack"}`;
  - a title page with a teal backdrop got `--accent:#38E6DA` (`theme-artwork`), and "off" left the page unthemed;
  - 0 errors and 0 overflow.

Not executed:

- opening any platform page (egress is blocked here);
- whether real artwork hosts (image.tmdb.org, metahub) allow the CORS canvas read on Windows. Playwright's routed images could be read even without a CORS header, so the genre fallback is covered by unit tests only.

## 0.32.0 — finding a source in a long list

What changed:

- `core/source-view.mjs` adds the source search (every word, Arabic folded) and five quick chips with counts. Direct and torrent together mean either. In addon order, one foldable section heads each run of one addon copy.
- Details shows the tools above more than four sources. They filter only what is displayed: "recommended" stays the first ranked source, and autoplay and failover use the full list. A new request clears them.

Executed:

- `npm test`: **491 passing, 0 failing** (487 + 4 in `tests/source-view.test.mjs`). They cover:
  - words, groups and qualities, and Arabic folding;
  - chip combinations and counts;
  - sections per addon copy and the home copy;
  - the view-only wiring.
- `npm run check` and `npm run build` pass.
- Mocked-bridge render at 980×680 (addon order) and 1440×960 (Riwaq order) with 14 sources from two addons:
  - "remux" leaves 4, with "يعرض 4 من 14";
  - "عربيه" finds the "عربية" source;
  - "مخزّن" leaves 4, and adding "تورنت" leaves none with a clear button that restores all 14;
  - folding AIOStreams leaves Torrentio's 6;
  - the recommended mark stays on one source;
  - 0 errors, and no page or dialog overflow.

Not executed: a real addon's long list on Windows.

### Stability review before release (same version)

The owner asked for a full review before merging. Two code-review passes ran:

- one over everything since 0.30.1;
- one over the whole of `electron/main.mjs`, `electron/player.mjs`, `core/client.mjs`, `core/hud.mjs` and `electron/video-host.mjs`, for crashes, races, leaks and null access.

Fixed:

1. **Addon health and removal (shipped broken in 0.30.1–0.31.1):** stored addons have no `key`, so health results never matched the page, and "احذف المتوقفة" / "عطّل اللي ما تستجيب" did nothing. The earlier test passed only because its fixtures added a synthetic key. `probeAddons` now fills `keyFor(transportUrl)`, `removeAddons` matches it, and a new test uses stored-shape addons with `publicState()` keys.
2. **Two close plays spawned two MPVs:** a double click, or a pick during failover or autoplay, left one MPV unowned. Starts are now serialized by a token.
3. **Shutdown error dialog:** MPV exiting after the window closed called `isFullScreen()` on a destroyed window. Fixed with a guard.
4. **Unresponsive MPV pipe:** MPV kept playing with no control. It is now killed.
5. **Spawn errors:** a failed spawn kept a dead child, and a later kill error was misreported. Both fixed.
6. **Auto-skip:** it sent a seek on every frame while inside a segment. It now sends one per entry.
7. **Secondary subtitle:** a hard-coded track ID 2 was used. It now uses MPV's own ID.
8. **Subtitle cache:** a list was cached when every addon failed. That no longer happens.
9. **Unbounded maps:** the streams, subtitles and metas maps grew without limit. They are now bounded.
10. **Source runs:**
    - a reuse during an in-flight run returned an empty list, and now waits;
    - a run was reused after addon changes, and is now replaced;
    - expired runs were never freed, and are now pruned;
    - the late count included duplicates and rejects, and now counts only new kept sources.
11. **From the PR #43 review:**
    - TMDB rows dropped the full release date, so this year's upcoming films passed the taste shelf's future check;
    - session seeds were ordered by taste alone, and now keep their origin bands, with affinity computed once and rows sliced to what is read;
    - the taste key is memoized.
12. **Sources view:**
    - addon headings repeated when a source moved out of its run;
    - the search tools vanished while a filter was still on;
    - "يعرض" now uses `arabicCount`.

Rejected after checking: the claim that taste sorting drops in-progress titles from a session. `sessionSeeds` cuts to 18 before the sort and `prepareSession` reads every seed, so nothing was dropped. Bands were kept anyway.

Not changed: progress is still persisted every 5 s during a viewing. Debouncing it trades crash safety for speed, and needs measuring on Windows first.

Executed after the fixes:

- `npm test`: **500 passing, 0 failing** (491 + 4 source-run and late-count tests + 1 stored-shape addon test + 4 player tests).
- `npm run check` and `npm run build` pass.
- Mocked-bridge renders of the sources tools, late sources, the order switch and Sorting page, the Discover taste shelf and the session home were re-run at 980×680 and 1440×960: 0 errors, 0 overflow.

Not executed: any of the player fixes against a real MPV on Windows (double-click play, closing during a viewing, a slow pipe). The player tests use the real `Player` class with stubbed `stop`/`send`, plus source checks.

## 0.31.1 — addon order that keeps each addon's own order

The owner reported that sources did not follow their addons' order.

Causes found in code:

- In "ترتيب إضافاتي", `applyStreamPrefs` grouped streams by addon but kept Riwaq's engine rank inside each addon. An addon that sorts its own results (AIOStreams, Torrentio sorting options) lost that order.
- Priority was keyed by manifest ID alone, so two copies of one addon had the same rank and their streams interleaved by Riwaq's score. The Sorting page also listed such copies by a shared React key.
- The order could only be changed deep in Settings, and the list's heading always said "مرتبة بمحرّك رِواق".

What changed:

- Ranked streams carry `order`, their place in the replies as the addons sent them (run order, then each addon's own order), and `addonKey`.
- Addon order sorts by priority ID, then the copy's install position, then `order`. `streamOrderInside: "riwaq"` keeps the previous inside ranking.
- The Sorting page shows one entry per addon ID with a copy count, and a "داخل كل إضافة" choice.
- The sources list has an order switch that saves `streamOrder` and re-ranks with `again: true`; its heading names the order used.
- From the PR #43 review: the taste shelf names no addon, starts collapsed on Discover, and uses `LIKES`/`EXCLUDED` counts.

Executed:

- `npm test`: **487 passing, 0 failing** (471 + 3 in `tests/stream-prefs.test.mjs` + 3 in `tests/taste-discover.test.mjs`, plus #43's 10). They cover:
  - each addon's own order;
  - Riwaq inside an addon;
  - priority over install order;
  - two copies of one ID;
  - settings validation;
  - the client end to end with two addons, using `again`.
- `npm run check` and `npm run build` pass.
- Mocked-bridge render at 980×680 and 1440×960:
  - the switch reorders "B.2160p A.1080p B.720p A.720p" to "A.720p A.1080p B.720p B.2160p" through one `again` call, and the heading changes;
  - the Sorting page lists "AIOStreams (2 نسخ)" once;
  - the inside choice and priority moves save;
  - the Discover taste panel starts closed with no addon wording;
  - 0 errors and 0 overflow.

Not executed: the owner's real addons on Windows.

## 0.31.0 — sources without waiting for the slowest addon

Why: the owner's real report showed addons that time out (NexoTV) or fail slowly. `getStreams` awaited every addon with `Promise.all`, so one dead addon held the whole source list for its full 16 s request timeout.

What changed:

- `core/source-wait.mjs` `gatherSources`: the list shows when every addon has answered, 4 s after the start once one addon has returned a stream, or (past 4 s with nothing) at the first stream plus 1.2 s. With no stream anywhere it still waits for every addon.
- Late addons keep running and fill a per-title run kept five minutes. Main emits `sources` (title, count, failed names) to the main window only. Details shows "ما زالت تبحث" and then a button that re-ranks the run with `again: true`, making no new request. `playerSources` reuses the run.
- Details matches a late report against the request it made (a ref). A mocked render first showed that comparing against the page's current `meta.type` accepted a report for the wrong kind after the page's metadata changed; this was fixed before commit.
- TMDB rows now carry genre names from TMDB genre IDs (Arabic for an Arabic metadata language), so session moods match Riwaq's own rows. "فانتازيا" joined the "wonder" mood. This also gives PR #43's taste ranker something to rank on those rows.
- The ready-sources count uses `arabicCount` (`READY_SOURCES`).

Executed:

- `npm test`: **471 passing, 0 failing** (462 + 9 in `tests/source-wait.test.mjs`). The new tests use real timers and fake addons. They cover:
  - early display and the soft and grace limits;
  - waiting for everyone when nothing is found;
  - run reuse for five minutes;
  - a late success and a late failure through `Client.getStreams`, with no addon address in the event;
  - `again` making no new request while keeping existing keys valid;
  - a replaced run staying quiet;
  - main and preload wiring, and HUD exclusion;
  - TMDB genre naming and mood matching.
- `npm run check` and `npm run build` pass.
- Mocked-bridge render at 980×680 (popup) and 1440×960 (on the page):
  - the late line appears;
  - reports for another title or another kind are ignored;
  - the button reads "وصل مصدران من إضافات تأخرت · أضفها للقائمة";
  - pressing it shows 3 sources through one `again` call;
  - 0 errors and 0 overflow.

Not executed: timings against real addons on Windows, a real slow or dead addon in the packaged app, and the player's source panel with late results.

## 0.30.1 — first real diagnostic report

The owner sent the first report from a real machine. It showed:

- **System:** Windows 11 build 26200, i7-14700F, RTX-class NVIDIA GPU, two displays (one 10-bit at 240 Hz).
- **Checks:** 11 ok and 4 warnings.
  - DPAPI, data folder, MPV 0.41 version and the 30-frame decode passed on Windows. This is the first real run of these checks.
  - Cinemeta, GitHub, TMDB, Wikidata and metahub were reachable.
- **Errors:** none recorded.

Findings and what changed:

- **Video surface:** "not clipped" while hidden is a false alarm, because `bounds()` sets clipping when the surface is shown. A hidden, embedded surface is now ok and says to run the check during a viewing.
- **Trakt 403:** the probe sent no `trakt-api-key`, which Trakt always refuses. It now sends the viewer's own Trakt headers, and without a client ID a 403 reads as "reachable, needs a client ID". The key never enters the report.
- **Addons, 7 of 57 failing:**
  - "Local Files" is served by the local Stremio Service, which was not running. It is now reported as "needs Stremio Service".
  - Three answered 404 (gone), one timed out, and two failed (521 and a connection error).
  - Two "AIOMetadata" entries are the same addon installed twice.
  - New `core/addon-health.mjs` classifies each addon as ok, slow, gone, down or needs-server, and flags duplicates.
  - The Addons page gained "افحص الإضافات" (IPC `addonsHealth`, behind the addons lock, results by key and name only), "احذف المتوقفة" (`removeAddons`, two-step confirm) and "عطّل اللي ما تستجيب".
- **Sanitizer:** the local service's port is now kept in the report (`http://127.0.0.1:11470/…`).

Executed:

- `npm test`: **462 passing, 0 failing** (456 + 6 in `tests/addon-health.test.mjs`). They cover classification, duplicates, the probe returning no addresses, bulk removal behind the lock, main and preload wiring, and the four report fixes.
- `npm run check` and `npm run build` pass.
- Mocked-bridge render of the Addons page at 980×680 and 1440×960:
  - the health summary and per-addon chips appear;
  - removal needs a second click and sends only the gone addon's key;
  - disabling targets only the unresponsive addon;
  - 0 errors and 0 overflow.

## 0.30.0 — full diagnostic

Owner request: a settings button that runs a full diagnostic on Windows and produces results the owner can send back.

Executed:

- `npm test`: **456 passing, 0 failing** (449 + 7 in `tests/diagnose.test.mjs`). They cover:
  - `sanitize`: addon URLs reduced to their host, query strings, 32+ character keys, JWTs, e-mails, the Windows user folder and the home folder;
  - the error ring: capped and sanitized, with renderer errors re-sanitized;
  - `runCheck`: never throws, times out by itself and clears its timer;
  - `reportSettings`: choices only, never lists, paths or images;
  - a full `runDiagnostics` with injected fakes for Electron, the client, MPV runs and the network:
    - every area is checked;
    - a dead addon is named with its timeout, a missing Stremio Service is a warning, and a 401 from TMDB without a key counts as reachable;
    - the finished text holds no secret or addon path;
    - missing DPAPI and MPV are reported as failures, not crashes;
  - main gating the run behind the Settings lock, logging IPC, player and process errors, and keeping the methods off the HUD (source checks).
- `npm run check` and `npm run build` pass.
- Headless Chromium with a mocked bridge, at 980×680 (Riwaq's interface) and 1440×960 (classic):
  - the settings search for "تشخيص" finds the card;
  - while running it shows a busy label, then a summary and a list of checks;
  - the interface's own recent errors are sent with the request;
  - copy and save call main;
  - the preview renders line by line;
  - 0 errors and 0 overflow.

Not executed: the diagnostic on a real Windows machine. MPV spawning, `statfs`, the GPU info and the network probes there will be first exercised by the owner's report.

## 0.29.0 — what's new, shortcuts, settings search

Executed:

- `npm test`: **449 passing, 0 failing** (443 + 6 in `tests/whats-new.test.mjs`). They cover:
  - every release carrying its own highlights (the newest entry must equal `package.json`'s version), unique and newest first;
  - numeric version comparison and `seenVersion` validation;
  - "what's new" opening after an update (a profile used before the feature last saw 0.28.1), at most four releases, never on a fresh install and never twice;
  - the running version as the source and `seenVersion` written on close or silently;
  - "?" ignored in text fields;
  - binding labels for every playback key;
  - settings search folding Arabic and requiring every word.
- `npm run check` and `npm run build` pass.
- Headless Chromium with a mocked bridge, at 980×680 in Riwaq's interface and 1440×960 in the classic one, plus a fresh profile:
  - "what's new" showed 0.29.0 alone for a used profile with no record, and four releases for a profile that had seen 0.26.0;
  - closing it wrote `seenVersion: "0.29.0"`;
  - a fresh profile recorded the version without opening the window;
  - "?" in the search box typed a character, while on the page it opened the shortcuts with 31 playback keys;
  - "خصّص اختصارات المشاهدة" opened the hotkeys page;
  - settings search found pages for "إقتراحات" and "خطوة تقديم", showed the empty state for "زرافة", and its button cleared the search;
  - 0 errors, 0 overflow.

Not executed: Windows.

## 0.28.1 — settings that did nothing

Owner report: some settings buttons do not work because they come from older updates and do not match the current version.

How the problems were found (all scripts in the session scratchpad):

- **Static wiring.** Every `call`/`act`/`update` method in `src` was checked against the preload allowlist and main's `methods`. None were missing; the three window buttons go through `windowControl`.
  - Every `select` option and `toggle` in the settings components was checked through `safeSettings`: 78 values, all kept.
- **Behavioural page audit.** In headless Chromium with a mocked bridge, in both interfaces, each of the 35 settings pages was opened. Every toggle, select and non-destructive button on it was pressed.
  - Result: 0 page errors and 0 calls to methods main lacks.
  - The update switches and the adult-content toggle stayed unchanged, because the mock does not emulate `updatesConfigure` or `profileUpdate`. Both were confirmed in code: they save and return the public state.
- **Visual effect audit.** For each look option, the computed styles of sample elements were compared across values on home and on a title page.
  - Six options had no effect in Riwaq's interface: card corners on the card frame, the corner style, the accent gradient, logo style, logo tint, and (only in the classic interface) the logo tint against the default accent.
  - A targeted probe then measured each of these on the exact element. After the fixes, every value changes its element in Riwaq's interface: card frame radius 0→28 px, search box 4→18 px, gradient on the main button, monogram and name shown or hidden per logo style, gold tint against a blue accent.

Fixed:

- `session.css`: the card frame, search box and session button now follow `--poster-radius`, `--radius` and `--accent-fill`, plus a gold tint rule for the monogram.
- `RiwaqNav.jsx`: honours `logoStyle`.
- `HomeEditor`: hides the hero section in Riwaq's interface, and its move buttons skip it.
- The hero-only glow mode no longer shows a hidden hero's art, and is labelled "صفحة العمل فقط".
- `SessionHome.jsx`: Arabic plural forms (`arabicCount`) and an initial for a pick without a poster.

Executed:

- `npm test`: **443 passing, 0 failing** (440 + 3 in `tests/settings-wiring.test.mjs`). The new tests keep the IPC wiring, the option validation and these look fixes from regressing.
- `npm run check` and `npm run build` pass.
- The session page was re-rendered at 980×680 and 1440×960: 0 errors, 0 overflow.

Not executed: Windows.

## 0.28.0 — Discover arranged by Riwaq

Owner request: arrange Discover by Riwaq's own categories, as home is, and name no addon there.

Executed:

- `npm test`: **440 passing, 0 failing** (433 + 7 in `tests/discover.test.mjs`). They cover:
  - the sections with and without a TMDB key;
  - unique `d-` keys that never collide with home's rows;
  - every TMDB row building a valid request, with "recent" windows from today;
  - plan entries carrying only opaque keys and Riwaq's labels;
  - the Cinemeta URLs;
  - addon catalogs folded into sections without names or keys that open them, and de-duplicated against Riwaq's rows;
  - the tabs offered;
  - `Client.catalogPlan({ discover })`, the full-page plan and `catalog` serving a Discover row, through a mocked `request`;
  - the generic failure notice in `App.jsx`.
- `npm run check` and `npm run build` pass.
- Headless Chromium render with a mocked bridge, at 980×680 with TMDB and at 1440×960 without:
  - three addon catalogs with distinctive names were loaded alongside, plus a failing addon;
  - the page text never contained any addon or catalog name, and the failure read "بعض الأعمال لم تصل بعد";
  - the tabs were correct, the hint showed for Arabic without a key, and the sports tab came from an addon catalog;
  - "عرض الكل" opened the paged full page;
  - 0 errors, 0 horizontal overflow.

Not executed: live TMDB or Cinemeta (both blocked here), Windows.

## 0.27.0 — next episode ready, per-series skip

Owner request: develop further, and review PR #36. PR #36 was reviewed (427 tests, build, mocked-bridge render at 980×680 and 1440×960 with no errors or overflow) and merged on the owner's instruction. This branch merged locally with it passes 433 tests.

Executed:

- `npm test`: **425 passing, 0 failing** (419 + 6 in `tests/next-episode.test.mjs`). They cover:
  - `prefetchDue`: autoplay on, a series, more than two minutes long, and four minutes left or 90% watched; never live, films or unknown durations;
  - `prefetchTarget`: the queue head first, otherwise the next released episode, and nothing after the last;
  - `prefetched`: used only for the same title and profile within ten minutes;
  - `advance` using the early answer and asking again when it has no playable source, and the effect asking once per episode and profile (checked by reading `src/App.jsx`);
  - `skipPreferences` and `cleanSkipExcept`: an excluded series turns "auto" into "button" and never turns skipping on;
  - the `Player` reading live skip preferences, so an exclusion stops the automatic seek at once while the button stays.
- `npm run check` and `npm run build` pass.
- Mocked-bridge render at 980×680 on a series page with `skipIntro: "auto"`: the "تخطٍّ تلقائي للمقدمة هنا" toggle shows, starts checked, and adds the series to `skipExcept`; 0 errors, 0 overflow.

Not executed: real consecutive episodes with MPV on Windows, real addons, real chapter-based intros.

## 0.26.0 — series memory and one seek step

The owner asked for further development and a look at PR #34. That review (Codex, `codex/review-0.25-stability`, CI green, 407 tests passing locally) left two open playback findings. This release fixes both and adds the two most requested community items it listed: Harbor #1419 (keep the source) and Nuvio #611 (remember audio and subtitle tracks).

Executed:

- `npm test`: **414 passing, 0 failing** (402 + 12 in `tests/series-memory.test.mjs`). They cover:
  - `inputConf` no longer containing a fixed `seek N`, and the shipped `assets/player-input.conf` matching it;
  - `seekAmount` for both steps, with out-of-range fallbacks;
  - the running `Player` reading the step from `settingsNow` at each `riwaq-seek` message;
  - `safeSettings` for `seekStep`, `seekLongStep`, `rememberSeries` and `seriesMemory`;
  - source and track identities that never carry a URL;
  - track matching by language, title and flags, with forced versus full kept apart and "off" remembered;
  - the memory capped at 200, newest first, merged per series and forgettable;
  - `preferRemembered` staying inside the filter band;
  - `Client.getStreams` putting the remembered release of episode 1 first for episode 2, so the first supported stream (the one autoplay takes) is the same release. This runs on a mocked addon `request`.
  - The stale-subtitle guard and the record-only-viewer-choices rule in `electron/main.mjs`, checked by reading the source, since main needs Electron.
- `npm run check` and `npm run build` pass.
- Headless Chromium render with a mocked bridge (`scratchpad/ui/render-29.mjs`) at 980×680 (sources popup) and 1440×960 (sources on page):
  - the "مصدرك السابق" chip appears on the first source only;
  - the note above the list is shown, and "انسَ اختياري" sends `forgetSeries` with the series ID;
  - the settings toggle, the long-step select and the "المسلسلات المحفوظة" row are present;
  - 0 page errors and 0 horizontal overflow.

Not executed:

- No real MPV viewing of consecutive episodes on Windows. Track restoring and the keyboard seek through MPV's script message were not exercised with a real file or MPV build.
- No live addon streams.

## 0.25.1 — Trakt connection

The owner reported problems connecting to and talking with Trakt, with a screenshot of the generic toast "تعذّر إكمال العملية. تحقق من الاتصال والإعدادات ثم أعد المحاولة."

- That sentence comes from main's `cleanError`. It replaces any error message that is not Arabic, so Trakt's "HTTP 4xx" answers were hidden.
- Trakt, its documentation and its developer site are blocked from this build environment (egress proxy). The diagnosis therefore rests on web search results and on the reference apps.
- Trakt's documentation ("Required Headers") and developer reports say that Trakt's API sits behind Cloudflare and refuses requests without a User-Agent with 403, including `/oauth/device/code`. Riwaq sent no User-Agent on any Trakt request.
- The same sources confirm that OAuth requests now belong on `auth.trakt.tv`, which Riwaq already used. Harbor and Nuvio in `refs` still use `api.trakt.tv` for some of them.
- The activation page Riwaq showed, `auth.trakt.tv/activate`, was not Trakt's `verification_url`. The apps-page link `app.trakt.tv/settings/apps` was replaced with the documented `trakt.tv/oauth/applications`.

Executed:

- `npm test`: **402 passing, 0 failing** (398 + 4 in `tests/trakt-connection.test.mjs`). They cover:
  - device code, API and refresh requests all carrying `User-Agent: Riwaq/<version> (+https://github.com/ABADIOSA/riwaq)` with the API key and version headers;
  - the activation page taken from Trakt's reply only when it is HTTPS on trakt.tv;
  - 403 at connect, 401, 429, 5xx and other codes read as Arabic sentences, with `status` kept;
  - device polling 409/410/418 explained;
  - main's `cleanError` showing bare status codes.
- The scrobble test (409 means already recorded) passes, now reading `error.status`.

Not executed: a real Trakt account (blocked here), Windows.

## 0.25.0 — home by Riwaq's own categories, Discover by groups

The owner asked for a default home organisation for viewers who build no collections or who have so many addons that one row per catalog spoils the page, and the same for Discover's tabs (screenshot: arabcity-akwam, wecima, youtube, Berserk, DC, Marvel, Starwars, Sport…).

- A first version grouped the addon catalogs into shelves. The owner replied that they meant Harbor's approach: titles arranged by the app's own categories, not by addon.
- Harbor's home builds TMDB rows with a key and Cinemeta genre rows without one, and was studied for behaviour only.
- 0.25.0 therefore puts Riwaq's own rows (`core/feed.mjs`) first on home, and keeps the addon groups only for what those rows do not cover.

Executed:

- `npm test` before the Trakt section: **394 passing, 0 failing**. New since 0.24.1: 4 in `tests/smart-groups.test.mjs` and 5 in `tests/feed.test.mjs`. They cover:
  - the owner's catalogs classified into groups;
  - layouts with and without collections;
  - the groups kept beside the feed;
  - feed plans with and without a key, carrying keys and labels only;
  - hidden rows;
  - TMDB trending, chart, upcoming and Arabic/Korean discover requests;
  - backdrops from chart results;
  - Cinemeta URLs by genre and skip;
  - `Client.catalogPlan`/`catalog` serving `feed:` keys from a fake TMDB and a fake Cinemeta, including planning a single feed row for its full page.
- `npm run check`, `npm run build` and `tests/undefined-names.test.mjs` pass.
- Rendered in Chromium at 1440×960 with a mocked bridge, 12 addon catalogs modelled on the owner's and mocked feed rows:
  - With a TMDB key, home showed the 21 TMDB rows in order (رائج هذا الأسبوع … قريباً في السينما). Below them were shelves for مقترحة لك, عربي, قنوات وبث مباشر, رياضة and يوتيوب وفيديو (no films, series or anime shelves). The hero was taken from the first feed row.
  - Without a key, home showed the 16 Cinemeta rows, with an anime shelf among the addon shelves.
  - A feed row's "عرض الكل" showed 15 cards, and "تحميل المزيد" requested page 2 and showed 30.
  - Discover never requested the feed and showed only addon catalogs.
  - The settings card listed 21 Riwaq rows, and hiding "رعب" saved `feedHidden: ["horror"]`.
  - No page errors, no overflow.
- Found by the render and fixed: a feed row's full page planned no catalog, because `catalogPlan` with a `catalogKey` only searched addons.
- The earlier Discover group tabs render from the first version still applies: 10 tabs with counts, and "عربي" left only the Arabic catalogs.

Trakt suggestions (asked for after the feed: "a section of suggestions linked to Trakt"):

- `tests/trakt-suggestions.test.mjs` (4 tests) covers:
  - the request URL and bearer token;
  - dropping titles without an IMDb ID;
  - the 30-minute cache and `force`;
  - "not interested" sending `DELETE /recommendations/movies/tt…` and removing the title;
  - nothing requested without a token;
  - a reply refused when the account changes mid-request;
  - disconnect clearing the cache;
  - the section joining a pre-0.25 arrangement after "upnext" but not one saved with `homeSeen`;
  - the IPC staying off the HUD bridge.
- The section-count test now expects 8.
- `npm test`: **398 passing, 0 failing**.
- Rendered in Chromium with a mocked bridge and a profile whose saved `homeSections` predates the section:
  - Connected: the section appeared after "upnext" with 8 film cards. "مو مهتم" removed one and showed "لن يقترح تراكت «…» بعد الآن". The series chip showed 5 cards, "تحديث" asked with `force`, and a card opened its title page.
  - Not connected: the invitation's "اربط تراكت" opened the settings.
  - No page errors, no overflow.

Not executed: real TMDB or Cinemeta responses (Cinemeta is blocked from this build environment), the first-load cost of matching TMDB rows to IMDb IDs on a real key, a real Trakt account's suggestions, Windows.

## 0.24.1 — Discover without a sideways scrollbar, "عرض الكل" restored

The owner sent a screenshot of a window-wide horizontal scrollbar on the Discover page.

Reproduced on a build of the published 0.24.0, with Discover holding 18 types (AIOLists-style names such as "Top Fantasy/Sci-Fi Movies"):

- The page overflowed by 1083 px at 980×680, 639 px at 1440×960 and 85 px at 2000×1100. The overflowing elements were the type buttons in `.filter-tabs`, a single non-wrapping flex line.
- Pressing "عرض الكل" threw `liveRows is not defined` and rendered nothing. 0.22.0 had moved `liveRows` inside the `shownRows` memo, but the full-catalog grid still used it.

Fixed:

- The type tabs are a `ScrollRow` with arrows; buttons do not shrink and long names are ellipsized with a `title`.
- `.content` has `overflow-x: clip`.
- The grid uses `shownRows`.
- New `tests/undefined-names.test.mjs` parses every `src`, `core` and `electron` module with rolldown's parser, walks its scopes, and fails on any undeclared identifier. It fails on the old App.jsx (`liveRows`) and passes now.
- A global ESLint `no-undef` run over the same files found nothing else.

Executed:

- `npm test`: **385 passing, 0 failing** (382 + 2 in `tests/undefined-names.test.mjs` + 1 layout test in `tests/performance.test.mjs`).
- Same render after the fix: overflow 0 at all three sizes, "عرض الكل" showed 30 cards, and there were no page errors. The tab arrows sit centred on the buttons.

- The first release run of 0.24.1 failed on the Windows runner before packaging, so nothing was published. The new test built its root with `new URL("..", import.meta.url).pathname`, which reads `/D:/a/…` on Windows and joined into `D:\D:\a\riwaq\riwaq\src`. Pull-request CI runs on Linux and had passed. The test now uses `fileURLToPath`; `path.win32.join` of the runner's URL gives `D:\a\riwaq\riwaq\src`.

Not executed: Windows, the owner's actual addon set.

## 0.24.0 — the artwork glow follows the pointer

The owner noticed that the artwork glow was tied to the hero's title. They asked for it to follow the title under the mouse, with settings to customise it.

Executed:

- `npm test`: **382 passing, 0 failing** (378 + 4 in `tests/ambient.test.mjs`). They cover:
  - defaults (follow the pointer, return on leave) and field-by-field validation of all seven settings;
  - every blur choice covering the window (size × scale ≥ 120);
  - card art: backdrop first, metahub's backdrop for an IMDb ID without one, HTTP and credential-bearing addresses refused, and data attributes read safely;
  - layer styles carrying their own picture, strength and fade, with no `ambient` variable among the root's theme variables.
- `npm run check` and `npm run build` pass.
- Rendered in Chromium with a mocked bridge at 1440×960: three cards with distinct blue, red and green artwork, a 250 ms delay and no fade. The blue title was on the hero.
  - Follow the pointer, return on leave: 100 ms on the red card kept blue. At 550 ms it was red, then green on the green card, then back to blue (the hero) 900 ms after the pointer left.
  - Stay, with posters: the red poster, then the green poster, and still the green poster after leaving.
  - Hero only: blue throughout.
  - Two layers, no page errors.

Not executed: Windows, a real GPU's cost for the crossfade, real artwork.

## 0.23.0 — sources in a window

Before merging 0.22.1, the owner asked that pressing Play show the sources in a popup window. 0.23.0 carries that and the 0.22.1 resolution fix below.

- `sourcesPopup` (default on) makes Play open the sources section inside a `Modal`.
- The heading (with the quality filter and refresh) is sticky while the list scrolls, and the close button stays visible.
- A started stream closes the window, and so do Escape and the close button; the title page stays.
- "اعرض المصادر" reopens the window without a new stream request.
- With `sourcesOnOpen`, or with `sourcesPopup` off, the sources stay on the page as in 0.17.

Executed:

- `npm test`: **378 passing, 0 failing** (377 + 1 in `tests/performance.test.mjs`). The order test in `tests/credits-more.test.mjs` now checks where the sources section is placed instead of where its markup is written. The new test covers the setting's default and validation, that `sourcesOnOpen` keeps the page layout, and that a started stream closes the window.
- Rendered in Chromium with a mocked bridge at 980×680 and 1440×960, with 12 mocked sources, including the two from the owner's screenshot:
  - before Play there is no dialog, and the hint says sources open in a window;
  - after Play, 12 sources are in the dialog and none are on the page, with the HiDt release shown as 1080p and the FraMeSToR remux as 4K;
  - after the list scrolled 600 px, the close button stayed inside the dialog and the heading stayed 27 px from its top;
  - Escape closed only the dialog, "اعرض المصادر" reopened it, and pressing a source's play button sent `play` and closed it;
  - with `sourcesPopup` off, the 12 sources were on the page;
  - no page errors, no overflow.

Not executed: Windows, real addon responses, real playback after choosing a source.

## 0.22.1 — resolution from the stated line count

The owner sent a screenshot of two sources for The Fantastic Four: First Steps, both marked 4K. The addon labelled the first "HD" and the second "4K".

- The first stream's chips name the group HiDt, BluRay, x265, HDR10 and Dolby Vision at 12.29 GB. That matches HiDt's "1080p UHD BluRay … DV HDR10 x265" releases.
- `parseResolution` tested `2160|4k|uhd` before `1080`, so "UHD", which names the 4K disc the encode came from, made it 2160.
- It now takes a stated line count first, highest first: `4320`, `2160`, `1440`, `1080`, `720` with `p`/`i`, or bare when not followed by a size, rate, frame rate or decimal. Only then does it read words: `8K`, `4K`/`UHD`, `2K`, `FHD`, `HD`.
- The owner's imported NardBadges pack defines its 4K badge the same way (`2160|4k|uhd` without `1080|720`). Its picture replaces the built-in resolution chip, so the chip follows the corrected value.

Executed:

- `npm test`: **377 passing, 0 failing** (376 + 1 in `tests/stream-engine.test.mjs`). The new test covers:
  - the HiDt-style filename gives 1080, DV+HDR10, tier `1080p_HDR`;
  - a FraMeSToR 2160p UHD remux stays 2160;
  - "4K Remastered 1080p" gives 1080;
  - "UHD BluRay" alone gives 2160;
  - "4K … 720 MB" and "1080 kbps 4K" give 2160;
  - "1080i", "FHD" and "HD" give 1080, 1080 and 720.
- The existing remux, scoring and badge-pack tests still pass.

Not executed: the owner's actual addon response, Windows.

## 0.22.0 — lighter and faster

The owner said Riwaq felt heavy and slow. I measured a mocked home page in headless Chromium at 1440×960: 100 addon catalogs of 60 titles each, artwork ambience on, using `scratchpad/ui/perf.mjs`. These are renderer measurements without a GPU, and not Windows ones.

| | before | after |
|---|---|---|
| Home page fully loaded | 20.3 s (19.2 s of long tasks) | 3.6–4.0 s (2.7 s) |
| DOM elements / poster cards | 127,513 / 6,002 | 52,921 / 2,450 |
| 3 s of 30 Hz player updates: frame rate / long tasks | 4 fps / 63.2 s | 58–60 fps / 0 s |
| 10 hero turns, extra time | 16.9 s | 0.7–1.0 s (scripting 55–74 ms, style 65 ms, layout 52–64 ms in total) |

Causes found and fixed:

- **Player updates:** `electron/player.mjs` emitted the whole player state on every MPV `time-pos` change, which happens on every frame. Each emission re-rendered the whole app, including every mounted rail, and the HUD.
- **Rails:** every rail mounted 60 cards.
- **Re-renders:** nothing was memoized, and callbacks were new on every render.
- **The finished set:** its identity changed on every progress save, so every card re-rendered.
- **Rating badges:** each poster's badge carried a `backdrop-filter`.
- **Ambience:** the layer blurred a full-window image by 90 px, and its variable sat on the app root, so every hero turn restyled the whole document.

Executed:

- `npm test`: **376 passing, 0 failing** (372 + 4 in `tests/performance.test.mjs`). They cover:
  - sixty position updates in a burst produce one immediate and one coalesced emission with the latest position;
  - a pause change goes out at once and folds in a pending position;
  - a pending position is dropped when the viewing stops;
  - source checks that `Rail` and `Poster` are memoized, that rails start at 12 cards, that the glass rating has no backdrop filter, that rails keep `content-visibility`, and that the ambient variable is off the app root.
- `npm run check` and `npm run build` pass. The startup bundle went from 612 KB to 437 KB. Settings, add-ons, library, live TV and folder pages are separate chunks, and each opened without errors in Chromium.
- In Chromium:
  - a catalog rail grew to its 60 cards as its forward arrow was pressed;
  - the hover frame on an arched card is not clipped;
  - the 0.21 hero and logo render check and the 0.20 countdown render check still pass, with no page errors and no overflow.

Not executed: Windows, a real GPU, real MPV playback (the 4 Hz position updates in the HUD were not watched on a real film), and a real account with many add-ons.

## 0.21.0 — title logos, hero arrows, prayer popover

The owner asked why the hero typed a title's name instead of its logo (Arabic or original language), and why the hero had no arrows. They added that clicking the prayer chip was broken: its popover opened beneath the hero.

Executed:

- `npm test`: **372 passing, 0 failing** (367 + 5 in `tests/logos.test.mjs`). They cover:
  - Arabic-first and original-first ranking, with French and other languages left out;
  - only validated IMDb/TMDB IDs and languages enter requests;
  - fallback from TMDB to the addon logo, then metahub, with credential-bearing addon logos refused;
  - setting validation;
  - `Client.titleLogos` against a fake TMDB: one `find` and one `images` call per title and mode, nothing without a key, nothing in text mode.
- `npm run check` and `npm run build` pass.
- Rendered in Chromium with a mocked bridge at 980×680 and 1440×960, with four hero titles:
  - one has a mocked TMDB Arabic logo, one has no logo anywhere (metahub 404), one has only metahub's logo;
  - the hero showed the TMDB logo with the name as alt text, then the typed name, then the metahub logo;
  - the arrows went next and previous, and the left arrow key went next;
  - left untouched for 9.5 s it turned to the next title; hovered for 12 s it did not;
  - the prayer popover is the topmost element at its centre and bottom corner;
  - the title page showed the same logo;
  - no page errors, no horizontal overflow.
- Found by the render and fixed: the title page lacked the `TitleLogo` import, which blanked the app on opening a title.

Not executed: real TMDB logos, Windows.

## 0.20.0 — countdowns to upcoming titles

The owner shared a YouTube live countdown and, asked what it was (YouTube is blocked in this build environment), said it was the countdown to Avengers: Doomsday. Riwaq now counts down to any upcoming film or next episode, and can pin it to the home page.

Executed:

- `npm test`: **367 passing, 0 failing** (363 + 4 in `tests/countdown.test.mjs`). They cover:
  - local-midnight targets and the remaining days, hours, minutes and seconds;
  - a series' nearest numbered unaired episode;
  - TMDB's Saudi theatrical date chosen over digital;
  - pinned list validation and the limit of 12.
  - The home-section count test now expects 7 sections.
- `npm run check` and `npm run build` pass.
- Rendered in Chromium with a mocked bridge and a fixed clock (2026-10-01 15:20, Asia/Riyadh) at 980×680 and 1440×960, for a film released 2026-12-18 with a mocked Saudi cinema date of 2026-12-17:
  - the title page reads "السينما في السعودية بعد" with 76 days 08:39:56, then 08:39:53 three seconds later;
  - it lists both dates and hides "ends at";
  - pinning adds the home section right after the hero, and the home card ticks;
  - removing it clears both;
  - no page errors, no horizontal overflow.
- Found by the render and fixed: in the Riwaq identity a long Latin hero title was cut at the hero's fixed height. Titles now scale with the window and stay within two lines.

Not executed: real TMDB release dates, Windows.

## 0.19.0 — Riwaq's own identity, prayer times, episodes with stills

The owner said the interface felt like Harbor's and wanted something only Riwaq has. They also asked why episodes had no pictures or descriptions. The addon's episode `thumbnail` and `overview` were never shown.

Executed:

- `npm test`: **363 passing, 0 failing** (353 + 4 in `tests/season-details.test.mjs` + 6 in `tests/prayer.test.mjs`), all mocked or pure.
  - Prayer tests:
    - every listed city and season keeps the order Fajr < sunrise < Dhuhr < Asr < Maghrib < Isha, with Dhuhr between 11:15 and 12:50;
    - Makkah on the June solstice is within 3 minutes of remembered Umm al-Qura times (4:12, 12:22, 3:42, 7:05). These come from memory, not a fetched timetable;
    - Isha is Maghrib + 90, and 120 on a Ramadan day;
    - Hanafi Asr is later, MWL Isha is angle-based;
    - next prayer and prayers inside a span; clocks, runtimes and settings validation.
  - Season tests:
    - TMDB parsing, generic names dropped, English filling, addon-first merging;
    - the client caching both the TV ID and the season.
- `npm run check` and `npm run build` pass.
- Rendered in Chromium with a mocked bridge and a fixed clock (2026-10-01 15:20 in Jeddah) at 980×680 and 1440×960:
  - the root carries `identity-riwaq`, poster corners compute to the 50% 26% arch, and the heading font is Sakkal Majalla. This Linux build has no such font, so it fell back; on Windows it is present;
  - the prayer chip reads "العصر 3:37 م · بعد 17 د", and its card lists the six times with Asr marked;
  - a 2 h 46 m film reads "يخلص 6:06 م · يمر فيه أذان العصر (3:37 م)" (Maghrib at 6:11 is correctly not crossed);
  - episode cards show stills, Arabic titles and descriptions from the mocked TMDB season, a watched check, a progress bar, and blurred spoilers;
  - switching the city to Riyadh shows Dhuhr 11:43, and the auto-pause toggle saves;
  - switching identity to classic and back works;
  - no page errors, no horizontal overflow.
- Two defects caught by the render and fixed before this result:
  - the arch lost to `.app.cardstyle-* .poster-image`;
  - a relative heading size shrank hero titles.

Not executed:
- `checkPrayer` in main (a real viewing reaching an adhan).
- Real TMDB season requests.
- Windows rendering of Sakkal Majalla.
- Comparison against an official Umm al-Qura timetable file.

## 0.18.0 — arrows instead of horizontal scrollbars

The owner asked for the horizontal scrollbar to be replaced by arrows that reveal the cast and titles a row could not show.

Executed:

- `npm test`: **353 passing, 0 failing**. No logic changed in core.
- `npm run check` and `npm run build` pass.
- Rendered in Chromium with a mocked bridge at 980×680 and 1440×960:
  - A 40-title catalog row (previously cut to 14) showed only "التالي" at the start. One press moved it 619 px at 980 wide and 983 px at 1440. It then showed both arrows, and at the end only "السابق"; "السابق" moved it back.
  - 24 actors and 30 episodes on a title page each moved with their arrows.
  - No scrollbar remained: offsetHeight equalled clientHeight on every row.
  - The first render found the cast row stretched to its content inside the page grid (6740 px wide, nothing to scroll). `min-width: 0` on the wrapper and on the title page's children fixed it before this result.
  - No page errors, no horizontal overflow.

Not executed: Windows, a touch screen.

## 0.17.1 — update checks that survive GitHub's rate limit

The owner's installed 0.16.0 showed "لم يكتمل التحديث" with "المتاح 0.16.0" after 0.17.0 was published.

Diagnosis from the code (not a Windows log):
- The stored latest version stayed 0.16.0, so the release list request failed before the new list was stored.
- The generic message appears only for a non-Arabic error. That points to an HTTP status from the anonymous GitHub API: most likely its 60-per-hour limit, which carrier NAT shares, or a server error.

Executed:

- `npm test`: **353 passing, 0 failing** (347 + 6 new in `tests/update-fallback.test.mjs`, mocked). They cover:
  - the Atom feed read like the API list;
  - a 403 from the API falling back to the feed and still verifying the signed manifest;
  - a tampered manifest refused through the feed;
  - a release without a manifest left manual, and a beta never offered on the stable channel;
  - a specific reason and code when both routes fail, with a retry after 20 minutes but not after 10;
  - error descriptions that never carry addresses.
- Existing updater tests are unchanged and pass.
- `npm run check` and `npm run build` pass.

Not executed:
- The github.com feed was not fetched live: this build environment's proxy refuses github.com paths outside the session's API scope, so the parser was tested against a fixture in GitHub's documented feed shape.
- No Windows run.
- An installed 0.16.0 still checks with its old updater, so it needs the limit to reset or a manual download to reach this version.

## 0.17.0 — a page for every title, sources after Play, an artwork gallery

The owner asked for a standalone page per title with all its information and a gallery of backgrounds, posters, logos and fan art, and for sources to appear only after pressing Play.

Executed:

- `npm test`: **347 passing, 0 failing** (340 + 7 new in `tests/artwork.test.mjs`), all mocked. They cover:
  - TMDB image ordering and sizes, including whole SVG logos;
  - Fanart.tv tabs, previews, likes and the host filter;
  - the keyless addon and metahub images, merging and the browser-open host list;
  - the `sourcesOnOpen` setting;
  - the client gathering TMDB and Fanart.tv art with keys never in the result, then caching it;
  - missing keys named, and a Fanart.tv 404 not counted as a failure.
- The makers-above-sources check now matches the streams section by class alone.
- `npm run check` and `npm run build` pass.
- Rendered in Chromium with a mocked bridge at 980×680 and 1440×960, using generated images:
  - a poster opens a page, not a dialog, with the home view hidden;
  - no stream request is made until Play, then exactly one, and the sources appear;
  - "about" lists seven facts, and the gallery shows 7 backdrops, 9 posters (3 when filtered to Arabic), 2 logos and 4 fan art kinds;
  - the viewer moves with the arrow keys and sets a backdrop as the wallpaper;
  - Escape closes the viewer, then the page, and the home view returns at the same scroll position (300);
  - in a series, picking an episode requests nothing, and clicking it again shows its sources under "م1 · ح2";
  - the back button works;
  - no page errors, no horizontal overflow.

Not executed: live TMDB or Fanart.tv image requests with real keys; anything on Windows.

## 0.16.0 — badge packs from a link

The owner asked for links such as https://harbor.site/badges/harbor-light.json to be accepted. harbor.site is refused by this build environment's egress policy, so that file was not fetched here. Its format was read in Harbor's MIT source (`stream-badges.ts`, `packs-tab.tsx`: Harbor lists it as a Nuvio-format pack) and in Nuvio's `StreamBadgeRules.kt` (behaviour only).

Executed:

- `npm test`: **340 passing, 0 failing** (328 + 12 new in `tests/badge-packs.test.mjs`). They are mocked, and cover:
  - Nuvio and Harbor formats, name-to-chip mapping and art replacement rules;
  - pictures and styles carried into the picker;
  - Java pattern and ARGB colour normalization, and forgiving JSON;
  - a 300-badge pack capped at 250 rules, and the export round trip;
  - public-HTTPS link checks and the redirect rules;
  - the safe `(?:[^.]*\.)` run and the matching deadline.
- **Live, real pack:** NardBadges (106 badges, same Nuvio format, served from raw.githubusercontent.com) was fetched through the real `fetchPackText` in Node and imported whole:
  - 30 built-in pictures and 76 rules, none refused;
  - 300 realistic stream titles matched in about 335 ms, and the worst single rule on an adversarial 400-character title took about 40 ms.
- `npm run check` and `npm run build` pass.
- Rendered in Chromium with a mocked bridge at 980×680 and 1440×960, using the real NardBadges text as the fetched pack and generated PNGs as its pictures:
  - an http link is refused;
  - the preview lists 30 pictures and 76 rules, and installing adds them;
  - the rules page hides the 76 pack rules until asked;
  - the picker shows pictures for 4K, DV+HDR10, HEVC, REMUX and Atmos 7.1, plus rule pictures (Atmos+DV, REMUX 1, PRIME, WEB 1), with sizes and seeds left as text;
  - no page errors, no horizontal overflow.

Not executed: fetching harbor.site itself (blocked here, not by Riwaq); anything on Windows.

## 0.15.0 — Harbor's settings pages

The owner shared three screenshots of Harbor's settings and asked for those features. Built in four commits: grouped settings with window, ambience, themes, logo and screensaver; stream filters, ordering, picker and badges; services, debrid, home servers and the torrent engine; AI search, spoiler protection, player layout, award icons and library filters.

Executed:

- `npm test`: **328 passing, 0 failing** (296 + 32 new), all mocked:
  - `tests/look.test.mjs` (5): appearance fields, saved themes, window settings and root classes.
  - `tests/stream-prefs.test.mjs` (7): filters, source mode with fallback, addon priority, pattern guard, rule badges and packs.
  - `tests/services.test.mjs` (9): debrid requests and account parsing for five services, watch providers and chosen services, home-server helpers, streaming-server values and profiles. Also, with a mocked `request`:
    - debrid keys kept out of `publicState` and checked without redirects;
    - a Jellyfin sign-in keeping only the token, with "your copy" first among streams, its token-bearing URL only in main, and disable/remove;
    - service rows reporting `needs: tmdb` without any request;
    - a streaming-server change verified by re-reading it.
  - `tests/wave4.test.mjs` (11): adult addons and titles, spoiler IDs, HUD presets and settings, the watched-mark class, award families and AI requests. Also:
    - defensive parsing of AI replies and name/year matching;
    - AI search through mocked TMDB, with the key never in `publicState`;
    - a rejected key reading as rejected;
    - a hide-adult profile skipping an adult addon and a flagged title, with turning it off gated by the Settings lock.
- `npm run check` and `npm run build` pass.
- Rendered in Chromium with a mocked bridge at 980×680 and 1440×960 (HUD at 980×552):
  - every new page opens in Harbor's order;
  - services: choosing two adds their home section and two home rows; a saved debrid key shows "ends soon · 5 days";
  - home servers: a wrong password adds nothing and clears the password field; a right one lists the server with its item count, and the toggle works;
  - P2P: the profile moves from balanced to fast and the cache to unlimited; the server page reports connected with its version;
  - details: episodes 3–5 blurred after episode 1 is finished and 2 is current; trophies read "2 الأوسكار", "1 غولدن غلوب", "+1 أخرى";
  - AI search: a saved key clears its field; the results page asks on demand and shows a suggestions row;
  - player layout: custom hides the chosen controls; the HUD shows 11 controls in full, 7 in minimal and 4 in cinema, and hides the title in cinema;
  - a finished film carries the watched mark; hide adult and the details background save;
  - window, filters, sorting, picker, badge rules and packs were rendered in the earlier commits.
  - No page errors, no horizontal overflow.

Not executed:

- Nothing ran on Windows: frames, drag-anywhere, taskbar icon or relaunch.
- No real debrid key, Jellyfin/Emby server, Stremio Service settings write, Groq or OpenRouter key, or live TMDB watch-provider list was used.
- No real adult-flagged addon was tried.

## 0.14.0 — the best of Harbor, Nuvio, Nuvio HTPC and Stremio Community

The owner asked for a comparison of the latest betas and the best shared feature plus the best of each. Sources were read at:

- Harbor `beta-branch` `ccd26f4` (0.9.128);
- NuvioMedia/NuvioDesktop `b1e0072` (0.1.26-alpha);
- UmbraProjects/NuvioDesktop `1389f50` (1.15.0 plus unreleased work);
- Zaarrg/stremio-community-v5 `3e96a6f` (5.0.0-beta.22).

All were read for behaviour only; see docs/REFERENCE-REVIEW.md.

Executed:

- `npm test`: **296 passing, 0 failing** (284 + 12 new, mocked):
  - `tests/trickplay.test.mjs` covers home-host detection, the three modes (torrents through the local server and live excluded), slices, safe MPV arguments and headers, the HUD method and setting, a fake-MPV grab returning a data URL with caching and temp-file cleanup, a newer request cancelling an older one, and three failures stopping previews.
  - `tests/best-of.test.mjs` covers the shuffle candidates (no specials, duplicates, future or watched episodes) and no repeats; finished films only for hide-watched, with search exempt; drop kinds with both windows routing navigation to the drop handler; and hold-speed validation with the swallowed click.
- **Real MPV frame grabs (Linux mpv 0.37 in the build container):** the actual `Thumbnailer` grabbed 320×180 JPEGs from a generated two-minute video in 80–115 ms each. Distinct frames came from 5 s, 61 s and 110 s, both from the local file and over HTTP with Range requests. Against an unreachable host it failed three times, then stopped.
- `npm run check` and `npm run build` pass.
- Rendered in Chromium with a mocked bridge at 980×552/1440×810 (HUD) and 980×680/1440×960 (main):
  - no thumbnail while the pointer moves; one request and a preview after it rests, clamped inside the window at the edge;
  - holding the picture shows "2×" and sends speed 2, then 1 on release, with no pause; a short click still pauses;
  - with hide-watched on, a finished film is gone from home while an unfinished one stays;
  - the random episode picks an unwatched episode, switches the season, announces it and scrolls it into view.
  - No page errors, no horizontal overflow.

Not executed: previews through Windows mpv.exe, against real debrid, NAS or torrent streams; drag and drop on Windows; any of this in a Windows session.

## 0.13.0 — a page of its own for every folder

The owner confirmed the U.N.E folders now work, and asked for a standalone page when a folder is opened from the home page.

Executed:

- `npm test`: **284 passing, 0 failing** (279 + 5 new in `tests/folder-view.test.mjs`), mocked:
  - round-robin "all" without repeats;
  - tab, type, Arabic-folded search and every sort;
  - further pages appended once, and a page adding nothing ends the source;
  - random pick bounds;
  - `collectionSource`: a catalog with `skip` offers more and one without does not; the custom type is encoded in the skip URL; TMDB discover stops at the last page; an unknown row key is refused.
- `npm run check` and `npm run build` pass.
- Rendered in Chromium with a mocked bridge at 980×680 and 1440×960:
  - a pinned U.N.E-style collection on home, whose folder tile opens the folder page;
  - the tabs, where a series tab plus two "load more" presses end the button;
  - the type filter, search and an empty-search state, "newest" sort and the rows layout;
  - sibling folder switching, which returns to the top;
  - the random pick opening details;
  - "back" returning home, and the page opened from the collection view with "back" returning there.
  - Zero page errors, zero horizontal overflow.

Not executed: live addon, TMDB or Trakt paging; Windows.

## 0.12.4 — parity with Nuvio's collection sources

**Root cause found from the owner's shape-only diagnostic report.** In U.N.E, every addon source's `type` is a catalog name, such as "Trending Movies on Trakt", "IMDb's Top Drama Movies" or "Top Fantasy/Sci-Fi Movies". List addons such as AIOLists give each catalog its own custom type. Riwaq's `TYPE` pattern refused spaces, apostrophes and slashes, and capped the length at 40. As a result, nearly every source in every U.N.E folder was dropped into `unsupported`, and folders came across empty. A type is now any printable text up to 200 characters, and it is URL-encoded in the catalog request (a test checks `Top%20Fantasy%2FSci-Fi%20Movies`). Imported IDs are now stable (`nuvio-` plus Nuvio's ID with unsafe characters removed), so importing again replaces the earlier copy instead of duplicating it.

Further differences, found by comparing against Nuvio's model:

The owner uses the community collection U.N.E ("Ultimate Nuvio Experience"). nuvio.tv is blocked by this build environment's network policy, so the page was not read. Riwaq's importer was also compared against Nuvio's own collection model and TMDB resolver (GPL-3.0, read for behaviour only, nothing copied). Those differences, fixed:

- **Exclusion filters were dropped.** `withoutGenres`, `withoutKeywords`, `withoutCompanies` and `withoutWatchProviders` were dropped, so a discover folder fell back to generic popular titles. They are now sent as `without_*`.
- **The provider filter was ignored without a region.** A watch-provider filter with no `watchRegion` was ignored. Like Nuvio, Riwaq now assumes `US` and sends the monetization types.
- **Language and country were too strict.** Several original languages or origin countries, spaces, or unusual letter case were refused. They are now normalized and accepted.
- **Folders with an empty title were discarded.** Nuvio allows such a folder, with its name hidden behind a cover. It now takes the first source's title, or a numbered name. A missing cover falls back to `heroBackdropUrl` or `focusGifUrl`.
- **Limits were lower than community collections need.** They rise to 60 collections, 100 folders and 40 sources per kind.
- **The pasted JSON had to be a list.** A single collection, or `{collections: [...]}`, is now accepted as well.

Executed:

- `npm test`: **279 passing, 0 failing** (276 + 3 new), mocked:
  - U.N.E-shaped custom catalog types kept, resolved and encoded;
  - the Nuvio discover filters reach the TMDB query;
  - a nameless folder is kept with a cover fallback;
  - a single pasted collection is accepted;
  - 70 folders survive import.
- `npm run check` and `npm run build` pass.

Not executed:

- the U.N.E collection itself: only its shape report was seen, and the page host is blocked;
- live TMDB, Trakt or addon requests;
- Windows.

## 0.12.3 — Nuvio folders still empty for the owner

On 0.12.2, after re-running the Nuvio link, the owner still saw folders with only «المجلد فارغ» and no source rows. That means those folders arrived with zero sources Riwaq could read. The owner's data was not available, so this release widens what is accepted and adds a way to see the exact shape:

- Addon IDs and types were checked against strict patterns, which silently dropped sources. They are now refused only for whitespace, quotes or angle brackets. A source without a type matches its catalog by ID alone. A source that still fails is kept by name in `unsupported` instead of vanishing.
- `nuvioScan` reads every known Nuvio folder and picks the one written most recently, instead of the first one found.
- The preview lists every folder with its readable and unsupported source counts before import.
- A «نسخ تقرير التشخيص» button copies a shape-only report: store names, field names, provider and kind tags, and folder names. It carries no URLs, addon IDs or keys. It is gated by the Settings room lock and needs the current scan token.
- An imported folder with no sources says so and points to the report.

Executed:

- `npm test`: **276 passing, 0 failing**:
  - the preview's `folderList`;
  - a diagnostics report that contains no addon URL or key;
  - a typeless addon source kept.
- `npm run check` and `npm run build` pass.
- Rendered in Chromium with mocked bridge data: the Nuvio dialog shows the per-folder list with no errors or overflow.

Not executed: the owner's actual Nuvio data; the clipboard copy on Windows; Windows.


## 0.12.2 — some folders were still empty

The owner reported that some Nuvio folders were still empty after 0.12.1. No screenshot was available, so every silent path to an empty folder was closed and made to explain itself:

- Rows with no titles rendered as nothing.
- Unknown Nuvio source providers were dropped.
- TMDB titles without an IMDb ID vanished.
- A folder with many TMDB sources could exceed TMDB's rate limit, since every external-ID lookup ran unthrottled, which lost titles quietly.

Executed:

- `npm test`: **275 passing, 0 failing** (271 + 4 new):
  - one row per source with its note: working, empty, failed, needs a search, addon missing, needs a TMDB key, needs a Trakt client ID, unsupported Nuvio source;
  - TMDB titles without IMDb hidden and counted, or shown as `tmdb:ID` through an addon that accepts that prefix, with TMDB posters;
  - TMDB calls never more than four in flight, with one retry;
  - an unknown Nuvio provider kept by name.
- `npm run check` and `npm run build` pass.
- Rendered in Chromium at 980×680 and 1440×960: a folder with a working row, a TMDB source needing a key, an unsupported Nuvio source and a failed source shows each reason and a retry button. Every earlier scenario still passes. Zero page errors, zero overflow.

Not executed: live TMDB, Trakt or addon requests; the owner's actual Nuvio data; Windows.

## 0.12.1 — Nuvio folders were empty

The owner reported that folders came across from Nuvio but showed empty. The cause was Riwaq's own import: it kept only addon-catalog sources and counted TMDB and Trakt sources as skipped. Nuvio builds most folders from TMDB collections, studios, networks, discover queries and people, or from Trakt public lists.

Executed:

- `npm test`: **271 passing, 0 failing**. Five new tests, and the Nuvio tests updated now that those sources carry over:
  - TMDB requests for every Nuvio source kind, including the TV date sort, discover filters and no people filter on TV;
  - result parsing: a film collection in release order, a director's directing credits only, mixed lists, network kind;
  - Trakt public list requests and IMDb-carrying metas;
  - pasted TMDB and Trakt addresses; add, duplicate and remove source edits; a discover source without filters;
  - `Client.collectionFolder`:
    - reports `needs` without sending anything when no key exists;
    - reads TMDB with the key and matches IMDb IDs, dropping an unmatched title;
    - caches matches;
    - sends Trakt with the client ID and `redirect: "error"`;
  - the Nuvio TMDB key: the preview says only that a key exists, the key goes to the encrypted provider store, and it never reaches the interface state;
  - a Nuvio round trip keeping TMDB and Trakt sources.
- `npm run check` and `npm run build` pass.
- Rendered in Chromium at 980×680 and 1440×960, with the real core logic behind the stub bridge:
  - an imported Nuvio folder with a TMDB source shows the "needs a TMDB key" message and its settings button;
  - the folder editor lists the TMDB source, adds a network preset and a pasted Trakt list;
  - every 0.12.0 scenario still passes.

  There were zero page errors and zero overflow. The render also caught a second gap before release: a Nuvio discover source without filters was refused. It is now accepted as TMDB's popular titles.

Not executed:

- No live TMDB or Trakt request, since the environment's proxy refuses them. The endpoints follow TMDB's and Trakt's public APIs and Nuvio's resolvers, and are verified against fixtures only.
- No real Nuvio data and no Windows run.

## 0.12.0 — collections, Nuvio linking, home editor

The owner asked for the largest interface and settings update yet, including Nuvio-style collections and linking with Nuvio so collections, addons and plugins move over. Nuvio HTPC (GPL-3.0) was studied at `b775bf5` for behaviour and file formats only (see docs/REFERENCE-REVIEW.md).

Executed:

- `npm test`: **266 passing, 0 failing** (253 + 13 new).
  - Collections:
    - field-by-field validation: IDs, HTTPS-only covers without credentials, shapes, views, deduplicated catalogs and titles, and limits;
    - every edit action, including hand-picked order and an empty rename keeping the name;
    - catalog resolution by manifest ID, falling back to a forked addon;
    - available catalogs, with no search-only catalogs and no addon URLs;
    - Nuvio JSON in both directions: TMDB/Trakt sources counted, legacy `catalogSources`, round trip;
    - a re-import updating by ID;
    - per-profile storage;
    - backups carrying collections and re-validating them on restore;
    - home arrangement, and the settings validation for it;
    - the new actions staying off the HUD bridge.
  - Nuvio:
    - `.properties` text written like `java.util.Properties.store` (escapes and `\uXXXX` surrogate pairs for Arabic and emoji) parsing back exactly, plus continuations and escaped keys;
    - profile discovery and preview counts;
    - addon URLs deduplicated, completed with `/manifest.json` and refused when not HTTP(S), keeping their enabled state;
    - plugin repositories kept without their scraper code;
    - the backup zip reader (deflated and stored entries) opening only the known stores and never an auth store;
    - Windows folder candidates;
    - an import through `Client.importNuvio`: addons installed via the manifest check, with a failing addon reported, Nuvio's disabled state kept, library and collections merged, and plugin repository URLs kept out of `publicState`.
  - The run caught three defects before release, all fixed:
    - an empty rename threw instead of keeping the name;
    - two test fixture mistakes.
- `npm run check` and `npm run build` pass.
- Rendered in headless Chromium at 980×680 and 1440×960. The stub bridge ran the real `editCollections`, `availableCatalogs`, `fromNuvio`, `mergeCollections`, `nuvioPreview`, `nuvioProfile` and `safeSettings` in Node. Covered:
  - a collection created from a template;
  - a catalog with a genre added and a folder added;
  - two titles added from Details through "أضف لمجموعة" and reordered;
  - the Nuvio dialog: scan, profile and parts preview with Arabic counts, import, result;
  - pinned collections on home;
  - the home editor moving pinned collections to the top and hiding a catalog, with home following that order;
  - the Nuvio plugin list on the Addons page.

  There were zero page errors and zero horizontal overflow. Rendering caught a real defect: after switching folders in edit mode, the previous folder's editor stayed on screen, because two siblings shared a React key. It was fixed.

Not executed:

- **No real Nuvio installation, backup or export was read.** The formats come from Nuvio's open source; the fixtures are built to match it.
- Nuvio's servers are not contacted and no Nuvio account is used. Plugins are listed, never run.
- Nothing in 0.12.0 has run on Windows: real file dialogs, clipboard, the `%LOCALAPPDATA%`/`%APPDATA%` scan, and live addon catalogs inside folders.

## 0.11.0 — makers above sources, series rows, people search, trailers

The owner confirmed on Windows that 0.10's pointer hiding and credits page work, and asked for the makers above the sources and for more development.

Executed:

- `npm test`: **253 passing, 0 failing** (244 + 9 new):
  - series rows in part order with the current title marked, keeping the earliest year and preferring the most specific series; rows without the title, single-title series and unresolved labels dropped;
  - series queries excluding episodes and seasons;
  - search phrases cut to one line of at most 80 characters;
  - people search in Arabic and English merged in search order, only validated QIDs reaching the VALUES query, only people with an IMDb name ID, one-letter searches sending nothing, caching, and an error only when both searches fail;
  - series rows joining a title's credits;
  - trailer IDs read from the metadata's `trailerStreams` and `trailers`, junk refused, and main reading its own cached metadata before opening a fixed youtube.com watch page;
  - the new actions staying off the HUD bridge;
  - the makers and series rows placed above the sources in Details.
- `npm run check` and `npm run build` pass.
- Rendered in headless Chromium at 980×680 and 1440×960 with a stubbed bridge. Checked:
  - the Details order: cast, makers, series row, sources;
  - the trailer button calling `openTrailer` with the title's type and ID;
  - a series row with numbered parts and the current one marked; another part opening its own Details with `flexible` metadata;
  - a search showing a people row above the catalog results; a person opening the explore dialog, and one of their works opening Details.

  There were zero page errors and zero horizontal overflow.

Native Windows verification of 0.10 by the owner (reported, not re-run here): the pointer hides over the picture, and the credits page shows cast, makers and filming locations.

Not executed:

- No live Wikidata, TMDB or YouTube request from this environment; the egress proxy refuses them. `wbsearchentities` and the P179 query are verified against fixtures only.
- Nothing in 0.11.0 has run on Windows.

## 0.10.0 — credits and the pointer, again

The owner reported that the pointer still did not hide in 0.9 (HUD clicks worked, so the HUD was on screen), and asked for a title page with cast, directors, production companies and filming locations that open to each one's details and other works.

The pointer: CSS `cursor: none` in the HUD did not hide it on Windows. The HUD window is non-focusable, and Windows applies a new cursor on the next mouse message, which is the very movement that should wake the controls. 0.10 hides it from main with Win32 `ShowCursor` on the Electron UI thread that owns the main window and the HUD (`core/cursor.mjs`).

Executed:

- `npm test`: **244 passing, 0 failing** (228 + 16 new).
  - Pointer: hides only when still for 2.5 s over the picture; the HUD's asleep state decides with the HUD on, focus and pause without it; never for the mini player, a minimised window or outside the picture; the Win32 display counter stays balanced across repeated calls and failures; closing the HUD, the HUD closing and quitting all give the pointer back.
  - Credits: parsers for fixture SPARQL replies shaped like query.wikidata.org's (crew by role, one entry per person and role, unresolved labels dropped, companies and distributors, filming locations with coordinates, settings, countries, awards, cast in billing order, entity facts, works newest first with series detected and non-title IDs dropped); injection-shaped IMDb, QID and TMDB IDs refused before any request; image URLs limited to their hosts; map tiles and pin, including the antimeridian; TMDB covering a Wikidata outage, filling a short cast and matching Arabic Wikidata names to TMDB by TMDB ID; a TMDB-only person opened through Wikidata or TMDB alone with works resolved to IMDb IDs; an hour's cache; SPARQL requests carrying a User-Agent and refusing redirects; credits kept off the HUD bridge; a work opened from credits trying the other film/series kind once.
- `npm run check` and `npm run build` pass.
- Rendered the Details page in headless Chromium at 980×680 and 1440×960 with a stubbed bridge whose credits came from the real parsers over fixture SPARQL: a cast rail of eight, six crew roles, companies, four filming locations, setting, countries and awards; a person opening with birth date and place, occupations, citizenship, awards and twelve works; Escape closing only the explore dialog; a place opening with a four-tile map; a work opening its own Details; a credits failure shown as one line without disturbing the page. Zero page errors and zero horizontal overflow. Rendering caught a nested-dialog padding defect before release.

Not executed:

- **No live Wikidata or TMDB request was made**: this build environment's egress proxy refuses query.wikidata.org and www.wikidata.org (CONNECT 403), and TMDB too. The SPARQL queries are unverified against the live service; the parsers were verified only against fixtures shaped like its replies. Images (Commons, TMDB, metahub, OpenStreetMap) did not load in the render; initials and poster placeholders showed.
- Nothing in 0.10.0 has run on Windows. `ShowCursor` hiding the pointer over the HUD and over the bare MPV surface is unverified natively.

## 0.9.0 — controls over the picture

The owner reported that the pointer still did not hide in 0.7 and asked for a player like Harbor's and Nuvio's. Studying both showed the cause: they draw their controls in a transparent web layer over MPV, so their own page owns the pointer. Riwaq's MPV surface sits above the page, so the pointer over the picture belonged to MPV, and MPV did not honour `cursor-autohide` inside the embedded surface. 0.8 adds a transparent HUD window over the surface.

Executed:

- `npm test`: **228 passing, 0 failing** after merging 0.8 (222 + 6 new): the HUD rectangle in screen DIPs including page zoom and clipping, when the HUD shows (never for the mini player, a hidden surface or a minimised window), the HUD bridge being a subset of the preload allowlist that excludes backups, logins, installs, live sources, updates and profile switching, failover choosing the next ranked playable source and giving up after three failures, the new settings, and MPV's controller staying hidden while the HUD draws controls.
- `npm run check` and `npm run build` pass.
- Rendered the HUD page in headless Chromium at 980×552 and 1440×810 with a stubbed bridge: controls visible on movement and hidden with `cursor: none` after 3 s still; a click pausing, a double click toggling full screen without also pausing, the wheel raising volume, a right click opening the panel; the sources room listing ranked sources with the unsupported one disabled and switching to another; the episodes room jumping to an episode; the next-episode card appearing in the last 45 s with the skip button raised above it. Zero page errors.

Not executed:

- Nothing in 0.9.0 has run on Windows. Unverified natively and the main risk of this release: a transparent owned BrowserWindow compositing over the MPV child surface, its placement through moves, resizes, zoom and full screen, non-focusable clicks, media keys, and failover against real failing streams. The setting **أدوات التحكم فوق الصورة** turns the HUD off and restores the 0.7 player.

## 0.8.0 — signed in-app Windows updates

Executed on Windows x64 with Node.js 24 and Electron 44.4.1:

- **222 Node tests pass**, including 18 new update tests: pinned signatures, metadata identity, download bounds and hashes, cache tampering, downgrade prevention, stable/beta selection, cancellation/retry, opt-outs, portable restrictions, shutdown deferral, Settings protection and installer launch failure.
- Formatting and production Vite build pass.
- **13 Windows source smoke groups pass**, with no uncaught renderer errors. Includes live Cinemeta (84 posters), library/queue, settings, native MPV playback/pause/seek/Arabic subtitles, encrypted progress/resume, real EOF queue advancement, profile isolation, IPTV/EPG fixtures, PIN gates and native video geometry.
- The new Arabic update room runs through real Electron IPC with a signed fixture: check, download, hash verification, ready state, progress and preferences. Screenshots at 1440×960 and 980×680 were inspected. The fixture version is not a published production release, and its installer hook cannot execute.
- **A real isolated NSIS upgrade passed**, from `0.8.0-test.0` to `0.8.0-test.1`: the production updater downloaded and verified the fixture installer, NSIS replaced the running application, the new version relaunched, and DPAPI-encrypted library/settings/progress survived. The test uses a unique product/app ID, workspace installation and separate data directory, then uninstalls the fixture. It does not replace the user's Riwaq.
- The final **0.8.0 packaged portable passed** launch/version, live catalogs, a clean isolated profile, DPAPI encryption, bundled Koffi/MPV, actual video decoding, native visibility/clipping and queue consumption. The final NSIS installer and portable were built on Windows in `release-final` (an earlier output directory could not be overwritten under the sandbox). Local release metadata was signed with the matching key.

Final local artifacts: installer **149,737,676 bytes**, SHA-256 `a0fc6243f3aef32bbfc49e9ccc497c440de02eafe41e29c66a8bf189fcb09803`; portable **149,531,588 bytes**, SHA-256 `0b0cd169ae3c775e64768cae43e517bc4aa1b002a9458cba26ca0104283738a9`. CI rebuilds have their own checksums. These executables have no Authenticode publisher signature.

Production rollout still requires the matching `RIWAQ_UPDATE_PRIVATE_KEY` Actions secret and a published signed release. Ed25519 authenticates update packages; Windows Authenticode is not configured. Real third-party account flows and hardware combinations listed below remain unverified. Earlier entries are historical reports; the Windows smoke above supersedes their shared smoke paths, not every untested feature they list.

See [UPDATES.md](docs/UPDATES.md) for the update trust model, release process and repeatable NSIS test.

## 0.7.0 — appearance studio and the pointer

The owner reported that the pointer stayed visible during playback, and asked for settings as rich as Nuvio HTPC's and Harbor's latest beta so each viewer can make Riwaq their own.

Executed:

- `npm test`: **204 passing, 0 failing** (195 + 9 new): every preset keeping body text at 7:1 or better and secondary text at 4.5:1; field-by-field validation including a font name that tries to carry CSS; presets as fresh palettes and older accent choices carrying over; variables and classes; root classes never reusing an element class; the scale floor at 980×680; share codes carrying appearance only, refusing junk and keeping Arabic; the settings; main hiding the pointer only on change and only during a viewing.
- `npm run check` and `npm run build` pass.
- Rendered in headless Chromium at 980×680 and 1440×960: ten presets, choosing the royal green preset recolouring the whole app, radius, density, hover and font changes reaching the root, a custom accent turning the design custom, undo, a share code copied and applied back, a junk code refused, and a hidden navigation item. Zero page errors and zero horizontal overflow. Rendering caught a real defect before release: the details background class `detail-backdrop` on the app root collided with the element of that name and turned the whole app translucent and unclickable; the classes were renamed and a test now guards against it.

Not executed:

- Nothing in 0.7.0 has run on Windows. Unverified natively: MPV honouring `cursor-autohide=always` inside the embedded surface (the fix relies on it), the interface zoom from main, the clipboard write, and fonts that are not installed falling back to Segoe UI.

## 0.6.0 — subtitles and audio

The owner reported, with screenshots, that choosing subtitles was far harder than in Harbor, Stremio or Nuvio: the list covered the whole picture, and every row read only "· ara". The renderer showed a `provider` field the main process never sent, and the button background was the invalid colour `#fff05`. The owner asked for Nuvio HTPC's behaviour (UmbraProjects/NuvioDesktop); it is GPL-3.0, so it was studied for behaviour and nothing was copied (see docs/REFERENCE-REVIEW.md).

Executed:

- `npm test`: **195 passing, 0 failing** (180 + 15 new): language tags to one code and Arabic name; forced and SDH detection; ranking by language then kind without ever changing language for the kind; language groups; automatic addon subtitles only in the first language and only when the file has none; SRT and WebVTT cue parsing; cues around now with the current delay; the quick-sync delay including reaction time and clamping; style validation into MPV properties and options; the new settings; MPV starting with the saved style; addon subtitles labelled, deduplicated, cached and never carrying URLs to the interface; tracks reporting an addon subtitle only by key; loading once and reselecting as main or second line; live style changes; the panel opening from MPV by C or right click; audio labels.
- `npm run check` and `npm run build` pass.
- Rendered in headless Chromium at 980×680 and 1440×960 with realistic tracks and six addon subtitles: the panel opens beside the picture (surface 932×486 → 526×486 and 1392×766 → 958×766, still visible), Arabic is the starting filter with its four entries first, labels show release names with provider and format, SDH and forced are marked, the sync room turns a picked cue into a 1.7 s delay, the style room applies and saves colours, the audio room reads "الإنجليزية · Dolby Atmos · EAC3 · 7.1", and in full screen the picture shares the window with the panel. Zero page errors and zero horizontal overflow. Rendering caught a leftover 0.2 `.player-dock` rule that broke the layout and a language filter that started before addons answered; both fixed.

Not executed:

- Nothing in 0.6.0 has run on Windows. Unverified natively: `sub-add` with title and language, secondary subtitles, the right-click binding reaching Riwaq while MPV's controller is visible, `sub-border-style` on the pinned MPV build, and automatic subtitles against real addons.

## 0.5.1 — the first real Windows feedback

The owner ran v0.5.0 on a Windows desktop and reported two problems with screenshots: the home screen took a very long time to show anything with 49 addons installed, and playback never filled the screen, the picture sitting small inside a frame.

Causes found in the code:

- Catalogs were requested in lockstep batches of eight, each batch waiting for its slowest addon (up to a 16-second timeout), and the interface rendered nothing until every catalog had answered.
- The player always kept a 78 px header, a 116 px control bar and 24 px side padding around the video, because HTML cannot paint over the native surface; entering full screen did not change that layout.
- The surface's scale is taken from the window's client area when React reports, and during a full screen transition that area keeps changing afterwards.

The screenshot also shows the picture about 12% smaller than its frame and centred, which none of the causes above fully explains. It is not confirmed whether 0.5.1 removes that part; see below.

Executed:

- `npm test`: **180 passing, 0 failing** (169 + 11 new): one slow addon no longer holding up the catalogs behind it (this test fails on 0.5.0: it waits forever for the batch), bounded pooled concurrency with a 10-second catalog timeout, a plan made of opaque keys with no addon URL or secret in it, a failing addon remembered for two minutes, the two new settings and their validation, MPV starting with its controller hidden and the chosen fill mode, the controller shown in full screen and never in the mini player, Escape leaving full screen before closing, live fill toggling, and the Escape binding.
- `npm run check` and `npm run build` pass.
- Rendered in headless Chromium at 980×680 and 1440×960 with a stubbed bridge: with 24 catalogs, one of which fails after 4 s, the first rows appear after about 0.4–0.5 s in plan order and the rest fill in, with the failure listed once; the normal player surface covers 68%/77% of the window, and in full screen it covers the whole window at 0,0 with the header and controls hidden; Escape sends `exitFullscreen`. Zero page errors and zero horizontal overflow.

Not executed:

- Nothing in 0.5.1 has run on Windows. Unverified natively: automatic full screen, MPV's on-screen controller appearing over the picture (it needs the Lua build of MPV, which the pinned build is expected to include), the Arabic hint text in MPV's OSD, the surface being placed again after the transition, and whether the picture now fills its frame.

## 0.5.0

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

## Remaining limits

No real third-party accounts/API keys, IPTV subscriptions, Discord client/webhooks or torrent media were used. Authenticated flows, notification delivery and parsing use test fixtures; no messages were sent to real recipients. HDR output, mixed-DPI/multi-monitor behavior, picture profiles on varied GPUs and unusual audio devices remain unverified. Windows Authenticode remains unconfigured; 0.8 adds separately authenticated automatic updates. Torrent playback still requires a separate Stremio Service.

Queue and manual history edits are local per-profile data. Manual completion does not write tracker history. GitHub CI results are reported separately from local checks.
