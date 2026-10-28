import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowRight } from "lucide-react";
import {
  browseCoverage,
  browseItems,
  browseLoads,
  browseRequest,
  failBrowse,
  loadingBrowse,
  mergeBrowse,
  refilterBrowse,
  startBrowse,
} from "../../core/browse.mjs";
import { withoutWatched } from "../../core/library.mjs";
import { arabicCount, CATALOGS, WORKS } from "../../core/arabic.mjs";
import { language } from "../../core/i18n.mjs";
import { call } from "../lib/api.js";
import { typeName } from "../lib/helpers.js";
import { Busy, Empty, Poster, ScrollRow } from "./UI.jsx";
import { rowLabel } from "./SmartHome.jsx";

// Cards drawn at first and added per step as the end of the grid nears, so
// a group of many catalogs is not hundreds of cards at once.
const FIRST = 60;
const STEP = 60;
const listOf = (items) =>
  new Intl.ListFormat(language() === "en" ? "en" : "ar", {
    type: "conjunction",
  }).format(items);

/**
 * "See all" as a page of the content area (core/browse.mjs): the real
 * catalogs behind a row or a group, a tab for each, the selected catalog's
 * declared filters, and more titles as the viewer reaches the end. The view
 * it was opened from stays mounted underneath, so Back returns to the same
 * row, and a title opened from here returns to the same place in the grid.
 */
