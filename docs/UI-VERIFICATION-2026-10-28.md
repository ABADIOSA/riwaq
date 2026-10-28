# Interface verification — 28 October 2026

Follows [UI-RESEARCH](UI-RESEARCH-2026-10-28.md) and [UI-DESIGN](UI-DESIGN-2026-10-28.md). Branch `claude/new-session-zcr5p9`, based on main `3cf5281` (v0.52.0 Beta). Everything below ran on this branch's final code unless it says "baseline".

**Environment:** Linux x64 container; Node 24.22.1 (CI uses Node 24); Playwright 1.63.0 with headless Chromium 153.0.8010.12 (CI pins Playwright 1.56.1). No Windows, Electron binary, MPV, GPU, HDR display, touch hardware or screen reader. The fixtures are local; external services are refused.

## What changed, in one place

| Surface | Change | Kept |
| --- | --- | --- |
| See all (#112) | `BrowsePage.jsx`: a page of the content area with Details' geometry and Back; paging in `core/browse.mjs`; editable filters for the chosen catalog; automatic loading near the end plus «تحميل المزيد»; per-catalog retry | Grouped and individual catalogs, opaque keys, provider cursors, search query, hide-watched rule, Details/Back, navigation/playback ownership |
| Layering | One effect holds `inert`, `html` overflow and the gutter for Details and See all together | Details' focus/scroll return |
| Home | Compact session band (`sessionExpanded`, per profile, default off); Continue watching before the session when it has titles; Taste compass folded on Home | `showSession`, session plans, durations, moods, queue writes; taste genres/feedback; showcase off by default; section order |
| Player menu (#113) | A note under «نسخ رابط المغناطيس» saying the source has no separate torrent file | Screenshot, copy magnet, download; session/profile guards |
| Rows (#111) | Images in a row never start Chromium's native image drag | The single `attachDragScroll` implementation |
| Tokens | `src/tokens.css`: semantic names over the viewer's appearance values; `src/browse.css` imported after the shared sheets | Every appearance option; older sheets unchanged |

No setting, IPC method, stored value or feature was removed. One setting was added (`sessionExpanded`, validated by `safeSettings`, so backups and accounts carry it).

## Commands and results

| Command | Result |
| --- | --- |
| `npm ci` | Installed (npm 11 skips unlisted install scripts; no Electron binary). |
| `npm test` | **932 pass**, 0 fail (baseline 921; +9 `tests/browse.test.mjs`, +2 `tests/player-menu-note.test.mjs`). |
| `npm run check` | Pass. |
| `npm run build`, `npm run build:web` | Pass; Vite's existing large-chunk warning remains. |
| `node scripts/test-ui-browse.mjs` | **39/39 pass** (new; evidence `.cache/ui-rebuild/after/`). Baseline build with `UI_PHASE=before`: records only; 33/35 because the two checks need the new page and toggle. |
| `node scripts/test-web.mjs` | All **22** #110 quality checks pass (21 before, plus the new filter check; the See all checks now assert the page). The smoke completes the same 24 steps as on main, then stops where main also stops in this environment: `page.setViewportSize` on the second device's tab ("restore it to normal state first"), with or without the PiP command. CI's pinned Playwright passed this step on main; it is **not verified here**. |
| `node scripts/test-downloads-quality.mjs` | **28/28** (menu checks now also assert the magnet note and its `aria-describedby`). |
| `QUALITY_PHASE=after node scripts/test-quality-carousels.mjs` | **36/36**. |
| `node scripts/test-hud-keys.mjs` | Pass. |
| `node scripts/measure-ui-browse.mjs <baseline> dist-web 7` | See measurements. |
| Windows: `test-player-hud.mjs`, `test-review083-native.mjs`, `test-session-ui.mjs`, `test-music-ui.mjs`, packaged smoke | **Blocked here (no Windows).** `test-session-ui.mjs` was updated for the new defaults (it widens the session and opens the taste editor) but has not been run. |

## See all (#112)

Production CSS, local fixture, Arabic and English identical:

| Width | Baseline (dialog) fill / columns / card | Final (page) fill / columns / card |
| --- | --- | --- |
| 1920 | 29.5% / 2 / 244 px | 96.2% / 9 / 167 px |
| 1440 | 41.0% / 2 / 244 px | 95.2% / 6 / 179 px |
| 1280 | 47.2% / 2 / 244 px | 95.2% / 5 / 188 px |
| 980 | 65.6% / 2 / 244 px | 94.8% / 4 / 166 px |
| 740 | 68.1% / 2 / 244 px | 95.6% / 3 / 220 px |
| 390 | 79.5% / 1 / 310 px | 91.5% / 2 / 164 px |

Fill is the grid's width over the content column's inner width. No horizontal page overflow at any width. Checked in the browser:

- The page is not a `dialog`, and it takes focus.
- Back and Escape return to the row's button and the window offset.
- Details from a scrolled grid comes back to the same card and `scrollTop`, and nothing stays inert.
- The keyboard path runs Back → tabs → first title → Details → Escape → Escape.
- A provider page repeated at `skip=20` advances to `skip=40`. A 503 at `skip=60` keeps the 57 loaded titles, and «إعادة المحاولة» asks `skip=60` once more.
- A declared filter changes the real request (`language=English&sort=Popular`).
- Navigation, playback, a profile switch and a lock through the Profiles dialog all close the page.
- At 200% zoom (720×450 CSS) Back and the tabs fit, and the page scrolls.
- Under reduced motion `--motion-base` is 0.

Screens: [before AR 1440](ui-rebuild-2026-10-28/see-all-before-ar-1440.png), [after AR 1440](ui-rebuild-2026-10-28/see-all-after-ar-1440.png), [after EN 1280](ui-rebuild-2026-10-28/see-all-after-en-1280.png), [before 390](ui-rebuild-2026-10-28/see-all-before-ar-390.png), [after 390](ui-rebuild-2026-10-28/see-all-after-ar-390.png).

## Home

1440×900, Arabic (English within 40 px), defaults after onboarding:

| | Baseline | Final |
| --- | ---: | ---: |
| First titles (top of first poster) | 1,496 px | **712 px** (inside the first screen) |
| First catalog shelf | 2,230 px | **1,446 px** |
| With a title to continue | session, Continue watching, Taste… | **Continue watching, session, Taste…** |

The design's first target for the shelf (1,300 px) was set before measuring. The folded Taste compass panel (~750 px) keeps it at ~1,450 px; restyling that panel is outside this change. «عرض أوسع» brings back the full builder and preview, and survives a reload. Screens: [before](ui-rebuild-2026-10-28/home-before-ar-1440.png), [after](ui-rebuild-2026-10-28/home-after-ar-1440.png), [after, with history](ui-rebuild-2026-10-28/home-after-ar-1440-history.png).

## Rows (#111)

On the baseline and on the final code alike, each row checked moved 200 px forward and 200 px back with a mouse drag, opened nothing while dragging, and still opened on a short click:

- **Home, Arabic:** the Taste row and both shelves.
- **Home, after a chip replaced the shelf's row:** the same three rows.
- **Discover:** the Taste row and a shelf.
- **Home, English:** the Taste row and both shelves.

The See all grid scrolls vertically with the wheel (900 px) without moving the page underneath. The reporter's exact row is **not reproduced**; the image-drag guard is hardening, not a claimed fix.

## Player menu (#113)

The menu has three items; under the magnet item a note reads «لا يوفّر هذا المصدر ملف تورنت منفصلاً؛ رابط المغناطيس يحمل معرّفه ومتتبّعاته.» / "This source has no separate torrent file; the magnet link carries its hash and trackers." The four-item menu the reporter asked for is **not implemented**: no stream gives Riwaq a separate `.torrent` file, and two items would copy the same magnet. Screen: [menu](ui-rebuild-2026-10-28/menu-after-ar.png).

### Follow-up after 0.53.0: #113 exactly

The owner said #113 was not done as asked, and chose what "Copy torrent link" copies: the address the torrent plays from on this computer. The menu is now **Take a screenshot · Copy torrent link · Copy magnet link · Download video**, and the note is gone. Screens: [Arabic](ui-rebuild-2026-10-28/menu-links-ar.png), [English](ui-rebuild-2026-10-28/menu-links-en.png).

- **Copy torrent link** copies the address MPV plays. `localTorrentLink` (`core/torrent-engine.mjs`) accepts only plain `http:` on 127.0.0.1, localhost or [::1], without credentials, at the origin of the viewer's Stremio Service, the built-in engine or TorrServer (`torrentEngines()`, the list seek previews already used).
- **What it refuses:** debrid and home-server addresses, a loopback address on another port, credentials, `https:`, another host on the engine's port, and an engine that has stopped. With no such address, the item stays in the menu, disabled, with a note tied by `aria-describedby`.
- **How long the link works:** in another player on the same computer, while Riwaq holds the torrent. The built-in engine keeps a released title for 3 minutes. The notice after copying says so. The link is not shareable; the magnet is the one to share.
- **What stays in main:** main writes the clipboard. The renderer only gets a `torrentLink` flag.
- **Results:**
  - `npm test`: 934 pass. That adds `tests/player-menu-links.test.mjs`, which replaces `player-menu-note`, and one more main-menu test in `tests/downloads-quality.test.mjs`.
  - `test-downloads-quality`: 30/30. The four labels are checked in order in Arabic and English, along with the tooltip, the disabled item with its reason, and the keyboard path to the torrent link.
  - `npm run check`, `npm run build` and `npm run build:web` pass.
- **Not run:** a real torrent in Windows MPV with VLC opening the copied address.

## Measurements

`scripts/measure-ui-browse.mjs`, 7 alternating runs per build, same machine, fixture and production web build; medians [min–max]. Coarse harness timings, not Windows startup, FPS or process memory.

| | Baseline | Final | Change |
| --- | --- | --- | ---: |
| Cold load to Home's first shelf titles | 274 ms [262–303] | 302 ms [281–353] | +10.2% |
| Home → Discover | 129 [120–139] | 125 [99–148] | −3% |
| Discover → Home | 134 [118–166] | 136 [108–169] | +1.5% |
| See all open (first card) | 172 [155–193] | 254 [232–284] | +48% |
| Details from See all | 194 [140–243] | 167 [135–188] | −14% |
| Back to See all | 154 [96–211] | 106 [70–118] | −31% |
| Renderer heap after GC | 7.33 MB | 7.46 MB | +1.8% |
| DOM nodes after the journey | 3,518 | 4,093 | +16% |
| Long tasks during the journey | 2 (123 ms) | 1 (56 ms) | |
| Catalog requests during warm navigation | 0 | 0 | |
| Bundle JS / CSS | 2,220,365 / 198,103 B | 2,226,309 / 200,982 B | +0.27% / +1.45% |

Regressions above 10% were investigated:

- **See all +48%.** With poster images blocked, the final page opens faster than the old dialog (210 vs 294 ms median, 7 runs). Hiding the view (`visibility`) and the root overflow lock each changed nothing measurable. The difference is decoding the roughly four times as many posters the wider grid shows in its first screen. That is the content #112 asked for.
- **Cold load +10%.** Over 11 alternating runs it was +8% (289 → 312 ms). With images blocked it was +1.7% (first titles) and +4.7% (first shelf), inside run-to-run noise. Removing `tokens.css` changed nothing (304 vs 305 ms). The rest is the posters Home's first screen now shows.
- **DOM nodes +16%.** The page draws 60 cards (the dialog drew 48) over the mounted Home.

No speed-up is claimed.

## Not verified, and why

- Native Windows: Electron, embedded/separate MPV, HUD, F8, DPI, packaged builds, NSIS. No Windows here. Shared CSS that the HUD loads changed only by additions (`tokens.css` names on `.app`, `.scroll-row img`, `.player-menu .menu-note`), but that is reasoning, not a run.
- HDR/Dolby Vision, GPU shaders, real torrents, live provider accounts, real touch hardware, a screen reader.
- The web smoke's later steps (second-device account sync and after), in this Chromium build. CI must run them.
- Issue screenshots (403 to this session), and the vendors' own pages (refused by the network policy). See the research doc.
- An independent reviewer: subagents were not requested, so the consistency pass against the other full title pages was done by the author. It found hand-written variants of shared rules, which were replaced by the shared ones.
