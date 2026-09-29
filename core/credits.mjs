/**
 * Credits: who made a title, where it was filmed, and everything else those
 * people, companies and places are known for.
 *
 * Wikidata is the source every viewer gets: it needs no key, carries IMDb IDs
 * for people and works (so a work opens straight in Riwaq), and is the one
 * open source that records filming locations. TMDB, when the viewer has added
 * a key, adds portraits, character names and Arabic biographies.
 */

const SPARQL = "https://query.wikidata.org/sparql";
const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
export const QID = /^Q\d{1,12}$/;
export const IMDB = /^tt\d{5,12}$/;
const TTL = 3600000;

const ROLE_LABELS = {
  director: "الإخراج",
  writer: "الكتابة",
  producer: "الإنتاج",
  composer: "الموسيقى",
  cinematographer: "التصوير السينمائي",
  editor: "المونتاج",
  creator: "الفكرة",
  cast: "التمثيل",
};

// Instances that make a work a series rather than a film.
const SERIES = new Set([
  "Q5398426", // television series
  "Q1259759", // miniseries
  "Q63952888", // anime television series
  "Q581714", // animated series
  "Q117467246", // animated television series
  "Q526877", // web series
  "Q15416", // television program
]);

const qidOf = (uri) => String(uri || "").match(/(Q\d+)$/)?.[1] || "";
const text = (binding) =>
  binding && typeof binding.value === "string"
    ? binding.value.slice(0, 400)
    : "";
// A label the label service could not resolve comes back as the bare QID.
const label = (binding) => {
  const value = text(binding);
  return QID.test(value) ? "" : value;
};

