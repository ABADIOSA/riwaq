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
  collections: 40,
  folders: 40,
  catalogs: 20,
  titles: 500,
};
export const SHAPES = ["poster", "landscape", "square"];
export const VIEWS = ["tabs", "rows"];

const ID = /^[\w-]{1,64}$/;
const newId = () =>
  (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`)
    .replace(/[^\w-]/g, "")
    .slice(0, 36);
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
const emojiOf = (value) => {
  const text = line(value, 16);
  // One grapheme is the intent; a few code points allow flags and joiners.
  return text && [...text].length <= 8 ? text : "";
};
const ADDON_ID = /^[\w.:@/+-]{1,200}$/;
const TYPE = /^[\w.-]{1,40}$/;

function cleanCatalog(source) {
  if (!source || typeof source !== "object") return null;
  const addon = line(source.addon, 200);
  const type = line(source.type, 40);
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
/** Discover filters Riwaq passes on to TMDB, each checked by its own rule. */
const FILTERS = {
  withGenres: /^[\d,|]{1,200}$/,
  withKeywords: /^[\d,|]{1,400}$/,
  withCompanies: /^[\d,|]{1,200}$/,
  withNetworks: /^[\d,|]{1,200}$/,
  withPeople: /^[\d,|]{1,200}$/,
  withWatchProviders: /^[\d,|]{1,200}$/,
  withOriginalLanguage: /^[a-z]{2,3}$/,
  withOriginCountry: /^[A-Z]{2}(\|[A-Z]{2})*$/,
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
};
function cleanFilters(input) {
  if (!input || typeof input !== "object") return undefined;
  const out = {};
  for (const [key, rule] of Object.entries(FILTERS))
    if (typeof input[key] === "string" && rule.test(input[key]))
      out[key] = input[key];
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
    cover: coverUrl(folder.cover),
    shape: SHAPES.includes(folder.shape) ? folder.shape : "poster",
    catalogs,
    tmdb,
    trakt,
    titles,
  };
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
  return {
    id: ID.test(collection.id || "") ? collection.id : newId(),
    title,
    emoji: emojiOf(collection.emoji),
    cover: coverUrl(collection.cover),
    pinned: collection.pinned === true,
    view: VIEWS.includes(collection.view) ? collection.view : "tabs",
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
      for (const key of ["title", "emoji", "cover", "view"])
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
        for (const key of ["title", "emoji", "cover", "shape"])
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
export function fromNuvio(input) {
  let data = input;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      throw new Error("ملف مجموعات نوفيو غير صالح");
    }
  }
  if (!Array.isArray(data)) throw new Error("ملف مجموعات نوفيو غير صالح");
  let skipped = 0;
  const collections = data.map((c) => ({
    id: typeof c?.id === "string" ? `nuvio-${c.id}` : undefined,
    title: c?.title,
    cover: c?.backdropImageUrl,
    pinned: c?.pinToTop === true,
    view: String(c?.viewMode || "").toUpperCase() === "ROWS" ? "rows" : "tabs",
    folders: (Array.isArray(c?.folders) ? c.folders : []).map((f) => {
      const sources =
        Array.isArray(f?.sources) && f.sources.length
          ? f.sources
          : (Array.isArray(f?.catalogSources) ? f.catalogSources : []).map(
              (s) => ({ ...s, provider: "addon" }),
            );
      const catalogs = [];
      const tmdb = [];
      const trakt = [];
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
          if (t) tmdb.push(t);
          else skipped++;
        } else if (provider === "trakt") {
          const t = cleanTrakt({
            list: s?.traktListId,
            media,
            sort: s?.sortBy,
            how: s?.sortHow,
            title: s?.title,
          });
          if (t) trakt.push(t);
          else skipped++;
        } else if (s?.addonId && s?.catalogId)
          catalogs.push({
            addon: s.addonId,
            type: s.type,
            catalog: s.catalogId,
            genre: s.genre && s.genre !== "none" ? s.genre : "",
          });
        else skipped++;
      }
      return {
        id: typeof f?.id === "string" ? `nuvio-${f.id}` : undefined,
        title: f?.title,
        emoji: f?.coverEmoji,
        cover: f?.coverImageUrl,
        shape:
          String(f?.tileShape || "poster").toLowerCase() === "wide"
            ? "landscape"
            : String(f?.tileShape || "poster").toLowerCase(),
        catalogs,
        tmdb,
        trakt,
      };
    }),
  }));
  const clean = cleanCollections(collections);
  return {
    collections: clean,
    folders: clean.reduce((n, c) => n + c.folders.length, 0),
    skipped,
  };
}

/**
 * Riwaq collections as Nuvio JSON, so the arrangement can go back the other
 * way. Hand-picked titles have no Nuvio equivalent and are left out.
 */
export function toNuvio(collections) {
  return cleanCollections(collections).map((c) => ({
    id: c.id,
    title: c.title,
    backdropImageUrl: c.cover || null,
    pinToTop: c.pinned,
    viewMode: c.view === "rows" ? "ROWS" : "TABBED_GRID",
    showAllTab: true,
    folders: c.folders
      .filter((f) => f.catalogs.length || f.tmdb.length || f.trakt.length)
      .map((f) => ({
        id: f.id,
        title: f.title,
        coverImageUrl: f.cover || null,
        coverEmoji: f.emoji || null,
        tileShape: f.shape,
        hideTitle: false,
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
            filters: t.filters || null,
          })),
          ...f.trakt.map((t) => ({
            provider: "trakt",
            traktListId: t.list,
            mediaType: t.media === "tv" ? "TV" : "MOVIE",
            sortBy: t.sort,
            sortHow: t.how,
            title: t.title || null,
          })),
        ],
      })),
  }));
}

/** Imported collections join the viewer's; a re-import updates the one with its ID. */
export function mergeCollections(current, incoming) {
  const out = cleanCollections(current);
  let added = 0;
  for (const c of cleanCollections(incoming)) {
    if (out.length >= LIMITS.collections) break;
    const existing = out.findIndex((x) => x.id === c.id);
    if (existing >= 0) out[existing] = c;
    else out.push(c);
    added++;
  }
  return { collections: out, added };
}

/**
 * The addon catalog a folder source points at: the addon with that manifest
 * ID first, then any enabled addon offering a catalog with the same type and
 * ID (a reinstalled or forked addon keeps working). `addons` are enabled
 * addons with their manifests.
 */
export function resolveCatalog(addons, source) {
  const find = (addon) =>
    (addon.manifest?.catalogs || []).find(
      (c) => c.type === source.type && c.id === source.catalog,
    ) ||
    (addon.manifest?.catalogs || []).find(
      (c) => c.type === source.type && c.id === source.catalog.split(",")[0],
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
