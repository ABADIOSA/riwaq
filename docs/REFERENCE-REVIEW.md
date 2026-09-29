# Reference review — 2026-09-17

Three projects were read to decide what Riwaq 0.3 should do. Behavior was studied; no implementation code was copied. Riwaq is JavaScript on Electron, none of the three shares that stack, and every module listed in the architecture is written for this codebase.

## Harbor

- License: **MIT** (`harborstremio/harbor`, LICENSE), as THIRD-PARTY.md already recorded. CLAUDE.md previously described the reference apps collectively as GPL, which was wrong for Harbor; that line is corrected. Nuvio Desktop and Stremio Community v5 are GPL-3.0.
- Stack: Tauri 2, React + TypeScript, and a Rust `harbor-core` crate compiled to WASM.
- Source read at commit `0117755855d3f43960bad3f9f62b69ef851d5991` (2026-08-21), the head of the public default branch. `package.json` and `src-tauri/Cargo.toml` both read `0.9.21`. The beta channel Harbor publishes at `harbor.site/updates/latest-beta.json` is **not reachable from this environment** (the network egress proxy blocks the host), so the current beta number could not be re-confirmed for this release and the public source at the commit above is what was actually reviewed.
- What was studied: the `parse -> trust -> score -> rank` shape of `harbor-core` (`types.rs`, `parser.rs`, `trust.rs`, `scoring.rs`), the quality tier enumeration, the IPTV module (`src/lib/iptv/`: `m3u.ts`, `xmltv.ts`, `xtream.ts`, `catchup.ts`), the skip-segment sources, the hotkey action catalog, profiles and parental gating, and the Discord presence and webhook integrations.
- What Riwaq took: the idea that source selection deserves a real pipeline with inspectable reasons, the tier grouping, the five catchup conventions, per-viewer profiles with a PIN, and optional presence and webhooks. Riwaq's scoring weights, Arabic handling, rejection set and every line of the implementation are its own.
- What Riwaq deliberately did not take: debrid account integration, casting, watch parties, DVR, multiview, trickplay previews, the addon index browser, and the theme studio's code editor.

## Nuvio Desktop

- License: GPL-3.0. Stack: Kotlin Multiplatform with Compose.
- Source read at commit `48e1ca3a8eb21708031d6dc9c690d6098e07133a` (2026-09-16), version `0.1.24-alpha` per `composeApp/Configuration/DesktopVersion.properties`.
- The project describes itself as alpha and testers-only. What was studied: the separation of browse, library, player and settings, and the desktop player integration. Riwaq's mini player stays embedded; Nuvio's OS-level PiP is not claimed as implemented here.

## Nuvio HTPC (UmbraProjects/NuvioDesktop), studied 2026-09-26

GPL-3.0, Kotlin/Compose. Studied at `abdf9f0` for player behaviour only; no code was copied into this MIT application. Behaviours that informed Riwaq 0.6: subtitles grouped by language with built-in and addon tabs; a preferred subtitle kind (standard, SDH, forced) as a tiebreaker inside a language rather than a reason to change language; loading an addon subtitle at start in the preferred language; cue-based quick sync with an allowance for reaction time; subtitle styling (colour, outline, shadow, background, bold, ASS handling); a right-click route to quick options; and an "ends at" clock. Riwaq's version keeps the panel beside the picture because HTML cannot paint over its native video surface.

## Harbor beta-branch (0.9.127) and Nuvio HTPC settings, studied 2026-09-26

Harbor (MIT) at `a821e27` on `beta-branch`: a theme studio with a preset gallery, a ten-colour custom palette, font pairs, layout, card and button styles, a navigation editor, draft history and shareable themes. Nuvio HTPC (GPL-3.0) at `abdf9f0`: accent gradients with a direction, an AMOLED black option, an application UI scale, an application font, poster radius, width, depth and hover highlight, hidden poster labels, and a configurable details background. Riwaq 0.7's appearance studio was written from this behaviour; no code from either project was copied.

## Harbor and Nuvio HTPC players, studied 2026-09-28

Harbor beta (`src-tauri/src/mpv.rs`, MIT): MPV embedded with `input-cursor=no` and its child windows pushed to `HWND_BOTTOM` under a transparent WebView2, so the web controls draw over the picture and the page owns the pointer. Nuvio HTPC (`native/windows/player_bridge.cpp`, GPL-3.0): a container window with a transparent WebView2 HUD over MPV, the pointer hidden with `ShowCursor` from the HUD's thread, and system media controls. Riwaq 0.8 reaches the same outcome in Electron with a transparent owned window over the surface; no code was copied. Player behaviours taken as ideas: an in-player sources panel, an episodes panel, stream failover, a next-episode card and media keys.

