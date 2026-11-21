// Codex's review of PR #155, F2 (P1): work started under one profile and
// finished after a switch (a filter Undo, an FR-Badges download, a delayed
// remembered-filters save) wrote the other profile's settings. The
// invariant, enforced in core where the state is written:
//
//   An operation started under profile A never modifies profile B's data
//   after a profile switch.
//
// Plus F6 (badge pictures kept apart from an FR style; Off hides its
// badges) and the pinned, bounded FR-Badges fetch.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Client, PROFILE_CHANGED } from "../core/client.mjs";
import {
  FR_BASE,
  FR_MAX_BYTES,
  FR_STYLES,
  chipPictures,
  chooseFrStyle,
  chooseLook,
  fetchFrStyle,
  frImage,
  frStyleUrl,
  visibleBadges,
} from "../core/badge-look.mjs";
import { importBadgePack } from "../core/badges.mjs";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/** A client with two profiles, A (active) and B, each with its own filters. */
function twoProfiles() {
  const c = new Client({ load: () => ({}), save: () => {} });
  const a = c.profiles.store.active;
  c.settings({
    streamFilters: [
      { id: "a4k", name: "A 4K", resolution: ["4K"] },
      { id: "a1080", name: "A 1080", resolution: ["1080p"] },
    ],
    activeFilter: "a4k",
    badgeRules: [{ id: "mine-a", label: "Mine A", pattern: "mine" }],
  });
  c.profiles.create({ name: "B" });
  const b = c.profiles.store.list.find((p) => p.id !== a).id;
  c.profiles.switch({ id: b });
  c.settings({
    streamFilters: [{ id: "b720", name: "B 720", resolution: ["720p"] }],
    activeFilter: "b720",
    badgeRules: [{ id: "mine-b", label: "Mine B", pattern: "other" }],
  });
  c.profiles.switch({ id: a });
  const settingsOf = (id) => {
    if (c.profiles.store.active === id) return c.state.settings;
    return c.profiles.store.data[id].settings;
  };
  return { c, a, b, settingsOf };
}
const snapshot = (s) =>
  structuredClone({
    streamFilters: s.streamFilters,
    activeFilter: s.activeFilter,
    badgeRules: s.badgeRules,
    badgeArt: s.badgeArt,
    badgeStyleArt: s.badgeStyleArt,
    sourceFacets: s.sourceFacets,
    sourceFacetsRemember: s.sourceFacetsRemember,
  });

test("F2: delete in A, switch to B, Undo: B untouched, A keeps the deletion", () => {
  const { c, a, b, settingsOf } = twoProfiles();
  c.streamFilterEdit({ profileId: a, action: "remove", id: "a4k" });
  assert.deepEqual(
    settingsOf(a).streamFilters.map((f) => f.id),
    ["a1080"],
  );
  c.profiles.switch({ id: b });
  const before = snapshot(settingsOf(b));
  assert.throws(
    () => c.streamFilterEdit({ profileId: a, action: "restore", id: "a4k" }),
    { message: PROFILE_CHANGED },
  );
  assert.deepEqual(snapshot(settingsOf(b)), before);
  // An Undo naming B for A's filter finds nothing to restore in B.
  const r = c.streamFilterEdit({ profileId: b, action: "restore", id: "a4k" });
  assert.equal(r.restored, false);
  assert.deepEqual(snapshot(settingsOf(b)), before);
  assert.deepEqual(
    settingsOf(a).streamFilters.map((f) => f.id),
    ["a1080"],
  );
});

test("F2: delete, leave Settings, Undo in the same profile restores on the current list", () => {
  const { c, a, settingsOf } = twoProfiles();
  c.streamFilterEdit({ profileId: a, action: "remove", id: "a4k" });
  // Something else changed the list meanwhile (another page, another tab).
  c.settings({
    profileId: a,
    streamFilters: [
      ...settingsOf(a).streamFilters,
      { id: "new", name: "New", resolution: ["720p"] },
    ],
  });
  const r = c.streamFilterEdit({ profileId: a, action: "restore", id: "a4k" });
  assert.equal(r.restored, true);
  assert.deepEqual(
    settingsOf(a).streamFilters.map((f) => f.id),
    ["a4k", "a1080", "new"],
    "the later addition is kept, the filter back in its place",
  );
  assert.equal(settingsOf(a).activeFilter, "a4k");
  // Undo once only.
  assert.equal(
    c.streamFilterEdit({ profileId: a, action: "restore", id: "a4k" }).restored,
    false,
  );
});

test("F2: a filter edit without the profile it was made for is refused", () => {
  const { c } = twoProfiles();
  for (const profileId of [undefined, "", "someone-else"])
    assert.throws(
      () => c.streamFilterEdit({ profileId, action: "remove", id: "a4k" }),
      { message: PROFILE_CHANGED },
    );
});