/** Commons file URL to a sized thumbnail on Wikimedia's own image path. */
export function commonsImage(value, width = 300) {
  const file = String(value || "").match(/Special:FilePath\/(.+)$/)?.[1];
  if (!file) return "";
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${file}?width=${width}`;
}

/** A Stremio poster for an IMDb title, from the same host Riwaq uses. */
export const posterOf = (imdb) =>
  IMDB.test(imdb)
    ? `https://images.metahub.space/poster/medium/${imdb}/img`
    : "";

// Wikidata's TMDB person ID (P4985) lets TMDB portraits match across scripts:
// Wikidata names people in Arabic, TMDB mostly in their original spelling.
const tmdbOf = (binding) =>
  /^\d{1,10}$/.test(text(binding)) ? text(binding) : "";

const year = (value) => {
  const match = String(value || "").match(/^[+-]?(\d{4})/);
  return match ? Number(match[1]) : null;
};

export const titleQuery = (imdb) => `
SELECT ?role ?who ?whoLabel ?whoDescription ?imdb ?tmdb ?image ?coord WHERE {
  ?item wdt:P345 "${imdb}".
  VALUES (?prop ?role) {
    (wdt:P57 "director") (wdt:P170 "creator") (wdt:P58 "writer") (wdt:P162 "producer")
    (wdt:P86 "composer") (wdt:P344 "cinematographer") (wdt:P1040 "editor")
    (wdt:P272 "company") (wdt:P750 "distributor") (wdt:P915 "location")
    (wdt:P495 "country") (wdt:P840 "setting") (wdt:P166 "award")
  }
  ?item ?prop ?who.
  OPTIONAL { ?who wdt:P345 ?imdb. }
  OPTIONAL { ?who wdt:P4985 ?tmdb. }
  OPTIONAL { ?who wdt:P18 ?image. }
  OPTIONAL { ?who wdt:P154 ?image. }
  OPTIONAL { ?who wdt:P625 ?coord. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "ar,en". }
} LIMIT 400`;

export const castQuery = (imdb) => `
SELECT ?who ?whoLabel ?imdb ?tmdb ?image ?characterLabel ?characterName ?order WHERE {
  ?item wdt:P345 "${imdb}".
  ?item p:P161 ?statement.
  ?statement ps:P161 ?who.
  OPTIONAL { ?statement pq:P453 ?character. }
  OPTIONAL { ?statement pq:P4633 ?characterName. }
  OPTIONAL { ?statement pq:P1545 ?order. }
  OPTIONAL { ?who wdt:P345 ?imdb. }
  OPTIONAL { ?who wdt:P4985 ?tmdb. }
  OPTIONAL { ?who wdt:P18 ?image. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "ar,en". }
} LIMIT 120`;

/** Everything one entity (person, company or place) is and has made. */
export const entityQuery = (qid) => `
SELECT ?field ?value ?valueLabel WHERE {
  BIND(wd:${qid} AS ?entity)
  VALUES (?prop ?field) {
    (wdt:P18 "image") (wdt:P154 "logo") (wdt:P569 "born") (wdt:P570 "died")
    (wdt:P19 "birthPlace") (wdt:P20 "deathPlace") (wdt:P27 "citizenship")
    (wdt:P106 "occupation") (wdt:P571 "founded") (wdt:P159 "headquarters")
    (wdt:P17 "country") (wdt:P131 "region") (wdt:P625 "coord")
    (wdt:P345 "imdb") (wdt:P4985 "tmdbPerson") (wdt:P166 "award")
  }
  ?entity ?prop ?value.
  SERVICE wikibase:label { bd:serviceParam wikibase:language "ar,en". }
} LIMIT 200`;

export const nameQuery = (qid) => `
SELECT ?entityLabel ?entityDescription WHERE {
  BIND(wd:${qid} AS ?entity)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "ar,en". }
}`;

export const tmdbPersonQuery = (id) => `
SELECT ?entity WHERE { ?entity wdt:P4985 "${id}". } LIMIT 1`;

export const worksQuery = (qid) => `
SELECT ?work ?workLabel ?imdb ?date ?kind ?role WHERE {
  VALUES (?prop ?role) {
    (wdt:P161 "cast") (wdt:P57 "director") (wdt:P170 "creator") (wdt:P58 "writer")
    (wdt:P162 "producer") (wdt:P86 "composer") (wdt:P344 "cinematographer")
    (wdt:P1040 "editor") (wdt:P272 "company") (wdt:P750 "company")
    (wdt:P915 "location")
  }
  ?work ?prop wd:${qid}.
  ?work wdt:P345 ?imdb.
  FILTER(STRSTARTS(?imdb, "tt"))
  OPTIONAL { ?work wdt:P577 ?date. }
  OPTIONAL { ?work wdt:P31 ?kind. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "ar,en". }
} LIMIT 600`;

/**
 * Every title in the same series (P179) as this one, e.g. each film of a
 * trilogy. Episodes and seasons are left out: a TV episode's series is the
 * show itself, not a franchise.
 */
export const collectionQuery = (imdb) => `
SELECT ?series ?seriesLabel ?work ?workLabel ?imdb ?date ?kind ?ordinal WHERE {
  ?item wdt:P345 "${imdb}".
  ?item wdt:P179 ?series.
  ?work wdt:P179 ?series.
  ?work wdt:P345 ?imdb.
  FILTER(STRSTARTS(?imdb, "tt"))
  FILTER NOT EXISTS { ?work wdt:P31 wd:Q21191270. }
  FILTER NOT EXISTS { ?work wdt:P31 wd:Q3464665. }
  OPTIONAL { ?work wdt:P577 ?date. }
  OPTIONAL { ?work wdt:P31 ?kind. }
  OPTIONAL {
    ?work p:P179 ?part.
    ?part ps:P179 ?series.
    ?part pq:P1545 ?ordinal.
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "ar,en". }
} LIMIT 300`;

/** Search hits narrowed to people with an IMDb name ID: film people. */
export const peopleQuery = (qids) => `
SELECT ?item ?itemLabel ?itemDescription ?image ?tmdb WHERE {
  VALUES ?item { ${qids.map((q) => `wd:${q}`).join(" ")} }
  ?item wdt:P31 wd:Q5.
  ?item wdt:P345 ?imdb.
  FILTER(STRSTARTS(?imdb, "nm"))
  OPTIONAL { ?item wdt:P18 ?image. }
  OPTIONAL { ?item wdt:P4985 ?tmdb. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "ar,en". }
}`;

const rows = (result) =>
  Array.isArray(result?.results?.bindings) ? result.results.bindings : [];

const CREW_ROLES = [
  "director",
  "creator",
  "writer",
  "producer",
  "composer",
  "cinematographer",
  "editor",
];

/** Title facts from Wikidata rows: crew, companies, places, awards. */
export function parseTitle(result) {
  const out = {
    crew: [],
    companies: [],
    locations: [],
    settings: [],
    countries: [],
    awards: [],
  };
  const seen = new Set();
  for (const row of rows(result)) {
    const qid = qidOf(row.who?.value);
    const role = text(row.role);
    const name = label(row.whoLabel);
    if (!QID.test(qid) || !name || seen.has(`${role}:${qid}`)) continue;
    seen.add(`${role}:${qid}`);
    const entity = {
      qid,
      tmdb: tmdbOf(row.tmdb),
      name,
      description: text(row.whoDescription),
      image: commonsImage(row.image?.value),
    };
    if (CREW_ROLES.includes(role))
      out.crew.push({ ...entity, role, roleLabel: ROLE_LABELS[role] });
    else if (role === "company" || role === "distributor")
      out.companies.push({ ...entity, distributor: role === "distributor" });
    else if (role === "location")
      out.locations.push({ ...entity, coord: text(row.coord) });
    else if (role === "setting") out.settings.push(entity);
    else if (role === "country") out.countries.push(entity);
    else if (role === "award") out.awards.push(entity);
  }
  // Optional columns can land on only one of a person's rows; share them
  // across every role that person holds.
  const known = new Map();
  for (const row of rows(result)) {
    const qid = qidOf(row.who?.value);
    const entry = known.get(qid) || { tmdb: "", image: "" };
    entry.tmdb ||= tmdbOf(row.tmdb);
    entry.image ||= commonsImage(row.image?.value);
    known.set(qid, entry);
  }
  for (const list of Object.values(out))
    for (const item of list) {
      item.tmdb ||= known.get(item.qid)?.tmdb || "";
      item.image ||= known.get(item.qid)?.image || "";
    }
  return out;
}

/** Cast in billing order when Wikidata records it, with character names. */
export function parseCast(result) {
  const byPerson = new Map();
  for (const row of rows(result)) {
    const qid = qidOf(row.who?.value);
    const name = label(row.whoLabel);
    if (!QID.test(qid) || !name) continue;
    const entry = byPerson.get(qid) || {
      qid,
      tmdb: tmdbOf(row.tmdb),
      name,
      image: commonsImage(row.image?.value),
      characters: [],
      order: Number(text(row.order)) || 9999,
    };
    const character = text(row.characterName) || label(row.characterLabel);
    if (character && !entry.characters.includes(character))
      entry.characters.push(character);
    byPerson.set(qid, entry);
  }
  return [...byPerson.values()]
    .sort((a, b) => a.order - b.order)
    .map(({ order, characters, ...rest }) => ({
      ...rest,
      character: characters.slice(0, 2).join(" / "),
    }));
}

/** An entity's facts: labels grouped by field, first value for dates/images. */
export function parseEntity(result, names) {
  const facts = {};
  for (const row of rows(result)) {
    const field = text(row.field);
    const value = label(row.valueLabel) || text(row.value).replace(/^.*\//, "");
    if (!field || !value) continue;
    (facts[field] ||= []).includes(value) || facts[field].push(value);
  }
  const first = (field) => facts[field]?.[0] || "";
  const image =
    rows(result).find((r) => text(r.field) === "image")?.value?.value ||
    rows(result).find((r) => text(r.field) === "logo")?.value?.value;
  const nameRow = rows(names)[0] || {};
  return {
    name: label(nameRow.entityLabel),
    description: text(nameRow.entityDescription),
    image: commonsImage(image, 400),
    born: year(first("born")) ? first("born").slice(0, 10) : "",
    died: year(first("died")) ? first("died").slice(0, 10) : "",
    birthPlace: first("birthPlace"),
    citizenship: facts.citizenship?.slice(0, 3) || [],
    occupations: facts.occupation?.slice(0, 6) || [],
    founded: year(first("founded")),
    headquarters: first("headquarters"),
    country: first("country"),
    region: first("region"),
    coord: first("coord"),
    awards: facts.award?.length || 0,
    imdb: facts.imdb?.find((id) => /^nm\d+$/.test(id)) || "",
    tmdbPerson: facts.tmdbPerson?.find((id) => /^\d+$/.test(id)) || "",
  };
}

/**
 * Works linked to an entity, one per title, newest first, each with the
 * roles held and whether it is a film or a series. Only works with an IMDb
 * ID are kept: those are the ones Riwaq can open.
 */
export function parseWorks(result) {
  const works = new Map();
  for (const row of rows(result)) {
    const imdb = text(row.imdb);
    const name = label(row.workLabel);
    if (!IMDB.test(imdb) || !name) continue;
    const entry = works.get(imdb) || {
      id: imdb,
      name,
      poster: posterOf(imdb),
      year: null,
      type: "movie",
      roles: [],
    };
    const y = year(text(row.date));
    if (y && (!entry.year || y < entry.year)) entry.year = y;
    if (SERIES.has(qidOf(row.kind?.value))) entry.type = "series";
    const role = text(row.role);
    if (role && !entry.roles.includes(role)) entry.roles.push(role);
    works.set(imdb, entry);
  }
  return [...works.values()]
    .map((w) => ({
      ...w,
      roleLabels: w.roles.map((r) => ROLE_LABELS[r]).filter(Boolean),
    }))
    .sort(
      (a, b) => (b.year || 0) - (a.year || 0) || a.name.localeCompare(b.name),
    );
}

/** TMDB image paths are a single file name; anything else is dropped. */
export const tmdbImage = (path, size = "w185") =>
  typeof path === "string" && /^\/[\w.-]{1,120}$/.test(path)
    ? `https://image.tmdb.org/t/p/${size}${path}`
    : "";
const short = (value, max = 120) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
const tmdbId = (value) =>
  Number.isSafeInteger(value) && value > 0 ? String(value) : "";
const normalName = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}]/gu, "");

