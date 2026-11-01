# Independent review of PR #128

Reviewed on Windows x64 on 2 November 2026 (Asia/Riyadh). This is an engineering review and owner-review gate, not permission to merge or release.

## 1. Identity and scope

- PR: <https://github.com/ABADIOSA/riwaq/pull/128>
- Branch: `claude/fervent-pasteur-gzqpy4`.
- Original HEAD: `12e700f42e1381273273f4a85deba711f2549dba`.
- Main HEAD and actual merge base: `c6f7fb57f7c14610f29efaaa850a6408751a1445`.
- Corrective implementation: `e6451ff1fce2b8650117bac004494172dca38a5e` (`Fix cache confinement, light contrast and profile window chrome`). The subsequent documentation commit contains this report; the exported report records the final remote HEAD.
- Original scope: seven commits, 57 changed files, including deleted QuickSettings. All changed files were reviewed; supporting ownership, backup/sync, IPC, browser storage, torrent and dependency consumers were followed. Repository instructions and all mandatory references were read. Issue bodies and available comments for #127/#126/#125/#124/#122/#111/#123/#96 were retrieved. The PR had no review comments when reviewed.
- A separate checkout and disposable profiles were used. Version remains 0.53.1; MIT, update keys, notices and production configuration were preserved. No merge, release, deployment, live-account mutation or real-user-data deletion was performed.

## 2. Findings and corrections

Severity here describes engineering impact. Local same-user junction manipulation was not inflated into a remotely exploitable security vulnerability.

| Priority | Location | Root cause and impact | Correction | Evidence |
|---|---|---|---|---|
| P1 | `electron/main.mjs:349` | Child `lstat` checks did not reject a junction at `torrent-cache` itself. A disposable external hash directory was deleted through the parent junction. | Reject a linked/non-directory cache root before enumeration. | `cache-regression-red.log`: sentinel lost before fix; real junction regression passes after fix. |
| P1 | `electron/main.mjs:2924` | Fire-and-forget recursive cleanup could remain in flight after the renderer acquired the torrent engine. A later `torrentHost` check cannot cancel an already submitted `rm`. | Await startup cleanup before BrowserWindow/IPC exposure; retain bounded directory selection and log failures. | New ordering regression failed before fix; startup filesystem tests and native gates pass. Ordering is source-tested, not a simulated real power-loss measurement. |
| P1, supporting pre-existing path | `electron/torrent-engine.mjs:153,241` | Skipping an unsafe root at startup alone still allowed the existing engine to follow it later. A retained hash junction also allowed piece writes outside its intended directory. | Engine rejects root links; pruning uses `lstat` and skips links; piece creation refuses existing linked/non-directory hash paths. | Actual-engine root and hash-junction tests fail before guards and pass afterward; real-swarm torrent tests pass. |
| P2 | `src/scheme-light.css:164` | Details kept literal pale dark-theme description/metadata colors. Against white their contrast was 2.06:1 and 2.11:1. | Use the light palette's muted text for Details only. | Browser assertion failed before fix; both languages pass afterward; Pure White ratio is 6.54:1. Screenshots inspected. This does not certify arbitrary artwork backgrounds or custom palettes. |
| P2 | `electron/main.mjs:2131` | Profile switch applied zoom but did not repaint the hybrid title overlay. A light profile's `#F4F5F7` bar remained on a dark profile expecting `#191C20`. | Repaint native chrome after applying the destination profile. | Actual native reproduction plus failing/passing `title-overlay-profile.test.mjs`; full native profile/theme/restart gate passes. |
| P2 | Both privacy policies, sections 2/7 | Main-process isolation was promised for the web edition too; all torrent services were described as requiring the built-in server's token; broad analytics wording conflicted with optional counts. | Scope desktop and browser guarantees separately; distinguish built-in server, managed TorrServer and configured Stremio Service; clarify optional first-party counts. | Compared with `web/store.js`, bridge, torrent hosts and usage implementation; Arabic and English corrected together. |
| P3 | `UsageSettings.jsx`, English onboarding dictionary | First-run consent pointed to deleted Basic/Appearance locations. | Point to System & diagnostics → Privacy. | Localization/unit/browser suites pass. |
| P3 | `scripts/test-ui-overhaul.mjs` | Discover selected option index 1, which is the external Cinemeta catalog in this environment. The offline test therefore had no grid. | Select the local fixture's real opaque catalog key. Keep scrolling and click-suppression assertions. | Original 16/17; corrected 17/17. |
| P3 | `scripts/test-player-hud.mjs` | Immediate visibility sampling after native input could precede the IPC/React update. First run failed, serialized unchanged run passed. | Await the same required visible audio label. | Final native HUD suite passes. No player behavior was weakened. |