const PACK = JSON.stringify({
  filters: [
    {
      id: "res-4k",
      groupId: "resolution",
      name: "4K UHD",
      pattern: "(?i)\\b(2160p|4k)\\b",
      imageURL:
        "https://raw.githubusercontent.com/farizmohd70/FR-Badges/main/Badges-Frost/4k-uhd.png",
      isEnabled: true,
      type: "filter",
    },
    {
      id: "rd",
      groupId: "debrid",
      name: "Real-Debrid",
      pattern: "(?i)\\[rd\\+?\\]",
      imageURL: "https://evil.example/track.png",
      isEnabled: true,
      type: "filter",
    },
  ],
});

test("F2: an FR download that finishes after a switch changes neither profile", async () => {
  const { c, a, b, settingsOf } = twoProfiles();
  const beforeA = snapshot(settingsOf(a));
  const beforeB = snapshot(settingsOf(b));
  let release;
  const pending = c.applyBadgeStyle(
    { look: "fr-frost", profileId: a },
    () => new Promise((r) => (release = () => r(PACK))),
  );
  c.profiles.switch({ id: b });
  release();
  await assert.rejects(pending, { message: PROFILE_CHANGED });
  assert.deepEqual(snapshot(settingsOf(b)), beforeB);
  assert.deepEqual(snapshot(settingsOf(a)), beforeA);
});

test("F2: an FR download that fails after a switch changes nothing", async () => {
  const { c, a, b, settingsOf } = twoProfiles();
  const beforeB = snapshot(settingsOf(b));
  const pending = c.applyBadgeStyle({ look: "fr-frost", profileId: a }, () => {
    c.profiles.switch({ id: b });
    return Promise.reject(new Error("offline"));
  });
  await assert.rejects(pending, /offline/);
  assert.deepEqual(snapshot(settingsOf(b)), beforeB);
});

test("F2: an FR download for the active profile builds on its rules as they are on arrival", async () => {
  const { c, a, settingsOf } = twoProfiles();
  let release;
  const pending = c.applyBadgeStyle(
    { look: "fr-frost", profileId: a },
    () => new Promise((r) => (release = () => r(PACK))),
  );
  // The viewer adds a rule while the file downloads.
  c.settings({
    badgeRules: [
      ...settingsOf(a).badgeRules,
      { id: "late", label: "Late", pattern: "late" },
    ],
  });
  release();
  const { report } = await pending;
  const ids = settingsOf(a).badgeRules.map((r) => r.label);
  assert.deepEqual(ids.slice(0, 2), ["Mine A", "Late"]);
  assert.equal(ids.length, 2 + report.loaded);
  // A picture outside FR-Badges is dropped; theirs is pinned. The 4K badge
  // with a picture became the 4K chip's picture (the importer's rule), in
  // the style's own field.
  const rd = settingsOf(a).badgeRules.find((r) => r.label === "Real-Debrid");
  assert.equal(rd.image, undefined);
  assert.deepEqual(settingsOf(a).badgeStyleArt, {
    "4k": `${FR_BASE}Badges-Frost/4k-uhd.png`,
  });
  assert.deepEqual(settingsOf(a).badgeArt, {});
});

test("F2: a remembered-filters save after a switch is refused; B untouched", () => {
  const { c, a, b, settingsOf } = twoProfiles();
  c.settings({ sourceFacetsRemember: true, sourceFacets: {} });
  c.profiles.switch({ id: b });
  c.settings({
    sourceFacetsRemember: true,
    sourceFacets: { quality: ["720p"] },
  });
  const beforeB = snapshot(settingsOf(b));
  assert.throws(
    () => c.settings({ profileId: a, sourceFacets: { quality: ["2160p"] } }),
    { message: PROFILE_CHANGED },
  );
  assert.deepEqual(snapshot(settingsOf(b)), beforeB);
});

test("F2: a remembered-filters save after Remember went off is dropped", () => {
  const { c, a, settingsOf } = twoProfiles();
  c.settings({ sourceFacetsRemember: true, sourceFacets: {} });
  c.settings({ profileId: a, sourceFacetsRemember: false, sourceFacets: {} });
  c.settings({ profileId: a, sourceFacets: { quality: ["2160p"] } });
  assert.deepEqual(settingsOf(a).sourceFacets, {});
  assert.equal(settingsOf(a).sourceFacetsRemember, false);
});

