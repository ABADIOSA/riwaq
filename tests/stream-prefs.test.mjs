import test from "node:test";
import assert from "node:assert/strict";
import {
  applyStreamPrefs,
  cleanStreamFilters,
  matchesFilter,
} from "../core/stream-prefs.mjs";
import {
  cleanBadgeRules,
  exportBadgePack,
  importBadgePack,
  patternProblem,
  ruleBadges,
} from "../core/badges.mjs";
import { DEFAULT_SETTINGS, safeSettings } from "../core/protocol.mjs";
import { Client } from "../core/client.mjs";

const GIB = 1024 ** 3;
const s = (key, extra = {}) => ({
  key,
  score: 50,
  resolution: 1080,
  source: "WEB-DL",
  codec: "AVC",
  audio: "AAC",
  hdr: null,
  cached: false,
  torrent: false,
  seeders: null,
  size: 2 * GIB,
  addonId: "a",
  ...extra,
});

test("saved filters keep only known categories and limits", () => {
  const [f] = cleanStreamFilters([
    {
      id: "f",
      name: " 4K Atmos ",
      resolution: ["4K", "8K"],
      audio: ["Atmos", "Laser"],
      minSeeders: 5.5,
      maxSizeGb: -1,
      requireHdr: "yes",
    },
  ]);
  assert.deepEqual(
    [f.name, f.resolution, f.audio, f.minSeeders, f.maxSizeGb, f.requireHdr],
    ["4K Atmos", ["4K"], ["Atmos"], 0, 0, false],
  );
  assert.equal(cleanStreamFilters([{ id: "x" }, { name: "no id" }]).length, 0);
});

test("a stream must match every category the filter sets", () => {
  const [f] = cleanStreamFilters([
    {
      id: "f",
      name: "f",
      resolution: ["4K"],
      codec: ["HEVC"],
      requireHdr: true,
      maxSizeGb: 40,
      minSeeders: 10,
    },
  ]);
  const good = s("g", {
    resolution: 2160,
    codec: "HEVC",
    hdr: "DV",
    size: 30 * GIB,
  });
  assert.equal(matchesFilter(good, f), true);
  assert.equal(matchesFilter({ ...good, hdr: null }, f), false, "HDR required");
  assert.equal(
    matchesFilter({ ...good, size: 60 * GIB }, f),
    false,
    "too large",
  );
  assert.equal(
    matchesFilter({ ...good, codec: "XviD" }, f),
    false,
    "unknown codec is Other",
  );
  assert.equal(
    matchesFilter({ ...good, torrent: true, seeders: 3 }, f),
    false,
    "too few seeds",
  );
  assert.equal(
    matchesFilter({ ...good, torrent: false, seeders: 0 }, f),
    true,
    "seeds do not apply to direct links",
  );
});

test("mode, order and filter apply, and never leave the picker empty", () => {
  const list = [
    s("t1", { torrent: true, addonId: "b" }),
    s("d1", { addonId: "a" }),
    s("d2", { resolution: 2160, addonId: "c" }),
  ];
  const p2p = applyStreamPrefs(list, { sourceMode: "p2p" });
  assert.deepEqual(
    p2p.streams.map((x) => x.key),
    ["t1"],
  );
  const none = applyStreamPrefs([s("d1")], { sourceMode: "p2p" });
  assert.equal(none.modeFallback, true);
  assert.deepEqual(
    none.streams.map((x) => x.key),
    ["d1"],
    "nothing of that kind: show everything, say so",
  );
  const ordered = applyStreamPrefs(
    list,
    { streamOrder: "addon", addonPriority: ["c", "b"] },
    ["a", "b", "c"],
  );
  assert.deepEqual(
    ordered.streams.map((x) => x.key),
    ["d2", "t1", "d1"],
  );
  const settings = {
    streamFilters: [{ id: "k", name: "4K", resolution: ["4K"] }],
    activeFilter: "k",
  };
  const filtered = applyStreamPrefs(list, settings);
  assert.deepEqual(
    filtered.streams.map((x) => [x.key, x.matches]),
    [
      ["d2", true],
      ["t1", false],
      ["d1", false],
    ],
  );
  assert.deepEqual(filtered.filter, {
    id: "k",
    name: "4K",
    matched: 1,
    fallback: false,
  });
  const nothing = applyStreamPrefs([s("d1")], settings);
  assert.equal(
    nothing.filter.fallback,
    true,
    "nothing matches: the best available stays",
  );
});

