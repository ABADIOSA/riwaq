// Codex's third review of PR #155 (docs/REVIEW-PR-155.md, "Fourth pass"):
// N3 (an older Riwaq export duplicates a collection), N4 (a template folder
// deferred at the folder limit never comes), N5 (subtitle facts denied
// after the words, or said and denied), N6 (copies of one query under other
// labels use up the import limit) and N11 (Discover values replaced by
// defaults, a duplicate Add reported as added). Each case is the
// reviewer's fixture, plus its neighbours.
import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "../core/client.mjs";
import {
  LIMITS,
  applyTemplate,
  cleanCollections,
  editCollections,
  fromNuvio,
  importCollections,
  legacyId,
  legacyMatches,
  toNuvio,
} from "../core/collections.mjs";
import { presetCollection } from "../core/collection-presets.mjs";
import { tmdbRequest } from "../core/collection-sources.mjs";
import { applyFacets } from "../core/source-facets.mjs";
import {
  EN_SUB_RX,
  affirms,
  states,
  parseStream,
} from "../core/stream-engine.mjs";

/* N3: an export written by the second-review build (b9d946e). */

// Exactly what b9d946e's toNuvio wrote for a stored "nuvio-riwaq-curated"
// collection with a "nuvio-riwaq-picks" folder (generated from that
// commit's core/collections.mjs): the "nuvio-" prefix is gone, so the file
// cannot say whether it means "curated" or "nuvio-riwaq-curated".
const B9D946E_EXPORT = JSON.stringify([
  {
    id: "riwaq-curated",
    title: "Curated",
    backdropImageUrl: null,
    pinToTop: false,
    viewMode: "TABBED_GRID",
    showAllTab: true,
    folders: [
      {
        id: "riwaq-picks",
        title: "Picks",
        coverImageUrl: null,
        focusGifUrl: null,
        focusGifEnabled: false,
        heroBackdropUrl: null,
        titleLogoUrl: null,
        focusGlowEnabled: false,
        coverEmoji: null,
        tileShape: "POSTER",
        hideTitle: false,
        sources: [
          {
            provider: "tmdb",
            tmdbSourceType: "DISCOVER",
            tmdbId: null,
            mediaType: "MOVIE",
            sortBy: "popularity.desc",
            title: null,
            filters: { withGenres: "18" },
          },
        ],
      },
    ],
  },
]);
const stored = () =>
  cleanCollections([
    {
      id: "nuvio-riwaq-curated",
      title: "Curated",
      cover: "local:" + "a".repeat(32),
      folders: [
        {
          id: "nuvio-riwaq-picks",
          title: "Picks",
          titles: [{ id: "tt0111161", type: "movie", name: "Kept by hand" }],
          tmdb: [
            { kind: "discover", media: "movie", filters: { withGenres: "18" } },
          ],
        },
      ],
    },
  ]);

test("N3: the older reading of a Riwaq-form ID is known, and only for that form", () => {
  assert.equal(legacyId("riwaq-curated"), "nuvio-riwaq-curated");
  assert.equal(legacyId("curated"), undefined);
  assert.equal(legacyId("nuvio-curated"), undefined);
  assert.equal(legacyId(7), undefined);
});

test("N3: a merge of the older export asks first and changes nothing without an answer", () => {
  const converted = fromNuvio(B9D946E_EXPORT);
  assert.equal(converted.collections[0].id, "curated");
  const matches = legacyMatches(stored(), converted);
  assert.deepEqual(matches, [
    {
      id: "curated",
      title: "Curated",
      match: "nuvio-riwaq-curated",
      mine: "Curated",
    },
  ]);
  assert.throws(
    () =>
      importCollections(stored(), converted.collections, {
        mode: "merge",
        aliases: converted.report.aliases,
      }),
    /اختر لكل مجموعة من نسخة أقدم/,
  );
});

