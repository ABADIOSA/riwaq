/**
 * Collections: the viewer's own arrangement of what to watch.
 *
 * A collection holds folders. A folder gathers addon catalogs (referenced by
 * the addon's manifest ID, type and catalog ID, so a reconfigured addon or a
 * restored backup still finds them), TMDB sources (a list, a film collection,
 * a studio, a network, a person or a discover query, read with the viewer's
 * TMDB key), Trakt public lists (read with the viewer's Trakt client ID) and
 * titles the viewer picked by hand, in the order they chose. Pinned
 * collections appear on the home page.
 *
 * The shape follows Nuvio's collections closely enough to read its JSON
 * export and write one back; folders of hand-picked titles are Riwaq's own
 * and are left out of a Nuvio export. Browser-safe: validation runs in main,
 * the interface uses the same rules to explain them.
 */

import { cleanMedia } from "./library.mjs";

export const LIMITS = {
  collections: 60,
  folders: 100,
  catalogs: 40,
  titles: 500,
};
export const SHAPES = ["poster", "landscape", "square"];
export const VIEWS = ["tabs", "rows"];

const ID = /^[\w-]{1,64}$/;
const newId = () =>
  (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`)
    .replace(/[^\w-]/g, "")
    .slice(0, 36);
/**
 * A short, deterministic digest (two FNV-1a rounds, 64 bits as hex), for
 * IDs that must come out the same wherever the same text is read: the
 * renderer's preview and main's import (PR #155 review, F1), and a
 * template folder's queries (F3). Not a security hash.
 */
export function stableHash(text) {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}
const line = (value, max) =>
  typeof value === "string"
    ? value
        .replace(/[\u0000-\u001f\u007f]+/g, " ")
        .trim()
        .slice(0, max)
    : "";
/** A cover must be a plain HTTPS image address without credentials. */
export function coverUrl(value) {
  if (typeof value !== "string" || value.length > 2000) return "";
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password) return "";
    return url.toString();
  } catch {
    return "";
  }
}
/**
 * Artwork for a collection or folder (cover, moving cover, backdrop, logo):
 * an HTTPS image address, or a picture the viewer chose from their own
 * computer, kept by Riwaq under an opaque ID ("local:" and 32 hex digits;
 * never a path). A ".gifv" (or other video) address is not an image an
 * <img> can show, whatever its name says: it is refused rather than turned
 * into something it is not.
 */
export const LOCAL_ART = /^local:[a-f\d]{32}$/;
const VIDEO_EXT = /\.(gifv|mp4|m4v|webm|mov|mkv|avi)(?:[?#]|$)/i;
export function artUrl(value) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (LOCAL_ART.test(text)) return text;
  const url = coverUrl(text);
  if (!url || VIDEO_EXT.test(new URL(url).pathname)) return "";
  return url;
}
const emojiOf = (value) => {
  const text = line(value, 16);
  // One grapheme is the intent; a few code points allow flags and joiners.
  return text && [...text].length <= 8 ? text : "";
};
// Addon IDs are only compared and shown as text, and a type is URL-encoded
// where it is used, so the rules are loose on purpose: a strict pattern once
// emptied folders imported from Nuvio without a word. Spaces, double quotes
// and angle brackets never appear in a real manifest ID and stay refused.
const ADDON_ID = /^[^\s<>"`]{1,200}$/;
// A type is not only "movie" or "series": list addons such as AIOLists give
// every catalog its own type, e.g. "IMDb's Top Drama Movies" or "Top
// Fantasy/Sci-Fi Movies", so any printable text is a valid type.
const TYPE = /^[^\u0000-\u001f\u007f]{0,200}$/;

function cleanCatalog(source) {
  if (!source || typeof source !== "object") return null;
  const addon = line(source.addon, 200);
  const type = line(source.type, 200);
  const catalog = line(source.catalog, 200);
  if (!ADDON_ID.test(addon) || !TYPE.test(type) || !catalog) return null;
  const genre = line(source.genre, 100);
  return { addon, type, catalog, ...(genre ? { genre } : {}) };
}
const catalogKey = (c) => `${c.addon}|${c.type}|${c.catalog}|${c.genre || ""}`;

export const TMDB_KINDS = [
  "list",
  "collection",
  "company",
  "network",
  "discover",
  "person",
  "director",
];
export const TMDB_SORTS = [
  "original",
  "popularity.desc",
  "vote_average.desc",
  "vote_count.desc",
  "primary_release_date.desc",
  "first_air_date.desc",
];
export const TRAKT_SORTS = [
  "rank",
  "added",
  "title",
  "released",
  "runtime",
  "popularity",
  "percentage",
  "votes",
];
const MEDIA = ["movie", "tv"];
const positive = (value, max = 2_000_000_000) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= max ? n : null;
};
/**
 * Discover filters Riwaq passes on to TMDB, each checked by its own rule.
 * These are the filters Nuvio's collections carry; a filter dropped here
 * would quietly turn a folder into TMDB's generic popular titles.
 */
