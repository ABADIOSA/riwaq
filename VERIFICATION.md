# Verification — Riwaq 0.14.0

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