Seven filesystem/engine regressions and one native-overlay regression were added. Existing source-shape assertions were updated to require awaited cleanup. The existing branch received targeted changes; no large redesign or dependency downgrade was introduced.

## 3. Feature acceptance matrix

| Issue | Acceptance evidence | Result and limits |
|---|---|---|
| #127 settings | Actual Electron visits all six rooms and all 44 pages in Arabic and English; web visits all offered pages. Legacy main-version state was sealed with DPAPI, loaded, changed, switched across profiles and restarted. Unit tests cover backup/restore, merge, PIN gates and secret consent. | Local acceptance passes. Retired `settingsMode: advanced` survives. Missing legacy appearance mode renders dark without rewriting the old field. Every changed handler was inspected; external-account buttons were not exercised with real accounts. Private download storage is intentionally retained, rather than implementing the issue's requested `Movies/Riwaq` relocation. |
| #126 light/system | Dark/light/system browser checks, preset/custom-palette units, real Electron nativeTheme transitions, hybrid overlay, profile switch, restart and initial main background; screenshots inspected. | Pass for tested configurations. Fixed Details contrast and profile chrome. Pure White is a generated light palette, not a new separately stored preset. HDR/RTX/display calibration and arbitrary custom contrast remain unverified. |
| #125 gutters | Browser geometry across 1920/1440/980/740/390; browsing suite adds 1280. Native desktop checked at supported sizes, with both languages and 200% browser zoom. | Equal top/side gutters pass. No physical multi-DPI monitor matrix was available. |
| #124 localization | All English settings pages checked for unexpected Arabic; Link Trakt/Simkl/AniList; scanner and complete i18n units; corrected consent route. | Pass for inspected strings. User/addon title text remains in its source language. No screen-reader translation certification. |
| #122 arrows | Home/Discover/See all/series adjacency at 1440/740/390, header/edge choices; real-component carousel tests cover delayed/replaced/empty rows, keyboard, menus, both languages and listener release. | Pass. Reusable code and every changed component inspected; not every catalog/provider was populated live. |
| #111 dragging | See all and Discover grids and vertical row handoff; normal click/click suppression, keyboard, replacement refs and browser touch gesture cases in carousel suite. | Pass for automated mouse/touch events. No physical touchscreen was used. |
| #123 cleanup | Root/child junctions, valid/invalid names, files vs directories, missing roots, retained-cache mode, simulated EPERM deletion, normal real swarm release/close and native ownership tests. | Corrected and passing. Offline downloads remain separate. EPERM is injected deterministically, not a physical disk fault; hostile concurrent same-user link replacement and actual power-loss testing are not claimed. |
| #96 / #113 regressions | TheIntroDB v4/User-Agent units; exact four-item player menu, session/profile ownership, clipboard safety and offline-download native tests. | Pass locally. No live provider-account or public-swarm guarantee. |

## 4. Windows, MPV and packaging

Actual Electron 44.9.3 and the project's SHA-256-verified MPV 0.41.0 ran on Windows x64. The local SDR fixture exercised embedded and separate native windows; Windows SendInput delivered clicks/keys. Tests covered audio/subtitle tracks, seek, speed/held Space, volume memory, pause/reload/Stop, native input without HUD, menu ownership, pending-engine cancellation, offline download/play/delete, profile-delete failure retention and closing while playing. Renderer suspension exercised frozen-HUD fallback and F8 recovery. The SDR file was labeled HDR only to select the separate-window path; this is not real HDR or Dolby Vision verification.

