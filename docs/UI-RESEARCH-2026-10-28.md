# Interface research — 28 October 2026

Owner brief: `Riwaq-Claude-Code-UI-Rebuild-Prompt-EN.md`, with the owner's Arabic research report `Riwaq-UI-Research-Report-AR.md` as a starting lead. Both are evidence and direction, not executed as code. Branch `claude/new-session-zcr5p9`, based on main `3cf5281` (the merge of #119; v0.52.0 Beta).

Evidence levels follow [QUALITY-2026-10-25](QUALITY-2026-10-25.md): **R** reported; **S** source supports; **P** reproduced here; **F** fixed on this branch; **V** verified on this branch's final code; **U** reporter-confirmed. A closed issue, a thank-you or a passing CI run is not U.

## What was read, and its limits

- GitHub, read 28 October 2026 (17:40–18:10 UTC): all 25 public issues (3 open: #111, #112, #113; 22 closed), every comment on the open issues and on #114–#118, the latest 12 PRs (none open; #119 merged 27 Oct 22:26 UTC). The repository has no open PRs. `GET /releases/latest` answers 404 because v0.52.0 is a prerelease; the tag and README name it.
- Screenshots attached to issues (`github.com/user-attachments/...`) answered **403** to this session; the requests below are taken from their text only.
- Repository: README, CLAUDE.md, docs/ARCHITECTURE.md, docs/QUALITY-2026-10-25.md, VERIFICATION.md (latest entries), CI workflows, and the source of every component named below.
- Comparative sources: this session's network policy refuses the vendors' own sites (about.netflix.com, disneyplus.com, aboutamazon.com, forums.plex.tv, blog.stremio.com; DNS refused). Those pages were **not opened**. The table below uses web-search summaries (Tudum, Tom's Guide, Hollywood Reporter, 9to5Mac, Neowin, AlternativeTo, Apple Support, W3C/Deque) and says where they disagree with the owner's report. No subscription app was used.
- Most interface reports come from one contributor (ad2004teaster-cmyk) and one earlier one (nyouness). They are precise evidence about specific screens, not a survey of all viewers.

## Baseline on this machine

Linux x64 container, Node 24.22.1, Playwright Chromium (pre-installed). No Windows, no MPV, no GPU: native MPV/HUD checks are **blocked here**.

| Command (main `3cf5281`, unchanged) | Result |
| --- | --- |
| `npm ci` | Installed. npm 11 reports install scripts not allowlisted (bufferutil, koffi, node-datachannel, utp-native…); the Electron binary was not downloaded. |
| `npm test` | **921 pass**, 0 fail, 13.8 s. |
| `npm run check`, `npm run build`, `npm run build:web` | Pass (existing large-chunk warning). |
| `node scripts/test-web.mjs` | Every step through the two-device account sync passes, **including all 21 #110 quality checks**; then it stops at `page.setViewportSize` after `playerCommand pip` ("To resize minimized/maximized/fullscreen window, restore it to normal state first"). Same failure before any change on this branch: an environment limit of this headless Chromium, not attributed to the product. |
| `node scripts/test-ui-browse.mjs` (new; `UI_PHASE=before` against the unchanged build) | 33/33 record steps; geometry below. Evidence `.cache/ui-rebuild/before/`. |

### See all, measured (production CSS, local fixture)

| Width (AR and EN identical) | Surface | Grid | Content inner width | Grid fills | Columns | Card |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1920 | dialog 570 | 504 | 1708 | 29.5% | 2 | 244 |
| 1440 | dialog 570 | 504 | 1228 | 41.0% | 2 | 244 |
| 1280 | dialog 570 | 504 | 1068 | 47.2% | 2 | 244 |
| 980 | dialog 570 | 504 | 768 | 65.6% | 2 | 244 |
| 740 | dialog 570 | 504 | 740 | 68.1% | 2 | 244 |
| 390 | dialog 340 | 310 | 390 | 79.5% | 1 | 310 |

**Root cause (P):** `CatalogBrowser.jsx` imports `src/catalog-browser.css`. Because `main.jsx` imports `App.jsx` (and through it the component) before `styles.css`, the production bundle emits `.catalog-browser{width:min(1200px,…)}` at byte 0 and `.modal{width:570px}` at byte 22,324. Both are one class, so the later `.modal` wins. The existing check (`scripts/quality110-checks.mjs`) only asserted `scrollWidth <= clientWidth`, which a 570 px dialog passes. Widening the dialog would still not meet the reporter's request: they want the in-app page back, not a bigger popup.

### Home, measured (1440×900, Arabic, defaults after onboarding, no history)

| Section | Top (px) |
| --- | ---: |
| Today's session (`.session-home`, two panels) | 68 |
| Stremio banner | ~720 |
| Taste compass, editor open (19 genre chips, exploration, privacy, history) | 890 |
| Trakt suggestions (not linked: a prompt) | 2024 |
| First addon shelf (Films) | **2230** |

No catalog title is above the fold until the viewer scrolls past two setup surfaces. English is the same shape (first shelf 2308).

### Rows (#111), measured

Mouse drag (Playwright mouse: pointerType `mouse`) moved every horizontal row found on Home and Discover by 200 px, opened nothing, in RTL: `taste-row`, two `poster-row` shelves on Home; `taste-row` and a `poster-row` on Discover. Every horizontal title row in `src/` is a `ScrollRow` (`grep ScrollRow` over components: 14 files), which binds `attachDragScroll` to late and replaced nodes since #119.

## Evidence ledger

| ID | Source, author, date (UTC) | Version / screen | Atomic request | Kind | Level | Code | Action on this branch | Acceptance test |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | [#112](https://github.com/ABADIOSA/riwaq/issues/112), ad2004teaster-cmyk, 27 Oct 11:44 | 0.51.0 shelves | "See all" visible for "All" as well as a single catalog | Bug | R/S/F in #119 | `SmartHome.jsx` header always renders it | Keep | `test-ui-browse`: All and single catalog open the page on Home and Discover |
| A2 | [#112 comment](https://github.com/ABADIOSA/riwaq/issues/112#issuecomment-6455940964), same, 27 Oct 23:15 (edited 28 Oct 11:34) | 0.52.0 See all | No popup; open inside the app's own view as a wide regular grid, as 0.51.0 did | Regression | R/S/P | `CatalogBrowser.jsx` `<dialog class="modal">`; CSS order above | Rebuild as an in-shell page | geometry budget, no `dialog`, Back/focus/scroll restore |
| A3 | same comment | 0.52.0 | The close button at the top breaks the usual look | Design | R/S | `.modal-close` X | Page uses Details' "رجوع" button and Escape | same |
| B1 | [#111](https://github.com/ABADIOSA/riwaq/issues/111), same, 27 Oct 11:42 | 0.51.0 rows | Left-click drag on "vertical poster" rows as on "horizontal" ones | Bug | R/S; P only for late/replaced rows (fixed in #119); exact row **not reproduced** | `useScrollRow` → `attachDragScroll` | Keep the single implementation; stop native image drags from starting under a row gesture; widen the browser check (late rows, replaced rows, both directions, See all grid keeps vertical scroll) | `test-ui-browse` rows check |
| C1 | [#113](https://github.com/ABADIOSA/riwaq/issues/113), same, 27 Oct 11:46 | 0.51.0 menu | Remove Pause, Stop and Subtitles from the menu | Design | R/S/F in #119 | `PlayerMenu.jsx` | Keep | `tests/downloads-quality.test.mjs` |
| C2 | same | 0.51.0 | Shorten to "Download video" | Copy | R/S/F in #119 | same | Keep | same |
| C3 | [#113 comment](https://github.com/ABADIOSA/riwaq/issues/113#issuecomment-6455686588), same, 27 Oct 23:00 | 0.52.0 | Both "Copy torrent link" and "Copy magnet link" | Feature | R/S | `electron/main.mjs` `copyMagnet` → `magnetOf(stream)`; `core/stream-engine.mjs` knows a torrent only as `infoHash` (+ `sources`, `fileIdx`) | **Not implemented as asked**: no stream carries a separate `.torrent` file; 0.51.0's "Copy torrent link" copied the same magnet. The menu now says so under the magnet item. **After 0.53.0:** implemented at the owner's request, with the owner's choice of value. The torrent link is the address the torrent plays from on this computer, so the two items differ (see UI-VERIFICATION, Follow-up). | `tests/player-menu-links.test.mjs`, i18n |
| C4 | [#113 comment](https://github.com/ABADIOSA/riwaq/issues/113#issuecomment-6455733702), same, 27 Oct 23:03 | — | Attribution remark about which model edited | Remark | — | — | No action | — |
| D1 | [#114](https://github.com/ABADIOSA/riwaq/issues/114) | 0.51.0 Downloads | Remove local-video opening; Movies/Riwaq folder; artwork; icons; Reveal; Delete | Mixed | Closed by reporter 27 Oct 23:03; artwork/icons/Reveal/Delete F in #119; relocation and full removal **modified** | `OfflineLibrary.jsx`, `electron/offline.mjs` | Preserve (out of scope for a UI rebuild) | existing `test-downloads-quality` |
| D2 | [#115](https://github.com/ABADIOSA/riwaq/issues/115), [#116](https://github.com/ABADIOSA/riwaq/issues/116), [#117](https://github.com/ABADIOSA/riwaq/issues/117), [#118](https://github.com/ABADIOSA/riwaq/issues/118) | 0.51.0 | Showcase arrows in its footer + swipe; Taste arrows adjacent; identity works; Details scroll isolation | Bugs/design | Closed by reporter 27–28 Oct after 0.52.0 | `HomeHero.jsx`, `TasteDiscovery.jsx`, `identity.css`, `title.css` | Preserve | existing quality checks (`quality110-checks.mjs`) still run |
| E1 | Owner report §"P2 opportunity"; baseline above | 0.52.0 Home | Resuming and useful titles near the start; session and taste available without a large form every visit | Design | S/P | `App.jsx`, `SessionHome.jsx`, `TasteDiscovery.jsx` | Compact session (expandable, remembered per profile), placed after Continue watching when it has titles; Taste starts folded on Home as on Discover | `test-ui-browse` home order |

Older closed reports (#69–#107, #110) are preservation constraints, recorded in [QUALITY-2026-10-25](QUALITY-2026-10-25.md) and the USER-FIXES documents; none is reopened here.

## Comparative research

Dated, by platform. "Claim" is what the vendor or press says; "observed" would need a session in the product, which this research did not have. Nothing here is copied as appearance.

| Service, platform, date | Pattern (claim) | Problem it addresses | For Riwaq | What does not transfer |
| --- | --- | --- | --- | --- |
| Netflix, TV, announced 7 May 2025, rollout from 19 May ([Tudum](https://www.netflix.com/tudum/articles/netflix-new-tv-layout), [Tom's Guide](https://tomsguide.com/entertainment/netflix/netflix-is-making-a-massive-change-to-its-homepage-for-the-first-time-in-years)) | Search and My List moved from a sidebar to the top; My Netflix gathers Continue Watching and Remind Me; tiles carry decision labels ("#1 in TV Shows"); home suggestions respond to recent searches | Reaching personal lists and deciding faster | Keep resuming near the top; keep the masthead search; cards keep their concise labels | Top navigation instead of Riwaq's sidebar (Plex below shows the cost of moving habits); red branding; behavioural recommendation engine |
| Disney+, iOS/tvOS then wider, from 8 Oct 2025; Disney's article dated 7 Nov 2025 per search ([9to5Mac](https://9to5mac.com/2025/10/02/disney-reveals-app-redesign-coming-soon-to-ios-and-tvos/), [Hollywood Reporter](https://www.hollywoodreporter.com/business/business-news/disney-plus-homepage-refresh-hulu-expansion-1236391770/)) | "For You" separated from brand hubs; more prominent profile icons; tags such as "Season Finale"; poster artwork | Personal vs catalogue browsing; who is watching | Riwaq's own rows and addon groups stay separate; the active profile stays visible in the sidebar | Brand rows, video in the hero carousel. The owner's report cites a 9 Jan 2026 revision; it could not be opened to confirm |
| Prime Video, living-room apps (side navigation and Prime checkmark: 2023 rollout per [GSMArena](https://m.gsmarena.com/amazon_prime_video_redesigned_ui-news-55110.php)); the 2024 "updated streaming experience" article could not be opened | Side navigation; a mark for what is included versus what must be bought | Availability clarity | Never imply a title plays before its sources resolve; See all says its results are what the catalogues returned so far | Store, rentals, upsell marks, Clips (mobile, May 2026) |
| Apple TV app, Apple Support guides (current tvOS and older iOS/Mac guides) ([Apple](https://support.apple.com/guide/tv/atvb7d7bec9f/tvos)) | Sidebar navigation; Up Next/Continue Watching; selecting a row title or "See All" opens the whole category | Predictable path row → full category → title → Back | The core journey for #112: row → in-shell grid → Details → Back to the grid → Back to the row | Apple's channel store |
| Plex, Apple TV/Roku preview and Android TV beta, Roku preview 9.16.15 on 17 Aug 2026 ([Plex forum via search](https://forums.plex.tv/t/941751), [Neowin](https://www.neowin.net/news/plex-reverts-tv-app-layout-after-intense-user-backlash/)) | Primary navigation returns to a collapsible left/side panel after negative preview feedback; favourite libraries top-level | Respecting habits | Keep #107/#108's mirrored, collapsible sidebar; do not swap navigation models | "Newest is better" |
| Stremio Desktop/Web, September 2026 ([AlternativeTo](https://alternativeto.net/news/2026/9/stremio-brings-live-tv-guide-interface-zoom-enhanced-video-player-and-windows-vlc-option/)) | Interface zoom for the whole UI; subtitle/audio choices carried across episodes; live TV guide from addons; desktop opens magnet and .torrent | Scaling, episode context | Riwaq already has interface scale, series memory and an EPG; verify the new page at 200% zoom | Opening .torrent files is a desktop intake feature, not a reason to invent a "torrent link" in the player menu (C3) |
| WCAG 2.2, W3C ([What's new](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/), [Deque](https://dequeuniversity.com/resources/wcag-2.2)) | 2.4.11 Focus Not Obscured (Minimum), 2.5.7 Dragging Movements, 2.5.8 Target Size (Minimum) 24×24 among nine new criteria | Keyboard focus under sticky bars; drag-only actions; small targets | Every drag has arrows/keys; focus returns to the opening control; the browse page's Back and Load more are ≥ 36 px tall; 44 px is a project comfort target for primary actions, not a WCAG requirement | — |

## Conclusions that shape the design

1. #112's request is about **where** See all lives. The fix is a page in the content area with a Back that returns to the row, not a wider dialog.
2. #111 is not reproduced on current code. A second drag implementation is not justified; tests widen and the image drag guard is hardening, not a claimed fix.
3. #113's "torrent link" has no distinct real value in Riwaq's data. Saying so is the honest outcome.
4. Home's setup surfaces push catalogues 2,200 px down. Compacting them is in scope; removing them or their settings is not.
5. Native MPV/HUD, Windows DPI and HDR checks cannot run here; changed CSS that the HUD shares must stay minimal and be called out for a Windows run.
