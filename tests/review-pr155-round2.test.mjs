// Codex's second review of PR #155 (docs/REVIEW-PR-155.md, "Third pass"):
// R1–R10 and the remaining F1/F2/F3/F7/F9 gaps, each as the reviewer
// reproduced it (their in-memory harness, check-collections.mjs, and
// source fixtures), plus the neighbouring cases.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Client, PROFILE_CHANGED, SUPERSEDED } from "../core/client.mjs";
import {
  LIMITS,
  applyTemplate,
  cleanCollections,
  editCollections,
  exportId,
  fromNuvio,
  importCollections,
  nuvioId,
  tmdbFilterProblems,
  toNuvio,
} from "../core/collections.mjs";
import { PRESETS, presetCollection } from "../core/collection-presets.mjs";
import { tmdbRequest } from "../core/collection-sources.mjs";
import { ArtStore, ART_GRACE_MS } from "../core/collection-art.mjs";
import { applyFacets, facetPanel } from "../core/source-facets.mjs";
import { affirms, parseStream } from "../core/stream-engine.mjs";
import { collectBackup } from "../core/backup.mjs";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const titles = (list) => list.map((c) => c.title);

/** A client whose saves can be made to fail, keeping what was last written. */
function failingClient(initial = {}) {
  const disk = { data: structuredClone(initial), fail: false, writes: 0 };
  const c = new Client({
    load: () => structuredClone(disk.data),
    save: (state) => {
      if (disk.fail) throw new Error("synthetic write error");
      disk.data = structuredClone(state);
      disk.writes++;
    },
  });
  return { c, disk };
}
const original = [{ id: "before", title: "Existing collection", folders: [] }];
const REPLACEMENT = JSON.stringify([
  { id: "other", title: "Replacement", folders: [] },
]);

/* R10: a failed Replace (or any failed save) is never written later. */

test("R10: a failed Replace leaves memory and the next unrelated save as before", () => {
  const { c, disk } = failingClient();
  c.state.collections = cleanCollections(original);
  c.persist();
  disk.fail = true;
  assert.throws(
    () =>
      c.importNuvioCollections({
        text: REPLACEMENT,
        mode: "replace",
        only: ["nuvio-other"],
      }),
    /synthetic write error/,
  );
  assert.deepEqual(titles(c.state.collections), ["Existing collection"]);
  // Again: a repeated failure changes nothing either.
  assert.throws(() =>
    c.importNuvioCollections({ text: REPLACEMENT, mode: "replace" }),
  );
  disk.fail = false;
  c.settings({ pickerLayout: "compact" });
  const active = disk.data.profiles.active;
  assert.deepEqual(titles(disk.data.profiles.data[active].collections), [
    "Existing collection",
  ]);
  // After a restart, the stored state is the one before the Replace.
  const again = new Client({
    load: () => structuredClone(disk.data),
    save: () => {},
  });
  assert.deepEqual(titles(again.state.collections), ["Existing collection"]);
  // The backup payload agrees with memory.
  const { payload } = collectBackup(c.state);
  assert.deepEqual(titles(payload.profiles.data[active].collections), [
    "Existing collection",
  ]);
});

test("R10: a failed edit, settings change or template keeps the old values", () => {
  const { c, disk } = failingClient();
  c.state.collections = cleanCollections(original);
  c.persist();
  disk.fail = true;
  assert.throws(() =>
    c.collectionsEdit({ action: "add", title: "Never saved" }),
  );
  assert.throws(() =>
    c.collectionsEdit({ action: "preset", preset: PRESETS[0].id }),
  );
  assert.throws(() => c.settings({ pickerLayout: "compact" }));
  assert.deepEqual(titles(c.state.collections), ["Existing collection"]);
  assert.notEqual(c.state.settings.pickerLayout, "compact");
  disk.fail = false;
  c.persist();
  const active = disk.data.profiles.active;
  assert.deepEqual(titles(disk.data.profiles.data[active].collections), [
    "Existing collection",
  ]);
  assert.notEqual(
    disk.data.profiles.data[active].settings.pickerLayout,
    "compact",
  );
});

