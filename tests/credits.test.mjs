import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  Credits,
  castQuery,
  commonsImage,
  mapTiles,
  mergeTmdb,
  parseCast,
  parseEntity,
  parseTitle,
  parseTmdbTitle,
  parseWorks,
  titleQuery,
  tmdbImage,
  tmdbWorkCandidates,
} from "../core/credits.mjs";
import { HUD_METHODS } from "../core/hud.mjs";

// Fixtures shaped like query.wikidata.org replies (application/sparql-results+json).
const uri = (q) => ({
  type: "uri",
  value: `http://www.wikidata.org/entity/${q}`,
});
const lit = (value) => ({ type: "literal", value });
const file = (name) => ({
  type: "uri",
  value: `http://commons.wikimedia.org/wiki/Special:FilePath/${name}`,
});
const reply = (bindings) => ({ head: { vars: [] }, results: { bindings } });

const TITLE = reply([
  {
    role: lit("director"),
    who: uri("Q25191"),
    whoLabel: lit("كريستوفر نولان"),
    tmdb: lit("525"),
    image: file("Christopher%20Nolan.jpg"),
  },
  // The same person reached twice through P18 and P154 rows.
  {
    role: lit("director"),
    who: uri("Q25191"),
    whoLabel: lit("كريستوفر نولان"),
  },
  { role: lit("writer"), who: uri("Q25191"), whoLabel: lit("كريستوفر نولان") },
  { role: lit("composer"), who: uri("Q76364"), whoLabel: lit("Hans Zimmer") },
  // An unresolved label comes back as the bare QID and is dropped.
  { role: lit("editor"), who: uri("Q999999"), whoLabel: lit("Q999999") },
  {
    role: lit("company"),
    who: uri("Q126399"),
    whoLabel: lit("Warner Bros."),
    image: file("Warner%20Bros%20logo.svg"),
  },
  {
    role: lit("distributor"),
    who: uri("Q126399"),
    whoLabel: lit("Warner Bros."),
  },
  {
    role: lit("location"),
    who: uri("Q90"),
    whoLabel: lit("باريس"),
    coord: lit("Point(2.35 48.85)"),
  },
  { role: lit("location"), who: uri("Q180673"), whoLabel: lit("Tangier") },
  { role: lit("setting"), who: uri("Q1490"), whoLabel: lit("طوكيو") },
  { role: lit("country"), who: uri("Q30"), whoLabel: lit("الولايات المتحدة") },
  {
    role: lit("award"),
    who: uri("Q131520"),
    whoLabel: lit("Academy Award for Best Cinematography"),
  },
  { role: lit("director"), who: lit("not a uri"), whoLabel: lit("x") },
]);

const CAST = reply([
  {
    who: uri("Q38111"),
    whoLabel: lit("ليوناردو دي كابريو"),
    order: lit("1"),
    characterName: lit("Cobb"),
  },
  {
    who: uri("Q175535"),
    whoLabel: lit("Elliot Page"),
    order: lit("3"),
    characterLabel: lit("Ariadne"),
  },
  {
    who: uri("Q171736"),
    whoLabel: lit("Joseph Gordon-Levitt"),
    order: lit("2"),
    characterName: lit("Arthur"),
  },
  {
    who: uri("Q38111"),
    whoLabel: lit("ليوناردو دي كابريو"),
    order: lit("1"),
    characterName: lit("Dom Cobb"),
  },
  { who: uri("Q19794"), whoLabel: lit("Michael Caine") },
]);

test("title credits: crew by role, companies, places and awards", () => {
  const facts = parseTitle(TITLE);
  assert.deepEqual(
    facts.crew.map((p) => [p.role, p.qid, p.roleLabel]),
    [
      ["director", "Q25191", "الإخراج"],
      ["writer", "Q25191", "الكتابة"],
      ["composer", "Q76364", "الموسيقى"],
    ],
    "one entry per person and role; unresolved labels dropped",
  );
  assert.equal(
    facts.crew[0].image,
    "https://commons.wikimedia.org/wiki/Special:FilePath/Christopher%20Nolan.jpg?width=300",
  );
  assert.deepEqual(
    facts.companies.map((c) => [c.name, c.distributor]),
    [
      ["Warner Bros.", false],
      ["Warner Bros.", true],
    ],
  );
  assert.deepEqual(
    facts.locations.map((l) => [l.qid, l.coord]),
    [
      ["Q90", "Point(2.35 48.85)"],
      ["Q180673", ""],
    ],
  );
  assert.equal(facts.settings[0].name, "طوكيو");
  assert.equal(facts.countries[0].qid, "Q30");
  assert.equal(facts.awards.length, 1);
  assert.deepEqual(parseTitle(null).crew, []);
  assert.deepEqual(parseTitle({ results: { bindings: "x" } }).companies, []);
});

