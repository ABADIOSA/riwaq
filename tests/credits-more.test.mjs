import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  Credits,
  collectionQuery,
  parseCollections,
  parsePeople,
  peopleQuery,
  searchPhrase,
  trailerOf,
} from "../core/credits.mjs";
import { HUD_METHODS } from "../core/hud.mjs";

const uri = (q) => ({
  type: "uri",
  value: `http://www.wikidata.org/entity/${q}`,
});
const lit = (value) => ({ type: "literal", value });
const reply = (bindings) => ({ head: { vars: [] }, results: { bindings } });
const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("a series row lists every part in order and marks this one", () => {
  const row = (series, name, id, title, date, ordinal) => ({
    series: uri(series),
    seriesLabel: lit(name),
    work: uri(`Q${id.slice(2)}`),
    workLabel: lit(title),
    imdb: lit(id),
    ...(date ? { date: lit(`${date}-07-01T00:00:00Z`) } : {}),
    ...(ordinal ? { ordinal: lit(String(ordinal)) } : {}),
  });
  const collections = parseCollections(
    reply([
      row(
        "Q1",
        "ثلاثية فارس الظلام",
        "tt1345836",
        "فارس الظلام ينهض",
        "2012",
        3,
      ),
      row("Q1", "ثلاثية فارس الظلام", "tt0372784", "باتمان يبدأ", "2005", 1),
      row("Q1", "ثلاثية فارس الظلام", "tt0468569", "فارس الظلام", "2008", 2),
      // A second date row for the same film keeps the earliest year.
      row("Q1", "ثلاثية فارس الظلام", "tt0468569", "فارس الظلام", "2008"),
      // A bigger franchise the film also belongs to comes second.
      ...["tt0372784", "tt0468569", "tt1345836", "tt0078346"].map((id, i) =>
        row("Q2", "أفلام باتمان", id, `فيلم ${i}`, String(1990 + i)),
      ),
      // A series with this title alone is no row.
      row("Q3", "وحيد", "tt0468569", "فارس الظلام", "2008"),
      // A series that does not contain the title is dropped.
      row("Q4", "غريب", "tt1", "x", "2000"),
      row("Q5", "unresolved", "tt0111161", "Q5", "1994"),
    ]),
    "tt0468569",
  );
  assert.deepEqual(
    collections.map((c) => c.name),
    ["ثلاثية فارس الظلام", "أفلام باتمان"],
  );
  assert.deepEqual(
    collections[0].works.map((w) => [w.id, w.ordinal, w.current]),
    [
      ["tt0372784", 1, false],
      ["tt0468569", 2, true],
      ["tt1345836", 3, false],
    ],
  );
  assert.equal(
    collections[1].works[0].year,
    1990,
    "without ordinals, release order",
  );
  assert.deepEqual(parseCollections(null, "tt1"), []);
});

test("series queries leave out episodes and seasons", () => {
  const q = collectionQuery("tt0468569");
  assert.match(q, /wdt:P345 "tt0468569"/);
  assert.match(q, /wdt:P179 \?series/);
  assert.match(q, /FILTER NOT EXISTS \{ \?work wdt:P31 wd:Q21191270\. \}/);
  assert.match(q, /FILTER NOT EXISTS \{ \?work wdt:P31 wd:Q3464665\. \}/);
});

test("search phrases are one short line", () => {
  assert.equal(searchPhrase("  توم \n هاردي\t"), "توم هاردي");
  assert.equal(searchPhrase("\u0000\u0007x"), "x");
  assert.equal(searchPhrase("a".repeat(200)).length, 80);
  assert.equal(searchPhrase(null), "");
});

const client = (answers) => {
  const seen = [];
  return {
    seen,
    version: "0.11.0",
    state: { settings: {}, providers: {} },
    request: async (url, init) => {
      seen.push({ url, init });
      for (const [match, answer] of answers)
        if (url.includes(match))
          return typeof answer === "function" ? answer(url) : answer;
      throw new Error("HTTP 404");
    },
  };
};