test("F2: rapid switches and work from both profiles stay apart", async () => {
  const { c, a, b, settingsOf } = twoProfiles();
  const releases = [];
  const later = (text) => () =>
    new Promise((r) => releases.push(() => r(text)));
  const fromA = c.applyBadgeStyle(
    { look: "fr-frost", profileId: a },
    later(PACK),
  );
  c.profiles.switch({ id: b });
  const fromB = c.applyBadgeStyle(
    { look: "fr-glass", profileId: b },
    later(PACK),
  );
  c.streamFilterEdit({ profileId: b, action: "remove", id: "b720" });
  for (let i = 0; i < 5; i++) {
    c.profiles.switch({ id: a });
    c.profiles.switch({ id: b });
  }
  releases.forEach((r) => r());
  await assert.rejects(fromA, { message: PROFILE_CHANGED });
  // B is active again, but as a new activation: what it started before the
  // round trips no longer writes (second review, F2).
  await assert.rejects(fromB, { message: PROFILE_CHANGED });
  assert.equal(settingsOf(b).badgeLook, "riwaq");
  assert.deepEqual(settingsOf(b).streamFilters, []);
  assert.equal(settingsOf(a).badgeLook, "riwaq");
  assert.deepEqual(
    settingsOf(a).streamFilters.map((f) => f.id),
    ["a4k", "a1080"],
  );
  assert.ok(!settingsOf(a).badgeRules.some((r) => r.pack));
});

test("F2: settings without a profile still work as before", () => {
  const { c, a, settingsOf } = twoProfiles();
  c.settings({ pickerLayout: "compact" });
  assert.equal(settingsOf(a).pickerLayout, "compact");
  c.settings({ profileId: a, pickerLayout: "detailed" });
  assert.equal(settingsOf(a).pickerLayout, "detailed");
  assert.equal("profileId" in settingsOf(a), false);
});

