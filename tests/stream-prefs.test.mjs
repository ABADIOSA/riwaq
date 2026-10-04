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

test("addon order keeps each addon's own order, unless Riwaq's is asked for inside", () => {
  // Riwaq ranked these by score; the addons sent them in `order`.
  const ranked = [
    s("b-4k", { addonId: "b", addonKey: "kb", order: 4, score: 90 }),
    s("a-1080", { addonId: "a", addonKey: "ka", order: 1, score: 80 }),
    s("b-720", { addonId: "b", addonKey: "kb", order: 3, score: 40 }),
    s("a-4k", { addonId: "a", addonKey: "ka", order: 0, score: 30 }),
  ];
  const installed = [
    { id: "a", key: "ka" },
    { id: "b", key: "kb" },
  ];
  const own = applyStreamPrefs(ranked, { streamOrder: "addon" }, installed);
  assert.deepEqual(
    own.streams.map((x) => x.key),
    ["a-4k", "a-1080", "b-720", "b-4k"],
    "addon by addon, each in the order it sent",
  );
  const riwaqInside = applyStreamPrefs(
    ranked,
    { streamOrder: "addon", streamOrderInside: "riwaq" },
    installed,
  );
  assert.deepEqual(
    riwaqInside.streams.map((x) => x.key),
    ["a-1080", "a-4k", "b-4k", "b-720"],
  );
  // The viewer's priority wins over install order.
  const placed = applyStreamPrefs(
    ranked,
    { streamOrder: "addon", addonPriority: ["b"] },
    installed,
  );
  assert.deepEqual(
    placed.streams.map((x) => x.key),
    ["b-720", "b-4k", "a-4k", "a-1080"],
  );
  // Riwaq's order is untouched by any of this.
  assert.deepEqual(
    applyStreamPrefs(ranked, {}, installed).streams.map((x) => x.key),
    ranked.map((x) => x.key),
  );
});

test("two copies of one addon (same ID) stay apart, in install order", () => {
  const ranked = [
    s("second-1", { addonId: "aio", addonKey: "k2", order: 2 }),
    s("first-1", { addonId: "aio", addonKey: "k1", order: 0 }),
    s("other", { addonId: "x", addonKey: "kx", order: 4 }),
    s("second-0", { addonId: "aio", addonKey: "k2", order: 1 }),
  ];
  const result = applyStreamPrefs(
    ranked,
    { streamOrder: "addon", addonPriority: ["x", "aio"] },
    [
      { id: "aio", key: "k1" },
      { id: "x", key: "kx" },
      { id: "aio", key: "k2" },
    ],
  );
  assert.deepEqual(
    result.streams.map((x) => x.key),
    ["other", "first-1", "second-0", "second-1"],
  );
  assert.equal(DEFAULT_SETTINGS.streamOrderInside, "addon");
  assert.equal(
    safeSettings({ streamOrderInside: "riwaq" }).streamOrderInside,
    "riwaq",
  );
  assert.equal(
    safeSettings({ streamOrderInside: "random" }).streamOrderInside,
    "addon",
  );
});

test("the client sends sources in the viewer's addon order, as each addon sorted them", async () => {
  const make = (id) => ({
    transportUrl: `https://${id}.example/manifest.json`,
    manifest: {
      id,
      name: id.toUpperCase(),
      version: "1",
      resources: ["stream"],
      types: ["movie"],
      catalogs: [],
    },
  });
  const replies = {
    // Each addon sorts by its own rules: here, smaller files first.
    one: [
      "Film.2024.720p.WEB-DL.x264-ONE",
      "Film.2024.2160p.BluRay.REMUX.HEVC.DV-ONE",
    ],
    two: ["Film.2024.1080p.WEB-DL.x264-TWO", "Film.2024.2160p.WEB-DL.HEVC-TWO"],
  };
  const client = new Client({
    load: () => ({ addons: [make("one"), make("two")] }),
    save: () => {},
    request: async (url) => {
      const id = new URL(url).hostname.split(".")[0];
      return {
        streams: replies[id].map((title, i) => ({
          url: `https://cdn.example/${id}/${i}.mkv`,
          name: id,
          title,
        })),
      };
    },
  });
  const riwaq = await client.getStreams({ type: "movie", id: "tt1" });
  assert.equal(riwaq.order, "riwaq");
  assert.match(riwaq.streams[0].title, /2160p/);
  client.state.settings = safeSettings(
    { streamOrder: "addon", addonPriority: ["two"] },
    client.state.settings,
  );
  const mine = await client.getStreams({
    type: "movie",
    id: "tt1",
    again: true,
  });
  assert.equal(mine.order, "addon");
  assert.deepEqual(
    mine.streams.map((x) => x.title),
    [...replies.two, ...replies.one],
  );
  assert.ok(mine.streams.every((x) => /^[\w-]+$/.test(x.addonKey)));
});
