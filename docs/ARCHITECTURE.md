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

- `core/protocol.mjs`: URL validation, configured-addon identity, resource applicability, catalog extras, settings whitelist.
- `core/stream-engine.mjs`: the four-stage source pipeline. `parseStream` reads the free text an addon supplies; `trustStream` rejects what cannot be the requested title; `scoreStream` returns points with a named reason for each; `analyzeStreams` ranks and groups into tiers. Arabic subtitle and Arabic dub are separate parsed fields, not one keyword bonus.
- `core/client.mjs`: addon requests and cache, Stremio import, favorites/progress, opaque stream/subtitle identifiers, hotkey storage.
- `core/data-hub.mjs`: private API keys; optional detail enrichment; exact title/year matching for CSV.
- `core/credits.mjs` (0.10): Wikidata SPARQL queries and parsers for a title's cast, crew, companies, filming locations, settings, countries and awards, and for one person, company or place with its other works; TMDB merging and fallback; OpenStreetMap tile maths for a location map; from 0.11, series rows (P179), people search and the trailer ID. `src/components/Credits.jsx` draws the cast rail, the makers section and the explore dialog.
- `core/collections.mjs` (0.12): per-profile collections of folders (addon catalogs by manifest ID, TMDB sources, Trakt public lists and hand-picked titles), whole-list validation on every edit, catalog resolution, available catalogs without URLs, and the Nuvio JSON mapping both ways. `src/components/Collections.jsx` draws the room, a collection, the folder editor, pinned home rows, "add to collection" and the Nuvio link dialog. `src/components/FolderPage.jsx` (0.13) is a folder's own page, opened from home; `core/folder-view.mjs` decides what it shows, and `Client.collectionSource` reads a source's next page.
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