const TMDB_JOBS = {
  Director: "director",
  Screenplay: "writer",
  Writer: "writer",
  Story: "writer",
  Novel: "writer",
  Producer: "producer",
  "Original Music Composer": "composer",
  Music: "composer",
  "Director of Photography": "cinematographer",
  Editor: "editor",
};

/**
 * Title credits from one TMDB detail reply (with `credits` appended), for
 * when Wikidata cannot answer. People carry their TMDB ID so they can still
 * be opened; companies and countries are names only.
 */
export function parseTmdbTitle(detail) {
  const out = {
    cast: [],
    crew: [],
    companies: [],
    locations: [],
    settings: [],
    countries: [],
    awards: [],
  };
  if (!detail || typeof detail !== "object") return out;
  for (const c of (detail.credits?.cast || []).slice(0, 30)) {
    const name = short(c?.name);
    if (!name) continue;
    out.cast.push({
      qid: "",
      tmdb: tmdbId(c.id),
      name,
      image: tmdbImage(c.profile_path),
      character: short(c.character),
    });
  }
  const seen = new Set();
  const crew = [
    ...(detail.created_by || []).map((c) => ({ ...c, role: "creator" })),
    ...(detail.credits?.crew || []).map((c) => ({
      ...c,
      role: TMDB_JOBS[c?.job],
    })),
  ];
  for (const c of crew) {
    const name = short(c?.name);
    if (!c.role || !name || seen.has(`${c.role}:${name}`)) continue;
    // Big productions list dozens of producers; the first few are enough.
    if (
      c.role === "producer" &&
      out.crew.filter((p) => p.role === "producer").length >= 4
    )
      continue;
    seen.add(`${c.role}:${name}`);
    out.crew.push({
      qid: "",
      tmdb: tmdbId(c.id),
      name,
      image: tmdbImage(c.profile_path),
      role: c.role,
      roleLabel: ROLE_LABELS[c.role],
    });
  }
  for (const c of (detail.production_companies || []).slice(0, 12)) {
    const name = short(c?.name);
    if (name)
      out.companies.push({
        qid: "",
        name,
        image: tmdbImage(c.logo_path, "w92"),
      });
  }
  for (const c of (detail.production_countries || []).slice(0, 8)) {
    const name = short(c?.name);
    if (name) out.countries.push({ qid: "", name });
  }
  return out;
}

