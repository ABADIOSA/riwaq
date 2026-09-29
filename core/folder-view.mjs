/**
 * What a folder page shows. The page holds one folder's hand-picked titles
 * and its source rows; these pure helpers decide which titles appear for the
 * chosen tab, type, search and order, merge a further page of a source into
 * its row, and pick a title at random. Browser-safe, shared with the tests.
 */

import { matchesArabic } from "./arabic.mjs";

export const FOLDER_SORTS = ["source", "newest", "rating", "name"];
export const FOLDER_TYPES = ["all", "movie", "series"];

const keyOf = (meta) => `${meta?.type}:${meta?.id}`;
const year = (meta) =>
  Number.parseInt(String(meta?.releaseInfo ?? meta?.year ?? "").slice(0, 4)) ||
  0;
const rating = (meta) => Number.parseFloat(meta?.imdbRating) || 0;

/** Titles once each, first appearance wins. */
export function unique(metas) {
  const seen = new Set();
  const out = [];
  for (const meta of metas || []) {
    if (!meta?.id) continue;
    const key = keyOf(meta);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(meta);
  }
  return out;
}

/**
 * One from each source in turn, so the "all" tab shows every source near the
 * top instead of the first source's hundred titles and nothing else.
 */
export function interleave(lists) {
  const out = [];
  const longest = Math.max(0, ...lists.map((l) => l?.length || 0));
  for (let i = 0; i < longest; i++)
    for (const list of lists) if (list?.[i]) out.push(list[i]);
  return unique(out);
}

/** The titles a tab shows, filtered and ordered as the viewer asked. */
export function folderItems(
  { titles = [], rows = [] } = {},
  { tab = "all", type = "all", query = "", sort = "source" } = {},
) {
  let items;
  if (tab === "all")
    items = interleave([titles, ...rows.map((row) => row.metas || [])]);
  else if (tab === "picks") items = unique(titles);
  else items = unique(rows.find((row) => row.index === tab)?.metas);
  if (type !== "all") items = items.filter((meta) => meta.type === type);
  if (String(query).trim())
    items = items.filter((meta) => matchesArabic(meta.name || "", query));
  if (sort === "newest") items = [...items].sort((a, b) => year(b) - year(a));
  else if (sort === "rating")
    items = [...items].sort((a, b) => rating(b) - rating(a));
  else if (sort === "name")
    items = [...items].sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""), "ar"),
    );
  return items;
}

/** A further page of a source, appended to its row without repeats. */
export function mergePage(row, page) {
  const metas = unique([...(row.metas || []), ...(page?.metas || [])]);
  const grew = metas.length > (row.metas || []).length;
  return {
    ...row,
    metas,
    page: page?.page ?? row.page,
    // A page that added nothing ends the source, whatever it claimed.
    more: !!page?.more && grew,
  };
}

/** A title to watch when the viewer cannot choose. */
export function randomPick(items, random = Math.random) {
  if (!items?.length) return null;
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}