const IDS = /^[\d,|]{1,400}$/;
const FILTERS = {
  withGenres: IDS,
  withoutGenres: IDS,
  withKeywords: IDS,
  withoutKeywords: IDS,
  withCompanies: IDS,
  withoutCompanies: IDS,
  withNetworks: IDS,
  withPeople: IDS,
  withWatchProviders: IDS,
  withoutWatchProviders: IDS,
  withOriginalLanguage: /^[a-z]{2,3}([|,][a-z]{2,3}){0,30}$/,
  withOriginCountry: /^[A-Z]{2}([|,][A-Z]{2}){0,60}$/,
  watchRegion: /^[A-Z]{2}$/,
  releaseDateGte: /^\d{4}-\d{2}-\d{2}$/,
  releaseDateLte: /^\d{4}-\d{2}-\d{2}$/,
};
const NUMBER_FILTERS = {
  voteAverageGte: [0, 10],
  voteAverageLte: [0, 10],
  voteCountGte: [0, 1_000_000],
  year: [1870, 2200],
  withRuntimeGte: [0, 1000],
  withRuntimeLte: [0, 1000],
  // Riwaq's own: released within the last N days, counted from the day
  // the row is asked for, so a "New" row stays new in later years
  // (core/collection-sources.mjs tmdbRequest).
  recentDays: [1, 3650],
};
function cleanFilters(input) {
  if (!input || typeof input !== "object") return undefined;
  const out = {};
  for (const [key, rule] of Object.entries(FILTERS)) {
    if (typeof input[key] !== "string") continue;
    // Written by hand in Nuvio, so spaces and letter case vary.
    let value = input[key].replace(/\s+/g, "");
    if (key === "withOriginalLanguage") value = value.toLowerCase();
    if (key === "withOriginCountry" || key === "watchRegion")
      value = value.toUpperCase();
    if (rule.test(value)) out[key] = value;
  }
  for (const [key, [min, max]] of Object.entries(NUMBER_FILTERS)) {
    const n = Number(input[key]);
    if (
      input[key] !== null &&
      input[key] !== undefined &&
      Number.isFinite(n) &&
      n >= min &&
      n <= max
    )
      out[key] = n;
  }
  return Object.keys(out).length ? out : undefined;
}
/**
 * The discover filters a viewer typed that the rules above would drop:
 * their names, so an edit is refused with a reason instead of quietly
 * losing a field (F9). Empty values are not problems (they clear).
 */
export function tmdbFilterProblems(input) {
  if (!input || typeof input !== "object") return [];
  const kept = cleanFilters(input) || {};
  return Object.entries(input)
    .filter(
      ([key, value]) =>
        (FILTERS[key] || NUMBER_FILTERS[key]) &&
        value !== null &&
        value !== undefined &&
        String(value).trim() !== "" &&
        !(key in kept),
    )
    .map(([key]) => key);
}
export const TMDB_FILTER_KEYS = [
  ...Object.keys(FILTERS),
  ...Object.keys(NUMBER_FILTERS),
];
function cleanTmdb(source) {
  if (!source || typeof source !== "object") return null;
  const kind = String(source.kind || "").toLowerCase();
  if (!TMDB_KINDS.includes(kind)) return null;
  const id = positive(source.id);
  // Every kind but discover points at one TMDB object.
  if (kind !== "discover" && !id) return null;
  const media =
    kind === "network"
      ? "tv"
      : kind === "collection"
        ? "movie"
        : MEDIA.includes(source.media)
          ? source.media
          : "movie";
  const filters =
    kind === "discover" ? cleanFilters(source.filters) : undefined;
  // A discover source without filters is simply TMDB's popular titles.
  const title = line(source.title, 80);
  return {
    kind,
    ...(id ? { id } : {}),
    media,
    // A list, a collection or a filmography keeps TMDB's own order unless
    // asked otherwise; a studio, network or discover query is by popularity.
    sort: TMDB_SORTS.includes(source.sort)
      ? source.sort
      : ["list", "collection", "person", "director"].includes(kind)
        ? "original"
        : "popularity.desc",
    ...(title ? { title } : {}),
    ...(filters ? { filters } : {}),
  };
}
const tmdbKey = (t) =>
  `${t.kind}|${t.id || JSON.stringify(t.filters)}|${t.media}`;
function cleanTrakt(source) {
  if (!source || typeof source !== "object") return null;
  const list = positive(source.list, 1e15);
  if (!list) return null;
  const title = line(source.title, 80);
  return {
    list,
    media: MEDIA.includes(source.media) ? source.media : "movie",
    sort: TRAKT_SORTS.includes(source.sort) ? source.sort : "rank",
    how: source.how === "desc" ? "desc" : "asc",
    ...(title ? { title } : {}),
  };
}
const traktKey = (t) => `${t.list}|${t.media}`;
/**
 * A source Riwaq cannot read, kept as plain data so an export gives it back
 * as it came: strings, numbers, booleans and null, in objects and lists at
 * most four deep, 40 keys, 60 items and 500 characters a string. Nothing in
 * it is ever run or fetched.
 */
export function plainCopy(value, depth = 0) {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string")
    return CARRIES_CREDENTIAL(value) ? undefined : value.slice(0, 500);
  if (depth >= 4 || typeof value !== "object") return undefined;
  if (Array.isArray(value))
    return value
      .slice(0, 60)
      .map((v) => plainCopy(v, depth + 1))
      .filter((v) => v !== undefined);
  const out = {};
  for (const [key, v] of Object.entries(value).slice(0, 40)) {
    if (!/^[\w.-]{1,60}$/.test(key) || key === "__proto__") continue;
    if (CREDENTIAL_KEY.test(key)) continue;
    const copy = plainCopy(v, depth + 1);
    if (copy !== undefined) out[key] = copy;
  }
  return out;
}
/*
 * Such a copy travels in backups and accounts even without secrets, so
 * nothing that looks like one is kept (PR #155 review, security): a field
 * named like a key, token, password or session, and an address that
 * carries a user name, a password or a key in its query.
 */
const CREDENTIAL_KEY =
  /^key$|(?:api[_.-]?key|apikey|access[_.-]?key|secret|token|password|passwd|pwd|auth|authorization|cookie|session|credential|bearer|private[_.-]?key)s?$/i;
