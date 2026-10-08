# Architecture

```
React (sandboxed, RTL)
  -> explicit preload IPC actions
  -> Electron main
       -> Client / addon HTTP protocol
       -> StreamEngine / parse, trust, score, rank
       -> DataHub / TMDB, OMDb, MDBList, Fanart
       -> Credits / Wikidata cast, crew, companies, filming locations, other works (+ TMDB)
       -> Integrations / Trakt history queue and scrobbling, Simkl, Letterboxd bridge + CSV
       -> LiveHub / M3U, Xtream, XMLTV, catchup
       -> Profiles / per-viewer data and the parental PIN
       -> Notifier / Discord and Telegram webhooks
       -> Backup / passphrase-sealed .riwaq export and validated restore
       -> Episodes / up next and the calendar from addon episode lists
       -> Updates / signed package download, cached verification and per-user NSIS install
       -> DiscordPresence / local IPC socket
       -> DPAPI encrypted profile.bin
       -> Player / MPV process, private named pipe, generated input.conf
            -> Win32 child video surface inside the Electron window
```

## Files

- Unreleased after 0.34: `electron/music-library.mjs` holds the native-dialog-selected local music catalog under `state.localMusic[profileId]` in encrypted state, outside public/profile settings and portable backups. Four main-window-only `musicLocal*` IPC methods require the active profile and library PIN. Only file IDs and labels are public; a source request grants an opaque `riwaq-audio://track/<token>` capability. `protocol.handle` serves bounded byte-range file streams after rechecking ownership. No renderer-supplied path or network URL is accepted. Profile changes, lock, backup restore and video start revoke capabilities and stop the renderer audio.
- `core/music-player.mjs` owns transport sequencing, seek, volume, repeat and shuffle history. Injected element/source callbacks allow deterministic race tests. `src/lib/local-music.jsx` keeps one transport mounted across navigation, checks Spotify before starts/resumes, and binds Media Session actions while local music owns playback. `LocalMusic.jsx` supplies library and mini-player UI, with `local-music.css`. Local playlists/queue persist, playback does not auto-resume after relaunch. Spotify auth requests now check their originating account epoch before applying asynchronous responses.

