// Issue #154: the source picker's advanced filters (core/source-facets.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import {
  FACET_GROUPS,
  UNKNOWN,
  applyFacets,
  chosenFacets,
  cleanFacets,
  facetCount,
  facetPanel,
  toggleFacet,
} from "../core/source-facets.mjs";

const s = (key, extra = {}) => ({
  key,
  name: "",
  title: "",
  provider: "Addon A",
  addonKey: "a",
  resolution: 0,
  languages: [],
  ...extra,
});
const list = [
  s("remux", {
    title: "Film.2024.2160p.UHD.BluRay.REMUX.DV.HDR.HEVC.TrueHD.Atmos.7.1",
    resolution: 2160,
    source: "REMUX",
    hdr: "DV+HDR10",
    codec: "HEVC",
    audio: "Atmos",
    channels: "7.1",
    cached: true,
    debrid: "RD",
  }),
  s("web", {
    title: "Film.2024.1080p.WEB-DL.DDP5.1.H.264 [eng subs]",
    resolution: 1080,
    source: "WEB-DL",
    codec: "AVC",
    audio: "DD+",
    channels: "5.1",
    torrent: true,
    languages: ["en"],
  }),
  s("arabic", {
    name: "مترجم",
    title: "Film 720p WEBRip AAC",
    resolution: 720,
    source: "WEBRip",
    audio: "AAC",
    arabicSub: true,
    languages: ["ar"],
    provider: "Addon B",
    addonKey: "b",
  }),
  s("bare", { title: "Film", provider: "Addon B", addonKey: "b" }),
  s("sdr", {
    title: "Film 1080p SDR BluRay DTS-HD MA 5.1",
    resolution: 1080,
    source: "BluRay",
    audio: "DTS-HD MA",
    channels: "5.1",
    debrid: "AD",
  }),
];
const keys = (streams) => streams.map((x) => x.key);

test("groups combine with AND, values inside a group with OR", () => {
  assert.deepEqual(keys(applyFacets(list, { quality: ["4k", "720p"] })), [
    "remux",
    "arabic",
  ]);
  assert.deepEqual(
    keys(applyFacets(list, { quality: ["4k", "1080p"], audio: ["Atmos"] })),
    ["remux"],
  );
  // Nothing chosen: the list as it came, same order, same objects.
  assert.equal(applyFacets(list, {}), list);
  assert.deepEqual(keys(applyFacets(list, { quality: ["1080p"] })), [
    "web",
    "sdr",
  ]);
});

test("REMUX is a release type beside the resolution, never a resolution", () => {
  const quality = FACET_GROUPS.find((g) => g.id === "quality");
  assert.ok(!quality.values.some(([id]) => /remux/i.test(id)));
  assert.deepEqual(keys(applyFacets(list, { release: ["REMUX"] })), ["remux"]);
  assert.deepEqual(
    keys(applyFacets(list, { release: ["REMUX"], quality: ["1080p"] })),
    [],
  );
});

test("missing information is 'not reported', never proof of absence", () => {
  // No HDR word does not make a source SDR; only the word does.
  assert.deepEqual(keys(applyFacets(list, { range: ["sdr"] })), ["sdr"]);
  assert.deepEqual(keys(applyFacets(list, { range: [UNKNOWN] })), [
    "web",
    "arabic",
    "bare",
  ]);
  // Dolby Vision with HDR10 counts for both.
  assert.deepEqual(keys(applyFacets(list, { range: ["hdr10"] })), ["remux"]);
  // Cached only with the addon's mark; a debrid name alone is not cached.
  assert.deepEqual(keys(applyFacets(list, { link: ["cached"] })), ["remux"]);
  assert.deepEqual(keys(applyFacets(list, { link: ["debrid"] })), ["sdr"]);
  assert.deepEqual(keys(applyFacets(list, { link: ["torrent"] })), ["web"]);
  // A bare source reports no quality at all.
  assert.deepEqual(keys(applyFacets(list, { quality: [UNKNOWN] })), ["bare"]);
  // Arabic subtitles need the source's own words, not a guess.
  assert.deepEqual(keys(applyFacets(list, { language: ["arSub"] })), [
    "arabic",
  ]);
  assert.deepEqual(keys(applyFacets(list, { language: ["arDub"] })), []);
  assert.deepEqual(keys(applyFacets(list, { language: ["enSub"] })), ["web"]);
});