test("R10: a failed Replace keeps the pictures its collections named readable", () => {
  const { c, disk } = failingClient();
  const ref = `local:${"a".repeat(32)}`;
  c.state.collections = cleanCollections([
    { id: "art", title: "With a picture", cover: ref, folders: [] },
  ]);
  c.persist();
  disk.fail = true;
  assert.throws(() =>
    c.importNuvioCollections({ text: REPLACEMENT, mode: "replace" }),
  );
  assert.equal(c.canReadArt(ref), true);
});

test("R10: another profile is never touched by a failed save", () => {
  const { c, disk } = failingClient();
  const a = c.profiles.store.active;
  c.profiles.create({ name: "B" });
  const b = c.profiles.store.list.find((p) => p.id !== a).id;
  c.profiles.switch({ id: b });
  c.state.collections = cleanCollections([{ id: "bee", title: "B's" }]);
  c.persist();
  c.profiles.switch({ id: a });
  c.state.collections = cleanCollections(original);
  c.persist();
  disk.fail = true;
  assert.throws(() =>
    c.importNuvioCollections({ text: REPLACEMENT, mode: "replace" }),
  );
  disk.fail = false;
  c.persist();
  assert.deepEqual(titles(disk.data.profiles.data[b].collections), ["B's"]);
  assert.deepEqual(titles(disk.data.profiles.data[a].collections), [
    "Existing collection",
  ]);
});

/* F2: activations, not only profile IDs. */

function twoProfiles() {
  const c = new Client({ load: () => ({}), save: () => {} });
  const a = c.profiles.store.active;
  c.settings({
    streamFilters: [
      { id: "a4k", name: "A 4K", resolution: ["4K"] },
      { id: "a1080", name: "A 1080", resolution: ["1080p"] },
    ],
    activeFilter: "a4k",
  });
  c.profiles.create({ name: "B" });
  const b = c.profiles.store.list.find((p) => p.id !== a).id;
  return { c, a, b };
}

test("F2: A → B → A refuses A's earlier Undo, Remember save and paste import", () => {
  const { c, a, b } = twoProfiles();
  const first = c.profiles.session();
  c.streamFilterEdit({ profileSession: first, action: "remove", id: "a4k" });
  c.profiles.switch({ id: b });
  c.profiles.switch({ id: a });
  assert.notEqual(c.profiles.session(), first);
  assert.equal(c.profiles.store.active, a);
  // The Undo from the first activation finds nothing to restore.
  assert.throws(
    () =>
      c.streamFilterEdit({
        profileSession: first,
        action: "restore",
        id: "a4k",
      }),
    { message: PROFILE_CHANGED },
  );
  assert.deepEqual(
    c.state.settings.streamFilters.map((f) => f.id),
    ["a1080"],
  );
  // Even pressed with the current activation, that Undo was the old one's.
  const now = c.profiles.session();
  const r = c.streamFilterEdit({
    profileSession: now,
    action: "restore",
    id: "a4k",
  });
  assert.equal(r.restored, false);
  assert.throws(
    () =>
      c.settings({ profileSession: first, sourceFacets: { quality: ["4k"] } }),
    { message: PROFILE_CHANGED },
  );
  const before = structuredClone(c.state.collections);
  assert.throws(
    () =>
      c.importNuvioCollections({
        text: REPLACEMENT,
        mode: "replace",
        profileSession: first,
      }),
    { message: PROFILE_CHANGED },
  );
  assert.deepEqual(c.state.collections, before);
});

test("F2: a lock ends the activation; unlocking does not bring old work back", async () => {
  const { c } = twoProfiles();
  c.profiles.setPin({ id: c.profiles.store.active, pin: "1234" });
  assert.equal(c.profiles.unlocked, true);
  let release;
  const slow = c.applyBadgeStyle(
    { look: "fr-frost", profileSession: c.profiles.session() },
    () => new Promise((r) => (release = r)),
  );
  c.profiles.lock();
  c.profiles.unlock("1234");
  release(PACK);
  await assert.rejects(slow, { message: PROFILE_CHANGED });
  assert.equal(c.state.settings.badgeLook || "riwaq", "riwaq");
});

