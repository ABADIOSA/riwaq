// The November 2026 beta (issues #144–#154 and the work that came with
// them). The player bar's issues live in tests/player-bar.test.mjs and the
// wheel's in tests/wheel.test.mjs; the Chromium checks are in
// scripts/test-ui-beta.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULT_SETTINGS, safeSettings } from "../core/protocol.mjs";

const read = (file) =>
  readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8");

test("the taste compass can be hidden again, per profile (#148)", () => {
  assert.equal(DEFAULT_SETTINGS.tasteCompass, true);
  assert.equal(safeSettings({ tasteCompass: false }).tasteCompass, false);
  assert.equal(safeSettings({ tasteCompass: "no" }).tasteCompass, true);
  const app = read("src/App.jsx");
  // Both places that draw it read the switch.
  const draws = app.split("<TasteDiscovery").length - 1;
  assert.equal(draws, 2);
  assert.equal(
    app.match(/settings\.tasteCompass !== false/g)?.length,
    2,
    "Discover and Home",
  );
  // One control, on the Home & showcase page.
  const studio = read("src/components/SettingsStudio.jsx");
  assert.equal(studio.match(/"tasteCompass",/g)?.length, 1);
  assert.match(studio, /"إظهار بوصلة ذوقك"/);
});

test("Discover's tabs sit inside the block they switch, one separator (#148)", () => {
  const page = read("src/components/DiscoverSections.jsx");
  assert.match(page, /<section className="discover-sections"/);
  assert.match(page, /className="filter-tabs discover-tabs"/);
  // The first row (Riwaq's, else the first blended one) drops its own line.
  assert.match(page, /first=\{index === 0\}/);
  assert.match(page, /className=\{first \? "discover-first" : ""\}/);
  const css = read("src/smart.css");
  const block = css.slice(css.indexOf(".discover-sections {"));
  assert.match(block, /border-top: 1px solid var\(--line\)/);
  assert.match(
    css,
    /\.discover-sections > \.scroll-row-wrap > \.discover-tabs \{[^}]*border-bottom: 0/,
  );
  assert.match(
    css,
    /\.app \.discover-sections > \.rail\.discover-first \{[^}]*border-top: 0;[^}]*margin-top: 0/,
  );
});

