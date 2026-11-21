# PR #155 — remediation after Codex's independent review

Codex reviewed PR #155 at head `98c3088` (base `3e9945f`) on Windows x64
and returned **NO-GO** for merge and for a Windows beta: two P1 findings
(F1, F2), seven P2 (F3–F9), one P3 (F10), security notes and open
acceptance items (#147, #149, #153, #154). This record is the answer: what
each finding was, why it happened, what changed, which test now holds it,
and what remains unverified. It is the author's account, not a verdict:
the GO/NO-GO decision stays with the next independent review.

- Same branch, same PR: `claude/loving-noether-3jcr1i`, new commits on top
  of `98c3088`, no force push, no history rewrite. Nothing merged, tagged,
  versioned (still 0.55.0) or published. The PR stays a draft.
- Environment for everything below: Linux container, Node 22.23.5 (the repo
  asks for 24; Codex used 24.19.0), the pre-installed Chromium through
  Playwright. **No Windows, Electron, MPV or real hardware here.**
- The review's evidence (`Riwaq-PR155-Review-AR.md`,
  `Riwaq-PR155-Evidence.zip`) was read in full and its harnesses and logs
  were used to find the causes; none of it is committed.

## Before and after

Every new test was also run against the original head `98c3088` (a
worktree with the new test files copied in) to show it catches the defect:

- `node --test tests/review-pr155-*.test.mjs` on `98c3088`: **1 of 25
  collection/source tests pass** (the one about keeping the list's order,
  which was never broken); the profile and artwork files fail at import
  because the profile-bound APIs did not exist. Here: **all pass**.
- `node scripts/test-ui-review155.mjs` against `98c3088`'s builds: **2/17**
  (the GIF control, and the FR switch check, which passes there only
  because the old build fetches the unpinned `main/` address this script
  does not serve; the unit test covers that path). Here: **17/17**.

## Findings

| Finding                                                                        | Root cause                                                                                                                                                                                                                                                                                                                                                                          | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Regression test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **F1 · P1** Replace emptied the list after a valid preview                     | A Nuvio collection (or folder) without an ID got `newId()` (random) in `cleanCollection`. The renderer's preview and main's import each parsed the text, so the IDs the viewer ticked never matched; `importCollections` then cleared everything for Replace and added nothing.                                                                                                     | `fromNuvio` gives every entry a deterministic ID (its own, or `nuvio-x` + `stableHash(place, title)`), and numbers repeated IDs (`-2`, `-3`) instead of silently dropping the second. `importCollections` refuses, before touching anything, an import whose chosen set is empty, or whose `only` names IDs the file no longer has ("the file changed since the preview"). The preview notes repeated IDs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `tests/review-pr155-collections.test.mjs` (F1 ×8: same IDs in preview and commit, Replace replaces, empty/stale/missing choice refused with state unchanged, invalid/empty/non-list files, duplicate IDs, repeat import, counts/names/folders/sources after Replace); Chromium F1 (Replace through the paste dialog; no choice disables the button)                                                                                                                                                                            |
| **F2 · P1** Work started in profile A landed in profile B                      | Three renderer paths finished after `await`/timers and wrote with `settings`, which writes to whichever profile is active: Undo restored A's filters from a ref the page kept; an FR style was computed from A's settings captured at click time; the Remember debounce saved after a switch or after Remember was turned off. Nothing in main knew which profile the work was for. | The boundary is now in core, where the state is written: `client.sameProfile(profileId)` and `PROFILE_CHANGED`. `settings` accepts `profileId` and refuses a mismatch; a `sourceFacets` save arriving after Remember went off is dropped. Filter delete/Undo moved into main (`streamFilterEdit`): both work on the profile's list as it is now, the deleted filter waits per profile, Undo once. FR styles are fetched and applied in main (`badgeStyleApply`, `applyBadgeStyle`): the active profile is checked again when the file arrives and the patch is built from that profile's rules then. The picture picker checks the profile again when the dialog closes (`collectionArtPick`), and `collectionsEdit` accepts `profileId`. Found on the way, same pattern: the Nuvio Desktop import (`importNuvio`) awaits each addon install and then wrote collections, library and plugins to whichever profile was active; it now refuses those parts after a switch (installed addons are shared and stay). The renderer passes the profile with each, cancels the Remember timer on unmount or when Remember goes off. | `tests/review-pr155-profiles.test.mjs` (Undo after switch, after leaving Settings, without a profile; FR finishing or failing after a switch; FR building on rules added during the download; Remember after a switch and after it went off; rapid switches with work from both profiles; settings without a profile unchanged); `tests/nuvio.test.mjs` (a switch during the addon installs); Chromium F2 ×3 (the reviewer's three flows through the interface; B's filters, look, rules and facets compared before and after) |
| **F3 · P2** Merge and template update dropped local data                       | A merged folder was replaced whole by the file's folder, which has no hand-picked titles and null for local pictures (`toNuvio` writes null). Adding a template again went through the same merge. Pictures losing their reference could then be swept.                                                                                                                             | Explicit merge rules (`mergeFolder`, `mergeCollection`): the file's sources, name, shape and switches win; a picture or emoji the file does not carry keeps the viewer's; hand-picked titles and template markers stay. Templates have their own policy (`applyTemplate`): the viewer's name, emoji, pictures, pin and view stay; a template folder whose queries the viewer never changed (digest `tpl`) follows the template, an edited one keeps the edits; a folder removed by the viewer stays removed (`tplFolders`), a new template folder is added.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | F3 ×4 (re-merging an export keeps local pictures and titles; file values win where present; template update keeps cover, pin, picked titles and a removed query; pictures still referenced, so the sweep keeps them)                                                                                                                                                                                                                                                                                                           |
| **F4 · P2** Advanced filters missing with 1–4 sources                          | The facets were inside the `shown.length > 4 \|\| narrowing` block meant for the search box.                                                                                                                                                                                                                                                                                        | The search and chips keep their threshold; `SourceFacets` sits outside it and shows whenever the panel has something to tell apart or a remembered filter is on. An empty tools row takes no space.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `tests/review-pr155-sources.test.mjs` F4; Chromium F4 (three sources: panel there, search absent, a facet narrows and clears)                                                                                                                                                                                                                                                                                                                                                                                                  |
| **F5 · P2** Explicit facts misread                                             | `parseDebrid` matched "cached" inside "Not cached"; `DTS:X` (colon) did not match the DTS:X pattern and fell to plain DTS; channels used `startsWith("5.")`; the public stream dropped `description` whenever a `title` existed, and facets read only name + title; every language but ar/en became "other".                                                                        | Negation first and a third state (`uncached`: said not cached; `debrid`: says neither); `DTS:X` read as DTS:X (engine and channels); exact layouts 7.1/7.0/5.1/5.0/2.1/2.0; `description` kept (≤ 600 chars) and read by facets, search and badge rules; each recognised language its own value ("French mentioned"; "mentioned" because a name may be audio or subtitles).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | F5 ×6 through `Client.getStreams` (cache states incl. Arabic, layouts, DTS family, description facts, languages, order kept); Chromium F5 (panel counts in English)                                                                                                                                                                                                                                                                                                                                                            |
| **F6 · P2** FR replaced the viewer's 4K picture; Off kept FR's badges          | `chooseFrStyle` merged FR's pictures into the viewer's `badgeArt` (overwriting theirs) and leaving the style removed FR-looking pictures from that same field. Off (`badgesOn: false`) only stopped built-in chips; rule badges, FR's included, still drew.                                                                                                                         | FR's pictures live in their own field `badgeStyleArt` (validated, FR origin only); the chip uses the viewer's first, then the style's (`chipPictures`). With badges off, core does not try FR rules and the page hides any FR badge (`visibleBadges`); the viewer's own rules stay, as the option's text says.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | F6 unit (Riwaq → Liquid → FR → Minimal → Off → Riwaq keeps the 4K picture; Off hides FR, keeps own); Chromium F6 (custom picture drawn under FR Frost, kept through every look, no FR badge under Off, own rule shown)                                                                                                                                                                                                                                                                                                         |
| **F7 · P2** Round trip copied, dropped and over-reported                       | Export wrote Riwaq IDs as-is and import prefixed `nuvio-`; `showAllTab` was always true; folders with only a look were filtered out; the report counted the whole file and unsupported sources past the folder limit as kept.                                                                                                                                                       | Export writes `riwaq-<id>` for Riwaq's own IDs and strips `nuvio-` from Nuvio's; import maps both back. `showAll` kept when off. Folders with only pictures or an emoji are exported. The report is computed from the chosen collections and what was written (`folders`, `skippedSources`), unsupported sources past the limit count as over, per-collection over-limits.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | F7 ×3 (export/merge updates in place, All tab and cover-only folders, report for a chosen subset and the 41st unsupported source)                                                                                                                                                                                                                                                                                                                                                                                              |
| **F8 · P2** A GIF moved in a still slot; folder page ignored backdrop and logo | Still slots were plain `<img>`/CSS backgrounds, which animate a GIF whatever the motion setting; the picker accepted any image in any slot; `FolderPage` drew `folder.cover` as a CSS background (no local-picture lookup, no backdrop, no logo).                                                                                                                                   | `StillImage`: a picture that may move (GIF/WebP by name or type, or a web-edition local picture) is drawn once into a canvas (the first frame, by the canvas rule for animated images), others stay `<img>`; used for every still slot (card cover, collection hero and logo, folder logo, face, folder page). The picker names its slot; a still slot refuses a multi-frame GIF, APNG or animated WebP (`isAnimated`, read from the bytes) with a sentence. The folder page uses `useArt(backdrop \|\| cover)` and shows the title logo. Probe images are released on unmount.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `tests/review-pr155-art.test.mjs` (frame counting on real two-frame GIF/APNG/WebP from Pillow, still slot refuses and keeps nothing, wiring); Chromium F8 ×5 (still slot unchanged across frames with Reduced Motion off and on; control: the same GIF does move in the moving slot; real file chooser: refused for still, kept for moving, after a reload served from IndexedDB; one-frame GIF accepted as still; folder page backdrop and logo)                                                                              |
| **F9 · P2** Template queries not editable; success shown at the limit          | The editor could only remove a TMDB source; the template path never threw at 60 collections, so the page announced success.                                                                                                                                                                                                                                                         | `tmdbUpdate` in `editCollections` (validated; a value the rules would drop is refused by name, `tmdbFilterProblems`; duplicates refused); `DiscoverForm` edits name, films/series, order, genres (all or any), keywords and exclusions, year, date range, last N days, least votes and rating, language and country, keeping fields it does not show; a new discover query can be added. `applyTemplate` throws at the limit, so no success toast.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | F9 unit (every discover query of all eight templates edited in place, others untouched; invalid values named, nothing changed; limit refused); Chromium F9 ×2 (form edit saved and a bad value refused by name; at 60 collections the template is refused and no "added" toast)                                                                                                                                                                                                                                                |
| **F10 · P3** 15 px strip at 390 px in Arabic                                   | The lock's gutter margin (#149) lines the title page and See all up with a sidebar shifted by the scrollbar width. Below 761 px there is no sidebar (it is in the drawer), so in RTL the margin left the strip empty; in LTR the margin side has no scrollbar. Present on main too.                                                                                                 | The margin applies only beside a sidebar: `min(gutter, var(--nav-width) * 1000)`, 0 when `--nav-width` is 0.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Chromium F10 ar/en at 390/768/1024/1440 for both layers: no sidebar → both edges; RTL → left edge and the sidebar's edge; LTR → right edge and the sidebar's edge; masthead at the edge (results in `.cache/ui-review155/f10-*.json`)                                                                                                                                                                                                                                                                                          |

