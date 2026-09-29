/**
 * Collections: the viewer's own arrangement of what to watch.
 *
 * A collection holds folders. A folder gathers addon catalogs (referenced by
 * the addon's manifest ID, type and catalog ID, so a reconfigured addon or a
 * restored backup still finds them) and titles the viewer picked by hand, in
 * the order they chose. Pinned collections appear on the home page.
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
 * Nuvio's collections JSON into Riwaq collections. Addon catalogs carry over;
 * TMDB and Trakt sources have no addon to read from here and are counted so
 * the viewer knows what did not come across.
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
      for (const s of sources) {
        const provider = String(s?.provider || "addon").toLowerCase();
        if (provider !== "addon" || !s?.addonId || !s?.catalogId) {
          skipped++;
          continue;
        }
        catalogs.push({
          addon: s.addonId,
          type: s.type,
          catalog: s.catalogId,
          genre: s.genre && s.genre !== "none" ? s.genre : "",
        });
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
      .filter((f) => f.catalogs.length)
      .map((f) => ({
        id: f.id,
        title: f.title,
        coverImageUrl: f.cover || null,
        coverEmoji: f.emoji || null,
        tileShape: f.shape,
        hideTitle: false,
        sources: f.catalogs.map((s) => ({
          provider: "addon",
          addonId: s.addon,
          type: s.type,
          catalogId: s.catalog,
          genre: s.genre || null,
        })),
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