test("cast comes in billing order with one line of characters", () => {
  const cast = parseCast(CAST);
  assert.deepEqual(
    cast.map((c) => [c.name, c.character]),
    [
      ["ليوناردو دي كابريو", "Cobb / Dom Cobb"],
      ["Joseph Gordon-Levitt", "Arthur"],
      ["Elliot Page", "Ariadne"],
      ["Michael Caine", ""],
    ],
  );
  assert.ok(!("order" in cast[0]));
});

test("queries embed only validated identifiers", async () => {
  assert.match(titleQuery("tt1375666"), /wdt:P345 "tt1375666"/);
  assert.match(titleQuery("tt1375666"), /wdt:P915 "location"/);
  assert.match(castQuery("tt1375666"), /pq:P453/);
  const credits = new Credits({
    state: { settings: {}, providers: {} },
    request: async () => {
      throw new Error("must not be called");
    },
  });
  for (const id of ['tt1" } DROP', "nm0634240", "", "tt12"])
    await assert.rejects(credits.title({ type: "movie", id }));
  for (const input of [
    { qid: "Q1 }" },
    { qid: "P31" },
    { tmdb: "12a" },
    { tmdb: "1".repeat(11) },
    {},
  ])
    await assert.rejects(credits.entity(input));
});

test("an entity's facts and works", () => {
  const facts = reply([
    { field: lit("image"), value: file("Nolan.jpg") },
    { field: lit("born"), value: lit("1970-07-30T00:00:00Z") },
    { field: lit("birthPlace"), value: uri("Q84"), valueLabel: lit("لندن") },
    {
      field: lit("citizenship"),
      value: uri("Q145"),
      valueLabel: lit("المملكة المتحدة"),
    },
    {
      field: lit("citizenship"),
      value: uri("Q30"),
      valueLabel: lit("الولايات المتحدة"),
    },
    {
      field: lit("occupation"),
      value: uri("Q2526255"),
      valueLabel: lit("مخرج أفلام"),
    },
    {
      field: lit("occupation"),
      value: uri("Q2526255"),
      valueLabel: lit("مخرج أفلام"),
    },
    { field: lit("award"), value: uri("Q1"), valueLabel: lit("a") },
    { field: lit("award"), value: uri("Q2"), valueLabel: lit("b") },
    { field: lit("imdb"), value: lit("nm0634240") },
    { field: lit("tmdbPerson"), value: lit("525") },
  ]);
  const names = reply([
    {
      entityLabel: lit("كريستوفر نولان"),
      entityDescription: lit("مخرج بريطاني أمريكي"),
    },
  ]);
  const entity = parseEntity(facts, names);
  assert.equal(entity.name, "كريستوفر نولان");
  assert.equal(entity.born, "1970-07-30");
  assert.equal(entity.birthPlace, "لندن");
  assert.deepEqual(entity.citizenship, ["المملكة المتحدة", "الولايات المتحدة"]);
  assert.deepEqual(entity.occupations, ["مخرج أفلام"]);
  assert.equal(entity.awards, 2);
  assert.equal(entity.imdb, "nm0634240");
  assert.equal(entity.tmdbPerson, "525");
  assert.match(entity.image, /Nolan\.jpg\?width=400$/);

  const works = parseWorks(
    reply([
      {
        work: uri("Q25188"),
        workLabel: lit("استهلال"),
        imdb: lit("tt1375666"),
        date: lit("2010-07-08T00:00:00Z"),
        role: lit("director"),
      },
      {
        work: uri("Q25188"),
        workLabel: lit("استهلال"),
        imdb: lit("tt1375666"),
        date: lit("2010-07-16T00:00:00Z"),
        role: lit("writer"),
      },
      {
        work: uri("Q1"),
        workLabel: lit("Westworld"),
        imdb: lit("tt0475784"),
        date: lit("2016-10-02T00:00:00Z"),
        kind: uri("Q5398426"),
        role: lit("producer"),
      },
      {
        work: uri("Q2"),
        workLabel: lit("Following"),
        imdb: lit("tt0154506"),
        date: lit("1998-09-12T00:00:00Z"),
        role: lit("director"),
      },
      {
        work: uri("Q3"),
        workLabel: lit("not a title"),
        imdb: lit("nm1"),
        role: lit("director"),
      },
    ]),
  );
  assert.deepEqual(
    works.map((w) => [w.id, w.type, w.year, w.roleLabels.join("+")]),
    [
      ["tt0475784", "series", 2016, "الإنتاج"],
      ["tt1375666", "movie", 2010, "الإخراج+الكتابة"],
      ["tt0154506", "movie", 1998, "الإخراج"],
    ],
  );
  assert.equal(
    works[1].poster,
    "https://images.metahub.space/poster/medium/tt1375666/img",
  );
});

