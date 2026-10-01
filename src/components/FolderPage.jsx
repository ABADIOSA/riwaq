import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Folders,
  LayoutGrid,
  Pencil,
  RefreshCw,
  Rows3,
  Search,
  Shuffle,
} from "lucide-react";
import { call } from "../lib/api.js";
import { typeName } from "../lib/helpers.js";
import { Busy, Empty, Poster, Rail, ScrollRow } from "./UI.jsx";
import { Face, FOLDERS, SOURCES, TITLES, n, noteText } from "./Collections.jsx";
import { folderItems, mergePage, randomPick } from "../../core/folder-view.mjs";
import { watchedTitles, withoutWatched } from "../../core/library.mjs";
import { arabicCount } from "../../core/arabic.mjs";

const SORTS = [
  ["source", "ترتيب المصدر"],
  ["newest", "الأحدث"],
  ["rating", "الأعلى تقييماً"],
  ["name", "أبجدياً"],
];
const TYPES = [
  ["all", "الكل"],
  ["movie", "أفلام"],
  ["series", "مسلسلات"],
];

/**
 * A folder on its own page, opened from the home page: its cover as a
 * backdrop, a tab for every source (and one for everything), search, type
 * and order, more titles on demand, and a random pick.
 */
export default function FolderPage({
  state,
  target,
  onTarget,
  onOpen,
  onBack,
  onEdit,
  onSettings,
}) {
  const collection = (state.collections || []).find(
    (c) => c.id === target?.collectionId,
  );
  const folder = collection?.folders.find((f) => f.id === target?.folderId);
  const [data, setData] = useState(null);
  const [reload, setReload] = useState(0);
  const [tab, setTab] = useState("all");
  const [type, setType] = useState("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("source");
  const [layout, setLayout] = useState("grid");
  const [loadingMore, setLoadingMore] = useState("");
  const signature = folder
    ? JSON.stringify([
        folder.catalogs,
        folder.tmdb,
        folder.trakt,
        folder.unsupported || [],
      ])
    : "";
  const top = useRef(null);
  useEffect(() => {
    setTab("all");
    setQuery("");
    // Another folder of the collection starts at its own top.
    top.current?.scrollIntoView?.({ block: "start" });
  }, [folder?.id]);
  useEffect(() => {
    if (!folder) return;
    let live = true;
    setData(null);
    call("collectionFolder", {
      collectionId: collection.id,
      folderId: folder.id,
    })
      .then((r) => live && setData(r))
      .catch((e) => live && setData({ rows: [], needs: [], error: e.message }));
    return () => {
      live = false;
    };
  }, [folder?.id, signature, reload]);

  const titles = folder?.titles || [];
  const rows = data?.rows || [];
  // Finished films leave the folder too when the viewer hides them; the
  // viewer's own picks stay, like the library.
  const watched = state.settings.hideWatched
    ? watchedTitles(state.progress)
    : null;
  const filled = rows
    .map((row) =>
      watched?.size
        ? { ...row, metas: withoutWatched(row.metas, watched) }
        : row,
    )
    .filter((row) => row.metas.length);
  const quiet = rows.filter((row) => !row.metas.length);
  const view = { titles, rows: filled };
  const items = useMemo(
    () => folderItems(view, { tab, type, query, sort }),
    [data, titles, tab, type, query, sort],
  );
  const current = filled.find((row) => row.index === tab);

  if (!folder)
    return (
      <div className="page-body folder-page">
        <Empty
          icon={Folders}
          title="المجلد غير موجود"
          action={
            <button className="primary" onClick={onBack}>
              رجوع
            </button>
          }
        >
          ربما حُذف أو نُقل إلى مجموعة أخرى.
        </Empty>
      </div>
    );

  const loadMore = async (row) => {
    setLoadingMore(row.index);
    try {
      const page = await call("collectionSource", {
        collectionId: collection.id,
        folderId: folder.id,
        index: row.index,
        // Skip counts what the source sent, hidden titles included.
        skip: (rows.find((r) => r.index === row.index) || row).metas.length,
        page: (row.page || 1) + 1,
      });
      setData((d) => ({
        ...d,
        rows: d.rows.map((r) =>
          r.index === row.index ? mergePage(r, page) : r,
        ),
      }));
    } catch {
      setData((d) => ({
        ...d,
        rows: d.rows.map((r) =>
          r.index === row.index ? { ...r, more: false } : r,
        ),
      }));
    } finally {
      setLoadingMore("");
    }
  };
  const surprise = () => {
    const pick = randomPick(items.length ? items : folderItems(view));
    if (pick) onOpen(pick);
  };
  const siblings = collection.folders;
  const loaded = folderItems(view).length;

  return (
    <div className="page-body folder-page" ref={top}>
      <header className={`folder-hero shape-${folder.shape}`}>
        {folder.cover && (
          <div
            className="folder-hero-backdrop"
            style={{ backgroundImage: `url("${folder.cover}")` }}
          />
        )}
        <div className="folder-hero-inner">
          <button className="text-button" onClick={onBack}>
            <ArrowRight size={16} /> رجوع
          </button>
          <div className="folder-hero-body">
            <Face item={folder} className="folder-hero-face" />
            <div className="folder-hero-text">
              <span className="eyebrow" dir="auto">
                {collection.emoji} {collection.title} ·{" "}
                {arabicCount(siblings.length, FOLDERS)}
              </span>
              <h1 dir="auto">
                {folder.emoji && !folder.cover && (
                  <span className="pinned-emoji">{folder.emoji}</span>
                )}
                {folder.title}
              </h1>
              <p className="muted">
                {n(rows.length, SOURCES)}
                {data ? ` · ${n(loaded, TITLES)} حتى الآن` : ""}
                {titles.length
                  ? ` · ${n(titles.length, TITLES)} من اختيارك`
                  : ""}
              </p>
              <div className="button-row">
                <button
                  className="primary"
                  onClick={surprise}
                  disabled={!data || !loaded}
                >
                  <Shuffle size={17} /> اختر لي عشوائياً
                </button>
                <button
                  className="secondary"
                  onClick={() => onEdit(collection.id, folder.id)}
                >
                  <Pencil size={17} /> تعديل المجلد
                </button>
                <button
                  className="secondary"
                  title="حدّث المحتوى"
                  onClick={() => setReload((x) => x + 1)}
                >
                  <RefreshCw size={17} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {siblings.length > 1 && (
        <ScrollRow
          as="nav"
          className="folder-siblings"
          aria-label="مجلدات المجموعة"
        >
          {siblings.map((f) => (
            <button
              key={f.id}
              className={f.id === folder.id ? "selected" : ""}
              aria-current={f.id === folder.id ? "page" : undefined}
              onClick={() =>
                onTarget({ collectionId: collection.id, folderId: f.id })
              }
            >
              {f.emoji && <span>{f.emoji}</span>}
              <span dir="auto">{f.title}</span>
            </button>
          ))}
        </ScrollRow>
      )}

      <div className="folder-toolbar">
        <label className="library-search">
          <Search size={18} />
          <input
            aria-label="ابحث في المجلد"
            placeholder="ابحث في هذا المجلد…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="segmented text" role="group" aria-label="النوع">
          {TYPES.map(([id, label]) => (
            <button
              key={id}
              className={type === id ? "selected" : ""}
              onClick={() => setType(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          aria-label="الترتيب"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          {SORTS.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <div className="segmented" role="group" aria-label="طريقة العرض">
          <button
            className={layout === "grid" ? "selected" : ""}
            title="شبكة"
            onClick={() => setLayout("grid")}
          >
            <LayoutGrid size={16} />
          </button>
          <button
            className={layout === "rows" ? "selected" : ""}
            title="صفوف"
            onClick={() => setLayout("rows")}
          >
            <Rows3 size={16} />
          </button>
        </div>
      </div>

      {layout === "grid" && (filled.length > 1 || titles.length > 0) && (
        <ScrollRow className="folder-source-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === "all"}
            className={tab === "all" ? "selected" : ""}
            onClick={() => setTab("all")}
          >
            الكل
          </button>
          {titles.length > 0 && (
            <button
              role="tab"
              aria-selected={tab === "picks"}
              className={tab === "picks" ? "selected" : ""}
              onClick={() => setTab("picks")}
            >
              اختياراتك <small>{titles.length}</small>
            </button>
          )}
          {filled.map((row) => (
            <button
              key={row.index}
              role="tab"
              aria-selected={tab === row.index}
              className={tab === row.index ? "selected" : ""}
              onClick={() => setTab(row.index)}
            >
              <span dir="auto">{row.name}</span>
              <small>{row.metas.length}</small>
            </button>
          ))}
        </ScrollRow>
      )}

      {data === null ? (
        <Busy text="نحمّل مصادر المجلد…" />
      ) : layout === "grid" ? (
        <>
          {current && (
            <p className="folder-source-line muted">
              {typeName(current.type)} · {current.provider}
            </p>
          )}
          {items.length ? (
            <div className="poster-grid folder-grid">
              {items.map((meta) => (
                <Poster
                  key={`${meta.type}:${meta.id}`}
                  meta={meta}
                  onOpen={onOpen}
                />
              ))}
            </div>
          ) : (
            (filled.length > 0 || titles.length > 0) && (
              <Empty icon={Search} title="لا نتائج">
                غيّر البحث أو النوع لترى عناوين أكثر.
              </Empty>
            )
          )}
          {current?.more && (
            <button
              className="secondary load-more"
              disabled={loadingMore === current.index}
              onClick={() => loadMore(current)}
            >
              {loadingMore === current.index ? "نحمّل…" : "حمّل المزيد"}
            </button>
          )}
          {tab === "all" && filled.some((row) => row.more) && (
            <p className="folder-more-hint muted">
              لقراءة المزيد من مصدر، افتح تبويبه ثم اضغط «حمّل المزيد».
            </p>
          )}
        </>
      ) : (
        <>
          {titles.length > 0 && (
            <Rail
              title="اختياراتك"
              metas={folderItems(view, { tab: "picks", type, query, sort })}
              onOpen={onOpen}
            />
          )}
          {filled.map((row) => {
            const metas = folderItems(view, {
              tab: row.index,
              type,
              query,
              sort,
            });
            return metas.length ? (
              <Rail
                key={row.index}
                title={row.name}
                subtitle={`${typeName(row.type)} · ${row.provider}`}
                metas={metas}
                onOpen={onOpen}
                onMore={() => {
                  setTab(row.index);
                  setLayout("grid");
                }}
              />
            ) : null;
          })}
        </>
      )}

      {data && quiet.length > 0 && (
        <ul className="source-notes">
          {quiet.map((row) => (
            <li key={row.index} className={`note-${row.note}`}>
              <b dir="auto">{row.name || row.provider}</b>
              <span>{noteText(row)}</span>
            </li>
          ))}
          {quiet.some((row) => row.note === "failed") && (
            <li className="source-retry">
              <button
                className="secondary small"
                onClick={() => setReload((x) => x + 1)}
              >
                أعد المحاولة
              </button>
            </li>
          )}
        </ul>
      )}
      {data?.needs?.includes("tmdb") && (
        <div className="folder-needs">
          <p>بعض مصادر هذا المجلد من TMDB وتحتاج مفتاح TMDB مجانياً.</p>
          <button
            className="primary small"
            onClick={() => onSettings?.("data")}
          >
            أضف مفتاح TMDB
          </button>
        </div>
      )}
      {data?.needs?.includes("trakt") && (
        <div className="folder-needs">
          <p>بعض مصادر هذا المجلد قوائم Trakt وتحتاج Client ID.</p>
          <button
            className="primary small"
            onClick={() => onSettings?.("connections")}
          >
            أضف Client ID لـ Trakt
          </button>
        </div>
      )}
      {data && !rows.length && !titles.length && !data.error && (
        <Empty
          icon={Folders}
          title="المجلد فارغ"
          action={
            <button
              className="primary"
              onClick={() => onEdit(collection.id, folder.id)}
            >
              أضف مصادر
            </button>
          }
        >
          أضف كتالوجات أو مصادر TMDB وTrakt، أو افتح أي عمل واضغط «أضف لمجموعة».
        </Empty>
      )}
      {data?.error && <p className="inline-warning">{data.error}</p>}
    </div>
  );
}