test("F2: a missing, malformed or other profile's session is refused", () => {
  const { c, b } = twoProfiles();
  for (const profileSession of ["", "x:1", `${b}:${c.profiles.epoch}`, null])
    assert.throws(
      () => c.settings({ profileSession, pickerLayout: "compact" }),
      { message: PROFILE_CHANGED },
    );
  assert.notEqual(c.state.settings.pickerLayout, "compact");
  // Without any profile named, a change still applies to the active one.
  c.settings({ pickerLayout: "compact" });
  assert.equal(c.state.settings.pickerLayout, "compact");
});

test("F2: independent work in the same activation all lands", async () => {
  const { c } = twoProfiles();
  const session = c.profiles.session();
  const style = c.applyBadgeStyle(
    { look: "fr-glass", profileSession: session },
    async () => PACK,
  );
  c.streamFilterEdit({ profileSession: session, action: "remove", id: "a4k" });
  c.settings({ profileSession: session, pickerLayout: "compact" });
  await style;
  assert.equal(c.state.settings.badgeLook, "fr-glass");
  assert.equal(c.state.settings.pickerLayout, "compact");
  assert.deepEqual(
    c.state.settings.streamFilters.map((f) => f.id),
    ["a1080"],
  );
});

test("F2: a restore starts a new activation", () => {
  const { c } = twoProfiles();
  const before = c.profiles.session();
  c.profiles.renew();
  assert.notEqual(c.profiles.session(), before);
  assert.match(
    read("core/client.mjs"),
    /this\.profiles\.ensure\(\);\s*\/\/[^\n]*\n\s*this\.profiles\.renew\(\);/,
  );
});

test("F2: a Nuvio import whose addons install across A → B → A writes nothing", async () => {
  let resume;
  let entered;
  const installing = new Promise((r) => (entered = r));
  const c = new Client({
    load: () => ({}),
    save: () => {},
    request: async () => {
      entered();
      return new Promise((r) => (resume = r));
    },
  });
  const a = c.profiles.store.active;
  c.profiles.create({ name: "B" });
  const b = c.profiles.store.list.find((p) => p.id !== a).id;
  const before = structuredClone(c.state.collections);
  const run = c.importNuvio(
    {
      nuvio_addons: {
        installed_addon_urls_1: JSON.stringify([
          "https://example.invalid/manifest.json",
        ]),
      },
      nuvio_collections: {
        collections_1: JSON.stringify([{ title: "Import fixture" }]),
      },
    },
    { profile: 1, parts: { addons: true, collections: true } },
  );
  await installing;
  c.profiles.switch({ id: b });
  c.profiles.switch({ id: a });
  resume({
    id: "org.fixture.catalog",
    name: "Fixture catalog",
    version: "1.0.0",
    resources: ["catalog"],
    types: ["movie"],
    catalogs: [{ id: "featured", type: "movie" }],
  });
  await assert.rejects(run, { message: PROFILE_CHANGED });
  assert.deepEqual(c.state.collections, before);
});

/* R3: the last badge look chosen wins. */

const PACK = JSON.stringify({
  filters: [
    {
      id: "res-4k",
      groupId: "resolution",
      name: "4K UHD",
      pattern: "(?i)\\b(2160p|4k)\\b",
      isEnabled: true,
      type: "filter",
    },
  ],
});
const gate = () => {
  let release;
  const promise = new Promise((r) => (release = r));
  return { fetch: () => promise, release: () => release(PACK) };
};