test("N3: answered 'it is mine', it updates the viewer's collection and folder in place: no copy", () => {
  const converted = fromNuvio(B9D946E_EXPORT);
  const { collections, report } = importCollections(
    stored(),
    converted.collections,
    {
      mode: "merge",
      aliases: converted.report.aliases,
      legacy: { curated: "match" },
    },
  );
  assert.deepEqual(
    collections.map((c) => c.id),
    ["nuvio-riwaq-curated"],
  );
  const [folder] = collections[0].folders;
  assert.equal(folder.id, "nuvio-riwaq-picks");
  assert.equal(
    folder.titles[0].name,
    "Kept by hand",
    "hand-picked titles stay",
  );
  assert.equal(collections[0].cover, "local:" + "a".repeat(32));
  assert.equal(report.updated, 1);
  assert.equal(report.added, 0);
  // Importing the same file the same way again changes nothing more.
  const again = importCollections(collections, converted.collections, {
    mode: "merge",
    aliases: converted.report.aliases,
    legacy: { curated: "match" },
  });
  assert.deepEqual(again.collections, collections);
});

test("N3: answered 'a new one', it is added beside the viewer's, as asked", () => {
  const converted = fromNuvio(B9D946E_EXPORT);
  const { collections } = importCollections(stored(), converted.collections, {
    mode: "merge",
    aliases: converted.report.aliases,
    legacy: { curated: "copy" },
  });
  assert.deepEqual(
    collections.map((c) => c.id),
    ["nuvio-riwaq-curated", "curated"],
  );
});

test("N3: a current export of the same collection round-trips with no question", () => {
  const file = JSON.stringify(toNuvio(stored()));
  const converted = fromNuvio(file);
  assert.deepEqual(legacyMatches(stored(), converted), []);
  const { collections } = importCollections(stored(), converted.collections, {
    mode: "merge",
    aliases: converted.report.aliases,
  });
  assert.deepEqual(
    collections.map((c) => c.id),
    ["nuvio-riwaq-curated"],
  );
});

test("N3: the Client asks through the same paste import, and Add copies and Replace never ask", () => {
  const c = new Client({ load: () => ({}), save: () => {} });
  c.state.collections = stored();
  c.persist();
  const session = c.profiles.session();
  assert.throws(
    () =>
      c.importNuvioCollections({
        text: B9D946E_EXPORT,
        mode: "merge",
        profileSession: session,
      }),
    /نسخة أقدم/,
  );
  assert.deepEqual(
    c.state.collections.map((x) => x.id),
    ["nuvio-riwaq-curated"],
  );
  c.importNuvioCollections({
    text: B9D946E_EXPORT,
    mode: "merge",
    legacy: { curated: "match" },
    profileSession: session,
  });
  assert.deepEqual(
    c.state.collections.map((x) => x.id),
    ["nuvio-riwaq-curated"],
  );
  c.importNuvioCollections({
    text: B9D946E_EXPORT,
    mode: "add",
    profileSession: session,
  });
  assert.equal(c.state.collections.length, 2);
  c.importNuvioCollections({
    text: B9D946E_EXPORT,
    mode: "replace",
    profileSession: session,
  });
  assert.deepEqual(
    c.state.collections.map((x) => x.id),
    ["curated"],
  );
});

/* N4: a template folder deferred at the folder limit. */

test("N4: a new template folder that did not fit comes in once there is room, and only once", () => {
  const preset = presetCollection("international");
  const fillers = Array.from({ length: LIMITS.folders }, (_, i) => ({
    id: `filler-${i}`,
    title: `Filler ${i}`,
  }));
  const [full] = cleanCollections([
    {
      ...preset,
      tplFolders: preset.folders.map((f) => f.id),
      folders: fillers,
    },
  ]);
  const gained = {
    id: "genuinely-new",
    title: "Added later",
    since: "2026-11-18",
  };
  const template = { ...preset, folders: [...preset.folders, gained] };
  const first = applyTemplate([full], template);
  const [atCapacity] = first.collections;
  assert.equal(first.deferred, 1);
  assert.equal(atCapacity.folders.length, LIMITS.folders);
  assert.equal(
    atCapacity.tplFolders.includes(gained.id),
    false,
    "not marked known",
  );
  // Still no room: still deferred, still not known.
  const [stillFull] = applyTemplate([atCapacity], template).collections;
  assert.equal(stillFull.tplFolders.includes(gained.id), false);
  // Room freed: it arrives.
  const [freed] = applyTemplate(
    [{ ...stillFull, folders: stillFull.folders.slice(1) }],
    template,
  ).collections;
  assert.ok(freed.folders.some((f) => f.id === gained.id));
  assert.ok(freed.tplFolders.includes(gained.id));
  // Removed by the viewer afterwards: it stays removed.
  const [removed] = applyTemplate(
    [{ ...freed, folders: freed.folders.filter((f) => f.id !== gained.id) }],
    template,
  ).collections;
  assert.equal(
    removed.folders.some((f) => f.id === gained.id),
    false,
  );
  // The template's own folders the viewer removed earlier stay removed.
  assert.equal(
    removed.folders.some((f) => preset.folders.some((p) => p.id === f.id)),
    false,
  );
});