## Acceptance items Codex left open

- **#147 (PARTIAL → addressed):** the 800 ms suppression after any bar
  change is gone. `useVolumeOsd` tells the bar's changes apart by the
  values the bar sent; keys and the wheel mark themselves. The theater
  fallback draws the level too, in its controls row (HTML cannot paint over
  Windows' native picture in the main window). Chromium (HUD over a stub
  bridge): the slider's own change shows nothing; a key 100 ms later
  shows; rapid keys show one level following the last value; a mute key
  shows, the bar's mute button does not. **Not run:** the native HUD over
  real MPV, MPV's own window in separate-window HDR mode, and the theater
  in full screen without the HUD (MPV's controller has no level there).
- **#149:** F10 above; plus Codex's request to measure both edges in
  narrow RTL (done for 390–1440, ar/en, title page and See all).
- **#153:** the delete/Undo defect is F2. The tester's comment asking to
  merge Stream filters into Source preferences is **not** part of this PR
  (no comment shows it was accepted into its scope); it stays an open
  follow-up for the owner to schedule.
- **#154:** F2, F4, F5 above. Facets remain view-only (never the ranked
  list, autoplay or failover).

## Security hardening

| Surface                   | What was done                                                                                                                                                                                                                                                                                                                                                                                             | Tested                                                                                                                                                                                                           | Still open                                                                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local artwork ownership   | `collectionArt` answers only if the active profile's collections name the picture, or it picked it within the grace period (`canReadArt`, `notePickedArt`); knowing an ID is not enough. The picker re-checks the profile after the dialog and the library lock.                                                                                                                                          | `review-pr155-art` (two profiles, picks, malformed IDs); Chromium (B cannot read A's picture by ID)                                                                                                              | The store itself is shared; ownership is by reference. A profile that references another's ID (e.g. via a shared backup) can read it, by design. |
| Files on disk             | `readArtFile`: `lstat` refuses links and non-files, opens once (with `O_NOFOLLOW` where defined), checks size and type on the handle, reads from it. The store finds, lists and reads only regular files.                                                                                                                                                                                                 | real filesystem, symlink case (skipped with its reason where links cannot be created)                                                                                                                            | NTFS reparse points/junctions on a real Windows volume; a local attacker who can write `userData` is outside app-level control.                  |
| Sweep races               | The sweep re-reads references just before each delete (a restore or re-link during the sweep keeps its file); a pick schedules a sweep after the grace period.                                                                                                                                                                                                                                            | `review-pr155-art` (reference appearing during the sweep)                                                                                                                                                        | Restore and sweep on Windows with real timing.                                                                                                   |
| FR-Badges                 | Pinned commit `3fae65b6…3901` instead of `main`; size and SHA-256 per file; one URL per look; `redirect: "error"`, no credentials, 15 s, text/JSON only, streamed and cut at 512 KiB; pictures pinned to the same commit, anything outside the repository dropped. The three live files were fetched through it here (195 rules + 24 pictures each, every picture pinned, two picture URLs answered 200). | `review-pr155-profiles` (foreign URL, wrong bytes, oversized header, endless body, HTML, 404, redirect options, a cut-off body, the right size with wrong bytes); `test-ui-beta` now serves the real pinned file | A future FR-Badges update needs a reviewed change of the pin. Regex cost per rule stays bounded as before (400 characters, 1.5 s per load).      |
| Unsupported Nuvio sources | `plainCopy` drops fields named like keys, tokens, passwords or sessions, and URLs with user info or credential-like query keys, before they reach backups or accounts.                                                                                                                                                                                                                                    | `review-pr155-art`                                                                                                                                                                                               | Field names it does not recognise.                                                                                                               |
| IPC                       | New methods `streamFilterEdit` and `badgeStyleApply` replace `badgeStyleFetch`; both are main-window methods answered in the web bridge; no address comes from the renderer.                                                                                                                                                                                                                              | `settings-wiring`, `web-edition`, `beta-2026-11`                                                                                                                                                                 | —                                                                                                                                                |

## Test gaps Codex reported

- **`npm test` EPERM on Windows.** Two cases in
  `tests/torrent-cache-links.test.mjs` create a _file_ symbolic link,
  which Windows allows only with Developer Mode or an elevated token. The
  failure happened after the local swarm had started and left it running,
  which is why the whole run hung. Now: the fixture destroys the seeder if
  setup throws, and those two cases probe the right first and are skipped
  with that reason when it is missing. Their assertions are unchanged and
  run wherever links can be created (they ran here). Junction cases need
  no right and still run. `review083.test.mjs` and `subtitles.test.mjs`
  failing at file level in Codex's force-exit run did not repeat there or
  here; not reproduced.
- **`test-player-hud.mjs` first-run failure** ("title click preserves
  paused playback"). Not reproducible without Windows. The check read the
  state at once after the click without first settling the paused state.
  It now waits for "paused" as a named precondition, then checks again
  past the stage's click delay (230 ms). A rerun on Windows will say
  whether the pause was lost before the click (a late Space tap from the
  hold section is the most likely candidate) or by it. The source is not
  changed on a guess.

## Verification here

See VERIFICATION.md (2026-11-18) for commands and counts.

## Not verified

Windows, Electron 44, MPV 0.41 and the native HUD; NTFS and DPAPI; the
packaged app and installers; the native picture dialog; live FR-Badges in
the app (the files were fetched from the pinned commit through the new
fetcher here, not through a running Riwaq); live TMDB, including the
"Based on" keyword IDs 818, 9672, 9717 and 41645, which remain
**unverified** community values; screen readers, touch, forced colours on
real displays; real-hardware performance.

---

# Third pass — Codex's second review (2026-11-18)

Codex re-reviewed at `b9d946e` on Windows x64 (Node 24.19.0) and returned
**NO-GO** again: F4 and F10 fixed; F1, F2, F3, F5–F9 partial; ten new
findings R1–R10. This pass answers them on the same branch, new commits on
top of `b9d946e`, no force push. It also covers the Cloudflare audit the
owner asked for (docs/CLOUDFLARE-DATABASE-AUDIT-2026-11-18.md). The
decision stays with the next independent review.

The review's evidence (`Riwaq-PR155-Second-Review-AR.md`,
`Riwaq-PR155-Second-Evidence.zip`) was read in full and extracted outside
the repository. Its harnesses were read before use; the collections
contract (`check-collections.mjs`, in-memory) and the source fixtures were
run against this tree; nothing from it is committed. Its cases are now
permanent tests (`tests/review-pr155-round2.test.mjs`, 32;
`scripts/test-ui-review155-round2.mjs`, 8 in Chromium).

## Before and after

- `scripts/test-ui-review155-round2.mjs` against `b9d946e`'s build:
  **1/8** (only the control that proves the APNG fixture animates), with
  React #300 page errors; here **8/8**, no page errors.
- Codex's `check-collections.mjs` on this tree: 15 of 16. The one left is
  the harness's own expectation that Add returns quietly for a malformed
  keyword; Add now throws the same named refusal as Update (`fields:
  ["withKeywords"]`), which is what R9 asked for.
- `tests/accounts-integrity.test.mjs` against the previous Worker: CF1 ×2,
  CF2 ×3, CF4 and the plan check fail; here all pass.

## R1–R10

| ID | Cause | Change | Test |
| --- | --- | --- | --- |
| **R1 · P2** an open folder deleted by a state update blanked the app | `useArt` (two hooks) ran after `if (!folder) return …`, so the render after the folder vanished had fewer hooks: React #300. | Every hook of `FolderPage` runs before its "folder is gone" page, with optional values. That page keeps its Back button. | Chromium R1 ×2 (folder removed; its whole collection removed) through the real state event path, no React error; unit check that no hook follows the early return. |
| **R2 · P2** a saved `nuvio-riwaq-curated` came back as `curated` and was merged as a copy | Export stripped `nuvio-` and import read the remaining `riwaq-` as Riwaq's own namespace: the mapping was not reversible. | `exportId` writes the Nuvio form only when `nuvioId` reads it back to the same ID, otherwise `riwaq-<stored ID>`, which reads back whole. `nuvioId(exportId(id)) === id` for every stored ID. | Property test over native, imported, nested and long IDs (collections and folders); merge/Replace idempotent for the legacy ID. |
| **R3 · P2** a slow FR download replaced a newer choice | Only the profile was checked when the file arrived; the page's `busy` lived and died with the page. | Every choice takes the next number (`badgeChoice`): `settings` with `badgeLook`/`badgesOn` (Riwaq, Liquid Glass, Off) counts, and so does each FR download; a download that finishes after a newer choice throws `LOOK_SUPERSEDED` and writes nothing; the page does not show it as an error. Also bound to the activation (F2). | Frost→Glass with Glass first; Frost pending → page closed → Off; Minimal pending → Liquid; failure then success. |
| **R4 · P2** Update brought back a folder removed from a template added before `tplFolders` | Without the marker, "known" was the folders present now, so a removed one looked new. | A legacy instance counts every template folder without `since` as known; folders a template gains later carry `since` and come in. Unstamped folders whose queries still equal the template's are stamped and follow it from now on; edited ones stay the viewer's. The marker is written on that update. | Legacy fixture: the removed folder stays out on two updates; untouched folder stamped, edited one kept, a `since` folder added. |
| **R5 · P2** "No English subs", «بدون ترجمة عربية», "English subtitles", "Not  cached" and a plain "Not cached" link misread | No negation handling; `[-\s]?` allowed one space only; the English-subtitles pattern stopped at "sub"; "not cached" alone made a source Debrid. | `affirms(text, rx)`: a match right after no/without/w/o/non/sans/بدون/بلا/من غير/غير (optionally "subs"/"ترجمة") does not count; used for Arabic subtitles and dubs, the Arabic hint, language words and English subtitles. `[-\s]*` in "not cached". Cache words make a source Debrid only beside a Debrid sign (mark, name or ⚡). | The reviewer's fixtures through `Client.getStreams` and the facets (cached, uncached, unconfirmed, direct, enSub, arSub, unknown), plus DTS:X, 5.0 and TrueHD kept. |
| **R6 · P2** repeats squeezed out a unique source; the report named sources of folders left out | Duplicates counted against the 40-source limit before `cleanCollections` removed them; the client filtered unsupported rows by collection only. | `fromNuvio` drops a repeat before the limit (`report.repeated`); `importCollections` reports the folders it actually wrote (`report.written`), and the client lists unsupported sources of those only. | 40 repeats + 1 unique; a merge at the folder limit reporting only the kept folder. |
| **R7 · P2** a remote APNG named `.png` moved in a still slot under Reduced Motion | `StillImage` used a canvas only for GIF/WebP by name or type. | Every picture but a JPEG (by name or data type) is drawn as its first frame on a canvas (`surelyStill`), whatever its name or host. | Chromium R7: the reviewer's two-frame APNG at `cover.png` stays one fingerprint over six captures with and without Reduced Motion; control: the same file animates in an `<img>`. |
| **R8 · P3** a broken logo hid a sibling's good one | `logoBroken` was a flag in a component reused across folders. | The failed address is kept, not a flag (`brokenLogo === logo`), on the folder page and the folder tile; a late error from the old logo cannot hide the new one. | Chromium R8: broken → sibling with a good logo shows it → back shows the name. |
| **R9 · P2** separator-only lists, fractional years, impossible or reversed dates accepted; Add dropped a bad keyword silently | The ID pattern was a character class; numbers were range-checked only; dates by shape; Add skipped `tmdbFilterProblems`. | Lists are numbers joined by `,`/`|` (a trailing separator is tidied); year, votes and days are whole; dates are real days; "from" after "to" is refused for dates, rating and runtime. Add and Update share `checkedTmdb`; the error carries `fields`. The form runs the same check, marks the fields (`aria-invalid`), names them in a sentence, keeps what was typed and sends nothing. | Every case refused by Add and Update with the same fields, state unchanged; valid values saved identically; Chromium R9 (named fields, `aria-invalid`, nothing saved, then a valid save). |
| **R10 · P2** a failed Replace could be written by a later save | The state was replaced before `persist`; a throwing writer left memory changed, and the next unrelated save wrote it. | `client.commit(keys, change)`: on a failed save the named parts go back (memory and bucket) before the error is thrown. Used by Replace and every collection import, collection edits and templates, `settings`, badge styles and the Nuvio Desktop import's profile parts. | Failed Replace (twice) → memory, next save, a restart and the backup payload hold the old collections; failed edit, template and settings; pictures still readable; the other profile untouched. |