Local NSIS and portable packages built with publishing disabled. Extracted installer and portable contain identical ASARs. All 150 current core/Electron/dist/asset/legal files match source/build bytes, runtime manifest fields match, bundled MPV matches vendor, and Admin is absent. Electron-builder intentionally normalizes package.json, so that file was compared semantically. The final ASAR SHA-256 is `e70504f42a1916d53b1bbb401d7d244180c1ab25cea89554c48e134b8d4fc866`.

Actual portable execution passes fresh onboarding, DPAPI, queue consumption, bundled MPV decoding/native visibility, sibling clipping, and deliberately stalled animation-frame layout. The NSIS wizard's all-users choice is enabled; the test cancels before Install. The isolated signed-update fixture really installed/upgraded/uninstalled its uniquely named test app and preserved encrypted data. No real per-machine/UAC installation was performed. Windows Authenticode remains NotSigned; updater Ed25519 authentication is a separate mechanism. Packages are review artifacts, not published releases. Byte identity across two independently timed NSIS rebuilds is not claimed.

## 5. Commands and results

Host: Windows x64, Node v24.19.0, npm 11.17.0; isolated Playwright 1.58.2 and Chromium 145.0.7632.6. Main uses its own locked dependencies and Electron 44.4.1. Browser/local-service/native profiles are disposable. Counts below are actual tests/checks where a harness reports them; “gate” is not an invented unit-test count.

| Command | Passed / failed / skipped | Evidence |
|---|---|---|
| `npm ci` | Install passes, 465 packages; 19 advisory package nodes | `npm-ci.log` |
| Clean locked reinstall + pinned Electron installer + direct node-datachannel N-API prebuild | Pass | `npm-ci-final.log`, `native-prebuild-final.log`; no lockfile changes |
| `npm test` (main) | 934 / 0 / 0 | `tests-main.log` |
| `npm test` (original PR) | 954 / 0 / 0 | `tests-unsandboxed-original.log` |
| `npm test` (corrected) | 962 / 0 / 0 | `tests-final.log` |
| `npm run check` | Pass | `check-final.log` |
| `npm run build`, `npm run build:web` | Both pass | `build-final.log`, `build-web-final.log`, final package build log |
| `node scripts/test-web.mjs` | 26 / 0 / 0 steps | `test-web-final.log`; real local Worker/SQLite account and usage tests |
| `node scripts/test-ui-browse.mjs` | 39 / 0 / 0 | `test-ui-browse-final.log`; main comparison: 35 baseline-mode checks |
| `node scripts/test-ui-overhaul.mjs` | 17 / 0 / 0 | `test-ui-overhaul-final.log` |
| `node scripts/test-quality-carousels.mjs` | 36 / 0 / 0 named checks | `test-quality-carousels-final.log` |
| `node scripts/test-downloads-quality.mjs` | 30 / 0 / 0 named checks | `test-downloads-quality-final.log` |
| `node scripts/test-hud-keys.mjs` | Gate passes | `test-hud-keys-final.log` |
| `node scripts/test-session-ui.mjs` | 13 / 0 / 0 named checks | `session-ui.log` |
| `node scripts/test-review083-native.mjs` | Native gate passes | `review083-final.log` |
| `node scripts/test-player-hud.mjs` | Five grouped native gates pass | `player-hud-final.log`; main also passes |
| Additional `node ../test-pr128-native.mjs` | Six grouped gates, including 88 page visits, pass | `pr128-native-final.log`, `native-acceptance.json`; work harness retained as evidence |
| `node scripts/test-torrserver.mjs .cache/qa-binaries/TorrServer.exe` | Local swarm gate passes | `torrserver.log`; pinned size/digest verified first |
| `npm run package` | NSIS + portable pass | `package-final3.log` |
| `node scripts/test-packaged.mjs release/Riwaq-0.53.1-win-x64.exe --offline --stall-layout` | 11 grouped checks pass | `portable-final.log` |
| `node scripts/test-installer-options.mjs release/Riwaq-Setup-0.53.1-win-x64.exe` | Pass; installed=false | `installer-options.log` |
| `node scripts/test-upgrade.mjs` | Actual isolated upgrade passes | `upgrade.log` |
| `node ../verify-package-bytes.mjs` | 150 files per artifact, manifest/MPV/Admin checks pass | `package-verification.json` |
| `npm audit --json` | 19 nodes: 4 high, 15 moderate; no critical | `audit-final.json` |
| `node scripts/test-admin.mjs` | Fails in both main and PR | `admin-main.log`, `admin-native.log`: hardcoded `codex/` workspace expectation |
| `node scripts/test-music-ui.mjs` | Fails in both main and PR | `music-main.log`, `music-ui.log`: obsolete masthead navigation selector |
| `RIWAQ_SMOKE=1` with fresh `RIWAQ_DATA_DIR` (actual process exit awaited) | Fails at stale prerequisite in both main and PR | `smoke-final-stderr.log`, `smoke-main-stderr.log`: `Timeout: live catalogs`; predicate requires `.hero` although showcase defaults off, and the failure screenshot still shows first-run setup. Local deterministic native gates above pass. |