test("F2: the interface binds every delayed write to its profile", () => {
  const details = read("src/components/Details.jsx");
  assert.match(
    details,
    /update\("settings", \{ sourceFacets: next, profileSession \}\)/,
  );
  assert.match(
    details,
    /useEffect\(\(\) => \(\) => clearTimeout\(facetSave\.current\), \[\]\)/,
  );
  const pages = read("src/components/settings/SourcePages.jsx");
  assert.match(
    pages,
    /act\("streamFilterEdit", \{\s*profileSession,\s*action: "restore"/,
  );
  assert.match(
    pages,
    /call\("badgeStyleApply", \{\s*look,\s*profileSession: state\.profiles\?\.session/,
  );
  assert.doesNotMatch(pages, /latestFilters|badgeStyleFetch/);
  for (const file of [
    "electron/preload.cjs",
    "electron/main.mjs",
    "web/bridge.js",
  ]) {
    const source = read(file);
    assert.match(source, /streamFilterEdit/, file);
    assert.match(source, /badgeStyleApply/, file);
    assert.doesNotMatch(source, /badgeStyleFetch/, file);
  }
});

/* F6: the viewer's badge pictures and "Off". */

test("F6: an FR style never replaces the viewer's own 4K picture, and leaving it keeps it", () => {
  const mine = "https://img.example/my-4k.png";
  const settings = { badgeArt: { "4k": mine }, badgeRules: [] };
  const pack = importBadgePack(
    JSON.stringify({
      filters: [
        {
          id: "x",
          name: "4K",
          pattern: "4k",
          imageURL: `${FR_BASE}a/4k.png`,
          isEnabled: true,
        },
      ],
    }),
    undefined,
    { name: "fr-frost" },
  );
  pack.art = { "4k": `${FR_BASE}a/4k-art.png`, hdr: `${FR_BASE}a/hdr.png` };
  const { patch } = chooseFrStyle(settings, pack, "fr-frost");
  assert.deepEqual(patch.badgeArt, { "4k": mine }, "the viewer's stays theirs");
  const shown = chipPictures(patch);
  assert.equal(shown["4k"], mine, "drawn first");
  assert.equal(shown.hdr, `${FR_BASE}a/hdr.png`, "the style fills the rest");
  // Back to Riwaq's look, Liquid Glass, Minimal, Off, and Riwaq again.
  let now = { ...settings, ...patch };
  for (const look of ["riwaq", "liquid"]) {
    now = { ...now, ...chooseLook(now, look) };
    assert.deepEqual(now.badgeArt, { "4k": mine }, look);
    assert.deepEqual(now.badgeStyleArt, {}, look);
  }
  now = { ...now, ...chooseFrStyle(now, pack, "fr-minimal").patch };
  now = { ...now, badgesOn: false };
  assert.deepEqual(now.badgeArt, { "4k": mine });
  now = { ...now, ...chooseLook(now, "riwaq") };
  assert.deepEqual(now.badgeArt, { "4k": mine });
});

test("F6: Off hides an FR style's badges and keeps the viewer's own", async () => {
  const { c, a, settingsOf } = twoProfiles();
  await c.applyBadgeStyle({ look: "fr-frost", profileId: a }, async () => PACK);
  const badges = [
    { label: "Mine A" },
    { label: "4K UHD", group: "resolution", pack: "FR-Badges Frost" },
  ];
  assert.equal(visibleBadges(badges, settingsOf(a)).length, 2);
  c.settings({ badgesOn: false });
  assert.deepEqual(
    visibleBadges(badges, settingsOf(a)).map((b) => b.label),
    ["Mine A"],
  );
  // And core does not even try the style's rules while badges are off.
  const source = read("core/client.mjs");
  assert.match(
    source,
    /cleanBadgeRules\(settings\.badgeRules\)\.filter\(\s*\(r\) => settings\.badgesOn !== false \|\| !isFrRule\(r\),?\s*\)/,
  );
});

/* The FR-Badges fetch: one pinned commit, bounded, checked. */

const respond =
  (body, { status = 200, type = "text/plain", length } = {}) =>
  async () => {
    const bytes =
      typeof body === "string" ? new TextEncoder().encode(body) : body;
    return new Response(bytes, {
      status,
      headers: {
        "content-type": type,
        ...(length !== undefined ? { "content-length": String(length) } : {}),
      },
    });
  };

test("FR: only the pinned addresses, at one commit", () => {
  assert.match(FR_BASE, /\/FR-Badges\/[0-9a-f]{40}\/$/);
  for (const look of Object.keys(FR_STYLES))
    assert.ok(frStyleUrl(look).startsWith(FR_BASE));
  assert.equal(frStyleUrl("https://evil.example/x.json"), "");
  assert.equal(
    frImage(
      "https://raw.githubusercontent.com/farizmohd70/FR-Badges/main/A/b.png",
    ),
    `${FR_BASE}A/b.png`,
  );
  assert.equal(
    frImage("https://raw.githubusercontent.com/other/repo/main/x.png"),
    "",
  );
  assert.equal(frImage(`${FR_BASE}../../other/x.png`), "");
  assert.equal(frImage(`${FR_BASE}a/../b.png`), "");
  assert.equal(
    frImage(
      "http://raw.githubusercontent.com/farizmohd70/FR-Badges/main/x.png",
    ),
    "",
  );
});

test("FR: a different file, a huge one, HTML and a redirect are refused", async () => {
  const url = frStyleUrl("fr-frost");
  await assert.rejects(
    fetchFrStyle("https://evil.example/badges.json", { fetch: respond("{}") }),
    /نمط غير معروف/,
  );
  await assert.rejects(fetchFrStyle(url, { fetch: respond("{}") }), /لا يطابق/);
  await assert.rejects(
    fetchFrStyle(url, { fetch: respond("x", { length: FR_MAX_BYTES + 1 }) }),
    /أكبر/,
  );
  // A body bigger than its header said, streamed: cut off at the limit.
  let pulled = 0;
  const endless = new ReadableStream({
    pull(controller) {
      pulled += 65536;
      controller.enqueue(new Uint8Array(65536));
    },
  });
  await assert.rejects(
    fetchFrStyle(url, {
      fetch: async () =>
        new Response(endless, { headers: { "content-type": "text/plain" } }),
    }),
    /أكبر/,
  );
  assert.ok(pulled <= FR_MAX_BYTES + 2 * 65536, `read ${pulled} bytes`);
  await assert.rejects(
    fetchFrStyle(url, { fetch: respond("<html>", { type: "text/html" }) }),
    /ليس نصاً/,
  );
  await assert.rejects(
    fetchFrStyle(url, { fetch: respond("", { status: 404 }) }),
    /404/,
  );
  let options;
  await assert.rejects(
    fetchFrStyle(url, {
      fetch: async (_, o) => {
        options = o;
        throw new TypeError("redirect");
      },
    }),
    /تعذّر/,
  );
  assert.equal(options.redirect, "error");
  assert.equal(options.credentials, "omit");
  // A response cut off midway.
  const broken = new ReadableStream({
    pull(controller) {
      controller.error(new Error("reset"));
    },
  });
  await assert.rejects(
    fetchFrStyle(url, { fetch: async () => new Response(broken) }),
    /انقطع/,
  );
});

test("FR: the pinned file with its exact bytes is accepted", async () => {
  // Built to match: a body of the pinned size whose digest we cannot
  // forge is refused, so check the success path with the pin itself.
  const style = FR_STYLES["fr-frost"];
  const body = new Uint8Array(style.bytes);
  await assert.rejects(
    fetchFrStyle(frStyleUrl("fr-frost"), { fetch: respond(body) }),
    /لا يطابق/,
    "right size, wrong bytes",
  );
});