test("images come only from their own hosts", () => {
  assert.equal(commonsImage("https://evil.example/x.jpg"), "");
  assert.equal(
    tmdbImage("/abc.jpg"),
    "https://image.tmdb.org/t/p/w185/abc.jpg",
  );
  assert.equal(tmdbImage("//evil.example/x.jpg"), "");
  assert.equal(tmdbImage("https://evil.example/x.jpg"), "");
  assert.equal(tmdbImage(null), "");
});

test("a filming location is drawn on four map tiles with a pin", () => {
  const paris = mapTiles("Point(2.35 48.85)");
  assert.equal(paris.tiles.length, 4);
  assert.ok(
    paris.tiles.every((t) => t.startsWith("https://tile.openstreetmap.org/6/")),
  );
  assert.ok(paris.left >= 25 && paris.left <= 75);
  assert.ok(paris.top >= 25 && paris.top <= 75);
  // Wraps across the antimeridian instead of asking for a negative tile.
  const fiji = mapTiles("Point(179.9 -17.7)");
  assert.ok(fiji.tiles.every((t) => !/\/-/.test(t)));
  assert.equal(mapTiles("Point(0 89)"), null);
  assert.equal(mapTiles("garbage"), null);
});

const TMDB_DETAIL = {
  created_by: [],
  credits: {
    cast: [
      {
        id: 6193,
        name: "Leonardo DiCaprio",
        character: "Cobb",
        profile_path: "/leo.jpg",
      },
      {
        id: 24045,
        name: "Joseph Gordon-Levitt",
        character: "Arthur",
        profile_path: "/jgl.jpg",
      },
      { id: 27578, name: "Elliot Page", character: "Ariadne" },
      {
        id: 2524,
        name: "Tom Hardy",
        character: "Eames",
        profile_path: "/tom.jpg",
      },
    ],
    crew: [
      {
        id: 525,
        name: "Christopher Nolan",
        job: "Director",
        profile_path: "/nolan.jpg",
      },
      { id: 525, name: "Christopher Nolan", job: "Screenplay" },
      { id: 947, name: "Hans Zimmer", job: "Original Music Composer" },
      { id: 1, name: "Grip", job: "Key Grip" },
    ],
  },
  production_companies: [{ name: "Legendary Pictures", logo_path: "/leg.png" }],
  production_countries: [{ name: "United States of America" }],
};