test("R3: Frost then Glass, Glass first: Frost's late answer is dropped", async () => {
  const c = new Client({ load: () => ({}), save: () => {} });
  const frost = gate();
  const glass = gate();
  const one = c.applyBadgeStyle({ look: "fr-frost" }, frost.fetch);
  const two = c.applyBadgeStyle({ look: "fr-glass" }, glass.fetch);
  glass.release();
  await two;
  assert.equal(c.state.settings.badgeLook, "fr-glass");
  frost.release();
  await assert.rejects(one, { message: SUPERSEDED });
  assert.equal(c.state.settings.badgeLook, "fr-glass");
});

test("R3: Frost pending, page closed and opened, Off: Frost never turns badges back on", async () => {
  const c = new Client({ load: () => ({}), save: () => {} });
  const frost = gate();
  const pending = c.applyBadgeStyle({ look: "fr-frost" }, frost.fetch);
  c.settings({ badgesOn: false });
  frost.release();
  await assert.rejects(pending, { message: SUPERSEDED });
  assert.equal(c.state.settings.badgesOn, false);
  // Riwaq's own look and Liquid Glass count as newer choices too.
  const late = gate();
  const again = c.applyBadgeStyle({ look: "fr-minimal" }, late.fetch);
  c.settings({ badgeLook: "liquid", badgesOn: true });
  late.release();
  await assert.rejects(again, { message: SUPERSEDED });
  assert.equal(c.state.settings.badgeLook, "liquid");
});

test("R3: a failed download changes nothing and a later choice still lands", async () => {
  const c = new Client({ load: () => ({}), save: () => {} });
  await assert.rejects(
    c.applyBadgeStyle({ look: "fr-frost" }, async () => {
      throw new Error("offline");
    }),
  );
  assert.equal(c.state.settings.badgeLook || "riwaq", "riwaq");
  await c.applyBadgeStyle({ look: "fr-glass" }, async () => PACK);
  assert.equal(c.state.settings.badgeLook, "fr-glass");
});

test("R3: the page ignores a superseded reply instead of showing an error", () => {
  const pages = read("src/components/settings/SourcePages.jsx");
  assert.match(pages, /if \(e\.message !== LOOK_SUPERSEDED\)/);
});

/* R2: export IDs read back to exactly the stored ID. */

test("R2: every stored ID survives toNuvio → fromNuvio unchanged", () => {
  const ids = [
    "nuvio-riwaq-curated",
    "riwaq-curated",
    "nuvio-curated",
    "nuvio-nuvio-x",
    "riwaq-riwaq-x",
    "nuvio-riwaq-nuvio-y",
    "curated",
    "12345678-1234-4234-8234-123456789abc",
    "riwaq-preset-international",
    "nuvio-x1a2b3c4d",
    `nuvio-${"z".repeat(58)}`,
    "a".repeat(64),
  ];
  for (const id of ids) {
    assert.equal(nuvioId(exportId(id)), id, id);
    const [c] = cleanCollections([
      {
        id,
        title: id,
        folders: [{ id, title: "F", tmdb: [{ kind: "discover" }] }],
      },
    ]);
    const [back] = fromNuvio(toNuvio([c])).collections;
    assert.equal(back.id, id);
    assert.equal(back.folders[0].id, id);
  }
  // A plain Nuvio ID still goes back to Nuvio as its own.
  assert.equal(exportId("nuvio-catalog"), "catalog");
});

test("R2: a legacy nuvio-riwaq-curated is merged in place, again and again", () => {
  const previous = cleanCollections([
    {
      id: "nuvio-riwaq-curated",
      title: "Curated",
      folders: [
        {
          id: "f",
          title: "One",
          catalogs: [
            { addon: "review.fixture", type: "movie", catalog: "first" },
          ],
        },
      ],
    },
  ]);
  const parsed = fromNuvio(toNuvio(previous)).collections;
  const once = importCollections(previous, parsed, { mode: "merge" });
  assert.deepEqual(
    once.collections.map((c) => c.id),
    ["nuvio-riwaq-curated"],
  );
  const twice = importCollections(once.collections, parsed, { mode: "merge" });
  assert.deepEqual(twice.collections, once.collections);
  const replaced = importCollections(previous, parsed, { mode: "replace" });
  assert.deepEqual(
    replaced.collections.map((c) => c.id),
    ["nuvio-riwaq-curated"],
  );
});