test("the scroll lock leaves no empty band beside the scrollbar (#149)", () => {
  const lock = read("src/lib/scroll-lock.js");
  // The root no longer keeps its scrollbar's strip; the page pads instead.
  assert.doesNotMatch(lock, /root\.style\.scrollbarGutter = "stable"/);
  assert.match(lock, /export function scrollbarSides/);
  assert.match(lock, /--lock-gutter-right/);
  assert.match(lock, /removeProperty\("--lock-gutter-right"\)/);
  const tokens = read("src/tokens.css");
  assert.match(
    tokens,
    /body \{\s*padding-left: var\(--lock-gutter-left\);\s*padding-right: var\(--lock-gutter-right\);/,
  );
  // The masthead pads too, so its search never moves.
  assert.match(
    read("src/session.css"),
    /padding-right: calc\(20px \+ var\(--lock-gutter-right, 0px\)\)/,
  );
  // Element scrollers frozen under the gallery keep theirs: inside a box
  // the strip is that box's own.
  assert.match(lock, /el\.style\.scrollbarGutter = "stable"/);
});

// --- #153: deleting a stream filter without a confirmation -----------------

test("a stream filter deletes at once and Undo puts it back (#153)", async () => {
  const { removeFilter, restoreFilter, FILTER_LIMIT } =
    await import("../core/stream-prefs.mjs");
  const filters = [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
    { id: "c", name: "C" },
  ];
  const plan = removeFilter(filters, "b", "b");
  assert.deepEqual(
    plan.filters.map((f) => f.id),
    ["a", "c"],
  );
  assert.equal(plan.active, "", "the active filter that went is not active");
  // Undo: back in its place, active again since nothing else was chosen.
  const back = restoreFilter(plan.filters, plan.active, plan.undo);
  assert.deepEqual(
    back.filters.map((f) => f.id),
    ["a", "b", "c"],
  );
  assert.equal(back.active, "b");
  // A choice made since wins; a filter already back cannot come twice.
  assert.equal(restoreFilter(plan.filters, "a", plan.undo).active, "a");
  assert.equal(restoreFilter(back.filters, "b", plan.undo), null);
  // Only the one filter goes; another active filter stays active.
  assert.equal(removeFilter(filters, "a", "c").active, "a");
  assert.equal(removeFilter(filters, "a", "zz"), null);
  // A full list refuses the undo rather than dropping another filter.
  const full = Array.from({ length: FILTER_LIMIT }, (_, i) => ({
    id: `f${i}`,
    name: `F${i}`,
  }));
  assert.equal(restoreFilter(full, "", plan.undo), null);
  const page = read("src/components/settings/SourcePages.jsx");
  assert.doesNotMatch(page, /window\.confirm\(`حذف المرشح/);
  assert.match(page, /label: "تراجع"/);
  // The notice carries one action and runs it once.
  const app = read("src/App.jsx");
  assert.match(app, /const notice = \(message, action = null\)/);
  assert.match(app, /className="toast-action"/);
});

// --- #152: the Harbor badge packs page is gone, the engine stays ------------

test("no Harbor badge packs page; the badge engine and rules stay (#152)", () => {
  const studio = read("src/components/SettingsStudio.jsx");
  assert.doesNotMatch(studio, /"badgePacks"|BadgePacksPage/);
  assert.match(studio, /"badgeRules"/);
  assert.match(studio, /"badges",/);
  const pages = read("src/components/settings/SourcePages.jsx");
  assert.doesNotMatch(pages, /harbor\.site|KNOWN_PACKS|BadgePacksPage/i);
  assert.match(pages, /export function BadgeRulesPage/);
  // The renderer can no longer fetch a pack from any address it names, nor
  // copy one: a look fetches only its pinned file.
  for (const file of [
    "electron/preload.cjs",
    "electron/main.mjs",
    "web/bridge.js",
  ]) {
    const source = read(file);
    assert.doesNotMatch(source, /badgePackFetch|copyBadgePack/, file);
    // The page names a look and its profile; core fetches the look's own
    // pinned address and applies it to that profile (PR #155 review, F2).
    assert.match(source, /badgeStyleApply/, file);
  }
  assert.match(
    read("electron/main.mjs"),
    /client\.applyBadgeStyle\(\s*\{ look: String\(a\?\.look \|\| ""\), profileId: a\?\.profileId \}/,
  );
  assert.match(
    read("core/client.mjs"),
    /const url = frStyleUrl\(String\(look \|\| ""\)\);\s*if \(!url\) throw/,
  );
});

// --- Stream badge appearance and FR-Badges ---------------------------------

const frPack = (folder = "Badges") =>
  JSON.stringify({
    filters: [
      [
        "edition-imax",
        "editions",
        "IMAX",
        "(?i)\\bimax\\b(?!\\s*enhanced)",
        "imax",
      ],
      ["res-4k", "resolution", "4K UHD", "(?i)\\b(2160p|4k)\\b", "4k"],
      ["res-1080", "resolution", "1080p FHD", "(?i)\\b1080p\\b", "1080p"],
      ["dv", "dynamic-range", "Dolby Vision", "(?i)\\b(dv|dovi)\\b", "dv"],
      ["atmos", "audio-codec", "Dolby Atmos", "(?i)\\batmos\\b", "atmos"],
      ["hevc", "video-codec", "HEVC / H.265", "(?i)\\b(hevc|x265)\\b", "hevc"],
      [
        "lang-ar",
        "subtitles",
        "Arabic Subtitles",
        "(?i)\\barabic[\\s._-]*subs?\\b",
        "sub-ar",
      ],
      ["off", "editions", "Old", "(?i)old", "old"],
    ].map(([id, groupId, name, pattern, file], i) => ({
      id,
      groupId,
      name,
      pattern,
      imageURL: `https://raw.githubusercontent.com/farizmohd70/FR-Badges/main/${folder}/${file}.png`,
      tagColor: "#00000000",
      borderColor: "#00000000",
      textColor: "#00000000",
      tagStyle: "filled and bordered",
      isEnabled: i !== 7,
      type: "filter",
    })),
  });

test("FR-Badges reads with its groups; a style keeps the viewer's rules first", async () => {
  const { importBadgePack, RULE_LIMIT, ruleBadges } =
    await import("../core/badges.mjs");
  const look = await import("../core/badge-look.mjs");
  const pack = importBadgePack(frPack(), undefined, { name: "fr-glass" });
  // Java's (?i) dropped, groups kept, a disabled badge counted, none lost.
  assert.equal(pack.disabled, 1);
  assert.equal(pack.skipped, 0);
  const hevc = pack.rules.find((r) => r.label === "HEVC / H.265");
  assert.equal(hevc.group, "video-codec");
  assert.doesNotMatch(hevc.pattern, /\(\?i\)/);
  // "4K UHD" and "Dolby Vision" are pictures for the built-in chips.
  assert.ok(Object.keys(pack.art).length >= 1);
  const own = Array.from({ length: RULE_LIMIT - 3 }, (_, i) => ({
    id: `mine-${i}`,
    label: `Mine ${i}`,
    pattern: `mine${i}`,
    color: "#E7B66E",
    enabled: true,
  }));
  const { patch, report } = look.chooseFrStyle(
    { badgeRules: own, badgeArt: { "4k": "https://example.org/mine-4k.png" } },
    pack,
    "fr-glass",
  );
  // Every rule of the viewer's stays, first; the style fills what is left
  // and says how many did not fit.
  assert.deepEqual(
    patch.badgeRules.slice(0, own.length).map((r) => r.id),
    own.map((r) => r.id),
  );
  assert.equal(patch.badgeRules.length, RULE_LIMIT);
  assert.equal(report.loaded, 3);
  assert.equal(report.over, pack.rules.length - 3);
  assert.equal(report.own, own.length);
  // The style's badges come best group first: quality before editions.
  const fr = patch.badgeRules.slice(own.length);
  assert.equal(fr[0].group, "resolution");
  assert.ok(fr.every((r) => r.pack === "FR-Badges Glass"));
  // Its pictures replace only what they cover.
  assert.match(patch.badgeArt["4k"] || "", /FR-Badges|mine-4k/);
  assert.equal(patch.badgeLook, "fr-glass");
  // Leaving the style removes its badges and pictures, nothing else.
  const back = look.chooseLook({ ...patch }, "liquid");
  assert.equal(back.badgeRules.length, own.length);
  assert.ok(
    Object.values(back.badgeArt).every((u) => !look.isFrImage(u)),
    JSON.stringify(back.badgeArt),
  );
  assert.equal(back.badgeLook, "liquid");
  assert.throws(() => look.chooseLook({}, "fr-frost"));
  assert.throws(() => look.chooseFrStyle({}, pack, "riwaq"));
  // A matched badge carries its group into the row.
  const badges = ruleBadges(
    { title: "Film 2160p IMAX DV Atmos HEVC arabic subs" },
    pack.rules,
  );
  assert.ok(badges.some((b) => b.group === "video-codec"));
});