The first restricted-sandbox test run could not use local networking; it was stopped and superseded by unrestricted passes. A native-module rebuild collided with that old process's loaded binary, then entered an upstream source-build fallback. The final environment was restored with a clean locked install and direct pinned prebuild, avoiding those extra build dependencies. Initial native-gate harness failures (legacy null/absent appearance, lazy settings, Playwright's default media emulation, and the not-yet-navigated HUD) were corrected without changing the application's contracts.

Live-account/deployment/publication scripts were deliberately not run. Admin packaging is outside this viewer PR; public package exclusion was checked instead. No skipped test is counted as passed. Existing build warnings about a large chunk and Node crypto externalization remain.

## 6. Security and privacy

The immutable original-PR diff scan completed with all 57 changed files accounted for (44 source inventory items plus docs/tests/lockfile) and zero reportable exploit findings. This is not proof that no vulnerability exists. The confirmed cache data-safety issues above remain in this engineering report even though no lower-privilege/remote exploit was established. Corrective code received an independent follow-up review.

IPC sender/main-frame checks, HUD allowlists, renderer isolation, fixed privacy service IDs, loopback/media-token controls, signed updates, backup authentication, profile/PIN checks and account/usage consent paths were retained. Clipboard menu tests confirm direct Debrid/private-server URLs are not copied. Browser backup/account tests exercise the real local Worker and encrypted stores, not production users.

The fresh audit's 19 affected package nodes trace to two advisory roots:

- [`ip` classification advisory](https://github.com/advisories/GHSA-2p57-rm9w-gvfp): upstream lists no patched version. The installed tracker consumer uses `ip.toString`, not vulnerable `isPublic`; no demonstrated call path reaches the named flaw. WebTorrent is unchanged from main. A separate utility process does not itself establish filesystem/network sandboxing.
- [`minimatch` glob-parts amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249): patched in 11.0.1, while the installed build-tool chains use older major APIs. These are build-time dependencies with repository-controlled patterns. No safe in-range replacement was offered; forcing 11 across incompatible consumers or downgrading electron-builder was not justified.

The [Electron 44.9.3 release](https://github.com/electron/electron/releases/tag/v44.9.3) and [Vite 8.3.5 release](https://github.com/vitejs/vite/releases/tag/v8.3.5) were checked against official upstream records. Locked versions, native execution, packaging and updater compatibility were independently exercised; no additional dependency upgrade was made.

Owner confirmation remains necessary for legal operator identity/jurisdiction, private contact and any compliance assertion. Policies make no compliance claim. Cloudflare retention/configuration was source-reviewed, not audited in production. Canonical in-app policy URLs target main; the new pages become available there after merge. Fixed destinations and local policy content were checked, not their pre-merge publication.

## 7. Performance, stress and visual evidence

`measure-ui-browse.mjs ../riwaq-main/dist-web dist-web 5` alternates five runs per build against one local fixture. These are headless browsing timings, not native FPS or whole-app startup claims. Ranges overlap and do not establish a meaningful performance regression or improvement. No measured journey had a median long task. Final medians (full ranges/raw samples in `performance.json`):

| Measure | Main | Corrected PR |
|---|---:|---:|
| Cold page reload to titles | 234 ms | 237 ms |
| Discover | 61 ms | 70 ms |
| Home | 104 ms | 103 ms |
| See all | 153 ms | 157 ms |
| Details | 76 ms | 73 ms |
| Back | 72 ms | 68 ms |
| Renderer heap after collection | 7,409,436 bytes | 7,447,788 bytes |
| DOM nodes | 4,312 | 4,312 |
| JS / CSS bytes | 2,229,554 / 200,982 | 2,245,999 / 211,813 |

The native stress harness exercises 12 complete local SDR sessions, six starts canceled immediately, 30 navigation changes and ten settings reopens; it checks that no owned MPV process remains. Immediate cancellation returns the existing “could not connect to player” error in both main and PR even though Stop prevents late playback. This is a pre-existing P2 follow-up, not a passing cancellation-result contract. Main-process RSS samples and session timings are retained; they do not establish absence of a memory leak or performance improvement.

All 12 normal sessions and resource-cleanup assertions pass on both builds. Main RSS was 137,297,920 → 134,807,552 bytes; PR was 137,756,672 → 137,572,352 bytes. Both ended with zero owned MPV processes. Each returned six connection-error replies for the six immediate cancellations. The baseline harness explicitly enters its old Advanced settings panel; the PR has the unified rooms.

Screenshots were captured at desktop/compact/phone widths in both languages, with zoom/reduced-motion checks. Main/PR dark Home/Details/See all comparisons and light Home/Details/Settings/Library/See all, connection, privacy and arrow screenshots were visually inspected. The Details contrast defect was found by that inspection rather than geometry assertions alone. Fixture art/text differs from live providers. Physical multi-monitor scaling, real screen-reader use, real HDR/Dolby Vision/RTX/GPU shader output, provider credentials and public-peer availability remain unverified.

## 8. Remaining work and verdict

| Priority | Remaining item | Next action |
|---|---|---|
| P2, pre-existing | Immediate playback cancellation can reject with a connection error despite safe cleanup, on main and PR. | Separate player-lifecycle fix with a deliberate canceled-result contract. No late playback or owned MPV leak was observed. |
| P3, pre-existing test infrastructure | Admin branch-name and music navigation smoke assumptions are stale on both branches. | Repair those harnesses in their own scope; retain current failures as evidence. |
| P3, pre-existing test infrastructure | Legacy native smoke requires a default-disabled hero and leaves fresh onboarding open; main and PR time out at that predicate. | Modernize its setup/prerequisites; do not count it as a native smoke pass or infer a catalog-service outage from this timeout. Offline fixture-based native/portable gates provide the local evidence. |
| Non-blocking verification limit | Hardware-specific output, physical touch/accessibility, multi-monitor DPI and real provider accounts. | Owner/device-specific acceptance before claiming those configurations. |
| Owner/policy | Identity, jurisdiction, private contact; new main policy URLs publish only after merge. | Owner confirmation and publication check; no invented legal promises. |
| Dependency maintenance | Two advisory roots remain, with reachability/compatibility limits above. | Track upstream compatible fixes; do not apply audit-force downgrades. |

**READY FOR OWNER REVIEW**, with these non-blocking limitations. No known fixable P0/P1 from this review remains. This does not label every hardware/provider configuration fully verified and is not approval to merge or publish. Final merge and release decisions remain with the owner. Latest commit and CI state are recorded in the exported report and PR review summary.