## F1–F10 after this pass

- **F1** the remaining gap (paste Replace not bound to its preview's owner, R10) is closed: the preview carries `profileSession` and the import is transactional.
- **F2** activations, not only IDs: `Profiles.epoch` advances on every switch (even back), re-lock, removal of the active profile and restore; `profiles.session()` reaches the page; `claim`/`holds` check it at the start and after every await, with the Settings or library lock re-checked at the write. Covered: Remember, Undo (kept per activation), FR styles, the Nuvio Desktop import (also re-checks the Settings lock), the paste import, picture picks (grant at commit, removed if refused) and reads (re-checked after the disk read). An earlier test that expected B's FR download to land after five A↔B round trips now expects it refused; that is the change the review asked for.
- **F3** R4 above; merge rules unchanged.
- **F5** R5 above. Not done: live addon wording beyond the fixtures.
- **F6** R3 above. The Off option's short title is unchanged (its description says what it keeps).
- **F7** R2 and R6 above.
- **F8** R7 and R8 above.
- **F9** R9 above. The four "Based on" keyword IDs stay unverified (no TMDB here).
- **F4, F10** untouched; their checks still pass (ui-review155 F4, F10 ar/en).

## Artwork ownership and the sweep

- Picks: `collectionArtPick` claims the activation before the dialog and checks it (and the library lock) after the dialog, after the read and at the grant; a pick that lost its activation is deleted at once (`ArtStore.forget`). `canReadArt` requires the pick's activation.
- Reads: `collectionArt` checks the activation and lock again after the disk/IndexedDB read and before answering.
- Caches: the renderer's `localCache` is cleared per activation (`forgetLocalArt` on `profiles.session`); the web's object URLs are revoked on profile switch, lock and deletion (`forgetArtUrls`).
- Sweep: the backend's `remove(id, guard)` runs the last reference check in the same turn as the irreversible step (`unlinkSync` on the desktop; the IndexedDB delete request on the web). References are written synchronously by the client, so nothing can name a picture between that check and its removal. Sweeps run one after another.
- Not proven here: NTFS reparse points in the parent folders and a writable-directory swap (Windows only); no cross-profile read was ever demonstrated, before or after.

## Cloudflare

See docs/CLOUDFLARE-DATABASE-AUDIT-2026-11-18.md: inventory, CF1–CF5 (two P2), fixes in `server/accounts/`, measurements, and the deployment steps that wait for the owner. Nothing was changed on the live account.

## Not verified in this pass

Windows, Electron, MPV, the native HUD and picture dialog, NTFS, DPAPI, packaging and upgrade (none here; Codex's Windows runs were at `b9d946e`). Node 24 (the container has 22.23.5; running a downloaded Node 24 was not permitted). Live TMDB, live addons, live FR-Badges pictures in the app. The Worker on Cloudflare's edge and a remote D1 (only workerd + local D1 here).

# Fourth pass — Codex's third review (2026-11-18)

Codex re-reviewed at `72e2ffc` on Windows x64 (Node 24.19.0) and returned
**NO-GO** for the code merge, the Cloudflare deployment, the merge action
and a Windows beta: one P1 (N1), seven P2 (N2–N7, N9, N12), three P3 (N8,
N10, N11); CF1 and CF2 still partial; the merge would deploy production.
This pass answers them on the same branch, new commits on top of
`72e2ffc` (`5604436`…), no force push, nothing merged, tagged, versioned
(still 0.55.0) or published, PR still a draft. It is the author's account;
the decision stays with the next independent review.

- Environment: Linux container, **Node 24.22.3** (`/opt/node24`; earlier
  passes had 22), Playwright's Chromium 157.0.8103.78, Wrangler 4.141.0 with
  workerd 2026-09-25 installed outside the repository. No Windows,
  Electron, MPV, NTFS or DPAPI here.
- The review (`Riwaq-PR155-Third-Review-AR.md`) and its evidence
  (`Riwaq-PR155-Third-Evidence.zip`, 187 entries, paths checked before
  extraction) were read in full and kept outside the repository. Its
  harnesses were read before use and run against disposable stores only;
  their exit code 0 records observations, so their JSON was read, not the
  exit code.

## Reproduced before changing anything

- **N1**: Codex's `check-web-persistence.mjs` on `72e2ffc`'s build, in
  Chromium 157: the aborted vault write answered `replyCount: 1`, the
  reload showed the old collection, an unrelated language save made the
  refused Replace durable, and the sweep deleted the aged picture
  (`imageDelivered: false`) — exactly the review's JSON.
- **N9, N3, N4, N5, N6, N11**: the reviewer's fixtures are the tests below;
  each failed (or could not run, a missing export) on `72e2ffc`.
- **Web smoke**: the masthead overlap reproduced here with a fixed clock
  (below); it depends on the hour, which is why it looked intermittent.

## N1–N12

| ID | Cause | Change | Test |
| --- | --- | --- | --- |
| N1 P1 | `web/store.js` queued each save, swallowed every failure (`catch → failed = true`) and returned nothing, so `Client.commit` saw success and kept the change in memory; the next save wrote it. The bridge swept pictures right after the synchronous call, from memory. A manual abort rejected with `null`. | `core/durable.mjs`: one write at a time from a snapshot taken when the write starts; a save resolves only on the transaction's `complete` and rejects on `abort`/`error` with a real error. A commit hands its undo; a refused write undoes it and every commit built on it, newest first, before any later snapshot. `Client.persist` returns the write; `commit` undoes into the profile that owned it, even after a switch. Every user edit is a commit (addons, hotkeys, favourites, history, queue, taste, providers, series memory, Nuvio plugins; a backup restore undoes whole). The bridge answers a call that wrote only once it is durable; the sweep runs after a durable change and keeps memory ∪ durable ∪ in-flight references. | `tests/review-pr155-round4-durable.test.mjs` (16, async store with refusals). `scripts/test-web-durability.mjs`, Chromium, real sealed IndexedDB: Codex's abort, a request error (`ConstraintError`), abort after the request succeeded, two concurrent edits, the sweep, a real `QuotaExceededError` (CDP quota), a page reloaded mid-write, a late picture read: **24/24** here, **5/23** on `72e2ffc` (case 9 was added after). |
| N2 P2 | The import wrote collections/library/plugins in one commit, then the TMDB key in a second save; an addon whose write failed stayed in memory. | Each addon is its own durable commit (`install` waits for it) and is counted only when kept; Nuvio's disabled state goes in the same write. Collections, library, plugins and the key are **one** commit (`DataHub.stage`). A failure after addons were installed says so: `… · لم يُحفظ ما اخترته … أما الإضافات المثبّتة (n) فمحفوظة`, `error.installedAddons`. | Same file: refusal of the last write, of an addon's write, desktop synchronous failure, a switch during installs, retry, restart. |
| N3 P2 | `b9d946e`'s export wrote a stored `nuvio-riwaq-curated` as `riwaq-curated`, indistinguishable from Riwaq's own `curated`. | `legacyId`/`report.aliases` keep the older reading; `legacyMatches` lists file collections that are here only under it; a merge refuses without the viewer's answer, and the paste preview asks per collection: update mine (in place, folders by their older IDs too, local pictures and hand-picked titles kept) or add a new one. Current exports never ask; Add and Replace never ask. | `tests/review-pr155-round4-collections.test.mjs`, with a real `b9d946e` export as fixture. |
| N4 P2 | `applyTemplate` stored every template folder ID in `tplFolders`, including one that did not fit. | Only folders known before or present now are marked known; one deferred at the limit is counted (`deferred`) and arrives when there is room; removed folders stay removed. | Same file. |
| N5 P2 | Negation was read only before a fact; any one affirmed match won; "subbed in English" was not matched. | `states()` for track facts: a match denied before or after its words ("unavailable", "not included", "none", "N/A", "غير متوفرة") does not count, and a source that both says and denies is believed in its denial (as for "cached"). `EN_SUB_RX` reads "subbed/subtitles in English". Language mentions keep `affirms`. Used for `enSub`, `arabicSub`, `arabicDub`. | Same file, through `Client.getStreams` and the facets. |
| N6 P2 | Admission keyed sources by the whole serialized object (labels included). | Admission uses the cleaner's own keys (`tmdbKey`, `traktKey`, `catalogKey`); identical unread sources once too. | Same file (the reviewer's 40 + 1 fixture, and through the Client). |
| N7 P2 | `surelyStill` trusted a `.jpg` path. | Only Riwaq's own JPEG data URLs (typed from sniffed bytes) skip the canvas. | `scripts/test-ui-review155-round2.mjs`: APNG named `.jpg` and behind a real `.jpg` redirect, Reduce and normal; Codex's `still-frames.mjs`: 13/13 still in both modes. |
| N8 P3 | The canvas path loaded at mount and drew at 960 px. | One shared `IntersectionObserver` (300 px, `scrollMargin`) defers loading; drawn at the element's size × density (cover), ≤ 2560 px. | Same script: cards 600 px below the screen not requested before scrolling, requested after; Codex's offscreen run: the target is no longer requested. |
| N9 P2 | GET read the revision, then the pieces, in two statements. | Revision, size and pieces in **one** statement bound to the account instance; the whole is checked (indices, length = size) and read again up to three times, else 503 `try_again`, never a 200 with old/empty data; a cheap revision-only read still answers 204/304 first. | `tests/accounts-instances.test.mjs` (Codex's pause point; missing pieces; deletion during a pull; 7 MB round trip). |
| N10 P3 | The canvas kept its pixels when the address changed; a failed backdrop had no fallback. | A new address clears the canvas at once; failures reach `onError`; the hero drops a failed backdrop (tied to its address, keyed remount). | Same UI script (N10); Codex's `folder-transitions.mjs`: the sampled pixel after the failure is the hero's own background `[16,14,12]`, not the previous `[58,10,9]`. |
| N11 P3 | `cleanTmdb` silently replaced unknown media/sort and dropped unknown filter names; duplicate Add returned the folder unchanged. | `checkedTmdb` refuses an unknown kind, media, order, filter name or non-object filters by name (`error.fields`); a duplicate Add is refused like Update ("في المجلد مصدر بنفس الاستعلام"). | Same collections file; `tests/collection-sources.test.mjs` now expects the refusal. |
| N12 P2 | Interface calls could name only a profile ID or nothing; Nuvio ZIP/Desktop previews had no owner; an account sync kept the activation; a late picture read could cache an object URL after the cache was cleared. | `Client.claimSession` at the IPC boundary (main and web bridge) for the picture picker, paste import, badge styles, filter edits and every Nuvio preview step; previews hold their ticket and the import/diagnostics refuse after a switch (even back) or re-lock, before any install. `AccountHub.apply` renews the activation. Web: object URLs carry a generation; a late read makes none; reads are shared; any activation change (restore, sync, removal too) lets them go. Desktop: the pictures folder itself must not be a link/junction. | `tests/review-pr155-round4-sessions.test.mjs` (6), Chromium case 9 (late read after a switch: no URL). |

## Cloudflare (CF1, CF2, N9) and the deployment gate

See docs/CLOUDFLARE-DATABASE-AUDIT-2026-11-18.md, "Fourth pass": migration
0003 (account instances and credential generations), every write bound to
them in its own transaction, the one-statement pull, released clients
across the migration, workerd, and the new manual, fail-closed deploy
workflow. Production was only **read** (schema, migration names, Worker
list); nothing was written, deployed or migrated.

## Web smoke

Codex's `test-web.mjs` failure ("header controls must not overlap", both
heads) is a real defect: at 980 px in English the utilities spilled 8–15 px
over the search box whenever the prayer chip read "Dhuhr 12:08 PM" or
"Maghrib 5:41 PM" (UTC 03–09 and 13–14 here). The outer masthead columns
are now `minmax(max-content, 1fr)`; screens from 1100 px up are
pixel-identical before and after in both languages, and a deterministic
check (six fixed hours, en/ar, 1440–780 px) fails on the old CSS. The
intermittent #110 failure was the check reading the restored focus in the
same turn App restores it in the next frame; it now waits for that frame
(bounded) and asserts the same. Six full smoke runs here passed.

GitHub's own "Check source" job had failed on every head of this PR since
`98c3088` for another reason, before any browser test: `ubuntu-latest` is
now Ubuntu 26.04 and Playwright 1.56.1 stops with "does not support
chromium on ubuntu26.04-x64" (`npm test`, the format check and both builds
had passed in it). The job is pinned to `ubuntu-24.04`.