const CARRIES_CREDENTIAL = (text) => {
  if (!/^[a-z][\w+.-]*:\/\//i.test(text.trim())) return false;
  try {
    const url = new URL(text.trim());
    if (url.username || url.password) return true;
    return [...url.searchParams.keys()].some((k) => CREDENTIAL_KEY.test(k));
  } catch {
    return false;
  }
};

/** Adds cleaned, unique entries up to the per-folder limit. */
function collect(input, clean, key) {
  const out = [];
  for (const source of Array.isArray(input) ? input : []) {
    const c = clean(source);
    if (c && !out.some((x) => key(x) === key(c))) out.push(c);
    if (out.length >= LIMITS.catalogs) break;
  }
  return out;
}

/** Well-known TMDB studios and networks, by their public TMDB IDs. */
export const TMDB_PRESETS = [
  { kind: "company", id: 420, media: "movie", title: "Marvel Studios" },
  { kind: "company", id: 2, media: "movie", title: "Walt Disney Pictures" },
  { kind: "company", id: 3, media: "movie", title: "Pixar" },
  { kind: "company", id: 1, media: "movie", title: "Lucasfilm" },
  { kind: "company", id: 174, media: "movie", title: "Warner Bros." },
  { kind: "network", id: 213, media: "tv", title: "Netflix" },
  { kind: "network", id: 49, media: "tv", title: "HBO" },
  { kind: "network", id: 2739, media: "tv", title: "Disney+" },
  { kind: "network", id: 1024, media: "tv", title: "Prime Video" },
  { kind: "network", id: 2552, media: "tv", title: "Apple TV+" },
];

/**
 * A TMDB page address or "kind/id" pasted by the viewer into a source, e.g.
 * https://www.themoviedb.org/collection/10-star-wars-collection.
 */
export function parseTmdbSource(input) {
  const m = String(input || "").match(
    /(list|collection|company|network|person)\/(\d{1,10})/,
  );
  if (!m) return null;
  return cleanTmdb({
    kind: m[1],
    id: Number(m[2]),
    media: m[1] === "network" ? "tv" : "movie",
  });
}
/** A Trakt list address or number, e.g. https://trakt.tv/lists/123456. */
export function parseTraktSource(input) {
  const text = String(input || "").trim();
  const m = text.match(/(?:lists\/)?(\d{1,15})\b/);
  return m ? cleanTrakt({ list: Number(m[1]) }) : null;
}

function cleanFolder(folder) {
  if (!folder || typeof folder !== "object") return null;
  const title = line(folder.title, 80);
  if (!title) return null;
  const catalogs = [];
  for (const source of Array.isArray(folder.catalogs) ? folder.catalogs : []) {
    const clean = cleanCatalog(source);
    if (clean && !catalogs.some((c) => catalogKey(c) === catalogKey(clean)))
      catalogs.push(clean);
    if (catalogs.length >= LIMITS.catalogs) break;
  }
  const tmdb = collect(folder.tmdb, cleanTmdb, tmdbKey);
  const trakt = collect(folder.trakt, cleanTrakt, traktKey);
  // Sources Riwaq cannot read yet, kept by name so the folder can say so.
  const unsupported = (
    Array.isArray(folder.unsupported) ? folder.unsupported : []
  )
    .map((u) => {
      const raw = plainCopy(u?.raw);
      return {
        provider: line(u?.provider, 30),
        title: line(u?.title, 80),
        ...(raw && typeof raw === "object" ? { raw } : {}),
      };
    })
    .filter((u) => u.provider)
    .slice(0, LIMITS.catalogs);
  const titles = [];
  for (const meta of Array.isArray(folder.titles) ? folder.titles : []) {
    try {
      const clean = cleanMedia(meta);
      if (!titles.some((t) => t.id === clean.id && t.type === clean.type))
        titles.push(clean);
    } catch {
      /* A malformed title is dropped, not allowed to fail the folder. */
    }
    if (titles.length >= LIMITS.titles) break;
  }
  return {
    id: ID.test(folder.id || "") ? folder.id : newId(),
    title,
    emoji: emojiOf(folder.emoji),
    cover: artUrl(folder.cover),
    shape: SHAPES.includes(folder.shape) ? folder.shape : "poster",
    ...folderLook(folder),
    catalogs,
    tmdb,
    trakt,
    ...(unsupported.length ? { unsupported } : {}),
    titles,
    // A template folder remembers the digest of the queries it was given,
    // so updating the template can tell the viewer's edits from its own.
    ...(TPL.test(folder.tpl || "") ? { tpl: folder.tpl } : {}),
  };
}
const TPL = /^[a-f\d]{16}$/;

/**
 * How a folder's card looks beyond its cover (Nuvio's folder fields): the
 * moving cover shown on hover or focus, and whether it may play; a large
 * backdrop for its page; a title logo; the glow around a focused card; and
 * hiding the typed name (a cover or logo that already says it). Only what
 * is set is kept, so older folders keep their shape.
 */
function folderLook(folder) {
  const out = {};
  const gif = artUrl(folder.gif);
  if (gif) {
    out.gif = gif;
    out.gifOn = folder.gifOn !== false;
  }
  const backdrop = artUrl(folder.backdrop);
  if (backdrop) out.backdrop = backdrop;
  const logo = artUrl(folder.logo);
  if (logo) out.logo = logo;
  if (folder.glow === true) out.glow = true;
  if (folder.hideTitle === true) out.hideTitle = true;
  return out;
}

function cleanCollection(collection) {
  if (!collection || typeof collection !== "object") return null;
  const title = line(collection.title, 80);
  if (!title) return null;
  const folders = [];
  for (const folder of Array.isArray(collection.folders)
    ? collection.folders
    : []) {
    const clean = cleanFolder(folder);
    if (clean && !folders.some((f) => f.id === clean.id)) folders.push(clean);
    if (folders.length >= LIMITS.folders) break;
  }
  const logo = artUrl(collection.logo);
  const tplFolders = Array.isArray(collection.tplFolders)
    ? collection.tplFolders
        .filter((id) => typeof id === "string" && ID.test(id))
        .slice(0, LIMITS.folders)
    : null;
  return {
    id: ID.test(collection.id || "") ? collection.id : newId(),
    title,
    emoji: emojiOf(collection.emoji),
    cover: artUrl(collection.cover),
    ...(logo ? { logo } : {}),
    pinned: collection.pinned === true,
    view: VIEWS.includes(collection.view) ? collection.view : "tabs",
    // Nuvio's "All" tab switch, kept only when off so a round trip gives
    // it back (Riwaq's own view has no such tab).
    ...(collection.showAll === false ? { showAll: false } : {}),
    // The folders a template had when it was last added or updated: one
    // the viewer removed is not brought back by the next update.
    ...(tplFolders ? { tplFolders } : {}),
    folders,
  };
}

/** Field-by-field validation for anything that did not come from this app. */
export function cleanCollections(input) {
  const out = [];
  for (const collection of Array.isArray(input) ? input : []) {
    const clean = cleanCollection(collection);
    if (clean && !out.some((c) => c.id === clean.id)) out.push(clean);
    if (out.length >= LIMITS.collections) break;
  }
  return out;
}

const move = (list, index, direction) => {
  const target = index + (direction === "up" ? -1 : 1);
  if (index < 0 || target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
};
const fail = (message) => {
  throw new Error(message);
};

/**
 * One edit, returning a new list. Every input passes the same validation an
 * import does, so the interface can never store what a restore would reject.
 */
export function editCollections(list, input = {}) {
  const collections = cleanCollections(list);
  const { action } = input;
  const at = (id) => {
    const index = collections.findIndex((c) => c.id === id);
    if (index < 0) fail("المجموعة غير موجودة");
    return index;
  };
  const folderAt = (collection, id) => {
    const index = collection.folders.findIndex((f) => f.id === id);
    if (index < 0) fail("المجلد غير موجود");
    return index;
  };
  const replace = (index, collection) => {
    const clean = cleanCollection(collection);
    if (!clean) fail("أدخل اسماً للمجموعة");
    const next = [...collections];
    next[index] = clean;
    return next;
  };
  const withFolder = (fn) => {
    const index = at(input.collectionId);
    const collection = collections[index];
    const folderIndex = folderAt(collection, input.folderId);
    const folders = [...collection.folders];
    const folder = fn({ ...folders[folderIndex] });
    if (!cleanFolder(folder)) fail("أدخل اسماً للمجلد");
    folders[folderIndex] = folder;
    return replace(index, { ...collection, folders });
  };

  switch (action) {
    case "create": {
      if (collections.length >= LIMITS.collections)
        fail("وصلت إلى الحد الأقصى من المجموعات");
      const clean = cleanCollection({
        title: input.title,
        emoji: input.emoji,
        pinned: input.pinned !== false,
        folders: input.folders || [],
      });
      if (!clean) fail("أدخل اسماً للمجموعة");
      return [...collections, { ...clean, id: newId() }];
    }
    case "update": {
      const index = at(input.collectionId);
      const current = collections[index];
      const patch = {};
      for (const key of ["title", "emoji", "cover", "logo", "view"])
        if (input[key] !== undefined) patch[key] = input[key];
      // An empty rename keeps the current name rather than failing.
      if (patch.title !== undefined && !line(patch.title, 80))
        delete patch.title;
      if (typeof input.pinned === "boolean") patch.pinned = input.pinned;
      return replace(index, { ...current, ...patch });
    }
    case "remove":
      return collections.filter((c) => c.id !== input.collectionId);
    case "move":
      return move(collections, at(input.collectionId), input.direction);
    case "folderAdd": {
      const index = at(input.collectionId);
      const collection = collections[index];
      if (collection.folders.length >= LIMITS.folders)
        fail("وصلت إلى الحد الأقصى من المجلدات");
      const folder = cleanFolder({
        title: input.title,
        emoji: input.emoji,
        shape: input.shape,
        catalogs: input.catalogs,
        titles: input.titles,
      });
      if (!folder) fail("أدخل اسماً للمجلد");
      return replace(index, {
        ...collection,
        folders: [...collection.folders, { ...folder, id: newId() }],
      });
    }
    case "folderUpdate":
      return withFolder((folder) => {
        const current = { ...folder };
        for (const key of [
          "title",
          "emoji",
          "cover",
          "shape",
          "gif",
          "gifOn",
          "backdrop",
          "logo",
          "glow",
          "hideTitle",
        ])
          if (input[key] !== undefined) folder[key] = input[key];
        if (!line(folder.title, 80)) folder.title = current.title;
        return folder;
      });
    case "folderRemove": {
      const index = at(input.collectionId);
      const collection = collections[index];
      folderAt(collection, input.folderId);
      return replace(index, {
        ...collection,
        folders: collection.folders.filter((f) => f.id !== input.folderId),
      });
    }
    case "folderMove": {
      const index = at(input.collectionId);
      const collection = collections[index];
      return replace(index, {
        ...collection,
        folders: move(
          collection.folders,
          folderAt(collection, input.folderId),
          input.direction,
        ),
      });
    }
    case "catalogAdd":
      return withFolder((folder) => {
        const clean = cleanCatalog(input.catalog);
        if (!clean) fail("الكتالوج غير صالح");
        if (folder.catalogs.some((c) => catalogKey(c) === catalogKey(clean)))
          return folder;
        if (folder.catalogs.length >= LIMITS.catalogs)
          fail("وصلت إلى الحد الأقصى من الكتالوجات في المجلد");
        folder.catalogs = [...folder.catalogs, clean];
        return folder;
      });
    case "tmdbAdd":
      return withFolder((folder) => {
        const clean = cleanTmdb(input.source);
        if (!clean) fail("مصدر TMDB غير صالح");
        if (folder.tmdb.some((t) => tmdbKey(t) === tmdbKey(clean)))
          return folder;
        if (folder.tmdb.length >= LIMITS.catalogs)
          fail("وصلت إلى الحد الأقصى من مصادر TMDB في المجلد");
        folder.tmdb = [...folder.tmdb, clean];
        return folder;
      });
    case "traktAdd":
      return withFolder((folder) => {
        const clean = cleanTrakt(input.source);
        if (!clean) fail("قائمة Trakt غير صالحة");
        if (folder.trakt.some((t) => traktKey(t) === traktKey(clean)))
          return folder;
        if (folder.trakt.length >= LIMITS.catalogs)
          fail("وصلت إلى الحد الأقصى من قوائم Trakt في المجلد");
        folder.trakt = [...folder.trakt, clean];
        return folder;
      });
    // One TMDB source changed in place (PR #155 review, F9): a template's
    // discover queries are the viewer's to edit, not only to remove. The
    // rest of the folder stays as it is.
    case "tmdbUpdate":
      return withFolder((folder) => {
        const index = Number(input.index);
        if (!Number.isInteger(index) || !folder.tmdb[index])
          fail("المصدر غير موجود");
        const problems = tmdbFilterProblems(input.source?.filters);
        if (problems.length) fail(`قيمة غير صالحة في: ${problems.join(", ")}`);
        const clean = cleanTmdb(input.source);
        if (!clean) fail("مصدر TMDB غير صالح");
        if (
          folder.tmdb.some(
            (t, i) => i !== index && tmdbKey(t) === tmdbKey(clean),
          )
        )
          fail("في المجلد مصدر بنفس الاستعلام");
        folder.tmdb = folder.tmdb.map((t, i) => (i === index ? clean : t));
        return folder;
      });
    case "tmdbRemove":
    case "traktRemove":
      return withFolder((folder) => {
        const key = action === "tmdbRemove" ? "tmdb" : "trakt";
        folder[key] = folder[key].filter((_, i) => i !== Number(input.index));
        return folder;
      });
    case "catalogRemove":
      return withFolder((folder) => {
        folder.catalogs = folder.catalogs.filter(
          (_, i) => i !== Number(input.index),
        );
        return folder;
      });
    case "titleAdd":
      return withFolder((folder) => {
        const media = cleanMedia(input.meta);
        if (
          folder.titles.some((t) => t.id === media.id && t.type === media.type)
        )
          return folder;
        if (folder.titles.length >= LIMITS.titles)
          fail("وصلت إلى الحد الأقصى من العناوين في المجلد");
        folder.titles = [...folder.titles, media];
        return folder;
      });
    case "titleRemove":
      return withFolder((folder) => {
        folder.titles = folder.titles.filter(
          (t) => !(t.id === input.id && t.type === input.type),
        );
        return folder;
      });
    case "titleMove":
      return withFolder((folder) => {
        const index = folder.titles.findIndex(
          (t) => t.id === input.id && t.type === input.type,
        );
        folder.titles = move(folder.titles, index, input.direction);
        return folder;
      });
    default:
      fail("إجراء غير معروف");
  }
}

/** Where a title already sits, for the "add to collection" menu. */
export function titlePlaces(collections, meta) {
  const places = [];
  for (const c of collections || [])
    for (const f of c.folders || [])
      if (
        (f.titles || []).some((t) => t.id === meta?.id && t.type === meta?.type)
      )
        places.push(`${c.id}/${f.id}`);
  return places;
}

/**
 * Nuvio's collections JSON into Riwaq collections: addon catalogs, TMDB
 * sources and Trakt public lists all carry over. Only sources Riwaq cannot
 * read (malformed, or an unknown provider) are counted as skipped.
 */
// A stable ID for anything imported from Nuvio, so importing again replaces
// it instead of adding a copy, even when Nuvio's own ID is long or unusual.
// - A Riwaq export writes Riwaq's own IDs as "riwaq-<id>" (toNuvio): they
//   come back as they were, so a round trip updates rather than copies
//   (PR #155 review, F7).
// - Other IDs become "nuvio-<id>"; one already in that form is kept (files
//   written by Riwaq before the "riwaq-" form).
// - Nothing usable: the caller derives one from the entry's place and title
//   (stableHash), the same in the preview and the import (F1).
const nuvioId = (id) => {
  if (typeof id !== "string" && typeof id !== "number") return undefined;
  const text = String(id);
  const own = text.match(/^riwaq-([\w-]{1,64})$/);
  if (own) return own[1];
  const safe = text.replace(/[^\w-]/g, "").slice(-58);
  if (/^nuvio-[\w-]+$/.test(safe)) return safe;
  return safe ? `nuvio-${safe}` : undefined;
};
/** Riwaq's ID as Nuvio JSON carries it (the inverse of nuvioId). */
const exportId = (id) => {
  const nuvio = /^nuvio-([\w-]+)$/.exec(id);
  return nuvio ? nuvio[1] : `riwaq-${id}`;
};
/**
 * One ID per entry in a list: the entry's own (above), or one derived from
 * its place and title; a repeated ID gets a numbered suffix, so two entries
 * that share an ID are both kept, under IDs that are the same every time
 * the same file is read.
 */
function uniqueIds(entries, scope, report) {
  const seen = new Set();
  return entries.map((entry, index) => {
    let id =
      nuvioId(entry?.id) ||
      `nuvio-x${stableHash(`${scope}|${index}|${String(entry?.title ?? "")}`)}`;
    if (seen.has(id)) {
      report.duplicates++;
      for (let n = 2; seen.has(id); n++) {
        const suffix = `-${n}`;
        id = `${id.replace(/-\d+$/, "").slice(0, 64 - suffix.length)}${suffix}`;
      }
    }
    seen.add(id);
    return id;
  });
}

const NUVIO_SHAPES = {
  poster: "POSTER",
  landscape: "LANDSCAPE",
  square: "SQUARE",
};
const shapeFrom = (value) => {
  const shape = String(value || "poster").toLowerCase();
  return shape === "wide" ? "landscape" : shape;
};
const bool = (value) => (typeof value === "boolean" ? value : undefined);

/**
 * Nuvio's collections JSON into Riwaq collections. Every display field
 * comes across on its own (cover, moving cover and whether it plays, hero
 * backdrop, title logo, focus glow, hidden title, tile shape), so a moving
 * cover never stands in for the still one. Sources Riwaq cannot read are
 * kept as they came and named in the report, never dropped quietly; what
 * did not fit a limit is counted too.
 */
export function fromNuvio(input) {
  let data = input;
  if (typeof data === "string") {
    if (data.length > 4_000_000) throw new Error("ملف مجموعات نوفيو كبير جداً");
    try {
      data = JSON.parse(data);
    } catch {
      throw new Error("ملف مجموعات نوفيو غير صالح");
    }
  }
  // Nuvio exports a list; a single shared collection, or a list wrapped in an
  // object, is accepted too.
  if (data && !Array.isArray(data) && typeof data === "object")
    data = Array.isArray(data.collections)
      ? data.collections
      : Array.isArray(data.folders)
        ? [data]
        : data;
  if (!Array.isArray(data)) throw new Error("ملف مجموعات نوفيو غير صالح");
  const report = {
    sources: 0,
    unsupported: [],
    over: { collections: 0, folders: 0, sources: 0 },
    unnamed: 0,
    duplicates: 0,
    // The same counts for each collection, by the ID it will have, so an
    // import of some of the file reports only what was chosen (F7).
    byCollection: {},
  };
  report.over.collections = Math.max(0, data.length - LIMITS.collections);
  let skipped = 0;
  const kept = data.slice(0, LIMITS.collections);
  const collectionIds = uniqueIds(kept, "c", report);
  const collections = kept.map((c, ci) => {
    const folderList = Array.isArray(c?.folders) ? c.folders : [];
    const cid = collectionIds[ci];
    const mine = (report.byCollection[cid] = {
      sources: 0,
      unsupported: 0,
      over: {
        folders: Math.max(0, folderList.length - LIMITS.folders),
        sources: 0,
      },
    });
    report.over.folders += mine.over.folders;
    const folderIds = uniqueIds(
      folderList.slice(0, LIMITS.folders),
      `f|${cid}`,
      report,
    );
    return {
      id: cid,
      title: c?.title,
      cover: c?.backdropImageUrl,
      pinned: c?.pinToTop === true,
      view:
        String(c?.viewMode || "").toUpperCase() === "ROWS" ? "rows" : "tabs",
      ...(c?.showAllTab === false ? { showAll: false } : {}),
      folders: folderList.slice(0, LIMITS.folders).map((f, fi) => {
        const sources =
          Array.isArray(f?.sources) && f.sources.length
            ? f.sources
            : (Array.isArray(f?.catalogSources) ? f.catalogSources : []).map(
                (s) => ({ ...s, provider: "addon" }),
              );
        const catalogs = [];
        const tmdb = [];
        const trakt = [];
        const unsupported = [];
        const folderName =
          (typeof f?.title === "string" && f.title.trim()) ||
          sources.find((s) => typeof s?.title === "string" && s.title.trim())
            ?.title ||
          `مجلد ${fi + 1}`;
        // A source Riwaq cannot read is kept as it came, up to the same
        // per-folder limit as the others; one over it is counted as over,
        // never as kept (F7).
        const skip = (s) => {
          if (unsupported.length >= LIMITS.catalogs) {
            report.over.sources++;
            mine.over.sources++;
            return;
          }
          skipped++;
          mine.unsupported++;
          const entry = {
            provider: String(s?.provider || "addon").toLowerCase(),
            title: s?.title || s?.catalogId || "",
          };
          if (report.unsupported.length < 200)
            report.unsupported.push({
              ...entry,
              collection: String(c?.title || ""),
              collectionId: cid,
              folder: folderName,
            });
          unsupported.push({ ...entry, raw: plainCopy(s) });
        };
        const keep = (list, item) => {
          if (list.length >= LIMITS.catalogs) {
            report.over.sources++;
            mine.over.sources++;
          } else {
            list.push(item);
            report.sources++;
            mine.sources++;
          }
        };
        for (const s of sources) {
          const provider = String(s?.provider || "addon").toLowerCase();
          const media = /^(tv|series)$/i.test(String(s?.mediaType || ""))
            ? "tv"
            : "movie";
          if (provider === "tmdb") {
            const t = cleanTmdb({
              kind: String(s?.tmdbSourceType || "discover").toLowerCase(),
              id: s?.tmdbId,
              media,
              sort: s?.sortBy,
              title: s?.title,
              filters: s?.filters,
            });
            if (t) keep(tmdb, t);
            else skip(s);
          } else if (provider === "trakt") {
            const t = cleanTrakt({
              list: s?.traktListId,
              media,
              sort: s?.sortBy,
              how: s?.sortHow,
              title: s?.title,
            });
            if (t) keep(trakt, t);
            else skip(s);
          } else {
            const cat = cleanCatalog({
              addon: typeof s?.addonId === "string" ? s.addonId : "",
              type: typeof s?.type === "string" ? s.type : "",
              catalog: typeof s?.catalogId === "string" ? s.catalogId : "",
              genre: s?.genre && s.genre !== "none" ? s.genre : "",
            });
            if (cat && provider === "addon") keep(catalogs, cat);
            else skip(s);
          }
        }
        // Nuvio lets a folder hide its name behind a cover or logo, and such
        // a folder may have none at all; it still needs a name here.
        if (!(typeof f?.title === "string" && f.title.trim())) report.unnamed++;
        return {
          id: folderIds[fi],
          title: folderName,
          emoji: f?.coverEmoji,
          cover: f?.coverImageUrl,
          gif: f?.focusGifUrl,
          gifOn: bool(f?.focusGifEnabled),
          backdrop: f?.heroBackdropUrl,
          logo: f?.titleLogoUrl,
          glow: f?.focusGlowEnabled === true,
          hideTitle: f?.hideTitle === true,
          shape: shapeFrom(f?.tileShape),
          catalogs,
          tmdb,
          trakt,
          unsupported,
        };
      }),
    };
  });
  const clean = cleanCollections(collections);
  return {
    collections: clean,
    folders: clean.reduce((n, c) => n + c.folders.length, 0),
    skipped,
    report: {
      ...report,
      collections: clean.length,
      folders: clean.reduce((n, c) => n + c.folders.length, 0),
      invalid: Math.min(data.length, LIMITS.collections) - clean.length,
    },
  };
}

/**
 * Filters for Nuvio: a period counted back from today ("recentDays") also
 * goes as the date it means today, which Nuvio understands; reading the
 * file back, the period wins again.
 */
function nuvioFilters(filters) {
  if (!filters) return null;
  if (!filters.recentDays || filters.releaseDateGte) return filters;
  return { ...filters, releaseDateGte: daysAgo(filters.recentDays) };
}
export const daysAgo = (days, now = Date.now()) =>
  new Date(now - days * 86400000).toISOString().slice(0, 10);

/** A picture as Nuvio can read it: an address, never a local file. */
const exportArt = (value) => (value && !LOCAL_ART.test(value) ? value : null);

/**
 * Riwaq collections as Nuvio JSON, so the arrangement can go back the other
 * way with every display field. Hand-picked titles have no Nuvio
 * equivalent and are left out; pictures chosen from this computer stay on
 * it (their fields are null); sources Riwaq could not read go back as they
 * came.
 */
export function toNuvio(collections) {
  return cleanCollections(collections).map((c) => ({
    id: exportId(c.id),
    title: c.title,
    backdropImageUrl: exportArt(c.cover),
    pinToTop: c.pinned,
    viewMode: c.view === "rows" ? "ROWS" : "TABBED_GRID",
    showAllTab: c.showAll !== false,
    // A folder of hand-picked titles only has no Nuvio form and is left
    // out; one with nothing but its look (a cover, a moving cover, a
    // backdrop, a logo or an emoji Nuvio can show) goes, so it is not lost
    // on the way back (F7).
    folders: c.folders
      .filter(
        (f) =>
          f.catalogs.length ||
          f.tmdb.length ||
          f.trakt.length ||
          f.unsupported?.length ||
          exportArt(f.cover) ||
          exportArt(f.gif) ||
          exportArt(f.backdrop) ||
          exportArt(f.logo) ||
          (f.emoji && !f.titles.length),
      )
      .map((f) => ({
        id: exportId(f.id),
        title: f.title,
        coverImageUrl: exportArt(f.cover),
        focusGifUrl: exportArt(f.gif),
        focusGifEnabled: f.gif ? f.gifOn !== false : false,
        heroBackdropUrl: exportArt(f.backdrop),
        titleLogoUrl: exportArt(f.logo),
        focusGlowEnabled: f.glow === true,
        coverEmoji: f.emoji || null,
        tileShape: NUVIO_SHAPES[f.shape] || "POSTER",
        hideTitle: f.hideTitle === true,
        sources: [
          ...f.catalogs.map((s) => ({
            provider: "addon",
            addonId: s.addon,
            type: s.type,
            catalogId: s.catalog,
            genre: s.genre || null,
          })),
          ...f.tmdb.map((t) => ({
            provider: "tmdb",
            tmdbSourceType: t.kind.toUpperCase(),
            tmdbId: t.id ?? null,
            mediaType: t.media === "tv" ? "TV" : "MOVIE",
            sortBy: t.sort,
            title: t.title || null,
            filters: nuvioFilters(t.filters),
          })),
          ...f.trakt.map((t) => ({
            provider: "trakt",
            traktListId: t.list,
            mediaType: t.media === "tv" ? "TV" : "MOVIE",
            sortBy: t.sort,
            sortHow: t.how,
            title: t.title || null,
          })),
          ...(f.unsupported || [])
            .filter((u) => u.raw && typeof u.raw === "object")
            .map((u) => u.raw),
        ],
      })),
  }));
}

/** Imported collections join the viewer's; a re-import updates the one with its ID. */
export function mergeCollections(current, incoming) {
  // A Nuvio profile without collections brings nothing and changes nothing.
  if (!cleanCollections(incoming).length)
    return { collections: cleanCollections(current), added: 0 };
  const { collections, report } = importCollections(current, incoming, {
    mode: "merge",
  });
  return { collections, added: report.added + report.updated };
}

export const IMPORT_MODES = ["merge", "add", "replace"];

// What a Nuvio file can say about a folder. Anything else on a folder
// (hand-picked titles, a template's marker) exists only in Riwaq and a
// merge never takes it away.
const NUVIO_FOLDER_ART = ["cover", "gif", "backdrop", "logo"];
/**
 * One of the viewer's folders updated from a file's folder with the same
 * ID (PR #155 review, F3): the file's sources, name, shape and switches
 * win; a picture or emoji the file does not carry keeps the viewer's (a
 * picture from this computer is never in a file: toNuvio writes null);
 * hand-picked titles stay. To clear a picture, edit the folder or Replace.
 */
function mergeFolder(mine, theirs) {
  const out = {
    ...mine,
    title: theirs.title,
    shape: theirs.shape,
    catalogs: theirs.catalogs,
    tmdb: theirs.tmdb,
    trakt: theirs.trakt,
    glow: theirs.glow === true,
    hideTitle: theirs.hideTitle === true,
  };
  if (theirs.unsupported?.length) out.unsupported = theirs.unsupported;
  else delete out.unsupported;
  if (theirs.emoji) out.emoji = theirs.emoji;
  for (const key of NUVIO_FOLDER_ART) if (theirs[key]) out[key] = theirs[key];
  if (theirs.gif) out.gifOn = theirs.gifOn !== false;
  if (!out.glow) delete out.glow;
  if (!out.hideTitle) delete out.hideTitle;
  return out;
}
/** The same for a collection: the file's name, pin and view; the viewer's pictures where the file has none. */
function mergeCollection(mine, theirs) {
  const out = {
    ...mine,
    title: theirs.title,
    pinned: theirs.pinned,
    view: theirs.view,
  };
  if (theirs.emoji) out.emoji = theirs.emoji;
  if (theirs.cover) out.cover = theirs.cover;
  if (theirs.logo) out.logo = theirs.logo;
  if (theirs.showAll === false) out.showAll = false;
  else delete out.showAll;
  return out;
}

/**
 * Bringing collections in, as the viewer chose:
 * - merge (the default): a collection already here (same ID) is updated
 *   folder by folder (mergeFolder, mergeCollection), keeping what only
 *   Riwaq holds; the viewer's own folders stay; others are added.
 *   Importing the same file twice changes nothing more.
 * - add: copies with new IDs, beside whatever is here.
 * - replace: the chosen collections take the place of all of them.
 * `only` limits it to some of the file's collections: every ID it names
 * must be in the file (a preview of another reading is refused, F1), and
 * an import that would bring nothing is refused before anything changes,
 * so Replace can never leave the list empty. The report counts what was
 * added, updated, replaced and left out at a limit, and the folders and
 * unread sources actually written.
 */
export function importCollections(current, incoming, { mode, only } = {}) {
  const how = IMPORT_MODES.includes(mode) ? mode : "merge";
  const all = cleanCollections(incoming);
  const pick = Array.isArray(only) ? new Set(only.map(String)) : null;
  if (pick) {
    const missing = [...pick].filter((id) => !all.some((c) => c.id === id));
    if (missing.length && missing.length < pick.size)
      fail("تغيّر الملف منذ المعاينة؛ اعرضه مرة أخرى");
  }
  const chosen = all.filter((c) => !pick || pick.has(c.id));
  if (!chosen.length)
    fail(
      pick?.size
        ? "لم يبق في الملف شيء مما اخترته؛ اعرضه مرة أخرى"
        : "اختر مجموعة واحدة على الأقل",
    );
  const report = {
    added: 0,
    updated: 0,
    replaced: 0,
    skipped: 0,
    folders: 0,
    unsupported: 0,
    ids: [],
  };
  let out = cleanCollections(current);
  if (how === "replace") {
    report.replaced = out.length;
    out = [];
  }
  const wrote = (folder) => {
    report.folders++;
    report.unsupported += folder.unsupported?.length || 0;
  };
  for (const c of chosen) {
    const existing = how === "merge" ? out.findIndex((x) => x.id === c.id) : -1;
    if (existing >= 0) {
      const mine = out[existing];
      const folders = [...mine.folders];
      for (const f of c.folders) {
        const at = folders.findIndex((x) => x.id === f.id);
        if (at >= 0) {
          folders[at] = mergeFolder(folders[at], f);
          wrote(f);
        } else if (folders.length < LIMITS.folders) {
          folders.push(f);
          wrote(f);
        } else report.skipped++;
      }
      out[existing] = { ...mergeCollection(mine, c), folders };
      report.updated++;
      report.ids.push(c.id);
      continue;
    }
    if (out.length >= LIMITS.collections) {
      report.skipped++;
      continue;
    }
    const added = how === "add" ? { ...c, id: newId() } : c;
    out.push(added);
    c.folders.forEach(wrote);
    report.added++;
    report.ids.push(added.id);
  }
  return { collections: cleanCollections(out), report };
}

/** The digest of a folder's queries, as a template folder remembers it. */
const queriesOf = (tmdb) => stableHash(JSON.stringify(tmdb || []));

/**
 * Adding a Riwaq template, or bringing one already here up to date
 * (PR #155 review, F3, F9). A template is Riwaq's own: an update follows
 * the template where the viewer left it as it came and keeps every edit.
 * - New: added with each folder's query digest and the list of its folder
 *   IDs. At the collection limit it is refused, never reported as added.
 * - Already here: the viewer's name, emoji, pictures, pin and view stay.
 *   A template folder whose queries the viewer never changed takes the
 *   template's current ones; one they edited keeps theirs; its name, look
 *   and hand-picked titles are always theirs. A folder new in the
 *   template is added; one the viewer removed stays removed; the viewer's
 *   own folders are untouched.
 * Returns the list and whether it was added or updated.
 */
export function applyTemplate(current, template) {
  const list = cleanCollections(current);
  const [tpl] = cleanCollections([template]);
  if (!tpl) fail("قالب غير معروف");
  const stamp = (f) => ({ ...f, tpl: queriesOf(f.tmdb) });
  const ids = tpl.folders.map((f) => f.id);
  const index = list.findIndex((c) => c.id === tpl.id);
  if (index < 0) {
    if (list.length >= LIMITS.collections)
      fail("وصلت إلى الحد الأقصى من المجموعات");
    return {
      collections: cleanCollections([
        ...list,
        { ...tpl, tplFolders: ids, folders: tpl.folders.map(stamp) },
      ]),
      added: true,
    };
  }
  const mine = list[index];
  const known = new Set(mine.tplFolders || mine.folders.map((f) => f.id));
  const folders = mine.folders.map((f) => {
    const t = tpl.folders.find((x) => x.id === f.id);
    if (!t || !f.tpl || f.tpl !== queriesOf(f.tmdb)) return f;
    return { ...f, tmdb: t.tmdb, tpl: queriesOf(t.tmdb) };
  });
  for (const t of tpl.folders)
    if (
      !known.has(t.id) &&
      !folders.some((f) => f.id === t.id) &&
      folders.length < LIMITS.folders
    )
      folders.push(stamp(t));
  const next = [...list];
  next[index] = { ...mine, tplFolders: ids, folders };
  return { collections: cleanCollections(next), added: false };
}

/**
 * The addon catalog a folder source points at: the addon with that manifest
 * ID first, then any enabled addon offering a catalog with the same type and
 * ID (a reinstalled or forked addon keeps working). `addons` are enabled
 * addons with their manifests.
 */
export function resolveCatalog(addons, source) {
  // A source without a type (some Nuvio exports) matches on the ID alone.
  const sameType = (c) => !source.type || c.type === source.type;
  const find = (addon) =>
    (addon.manifest?.catalogs || []).find(
      (c) => sameType(c) && c.id === source.catalog,
    ) ||
    (addon.manifest?.catalogs || []).find(
      (c) => sameType(c) && c.id === source.catalog.split(",")[0],
    );
  const declared = addons.find((a) => a.manifest?.id === source.addon);
  const cat = declared && find(declared);
  if (cat) return { addon: declared, cat };
  for (const addon of addons) {
    const other = find(addon);
    if (other) return { addon, cat: other };
  }
  return null;
}

/** Catalogs a folder can use, without addon URLs. */
export function availableCatalogs(addons) {
  const out = [];
  for (const addon of addons)
    for (const cat of addon.manifest?.catalogs || []) {
      if (cat.type === "addon_catalog" || !addon.manifest?.id) continue;
      const extras = cat.extra || [];
      if (extras.some((e) => e.name === "search" && e.isRequired)) continue;
      const genre = extras.find((e) => e.name === "genre");
      out.push({
        addon: addon.manifest.id,
        addonName: String(addon.manifest.name || addon.manifest.id).slice(
          0,
          80,
        ),
        type: cat.type,
        catalog: cat.id,
        name: String(cat.name || cat.id).slice(0, 80),
        genres: (genre?.options || [])
          .filter((g) => typeof g === "string")
          .slice(0, 80),
        genreRequired: !!genre?.isRequired,
      });
    }
  return out;
}