/* R4: a template added before tplFolders keeps its removed folders out. */

test("R4: Update keeps a folder removed from an unstamped template", () => {
  const preset = presetCollection(PRESETS[0].id);
  const [legacy] = cleanCollections([preset]);
  assert.equal(legacy.tplFolders, undefined);
  const [removed, ...kept] = legacy.folders;
  const after = applyTemplate(
    [{ ...legacy, pinned: true, folders: kept }],
    preset,
  ).collections[0];
  assert.equal(after.pinned, true);
  assert.deepEqual(
    after.folders.map((f) => f.id),
    kept.map((f) => f.id),
  );
  assert.ok(!after.folders.some((f) => f.id === removed.id));
  // The marker is written now, so a second update keeps it out too.
  assert.ok(after.tplFolders.includes(removed.id));
  const second = applyTemplate([after], preset).collections[0];
  assert.deepEqual(
    second.folders.map((f) => f.id),
    kept.map((f) => f.id),
  );
});

test("R4: an unstamped folder still as the template follows it; an edited one stays", () => {
  const preset = presetCollection(PRESETS[0].id);
  const [legacy] = cleanCollections([preset]);
  const [same, edited, ...rest] = legacy.folders;
  const mine = {
    ...legacy,
    title: "My name",
    folders: [
      same,
      {
        ...edited,
        title: "My folder",
        tmdb: [{ kind: "discover", media: "tv" }],
      },
      ...rest,
    ],
  };
  const after = applyTemplate([mine], preset).collections[0];
  assert.equal(after.title, "My name");
  const sameAfter = after.folders.find((f) => f.id === same.id);
  assert.ok(sameAfter.tpl, "untouched copy is stamped and follows from now on");
  const editedAfter = after.folders.find((f) => f.id === edited.id);
  assert.equal(editedAfter.title, "My folder");
  assert.equal(editedAfter.tpl, undefined);
  assert.deepEqual(
    editedAfter.tmdb,
    cleanCollections([mine])[0].folders[1].tmdb,
  );
  // A template folder marked as new since the marker comes in.
  const newer = {
    ...preset,
    folders: [
      ...preset.folders,
      {
        id: "riwaq-new-folder",
        title: "New",
        since: 2,
        tmdb: [{ kind: "discover" }],
      },
    ],
  };
  const withNew = applyTemplate([mine], newer).collections[0];
  assert.ok(withNew.folders.some((f) => f.id === "riwaq-new-folder"));
});

/* R6: what the report says is what was kept. */

test("R6: repeats in a folder never squeeze out a unique source", () => {
  const addon = (catalogId) => ({
    provider: "addon",
    addonId: "review.fixture",
    type: "movie",
    catalogId,
  });
  const result = fromNuvio([
    {
      title: "Deduped",
      folders: [
        {
          title: "Catalogs",
          sources: [
            ...Array.from({ length: LIMITS.catalogs }, () =>
              addon("duplicate"),
            ),
            addon("unique"),
          ],
        },
      ],
    },
  ]);
  assert.deepEqual(
    result.collections[0].folders[0].catalogs.map((c) => c.catalog),
    ["duplicate", "unique"],
  );
  assert.equal(result.report.over.sources, 0);
  assert.equal(result.report.repeated, LIMITS.catalogs - 1);
});

test("R6: unsupported rows describe only folders actually written", () => {
  const c = new Client({ load: () => ({}), save: () => {} });
  const full = Array.from({ length: LIMITS.folders }, (_, i) => ({
    id: `nuvio-f${i}`,
    title: `Local ${i}`,
  }));
  c.state.collections = cleanCollections([
    { id: "nuvio-existing", title: "At folder limit", folders: full },
  ]);
  const text = JSON.stringify([
    {
      id: "existing",
      title: "At folder limit",
      folders: [
        {
          id: "f1",
          title: "Can update",
          sources: [{ provider: "x-unknown", title: "Retained" }],
        },
        {
          id: "new",
          title: "No room",
          sources: [{ provider: "x-unknown", title: "Dropped" }],
        },
      ],
    },
  ]);
  const { result } = c.importNuvioCollections({
    text,
    mode: "merge",
    only: ["nuvio-existing"],
  });
  assert.equal(result.skippedSources, 1);
  assert.deepEqual(
    result.unsupported.map((u) => u.title),
    ["Retained"],
  );
  assert.equal(result.skipped, 1);
});