export default function BrowsePage({
  selection,
  onClose,
  onOpen,
  suspended = false,
  watched = null,
}) {
  const page = useRef(null),
    sentinel = useRef(null),
    alive = useRef(true);
  const [state, setState] = useState(() =>
    startBrowse(selection.rows, selection.filters),
  );
  const current = useRef(state);
  current.current = state;
  const [pick, setPick] = useState("all"),
    [visible, setVisible] = useState(FIRST),
    [fields, setFields] = useState({});
  const catalogs = state.catalogs;
  // The catalog the page is about: the only one, or the chosen tab.
  const target = catalogs.length === 1 ? catalogs[0].key : pick;
  const single = catalogs.find((c) => c.key === target) || null;
  useEffect(() => {
    alive.current = true;
    page.current?.focus({ preventScroll: true });
    return () => {
      alive.current = false;
    };
  }, []);
  // Escape goes back to the row, unless Details, a dialog or a menu has it.
  useEffect(() => {
    if (suspended) return;
    const onKey = (e) => {
      if (
        e.key !== "Escape" ||
        e.defaultPrevented ||
        document.querySelector("dialog[open], .gallery-viewer")
      )
        return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [suspended, onClose]);

  const items = browseItems(state, target);
  const shown = useMemo(
    () => (watched?.size ? withoutWatched(items, watched) : items),
    [items, watched],
  );
  const coverage = browseCoverage(state);
  const loading = catalogs.some((c) => c.loading);
  const inView = catalogs.filter((c) => target === "all" || c.key === target);
  const failed = inView.filter((c) => c.error);
  const more =
    visible < shown.length || inView.some((c) => c.hasMore && !c.error);

  // The next cards already loaded, else the next page of every catalog in
  // view. Replies for an older filter or a closed page change nothing.
  const load = async ({ retry = false } = {}) => {
    if (!retry && visible < shown.length) {
      setVisible((n) => n + STEP);
      return;
    }
    const keys = browseLoads(current.current, target, { retry });
    if (!keys.length) return;
    const asked = keys.map((key) =>
      current.current.catalogs.find((c) => c.key === key),
    );
    current.current = loadingBrowse(current.current, keys);
    setState((s) => loadingBrowse(s, keys));
    await Promise.all(
      asked.map(async (catalog) => {
        const generation = catalog.generation;
        try {
          const result = await call(
            "catalog",
            browseRequest(catalog, { search: selection.search }),
          );
          if (!alive.current) return;
          const next = result.rows?.find((r) => r.key === catalog.key) || null;
          if (!next && result.failures?.length)
            throw Error("تعذّر تحميل الكتالوج، حاول مجددًا.");
          setState((s) => mergeBrowse(s, catalog.key, next, generation));
        } catch {
          if (!alive.current) return;
          setState((s) =>
            s.catalogs.find((c) => c.key === catalog.key)?.generation ===
            generation
              ? failBrowse(s, catalog.key, "تعذّر تحميل الكتالوج، حاول مجددًا.")
              : s,
          );
        }
      }),
    );
    if (alive.current) setVisible((n) => n + STEP);
  };
  const loadRef = useRef(load);
  loadRef.current = load;
  // More as the end of the grid comes within reach of the page's scroller.
  // The observer is made again when the grid changes, so a grid that is
  // still short after a page asks for the next one; a failure stops it.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || suspended || loading || failed.length || !more) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadRef.current();
      },
      { root: page.current, rootMargin: "0px 0px 700px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [suspended, loading, failed.length, more, target, shown.length, visible]);

  // The chosen catalog's declared filters (core/client.mjs catalogPlan);
  // Riwaq's own rows and search results have none to change here.
  const filterKey =
    single && !single.feed && !selection.search ? single.key : "";
  useEffect(() => {
    if (!filterKey || fields[filterKey]) return;
    let live = true;
    call("catalogPlan", { catalogKey: filterKey })
      .then((plan) => {
        if (live)
          setFields((f) => ({
            ...f,
            [filterKey]: plan.find((p) => p.key === filterKey)?.filters || [],
          }));
      })
      .catch(() => live && setFields((f) => ({ ...f, [filterKey]: [] })));
    return () => {
      live = false;
    };
  }, [filterKey]);
  // A catalog restarted by a new filter asks its first page.
  useEffect(() => {
    if (single && single.page === 0 && !single.loading && !single.error) load();
  }, [single?.key, single?.generation]);
  const refilter = (name, value) => {
    setVisible(FIRST);
    setState((s) =>
      refilterBrowse(s, single.key, { ...single.filters, [name]: value }),
    );
  };
  const choose = (key) => {
    setPick(key);
    setVisible(FIRST);
    page.current?.scrollTo({ top: 0 });
  };

  const name = catalogs.length === 1 ? rowLabel(catalogs[0]) : selection.name;
  return (
    <section
      ref={page}
      className="browse-page"
      tabIndex={-1}
      aria-labelledby="browse-title"
    >
      <div className="page-body browse-body">
        <button className="back-button browse-back" onClick={onClose}>
          <ArrowRight size={18} /> رجوع
        </button>
        <div className="page-heading browse-heading">
          <div>
            <span className="eyebrow">عرض الكل</span>
            <h1 id="browse-title" dir="auto">
              {name}
            </h1>
            <p dir="auto">
              {catalogs.length === 1
                ? `${typeName(catalogs[0].type)} · ${catalogs[0].provider}`
                : `${arabicCount(catalogs.length, CATALOGS)} من إضافاتك`}
            </p>
          </div>
        </div>
        {catalogs.length > 1 && (
          <ScrollRow
            className="filter-tabs browse-tabs"
            role="tablist"
            aria-label="كتالوجات العرض"
          >
            <button
              role="tab"
              aria-selected={pick === "all"}
              className={pick === "all" ? "selected" : ""}
              onClick={() => choose("all")}
            >
              الكل <small>{coverage.titles}</small>
            </button>
            {catalogs.map((c) => (
              <button
                key={c.key}
                role="tab"
                aria-selected={pick === c.key}
                className={pick === c.key ? "selected" : ""}
                title={`${rowLabel(c)} · ${c.provider}`}
                onClick={() => choose(c.key)}
              >
                <span dir="auto">{`${rowLabel(c)} · ${c.provider}`}</span>
                <small>{c.metas.length}</small>
              </button>
            ))}
          </ScrollRow>
        )}
        {single && fields[single.key]?.length > 0 && (
          <div
            className="filter-tabs catalog-filters browse-filters"
            aria-label="فلاتر الكتالوج"
          >
            {fields[single.key].map((field) => (
              <label key={field.name}>
                {field.name}
                <select
                  aria-label={field.name}
                  value={
                    single.filters[field.name] ||
                    (field.required ? field.options[0] : "")
                  }
                  onChange={(e) => refilter(field.name, e.target.value)}
                >
                  {!field.required && <option value="">الكل</option>}
                  {field.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )}
        <p className="browse-coverage" role="status">
          {`${arabicCount(coverage.titles, WORKS)} من ${arabicCount(coverage.catalogs, CATALOGS)} حتى الآن`}
          {" · "}
          {coverage.more
            ? "نحمّل المزيد كلما اقتربت من النهاية."
            : "عرضنا كل ما أرسلته الكتالوجات."}
        </p>
        {shown.length > 0 ? (
          <div className="poster-grid browse-grid" aria-busy={loading}>
            {shown.slice(0, visible).map((m) => (
              <Poster key={`${m.type}:${m.id}`} meta={m} onOpen={onOpen} />
            ))}
          </div>
        ) : loading ? (
          <Busy text="نحمّل الكتالوجات من إضافاتك…" />
        ) : (
          !failed.length && (
            <Empty title="لا توجد نتائج لهذا الاختيار.">
              جرّب كتالوجاً آخر أو غيّر الفلاتر.
            </Empty>
          )
        )}
        {failed.length > 0 && (
          <div className="inline-warning browse-warning" role="alert">
            <AlertCircle size={16} />
            {`لم يكتمل التحميل من ${listOf(failed.map(rowLabel))}؛ ما وصل باقٍ هنا.`}
            <button disabled={loading} onClick={() => load({ retry: true })}>
              إعادة المحاولة
            </button>
          </div>
        )}
        <div ref={sentinel} className="browse-sentinel" aria-hidden="true" />
        {more && !failed.length && (
          <button
            className="secondary load-more"
            disabled={loading}
            onClick={() => load()}
          >
            {loading ? "جاري التحميل…" : "تحميل المزيد"}
          </button>
        )}
      </div>
    </section>
  );
}