/* N5: subtitle facts. */

test("N5: denied after the words, said and denied, and 'subbed in English'", () => {
  const cases = [
    ["English subtitles unavailable", false],
    ["English subs: none", false],
    ["English subs N/A", false],
    ["English subtitles not included", false],
    ["English subtitles · No English subs", false],
    ["No English subs", false],
    ["Subbed in English", true],
    ["Subtitles in English", true],
    ["English subtitles", true],
    ["TrueHD · English subtitles · Français · Japanese", true],
  ];
  for (const [text, expected] of cases)
    assert.equal(states(text, EN_SUB_RX), expected, text);
  // A language merely mentioned still counts when one mention stands.
  assert.equal(affirms("English audio, no English subs", /\benglish\b/i), true);
  assert.equal(
    parseStream({ title: "Film ترجمة عربية غير متوفرة" }).arabic.sub,
    false,
  );
  assert.equal(
    parseStream({ title: "Film مترجم · غير مترجم" }).arabic.sub,
    false,
  );
  assert.equal(parseStream({ title: "Film مترجم" }).arabic.sub, true);
  assert.equal(parseStream({ title: "Film مدبلج" }).arabic.dub, true);
});

test("N5: through Client.getStreams and the facets, as the reviewer ran it", async () => {
  const fixtures = [
    ["contradictSubtitle", "English subtitles · No English subs"],
    ["postfixNegation", "English subtitles unavailable"],
    ["subbedInEnglish", "Subbed in English"],
    ["english", "English subtitles"],
    ["negSubtitle", "No English subs"],
    ["multilingual", "TrueHD · English subtitles · Français · Japanese"],
    ["arabicNegative", "بدون ترجمة عربية"],
  ];
  const manifest = {
    id: "org.fixture.streams",
    name: "Fixture",
    version: "1.0.0",
    resources: ["stream"],
    types: ["movie"],
    idPrefixes: ["tt"],
    catalogs: [],
  };
  const c = new Client({
    load: () => ({}),
    save: () => {},
    request: async () => ({
      streams: fixtures.map(([name, description], i) => ({
        name,
        description,
        title: "Film 1080p WEB-DL",
        url: `https://media.example.test/${i}.mp4`,
      })),
    }),
  });
  c.state.addons = [
    {
      manifest,
      enabled: true,
      transportUrl: "https://addon.example.test/manifest.json",
    },
  ];
  c.settings({ streamSafety: "off" });
  const { streams } = await c.getStreams({ type: "movie", id: "tt1030042" });
  const names = applyFacets(streams, { language: ["enSub"] })
    .map((s) => s.name)
    .sort();
  assert.deepEqual(names, ["english", "multilingual", "subbedInEnglish"]);
});

/* N6: one query under several labels. */

test("N6: copies of one TMDB query under other labels are one source, and a different query still fits", () => {
  const sources = [
    ...Array.from({ length: LIMITS.catalogs }, (_, i) => ({
      provider: "tmdb",
      tmdbSourceType: "discover",
      title: `Label ${i}`,
      filters: { withGenres: "18" },
    })),
    {
      provider: "tmdb",
      tmdbSourceType: "discover",
      title: "Unique",
      filters: { withGenres: "28" },
    },
    ...Array.from({ length: LIMITS.catalogs }, () => ({
      provider: "example-format",
      title: "Repeated unsupported",
    })),
    { provider: "example-format", title: "Unique unsupported" },
    ...Array.from({ length: 5 }, (_, i) => ({
      provider: "trakt",
      traktListId: 77,
      title: `Trakt label ${i}`,
    })),
  ];
  const converted = fromNuvio([
    { title: "Fixture", folders: [{ title: "Mixed", sources }] },
  ]);
  const [folder] = converted.collections[0].folders;
  assert.deepEqual(
    folder.tmdb.map((t) => t.filters.withGenres),
    ["18", "28"],
  );
  assert.deepEqual(
    folder.unsupported.map((u) => u.title),
    ["Repeated unsupported", "Unique unsupported"],
  );
  assert.equal(folder.trakt.length, 1);
  assert.equal(converted.report.over.sources, 0);
  assert.equal(
    converted.report.repeated,
    LIMITS.catalogs - 1 + (LIMITS.catalogs - 1) + 4,
  );
});