## Not verified in this pass

Windows, Electron, MPV, the native HUD and picture dialog, NTFS links and
junctions on a real volume, DPAPI, packaging, installers and upgrade (Codex's
Windows runs were at `72e2ffc`, not at these commits). Firefox (not
installed here; Codex's Firefox frames were at `72e2ffc`). The Worker on
Cloudflare's edge, a remote D1, D1 Time Travel and a staging environment
(none exists; production untouched). Whether the repository has an
`accounts-production` environment with required reviewers (a settings
matter outside the repository; not checked from here). Live TMDB, live
addons, live FR-Badges pictures in the app. Fire-and-forget saves that are
not user edits (a playback position, a provider's rotated token) are still
retried with the next save rather than rolled back, by design: undoing a
rotated single-use token would sign the viewer out.

# Fifth pass — Codex's fourth review (2026-11-18)

Codex re-reviewed at `a6a480e` on Windows x64 (Node 24.19.0), fixed six
small findings itself (Q1–Q5, Q11: `2677c5d`, `ccb0ac3`, `eb2ae38`,
`438fbb6`, `87466c3`, `215c3de`) and returned **NO-GO** on two confirmed
P1s (Q6, Q7) and three P2s (Q8, Q9, Q10). This pass answers those five on
the same branch, new commits on top of `215c3de` (`c5a958a`…), Codex's six
commits kept as they are, no force push, nothing merged, tagged, versioned
(still 0.55.0) or published, PR still a draft. It is the author's account;
the decision stays with the next independent review.

- Environment: Linux container, Node 22.23.5 for the work and **Node
  24.22.3** (`/opt/node24`) for the final runs, Playwright's Chromium
  157.0.8103.78, Wrangler 4.141.0 outside the repository. No Windows,
  Electron, MPV, NTFS or DPAPI here.
- The review (`Riwaq-PR155-Fourth-Review-AR.md`) and its evidence
  (`Riwaq-PR155-Fourth-Evidence.zip`, 378 entries, paths checked before
  extraction) were read and kept outside the repository. Its harnesses were
  read before use and run only against disposable stores and local
  services; their exit code 0 records observations, so their JSON was read.

## Reproduced before changing anything

- **Q6**: Codex's `check-durability.mjs` case is Chromium case 10 of
  `scripts/test-web-durability.mjs`; Codex's own run on `a6a480e` recorded
  `existsInMemory: false`, `existsAfterUnrelatedSave: false`.
- **Q7**: Codex's `sync-pending-write.mjs` on `215c3de` here, both modes:
  `uploadedBeforeStorageResolved: true`, `locallyRolledBack: true`,
  `secondDeviceReceivedRefusedEdit: true` (favorite addition and collection
  removal), as in the review.
- **Q9**: Codex called it a source inference. A race staged here between
  the session read and the legacy binding (`tests/accounts-round5-
  boundaries.test.mjs`) demonstrates it on `215c3de`: a pre-0003 session of
  an account deleted and re-registered by someone else answered **200 with
  the new owner's sealed data**, was bound to the new account, and its next
  upload **overwrote the new owner's data** (`OBSERVED-WRITE {"again":200,
  "overwrite":200,"ownerSees":"overwritten by the old session"}`). Local
  fixture only; production has no such session today (below).
- **Q8**: Codex's case with the actual `b9d946e` exporter on `215c3de`:
  `previewQuestions: 0`, and Merge kept `["nuvio-riwaq-folder", "folder"]`
  whatever was chosen.
- **Q10**: source inference in the review; the tests below fail on
  `215c3de` where they say.

## Q6–Q10

| ID | Cause | Change | Test |
| --- | --- | --- | --- |
| Q6 P1 | `Profiles.remove` (and `create`, `update`, `switch`, `setPin`) changed the store and saved plainly. A refused write (the web's vault later; the desktop's synchronous throw at once) left the change in memory, and the next unrelated save wrote it. | `Profiles.transact`: validate, change, hand DurableWriter (or the desktop's throw) an undo scoped to the change — the removed entry and bucket at their place, the touched fields, the PIN record, the previous active profile. An undo restores data, never authority: where the active profile moves back it is a new activation (older tickets never hold again) and a profile with a PIN comes back locked, even if it was unlocked before. A profile's local songs go in the same write. Main broadcasts the kept state after an undone call (as the web's `onUndo`). | `tests/review-pr155-round5-durability.test.mjs` (8 Q6 tests: inactive and active removal, desktop throw with local songs, wrong PIN/locked, removal + settings refused together, create/update/PIN, switch, A→B→A with a pending removal; all but the PIN guard fail on `215c3de`). Chromium, real sealed IndexedDB (`scripts/test-web-durability.mjs` cases 10–11): B with a collection and a picture survives abort-after-success and abort, reload, a language save and the sweep; a written retry removes it; the active PIN profile comes back locked in a new activation; refused switch, create and rename undone. Codex's harness now: `existsInMemory: true`, `existsAfterUnrelatedSave: true`. |
| Q7 P1 | `AccountHub.run` collected the live state while a commit's write was out; `Client.persist` also scheduled the push before the write answered. | `Client.persist` tracks each commit whose write answers later; `Client.atRest(step)` runs a synchronous step when none is out, the check and the step in one turn. Sync's merge, the application of the account's data and the collection of what goes up are one step, so nothing that may yet be undone is sent and the account's data is never put over a write still out. A commit's write settles on its own, so nothing waits on something waiting for it; one still out after 15 s makes the sync give up for now with a sentence. The web backup is sealed the same way. Plain saves (a position, a token a provider already rotated) are never undone and may sync — policy tested. | Same file, 13 Q7 tests with the real account service and two devices: favorite, collection removal, setting and profile removal, each refused (no upload, no new revision, device B unchanged) and kept (one upload after it is durable, a second sync sends nothing, B receives it); several commits; flush/scheduled push and a stuck write; the account's data waiting for a write, 409 and retry; a backup; the token policy. 17 of the file's 21 fail on `215c3de`. Codex's harness (release adapted to happen while sync waits): `uploadedBeforeStorageResolved: false`, `uploadedAfterRefusal: 0`, `secondDeviceReceivedRefusedEdit: false`; unmodified, its sync now stops after 15 s with "still being saved" instead of sending. |
| Q8 P2 | The older-reading question (N3) covered collections only; under a collection matched by its own ID a `b9d946e` folder `riwaq-folder` (stored `nuvio-riwaq-folder`) was added again. | `legacyMatches` also lists such folders, by ID only (`fromNuvio`'s `<collection>/<folder>` aliases, never by name); Merge refuses until each is answered; update merges into the viewer's folder (its ID, pictures, hand-picked titles kept); copy adds the file's folder under its own ID, so a repeated Merge updates that copy. Add, Replace and today's exports ask nothing. The preview's panel shows folder rows built as its collection rows, the Update label naming the collection. | `tests/review-pr155-round5-collections.test.mjs` (6; 4 fail on `215c3de`, 2 guards); Chromium check in `scripts/test-ui-review155.mjs` (Arabic and English: question shown, Import held until answered, one folder kept); Codex's case with the actual `b9d946e` exporter: asked once, update keeps one folder on a repeat, copy keeps both. |
| Q9 P2 | See the database audit, "Fifth pass": legacy binding by a second read, GET reads without the generation and session, the upload's clean-up unconditioned, a failed batch answered 409. | Proved in the statement that acts; 503 for storage failures. | `tests/accounts-round5-boundaries.test.mjs` (22; 16 fail on `215c3de`). |
| Q10 P2 | `AccountHub.attempt` compared the active profile's ID and its own counter; `importNuvio` checked its ticket before and after the addon loop only. | `attempt` takes the activation ticket and checks it (with the counter and the Settings lock) after every wait and before anything is kept; the Nuvio loop checks before each addon: none starts after the activation ends, the one already installing finishes (shared list) and is reported. Password change and account deletion keep their checks (same account bag, Settings open): a sync that applies the account's data renews the activation, and refusing them for it would protect nothing. | `tests/review-pr155-round5-sessions.test.mjs` (6; 5 fail on `215c3de`): sign-in and recovery replies landing after A→B→A, a re-lock and a restore sign nothing in; a late older sign-in never replaces a newer one; a three-addon import stops after the first; a live import installs the rest once. |

One earlier test changed its expectation: the N1 test "an edit refused
after a profile switch goes back into its own profile" assumed the switch
was a plain save surviving the refused write before it; it is a commit
built on that write now, undone with it (A active again, as on disk).

## Not verified in this pass

Windows, Electron, MPV, the native HUD, the native picture dialog, NTFS,
DPAPI and the desktop's real `profile.bin` writes (the desktop path was run
through a synchronous throwing store in Node, not Electron), packaging,
installers and upgrade: Codex's Windows results were at `215c3de` and do
not cover these commits. Firefox. The Worker on Cloudflare's edge, a remote
D1, Time Travel, a staging environment (none exists). Whether the
`accounts-production` environment exists with required reviewers (Codex's
public read found none). A sync that waits 15 s for a stuck IndexedDB write
was tested in Node only. IPC methods that still save plainly — Stremio
import, live TV favourites and sources, provider and integration keys —
report a refused web write as a failure but keep the change in memory and
write it with the next snapshot (and it may sync); they are never undone,
so no device diverges, but their reply does not match what is kept until
that later write. Not changed in this pass.

# Sixth pass — Codex's fifth review (2026-11-18)

Codex re-reviewed at `f990cf5` on Windows x64 (Node 24.19.0, Electron
44.9.3, real DPAPI) and Chromium 141/157, fixed one accessibility finding
itself (V3, `47a32cf`: each legacy-import choice group named by its
heading through `aria-labelledby`) and returned **NO-GO** on two confirmed
findings: **V1 (P1)**, a refused profile removal had already deleted that
profile's downloaded media, and **V2 (P2)**, reversible actions saved with a
plain write kept a refused change in memory, where a backup, account sync
and the next unrelated save carried it. It confirmed Q6–Q10 within their
tested scope. This pass answers V1 and V2 on the same branch, on top of
`47a32cf` (kept as it is: its `aria-labelledby` and stable React ID are
untouched), no force push, nothing merged, tagged, versioned (still
0.55.0), deployed or published, PR still a draft. It is the author's
account; the decision stays with the next independent review.

- Environment: Linux container, **Node 24.22.3** (`/opt/node24`), npm
  11.19.1, Playwright's Chromium 157.0.8103.78, **Electron 44.9.3 for
  Linux** (downloaded by the package's own `install.js`, outside the
  repository), Xvfb, Wrangler 4.141.0 outside the repository. No Windows,
  DPAPI, NTFS, MPV or installers here.
- The review (`Riwaq-PR155-Fifth-Review-AR.md`) and its evidence
  (`Riwaq-PR155-Fifth-Evidence.zip`, 192 entries listed before extraction,
  extracted into an isolated folder) were read in full and kept outside the
  repository. Its harnesses were read before use and run only against
  disposable stores; their exit code 0 records the defect they observed, so
  their JSON was read.

## Reproduced before changing anything

- **V1** in the real Electron main process (`scripts/test-profile-remove-native.mjs`,
  which mirrors Codex's `native-offline-refusal.mjs`: real IPC, the real
  `profile.bin` written through safeStorage, a directory occupying
  `profile.bin.tmp`). Off Windows, main needs a stand-in for the Win32
  video host (`koffi` loads `user32.dll` at import) and safeStorage uses
  Chromium's basic store; both stand-ins live outside the repository and
  are loaded by a wrapper folder (`RIWAQ_ELECTRON_APP`). On `47a32cf`: the
  removal is refused, `profile.bin` is byte-for-byte unchanged, B is still
  listed, and **B's media file is already gone** (ENOENT). A Node replay of
  main's old order (`forgetProfile`, then `Profiles.remove`) over a real
  file store: `refused: true, profileKept: true, mediaExistsAfterRefusal:
  false, recordAfterLaterSaveAndRestart: 0` — Codex's result exactly.
- **V2**: Codex's `check-plain-sync.mjs` (imports pointed at a source tree
  given on the command line, assertions untouched) on `47a32cf`: revision
  1→2 by a PUT while the favorite's write was out, `secondReceived: true`,
  `firstSavedAfterLaterSnapshot: true`. In Chromium, the new case 12 of
  `scripts/test-web-durability.mjs` on `47a32cf`'s build: the refused
  favorite is in both backups, and the refused source removal and Trakt
  opt-in are written by the later language save.

## V1 — a profile's downloads are deleted only after its removal is written

**Cause.** Main's `profileRemove` called `OfflineLibrary.forgetProfile`
(stop the download, delete every file, drop the records, save) and only
then `Profiles.remove` (the commit). Two stores, files first: a refused
encrypted write found the files already deleted, and `forgetProfile` had
dropped the records in memory, so the next unrelated save made that loss
durable.

**Order now** (`OfflineLibrary.removeProfile`, called by main):

1. **Before the write** (`prepareRetire`): the PIN check, playback stopped
   when the profile is active, new download actions for it refused
   (`removing`), the poster queue drained, its running download stopped as
   a **pause** (a cancel deletes the partial, which must survive a refusal),
   and a file being played or deleted refuses the removal. Nothing that
   lasts changes.
2. **The write** (`retire`, passed to `Profiles.remove` as `also`): the
   profile, its local songs and the move of its download records into
   `state.offlineTrash` (`{id, at}` only) are one encrypted write. Refused,
   one undo puts all of it back; every file is still on disk.
3. **After the write is durable** (`sweep`): the trashed files are deleted
   (poster, partial, media, in `remove()`'s order). An entry leaves
   `offlineTrash` only when all its files are gone, and the list is saved
   (a failed save of that only means the next sweep finds nothing left to
   delete). A file another program holds keeps its entry: the removal
   stands, is not reported as rolled back, and answers
   `offlineCleanup: { pending }`, which the Profiles dialog turns into a
   sentence; the sweep runs again a minute later (five times a session) and
   at every start. The sweep drops an entry a live record names without
   touching its file, accepts only `<32 hex>` names inside the downloads
   folder and removes a link, never its target.

The states are distinct: refused before the write (nothing changed),
written with clean-up pending (`offlineTrash` names files on disk, retried),
written and complete (`offlineTrash` empty), interrupted (a crash after the
write or halfway through leaves entries the next start finishes). The web
edition has no downloads; its session-only song picks are now dropped once
the removal is durable rather than before it.

**Tests.** `tests/review-pr155-round6-offline.test.mjs` (10, real Client,
Profiles and files, a store writing `profile.bin.tmp` then renaming as
main does): refusal by Codex's blocker with a later save and a restart;
refusal after the temporary file was written; an inactive profile removed
with three other profiles' files untouched and nothing in a backup; a held
file (pending reported, durable entry, idempotent retries, deleted after a
restart) and an already missing one; a crash after the write and halfway
through clean-up; a live record's file, a bad name and a link's target
never deleted; a running download paused (partial kept on refusal, deleted
once written); the active profile with a PIN (wrong PIN changes nothing, a
refused write brings it back locked in a new activation); A→B→A while the
removal waits (downloads frozen, nothing deleted before the write, playback
stopped when the profile became active); a played file refusing first.
`tests/review083.test.mjs`'s locked-file test now expects the durable
clean-up entry instead of a refused removal (the old expectation was the
V1 order). Real Electron main, `scripts/test-profile-remove-native.mjs`:
refused removal keeps record and bytes across a language save and a
restart; the written removal deletes B's file and keeps A's and C's; a
crash after the write is finished by the next start without touching a
live record's file. Its held-file step needs Windows (a file held without
delete sharing) and reports itself skipped elsewhere.

## V2 — a refused reversible action never reaches committed state, a backup or the account

**Cause.** `Client.atRest` (Q7) made sync and backups wait for commits, and
commits undo themselves when refused; Live TV, integration preferences,
Stremio's import and several other actions changed memory and called a
plain `persist()`, which is neither undone nor waited for.

**Classification** (every `persist()` call site was read):

| Category | Paths | Policy |
| --- | --- | --- |
| A — the viewer's reversible actions | Live TV favourite, source add, toggle, removal; integration preferences (`Integrations.save`) and disconnect; AniList's pasted token; the Letterboxd CSV import; Stremio's import, sign-in and sign-out; notification targets; debrid keys; home server add, removal, toggle; the AI key; update choices (core, web, desktop updater); usage and onboarding; the Discord app ID; shader folder and file, MPV path; local music add and edits | **Commits.** `Client.transact(change)`: `change` returns the undo of exactly what it changed (`core/undo.mjs` `fields` puts back only fields still holding what the change left, so a token rotated meanwhile in the same integration is never rolled back); whole-key `Client.commit` where nothing plain shares the key (settings). Refused: undone before any later snapshot (the desktop at once, the web when IndexedDB answers), the call fails, sync and backups waited meanwhile. |
| B — effects that already happened elsewhere | a token a provider issued (Trakt/Simkl device grant) or rotated (Trakt, Simkl, Spotify refresh); the Riwaq account's session and keys; a Simkl session the provider ended | **Plain, never undone** (the old refresh token is spent): kept in memory, written again with the next save (main also saves on quit); travels only in a secrets backup or an account with secrets on. |
| C — background state | positions and progress, connection-test statuses, update checks, provider list syncs and resume points, tag reads, a source's refresh time, the queue entry dropped when a viewing starts | **Plain**, as before. |

**Changes.** `Client.transact` and `Client.ownerPart` (`core/client.mjs`),
`core/undo.mjs`; each path above. Stremio's import now gathers addons,
library and positions first and writes them as one commit at the end
(nothing of it sits in the state across its requests), for the profile that
asked only (a switch or re-lock meanwhile writes no library and says so).
A disconnect's remote effect waits for the write: Simkl's token revoke is
sent only once the disconnect is durable, and a refused credentials change
brings the old account back unrevoked. The usage pulse or its deletion
request is sent after the choice is durable. Notification targets are built
as a copy and assigned whole, so a refused or invalid change no longer
leaves a half-edited target.

**Tests.** `tests/review-pr155-round6-durability.test.mjs` (38): twelve
actions refused by the web's vault (abort without an error object) —
undone in memory, absent from both backups, never written by a later
language save or seen after a reload, kept once retried — and the same on
the desktop's throwing store; a QuotaExceededError; two overlapping edits
(the one built on a refused one goes with it; an unrelated plain save is
kept); the Letterboxd import's undo landing in its own profile after a
switch and a lock; a refused credentials change bringing the Simkl account
back with no revoke sent; Stremio's import refused and retried (once each);
two devices on the real account service for a Live TV favourite (Codex's
case), a source removal, a Trakt preference and Stremio's addon import —
refused while a manual sync waits: no PUT, no new revision, device B
unchanged; accepted: one PUT after it is durable, none on the next sync,
device B receives it — one accepted and one refused change together, a
stale base (409) and a network failure, sign-out while a write is out; the
token policy (a refused opt-in leaves a token rotated meanwhile in place,
written with the next save, never in a backup without secrets). On
`47a32cf` the same file fails 35 of 38 (the three that pass do not depend
on the change). Chromium (`scripts/test-web-durability.mjs` case 12, real
sealed IndexedDB): Codex's three refusals (abort-after-success, abort,
request error) are answered as failures and undone, absent from both
backups, not written by a later language save, and kept once retried.

Two observations made while testing, both earlier behaviour and unchanged:
an account carries the removal of a Live TV source only while another
source remains (a payload without sources keeps the device's own,
`restoreState`), and a Stremio sign-out does not reach other devices (a
payload without Stremio keeps the device's sign-in). Reading
`publicState()` creates an empty `spotify` integration entry; harmless,
but a test that replaces `state.integrations` whole sees one more upload.

## Not verified in this pass

Windows, DPAPI, NTFS and a file held by another program (the held-file
step of the native script is Windows-only; the same path runs in Node with
a refusing delete), MPV and the native HUD, packaging, the NSIS and
portable builds, installers and upgrade: Electron ran on Linux with the
stand-ins above. Firefox. The Worker on Cloudflare's edge, a remote D1,
production (not read or touched in this pass). A provider sending tracking
history while an opt-in's write is still out (the web's IndexedDB window):
the consent was given in the interface, but it is not yet durable then.

# Seventh pass — Codex's sixth review (2026-11-19)

Codex re-reviewed at `10e0985` on Windows x64 (Node 24.19.0, Electron
44.9.3, real DPAPI, NTFS and a real FileShare.Read lock), confirmed V1 and
V2 fixed in their measured cases, fixed four narrow items itself (W6
cleanup message, W7 symlink test split, W8 real lock in the native
harness, W9 `undo.mjs` in the upgrade fixture: `ac0d628`, `0722a33`,
`dc38641`, `5238e75`, kept here as they are) and returned **NO-GO** on five
findings: W1, W3, W4 and W5 reproduced, W2 argued from the source. Issue
#156 (a tester's report, not part of Codex's review) is answered in the
same pass. Same branch, on top of `5238e75`, no force push; nothing
merged, tagged, versioned (still 0.55.0), deployed or published; the PR
stays a draft. This is the author's account; the decision stays with the
next independent review.

- Environment: Linux container, **Node 24.22.3** (`/opt/node24`), npm
  11.19.1, Playwright's Chromium, **Electron 44.9.3 for Linux** (the
  release zip, SHA-256 checked against Electron's own SHASUMS256.txt, put
  in the ignored `node_modules/electron/dist`), Xvfb. No Windows, DPAPI,
  NTFS, MPV or installers here.
- The review (`Riwaq-PR155-Sixth-Review-AR.md`) and its evidence
  (`Riwaq-PR155-Sixth-Evidence.zip`, 220 entries checked for absolute
  paths, `..`, drive letters and links before extraction, extracted outside
  the repository) were read in full. Codex's scripts were read before use
  and run with their own relative layout (`work/round6` pointed at a tree)
  against disposable stores. Their exit 0 records the defect they
  observed, so their JSON was read, not their status.

## Reproduced before changing anything (on `5238e75`)

- **W1** `offline/overlapping-cleanup.mjs`: `secondMediaRemained: true,
  secondPendingAdvertised: 0, secondMediaTracked: true, retryScheduled:
  false` — Codex's result exactly.
- **W3** `state/stremio-activation-order.mjs`: with A → B → A during
  `addonCollectionGet`, `syntheticTitleWasAdded: true,
  syntheticPositionWasAdded: true, libraryWarning: false`. The control
  (the switch during `datastoreMeta`) wrote nothing.
- **W4** `policy/check-sync-clears.mjs`: last source and Stremio sign-out
  `afterPullB: 1, afterPullA: 1, freshDevice: 1`; one of two sources kept
  at 1 (control). The same harness extended to two more clears (a probe
  outside the repository) found the same for **a removed configured addon
  and a cleared Discord app ID**.
- **W5** `policy/check-integration-effects.mjs`:
  `failedDisconnectRestoredSpentToken: true, spentTokenPersistedAgain:
  true`; its five controls held.
- **W2**, which Codex left unproven, **reproduced** with a held IndexedDB-
  shaped write (`DurableWriter`) and a local fake endpoint. The opt-in was
  then refused, and while it was still being written these left: a usage
  pulse (1, with no deletion ever sent for its token), Trakt history (1),
  Trakt scrobble start/stop (2), a Simkl scrobble start (1) and AniList
  requests (2). Only a store that answers later (the web edition) has the
  window; the desktop writes synchronously and undoes before returning.
- **#156** in Chromium on `5238e75`'s web build: with the page scrolled,
  Home on Home, Discover on Discover and the logo on Home left the page
  where it was (1600 px stayed 1600); Home → Discover and the logo from
  Discover opened at the old offset; Home from See all or a title page
  came back at the offset saved when that layer opened (1049–1698 px).

## W1 — overlapping removals each get a pass that reads their entries

Cause: `sweep()` handed a call made during a pass that pass's promise, and
the pass had copied `offlineTrash` before the second removal added to it;
pending and the retry timer came from that copy.

Fix (`electron/offline.mjs`): calls are counted; one pass at a time; a
call made during a pass is answered only after another pass that reads the
list again (`sweepPass`), so both removals' entries are deleted or
reported before either caller hears back. The loop repeats only for calls
made during a pass. A held file is retried by the timer at most
`SWEEP_RETRIES` times, and a newly committed removal resets that budget for
what it adds. `removeProfile`/`forgetProfile` report `pending` for their
own IDs. Entries whose removal is not yet durable (`uncommitted`) are
skipped by any other pass until that removal answers; a refused write puts
them back with their files. A live record is checked at each entry, not
once per pass. `stop()` also cancels a retry set by the pass it waited for.

Tests: `tests/review-pr155-round7-offline.test.mjs`, 7 cases over real
files, **all 7 fail on `5238e75`**. They cover C removed while B's pass is
paused inside its first delete, C's file held (reported to C, kept durably,
timer set, deleted once let go), three removals over one paused pass with a
restart, a file held for good (bounded retries; a new removal's own
budget), a pass started by another removal while a removal's write is
pending and then refused (files kept), a live record naming an entry
mid-pass plus invalid and missing entries, and `forgetProfile` counting
only its own. Codex's `overlapping-cleanup.mjs` on the new head now fails
at its defect assertion with `secondMediaRemained: false,
secondMediaTracked: false`. In the real Electron main (Linux, stand-ins
below), a port of Codex's `native-overlap.mjs` uses `chattr +i` in place of
the Windows lock, because both make the delete fail with EPERM, which
`removeFile` retries. See VERIFICATION.md for its numbers.

## W3 — the Stremio import holds the activation and sign-in it was asked under

Cause: `sync()` took its profile ticket after `addonCollectionGet`.

Fix (`core/client.mjs`): the ticket is taken before any request. An ended
activation starts no library request (none, or no further page), and
writes no library or position. The addons, shared by every profile, are
still imported as before, and the answer says `libraryWarning` and
`profileChanged`. A Stremio sign-out, another account's sign-in or a newer
import while it runs (`stremioAuthEpoch`, `stremioSyncs`, the key itself)
makes it write nothing at all; it rejects, saying so. The adjacent path,
`authenticate()`, had the same shape: a sign-out while `getUser` was out
came back signed in. Now a sign-out or a newer sign-in wins.

Tests: `tests/review-pr155-round7-stremio.test.mjs`, 8 cases, **7 fail on
`5238e75`** (the uninterrupted control passes on both). They cover A → B →
A in the first request and in a later library page, lock/unlock and a
restore's new activation, a sign-out at each of the three requests,
another account signed in during the import, a sign-out during
`getUser`, two overlapping imports, and an uninterrupted retry.

## W4 — a clear carried by a secrets sync is not undone by another device

Cause: `restoreState` read the empty source list, the null sign-in and a
configured addon missing from the list as "not carried" and kept the
receiving device's, whose next sync pushed them back.

Fix, with no format change (`core/backup.mjs`, `core/sync-merge.mjs`,
`core/account.mjs`): every release since 0.5 writes `auth` (null when
signed out) exactly when a payload includes secrets (checked on every
`v0.x.0` tag). Such a payload is authoritative for them: its empty list,
null sign-in and absent configured addon are clears. A payload without
secrets keeps the device's own, as before, so nothing local is cleared by
a device that does not share secrets. An empty Discord app ID, always
carried, clears it. `keepSignIn`: when a device first joins an account (no
common ancestor), merge3 lets the account win conflicts. The device's own
Stremio sign-in is kept over the account's absent one; afterwards a null
the account changed to is a real sign-out. What a sign-out means is now in
docs/ACCOUNTS.md: local, then the account and other devices with secrets
on, never Stremio's own session.

Tests: `tests/review-pr155-round7-sync-clears.test.mjs`, 9 cases over the
real accounts service (in-memory SQLite), **6 fail on `5238e75`** (the
local-only, join-with-own-sign-in and one-of-two controls pass on both).
They cover the last source across A, B, a new device, reloads and five
repeated syncs with no further PUT; a 409 between pull and push; an
offline device returning; Stremio sign-out, a new device and a later
sign-in; secrets off; a new device keeping its own sign-in; the
configured addon and the Discord ID; and released payloads read by
`restoreState`. `scripts/test-accounts-released.mjs` 3/3. Codex's harness
with its expectation set to "no resurrection" fails on `5238e75` and
passes here (0/0/0 for both clears, 1/1/1 for the one-of-two control).

Limit: a device still on 0.55 or earlier reads a carried clear the old way
and can push the value back until it updates; no payload marker can make
an old client drop it.

## W5 — a refresh during a disconnect keeps its token with its session

Cause: a refresh that answered while the disconnect was written was
dropped (the session no longer looked current), and the refused
disconnect's undo put back the token Simkl had just retired. Trakt's
single-use refresh had the same shape.

Fix (`core/integrations.mjs`): a renewed token is kept on the session
object it was asked for, unless another refresh or a sign-in replaced that
token since. It is written only while that session is stored. A refused
refresh ends that session wherever it is; a refused disconnect then puts
it back without a token, asking to link again. A refused disconnect whose
token changed meanwhile asks for a plain write on its own. The revoke after
a written disconnect waits for a refresh still out, then sends the token
Simkl honours. A newer session is never touched.

Tests: `tests/review-pr155-round7-integrations.test.mjs`, 7 cases, **5 fail
on `5238e75`** (the refresh-before and revoke-outage controls pass on
both). They cover a refresh answering during a refused disconnect
(renewed token in memory, on disk without another save, after a restart,
and a retried disconnect revoking it), a refresh answering after the
disconnect was written (waited for, its token revoked), a refused refresh
during a refused disconnect (back without a token), a new sign-in after the
disconnect, a revoke outage, and Trakt's rotated pair. Codex's sequence as
a report: `5238e75` restored the spent token and wrote it again; here the
renewed one is restored and on disk before any other save, with 0
revocations.

## W2 — an opt-in still being written opens no network

Fix (`core/client.mjs`, `core/usage.mjs`, `core/integrations.mjs`):
`holdOptIn(key, written)` marks a consent until the write that turned it on
settles, and `optInPending(key)` reports the mark.

- **Where it is checked:** `UsagePulse.tick` checks it. So does
  `Integrations.allows(id, s, flag)`, which every tracking boundary now
  uses: `queueHistory`, `flushHistory`, `observePlayback`,
  `sendScrobble`, `observeSimkl`, `sendSimkl`, `flushSimkl`, the Simkl
  resume read and import, `queueAnilist` and `flushAnilist` (including its
  in-loop checks). Scrobbling needs both choices kept.
- **Withdrawal needs no mark:** the flag is off in memory at once, a queue
  being sent stops at its next entry, and a refused withdrawal leaves the
  kept choice.
- **Not consent:** token rotation stays a plain save.

Tests: `tests/review-pr155-round7-consent.test.mjs`, 8 cases, **6 fail on
`5238e75`** (the two withdrawal controls pass on both). They cover the
usage timer under a pending and then refused opt-in, the first pulse only
once durable and after a restart, withdrawal (immediate, refused kept,
deletion once kept), and each of the four trackers refused and accepted
with A → B → A in between. With a Trakt queue being sent, turning tracking
off stops the rest. The probes, outside the repository, show 0 requests on
the new head for all five paths.

## Issue #156 — Home, Discover and the logo open their page at its start

The page's scroller is the document: App saves and restores
`window.scrollY`; the title page and See all are fixed layers whose
`lockScroll()` puts the document's offset back when released. The narrow
drawer releases its lock in a passive effect, after any layout effect, so a
plain `scrollTo(0)` would be undone by the release.

- `scrollPageToTop()` (`src/lib/scroll-lock.js`): while a lock is held,
  the offset its release restores becomes the top; otherwise the document
  goes to the top now.
- **Callers:** the navigation's `navigate`, which serves the wheel, the
  rail, the narrow drawer and the wordmark (already a named button calling
  Home). It calls `scrollPageToTop()` once the destination is allowed; a
  locked room still asks for its PIN and stays put.
- **Motion:** smooth when the page is already the one shown and neither
  `reduceMotion` nor `prefers-reduced-motion` is on; otherwise instant.
- **Unchanged:** programmatic navigation and Back. Back from a title page
  or See all still returns to the saved offset and focus. The logo and
  markup are unchanged.

Test: `scripts/test-ui-nav-top.mjs` (Chromium, local addon, Arabic and
English at 1440, 768 and 390 px; the drawer at 390). It covers the
same-page returns, Home ↔ Discover, the logo from Home and Discover,
closing a title page or See all onto Home's start (nothing left inert), and
Back from each to the same offset (±2 px). It also checks reduced motion
(at the top on the next frame), Enter on Home and Space on the logo with
focus kept, the logo as a named button, horizontal overflow and page
errors. 54/54 here; on `5238e75`'s build the navigation checks fail and
Back passes (VERIFICATION.md). Measured as `window.scrollY`, the scroller
App uses. While writing it, an apparent See all Back gap (1579 → 703 px)
was traced to Playwright scrolling the button into view inside `click()`
(the restore matched the offset at the click on both builds), so the test
clicks controls where they are on screen.

## Not verified in this pass

- Windows, DPAPI, NTFS and a Windows file lock. The native W1 checks ran
  in Electron for Linux, with stand-ins outside the repository for the
  Win32 video host and the OS keyring (Chromium's basic store) and
  `chattr +i` for the lock.
- MPV and the native HUD; packaging (`electron-builder --win … --publish
  never`), NSIS, portable and upgrade.
- Firefox and touch hardware; a screen reader.
- A real Stremio, Simkl, Trakt or AniList account. Providers were
  in-memory fakes.
- The Worker on Cloudflare's edge, a remote D1 and production, none of
  which was read or touched (the Worker and its migrations have no diff in
  this pass; local workerd and D1 16/16, VERIFICATION.md).
- A check of the #156 change by an agent that did not write it: left to
  the independent review.

# Eighth pass — Codex's seventh review: release blocker W4 (2026-11-20)

Codex's seventh review (Windows x64, Node 24, Electron 44.9.3, MPV 0.41.0)
accepted W1, W2, W3, W5 and #156 and stopped the release on W4 with released
apps in the loop: on the Worker released with v0.55.0 and migrations
0001–0002, a v0.55.0 client brought back a Live TV source the candidate had
removed and uploaded, on the candidate and on a new device, and the code
showed the same path for a Stremio sign-out. Started on `dc07e73` (the head
Codex pinned; GitHub's PR head matched). Codex's two fixes (`c5db511`, the
web runner pinned to Ubuntu 24.04, and `dc07e73`, the #156 wait) are kept
unchanged.

## Reproduced before changing anything (on `dc07e73`)

`scripts/test-accounts-mixed.mjs` runs the tag's own `core/` (git archive
of v0.55.0) as the released client and the Worker released with v0.55.0 on
0001–0002 over Node's SQLite. `RIWAQ_CANDIDATE=dc07e73`: 24/50 checks.
The cloud's source count went 0 → 1 after the v0.55.0 sync, and the
candidate, a new device and a device back from offline all held it again;
an updated device signed out of Stremio was signed in again; a joining
device holding the signed-out session kept it; a removed configured addon
and a cleared Discord app ID came back; and the candidate and v0.55.0
uploaded in turn on every sync (12, 6 and 5 extra PUTs in three idle
rounds).

Cause, from v0.55.0's own code: its `restoreState` keeps its own value for
an empty source list, a null sign-in, a configured addon the payload lacks
and an empty Discord ID, whatever the payload says; then its next sync
uploads that value as its change. The candidate's seventh-pass reading
(a secrets payload is the whole truth) holds between updated clients only:
v0.55.0 cannot read new metadata, and it rewrites the whole payload from
its own state, dropping anything it does not know.

A second mixed-version fault surfaced in the same runs: v0.55.0's settings
cleaner drops the six settings keys this version added (`tasteCompass`,
`badgeStyleArt`, `badgeLook`, `sourceFacetsRemember`, `sourceFacets`,
`collectionsLayout`). merge3 read the missing keys as deletions, so every
v0.55.0 sync reset them to their defaults on updated devices, and the two
devices then uploaded in turn for as long as both ran.

## W4 (mixed versions) — what a released client keeps decides the representation

Probed against the real v0.55.0 code before choosing anything: a
`live.favorites` entry that matches no channel is kept, merged entry by
entry and uploaded again as it is; a Live TV list with one invalid entry is
taken as a list, and v0.55.0's own cleaner drops the entry. Nothing in the
payload makes v0.55.0 drop its own Stremio key, configured addon or Discord
app ID. `core/sync-clears.mjs`:

- Clear records: a 24-hex fingerprint (SHA-256 of a fixed label, the kind
  and the identity, cut to 96 bits) in `live.favorites`, added when a
  secret item leaves a device's view through a sync (removed there since the
  agreed copy, or removed by another device) and lifted when an item is
  added on a device on this version. Devices on this version never take a
  recorded item from the account, whoever wrote it, and a device joining
  the account drops its own copy of one (so a never-linked account, an
  explicit sign-out and secrets turned off are told apart at sign-in). A
  record cannot be turned back into the value.
- The cleared Live TV list (`CLEARED_SOURCE`) goes up while the account's
  copy still lists a source: v0.55.0 drops its own last source.
- The agreed copy (`base`) leaves out recorded items, so a released
  client's copy of one is neither taken nor answered with another upload.
- `withKnownSettings` (core/sync-merge.mjs): a settings key the account's
  copy lacks keeps this device's value, in the merge and in the agreed
  copy. Riwaq never deletes a settings key.
- `keepSignIn` also keeps a joining device's own Discord app ID when the
  account has none (the seventh pass's empty-ID clear wiped it at sign-in).

No server change, migration, format version or new endpoint. A backup
restore is untouched: it is an explicit choice and still brings back what
it carries.

Results (`node scripts/test-accounts-mixed.mjs`, real v0.55.0 client and
Worker on 0001–0002): 50/50. Scenario 1 (last source, A/B/C/D): cloud
sources 1 → 0 after A's upload and stay 0 after B (0.55) syncs; B drops
its own copy; C joins without it; restarts, an unrelated change from B and
a 409 (B moving between A's pull and push) keep it out; D (0.55), offline
throughout, uploads it again (cloud 1), a device joining right then does
not take it, A answers with the cleared list and D drops it (cloud 0);
three idle rounds on five devices add 0 PUTs. Scenario 2 (Stremio,
synthetic keys): A signs out, B (0.55) keeps its own key and uploads it;
A, a new device and restarts stay signed out; 0 extra PUTs; an explicit new
sign-in reaches B and C; linking the same session again on purpose on C
reaches A; a sign-out made on B reaches A and C; without secrets sync each
device keeps its own sign-in. Scenario 3 (sign-in without a common
ancestor): never linked keeps the joiner's sign-in and shares it; the
signed-out session is dropped even when the cleared copy came from 0.55;
a different own sign-in is kept and goes up; secrets off keeps it local; a
joiner's own source joins while the cleared one stays gone. Scenario 4:
two sources, a configured addon, a Discord ID, favourites both ways, a
profile setting, watch progress from 0.55, one-of-two removal, an addon
installed again, recovery and a secrets-free backup restore. Scenario 5:
a failed upload and a restart, an upload whose reply was lost (twice),
concurrent updated devices, repeated syncs with 0 extra PUTs.
`tests/sync-clears.test.mjs` 11/11 (pure rules);
`tests/review-pr155-round7-sync-clears.test.mjs` 9/9 and
`tests/account.test.mjs` unchanged; `scripts/test-accounts-released.mjs`
3/3.

The limit, stated in docs/ACCOUNTS.md: a v0.55.0 device keeps its own
Stremio key, configured addon and Discord app ID on that device until it
updates or the viewer removes them there, and the account's copy can hold
them; only devices on this version refuse them. A Riwaq sign-out does not
end the session at Stremio (unchanged). Whether that is acceptable for the
Beta is a release decision; the smallest stricter step would be a server
capability that refuses uploads from released apps, which needs a
production deployment and is not part of this change.

## Issue #157 — "Download subtitles" under "Download video"

A viewer's suggestion after the seventh review (not part of it): the
player's right-click menu (`src/components/PlayerMenu.jsx`, drawn in the
HUD or the theater) ends with "تنزيل الفيديو"; "تنزيل الترجمة" now sits
directly under it, same style, focus and keys.

- What can be saved (`electron/subtitle-save.mjs`): a subtitle MPV loaded
  from an addon (its address stays in main, found through the key Riwaq
  loaded it under) or from a subtitle file the viewer opened or dropped. A
  track inside the video stream is not offered: MPV has no supported way to
  write one track to a file, and a transcoder is out of proportion; the
  item is then disabled and says why in a short note («مدمجة في ملف
  الفيديو», «لا ترجمة محمّلة»), as "Download video" does. That note wraps
  at the items' width: the first version gave it the 210 px minimum of
  the other notes, and `test-ui-feedback`'s HUD check (#150) caught the
  menu at 210 px against a widest item of 126.
- Which one: the selected subtitle when it can be saved, or the only one,
  named on a second line under the item (language, then title or "ملف على
  هذا الجهاز"), so another language is never saved silently. With several
  and none selected, the item opens a short choice list inside the menu
  (heading, one item per subtitle, Back); arrows, Home, End, Enter and
  Escape work as in the menu. The page sees `{ id, label, selected }` only;
  an id is MPV's track number, looked up again when picked, so a track that
  went away is refused rather than another saved.
- Fetching (`core/subtitle-export.mjs`): http or https, no credentials; a
  loopback or private address only as the addon's own first address (the
  viewer's Stremio Service serves subtitles on 127.0.0.1), and no public
  address may redirect into the viewer's network; at most three redirects,
  each checked; 15 s; the body read up to 5 MB as it streams; HTML, image,
  audio and video types refused. The bytes must be SRT, WebVTT or ASS/SSA
  with at least one cue, whatever the server called them, and are saved as
  they came (an Arabic Windows-1256 file stays one). A file of the viewer's
  is read only if it has a subtitle extension, is a regular file and is at
  most 5 MB.
- Saving: the system's Save dialog (`dialog.showSaveDialog`, over the HUD
  in the separate HDR layout so MPV's window cannot hide it), starting in
  Downloads with a Windows-valid name (`The Show S01E02.ar.srt`: reserved
  characters and names, bidi controls and trailing dots removed), the
  format as the first filter, overwrite confirmation. Cancel writes
  nothing. The file is written beside its target and renamed into place.
  Behind the library lock and the menu's viewing check, like the other
  menu actions; playback is not touched. The web edition keeps the menu
  desktop-only (`web/desktop-only.js`). The notice names the file only.
- Tests: `tests/subtitle-download.test.mjs` 9/9 (formats, names, address
  rules, a loopback server for a local address, a 404, a timeout, a size
  cap, an HTML page and cancellation; redirects into the network, to
  `file:` and in a loop; choices and labels; exact bytes, cancel, replacing
  an existing file only through the dialog, stale, embedded and malformed
  choices; a viewer's own file, too large, gone); the menu order test and
  main's menu harness (`tests/downloads-quality.test.mjs`: ids and labels
  only, an old menu cannot save, an embedded track refused before any
  fetch or dialog). Chromium (`scripts/test-downloads-quality.mjs`, Arabic
  and English): on `dc07e73`'s menu (`QUALITY_BASELINE=1
  DOWNLOADS_QUALITY_REF=dc07e73`) the 14 new checks fail and the 28 others
  pass; here 44/44: the item right under "Download video" at its width, the
  label, mouse and keyboard saves with the viewing identity, the choice
  list with no guess, a long name never widening the menu, Back, and the
  disabled state with its reason. Not run: the native Windows Save dialog,
  a packaged or portable build and a real addon's subtitles.

# Ninth pass — Codex's final acceptance: W4 at the favourites limit, #157 security, issue #158 (2026-11-21)

Codex's final acceptance (Windows x64, Node 24.19.0, Electron 44.9.3, MPV
0.41.0) passed the mixed-version suite 50/50 and the native subtitle saves
in four formats, and stopped the release on two findings: W4 failed at
exactly 5000 Live TV favourites (46/50; 50/50 at 4999), and #157's fetch
took its local exception from the subtitle's own address and its save did
not re-check its viewing after the fetch and the dialog. Started on
`c657bfa` (GitHub's PR head matched; PR #155 draft). Everything earlier on
the branch is kept unchanged; the version stays 0.56.0.

## Reproduced before changing anything (on `c657bfa`)

`scripts/test-accounts-mixed.mjs` gained `RIWAQ_MIXED_FAVORITES=<n>` (the
first device gets n synthetic channel favourites before signing up), as
Codex ran it: **4999 → 50/50, 5000 → 46/50**, the same four failures (a
device joining right after the returning 0.55.0 device's upload got the
source, updated devices took it back, the 0.55.0 device kept it, and the
next source added on 0.55.0 was refused with it). The table shows the
account's revision 4, written by 0.55.0, with no record left.

Cause: the records were appended to `live.favorites`; v0.55.0's
`restoreState` keeps the first 5000 (`.slice(0, 5000)`), so at 5000 real
favourites a released sync cut the record and uploaded the list without
it. The candidate's own `restoreState` cuts there too, so an updated
device applying a merged payload at the limit lost it as well; and records
counted against a released device's favourites (4999 real + 3 records was
already past the limit in the new scenario 6).

## W4 — records leave the favourites list

Probed against every released cleaner since accounts began (0.40.0–0.55.0):
`cleanSecretBag` keeps a provider entry's string fields of up to 8192
characters, whatever their names, and the released code reads an entry
only through its `key`; its interface shows the delete button only for an
entry that has a key; `DataHub.save` spreads the entry, so adding a key
keeps the rest.

- Representation (`core/sync-clears.mjs`): the records, joined into one
  field `riwaqClears` (at most 340 = 8160 characters, oldest dropped
  first), in all five provider entries of the secrets payload (tmdb, omdb,
  mdblist, fanart, theintrodb). Deleting a key on a released device removes
  one copy of five. Updated devices keep the records in the account bag
  (`state.account.clears`, encrypted store), never in the profile, the
  provider store (`restoreState` drops the field) or a backup. A bag made by
  a released version starts from its agreed copy and from what its released
  code kept in the provider entries.
- Merge (`mergeClears`, `mergeWithClears`): everything else goes through
  merge3 without the records; records merge as a set. A record the
  account's copy lacks goes only when that copy holds a list and holds the
  item again (a lift). Updated writers always write the list, an empty one
  included, so a released device that passes on a lift (it relays the list
  unchanged) is followed, and a released copy with no list at all (every
  carrier deleted) lost it: the record is kept and the next upload puts it
  back. Trimming past 340 keeps the oldest at the front, so two devices
  trim alike instead of fighting.
- A record-only change is applied without waiting for a viewing to end
  (nothing the device holds changes) and without touching the state.
- The favourites list is the viewer's own on every device. A favourite past
  5000 is refused when added (`LIVE_FAVORITES_MAX`, with a sentence in both
  languages): every Riwaq cuts the list there at the next restore or sync.
- First design rejected: putting the record first in the list. At 5000 real
  favourites a released device would then cut a real favourite and upload
  its removal.
- Second design corrected during this pass: treating a released writer's
  copy as never lifting a record broke an explicit re-install on an updated
  device when a released device synced in between (C2 kept refusing the
  re-installed addon). Telling "relayed" from "lost" by the list's presence
  fixed it.

Tests: `tests/release-0560-w4-capacity.test.mjs` (13: carriers, empty list,
one deleted carrier, the 8192 bound, malformed carriers, restore never
importing records, above-5000 input, the hub's limit, the merge rules,
trimming, relayed lift versus lost list, favourites untouched at 5000);
`tests/sync-clears.test.mjs` moved to the carriers (11); the round-7 W4
suite and the account suites unchanged. `scripts/test-accounts-mixed.mjs`
scenario 6 runs at 4999 and 5000 every time: five devices (two updated,
three released, one offline), two sources and a configured addon removed at
once, full-capacity released uploads, a TMDB key deleted on a released
device, a favourite removed on 0.55.0 and another added on an updated
device, the offline 0.55.0 device returning and a new device joining right
after it, restarts and three idle rounds, a 409 between two updated
devices, a lost reply, a re-install, re-login, an encrypted backup restored,
and a released device that lost every carrier.

| Scenario | Old candidate `c657bfa` | Corrected candidate |
| --- | --- | --- |
| 4,999 favourites (Codex's scenario 1) | PASS 50/50 | PASS |
| 5,000 favourites (Codex's scenario 1) | FAIL 46/50 | PASS |
| Offline legacy device returns (scenario 6, 4999 and 5000) | removed sources and addon taken by updated and new devices | updated and new devices refuse them; 0.55.0 drops the sources |
| Legitimate favourites | preserved (the records, appended last, were what a released sync cut) | preserved on every device at both counts; the list holds no records |
| Repeated sync | 0 extra PUTs where it settled | 0 extra PUTs |

Limits: a released device keeps its own Stremio key, configured addon and
Discord app ID (unchanged); a released device that missed the cleared list
uploads its source again until an updated device answers (unchanged); a
device joining at the very moment the account's copy has lost every
carrier cannot know the records until an updated device syncs (released
interfaces cannot delete an entry without a key, so this takes five
configured keys deleted on one released device); records past 340 are
dropped oldest first.

## #157 — the subtitle fetch is authorized where it connects, and bound to its viewing

Network (`core/subtitle-export.mjs`, `electron/subtitle-http.mjs`,
`core/client.mjs`):

- The client records which configured addon supplied each subtitle key
  (`subtitleOrigins`: the subtitle addon, or for a stream's own subtitles
  the addon that sent the stream). `subtitleOrigin(key)` answers only while
  that addon is installed and enabled; a subtitle whose addon is gone is
  refused before any request.
- A local address is allowed only at a trusted origin: the supplying
  addon's own scheme, host and port, and only when that addon is itself
  local (`trustedOrigin`). Naming a loopback or private address grants
  nothing. Once a redirect leaves the trusted origin, trust ends for the
  rest of the chain.
- Main's transport keeps artwork's connection-time control: outside the
  trusted origin the socket's own lookup keeps only public addresses
  (loopback, private, CGNAT, link-local and metadata, multicast, reserved,
  ULA, link-local IPv6, v4-mapped IPv6 dropped), so a public name that
  resolves home, or resolves differently the second time, never connects.
  IP literals are checked as they are. No proxy (`agent: false`), no
  cookies, no header but Accept; redirects are still checked hop by hop
  with the timeout and the 5 MB cap. Artwork's own code is unchanged (its
  `publicAddress` and `publicLookup` are only exported).

Binding (`electron/subtitle-save.mjs`, `electron/main.mjs`): the save
captures the viewing (video ID and start token), the profile's activation
ticket and the chosen track's source (`sameSource`: track, kind, address or
path, supplying addon) and re-checks them, with the library lock, before
the fetch, after it, before the dialog, after it and right before the
write; any change ends the save with nothing written, and a 250 ms watch
aborts a fetch still out. A changed selection (which track is shown) still
saves the one chosen; a removed or replaced track does not.

Tests: `tests/release-0560-subtitle-security.test.mjs` (25), with a fake
resolver and request for public names and a loopback fixture as the
configured local addon: every refused range and family, mixed answers,
rebinding between two connections, literals and local names, another port
as another origin, headers, a trusted addon saving, unconfigured localhost,
public to local, public to a name resolving home, local to public and back,
timeout, cancel and size over the real transport, the client's origin
tracking (enabled, disabled, removed), every invalidation of the binding
(playback ends, another video, profile switch, A → B → A, library lock,
track removed or replaced, addon removed) before the dialog and with the
dialog open, a cancelled fetch reported as the ended viewing, main's abort,
a cancelled dialog, temp-file cleanup, and main's wiring. The issue-#157
suites moved to the trusted-origin contract.

Not verified here: the native Windows Save dialog, MPV's real subtitle
tracks, a real local subtitle addon and a real public one; Codex's Windows
acceptance did those for the feature and must repeat SRT and the dialog.

## Issue #158 — glass refined, Flutter evaluated

`src/glass.css` token values only: a curved top reflection in the dark
sheen and an inner shade at every glass edge's foot (`--glass-floor`), the
dialog's rim included; fallbacks still flatten them. Flutter is evaluated
and not adopted (`docs/ISSUE-158-GLASS-FLUTTER.md`); the issue stays open.
Checked in Chromium on the web build: text contrast measured from pixels is
identical before and after; screenshots at 390, 768 and 1440 px in both
languages and schemes, reduced motion and reduced transparency, no
overflow. The issue's screenshot could not be opened from this environment.

Runs, versions and what was not run: [VERIFICATION.md](../VERIFICATION.md),
2026-11-21 (ninth pass).