test("stream settings are validated, and an active filter must exist", () => {
  const next = safeSettings(
    {
      sourceMode: "direct",
      streamOrder: "addon",
      addonPriority: ["a", "a", "b c", 5],
      streamFilters: [{ id: "f", name: "F" }],
      activeFilter: "f",
      pickerLayout: "compact",
      badgesHidden: ["codec", "nope"],
    },
    DEFAULT_SETTINGS,
  );
  assert.deepEqual(
    [
      next.sourceMode,
      next.streamOrder,
      next.addonPriority,
      next.activeFilter,
      next.pickerLayout,
      next.badgesHidden,
    ],
    ["direct", "addon", ["a"], "f", "compact", ["codec"]],
  );
  assert.equal(
    safeSettings({ activeFilter: "gone" }, DEFAULT_SETTINGS).activeFilter,
    "",
  );
});

test("badge rules refuse patterns that backtrack without end", () => {
  assert.equal(patternProblem("remux|bdremux"), "");
  for (const bad of [
    "(a+)+$",
    "(\\w*)*x",
    "(.+){2,}",
    "([a-z]+)+",
    "(x)\\1",
    "[",
    "",
  ])
    assert.notEqual(patternProblem(bad), "", bad);
  const rules = cleanBadgeRules([
    { id: "r1", label: "REMUX", pattern: "remux", color: "#ff0000" },
    { id: "r2", label: "Evil", pattern: "(a+)+$" },
    { id: "r3", label: "Off", pattern: "web", enabled: false },
    { id: "r4", name: "Group", pattern: "framestor" },
  ]);
  assert.deepEqual(
    rules.map((r) => r.id),
    ["r1", "r3", "r4"],
  );
  assert.equal(rules[0].color, "#FF0000");
  assert.deepEqual(
    ruleBadges(
      { name: "Torrentio", title: "Dune.2160p.REMUX-FraMeSToR.WEB" },
      rules,
    ).map((b) => b.label),
    ["REMUX", "Group"],
    "disabled rules earn nothing",
  );
});

test("packs round-trip, and foreign lists are cleaned the same way", () => {
  const settings = {
    badgeRules: cleanBadgeRules([
      { id: "a", label: "HDR", pattern: "hdr10", color: "#00FF00" },
    ]),
    badgesHidden: ["size"],
  };
  const json = exportBadgePack(settings);
  assert.equal(JSON.parse(json).format, "riwaq-badges");
  const back = importBadgePack(json, (i) => `n${i}`);
  assert.deepEqual(
    back.rules.map((r) => [r.id, r.label, r.pattern]),
    [["n0", "HDR", "hdr10"]],
  );
  assert.deepEqual(back.hidden, ["size"]);
  const foreign = importBadgePack([
    { name: "DV", regex: "\\bdv\\b" },
    { name: "bad", regex: "(a*)*" },
  ]);
  assert.equal(foreign.rules.length, 1);
  assert.equal(foreign.skipped, 1);
  assert.throws(() => importBadgePack("not json"), /JSON/);
  assert.throws(() => importBadgePack({ rules: [] }), /قاعدة صالحة/);
});

test("the client applies the viewer's filter and badges to real addon replies", async () => {
  const client = new Client({
    load: () => ({
      addons: [
        {
          transportUrl: "https://one.example/manifest.json",
          manifest: {
            id: "one",
            name: "One",
            version: "1",
            resources: ["stream"],
            types: ["movie"],
            catalogs: [],
          },
        },
      ],
    }),
    save: () => {},
    request: async () => ({
      streams: [
        {
          url: "https://cdn.example/a.mkv",
          name: "One",
          title: "Film.2024.1080p.WEB-DL.x264",
        },
        {
          url: "https://cdn.example/b.mkv",
          name: "One",
          title: "Film.2024.2160p.BluRay.REMUX.HEVC.DV",
        },
      ],
    }),
  });
  client.state.settings = safeSettings(
    {
      streamFilters: [{ id: "k", name: "4K", resolution: ["4K"] }],
      activeFilter: "k",
      badgeRules: [{ id: "r", label: "REMUX", pattern: "remux" }],
    },
    client.state.settings,
  );
  const result = await client.getStreams({ type: "movie", id: "tt1" });
  assert.equal(result.filter.matched, 1);
  assert.equal(result.streams[0].resolution, 2160);
  assert.equal(result.streams[0].matches, true);
  assert.deepEqual(result.streams[0].badges, [
    { label: "REMUX", color: "#E7B66E" },
  ]);
  assert.equal(result.streams[1].matches, false);
  assert.equal(result.streams[0].addonId, "one");
});
