import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { X } from "lucide-react";
import { blendRows } from "../../core/smart-groups.mjs";
import { call } from "../lib/api.js";
import { Poster, ScrollRow } from "./UI.jsx";
import "../catalog-browser.css";

/** Browse real constituent catalogs without changing the page underneath. */
export default function CatalogBrowser({
  selection,
  onClose,
  onOpen,
  suspended = false,
}) {
  const dialog = useRef(null),
    savedScroll = useRef(0),
    generation = useRef(0),
    cursor = useRef(0);
  const [rows, setRows] = useState(() =>
    selection.rows.map((r) => ({ ...r, metas: [...r.metas] })),
  );
  const [pick, setPick] = useState("all"),
    [visible, setVisible] = useState(48);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const pending = useRef(false);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  useLayoutEffect(() => {
    const d = dialog.current;
    if (suspended) {
      savedScroll.current = d.scrollTop;
      d.close();
    } else {
      d.showModal();
      d.scrollTop = savedScroll.current;
    }
  }, [suspended]);
  const chosen = rows.filter((r) => pick === "all" || r.key === pick);
  const metas = useMemo(
    () => blendRows(chosen, Number.MAX_SAFE_INTEGER),
    [rows, pick],
  );
  const load = async () => {
    if (pending.current) return;
    if (visible < metas.length) {
      setVisible((n) => n + 48);
      return;
    }
    const available = chosen.filter((r) => r.hasMore);
    if (!available.length) return;
    const row = available[cursor.current % available.length],
      run = generation.current;
    pending.current = true;
    setLoading(true);
    setError("");
    try {
      const result = await call("catalog", {
        catalogKey: row.key,
        type: row.type,
        search: selection.search,
        filters: selection.filters[row.key] || {},
        skip: row.skip ?? row.metas.length,
        page: (row.page || 1) + 1,
        retryFailed: !!error,
      });
      if (run !== generation.current) return;
      if (result.failures?.length)
        throw Error("تعذّر تحميل الكتالوج، حاول مجددًا.");
      const next = result.rows?.find((r) => r.key === row.key);
      cursor.current++;
      setRows((old) =>
        old.map((r) => {
          if (r.key !== row.key) return r;
          const merged = [
            ...new Map(
              [...r.metas, ...(next?.metas || [])].map((m) => [
                m.type + ":" + m.id,
                m,
              ]),
            ).values(),
          ];
          return {
            ...r,
            metas: merged,
            // Consume the provider page even if every title was already
            // visible. Unique card count is not the provider's page offset.
            skip: (r.skip ?? r.metas.length) + (next?.metas.length || 0),
            page: (r.page || 1) + 1,
            hasMore: !!next?.hasMore,
          };
        }),
      );
    } catch (e) {
      if (run === generation.current) setError(e.message);
    } finally {
      if (run === generation.current) {
        pending.current = false;
        setLoading(false);
      }
    }
  };
  const more = visible < metas.length || chosen.some((r) => r.hasMore);
  return (
    <dialog
      ref={dialog}
      className="modal catalog-browser"
      aria-labelledby="catalog-browser-title"
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-inner">
        <button
          className="icon-button modal-close"
          title="إغلاق"
          aria-label="إغلاق"
          onClick={onClose}
        >
          <X size={20} />
        </button>
        <header className="catalog-browser-heading">
          <span className="eyebrow">عرض الكل</span>
          <h1 id="catalog-browser-title">{selection.name}</h1>
          {rows.length === 1 && <span dir="auto">{rows[0].provider}</span>}
          <p>نتائج محمّلة من كتالوجاتك، وليست حصرًا لكل ما لدى المزوّد.</p>
        </header>
        {rows.length > 1 && (
          <ScrollRow
            className="filter-tabs"
            role="tablist"
            aria-label="كتالوجات العرض"
          >
            <button
              role="tab"
              aria-selected={pick === "all"}
              onClick={() => {
                setPick("all");
                setVisible(48);
                setError("");
              }}
            >
              الكل
            </button>
            {rows.map((r) => (
              <button
                key={r.key}
                role="tab"
                aria-selected={pick === r.key}
                onClick={() => {
                  setPick(r.key);
                  setVisible(48);
                  setError("");
                }}
              >
                <span dir="auto">
                  {r.name} · {r.provider}
                </span>
              </button>
            ))}
          </ScrollRow>
        )}
        <div className="catalog-browser-filters">
          {chosen.map((r) =>
            Object.entries(selection.filters[r.key] || {}).map(
              ([key, value]) => (
                <span key={r.key + key} dir="auto">
                  {key}: {value}
                </span>
              ),
            ),
          )}
        </div>
        <div className="poster-grid" aria-busy={loading}>
          {metas.slice(0, visible).map((m) => (
            <Poster key={m.type + ":" + m.id} meta={m} onOpen={onOpen} />
          ))}
        </div>
        {!metas.length && <p role="status">لا توجد نتائج لهذا الاختيار.</p>}
        {error && <p role="alert">{error}</p>}
        {(more || error) && (
          <button
            className="secondary load-more"
            disabled={loading}
            onClick={load}
          >
            {loading
              ? "جاري التحميل…"
              : error
                ? "إعادة المحاولة"
                : "تحميل المزيد"}
          </button>
        )}
        {chosen.some((r) => !r.hasMore) && (
          <p className="subtle">
            قد لا يوفّر بعض الكتالوجات صفحات إضافية؛ نعرض النتائج المتاحة فقط.
          </p>
        )}
      </div>
    </dialog>
  );
}