test("people are found by name in Arabic and Latin script", async () => {
  const c = client([
    [
      "language=ar",
      { search: [{ id: "Q208026" }, { id: "Q1" }, { id: "bad" }] },
    ],
    ["language=en", { search: [{ id: "Q208026" }, { id: "Q312380" }] }],
    [
      "query.wikidata.org",
      (url) => {
        const q = decodeURIComponent(url);
        assert.match(q, /VALUES \?item \{ wd:Q208026 wd:Q1 wd:Q312380 \}/);
        return reply([
          {
            item: uri("Q312380"),
            itemLabel: lit("كين واتانابي"),
            tmdb: lit("3899"),
          },
          {
            item: uri("Q208026"),
            itemLabel: lit("توم هاردي"),
            itemDescription: lit("ممثل إنجليزي"),
          },
          { item: uri("Q208026"), itemLabel: lit("توم هاردي") },
        ]);
      },
    ],
  ]);
  const credits = new Credits(c);
  const people = await credits.searchPeople({ query: " Tom\nHardy " });
  assert.deepEqual(
    people.map((p) => [p.qid, p.name, p.tmdb]),
    [
      ["Q208026", "توم هاردي", ""],
      ["Q312380", "كين واتانابي", "3899"],
    ],
    "search order, one each, only film people",
  );
  const api = c.seen.filter((s) => s.url.includes("www.wikidata.org"));
  assert.equal(api.length, 2);
  for (const { url, init } of api) {
    assert.ok(
      url.startsWith(
        "https://www.wikidata.org/w/api.php?action=wbsearchentities&",
      ),
    );
    assert.match(url, /search=Tom%20Hardy$/);
    assert.equal(init.redirect, "error");
    assert.match(init.headers["User-Agent"], /^Riwaq\/0\.11\.0 /);
  }
  assert.deepEqual(await credits.searchPeople({ query: "x" }), []);
  assert.equal(c.seen.length, 3, "a one-letter search sends nothing");
  await credits.searchPeople({ query: "Tom Hardy" });
  assert.equal(c.seen.length, 3, "cached");
  await assert.rejects(
    new Credits(client([])).searchPeople({ query: "Nolan" }),
    /تعذّر البحث/,
  );
  assert.deepEqual(
    await new Credits(
      client([["wbsearchentities", { search: [] }]]),
    ).searchPeople({ query: "zzzz" }),
    [],
  );
});

test("people queries embed only validated QIDs", () => {
  assert.match(peopleQuery(["Q1", "Q2"]), /VALUES \?item \{ wd:Q1 wd:Q2 \}/);
  assert.deepEqual(parsePeople(reply([]), ["Q1"]), []);
});

test("a title's credits include its series rows", async () => {
  const c = client([
    [
      "query.wikidata.org",
      (url) =>
        decodeURIComponent(url).includes("wdt:P179")
          ? reply([
              {
                series: uri("Q1"),
                seriesLabel: lit("S"),
                work: uri("Q2"),
                workLabel: lit("A"),
                imdb: lit("tt0000001"),
              },
              {
                series: uri("Q1"),
                seriesLabel: lit("S"),
                work: uri("Q3"),
                workLabel: lit("B"),
                imdb: lit("tt1375666"),
              },
            ])
          : reply([]),
    ],
  ]);
  const result = await new Credits(c).title({ type: "movie", id: "tt1375666" });
  assert.equal(result.collections[0].works.length, 2);
});

test("a trailer is a YouTube ID from the addon's own metadata", () => {
  assert.equal(
    trailerOf({ trailerStreams: [{ ytId: "YoHD9XEInc0", title: "x" }] }),
    "YoHD9XEInc0",
  );
  assert.equal(
    trailerOf({
      trailers: [
        { source: "aaaaaaaaaaa", type: "Clip" },
        { source: "8hP9D6kZseM", type: "Trailer" },
      ],
    }),
    "8hP9D6kZseM",
  );
  for (const meta of [
    null,
    {},
    { trailerStreams: [{ ytId: "https://evil.example/x" }] },
    { trailers: [{ source: "short" }] },
    { trailers: "x" },
  ])
    assert.equal(trailerOf(meta), "");
  const main = read("electron/main.mjs");
  const at = main.indexOf("openTrailer:");
  const body = main.slice(at, at + 500);
  assert.match(body, /client\.metas\.get/, "main reads its own metadata");
  assert.match(body, /https:\/\/www\.youtube\.com\/watch\?v=\$\{id\}/);
});

test("new actions stay off the HUD bridge", () => {
  const preload = read("electron/preload.cjs");
  for (const method of ["searchPeople", "openTrailer"]) {
    assert.ok(preload.includes(`"${method}"`));
    assert.ok(!HUD_METHODS.has(method));
  }
});

test("the makers sit above the sources on the details page", () => {
  const details = read("src/components/Details.jsx");
  const makers = details.indexOf("<CreditsFacts");
  const streams = details.indexOf('<section className="streams">');
  assert.ok(makers > 0 && streams > 0 && makers < streams);
  assert.ok(details.indexOf("<CollectionRails") < streams);
});