/** A person from TMDB (`person/{id}` with `external_ids` appended). */
export function parseTmdbPerson(person) {
  const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : "");
  return {
    name: short(person?.name),
    description: short(person?.known_for_department),
    biography: short(person?.biography, 4000),
    image: tmdbImage(person?.profile_path, "w300"),
    born: date(person?.birthday),
    died: date(person?.deathday),
    birthPlace: short(person?.place_of_birth),
    citizenship: [],
    occupations: [],
    founded: null,
    headquarters: "",
    country: "",
    region: "",
    coord: "",
    awards: 0,
    imdb: /^nm\d+$/.test(person?.external_ids?.imdb_id || "")
      ? person.external_ids.imdb_id
      : "",
    tmdbPerson: tmdbId(person?.id),
  };
}

/** The TMDB works worth resolving to IMDb IDs: most popular first, one each. */
export function tmdbWorkCandidates(person, limit = 30) {
  const credits = person?.combined_credits || {};
  const byKey = new Map();
  for (const [list, fallbackRole] of [
    [credits.cast, "cast"],
    [credits.crew, ""],
  ])
    for (const c of list || []) {
      const kind = c?.media_type === "tv" ? "tv" : "movie";
      if (c?.media_type !== "tv" && c?.media_type !== "movie") continue;
      const id = tmdbId(c.id);
      if (!id) continue;
      const role = fallbackRole || TMDB_JOBS[c.job];
      const key = `${kind}:${id}`;
      const entry = byKey.get(key) || {
        kind,
        id,
        name: short(c.title || c.name),
        year:
          Number(String(c.release_date || c.first_air_date).slice(0, 4)) ||
          null,
        popularity: Number(c.popularity) || 0,
        roles: [],
      };
      if (role && !entry.roles.includes(role)) entry.roles.push(role);
      if (entry.name) byKey.set(key, entry);
    }
  return [...byKey.values()]
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, limit);
}