test("audio formats named together are each a fact", () => {
  assert.deepEqual(keys(applyFacets(list, { audio: ["TrueHD"] })), ["remux"]);
  assert.deepEqual(keys(applyFacets(list, { audio: ["Atmos"] })), ["remux"]);
  assert.deepEqual(keys(applyFacets(list, { audio: ["DTS-HD"] })), ["sdr"]);
  // DTS-HD is not plain DTS; E-AC-3 is Dolby Digital Plus, not Digital.
  assert.deepEqual(keys(applyFacets(list, { audio: ["DTS"] })), []);
  assert.deepEqual(keys(applyFacets(list, { audio: ["DD+"] })), ["web"]);
  const eac3 = [s("e", { title: "x E-AC-3 5.1" })];
  assert.deepEqual(keys(applyFacets(eac3, { audio: ["DD+"] })), ["e"]);
  assert.deepEqual(keys(applyFacets(eac3, { audio: ["DD"] })), []);
  assert.deepEqual(keys(applyFacets(list, { channels: ["5.1"] })), [
    "web",
    "sdr",
  ]);
});

test("counts are what each value would leave, given the other groups", () => {
  const panel = facetPanel(list, { quality: ["1080p"] });
  const group = (id) => panel.find((g) => g.id === id);
  const value = (id, v) => group(id).values.find((x) => x.id === v);
  // The quality group counts against everything else (no other choice).
  assert.equal(value("quality", "4k").count, 1);
  assert.equal(value("quality", "1080p").count, 2);
  assert.equal(value("quality", "1080p").chosen, true);
  assert.equal(value("quality", UNKNOWN).count, 1);
  // Other groups count within the 1080p sources only.
  assert.equal(value("release", "WEB-DL").count, 1);
  assert.equal(value("release", "BluRay").count, 1);
  assert.equal(
    group("release").values.some((v) => v.id === "REMUX"),
    false,
  );
  // An addon group appears with two addons, by name, never by address.
  const addons = facetPanel(list, {}).find((g) => g.id === "addon");
  assert.deepEqual(
    addons.values.map((v) => [v.id, v.label, v.count]),
    [
      ["a", "Addon A", 3],
      ["b", "Addon B", 2],
    ],
  );
  // A group no source reports anything in is left out.
  const plain = facetPanel([s("x"), s("y")], {});
  assert.equal(
    plain.find((g) => g.id === "range"),
    undefined,
  );
});

test("choices are validated, toggled, counted and labelled", () => {
  assert.deepEqual(
    cleanFacets({
      quality: ["4k", "4k", "remux", 3],
      nope: ["x"],
      addon: ["a", "bad value"],
      range: [],
    }),
    { quality: ["4k"], addon: ["a"] },
  );
  assert.deepEqual(cleanFacets(null), {});
  assert.deepEqual(cleanFacets([]), {});
  let chosen = toggleFacet({}, "quality", "4k");
  chosen = toggleFacet(chosen, "audio", "Atmos");
  assert.equal(facetCount(chosen), 2);
  chosen = toggleFacet(chosen, "quality", "4k");
  assert.deepEqual(chosen, { audio: ["Atmos"] });
  assert.deepEqual(
    chosenFacets({ audio: ["Atmos"], addon: ["b"], range: [UNKNOWN] }, list),
    [
      { group: "range", value: UNKNOWN, label: "النطاق الديناميكي: غير مذكور" },
      { group: "audio", value: "Atmos", label: "Dolby Atmos" },
      { group: "addon", value: "b", label: "Addon B" },
    ],
  );
});

test("the panel's groups keep the badge priority order", () => {
  assert.deepEqual(
    FACET_GROUPS.map((g) => g.id),
    [
      "quality",
      "release",
      "range",
      "codec",
      "audio",
      "channels",
      "link",
      "service",
      "language",
      "addon",
    ],
  );
});

test("the engine reads DDP5.1 and DD+ 5.1 as Dolby Digital Plus", async () => {
  const { parseStream } = await import("../core/stream-engine.mjs");
  const audio = (title) => parseStream({ name: "", title }).audio;
  assert.equal(audio("Film.2024.1080p.WEB-DL.DDP5.1.H.264-GRP"), "DD+");
  assert.equal(audio("Film 1080p DD+ 5.1"), "DD+");
  assert.equal(audio("Film DDP2.0"), "DD+");
  assert.equal(audio("Film E-AC-3"), "DD+");
  // Not every word that starts with DDP, and plain Dolby Digital stays.
  assert.equal(audio("Film.DDPA.x264"), "");
  assert.equal(audio("Film DD5.1"), "AC3");
});

test("the engine reads HDR10+ before a space or the end", async () => {
  const { parseStream } = await import("../core/stream-engine.mjs");
  const hdr = (title) => parseStream({ name: "", title }).hdr;
  assert.equal(hdr("Film 4320p 8K HEVC HDR10+ [TB+]"), "HDR10+");
  assert.equal(hdr("Film HDR10+"), "HDR10+");
  assert.equal(hdr("Film.HDR10Plus.x265"), "HDR10+");
  assert.equal(hdr("Film HDR10 x265"), "HDR10");
});