test("only the pinned FR-Badges files can be fetched", async () => {
  const look = await import("../core/badge-look.mjs");
  // One commit, never "main", which moves (PR #155 review, security).
  assert.equal(
    look.frStyleUrl("fr-frost"),
    "https://raw.githubusercontent.com/farizmohd70/FR-Badges/3fae65b65bb8859003eb8f6b5d4e51a0065b3901/badges-frost.json",
  );
  assert.equal(look.frStyleUrl("https://evil.example/x.json"), "");
  assert.equal(look.frStyleUrl("riwaq"), "");
  assert.equal(look.frStyleUrl("__proto__"), "");
  assert.deepEqual(look.BADGE_LOOKS, [
    "riwaq",
    "liquid",
    "fr-glass",
    "fr-frost",
    "fr-minimal",
  ]);
  // The default look is Riwaq's own: nobody's badges change by themselves.
  assert.equal(DEFAULT_SETTINGS.badgeLook, "riwaq");
  assert.equal(safeSettings({ badgeLook: "fr-frost" }).badgeLook, "fr-frost");
  assert.equal(safeSettings({ badgeLook: "neon" }).badgeLook, "riwaq");
});

test("a row keeps the important badges, folds the rest, never repeats one", async () => {
  const { coveredKinds, fitBadges, orderBadges } =
    await import("../core/badge-look.mjs");
  const badges = [
    { label: "IMAX", group: "editions" },
    { label: "Arabic Subtitles", group: "subtitles" },
    { label: "Dolby Atmos", group: "audio-codec" },
    { label: "4K UHD", group: "resolution" },
    { label: "Mine" },
    { label: "Dolby Vision", group: "dynamic-range" },
    { label: "4K UHD", group: "resolution" },
    { label: "Real-Debrid", group: "debrid" },
  ];
  // The viewer's own first, then quality, HDR, audio, source, languages.
  assert.deepEqual(
    orderBadges(badges).map((b) => b.label),
    [
      "Mine",
      "4K UHD",
      "4K UHD",
      "Dolby Vision",
      "Dolby Atmos",
      "IMAX",
      "Real-Debrid",
      "Arabic Subtitles",
    ],
  );
  const { shown, more } = fitBadges(badges, 4);
  assert.deepEqual(
    shown.map((b) => b.label),
    ["Mine", "4K UHD", "Dolby Vision", "Dolby Atmos"],
  );
  assert.deepEqual(
    more.map((b) => b.label),
    ["IMAX", "Real-Debrid", "Arabic Subtitles"],
  );
  // A badge with the same fact as a built-in chip takes its place.
  assert.deepEqual([...coveredKinds(badges)].sort(), [
    "arabic",
    "audio",
    "cached",
    "hdr",
    "resolution",
  ]);
  // English subtitles do not stand for the Arabic chip.
  assert.ok(
    !coveredKinds([{ label: "English Subtitles", group: "subtitles" }]).has(
      "arabic",
    ),
  );
  const details = read("src/components/Details.jsx");
  assert.match(
    details,
    /const badges = visibleBadges\(s\.badges, settings\);\s*const covered = coveredKinds\(badges\)/,
  );
  assert.match(details, /className="tag-more"/);
  // A picture that fails shows its label as a glass chip, readable even
  // when the pack's own colours are transparent.
  assert.match(
    read("src/components/StreamBadge.jsx"),
    /if \(badge\.image && broken\)\s*return \(\s*<em className="tag-fallback"/,
  );
});

test("the FR-Badges licence is credited", () => {
  const notices = read("THIRD-PARTY.md");
  assert.match(notices, /FR-Badges/);
  assert.match(notices, /farizmohd70/);
  assert.match(notices, /MIT/);
});
