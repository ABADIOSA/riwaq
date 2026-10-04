import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  SOURCE_CHIPS,
  addonSections,
  chipCounts,
  filterSources,
  sourceText,
} from "../core/source-view.mjs";

const source = (file) =>
  readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8");

const s = (key, extra = {}) => ({
  key,
  name: "AIO",
  title: "",
  provider: "AIOStreams",
  addonKey: "k1",
  resolution: 1080,
  languages: [],
  ...extra,
});
const list = [
  s("remux", {
    title: "Film.2024.2160p.BluRay.REMUX.DV-FraMeSToR",
    group: "FraMeSToR",
    source: "REMUX",
    hdr: "DV",
    resolution: 2160,
    cached: true,
  }),
  s("ar", {
    title: "Film.2024.1080p.WEB-DL.ترجمة.عربية",
    arabicSub: true,
    languages: ["ar"],
  }),
  s("tor", {
    title: "Film.2024.720p.WEBRip",
    torrent: true,
    provider: "Torrentio",
    addonKey: "k2",
  }),
  s("yt", { title: "Trailer", external: true, addonKey: "k2" }),
  s("home", { home: true, provider: "Jellyfin", addonKey: undefined }),
];

test("typed words match names, groups, qualities and Arabic, every word required", () => {
  const keys = (q) => filterSources(list, { query: q }).map((x) => x.key);
  assert.deepEqual(keys("remux"), ["remux"]);
  assert.deepEqual(keys("framestor 2160p"), ["remux"]);
  assert.deepEqual(keys("framestor 720p"), []);
  assert.deepEqual(keys("عربيه"), ["ar"], "Arabic is folded (ة/ه)");
  assert.deepEqual(keys("torrentio"), ["tor"]);
  assert.deepEqual(
    keys("   "),
    list.map((x) => x.key),
  );
  assert.match(sourceText(list[0]), /2160p/);
});

test("quick filters combine, and direct + torrent together means either", () => {
  const keys = (chips) => filterSources(list, { chips }).map((x) => x.key);
  assert.deepEqual(keys(["arabic"]), ["ar"]);
  assert.deepEqual(keys(["cached", "hdr"]), ["remux"]);
  assert.deepEqual(keys(["torrent"]), ["tor"]);
  assert.deepEqual(keys(["direct"]), ["remux", "ar", "home"]);
  assert.deepEqual(keys(["direct", "torrent"]), ["remux", "ar", "tor", "home"]);
  assert.deepEqual(
    keys(["unknown"]),
    list.map((x) => x.key),
  );
  assert.deepEqual(chipCounts(list), {
    arabic: 1,
    cached: 1,
    hdr: 1,
    direct: 3,
    torrent: 1,
  });
  assert.equal(SOURCE_CHIPS.length, 5);
});

test("addon order shows one section per run of one addon copy, in list order", () => {
  const sections = addonSections(list);
  assert.deepEqual(
    sections.map((x) => [x.name, x.streams.length]),
    [
      ["AIOStreams", 2],
      ["Torrentio", 2],
      ["نسختك على خادمك", 1],
    ],
  );
});

test("the title page narrows the view only; the ranked list stays whole", () => {
  const details = source("src/components/Details.jsx");
  assert.match(details, /filterSources\(shown, \{/);
  assert.match(details, /s\.key === shown\[0\]\?\.key \? "recommended"/);
  assert.match(details, /const grouped = result\?\.order === "addon"/);
  // A new request starts with a clear search.
  assert.match(
    details,
    /setArrived\(0\);\s+setSourceQuery\(""\);\s+setSourceChips\(\[\]\);/,
  );
});