/** Runs `fn` over `items` with at most `size` in flight. */
async function pooled(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]).catch(() => null);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, worker),
  );
  return out;
}

/**
 * Series this title belongs to, each with its titles in order (the series
 * ordinal when Wikidata records it, else release date). A series needs a
 * second title to be worth a row; the most specific series comes first.
 */
export function parseCollections(result, current) {
  const series = new Map();
  for (const row of rows(result)) {
    const qid = qidOf(row.series?.value);
    const name = label(row.seriesLabel);
    const imdb = text(row.imdb);
    const title = label(row.workLabel);
    if (!QID.test(qid) || !name || !IMDB.test(imdb) || !title) continue;
    const entry = series.get(qid) || { qid, name, works: new Map() };
    const work = entry.works.get(imdb) || {
      id: imdb,
      name: title,
      poster: posterOf(imdb),
      year: null,
      type: "movie",
      ordinal: null,
      current: imdb === current,
    };
    const y = year(text(row.date));
    if (y && (!work.year || y < work.year)) work.year = y;
    if (SERIES.has(qidOf(row.kind?.value))) work.type = "series";
    const n = Number(text(row.ordinal));
    if (Number.isFinite(n) && n > 0 && work.ordinal === null) work.ordinal = n;
    entry.works.set(imdb, work);
    series.set(qid, entry);
  }
  return [...series.values()]
    .map((s) => ({
      qid: s.qid,
      name: s.name,
      works: [...s.works.values()].sort(
        (a, b) =>
          (a.ordinal ?? Infinity) - (b.ordinal ?? Infinity) ||
          (a.year || 9999) - (b.year || 9999) ||
          a.name.localeCompare(b.name),
      ),
    }))
    .filter((s) => s.works.length >= 2 && s.works.some((w) => w.current))
    .sort((a, b) => a.works.length - b.works.length)
    .slice(0, 2);
}