test("N6: the Client's import keeps the unique sources after the copies", () => {
  const c = new Client({ load: () => ({}), save: () => {} });
  const sources = [
    ...Array.from({ length: LIMITS.catalogs + 5 }, (_, i) => ({
      provider: "tmdb",
      tmdbSourceType: "discover",
      title: `Label ${i}`,
      filters: { withGenres: "18" },
    })),
    {
      provider: "tmdb",
      tmdbSourceType: "discover",
      title: "Late unique",
      filters: { withGenres: "99" },
    },
  ];
  const { result } = c.importNuvioCollections({
    text: JSON.stringify([{ title: "F", folders: [{ title: "S", sources }] }]),
    mode: "replace",
    profileSession: c.profiles.session(),
  });
  const [folder] = c.state.collections[0].folders;
  assert.deepEqual(
    folder.tmdb.map((t) => t.filters.withGenres),
    ["18", "99"],
  );
  assert.equal(result.over.sources, 0);
  assert.equal(result.repeated, LIMITS.catalogs + 4);
});

/* N11: Discover values and a duplicate Add. */

const queries = () =>
  cleanCollections([
    {
      id: "queries",
      title: "Q",
      folders: [
        {
          id: "folder",
          title: "Folder",
          tmdb: [{ kind: "discover", filters: { withGenres: "18" } }],
        },
      ],
    },
  ]);
const edit = (action, source) =>
  editCollections(queries(), {
    action,
    collectionId: "queries",
    folderId: "folder",
    index: 0,
    source,
  });

test("N11: an unknown media type, order or filter name is refused by name, for Add and Update", () => {
  for (const action of ["tmdbAdd", "tmdbUpdate"]) {
    for (const [source, field] of [
      [{ kind: "discover", media: "series" }, "media"],
      [{ kind: "discover", sort: "unsupported.sort" }, "sort"],
      [
        { kind: "discover", filters: { withoutKeyword: "18" } },
        "withoutKeyword",
      ],
      [{ kind: "discover", filters: "18" }, "filters"],
      [{ kind: "nonsense" }, "kind"],
    ]) {
      assert.throws(
        () => edit(action, source),
        (error) => {
          assert.match(error.message, /قيمة غير صالحة في/);
          assert.ok(error.fields.includes(field), `${action} ${field}`);
          return true;
        },
      );
    }
  }
  // Nothing changed.
  assert.deepEqual(queries()[0].folders[0].tmdb.length, 1);
});

test("N11: valid values still save as typed; a duplicate Add says so", () => {
  const [valid] = edit("tmdbAdd", {
    kind: "discover",
    media: "tv",
    sort: "first_air_date.desc",
    filters: { withKeywords: "11|22", year: 2020 },
  })[0].folders[0].tmdb.slice(1);
  assert.equal(valid.media, "tv");
  assert.equal(valid.sort, "first_air_date.desc");
  assert.equal(tmdbRequest(valid).params.with_keywords, "11|22");
  assert.throws(
    () => edit("tmdbAdd", { kind: "discover", filters: { withGenres: "18" } }),
    /في المجلد مصدر بنفس الاستعلام/,
  );
  // A cleared field (empty) is not a problem.
  const [cleared] = edit("tmdbUpdate", {
    kind: "discover",
    media: "movie",
    sort: "",
    filters: { withGenres: "35", year: "" },
  })[0].folders[0].tmdb;
  assert.equal(cleared.filters.withGenres, "35");
});

test("N11: the Client refuses a duplicate Add without writing", () => {
  let writes = 0;
  const c = new Client({ load: () => ({}), save: () => writes++ });
  c.state.collections = queries();
  c.persist();
  const before = writes;
  assert.throws(
    () =>
      c.collectionsEdit({
        action: "tmdbAdd",
        collectionId: "queries",
        folderId: "folder",
        source: { kind: "discover", filters: { withGenres: "18" } },
      }),
    /بنفس الاستعلام/,
  );
  assert.equal(writes, before);
  assert.equal(c.state.collections[0].folders[0].tmdb.length, 1);
});