/* R9: one check for adding and changing a Discover query. */

const queryStart = cleanCollections([
  {
    id: "queries",
    title: "Queries",
    folders: [
      {
        id: "options",
        title: "Options",
        tmdb: [
          {
            kind: "discover",
            media: "movie",
            title: "Existing",
            filters: { withGenres: "18" },
          },
        ],
      },
    ],
  },
]);
const editQuery = (action, filters) =>
  editCollections(queryStart, {
    action,
    collectionId: "queries",
    folderId: "options",
    index: 0,
    source: {
      kind: "discover",
      media: "tv",
      sort: "first_air_date.desc",
      filters,
    },
  });

test("R9: separators alone, fractional years, impossible or reversed dates are refused", () => {
  const cases = [
    [{ withKeywords: "|" }, ["withKeywords"]],
    [{ withKeywords: ",,|" }, ["withKeywords"]],
    [{ withGenres: "18,,35" }, ["withGenres"]],
    [{ year: 2020.5 }, ["year"]],
    [{ releaseDateGte: "2025-02-30" }, ["releaseDateGte"]],
    [
      { releaseDateGte: "2025-12-31", releaseDateLte: "2025-01-01" },
      ["releaseDateGte", "releaseDateLte"],
    ],
    [
      { voteAverageGte: 8, voteAverageLte: 5 },
      ["voteAverageGte", "voteAverageLte"],
    ],
    [{ withKeywords: "eighteen" }, ["withKeywords"]],
  ];
  for (const [filters, fields] of cases) {
    assert.deepEqual(
      tmdbFilterProblems(filters),
      fields,
      JSON.stringify(filters),
    );
    for (const action of ["tmdbUpdate", "tmdbAdd"]) {
      let error;
      try {
        editQuery(action, filters);
      } catch (e) {
        error = e;
      }
      assert.ok(error, `${action} ${JSON.stringify(filters)} refused`);
      assert.deepEqual(error.fields, fields);
    }
  }
  // The saved query is untouched by every refusal.
  assert.deepEqual(queryStart[0].folders[0].tmdb[0].filters, {
    withGenres: "18",
  });
});

test("R9: valid values save, a trailing separator is tidied, Add and Update agree", () => {
  const filters = {
    withGenres: "18|10765",
    withKeywords: "818,9672,",
    withoutKeywords: "9717",
    releaseDateGte: "2024-02-29",
    releaseDateLte: "2024-12-31",
    year: 2024,
  };
  assert.deepEqual(tmdbFilterProblems(filters), []);
  const updated = editQuery("tmdbUpdate", filters)[0].folders[0].tmdb[0];
  const added = editQuery("tmdbAdd", filters)[0].folders[0].tmdb[1];
  assert.deepEqual(updated.filters, added.filters);
  assert.equal(updated.filters.withKeywords, "818,9672");
  const request = tmdbRequest(updated);
  assert.equal(request.params.with_keywords, "818,9672");
  assert.equal(request.params["first_air_date.gte"], "2024-02-29");
});