test("TMDB credits stand in for Wikidata and fill what it lacks", () => {
  const tmdb = parseTmdbTitle(TMDB_DETAIL);
  assert.deepEqual(
    tmdb.crew.map((p) => [p.role, p.tmdb]),
    [
      ["director", "525"],
      ["writer", "525"],
      ["composer", "947"],
    ],
    "only the jobs Riwaq labels",
  );
  assert.equal(tmdb.cast[0].image, "https://image.tmdb.org/t/p/w185/leo.jpg");
  assert.equal(tmdb.companies[0].name, "Legendary Pictures");
  assert.deepEqual(tmdb.locations, [], "TMDB records no filming locations");

  const result = {
    ...parseTitle(TITLE),
    cast: [
      // Named in Arabic by Wikidata; matched by its TMDB ID, not the name.
      {
        qid: "Q38111",
        tmdb: "6193",
        name: "ليوناردو دي كابريو",
        image: "",
        character: "",
      },
    ],
  };
  mergeTmdb(result, tmdb);
  assert.equal(result.cast[0].image, "https://image.tmdb.org/t/p/w185/leo.jpg");
  assert.equal(result.cast[0].character, "Cobb");
  assert.equal(result.cast[0].tmdb, "6193");
  assert.equal(result.cast.length, 4, "a short Wikidata cast is filled in");
  assert.equal(result.crew.length, 3, "Wikidata's crew is kept as it is");
  assert.equal(
    result.crew[0].image,
    "https://commons.wikimedia.org/wiki/Special:FilePath/Christopher%20Nolan.jpg?width=300",
    "Wikidata's portrait stays",
  );
  assert.equal(result.crew[1].tmdb, "525", "every role shares the ID");
  assert.equal(
    result.crew[2].tmdb,
    "947",
    "a person without a Wikidata TMDB ID is matched by name",
  );
  assert.equal(result.companies[0].name, "Warner Bros.");
});

const client = (routes, { tmdb = true } = {}) => {
  const seen = [];
  const request = async (url, init) => {
    seen.push({ url, init });
    for (const [match, answer] of routes)
      if (url.includes(match))
        return typeof answer === "function" ? answer(url) : answer;
    throw new Error("HTTP 404");
  };
  const c = {
    version: "0.10.0",
    state: {
      settings: { metadataLanguage: "ar-SA" },
      providers: tmdb ? { tmdb: { key: "a".repeat(32) } } : {},
    },
    request,
    seen,
  };
  c.dataHub = {
    request: (id, path, params = {}) =>
      request(`tmdb:${path}?${new URLSearchParams(params)}`, {}),
  };
  return c;
};

