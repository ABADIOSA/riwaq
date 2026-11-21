// Codex's review of PR #155, F4 and F5: the advanced filters vanished with
// one to four sources, and some explicit facts were read wrongly. The
// sources go through Client.getStreams (the addon's answer as it comes),
// then the facets the picker shows.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Client } from "../core/client.mjs";
import { parseStream } from "../core/stream-engine.mjs";
import {
  applyFacets,
  cleanFacets,
  facetPanel,
  toggleFacet,
} from "../core/source-facets.mjs";
import { filterSources } from "../core/source-view.mjs";

const manifest = {
  id: "fixture.streams",
  name: "Fixture",
  version: "1.0.0",
  resources: ["stream"],
  types: ["movie"],
  idPrefixes: ["tt"],
  catalogs: [],
};
async function streamsOf(list) {
  const c = new Client({
    load: () => ({}),
    save: () => {},
    request: async () => ({
      streams: list.map((s, i) => ({
        url: `https://cdn.example/${i}.mkv`,
        ...s,
      })),
    }),
  });
  c.state.addons = [
    {
      transportUrl: "https://addon.example/manifest.json",
      enabled: true,
      manifest,
    },
  ];
  c.state.settings.streamSafety = "off";
  const r = await c.getStreams({ type: "movie", id: "tt0000001" });
  return r.streams;
}
const panelOf = (streams, chosen = {}) =>
  Object.fromEntries(
    facetPanel(streams, chosen).map((g) => [
      g.id,
      Object.fromEntries(g.values.map((v) => [v.id, v.count])),
    ]),
  );

test("F5: [RD] Not cached is not cached; [RD+] is; [RD] alone is unconfirmed", async () => {
  const streams = await streamsOf([
    { name: "[RD] Not cached", title: "Film 1080p WEB-DL" },
    { name: "[RD+]", title: "Film 1080p BluRay" },
    { name: "[RD]", title: "Film 720p WEBRip" },
    { name: "[AD download]", title: "Film 2160p" },
    { name: "Comet", title: "Film 1080p ⚡ cached [TB]" },
    { name: "Uncached", title: "Film 1080p un-cached [PM]" },
    { name: "Arabic", title: "Film 1080p غير مخزن [RD]" },
  ]);
  const by = (n) => streams.find((s) => s.name === n);
  assert.equal(by("[RD] Not cached").cached, false);
  assert.equal(by("[RD] Not cached").uncached, true);
  assert.equal(by("[RD+]").cached, true);
  assert.equal(by("[RD]").cached, false);
  assert.equal(by("[RD]").uncached, false);
  assert.equal(by("Uncached").cached, false);
  assert.equal(by("Arabic").cached, false);
  const link = panelOf(streams).link;
  assert.equal(link.cached, 2, "[RD+] and ⚡ cached");
  assert.equal(link.uncached, 4, "said not cached, in four ways");
  assert.equal(link.debrid, 1, "[RD]: says neither");
  const cachedOnly = applyFacets(streams, { link: ["cached"] });
  assert.deepEqual(cachedOnly.map((s) => s.name).sort(), ["Comet", "[RD+]"]);
  // The quick "cached" chip agrees.
  assert.deepEqual(
    filterSources(streams, { chips: ["cached"] })
      .map((s) => s.name)
      .sort(),
    ["Comet", "[RD+]"],
  );
});

test("F5: 5.0, 5.1 and 7.1 are different layouts", async () => {
  const streams = await streamsOf([
    { name: "A", title: "Film 1080p DTS 5.0" },
    { name: "B", title: "Film 1080p DDP5.1" },
    { name: "C", title: "Film 2160p TrueHD 7.1" },
    { name: "D", title: "Film 1080p AAC 2.0" },
  ]);
  const channels = panelOf(streams).channels;
  assert.deepEqual(channels, { "5.0": 1, 5.1: 1, 7.1: 1, "2.0": 1 });
  assert.deepEqual(
    applyFacets(streams, { channels: ["5.1"] }).map((s) => s.name),
    ["B"],
  );
});

test("F5: DTS:X is DTS:X, not also plain DTS; DTS-HD and DTS stay apart", async () => {
  const streams = await streamsOf([
    { name: "X", title: "Film 2160p DTS:X 7.1" },
    { name: "XA", title: "Film 2160p Atmos DTS:X" },
    { name: "HD", title: "Film 1080p DTS-HD MA 5.1" },
    { name: "Plain", title: "Film 1080p DTS 5.1" },
  ]);
  assert.equal(parseStream({ title: "Film DTS:X" }).audio, "DTS-X");
  assert.equal(parseStream({ title: "Film DTS:X 7.1" }).channels, "7.1");
  const audio = panelOf(streams).audio;
  assert.equal(audio["DTS-X"], 2);
  assert.equal(audio["DTS-HD"], 1);
  assert.equal(audio.DTS, 1, "only the plain one");
  assert.deepEqual(
    applyFacets(streams, { audio: ["DTS"] }).map((s) => s.name),
    ["Plain"],
  );
});