test("R9: the editor shows the refused fields by name and keeps what was typed", () => {
  const ui = read("src/components/Collections.jsx");
  assert.match(ui, /tmdbFilterProblems\(/);
  assert.match(ui, /aria-invalid=/);
});

/* R5: negation and Debrid, through Client.getStreams. */

async function streamsOf(list) {
  const c = new Client({
    load: () => ({}),
    save: () => {},
    request: async () => ({
      streams: list.map(([name, title, description], i) => ({
        url: `https://media.example.test/${i}.mp4`,
        name,
        title,
        description,
      })),
    }),
  });
  c.state.addons = [
    {
      transportUrl: "https://addon.example.test/manifest.json",
      enabled: true,
      manifest: {
        id: "review.synthetic.streams",
        name: "Synthetic",
        version: "1.0.0",
        resources: ["stream"],
        types: ["movie"],
        catalogs: [],
      },
    },
  ];
  c.settings({ streamSafety: "off" });
  return (await c.getStreams({ type: "movie", id: "tt0000555" })).streams;
}

test("R5: the reviewer's fixtures through the whole pipeline", async () => {
  const streams = await streamsOf([
    ["rd-negative", "[RD] Not cached Film 1080p WEB-DL"],
    ["rd-positive", "[RD+] Film 1080p BluRay"],
    ["rd-unspecified", "[RD] Film 720p"],
    ["five-zero", "Film DTS 5.0"],
    ["dts-x", "Film DTS:X 7.1"],
    [
      "description-facts",
      "Film 2160p REMUX",
      "TrueHD Atmos · English subs · Français",
    ],
    ["full-subtitles", "Film 1080p", "TrueHD · English subtitles"],
    ["negated-subtitles", "Film 1080p", "No English subs"],
    ["arabic-negative", "Film 1080p", "بدون ترجمة عربية"],
    ["two-spaces-unavailable", "[RD] Not  cached"],
    ["multiline-negative", "[TB] Not\n cached"],
    ["generic-not-cached", "Film 1080p", "Direct link · Not cached"],
    ["arabic-subbed", "Film 1080p مترجم"],
    ["not-subbed", "Film 1080p غير مترجم"],
  ]);
  const names = (group, value) =>
    applyFacets(streams, { [group]: [value] })
      .map((s) => s.name)
      .sort();
  assert.deepEqual(names("link", "cached"), ["rd-positive"]);
  assert.deepEqual(names("link", "uncached"), [
    "multiline-negative",
    "rd-negative",
    "two-spaces-unavailable",
  ]);
  assert.deepEqual(names("link", "debrid"), ["rd-unspecified"]);
  assert.ok(names("link", "direct").includes("generic-not-cached"));
  assert.deepEqual(names("language", "enSub"), [
    "description-facts",
    "full-subtitles",
  ]);
  assert.deepEqual(names("language", "arSub"), ["arabic-subbed"]);
  assert.ok(names("language", "unknown").includes("negated-subtitles"));
  assert.ok(names("language", "unknown").includes("arabic-negative"));
  // Earlier fixes stay.
  assert.deepEqual(names("audio", "DTS-X"), ["dts-x"]);
  assert.deepEqual(names("channels", "5.0"), ["five-zero"]);
  assert.ok(names("audio", "TrueHD").includes("full-subtitles"));
  const panel = facetPanel(streams).find((g) => g.id === "language");
  assert.ok(panel.values.some((v) => v.id === "enSub" && v.count === 2));
});

test("R5: negation helpers", () => {
  const en = /\benglish\b/i;
  assert.equal(affirms("No English subs", en), false);
  assert.equal(affirms("Without  English", en), false);
  assert.equal(affirms("English audio, no English subs", en), true);
  assert.equal(
    parseStream({ title: "Film بلا ترجمة عربية" }).arabic.sub,
    false,
  );
  assert.equal(parseStream({ title: "Film ترجمة عربية" }).arabic.sub, true);
  assert.equal(parseStream({ title: "Film ⚡ cached" }).cached, true);
  assert.equal(parseStream({ title: "Film cached" }).cached, false);
  assert.equal(parseStream({ title: "Film [AD download]" }).uncached, true);
});

/* Artwork ownership and the sweep. */

test("artwork: a grant needs the activation that picked it, at the grant", () => {
  const { c, a, b } = twoProfiles();
  const ref = `local:${"b".repeat(32)}`;
  const ticket = c.profiles.ticket();
  c.profiles.switch({ id: b });
  c.profiles.switch({ id: a });
  assert.throws(() => c.notePickedArt(ref, ticket), {
    message: PROFILE_CHANGED,
  });
  assert.equal(c.canReadArt(ref), false);
  c.notePickedArt(ref);
  assert.equal(c.canReadArt(ref), true);
  // A re-lock ends what that activation picked.
  c.profiles.setPin({ id: a, pin: "1234" });
  c.profiles.lock();
  c.profiles.unlock("1234");
  assert.equal(c.canReadArt(ref), false);
});

test("artwork: the last reference check and the delete happen in one turn", async () => {
  const files = new Map([["c".repeat(32), { at: 0 }]]);
  let referenced = new Set();
  const store = new ArtStore(
    {
      write: async () => {},
      read: async () => null,
      list: async () => [...files].map(([id, f]) => ({ id, at: f.at })),
      remove: async (id, guard) => {
        // A restore lands while the backend looks for the file.
        await Promise.resolve();
        referenced = new Set([id]);
        if (guard && !guard()) return false;
        files.delete(id);
        return true;
      },
    },
    { now: () => ART_GRACE_MS * 2 },
  );
  assert.equal(await store.sweep(() => referenced), 0);
  assert.ok(files.has("c".repeat(32)), "a re-linked picture is kept");
});

test("artwork: two sweeps at once run one after the other", async () => {
  const files = new Map(["d", "e", "f"].map((x) => [x.repeat(32), { at: 0 }]));
  let inFlight = 0;
  let most = 0;
  const store = new ArtStore(
    {
      write: async () => {},
      read: async () => null,
      list: async () => [...files].map(([id, f]) => ({ id, at: f.at })),
      remove: async (id, guard) => {
        inFlight++;
        most = Math.max(most, inFlight);
        await new Promise((r) => setTimeout(r, 2));
        inFlight--;
        if (!files.has(id) || (guard && !guard())) return false;
        files.delete(id);
        return true;
      },
    },
    { now: () => ART_GRACE_MS * 2 },
  );
  const [one, two] = await Promise.all([
    store.sweep(() => new Set()),
    store.sweep(() => new Set()),
  ]);
  assert.equal(most, 1);
  assert.equal(one + two, 3);
  assert.equal(files.size, 0);
});

test("artwork: main and the web bridge check the activation after each await", () => {
  for (const file of ["electron/main.mjs", "web/bridge.js"]) {
    const source = read(file);
    assert.match(source, /client\.holds\(ticket, "library"\)/, file);
    assert.match(source, /\.forget\(ref\)/, file);
    assert.match(
      source,
      /!client\.profiles\.holds\(ticket\) \|\| client\.profiles\.isLocked\("library"\)/,
      file,
    );
  }
  assert.match(
    read("electron/collection-art.mjs"),
    /if \(guard && !guard\(\)\) return false;\s*try \{\s*unlinkSync/,
  );
  assert.match(
    read("src/App.jsx"),
    /forgetLocalArt\(\), \[state\.profiles\?\.session\]/,
  );
});

/* R1 and R8: the folder page. */

test("R1: every hook of the folder page runs before its 'folder is gone' page", () => {
  const page = read("src/components/FolderPage.jsx");
  const gone = page.indexOf("if (!folder)\n");
  assert.ok(gone > 0);
  const after = page.slice(gone);
  assert.doesNotMatch(after, /\buse(?:Art|State|Effect|Memo|Ref)\(/);
});

test("R8: a broken logo is tied to its address", () => {
  const page = read("src/components/FolderPage.jsx");
  assert.match(page, /brokenLogo === heroLogo/);
  assert.match(page, /setBrokenLogo\(heroLogo\)/);
  const art = read("src/components/CollectionArt.jsx");
  assert.match(art, /brokenLogo === logo/);
});

test("R7: a still slot draws every non-JPEG picture through a canvas", () => {
  const art = read("src/components/CollectionArt.jsx");
  assert.match(art, /const moving = !!src && !surelyStill\(src\);/);
});