test("Wikidata is asked politely, and TMDB covers an outage", async () => {
  const c = client([
    [
      "query.wikidata.org",
      () => {
        throw new Error("HTTP 503");
      },
    ],
    ["tmdb:find/tt1375666", { movie_results: [{ id: 27205 }] }],
    ["tmdb:movie/27205", TMDB_DETAIL],
  ]);
  const credits = new Credits(c);
  const result = await credits.title({ type: "movie", id: "tt1375666" });
  assert.deepEqual(result.sources, ["TMDB"]);
  assert.equal(result.cast.length, 4);
  const sparql = c.seen.find((s) => s.url.includes("wikidata"));
  assert.ok(
    sparql.url.startsWith(
      "https://query.wikidata.org/sparql?format=json&query=",
    ),
  );
  assert.equal(sparql.init.redirect, "error");
  assert.match(
    sparql.init.headers["User-Agent"],
    /^Riwaq\/0\.10\.0 \(https:\/\/github\.com\//,
  );

  const keyless = new Credits(
    client(
      [
        [
          "query.wikidata.org",
          () => {
            throw new Error("HTTP 503");
          },
        ],
      ],
      { tmdb: false },
    ),
  );
  await assert.rejects(
    keyless.title({ type: "movie", id: "tt1375666" }),
    /503/,
  );
});

test("Wikidata credits with TMDB portraits, cached", async () => {
  const c = client([
    [
      "query.wikidata.org",
      (url) => (decodeURIComponent(url).includes("p:P161") ? CAST : TITLE),
    ],
    ["tmdb:find/tt1375666", { movie_results: [{ id: 27205 }] }],
    ["tmdb:movie/27205", TMDB_DETAIL],
  ]);
  const credits = new Credits(c);
  const result = await credits.title({ type: "movie", id: "tt1375666" });
  assert.deepEqual(result.sources, ["Wikidata", "TMDB"]);
  assert.equal(result.locations[0].name, "باريس");
  assert.equal(result.cast[1].image, "https://image.tmdb.org/t/p/w185/jgl.jpg");
  const before = c.seen.filter((s) => s.url.includes("wikidata")).length;
  await credits.title({ type: "movie", id: "tt1375666" });
  assert.equal(
    c.seen.filter((s) => s.url.includes("wikidata")).length,
    before,
    "an hour's cache",
  );
});

test("a TMDB-only person opens through Wikidata, or TMDB alone", async () => {
  const person = {
    id: 2524,
    name: "Tom Hardy",
    biography: "ممثل إنجليزي.",
    birthday: "1977-09-15",
    place_of_birth: "London",
    profile_path: "/tom.jpg",
    external_ids: { imdb_id: "nm0362766", wikidata_id: "Q208026" },
    combined_credits: {
      cast: [
        {
          media_type: "movie",
          id: 27205,
          title: "Inception",
          release_date: "2010-07-15",
          popularity: 90,
        },
        {
          media_type: "tv",
          id: 1,
          name: "Taboo",
          first_air_date: "2017-01-07",
          popularity: 40,
        },
        { media_type: "person", id: 9 },
      ],
      crew: [
        {
          media_type: "tv",
          id: 1,
          name: "Taboo",
          job: "Producer",
          popularity: 40,
        },
      ],
    },
  };
  assert.deepEqual(
    tmdbWorkCandidates(person).map((w) => [w.kind, w.id, w.roles.join("+")]),
    [
      ["movie", "27205", "cast"],
      ["tv", "1", "cast+producer"],
    ],
  );
  // Wikidata is down: TMDB answers, with works resolved to IMDb IDs.
  const offline = client([
    [
      "query.wikidata.org",
      () => {
        throw new Error("HTTP 429");
      },
    ],
    ["tmdb:person/2524", person],
    ["tmdb:movie/27205/external_ids", { imdb_id: "tt1375666" }],
    ["tmdb:tv/1/external_ids", { imdb_id: "tt3647998" }],
  ]);
  const alone = await new Credits(offline).entity({ tmdb: "2524" });
  assert.deepEqual(alone.sources, ["TMDB"]);
  assert.equal(alone.born, "1977-09-15");
  assert.equal(alone.biography, "ممثل إنجليزي.");
  assert.deepEqual(
    alone.works.map((w) => [w.id, w.type]),
    [
      ["tt3647998", "series"],
      ["tt1375666", "movie"],
    ],
  );
  // Wikidata is up: the linked QID is used and the TMDB biography kept.
  const online = client([
    [
      "query.wikidata.org",
      (url) => {
        const q = decodeURIComponent(url);
        if (q.includes("entityLabel"))
          return reply([{ entityLabel: lit("توم هاردي") }]);
        if (q.includes("?work")) return reply([]);
        assert.match(q, /wd:Q208026/);
        return reply([]);
      },
    ],
    ["tmdb:person/2524", person],
  ]);
  const linked = await new Credits(online).entity({ tmdb: "2524" });
  assert.equal(linked.qid, "Q208026");
  assert.equal(linked.name, "توم هاردي");
  assert.equal(linked.biography, "ممثل إنجليزي.");
  assert.deepEqual(linked.sources, ["Wikidata", "TMDB"]);
});

test("credits are main-window actions, not HUD ones", () => {
  const preload = readFileSync(
    new URL("../electron/preload.cjs", import.meta.url),
    "utf8",
  );
  for (const method of ["titleCredits", "creditsEntity"]) {
    assert.ok(preload.includes(`"${method}"`));
    assert.ok(!HUD_METHODS.has(method));
  }
});

test("a title opened from credits tries the other kind once", async () => {
  const { Client } = await import("../core/client.mjs");
  const asked = [];
  const c = new Client({
    load: () => ({
      addons: [
        {
          transportUrl: "https://v3-cinemeta.strem.io/manifest.json",
          manifest: {
            id: "com.linvo.cinemeta",
            name: "Cinemeta",
            version: "3.0.0",
            resources: ["meta"],
            types: ["movie", "series"],
            idPrefixes: ["tt"],
            catalogs: [],
          },
        },
      ],
    }),
    save: () => {},
    request: async (url) => {
      asked.push(url);
      if (url.includes("/meta/series/tt0475784"))
        return { meta: { id: "tt0475784", type: "series", name: "Westworld" } };
      throw new Error("HTTP 404");
    },
  });
  const meta = await c.metadata({
    type: "movie",
    id: "tt0475784",
    flexible: true,
  });
  assert.equal(meta.type, "series");
  await assert.rejects(
    c.metadata({ type: "movie", id: "tt0475784" }),
    "only when asked",
  );
  await assert.rejects(
    c.metadata({ type: "channel", id: "tt0475784", flexible: true }),
  );
});
