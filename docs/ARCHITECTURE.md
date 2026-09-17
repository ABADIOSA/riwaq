# Architecture

```
React (sandboxed, RTL)
  -> explicit preload IPC actions
  -> Electron main
       -> Client / addon HTTP protocol
       -> DataHub / TMDB, OMDb, MDBList, Fanart
       -> Integrations / Trakt, Simkl, public Letterboxd bridge + CSV
       -> DPAPI encrypted profile.bin
       -> Player / MPV process, private named pipe
            -> Win32 child video surface inside the Electron window
```

## Files

- `core/protocol.mjs`: URL validation, configured-addon identity, resource applicability, catalog extras, ranking, settings whitelist.
- `core/client.mjs`: addon requests and cache, Stremio import, favorites/progress, opaque stream/subtitle identifiers.
- `core/data-hub.mjs`: private API keys; optional detail enrichment; exact title/year matching for CSV. TMDB lookup starts with IMDb, preserving the addon ID and episode list. Fanart series art requires a TVDB ID from TMDB.
- `core/integrations.mjs`: device authorization, single-flight token refresh, watchlist import, account-scoped opt-in history queue, Letterboxd bridge and CSV parsing.
- `electron/main.mjs`: lifecycle, official Stremio login callback, safeStorage, allowlisted IPC, file dialogs and official service links.
- `electron/video-host.mjs`: Windows native child surface. DLL imports are fixed Win32 functions; no renderer-supplied native handles.
- `electron/player.mjs`: MPV lifecycle, playback commands and progress events. URLs are passed after `--`; no shell is used.
- `src/components/PlayerView.jsx`: full and mini embedded layouts, seek/volume/subtitle controls and ResizeObserver geometry.
- `src/components/SettingsStudio.jsx`: searchable settings groups, theme/layout previews, provider keys and platform linking.

## Storage and network

One profile lives in `%APPDATA%/Riwaq/profile.bin`, encrypted for the Windows user. `RIWAQ_DATA_DIR` isolates development and tests. Provider keys, OAuth tokens and configured addon URLs stay in main. API credentials go only to their configured fixed official API hosts; redirect following is disabled for these requests. Addon requests follow normal HTTP behavior because the addon ecosystem can use redirects.

No remote web page is loaded as the app UI. The renderer has CSP, context isolation, no Node integration, sandboxing and denied permissions/navigation. Service links are mapped from fixed IDs; arbitrary external URLs are allowed only for actual addon streams after HTTP(S) validation.

## Limits to preserve in product copy

The player is embedded on Windows; the mini player is within the app, not an OS-wide PiP window. HDR is configurable but hardware results are not certified. Stremio Service is still required for infoHash playback. Stremio writes are not implemented. Trakt watchlists import up to 1,000 titles per media type per sync. Simkl imports items with IMDb IDs. CSV imports the first 500 rows with exact title/year matching; unmatched and excess counts are reported. Letterboxd CSV sync is a local snapshot, not a bidirectional account link.