test("F5: TrueHD and English subtitles named only in the description count", async () => {
  const streams = await streamsOf([
    {
      name: "Remux",
      title: "Film.2024.2160p.REMUX",
      description: "Atmos · TrueHD 7.1 · English subs",
    },
    { name: "Web", title: "Film 1080p WEB-DL", description: "AAC 2.0" },
  ]);
  const remux = streams.find((s) => s.name === "Remux");
  assert.equal(remux.description, "Atmos · TrueHD 7.1 · English subs");
  const panel = panelOf(streams);
  assert.equal(panel.audio.TrueHD, 1);
  assert.equal(panel.audio.Atmos, 1);
  assert.equal(panel.language.enSub, 1);
  assert.equal(panel.channels["7.1"], 1);
  assert.deepEqual(
    applyFacets(streams, { audio: ["TrueHD"], language: ["enSub"] }).map(
      (s) => s.name,
    ),
    ["Remux"],
  );
  // The search finds it too.
  assert.deepEqual(
    filterSources(streams, { query: "truehd" }).map((s) => s.name),
    ["Remux"],
  );
  // A description equal to the title is not repeated.
  const same = await streamsOf([
    { name: "S", title: "Film 1080p", description: "Film 1080p" },
  ]);
  assert.equal(same[0].description, undefined);
  // A description alone stands as the title, as before.
  const only = await streamsOf([{ name: "O", description: "Film 720p AAC" }]);
  assert.equal(only[0].title, "Film 720p AAC");
  assert.equal(only[0].description, undefined);
});

test("F5: each recognised language is its own value; none is invented", async () => {
  const streams = await streamsOf([
    { name: "Fr", title: "Film 1080p FRENCH" },
    { name: "Ja", title: "Film 1080p Japanese" },
    { name: "JaFr", title: "Film 1080p VOSTFR jpn" },
    { name: "En", title: "Film 1080p English" },
    { name: "None", title: "Film 1080p" },
  ]);
  const language = panelOf(streams).language;
  assert.equal(language["lang:fr"], 2);
  assert.equal(language["lang:ja"], 2);
  assert.equal(language.en, 1);
  assert.equal(language.unknown, 1, "no language named: not reported");
  assert.equal(language.otherLang, undefined, "no lumped 'other'");
  const group = facetPanel(streams).find((g) => g.id === "language");
  const fr = group.values.find((v) => v.id === "lang:fr");
  assert.equal(fr.label, "الفرنسية مذكورة");
  // Chosen values survive cleaning; made-up ones do not.
  assert.deepEqual(
    cleanFacets({ language: ["lang:fr", "lang:x1", "lang:../"] }),
    {
      language: ["lang:fr"],
    },
  );
  assert.deepEqual(
    applyFacets(streams, toggleFacet({}, "language", "lang:ja")).map(
      (s) => s.name,
    ),
    ["Ja", "JaFr"],
  );
});

test("F5: filtering keeps the list's order", async () => {
  const streams = await streamsOf([
    { name: "1", title: "Film 1080p DDP5.1" },
    { name: "2", title: "Film 2160p DDP5.1" },
    { name: "3", title: "Film 720p DDP5.1" },
    { name: "4", title: "Film 1080p AAC" },
  ]);
  const order = streams.map((s) => s.name);
  const kept = applyFacets(streams, { audio: ["DD+"] }).map((s) => s.name);
  assert.deepEqual(
    kept,
    order.filter((n) => n !== "4"),
  );
});

test("F4: the advanced filters are offered with 1–4 sources, not only the search", async () => {
  for (const n of [1, 2, 4]) {
    const streams = await streamsOf(
      Array.from({ length: n }, (_, i) => ({
        name: `P${i}`,
        title: `Film ${["2160p", "1080p", "720p", "480p"][i]} [RD+]`,
      })),
    );
    assert.ok(facetPanel(streams).length > 0, `${n} sources`);
  }
  const details = readFileSync(
    new URL("../src/components/Details.jsx", import.meta.url),
    "utf8",
  );
  // The search and chips keep their threshold; the filters sit outside it.
  const tools = details.slice(
    details.indexOf('<div className="source-tools">'),
  );
  const searchGate = tools.indexOf("(shown.length > 4 || searching) && (");
  const facets = tools.indexOf("<SourceFacets");
  const close = tools.indexOf("</>");
  assert.ok(searchGate > 0 && close > searchGate && facets > close);
  assert.doesNotMatch(
    details,
    /\(shown\.length > 4 \|\| narrowing\) && \(\s*<div className="source-tools">/,
  );
});
