/**
 * "See all" (src/components/BrowsePage.jsx): the real catalogs behind a row
 * or a group, each paged by its own provider cursor. Browser-safe and pure.
 *
 * - The provider's page size advances `skip`, never the de-duplicated card
 *   count, so a repeated page moves on instead of stalling.
 * - "All" keeps an append-only order: titles that arrive later go after the
 *   ones on screen, so cards never reorder under the pointer.
 * - A failure stays on its catalog; the others keep loading, and a retry
 *   asks only the failed one again.
 */
import { interleave, unique } from "./folder-view.mjs";

/** How many catalogs "All" asks at once. */
export const BROWSE_PARALLEL = 4;

const cleanFilters = (values) =>
  Object.fromEntries(
    Object.entries(values && typeof values === "object" ? values : {}).filter(
      ([k, v]) => typeof k === "string" && typeof v === "string" && v,
    ),
  );

/** The page's first state, from a row (or a group's rows) and its filters. */
export function startBrowse(rows, filters = {}) {
  const catalogs = (Array.isArray(rows) ? rows : [])
    .filter((r) => r && typeof r.key === "string" && r.key)
    .map((r) => {
      const metas = unique(Array.isArray(r.metas) ? r.metas : []);
      return {
        key: r.key,
        name: r.name || "",
        provider: r.provider || "",
        type: r.type || "",
        feed: !!r.feed,
        metas,
        // What the provider has sent so far: its next page starts here.
        skip: Number.isInteger(r.skip) && r.skip >= 0 ? r.skip : metas.length,
        page: Number.isInteger(r.page) && r.page > 0 ? r.page : 1,
        hasMore: !!r.hasMore,
        loading: false,
        error: "",
        filters: cleanFilters(filters?.[r.key]),
        generation: 0,
      };
    });
  return { catalogs, order: interleave(catalogs.map((c) => c.metas)) };
}

const replace = (state, key, change) => {
  const index = state.catalogs.findIndex((c) => c.key === key);
  if (index < 0) return null;
  const catalogs = [...state.catalogs];
  catalogs[index] = change(catalogs[index]);
  return { ...state, catalogs };
};

/** The titles a tab shows: "all" in arrival order, or one catalog's. */
export function browseItems(state, pick = "all") {
  if (pick === "all") return state.order;
  return state.catalogs.find((c) => c.key === pick)?.metas || [];
}

/**
 * The catalogs the next load asks: every catalog of "All" that has more (at
 * most BROWSE_PARALLEL), or the chosen one. A catalog already being asked is
 * left alone, and a failed one waits for the viewer's retry.
 */
export function browseLoads(state, pick = "all", { retry = false } = {}) {
  return state.catalogs
    .filter((c) => pick === "all" || c.key === pick)
    .filter((c) => c.hasMore && !c.loading && (retry || !c.error))
    .slice(0, BROWSE_PARALLEL)
    .map((c) => c.key);
}

/** What `catalog` is asked for a catalog's next page. */
export function browseRequest(catalog, { search = "" } = {}) {
  return {
    catalogKey: catalog.key,
    type: catalog.type,
    search,
    filters: { ...catalog.filters },
    skip: catalog.skip,
    // Riwaq's TMDB rows page by number; addon catalogs by skip.
    page: catalog.page + 1,
    // A retry skips the failure the client remembers for this address.
    retryFailed: !!catalog.error,
  };
}

/** Marks catalogs as being asked. */
export function loadingBrowse(state, keys) {
  const asked = new Set(keys);
  return {
    ...state,
    catalogs: state.catalogs.map((c) =>
      asked.has(c.key) ? { ...c, loading: true } : c,
    ),
  };
}

/**
 * A catalog's next page arrived (`next` is its row, or null when it sent
 * nothing). A reply for an older filter (generation) changes nothing.
 */
export function mergeBrowse(state, key, next, generation) {
  const catalog = state.catalogs.find((c) => c.key === key);
  if (!catalog) return state;
  if (generation !== undefined && generation !== catalog.generation)
    return state;
  const got = Array.isArray(next?.metas) ? next.metas : [];
  const restarted = catalog.page === 0;
  const updated = replace(state, key, (c) => ({
    ...c,
    metas: unique([...c.metas, ...got]),
    skip: c.skip + got.length,
    page: c.page + 1,
    // An empty page ends the catalog, whatever it claimed.
    hasMore: !!next?.hasMore && got.length > 0,
    loading: false,
    error: "",
  }));
  // A catalog restarted by a new filter reorders "All" once, on request.
  const order = restarted
    ? interleave(updated.catalogs.map((c) => c.metas))
    : unique([...state.order, ...got]);
  return { ...updated, order };
}

/** A catalog's page failed; its titles stay. */
export function failBrowse(state, key, message) {
  return (
    replace(state, key, (c) => ({
      ...c,
      loading: false,
      error: String(message || "تعذّر تحميل الكتالوج، حاول مجددًا."),
    })) || state
  );
}

/** New filter values for one catalog: it starts again from its first page. */
export function refilterBrowse(state, key, values) {
  const updated = replace(state, key, (c) => ({
    ...c,
    filters: cleanFilters(values),
    metas: [],
    skip: 0,
    page: 0,
    hasMore: true,
    loading: false,
    error: "",
    generation: c.generation + 1,
  }));
  if (!updated) return state;
  return {
    ...updated,
    order: interleave(updated.catalogs.map((c) => c.metas)),
  };
}

/** What has been loaded so far, for the page's coverage line. */
export function browseCoverage(state) {
  return {
    titles: state.order.length,
    catalogs: state.catalogs.length,
    done: state.catalogs
      .filter((c) => !c.hasMore && !c.error)
      .map((c) => c.key),
    failed: state.catalogs.filter((c) => c.error).map((c) => c.key),
    more: state.catalogs.some((c) => c.hasMore),
  };
}