- 0.27: `core/session.mjs` is a browser-safe session planner. It samples up to 18 saved, unfinished and interleaved loaded catalog titles; `prepareSession` permits three existing `metadata` IPC reads at once and stops scheduling when its generation expires. Candidates require a known runtime or measured playback duration; series select a released, unwatched episode and mark series-average runtimes as estimates. `planSession` fits up to three different titles and five-minute intervals into the viewer's time budget, filters by mood and explains each choice. No new service, model key or IPC action is introduced.
- Unreleased after 0.30.1: `core/taste.mjs` provides a browser-safe, explainable taste ranker. `cleanTaste` validates per-profile genres, exploration mode and up to 300 title feedback records; `tasteCandidates` interleaves at most 600 unique loaded catalog titles. Recommendations filter hidden titles, liked seeds, completed movies and future releases, and require a known runtime when filtering by duration. `tasteEdit` is a main-window-only IPC action, requires the active `profileId` and passes the library PIN gate. Preferences persist through the existing encrypted profile and validated backup paths. No taste data is sent to a recommendation service.
- `src/components/TasteDiscovery.jsx` supplies the taste panel on home and Discover and shared title feedback in `Details.jsx`; `src/taste.css` contains its responsive styles. The new `taste` home section uses the existing visibility/order migration. `SessionHome.jsx` removes hidden titles before its bounded metadata sample, prioritizes declared genre affinity and invalidates in-flight plans on taste changes; the planner retains its duration and interval constraints. Hiding a recommendation does not remove a title from search or the library.
- `src/components/SessionHome.jsx` owns the transient plan and mounts only after startup is ready, keyed by active profile. `sessionBudget`, `sessionMood` and `interfaceStyle` are validated per-profile settings. Adding a plan uses existing `queueEdit` calls with an optional `profileId`; core rejects a supplied owner that differs from the active profile before modifying the queue. `RiwaqNav.jsx` supplies the new masthead, `SettingsStudio.jsx` the category-card index, and `src/session.css` their responsive styles. `interfaceStyle: classic` retains the previous layouts. See [RIWAQ-SESSIONS.md](RIWAQ-SESSIONS.md).
- `core/protocol.mjs`: URL validation, configured-addon identity, resource applicability, catalog extras, settings whitelist.
- `core/stream-engine.mjs`: the four-stage source pipeline. `parseStream` reads the free text an addon supplies; `trustStream` rejects what cannot be the requested title; `scoreStream` returns points with a named reason for each; `analyzeStreams` ranks and groups into tiers. Arabic subtitle and Arabic dub are separate parsed fields, not one keyword bonus.
- `core/client.mjs`: addon requests and cache, Stremio import, favorites/progress, opaque stream/subtitle identifiers, hotkey storage.
- `core/spotify.mjs` (0.34): PKCE link with the viewer's Client ID, the token lifecycle, and Spotify Connect playback, devices, playlists and control (`SpotifyHub`). The loopback server lives in main. `core/theme-song.mjs` (0.34): iTunes/Deezer preview search, strict matching (`pickThemeSong`), and host allowlists; `src/lib/audio.js` plays them. Since 0.36 the official soundtrack album and composer come from Wikidata (`officialMusicQuery`, P406/P86) and TMDB crew, the album is tried first (`pickOfficialTrack`), and `themeSongTrust: official` accepts only the composer's tracks.
- `core/player-tuning.mjs` (0.37): MPV start-up options and live properties for the picture and sound (quality profiles, decoder, renderer, compatibility modes, display panel, RTX filters added at runtime, sound profiles, normalising, downmix, volume ceiling, output device) and the HUD's quality chips. `core/skip-online.mjs` (0.37): opt-in TheIntroDB segments for IMDb IDs (with an optional Bearer key from the encrypted provider store) and AniSkip segments for MAL/Kitsu episode IDs. `core/speed-test.mjs` (0.37): the Cloudflare download timing behind the speed cap, which `scoreStream` applies through `neededMbps`. Since 0.38 `core/player-tuning.mjs` also owns the HDR modes (SDR conversion, or MPV's own full-screen window), the network buffer (`bufferArgs`) and the source tags, and `electron/player.mjs` runs a stall watchdog and a two-stage compatibility restart. Since 0.38.2 `Player.start` spawns MPV idle (`deferLoad`), subscribes over IPC, starts the watchdog and only then sends `loadfile` (answer awaited up to `LOAD_REPLY_MS`); `stop()` cancels pending starts and retires the socket and its pending requests; the `repairVideo` player command (the dock's «إصلاح الصورة») steps the same compatibility restart by hand; and the diagnostic reports MPV's own child window beside Riwaq's surface. Since 0.38.3 `core/surface.mjs` (`surfaceRect`, `childFix`, `outputFits`, `SurfaceWatch`) backs `VideoHost.prepare`/`syncChild`: the hidden surface is sized before MPV starts, and Riwaq keeps MPV's child window at the surface's size itself rather than trusting MPV's cross-process resize hook.
- `core/music.mjs` (0.33): music platforms, link validation (`musicLink`), searches (`musicSearchUrl`), the soundtrack phrase, and per-profile `cleanMusic`. Main's `musicOpen` re-checks and opens externally. `core/title-theme.mjs` (0.33): artwork colour (`dominantColor`), genre colour, a readable accent, and page-scoped variables (`titleTheme`).
- `core/source-view.mjs` (0.32): `filterSources`, `SOURCE_CHIPS`, `chipCounts` and `addonSections` narrow and section the sources list in Details. View only; the ranked list is unchanged.
- `core/source-wait.mjs` (0.31): `gatherSources` asks every stream addon at once and resolves early (4 s with a stream in hand, or the first stream plus 1.2 s); late answers fill the run that `Client.getStreams` keeps per title for five minutes, main emits `sources` when they settle, and `streams({ again: true })` re-ranks that run without a request. TMDB rows name their genre IDs through `tmdbGenreNames` in `core/collection-sources.mjs`.
- `core/data-hub.mjs`: private API keys; optional detail enrichment; exact title/year matching for CSV.
- `core/credits.mjs` (0.10): Wikidata SPARQL queries and parsers for a title's cast, crew, companies, filming locations, settings, countries and awards, and for one person, company or place with its other works; TMDB merging and fallback; OpenStreetMap tile maths for a location map; from 0.11, series rows (P179), people search and the trailer ID. `src/components/Credits.jsx` draws the cast rail, the makers section and the explore dialog.
- `core/collections.mjs` (0.12): per-profile collections of folders (addon catalogs by manifest ID, TMDB sources, Trakt public lists and hand-picked titles), whole-list validation on every edit, catalog resolution, available catalogs without URLs, and the Nuvio JSON mapping both ways. `src/components/Collections.jsx` draws the room, a collection, the folder editor, pinned home rows, "add to collection" and the Nuvio link dialog. `src/components/FolderPage.jsx` (0.13) is a folder's own page, opened from home; `core/folder-view.mjs` decides what it shows, and `Client.collectionSource` reads a source's next page.
- 0.14: `core/trickplay.mjs` (seek preview policy, slices, MPV arguments) and `electron/thumbnails.mjs` (one silent MPV per frame, cache, cancellation); `core/shuffle.mjs` (random episode); `core/drop.mjs` (dropped file kinds, handled by `onDropNavigate` in main); `watchedTitles`/`withoutWatched` in `core/library.mjs`.
- 0.15: Harbor-style settings groups (`SettingsStudio.jsx` `GROUPS`, pages in `src/components/settings/`); `core/stream-prefs.mjs` and `core/badges.mjs` (filters, order, custom badges); `core/services.mjs`, `core/home-servers.mjs`, `core/streaming-server.mjs` and `core/services-hub.mjs` (streaming services, debrid health, Jellyfin/Emby copies, torrent engine settings); `core/ai-search.mjs` and `core/ai-hub.mjs` (AI search); `core/spoilers.mjs`, `core/hud-layout.mjs`, `core/awards.mjs`, `core/adult.mjs`; window chrome in `electron/main.mjs` and `src/components/WindowChrome.jsx`.
- 0.16: `core/badges.mjs` reads Riwaq, Harbor and Nuvio badge packs, maps built-in values to `badgeArt`, normalizes Java patterns and fetches pack links in main (`fetchPackText`, IPC `badgePackFetch`); `src/components/StreamBadge.jsx` draws picture and styled badges.
- 0.17: `Details.jsx` became a page inside the content area (`title-open` hides the view underneath; `openTitle`/`closeTitle` in `App.jsx` keep its scroll), with sources gated behind Play; `core/artwork.mjs` and `client.artwork` (IPC `artwork`, `openArtwork`) feed `src/components/ArtworkGallery.jsx`; styles in `src/title.css`.
- 0.18: `ScrollRow` in `src/components/UI.jsx` gives every horizontal row (rails, cast, people, series works, up next, folder tiles, episodes, folder and library tabs) arrows instead of a scrollbar.
- 0.19: `src/identity.css` (Riwaq identity), `core/prayer.mjs` with `src/components/Prayer.jsx` (chip, ends-at, settings) and `checkPrayer` in main, `core/season-details.mjs` with `client.seasonDetails` (IPC `seasonDetails`) for episode cards.
- 0.20: `core/countdown.mjs` with `src/components/Countdown.jsx` (title countdown, home rail) and `client.releaseDates` (IPC `releaseDates`).
- 0.21: `core/logos.mjs` with `client.titleLogos` (IPC `titleLogos`) and `src/components/TitleLogo.jsx` (logos in place of typed names); `src/components/HomeHero.jsx` and `src/hero.css` (hero arrows, autoplay, crossfade).
- 0.22: performance. `Player.publish` (`electron/player.mjs`) sends a position-only change at most every `POSITION_MS` (250 ms). `Rail` and `Poster` are memoized and a rail renders 12 cards at a time (`ScrollRow` `onNearEnd`). `CatalogRail` and stable handlers in `App.jsx` keep re-renders local. `.rail` uses `content-visibility: auto`. Settings, add-ons, library, live TV and folder pages are `React.lazy` chunks.
- 0.24: `core/ambient.mjs` and `src/components/Ambient.jsx`. The artwork glow follows the card under the pointer. Cards carry `data-ambient` attributes read by one delegated listener, and two layers crossfade. Settings live in the Ambience page (`LookPages.jsx`).
- 0.25: `core/smart-groups.mjs` and `src/components/SmartHome.jsx` group addon catalogs into Riwaq's sections. They drive the home shelves (`homeGrouping`, `smartHidden`) and the Discover/search tabs (`group` state in `App.jsx`).
- 0.30: the full diagnostic.
  - `electron/diagnose.mjs` (`runDiagnostics`) runs the checks.
  - `core/diagnose.mjs` sanitizes, formats and summarizes the report.
  - Main keeps an `ErrorLog` and the last report for copy and save; `DiagnosticsCard.jsx` sits on the System page.
- 0.29: `core/whats-new.mjs` holds the release highlights; `App.jsx` opens `WhatsNew.jsx` once per version and profile (`seenVersion` in settings). `ShortcutsHelp.jsx` lists app keys and `publicHotkeys` through `bindingLabel` (`core/hotkeys.mjs`). Settings search uses `matchesWords` from `core/arabic.mjs`.
- 0.28: `core/discover.mjs` defines Discover's sections and rows.
  - `Client.catalogPlan({ discover })` and `feedCatalog` serve them as `feed:d-` keys.
  - `DiscoverSections.jsx` draws the tabs, Riwaq's rows and the anonymous blended addon rows (`blendedSection`).
- 0.27: `core/prefetch.mjs` decides when and what to prefetch.
  - `App.jsx` keeps one `prefetchRef` entry (from, target, profile, time, promise), and `advance` consumes it.
  - `skipPreferences` in `core/skip-segments.mjs` applies `skipExcept`, and `Player.refreshSkip` reads it through `skipPrefs`.
- 0.26: `core/series-memory.mjs` keeps a series' source identity (addon ID, release group, tier, source) and audio/subtitle identities (language, title, flags, or subtitles off) in the per-profile `settings.seriesMemory`.
  - `Client.getStreams` stores each ranked stream's identity beside its link (`memory`) and moves the remembered one first with `preferRemembered`.
  - Main records the source in `play` and the viewer's own track picks in `playerCommand` and `subtitle`. `autoSubtitle` restores them and then asks addons.
  - Seek keys are `script-message riwaq-seek <direction>`; `Player.message` asks `settingsNow()` and `seekAmount` for the step.
- 0.25: `core/feed.mjs` defines Riwaq's own home rows (TMDB charts and discover queries with a key, Cinemeta genres without). `Client.catalogPlan({ feed: true })` and `Client.feedCatalog` serve them as `feed:` catalog keys through the existing loader; `HomeHero` takes its titles from them.
- `core/collection-sources.mjs` (0.12.1): TMDB and Trakt request builders and result parsers for folder sources; the client fetches them with the viewer's own key or client ID and matches TMDB results to IMDb IDs.
- `core/nuvio.mjs` (0.12): Java `.properties` parsing, the Nuvio backup zip reader (known stores only), and one Nuvio profile's addons, collections, plugin repositories (without code) and library. Main locates Nuvio Desktop's folder from the environment and holds the snapshot between preview and import.
- `core/home.mjs` (0.12): home sections and catalog row order/visibility by opaque plan keys.
- `core/cursor.mjs` (0.10): when the pointer over the picture should hide, and a balanced gate over Win32 `ShowCursor`.
- `core/integrations.mjs`: device authorization, single-flight token refresh, watchlist import, account-scoped opt-in history queue, Letterboxd bridge and CSV parsing. `observePlayback()` turns player transitions into scrobble start/pause/stop; a stop that should record a play is written ahead to the history queue and held while in flight, and replies are bound to the account that sent them.
- `core/arabic.mjs`: the one Arabic search folding used by library and Live TV search, and `arabicCount()` for number agreement. Browser-safe.
- `core/backup.mjs`: collects, seals (scrypt then AES-256-GCM, header as authenticated data), opens and validates backups. Secrets are excluded unless requested; restore keeps secrets the backup does not carry and machine paths from the current installation. Main-only (node:crypto, node:zlib).
- `core/episodes.mjs`: followed series, up next, calendar entries and day grouping in the viewer's time zone. Browser-safe.
- `core/updates.mjs`: semantic-version comparison, release selection from the list endpoint, and the release-page allowlist main uses before opening a URL.
- `core/livetv.mjs`: pure parsing for M3U playlists, XMLTV guides and the Xtream JSON API, plus guide slicing, catchup URL construction and diacritic-tolerant Arabic channel search.
- `core/live-hub.mjs`: live source lifecycle, refresh, listing and key resolution. Playlist URLs embed subscription credentials, so a channel crosses the bridge as an opaque key and is resolved to a URL only in main at play time.
- `core/profiles.mjs`: profile list, per-profile data buckets and the scrypt-hashed parental PIN. `apply()` points client state at the active bucket; `capture()` writes it back on every persist.
- `core/skip-segments.mjs`: intro, recap, outro and preview detection from chapter titles, with a conservative shape heuristic when a file has no titled chapters.
- `core/hotkeys.mjs`: the action catalog, binding validation, conflict detection and MPV `input.conf` generation.
- `core/presence.mjs`: the Discord activity payload and the local IPC client.
- `core/notify.mjs`: Discord and Telegram payloads and delivery, each pinned to its official host.
- `electron/main.mjs`: lifecycle, official Stremio login callback, safeStorage, allowlisted IPC, file dialogs, presence wiring and live channel playback.
- `electron/video-host.mjs`: Windows native child surface. DLL imports are fixed Win32 functions; no renderer-supplied native handles.
- `electron/player.mjs`: MPV lifecycle, playback commands, picture profiles, skip segments, A/B loop, sleep timer and progress events. URLs are passed after `--`; no shell is used.
- `src/components/LiveTV.jsx`: channel grid, category strip, EPG timeline and source management.
- `src/components/Profiles.jsx`: profile switching and the parental gate; a locked room routes here before it renders.
- `src/components/PlayerView.jsx`: full and mini embedded layouts, skip button, segment markers, stats overlay and ResizeObserver geometry.
- `src/components/SettingsStudio.jsx`: searchable settings groups, the stream engine room, the hotkey editor, the presence/notification room, the backup room and the updates card.
- `src/components/Episodes.jsx`: the up next rail and the episode calendar.
- `src/components/LibraryView.jsx` (0.4): library tabs, the queue and, from 0.5, the calendar tab.

## Storage and network

`core/library.mjs` contains pure queue, identity, Arabic search, completion and episode-release rules shared with React. `LibraryView.jsx` presents the saved/continue/queue/history/platform tabs. `queueEdit` and `historyEdit` are narrow IPC actions. Queue storage joins the profile bucket; old profiles migrate to an empty queue. History edits remain local and never generate tracker completion writes. MPV file-loaded consumes a queued entry; failures retain it. Profile switches stop/save playback before applying a new bucket. See `docs/RELEASE-0.4.md`.

One profile file lives in `%APPDATA%/Riwaq/profile.bin`, encrypted for the Windows user. `RIWAQ_DATA_DIR` isolates development and tests. Provider keys, OAuth tokens, IPTV credentials and configured addon URLs stay in main. API credentials go only to their configured fixed official API hosts; redirect following is disabled for these requests. Addon requests follow normal HTTP behavior because the addon ecosystem can use redirects.

Viewer profiles namespace favorites, progress, connected lists and settings. Addons, provider keys, platform accounts, live sources and hotkeys are shared across profiles on purpose: they are the installation's setup rather than one viewer's taste. The active profile's data is also written at the top level of the saved state so a file written by 0.3 still opens in 0.2.

No remote web page is loaded as the app UI. The renderer has CSP, context isolation, no Node integration, sandboxing and denied permissions/navigation. Service links are mapped from fixed IDs; arbitrary external URLs are allowed only for actual addon streams after HTTP(S) validation. The generated `input.conf` is written into the user data directory, never into the application directory.

## Backups

A backup file is the only way data leaves the DPAPI seal, so it is always encrypted with the viewer's passphrase and its header is authenticated. Import is untrusted input: every section passes the validation the app applies to hand-entered data. A picked file stays in main between preview and restore; the renderer holds an opaque token. The previous `profile.bin` is kept as `profile.before-restore.bin`, still DPAPI-sealed. Backup operations are gated by the Settings room lock in core.

## Limits to preserve in product copy

The player is embedded on Windows; the mini player is within the app, not an OS-wide PiP window. HDR is configurable but hardware results are not certified. Stremio Service is still required for infoHash playback. Stremio writes are not implemented. Trakt watchlists import up to 1,000 titles per media type per sync. Trakt history is a completion queue unless the viewer also opts into scrobbling, and one viewing is never recorded by both. Simkl imports items with IMDb IDs. CSV imports the first 500 rows with exact title/year matching. Skip segments come from chapters and a conservative heuristic, not from AniSkip or any external segment database. Picture profiles are MPV's own scalers; no third-party shader files are bundled. Riwaq supplies no channels, playlists or subscriptions. A forgotten backup passphrase cannot be recovered. Installed NSIS builds can download authenticated updates and install on ordinary app exit or explicit restart; portable/source copies only check. Ed25519 metadata and SHA-512 are verified before execution, and OS shutdown defers install. Windows Authenticode remains unconfigured. Scrobbling records a play at 80%, the completion queue at 90%.

## Update delivery (0.8)

`core/update-package.mjs` owns the signed manifest, canonical filenames, digest verification and restricted HTTPS redirects. `electron/updater.mjs` extends the metadata selector with download/cancel/recovery/installation states; main supplies the fixed installation directory and platform checks. Update preferences are installation-wide. React sees only public status, progress and text notes. The private signing key is an Actions secret; only the public key ships. See [UPDATES.md](UPDATES.md).