/** People from a search, in the search's order, one each. */
export function parsePeople(result, order) {
  const byQid = new Map();
  for (const row of rows(result)) {
    const qid = qidOf(row.item?.value);
    const name = label(row.itemLabel);
    if (!QID.test(qid) || !name || byQid.has(qid)) continue;
    byQid.set(qid, {
      qid,
      tmdb: tmdbOf(row.tmdb),
      name,
      description: text(row.itemDescription),
      image: commonsImage(row.image?.value),
    });
  }
  return order.map((q) => byQid.get(q)).filter(Boolean);
}

/** A search phrase safe to send: one line, trimmed, at most 80 characters. */
export function searchPhrase(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export class Credits {
  constructor(client) {
    this.client = client;
    this.cache = new Map();
  }
  sparql(query) {
    return this.cached(
      `${SPARQL}?format=json&query=${encodeURIComponent(query)}`,
      20000,
    );
  }
  async cached(url, timeout) {
    const cached = this.cache.get(url);
    if (cached && Date.now() - cached.at < TTL) return cached.data;
    const data = await this.client.request(url, {
      timeout,
      redirect: "error",
      headers: {
        Accept: "application/sparql-results+json",
        // Wikimedia asks every client to identify itself.
        "User-Agent": `Riwaq/${this.client.version || "dev"} (https://github.com/ABADIOSA/riwaq)`,
      },
    });
    if (this.cache.size > 200)
      this.cache.delete(this.cache.keys().next().value);
    this.cache.set(url, { at: Date.now(), data });
    return data;
  }
  /**
   * People by name, in Arabic or Latin script: Wikidata's own search in both
   * languages, then only the humans with an IMDb name ID.
   */
  async searchPeople({ query } = {}) {
    const phrase = searchPhrase(query);
    if (phrase.length < 2) return [];
    const search = (lang) =>
      this.cached(
        `${WIKIDATA_API}?action=wbsearchentities&format=json&type=item&limit=20` +
          `&language=${lang}&uselang=${lang}&search=${encodeURIComponent(phrase)}`,
        12000,
      );
    const replies = await Promise.all(
      ["ar", "en"].map((lang) => search(lang).catch(() => null)),
    );
    if (replies.every((r) => !r))
      throw new Error("تعذّر البحث عن الأشخاص الآن");
    const order = [];
    for (const reply of replies)
      for (const hit of Array.isArray(reply?.search) ? reply.search : [])
        if (QID.test(hit?.id || "") && !order.includes(hit.id))
          order.push(hit.id);
    if (!order.length) return [];
    const ids = order.slice(0, 40);
    return parsePeople(await this.sparql(peopleQuery(ids)), ids).slice(0, 12);
  }
  tmdbKey() {
    const entry = this.client.state.providers?.tmdb;
    return !!entry?.key && entry.enabled !== false;
  }
  language() {
    return this.client.state.settings.metadataLanguage || "ar-SA";
  }
  /** Cast, crew, companies, filming locations, countries and awards. */
  async title({ type, id }) {
    if (!IMDB.test(id)) throw new Error("لا يتوفر فريق العمل لهذا العنوان");
    let result;
    try {
      const [facts, cast, collections] = await Promise.all([
        this.sparql(titleQuery(id)).then(parseTitle),
        this.sparql(castQuery(id))
          .then(parseCast)
          .catch(() => []),
        this.sparql(collectionQuery(id))
          .then((r) => parseCollections(r, id))
          .catch(() => []),
      ]);
      result = { ...facts, cast, collections, sources: ["Wikidata"] };
    } catch (error) {
      // Wikidata's query service is sometimes overloaded; TMDB still knows
      // who made the title, though not where it was filmed.
      if (!this.tmdbKey()) throw error;
      const detail = await this.tmdbDetail({ type, id });
      if (!detail) throw error;
      return { ...parseTmdbTitle(detail), collections: [], sources: ["TMDB"] };
    }
    if (this.tmdbKey()) {
      try {
        const detail = await this.tmdbDetail({ type, id });
        if (detail) {
          mergeTmdb(result, parseTmdbTitle(detail));
          result.sources.push("TMDB");
        }
      } catch {
        /* TMDB is optional; Wikidata's credits stand on their own. */
      }
    }
    return result;
  }
  async tmdbDetail({ type, id }) {
    const hub = this.client.dataHub;
    const kind = type === "series" ? "tv" : "movie";
    const found = await hub.request("tmdb", `find/${id}`, {
      external_source: "imdb_id",
    });
    const match = found[`${kind}_results`]?.[0];
    if (!tmdbId(match?.id)) return null;
    return hub.request("tmdb", `${kind}/${match.id}`, {
      language: this.language(),
      append_to_response: "credits",
    });
  }
  /**
   * A person, company or place with everything linked to it. People found
   * only on TMDB are opened by their TMDB ID and matched to Wikidata when it
   * knows them.
   */
  async entity({ qid, tmdb } = {}) {
    if (QID.test(qid || "")) return this.wikidataEntity(qid);
    if (!/^\d{1,10}$/.test(tmdb || "")) throw new Error("المعرّف غير صالح");
    let person = null;
    if (this.tmdbKey())
      person = await this.client.dataHub
        .request("tmdb", `person/${tmdb}`, {
          language: this.language(),
          append_to_response: "external_ids,combined_credits",
        })
        .catch(() => null);
    let linked = person?.external_ids?.wikidata_id;
    if (!QID.test(linked || ""))
      linked = await this.sparql(tmdbPersonQuery(tmdb))
        .then((r) => qidOf(rows(r)[0]?.entity?.value))
        .catch(() => "");
    if (QID.test(linked || "")) {
      try {
        return await this.wikidataEntity(linked, person);
      } catch (error) {
        if (!person) throw error;
      }
    }
    if (!person) throw new Error("تعذّر العثور على معلومات هذا الشخص");
    return this.tmdbEntity(person);
  }
  async wikidataEntity(qid, person = null) {
    const [facts, names, works] = await Promise.all([
      this.sparql(entityQuery(qid)),
      this.sparql(nameQuery(qid)),
      this.sparql(worksQuery(qid)).then(parseWorks),
    ]);
    const entity = { qid, ...parseEntity(facts, names), works };
    entity.sources = ["Wikidata"];
    if (!person && entity.tmdbPerson && this.tmdbKey())
      person = await this.client.dataHub
        .request("tmdb", `person/${entity.tmdbPerson}`, {
          language: this.language(),
        })
        .catch(() => null);
    if (person) {
      const tmdb = parseTmdbPerson(person);
      if (tmdb.biography) entity.biography = tmdb.biography;
      entity.image = tmdb.image || entity.image;
      entity.name ||= tmdb.name;
      entity.sources.push("TMDB");
    }
    return entity;
  }
  /** Works from TMDB, each resolved to the IMDb ID Riwaq opens titles by. */
  async tmdbEntity(person) {
    const hub = this.client.dataHub;
    const candidates = tmdbWorkCandidates(person);
    const ids = await pooled(candidates, 6, (c) =>
      hub.request("tmdb", `${c.kind}/${c.id}/external_ids`),
    );
    const works = candidates
      .map((c, i) => ({ c, imdb: ids[i]?.imdb_id }))
      .filter(({ imdb }) => IMDB.test(imdb || ""))
      .map(({ c, imdb }) => ({
        id: imdb,
        name: c.name,
        poster: posterOf(imdb),
        year: c.year,
        type: c.kind === "tv" ? "series" : "movie",
        roles: c.roles,
        roleLabels: c.roles.map((r) => ROLE_LABELS[r]).filter(Boolean),
      }))
      .sort((a, b) => (b.year || 0) - (a.year || 0));
    return { qid: "", ...parseTmdbPerson(person), works, sources: ["TMDB"] };
  }
}

/**
 * Adds TMDB to Wikidata's credits: portraits and characters for the people
 * Wikidata lists (matched by name), the rest of the cast when Wikidata lists
 * only the leads, and the TMDB ID on everyone so anyone can be opened.
 */
export function mergeTmdb(result, tmdb) {
  const byName = new Map(tmdb.cast.map((c) => [normalName(c.name), c]));
  const byId = new Map(tmdb.cast.map((c) => [c.tmdb, c]));
  const same = (a, b) =>
    (a.tmdb && a.tmdb === b.tmdb) || normalName(a.name) === normalName(b.name);
  for (const person of result.cast) {
    const hit =
      (person.tmdb && byId.get(person.tmdb)) ||
      byName.get(normalName(person.name));
    if (!hit) continue;
    person.image = hit.image || person.image;
    person.character ||= hit.character;
    person.tmdb ||= hit.tmdb;
  }
  if (result.cast.length < 8)
    for (const c of tmdb.cast.slice(0, 24))
      if (!result.cast.some((p) => same(p, c))) result.cast.push(c);
  // Wikidata's crew stands; TMDB's is used only when Wikidata has none.
  const wikidataCrew = result.crew.length > 0;
  for (const person of tmdb.crew) {
    const known = result.crew.filter((p) => same(p, person));
    if (known.length) {
      for (const p of known) {
        p.image ||= person.image;
        p.tmdb ||= person.tmdb;
      }
    } else if (!wikidataCrew) result.crew.push(person);
  }
  if (!result.companies.length) result.companies = tmdb.companies;
  if (!result.countries.length) result.countries = tmdb.countries;
}

/**
 * A 2×2 block of OpenStreetMap tiles around a Wikidata point, with the pin's
 * position inside it in percent. Browser-safe; images only, no map library.
 */
export function mapTiles(coord, zoom = 6) {
  const match = String(coord || "").match(
    /^Point\((-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)\)$/,
  );
  if (!match) return null;
  const lon = Number(match[1]);
  const lat = Number(match[2]);
  if (Math.abs(lat) > 85 || Math.abs(lon) > 180) return null;
  const n = 2 ** zoom;
  const xf = ((lon + 180) / 360) * n;
  const rad = (lat * Math.PI) / 180;
  const yf =
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  const x0 = Math.floor(xf - 0.5);
  const y0 = Math.max(0, Math.min(n - 2, Math.floor(yf - 0.5)));
  const wrap = (x) => ((x % n) + n) % n;
  const tiles = [];
  for (const dy of [0, 1])
    for (const dx of [0, 1])
      tiles.push(
        `https://tile.openstreetmap.org/${zoom}/${wrap(x0 + dx)}/${y0 + dy}.png`,
      );
  return {
    tiles,
    left: ((xf - x0) / 2) * 100,
    top: ((yf - y0) / 2) * 100,
  };
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
/**
 * The YouTube ID of a title's trailer from its addon metadata: Stremio's
 * `trailerStreams` first, then the older `trailers` list. Browser-safe; main
 * reads it again from its own copy of the metadata before opening anything.
 */
export function trailerOf(meta) {
  for (const s of Array.isArray(meta?.trailerStreams)
    ? meta.trailerStreams
    : [])
    if (YOUTUBE_ID.test(s?.ytId || "")) return s.ytId;
  for (const t of Array.isArray(meta?.trailers) ? meta.trailers : [])
    if (YOUTUBE_ID.test(t?.source || "") && (!t.type || t.type === "Trailer"))
      return t.source;
  return "";
}