## Credits and the pointer, 2026-09-29 (0.10)

The owner asked for a title page like Harbor's and Nuvio's with cast, directors, production companies and filming locations, each opening to who they are and what else they made. Neither project's source was re-read for this round; the page is built from the owner's description and two public data sources. Wikidata supplies every viewer with crew, companies, filming locations (P915), settings, countries, awards and reverse links to other works, keyed by IMDb IDs so a work opens straight in Riwaq; TMDB, with the viewer's own key, adds portraits, characters, biographies and a fallback when Wikidata's query service is down. The pointer now hides with Win32 `ShowCursor` on the thread that owns the HUD, the mechanism noted in Nuvio HTPC above; the code is Riwaq's own.

## Nuvio collections and data layout, studied 2026-09-29 (0.12)

Nuvio HTPC (UmbraProjects/NuvioDesktop, GPL-3.0) at `b775bf5` (Release 1.15.0), for behaviour and file formats only; no code was copied.

- **Collections.** A collection holds folders, and each folder gathers sources: addon catalogs keyed by manifest ID, type and catalog ID, plus TMDB and Trakt sources. Folders have a cover image or emoji and a tile shape. A collection can be pinned to the top of home and shown as tabs or rows, and there is a JSON import/export.
- **Riwaq 0.12's collections.** They keep the addon-catalog model and the JSON shape so both directions work. They add folders of hand-picked, ordered titles, which Nuvio has no equivalent for.
- **Account sync.** Nuvio syncs through a Supabase backend (`sync_pull_collections`, the `addons` table, and so on). Its publishable key is injected at build time and is not in the source, so Riwaq does not talk to Nuvio's servers.
- **Local stores.** Nuvio Desktop keeps each profile's data in Java `.properties` stores in its data folder:
  - `nuvio_addons` (`installed_addon_urls_N`, `addon_enabled_states_N`);
  - `nuvio_collections` (`collections_N`);
  - `nuvio_plugins` (`plugins_state_N`, with scraper code);
  - `nuvio_library` (`library_N`);
  - `nuvio_profiles`.
- **Backup.** Its settings backup is a zip of `preferences/*.properties`.
- **Riwaq 0.12's Nuvio link.** It reads those stores directly and never keeps or runs plugin code.

## Stremio Community v5

- License: GPL-3.0. Stack: C++ with WebView2 and libmpv, wrapping the official Stremio web UI.
- Source read at commit `3e96a6f6468dc87016869b1df6d516f92f6ed8cd` (2026-08-01), whose message is "Bump to version 5.0.22" — newer than the `5.0.0-beta.22` release tag.
- What was studied: the MPV surface it exposes (hwdec, gpu-api, upscaling shaders, HDR, advanced audio), multiple preferred subtitle and audio languages with keyword filtering, pause-on-minimize and related window behaviors, Discord Rich Presence, and thumbnail previews via thumbfast.
- What Riwaq took: a wider MPV settings surface, audio delay, secondary subtitles, tone mapping, and a picture-profile concept. Riwaq builds its profiles from MPV's own scalers rather than bundling Anime4K, and has no thumbfast equivalent.

## API and format references

- [TMDB application auth](https://developer.themoviedb.org/docs/authentication-application), [OMDb](https://www.omdbapi.com/), [MDBList](https://api.mdblist.com/), [Fanart API](https://fanart.tv/api-docs/api-v3/).
- [Trakt auth](https://docs.trakt.tv/reference/auth), [device code](https://docs.trakt.tv/reference/postoauthdevicecode), [device polling](https://docs.trakt.tv/reference/postoauthdevicetoken). Token endpoints use `auth.trakt.tv`; refresh tokens rotate and are single-use.
- [Letterboxd API availability](https://letterboxd.com/api-beta/): access requires approval. Public lists use the explicitly disclosed [Stremboxd](https://stremboxd.com) bridge; CSV uses the user's official export and TMDB matching.
- [MPV manual](https://mpv.io/manual/stable/) for IPC, `--wid` embedding, scalers, `ab-loop`, chapters and tone mapping. [Koffi](https://koffi.dev/pointers) for Win32 pointer handling.
- [XMLTV DTD](https://github.com/XMLTV/xmltv/blob/master/xmltv.dtd) for the guide format, and the M3U `#EXTINF` attribute conventions (`tvg-id`, `group-title`, `catchup`, `catchup-source`) as used by IPTV playlist providers.
- [Discord IPC](https://discord.com/developers/docs/topics/rpc) for the local socket framing and the activity payload.

This is an original implementation, not a merge of these codebases and not a promise of feature parity. Tests and hardware/account limitations are documented in VERIFICATION.md.
