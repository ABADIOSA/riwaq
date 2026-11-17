import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  ClipboardPaste,
  Copy,
  Download,
  FolderPlus,
  Folders,
  HardDrive,
  LayoutGrid,
  Link2,
  Maximize2,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Rows3,
  Trash2,
  X,
} from "lucide-react";
import { call } from "../lib/api.js";
import { typeName } from "../lib/helpers.js";
import {
  Busy,
  Empty,
  Modal,
  Poster,
  Rail,
  RowHeading,
  ScrollRow,
  useScrollRow,
} from "./UI.jsx";
import {
  IMPORT_MODES,
  LIMITS,
  LOCAL_ART,
  artUrl,
  SHAPES,
  TMDB_PRESETS,
  fromNuvio,
  parseTmdbSource,
  parseTraktSource,
  titlePlaces,
} from "../../core/collections.mjs";
import { presetCards } from "../../core/collection-presets.mjs";
import {
  CollectionArt,
  FolderTile,
  useActive,
  useArt,
  useReducedMotion,
} from "./CollectionArt.jsx";
import { sourceLabel } from "../../core/collection-sources.mjs";
import { arabicCount } from "../../core/arabic.mjs";
import { watchedTitles, withoutWatched } from "../../core/library.mjs";

export const FOLDERS = {
  zero: "لا مجلدات",
  one: "مجلد واحد",
  two: "مجلدان",
  few: "{n} مجلدات",
  many: "{n} مجلداً",
  other: "{n} مجلد",
};
export const TITLES = {
  zero: "لا عناوين",
  one: "عنوان واحد",
  two: "عنوانان",
  few: "{n} عناوين",
  many: "{n} عنواناً",
  other: "{n} عنوان",
};
const forms = (one, two, few, many, other = many) => ({
  zero: `لا ${few}`,
  one: `${one} واحد`,
  two,
  few: `{n} ${few}`,
  many: `{n} ${many}`,
  other: `{n} ${other}`,
});
const COLLECTIONS = {
  zero: "لا مجموعات",
  one: "مجموعة واحدة",
  two: "مجموعتان",
  few: "{n} مجموعات",
  many: "{n} مجموعة",
  other: "{n} مجموعة",
};
const ADDONS = forms("إضافة", "إضافتان", "إضافات", "إضافة");
const PINNED = {
  zero: "لا شيء على الرئيسية",
  one: "واحدة على الرئيسية",
  two: "اثنتان على الرئيسية",
  few: "{n} على الرئيسية",
  many: "{n} على الرئيسية",
  other: "{n} على الرئيسية",
};
ADDONS.one = "إضافة واحدة";
const REPOS = forms("مستودع", "مستودعان", "مستودعات", "مستودعاً", "مستودع");
const TOOLS = forms("أداة", "أداتان", "أدوات", "أداة");
TOOLS.one = "أداة واحدة";
export const SOURCES = forms("مصدر", "مصدران", "مصادر", "مصدراً", "مصدر");
export const n = (count, f) => arabicCount(Number(count) || 0, f);
const TMDB_KIND_LABELS = {
  list: "قائمة",
  collection: "سلسلة أفلام",
  company: "استوديو",
  network: "شبكة",
  discover: "اكتشف",
  person: "ممثل",
  director: "مخرج",
};
/** Why a source shows nothing, in words the viewer can act on. */
export function noteText(row) {
  switch (row.note) {
    case "missing":
      return `إضافة «${row.provider}» غير مثبتة أو معطّلة في رِواق. ثبّتها، أو انقل إضافاتك من نوفيو.`;
    case "input":
      return "هذا الكتالوج يحتاج بحثاً أو تصنيفاً لا يحدده المجلد.";
    case "failed":
      return "لم يستجب المصدر الآن.";
    case "empty":
      return "المصدر لم يرجع أي عنوان.";
    case "unmatched":
      return "وجد TMDB عناوين ليس لها معرّف IMDb تفتحه إضافاتك. إضافة تفتح معرّفات TMDB (مثل TMDB Addon أو AIOMetadata) تُظهرها.";
    case "needs-tmdb":
      return "يحتاج مفتاح TMDB.";
    case "needs-trakt":
      return "يحتاج Client ID لـ Trakt.";
    case "unsupported":
      return `مصدر من نوع «${row.provider}» في نوفيو لا يقرؤه رِواق بعد.`;
    default:
      return "لا عناوين الآن.";
  }
}
const SHAPE_LABELS = { poster: "ملصق", landscape: "عريض", square: "مربّع" };
const TEMPLATES = [
  { emoji: "🍿", title: "سهرة الويكند", folders: ["أفلام", "مسلسلات"] },
  { emoji: "🦸", title: "عالم الأبطال", folders: ["الأفلام", "المسلسلات"] },
  { emoji: "🎌", title: "أنمي", folders: ["مستمر", "مكتمل"] },
];
const titleCount = (c) =>
  c.folders.reduce((n, f) => n + (f.titles?.length || 0), 0);

/** A folder or collection face: its cover, or its emoji on the accent. */
export function Face({ item, className = "" }) {
  const [broken, setBroken] = useState(false);
  const cover = useArt(item.cover || item.backdrop || "");
  return (
    <span className={`collection-face ${className}`}>
      {cover && !broken ? (
        <img
          src={cover}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
        />
      ) : (
        <b>{item.emoji || <Folders size={26} />}</b>
      )}
    </span>
  );
}

/** Pinned collections on the home page, one row of folder tiles each. */
export function PinnedCollections({ state, onOpen }) {
  const reduced = useReducedMotion(state.settings?.reduceMotion);
  const pinned = (state.collections || []).filter(
    (c) => c.pinned && c.folders.length,
  );
  if (!pinned.length) return null;
  return pinned.map((c) => (
    <PinnedCollection key={c.id} c={c} onOpen={onOpen} reduced={reduced} />
  ));
}

function PinnedCollection({ c, onOpen, reduced }) {
  const row = useScrollRow();
  return (
    <section className="rail pinned-collection">
      <RowHeading
        row={row}
        tools={
          <button className="text-button" onClick={() => onOpen(c.id)}>
            عرض المجموعة
          </button>
        }
      >
        <h2>
          {c.emoji && <span className="pinned-emoji">{c.emoji}</span>}
          <span dir="auto">{c.title}</span>
        </h2>
        <span>مجموعتك · {arabicCount(c.folders.length, FOLDERS)}</span>
      </RowHeading>
      <ScrollRow className="folder-row" row={row}>
        {c.folders.map((f) => (
          <FolderTile
            key={f.id}
            folder={f}
            reduced={reduced}
            onClick={() => onOpen(c.id, f.id)}
          />
        ))}
      </ScrollRow>
    </section>
  );
}

/** The collections room: every collection, and one open collection. */
export default function CollectionsPage({
  state,
  update,
  act,
  notice,
  onOpen,
  target,
  setTarget,
  onNuvio,
  onSettings,
  onFolderPage,
}) {
  const collections = state.collections || [];
  const open = collections.find((c) => c.id === target?.id);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ emoji: "", title: "" });
  // Before the early return: hooks run in the same order every render.
  const reduced = useReducedMotion(state.settings.reduceMotion);
  if (open)
    return (
      <CollectionView
        key={open.id}
        collection={open}
        initialFolder={target.folderId}
        state={state}
        update={update}
        act={act}
        notice={notice}
        onOpen={onOpen}
        onSettings={onSettings}
        onFolderPage={onFolderPage}
        onBack={() => setTarget(null)}
      />
    );
  const layout = state.settings.collectionsLayout === "row" ? "row" : "grid";
  const cards = collections.map((c, i) => (
    <CollectionCard
      key={c.id}
      c={c}
      first={i === 0}
      last={i === collections.length - 1}
      reduced={reduced}
      onOpen={() => setTarget({ id: c.id })}
      update={update}
    />
  ));
  const create = async (input) => {
    const next = await update("collectionsEdit", {
      action: "create",
      ...input,
    });
    if (next) {
      setCreating(false);
      setDraft({ emoji: "", title: "" });
      setTarget({ id: next.collections.at(-1)?.id });
    }
  };
  return (
    <div className="page-body collections-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">رتّبها على ذوقك</span>
          <h1>المجموعات</h1>
          <p className="muted collections-lead">
            اجمع كتالوجات إضافاتك وعناوينك المفضلة في مجلدات، وثبّت ما تريد على
            الصفحة الرئيسية.
          </p>
        </div>
        <div className="button-row">
          <button className="secondary" onClick={onNuvio}>
            <Link2 size={17} /> الربط مع نوفيو
          </button>
          <button className="primary" onClick={() => setCreating(true)}>
            <Plus size={17} /> مجموعة جديدة
          </button>
        </div>
      </div>
      {creating && (
        <form
          className="collection-create"
          onSubmit={(e) => {
            e.preventDefault();
            create({ ...draft, pinned: true });
          }}
        >
          <input
            className="emoji-input"
            aria-label="رمز تعبيري"
            placeholder="🎬"
            maxLength={8}
            value={draft.emoji}
            onChange={(e) => setDraft({ ...draft, emoji: e.target.value })}
          />
          <input
            autoFocus
            aria-label="اسم المجموعة"
            placeholder="اسم المجموعة"
            maxLength={80}
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
          <button className="primary" disabled={!draft.title.trim()}>
            إنشاء
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => setCreating(false)}
          >
            إلغاء
          </button>
        </form>
      )}
      {collections.length ? (
        <>
          <div className="collections-toolbar">
            <span className="muted">
              {arabicCount(collections.length, COLLECTIONS)} ·{" "}
              {arabicCount(collections.filter((c) => c.pinned).length, PINNED)}
            </span>
            <div
              className="segmented"
              role="radiogroup"
              aria-label="عرض المجموعات"
            >
              {[
                ["grid", LayoutGrid, "شبكة"],
                ["row", Rows3, "صف أفقي"],
              ].map(([id, Icon, label]) => (
                <button
                  key={id}
                  role="radio"
                  aria-checked={layout === id}
                  className={layout === id ? "selected" : ""}
                  title={label}
                  onClick={() => update("settings", { collectionsLayout: id })}
                >
                  <Icon size={16} />
                </button>
              ))}
            </div>
          </div>
          {layout === "row" ? (
            <ScrollRow className="collection-row">{cards}</ScrollRow>
          ) : (
            <div className="collection-grid">{cards}</div>
          )}
          <div className="collection-share">
            <span>شارك ترتيبك مع نوفيو أو احتفظ به:</span>
            <button
              className="secondary small"
              onClick={async () =>
                (await act("collectionsCopyNuvio")) &&
                notice("نُسخت المجموعات بصيغة نوفيو")
              }
            >
              <Copy size={15} /> نسخ بصيغة نوفيو
            </button>
            <button
              className="secondary small"
              onClick={async () =>
                (await act("collectionsSaveNuvio")) &&
                notice("حُفظ ملف المجموعات")
              }
            >
              <Download size={15} /> حفظ ملف
            </button>
          </div>
        </>
      ) : (
        <Empty icon={Folders} title="لا توجد مجموعات بعد">
          <span className="collection-templates">
            ابدأ من قالب، أو أنشئ مجموعتك، أو انقلها من نوفيو:
            {TEMPLATES.map((t) => (
              <button
                key={t.title}
                className="secondary small"
                onClick={() =>
                  create({
                    emoji: t.emoji,
                    title: t.title,
                    pinned: true,
                    folders: t.folders.map((title) => ({ title })),
                  })
                }
              >
                {t.emoji} {t.title}
              </button>
            ))}
          </span>
        </Empty>
      )}
      <PresetGallery
        collections={collections}
        tmdb={(state.providers || []).some(
          (p) => p.id === "tmdb" && p.configured && p.enabled,
        )}
        update={update}
        notice={notice}
        onOpen={(id) => setTarget({ id })}
      />
    </div>
  );
}

/**
 * A collection in the gallery: a wide card with its backdrop (its own
 * cover, else its first folder's), its logo or name over a glass band, and
 * its tools as glass chips. The first folder's moving cover plays only
 * while this card is hovered or focused.
 */
function CollectionCard({ c, first, last, reduced, onOpen, update }) {
  const { active, props } = useActive();
  const lead =
    c.folders.find((f) => f.backdrop || f.cover || f.gif) || c.folders[0];
  const art = c.cover
    ? { cover: c.cover, emoji: c.emoji }
    : {
        cover: lead?.backdrop || lead?.cover,
        gif: lead?.gif,
        gifOn: lead?.gifOn,
        emoji: c.emoji || lead?.emoji,
      };
  const logo = useArt(c.logo || "");
  const [logoBroken, setLogoBroken] = useState(false);
  const move = (direction) =>
    update("collectionsEdit", {
      action: "move",
      collectionId: c.id,
      direction,
    });
  return (
    <div
      className={`collection-card cinematic ${active ? "is-active" : ""}`}
      {...props}
    >
      <button
        type="button"
        className="collection-open"
        aria-label={`${c.title}، ${arabicCount(c.folders.length, FOLDERS)}`}
        onClick={onOpen}
      >
        <CollectionArt
          item={art}
          active={active}
          reduced={reduced}
          wide
          className="collection-backdrop"
        />
        <span className="collection-card-info">
          {logo && !logoBroken ? (
            <img
              className="collection-logo"
              src={logo}
              alt=""
              referrerPolicy="no-referrer"
              onError={() => setLogoBroken(true)}
            />
          ) : (
            <strong dir="auto">
              {c.emoji && <span className="pinned-emoji">{c.emoji}</span>}
              {c.title}
            </strong>
          )}
          <small>
            {arabicCount(c.folders.length, FOLDERS)} ·{" "}
            {arabicCount(titleCount(c), TITLES)}
            {c.pinned ? " · على الرئيسية" : ""}
          </small>
        </span>
      </button>
      <div className="collection-tools">
        <button
          type="button"
          className="lg-chip"
          title={c.pinned ? "إلغاء التثبيت" : "ثبّت على الرئيسية"}
          aria-label={c.pinned ? "إلغاء التثبيت" : "ثبّت على الرئيسية"}
          aria-pressed={c.pinned}
          onClick={() =>
            update("collectionsEdit", {
              action: "update",
              collectionId: c.id,
              pinned: !c.pinned,
            })
          }
        >
          {c.pinned ? <Pin size={15} /> : <PinOff size={15} />}
        </button>
        <button
          type="button"
          className="lg-chip"
          title="قدّمها"
          aria-label="قدّمها"
          disabled={first}
          onClick={() => move("up")}
        >
          <ArrowUp size={15} />
        </button>
        <button
          type="button"
          className="lg-chip"
          title="أخّرها"
          aria-label="أخّرها"
          disabled={last}
          onClick={() => move("down")}
        >
          <ArrowDown size={15} />
        </button>
      </div>
    </div>
  );
}

/**
 * Riwaq's templates (core/collection-presets.mjs): eight collections of
 * TMDB queries, added (or brought up to date) with one press. They read
 * with the viewer's TMDB key; without one the gallery says so first.
 */
function PresetGallery({ collections, tmdb, update, notice, onOpen }) {
  const cards = useMemo(() => presetCards(), []);
  const [busy, setBusy] = useState("");
  const have = new Set(collections.map((c) => c.id));
  const add = async (card) => {
    setBusy(card.id);
    const next = await update("collectionsEdit", {
      action: "preset",
      preset: card.id,
    });
    setBusy("");
    if (!next) return;
    const id = `riwaq-preset-${card.id}`;
    notice(
      have.has(id)
        ? `حُدّثت «${card.title}» من قالبها`
        : `أُضيفت «${card.title}» إلى مجموعاتك`,
    );
    onOpen(id);
  };
  return (
    <section className="preset-gallery" aria-labelledby="preset-gallery-title">
      <div className="section-heading">
        <div>
          <h2 id="preset-gallery-title">قوالب رِواق</h2>
          <span>
            مجموعات جاهزة من استعلامات TMDB تعدّلها كما تشاء: السينما العالمية،
            تلفزيون الواقع، العائلة، الوثائقيات وغيرها.
          </span>
        </div>
      </div>
      {!tmdb && (
        <p className="inline-warning">
          القوالب تقرأ من TMDB بمفتاحك. أضف مفتاح TMDB في «مصادر البيانات»
          لتمتلئ مجلداتها؛ بدونه تبقى المجلدات وتقول ما ينقصها.
        </p>
      )}
      <div className="preset-grid">
        {cards.map((card) => {
          const added = have.has(`riwaq-preset-${card.id}`);
          return (
            <article key={card.id} className="preset-card">
              <span className="preset-emoji" aria-hidden="true">
                {card.emoji}
              </span>
              <b>{card.title}</b>
              <small>
                {arabicCount(card.folders, FOLDERS)} ·{" "}
                {arabicCount(card.sources, SOURCES)}
              </small>
              <button
                type="button"
                className={added ? "secondary small" : "primary small"}
                aria-busy={busy === card.id}
                disabled={!!busy}
                onClick={() => add(card)}
              >
                {added ? "حدّثها" : "أضفها"}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function CollectionView({
  collection,
  initialFolder,
  state,
  update,
  act,
  notice,
  onOpen,
  onSettings,
  onFolderPage,
  onBack,
}) {
  const [folderId, setFolderId] = useState(
    collection.folders.some((f) => f.id === initialFolder)
      ? initialFolder
      : collection.folders[0]?.id || "",
  );
  const [editing, setEditing] = useState(false);
  const [newFolder, setNewFolder] = useState("");
  const reduced = useReducedMotion(state.settings.reduceMotion);
  const heroArt = useArt(collection.cover || "");
  const heroLogo = useArt(collection.logo || "");
  const [logoBroken, setLogoBroken] = useState(false);
  const folder =
    collection.folders.find((f) => f.id === folderId) || collection.folders[0];
  const watched = state.settings.hideWatched
    ? watchedTitles(state.progress)
    : null;
  const edit = (input) =>
    update("collectionsEdit", { collectionId: collection.id, ...input });
  const addFolder = async () => {
    const next = await edit({ action: "folderAdd", title: newFolder });
    if (next) {
      setNewFolder("");
      const updated = next.collections.find((c) => c.id === collection.id);
      setFolderId(updated?.folders.at(-1)?.id || "");
    }
  };
  return (
    <div className="page-body collection-view">
      <div
        className="collection-hero"
        style={heroArt ? { backgroundImage: `url("${heroArt}")` } : undefined}
      >
        <div className="collection-hero-inner">
          <button className="text-button" onClick={onBack}>
            <ArrowRight size={16} /> كل المجموعات
          </button>
          {editing ? (
            <CollectionFields
              collection={collection}
              edit={edit}
              notice={notice}
            />
          ) : heroLogo && !logoBroken ? (
            <h1 className="collection-hero-logo">
              <img
                src={heroLogo}
                alt={collection.title}
                referrerPolicy="no-referrer"
                onError={() => setLogoBroken(true)}
              />
            </h1>
          ) : (
            <h1 dir="auto">
              {collection.emoji && (
                <span className="pinned-emoji">{collection.emoji}</span>
              )}
              {collection.title}
            </h1>
          )}
          <div className="button-row">
            <button
              className={editing ? "primary" : "secondary"}
              onClick={() => setEditing(!editing)}
            >
              {editing ? <Check size={17} /> : <Pencil size={17} />}
              {editing ? "تم" : "تعديل"}
            </button>
            <button
              className="secondary"
              onClick={() =>
                edit({ action: "update", pinned: !collection.pinned })
              }
            >
              {collection.pinned ? <PinOff size={17} /> : <Pin size={17} />}
              {collection.pinned ? "إلغاء التثبيت" : "ثبّت على الرئيسية"}
            </button>
            <div className="segmented" role="group" aria-label="طريقة العرض">
              <button
                className={collection.view === "tabs" ? "selected" : ""}
                title="تبويبات"
                onClick={() => edit({ action: "update", view: "tabs" })}
              >
                <LayoutGrid size={16} />
              </button>
              <button
                className={collection.view === "rows" ? "selected" : ""}
                title="صفوف"
                onClick={() => edit({ action: "update", view: "rows" })}
              >
                <Rows3 size={16} />
              </button>
            </div>
            {editing && (
              <button
                className="secondary danger"
                onClick={async () => {
                  if (!window.confirm(`حذف مجموعة «${collection.title}»؟`))
                    return;
                  if (await edit({ action: "remove" })) onBack();
                }}
              >
                <Trash2 size={17} /> حذف المجموعة
              </button>
            )}
          </div>
        </div>
      </div>
      {collection.view === "tabs" &&
        !editing &&
        collection.folders.length > 0 && (
          // The folders as cards (their covers, moving on hover or focus);
          // choosing one shows it below.
          <ScrollRow
            className="folder-gallery"
            role="tablist"
            aria-label="مجلدات المجموعة"
          >
            {collection.folders.map((f) => (
              <FolderTile
                key={f.id}
                folder={f}
                reduced={reduced}
                role="tab"
                selected={f.id === folder?.id}
                onClick={() => setFolderId(f.id)}
              />
            ))}
          </ScrollRow>
        )}
      {editing && (
        <div className="folder-tabs" role="tablist">
          {collection.folders.map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={f.id === folder?.id}
              className={f.id === folder?.id ? "selected" : ""}
              onClick={() => setFolderId(f.id)}
            >
              {f.emoji && <span>{f.emoji}</span>}
              <span dir="auto">{f.title}</span>
            </button>
          ))}
          <form
            className="folder-new"
            onSubmit={(e) => {
              e.preventDefault();
              if (newFolder.trim()) addFolder();
            }}
          >
            <input
              aria-label="مجلد جديد"
              placeholder="مجلد جديد"
              maxLength={80}
              value={newFolder}
              onChange={(e) => setNewFolder(e.target.value)}
            />
            <button disabled={!newFolder.trim()} title="أضف مجلداً">
              <FolderPlus size={16} />
            </button>
          </form>
        </div>
      )}
      {!collection.folders.length ? (
        <Empty icon={FolderPlus} title="أضف أول مجلد">
          المجلد يجمع كتالوجات من إضافاتك وعناوين تختارها بنفسك.
        </Empty>
      ) : collection.view === "rows" && !editing ? (
        collection.folders.map((f) => (
          <section key={f.id} className="folder-section">
            <h2 dir="auto">
              <button
                className="folder-section-link"
                title="افتح صفحة المجلد"
                onClick={() => onFolderPage?.(collection.id, f.id)}
              >
                {f.emoji} {f.title}
                <Maximize2 size={16} />
              </button>
            </h2>
            <FolderContent
              collection={collection}
              folder={f}
              update={update}
              notice={notice}
              onOpen={onOpen}
              onSettings={onSettings}
              watched={watched}
              compact
            />
          </section>
        ))
      ) : (
        folder && (
          <>
            {!editing && onFolderPage && (
              <button
                className="text-button folder-page-link"
                onClick={() => onFolderPage(collection.id, folder.id)}
              >
                <Maximize2 size={15} /> افتح «{folder.title}» في صفحة مستقلة
              </button>
            )}
            {editing && (
              <FolderEditor
                key={`editor-${folder.id}`}
                collection={collection}
                folder={folder}
                edit={edit}
                notice={notice}
                reduced={reduced}
                onRemoved={() => setFolderId("")}
              />
            )}
            <FolderContent
              key={`content-${folder.id}`}
              collection={collection}
              folder={folder}
              update={update}
              notice={notice}
              onOpen={onOpen}
              onSettings={onSettings}
              watched={watched}
              editing={editing}
            />
          </>
        )
      )}
    </div>
  );
}

/** Text fields commit on blur, so every keystroke does not write the profile. */
function Field({ label, value, onCommit, ...props }) {
  const [text, setText] = useState(value || "");
  useEffect(() => setText(value || ""), [value]);
  return (
    <label className="collection-field">
      <span>{label}</span>
      <input
        {...props}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== (value || "") && onCommit(text)}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
    </label>
  );
}

function CollectionFields({ collection, edit, notice }) {
  return (
    <div className="collection-fields">
      <Field
        label="رمز تعبيري"
        className="emoji-input"
        maxLength={8}
        value={collection.emoji}
        onCommit={(emoji) => edit({ action: "update", emoji })}
      />
      <Field
        label="الاسم"
        maxLength={80}
        value={collection.title}
        onCommit={(title) => title.trim() && edit({ action: "update", title })}
      />
      <ArtField
        label="الخلفية (رابط https أو صورة من جهازك)"
        value={collection.cover}
        notice={notice}
        onCommit={(cover) => edit({ action: "update", cover })}
      />
      <ArtField
        label="شعار المجموعة"
        value={collection.logo}
        notice={notice}
        onCommit={(logo) => edit({ action: "update", logo })}
      />
    </div>
  );
}

/**
 * A picture field: an HTTPS address typed in, or a picture chosen from this
 * computer (the native dialog; Riwaq keeps it and the field shows only that
 * it is local). Empty clears it.
 */
function ArtField({ label, value, onCommit, notice }) {
  const local = typeof value === "string" && LOCAL_ART.test(value);
  const [error, setError] = useState("");
  const pick = async () => {
    try {
      const picked = await call("collectionArtPick");
      if (picked?.ref) onCommit(picked.ref);
    } catch (e) {
      notice?.(e.message);
    }
  };
  return (
    <div className="collection-field art-field">
      <span>{label}</span>
      <div className="art-field-row">
        {local ? (
          <span className="art-local">
            <HardDrive size={14} aria-hidden="true" /> صورة من هذا الجهاز
          </span>
        ) : (
          <ArtInput
            value={value}
            onCommit={onCommit}
            label={label}
            setError={setError}
          />
        )}
        <button
          type="button"
          className="lg-chip"
          title="اختر صورة من جهازك"
          aria-label={`${label}: اختر صورة من جهازك`}
          onClick={pick}
        >
          <HardDrive size={14} />
        </button>
        {value && (
          <button
            type="button"
            className="lg-chip"
            title="أزل الصورة"
            aria-label={`${label}: أزل الصورة`}
            onClick={() => onCommit("")}
          >
            <X size={14} />
          </button>
        )}
      </div>
      {error && (
        <small className="art-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}

/**
 * The address part of an ArtField: commits on blur or Enter. An address
 * Riwaq would not keep (not HTTPS, a .gifv or a video) is refused here with
 * a reason, so the picture already set stays.
 */
function ArtInput({ value, onCommit, label, setError }) {
  const [text, setText] = useState(value || "");
  const [invalid, setInvalid] = useState(false);
  useEffect(() => setText(value || ""), [value]);
  const commit = () => {
    const next = text.trim();
    if (next === (value || "")) {
      setInvalid(false);
      return setError("");
    }
    if (next && !artUrl(next)) {
      setInvalid(true);
      setError(
        /\.(gifv|mp4|m4v|webm|mov|mkv|avi)(\?|#|$)/i.test(next)
          ? "هذا مقطع فيديو وليس صورة؛ اختر رابط صورة GIF أو PNG أو JPEG أو WebP."
          : "استخدم رابط صورة يبدأ بـ https وبلا اسم مستخدم أو كلمة مرور.",
      );
      setText(value || "");
      return;
    }
    setInvalid(false);
    setError("");
    onCommit(next);
  };
  return (
    <input
      dir="ltr"
      maxLength={2000}
      aria-label={label}
      aria-invalid={invalid}
      placeholder="https://…"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}

function FolderEditor({
  collection,
  folder,
  edit,
  notice,
  reduced,
  onRemoved,
}) {
  const [catalogs, setCatalogs] = useState(null);
  const [link, setLink] = useState("");
  const [linkMedia, setLinkMedia] = useState("movie");
  // Trakt addresses are tried first: they carry "trakt.tv" and a list number.
  const parsedLink = /trakt\.tv/i.test(link)
    ? parseTraktSource(link) && { trakt: true, source: parseTraktSource(link) }
    : parseTmdbSource(link) && { trakt: false, source: parseTmdbSource(link) };
  const [choice, setChoice] = useState("");
  const [genre, setGenre] = useState("");
  const index = collection.folders.findIndex((f) => f.id === folder.id);
  useEffect(() => {
    call("collectionCatalogs")
      .then(setCatalogs)
      .catch(() => setCatalogs([]));
  }, []);
  const groups = useMemo(() => {
    const map = new Map();
    (catalogs || []).forEach((c, i) => {
      const list = map.get(c.addonName) || [];
      list.push({ ...c, i });
      map.set(c.addonName, list);
    });
    return [...map.entries()];
  }, [catalogs]);
  const picked = catalogs?.[Number(choice)];
  const folderEdit = (input) => edit({ folderId: folder.id, ...input });
  const names = new Map(
    (catalogs || []).map((c) => [`${c.addon}|${c.type}|${c.catalog}`, c]),
  );
  return (
    <div className="folder-editor">
      <div className="collection-fields">
        <Field
          label="رمز المجلد"
          className="emoji-input"
          maxLength={8}
          value={folder.emoji}
          onCommit={(emoji) => folderEdit({ action: "folderUpdate", emoji })}
        />
        <Field
          label="اسم المجلد"
          maxLength={80}
          value={folder.title}
          onCommit={(title) =>
            title.trim() && folderEdit({ action: "folderUpdate", title })
          }
        />
        <label className="collection-field">
          <span>شكل البطاقة</span>
          <select
            value={folder.shape}
            onChange={(e) =>
              folderEdit({ action: "folderUpdate", shape: e.target.value })
            }
          >
            {SHAPES.map((s) => (
              <option key={s} value={s}>
                {SHAPE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <FolderLook
        folder={folder}
        reduced={reduced}
        notice={notice}
        set={(patch) => folderEdit({ action: "folderUpdate", ...patch })}
      />
      <div className="folder-sources">
        <h3>مصادر المجلد</h3>
        {folder.catalogs.length ? (
          <ul>
            {folder.catalogs.map((s, i) => {
              const known = names.get(`${s.addon}|${s.type}|${s.catalog}`);
              return (
                <li key={`${s.addon}|${s.catalog}|${i}`}>
                  <span dir="auto">
                    <b>{known?.name || s.catalog}</b>
                    <small>
                      {known?.addonName || s.addon} · {typeName(s.type)}
                      {s.genre ? ` · ${s.genre}` : ""}
                    </small>
                  </span>
                  <button
                    title="أزل الكتالوج"
                    onClick={() =>
                      folderEdit({ action: "catalogRemove", index: i })
                    }
                  >
                    <X size={15} />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="subtle">
            لا كتالوجات بعد. العناوين التي تضيفها بيدك تظهر أيضاً هنا.
          </p>
        )}
        {(folder.tmdb?.length > 0 || folder.trakt?.length > 0) && (
          <ul>
            {(folder.tmdb || []).map((t, i) => (
              <li key={`t${i}`}>
                <span dir="auto">
                  <b>{sourceLabel(t)}</b>
                  <small>
                    TMDB · {TMDB_KIND_LABELS[t.kind]}
                    {t.id ? ` #${t.id}` : ""} ·{" "}
                    {t.media === "tv" ? "مسلسلات" : "أفلام"}
                  </small>
                </span>
                <button
                  title="أزل المصدر"
                  onClick={() => folderEdit({ action: "tmdbRemove", index: i })}
                >
                  <X size={15} />
                </button>
              </li>
            ))}
            {(folder.trakt || []).map((t, i) => (
              <li key={`k${i}`}>
                <span dir="auto">
                  <b>{sourceLabel(t, true)}</b>
                  <small>
                    Trakt #{t.list} · {t.media === "tv" ? "مسلسلات" : "أفلام"}
                  </small>
                </span>
                <button
                  title="أزل القائمة"
                  onClick={() =>
                    folderEdit({ action: "traktRemove", index: i })
                  }
                >
                  <X size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="catalog-picker">
          <select
            aria-label="استوديو أو شبكة من TMDB"
            value=""
            onChange={(e) => {
              const preset = TMDB_PRESETS[Number(e.target.value)];
              if (preset) folderEdit({ action: "tmdbAdd", source: preset });
            }}
          >
            <option value="">أضف استوديو أو شبكة من TMDB…</option>
            {TMDB_PRESETS.map((p, i) => (
              <option key={`${p.kind}${p.id}`} value={i}>
                {p.title} · {p.kind === "network" ? "مسلسلات" : "أفلام"}
              </option>
            ))}
          </select>
          <input
            dir="ltr"
            aria-label="رابط من TMDB أو Trakt"
            placeholder="الصق رابط TMDB أو Trakt"
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
          <select
            aria-label="النوع"
            value={linkMedia}
            onChange={(e) => setLinkMedia(e.target.value)}
          >
            <option value="movie">أفلام</option>
            <option value="tv">مسلسلات</option>
          </select>
          <button
            className="secondary"
            disabled={!parsedLink}
            onClick={async () => {
              const ok = await folderEdit(
                parsedLink.trakt
                  ? {
                      action: "traktAdd",
                      source: { ...parsedLink.source, media: linkMedia },
                    }
                  : {
                      action: "tmdbAdd",
                      source: {
                        ...parsedLink.source,
                        media:
                          parsedLink.source.kind === "network" ||
                          parsedLink.source.kind === "collection"
                            ? parsedLink.source.media
                            : linkMedia,
                      },
                    },
              );
              if (ok) setLink("");
            }}
          >
            <Plus size={16} /> أضف الرابط
          </button>
        </div>
        {catalogs === null ? (
          <Busy text="نجهز كتالوجات إضافاتك…" />
        ) : (
          <div className="catalog-picker">
            <select
              aria-label="اختر كتالوجاً"
              value={choice}
              onChange={(e) => {
                setChoice(e.target.value);
                setGenre("");
              }}
            >
              <option value="">اختر كتالوجاً من إضافاتك…</option>
              {groups.map(([name, list]) => (
                <optgroup key={name} label={name}>
                  {list.map((c) => (
                    <option key={c.i} value={c.i}>
                      {c.name} · {typeName(c.type)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {picked?.genres?.length > 0 && (
              <select
                aria-label="التصنيف"
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
              >
                {!picked.genreRequired && (
                  <option value="">كل التصنيفات</option>
                )}
                {picked.genres.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            )}
            <button
              className="secondary"
              disabled={!picked || (picked.genreRequired && !genre)}
              onClick={async () => {
                const ok = await folderEdit({
                  action: "catalogAdd",
                  catalog: {
                    addon: picked.addon,
                    type: picked.type,
                    catalog: picked.catalog,
                    genre,
                  },
                });
                if (ok) setChoice("");
              }}
            >
              <Plus size={16} /> أضف
            </button>
          </div>
        )}
      </div>
      <div className="button-row folder-editor-actions">
        <button
          className="secondary small"
          disabled={index <= 0}
          onClick={() => folderEdit({ action: "folderMove", direction: "up" })}
        >
          <ArrowUp size={15} /> قدّم المجلد
        </button>
        <button
          className="secondary small"
          disabled={index >= collection.folders.length - 1}
          onClick={() =>
            folderEdit({ action: "folderMove", direction: "down" })
          }
        >
          <ArrowDown size={15} /> أخّر المجلد
        </button>
        <button
          className="secondary small danger"
          onClick={async () => {
            if (!window.confirm(`حذف مجلد «${folder.title}»؟`)) return;
            if (await folderEdit({ action: "folderRemove" })) onRemoved();
          }}
        >
          <Trash2 size={15} /> حذف المجلد
        </button>
      </div>
    </div>
  );
}

/** Hand-picked titles in the viewer's order, then each catalog's row. */
/**
 * How a folder's card looks (Nuvio's folder fields): the still cover, the
 * moving cover and whether it may play, the backdrop, the title logo, the
 * glow and hiding the name, with the card drawn still and as it looks
 * under the pointer, so a change shows before it is used.
 */
function FolderLook({ folder, reduced, notice, set }) {
  const toggle = (key, on, title, text) => (
    <label className="look-toggle">
      <input
        type="checkbox"
        checked={!!on}
        onChange={(e) => set({ [key]: e.target.checked })}
      />
      <span>
        <b>{title}</b>
        <small>{text}</small>
      </span>
    </label>
  );
  return (
    <section className="folder-look lg-panel" aria-label="مظهر بطاقة المجلد">
      <div className="folder-look-fields">
        <ArtField
          label="الغلاف الثابت"
          value={folder.cover}
          notice={notice}
          onCommit={(cover) => set({ cover })}
        />
        <ArtField
          label="الغلاف المتحرك (GIF)"
          value={folder.gif}
          notice={notice}
          onCommit={(gif) => set({ gif })}
        />
        <ArtField
          label="الخلفية الكبيرة"
          value={folder.backdrop}
          notice={notice}
          onCommit={(backdrop) => set({ backdrop })}
        />
        <ArtField
          label="شعار العنوان"
          value={folder.logo}
          notice={notice}
          onCommit={(logo) => set({ logo })}
        />
        {folder.gif &&
          toggle(
            "gifOn",
            folder.gifOn !== false,
            "شغّل الغلاف المتحرك",
            "يتحرك عند مرور المؤشر أو التركيز بلوحة المفاتيح فقط، ولا يتحرك مع «تقليل الحركة».",
          )}
        {toggle(
          "glow",
          folder.glow,
          "توهّج عند التركيز",
          "هالة بلون السمة حول البطاقة المختارة.",
        )}
        {toggle(
          "hideTitle",
          folder.hideTitle,
          "أخفِ الاسم",
          "حين يقول الغلاف أو الشعار الاسم. يبقى الاسم لقارئ الشاشة.",
        )}
        <p className="subtle">
          ملف ‎.gifv أو مقطع فيديو لا يُقبل غلافاً متحركاً: يجب أن يكون صورة
          GIF. الصور من جهازك تبقى عليه، ولا تنتقل في النسخ الاحتياطي ولا الحساب
          ولا ملف نوفيو.
        </p>
      </div>
      <div className="folder-look-preview" aria-label="معاينة">
        <figure>
          <FolderTile folder={folder} reduced={reduced} forceActive={false} />
          <figcaption>ثابت</figcaption>
        </figure>
        <figure>
          <FolderTile folder={folder} reduced={reduced} forceActive />
          <figcaption>
            {reduced ? "عند التمرير (الحركة مقللة)" : "عند التمرير"}
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

function FolderContent({
  collection,
  folder,
  update,
  notice,
  onOpen,
  onSettings,
  editing = false,
  compact = false,
  watched = null,
}) {
  const [data, setData] = useState(null);
  const [reload, setReload] = useState(0);
  const tmdb = folder.tmdb || [];
  const trakt = folder.trakt || [];
  const signature = JSON.stringify([
    folder.catalogs,
    tmdb,
    trakt,
    folder.unsupported || [],
  ]);
  useEffect(() => {
    if (
      !folder.catalogs.length &&
      !tmdb.length &&
      !trakt.length &&
      !folder.unsupported?.length
    ) {
      setData({ rows: [], missing: [], failures: [] });
      return;
    }
    let live = true;
    setData(null);
    call("collectionFolder", {
      collectionId: collection.id,
      folderId: folder.id,
    })
      .then((r) => live && setData(r))
      .catch(
        (e) =>
          live &&
          setData({ rows: [], missing: [], failures: [], error: e.message }),
      );
    return () => {
      live = false;
    };
  }, [folder.id, signature, reload]);
  const titleEdit = (action, meta, extra = {}) =>
    update("collectionsEdit", {
      action,
      collectionId: collection.id,
      folderId: folder.id,
      id: meta.id,
      type: meta.type,
      ...extra,
    });
  const titles = folder.titles || [];
  return (
    <div className={`folder-content ${compact ? "compact" : ""}`}>
      {titles.length > 0 &&
        (compact ? (
          <Rail title="اختياراتك" metas={titles} onOpen={onOpen} />
        ) : (
          <section className="folder-picks">
            <div className="section-heading">
              <h2>اختياراتك</h2>
              <span>{arabicCount(titles.length, TITLES)} بترتيبك</span>
            </div>
            <div className="poster-grid">
              {titles.map((meta, i) => (
                <div key={`${meta.type}:${meta.id}`} className="pick">
                  <span className="collection-index">{i + 1}</span>
                  <Poster meta={meta} onOpen={onOpen} />
                  {editing && (
                    <div className="pick-tools">
                      <button
                        title="قدّمه"
                        disabled={i === 0}
                        onClick={() =>
                          titleEdit("titleMove", meta, { direction: "up" })
                        }
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        title="أخّره"
                        disabled={i === titles.length - 1}
                        onClick={() =>
                          titleEdit("titleMove", meta, { direction: "down" })
                        }
                      >
                        <ArrowDown size={14} />
                      </button>
                      <button
                        title="أزله من المجلد"
                        onClick={async () =>
                          (await titleEdit("titleRemove", meta)) &&
                          notice("أُزيل من المجلد")
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      {data === null ? (
        <Busy text="نحمّل كتالوجات المجلد…" />
      ) : (
        <>
          {data.rows
            .map((row) =>
              watched?.size
                ? { ...row, metas: withoutWatched(row.metas, watched) }
                : row,
            )
            .filter((row) => row.metas.length)
            .map((row) => (
              <Rail
                key={row.index}
                title={row.name}
                subtitle={`${typeName(row.type)} · ${row.provider}${
                  row.hidden
                    ? ` · ${n(row.hidden, TITLES)} بلا معرّف يفتحه رِواق`
                    : ""
                }`}
                metas={row.metas}
                onOpen={onOpen}
              />
            ))}
          {data.rows.some((row) => !row.metas.length) && (
            <ul className="source-notes">
              {data.rows
                .filter((row) => !row.metas.length)
                .map((row) => (
                  <li key={row.index} className={`note-${row.note}`}>
                    <b dir="auto">{row.name || row.provider}</b>
                    <span>{noteText(row)}</span>
                  </li>
                ))}
              {data.rows.some((row) => row.note === "failed") && (
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
          {data.needs?.includes("tmdb") && (
            <div className="folder-needs">
              <p>
                في هذا المجلد {n(tmdb.length, SOURCES)} من TMDB، وتحتاج مفتاح
                TMDB مجانياً لتظهر. أضفه من الإعدادات، أو انقله من نوفيو مع
                مجموعاتك.
              </p>
              <button
                className="primary small"
                onClick={() => onSettings?.("data")}
              >
                أضف مفتاح TMDB
              </button>
            </div>
          )}
          {data.needs?.includes("trakt") && (
            <div className="folder-needs">
              <p>
                في هذا المجلد {n(trakt.length, SOURCES)} من قوائم Trakt العامة،
                وتحتاج Client ID من تطبيقك في Trakt لتظهر. لا يلزم تسجيل الدخول.
              </p>
              <button
                className="primary small"
                onClick={() => onSettings?.("connections")}
              >
                أضف Client ID لـ Trakt
              </button>
            </div>
          )}
          {!titles.length && !data.rows.length && !data.error && (
            <Empty icon={Folders} title="المجلد فارغ">
              {folder.id.startsWith("nuvio-") &&
              !folder.catalogs.length &&
              !tmdb.length &&
              !trakt.length
                ? "هذا المجلد وصل من نوفيو بدون مصادر يقرؤها رِواق. افتح «الربط مع نوفيو»، واقرأ بياناته، ثم اضغط «نسخ تقرير التشخيص» وأرسله للمطوّر."
                : editing
                  ? "اختر كتالوجاً من الأعلى، أو افتح أي عمل واضغط «أضف لمجموعة»."
                  : "اضغط «تعديل» لتضيف كتالوجات، أو افتح أي عمل واضغط «أضف لمجموعة»."}
            </Empty>
          )}
          {data.error && <p className="inline-warning">{data.error}</p>}
        </>
      )}
    </div>
  );
}

/** "Add to collection" from a title's page: every folder, ticked where it is. */
export function AddToCollection({ meta, state, update, onClose }) {
  const collections = state.collections || [];
  const places = titlePlaces(collections, meta);
  const [title, setTitle] = useState("");
  const media = {
    id: meta.id,
    type: meta.type,
    name: meta.name,
    poster: meta.poster,
    releaseInfo: meta.releaseInfo,
  };
  const toggle = (c, f) =>
    update("collectionsEdit", {
      action: places.includes(`${c.id}/${f.id}`) ? "titleRemove" : "titleAdd",
      collectionId: c.id,
      folderId: f.id,
      meta: media,
      id: meta.id,
      type: meta.type,
    });
  return (
    <Modal onClose={onClose} className="add-collection-modal">
      <span className="eyebrow">المجموعات</span>
      <h1 dir="auto">أضف «{meta.name}»</h1>
      {collections.some((c) => c.folders.length) ? (
        <div className="add-collection-list">
          {collections
            .filter((c) => c.folders.length)
            .map((c) => (
              <fieldset key={c.id}>
                <legend dir="auto">
                  {c.emoji} {c.title}
                </legend>
                {c.folders.map((f) => {
                  const inside = places.includes(`${c.id}/${f.id}`);
                  return (
                    <button
                      key={f.id}
                      className={`add-folder ${inside ? "inside" : ""}`}
                      aria-pressed={inside}
                      onClick={() => toggle(c, f)}
                    >
                      <span className="add-check">
                        {inside ? <Check size={15} /> : <Plus size={15} />}
                      </span>
                      <span dir="auto">
                        {f.emoji} {f.title}
                      </span>
                      <small>{arabicCount(f.titles.length, TITLES)}</small>
                    </button>
                  );
                })}
              </fieldset>
            ))}
        </div>
      ) : (
        <p className="muted">
          لا توجد مجلدات بعد. أنشئ مجموعة وسنضع العمل فيها.
        </p>
      )}
      <form
        className="collection-create"
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await update("collectionsEdit", {
            action: "create",
            title,
            pinned: true,
            folders: [{ title: "مختارات", titles: [media] }],
          });
          if (ok) setTitle("");
        }}
      >
        <input
          aria-label="مجموعة جديدة"
          placeholder="أو أنشئ مجموعة جديدة…"
          maxLength={80}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button className="primary" disabled={!title.trim()}>
          <Plus size={16} /> إنشاء وإضافة
        </button>
      </form>
    </Modal>
  );
}

const PARTS = [
  [
    "collections",
    "المجموعات",
    (p) => `${n(p.collections, COLLECTIONS)} · ${n(p.folders, FOLDERS)}`,
  ],
  ["addons", "الإضافات", (p) => n(p.addons, ADDONS)],
  ["library", "المكتبة", (p) => n(p.library, TITLES)],
  [
    "plugins",
    "مستودعات الأدوات البرمجية (Plugins)",
    (p) => `${n(p.plugins, REPOS)} · ${n(p.scrapers, TOOLS)}`,
  ],
  [
    "tmdbKey",
    "مفتاح TMDB من نوفيو",
    (p) =>
      p.tmdbSources
        ? `تحتاجه ${n(p.tmdbSources, SOURCES)} من TMDB في مجموعاتك · يُحفظ مشفّراً`
        : "يُحفظ مشفّراً على جهازك",
  ],
];

/**
 * Linking with Nuvio: read Nuvio Desktop's data on this PC or its backup,
 * pick a profile and what to bring, or paste collections from any Nuvio app.
 */
export function NuvioLink({ act, setState, notice, onClose }) {
  const [step, setStep] = useState("start");
  const [scan, setScan] = useState(null);
  const [profile, setProfile] = useState(0);
  const [parts, setParts] = useState({
    collections: true,
    addons: true,
    library: true,
    plugins: true,
    tmdbKey: true,
  });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const read = async (method) => {
    setBusy(true);
    const r = await act(method);
    setBusy(false);
    if (!r) return;
    setScan(r);
    setProfile(r.profiles[0]?.index || 0);
    setStep("preview");
  };
  const chosen = scan?.profiles.find((p) => p.index === profile);
  const run = async () => {
    setBusy(true);
    const r = await act("nuvioImport", { token: scan.token, profile, parts });
    setBusy(false);
    if (!r) return;
    setState(r.state);
    setResult(r.result);
    setStep("done");
  };
  // The pasted file is read here first (the same reading main does), so
  // the viewer sees what is in it and chooses before anything is saved.
  const [peek, setPeek] = useState(null);
  const [only, setOnly] = useState([]);
  const [mode, setMode] = useState("merge");
  const preview = () => {
    try {
      const read = fromNuvio(text);
      setPeek({ ...read, error: "" });
      setOnly(read.collections.map((c) => c.id));
    } catch (e) {
      setPeek({ error: e.message });
    }
  };
  const paste = async () => {
    setBusy(true);
    const r = await act("importNuvioCollections", { text, mode, only });
    setBusy(false);
    if (!r) return;
    setState(r.state);
    setResult(r.result);
    setStep("done");
  };
  return (
    <Modal onClose={onClose} className="nuvio-modal">
      <span className="eyebrow">الربط مع نوفيو</span>
      <h1>انقل نوفيو إلى رِواق</h1>
      {step === "start" && (
        <>
          <p className="muted">
            رِواق يقرأ بيانات نوفيو المحفوظة على جهازك، وهي نفس ما يزامنه حسابك
            في نوفيو، بدون كلمة مرور وبدون خوادم.
          </p>
          <div className="nuvio-options">
            <button disabled={busy} onClick={() => read("nuvioScan")}>
              <Link2 size={22} />
              <b>ابحث عن نوفيو على هذا الجهاز</b>
              <small>Nuvio Desktop أو Nuvio HTPC على ويندوز</small>
            </button>
            <button disabled={busy} onClick={() => read("nuvioPickBackup")}>
              <Download size={22} />
              <b>ملف نسخة إعدادات نوفيو</b>
              <small>ملف ‎.zip من «النسخ الاحتياطي» في نوفيو</small>
            </button>
            <button disabled={busy} onClick={() => setStep("paste")}>
              <ClipboardPaste size={22} />
              <b>الصق المجموعات من أي تطبيق نوفيو</b>
              <small>من «تصدير المجموعات» في الجوال أو التلفاز</small>
            </button>
          </div>
          {busy && <Busy text="نقرأ بيانات نوفيو…" />}
        </>
      )}
      {step === "paste" && (
        <>
          <textarea
            className="nuvio-paste"
            dir="ltr"
            rows={8}
            placeholder='[{"id": "...", "title": "...", "folders": [...]}]'
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setPeek(null);
            }}
          />
          {peek?.error && <p className="inline-warning">{peek.error}</p>}
          {peek && !peek.error && (
            <NuvioPreview
              peek={peek}
              only={only}
              setOnly={setOnly}
              mode={mode}
              setMode={setMode}
            />
          )}
          <div className="button-row">
            {peek && !peek.error ? (
              <button
                className="primary"
                disabled={!only.length || busy}
                aria-busy={busy}
                onClick={paste}
              >
                {mode === "replace"
                  ? "استبدل مجموعاتي بها"
                  : mode === "add"
                    ? "أضفها نسخاً جديدة"
                    : "استورد ودمج"}
              </button>
            ) : (
              <button
                className="primary"
                disabled={!text.trim() || busy}
                onClick={preview}
              >
                اعرض ما في الملف
              </button>
            )}
            <button className="secondary" onClick={() => setStep("start")}>
              رجوع
            </button>
          </div>
        </>
      )}
      {step === "preview" && scan && (
        <>
          <p className="muted">
            وجدنا بيانات <b>{scan.source}</b>. اختر الملف الشخصي وما تريد نقله.
          </p>
          <div className="nuvio-profiles" role="radiogroup">
            {scan.profiles.map((p) => (
              <button
                key={p.index}
                role="radio"
                aria-checked={p.index === profile}
                className={p.index === profile ? "selected" : ""}
                onClick={() => setProfile(p.index)}
              >
                <b dir="auto">{p.name}</b>
                <small>
                  {n(p.collections, COLLECTIONS)} · {n(p.addons, ADDONS)} ·{" "}
                  {n(p.library, TITLES)}
                </small>
              </button>
            ))}
          </div>
          {chosen && (
            <div className="nuvio-parts">
              {PARTS.filter(([key]) => key !== "tmdbKey" || chosen.tmdbKey).map(
                ([key, label, count]) => (
                  <label key={key} className={chosen[key] ? "" : "empty"}>
                    <input
                      type="checkbox"
                      checked={parts[key] && !!chosen[key]}
                      disabled={!chosen[key]}
                      onChange={(e) =>
                        setParts({ ...parts, [key]: e.target.checked })
                      }
                    />
                    <span>
                      <b>{label}</b>
                      <small>{count(chosen)}</small>
                    </span>
                  </label>
                ),
              )}
            </div>
          )}
          {chosen?.folderList?.length > 0 && (
            <details className="nuvio-folders">
              <summary>
                مصادر كل مجلد قبل النقل
                {chosen.folderList.some((f) => !f.sources) &&
                  ` · ${n(
                    chosen.folderList.filter((f) => !f.sources).length,
                    FOLDERS,
                  )} بلا مصادر`}
              </summary>
              <ul>
                {chosen.folderList.map((f, i) => (
                  <li key={i} className={f.sources ? "" : "none"}>
                    <span dir="auto">
                      {f.collection} ← {f.title}
                    </span>
                    <small>
                      {f.sources
                        ? n(f.sources, SOURCES)
                        : "لا مصادر يقرؤها رِواق"}
                      {f.unsupported
                        ? ` · ${n(f.unsupported, SOURCES)} غير مدعوم`
                        : ""}
                    </small>
                  </li>
                ))}
              </ul>
              <button
                className="secondary small"
                onClick={async () =>
                  (await act("nuvioDiagnostics", {
                    token: scan.token,
                    profile,
                  })) &&
                  notice(
                    "نُسخ تقرير التشخيص. الصقه للمطوّر؛ لا يحتوي روابط ولا مفاتيح.",
                  )
                }
              >
                <Copy size={15} /> نسخ تقرير التشخيص
              </button>
            </details>
          )}
          <p className="subtle">
            الإضافات تُثبّت بعد فحص ملفها كما لو أضفتها بيدك. مصادر TMDB تحتاج
            مفتاح TMDB، وقوائم Trakt تحتاج Client ID. الأدوات البرمجية (Plugins)
            شيفرة JavaScript من أطراف أخرى: رِواق ينقل قائمة مستودعاتها ليحفظها
            لك، ولا يشغّل شيفرتها.
          </p>
          <div className="button-row">
            <button
              className="primary"
              disabled={busy || !chosen}
              onClick={run}
            >
              {busy ? "ننقل…" : "انقل إلى رِواق"}
            </button>
            <button className="secondary" onClick={() => setStep("start")}>
              رجوع
            </button>
          </div>
        </>
      )}
      {step === "done" && result && (
        <>
          <ul className="nuvio-result">
            {result.collections !== undefined && (
              <li>
                <Check size={16} /> {n(result.collections, COLLECTIONS)}
                {result.folders !== undefined
                  ? ` · ${n(result.folders, FOLDERS)}`
                  : ""}
              </li>
            )}
            {result.addons !== undefined && (
              <li>
                <Check size={16} /> {n(result.addons, ADDONS)} جديدة
              </li>
            )}
            {result.library !== undefined && (
              <li>
                <Check size={16} /> {n(result.library, TITLES)} في مكتبتك
              </li>
            )}
            {result.tmdbKey === "imported" && (
              <li>
                <Check size={16} /> مفتاح TMDB، فتظهر مصادر TMDB في مجلداتك
              </li>
            )}
            {result.tmdbKey === "kept" && (
              <li>
                <Check size={16} /> أبقينا مفتاح TMDB الموجود في رِواق
              </li>
            )}
            {result.plugins !== undefined && (
              <li>
                <Check size={16} /> {n(result.plugins, REPOS)} للأدوات
              </li>
            )}
          </ul>
          {result.addonFailures?.length > 0 && (
            <p className="inline-warning">
              لم تُثبّت: {result.addonFailures.join("، ")}. قد تحتاج إعداداً في
              موقعها أو أنها متوقفة.
            </p>
          )}
          {(result.added !== undefined || result.updated !== undefined) && (
            <ul className="nuvio-report">
              <li>
                <b>{result.added || 0}</b> جديدة
              </li>
              <li>
                <b>{result.updated || 0}</b> حُدّثت
              </li>
              {result.replaced > 0 && (
                <li>
                  <b>{result.replaced}</b> استُبدلت
                </li>
              )}
              {result.skipped > 0 && (
                <li>
                  {`${result.skipped} لم تتسع (الحد ${LIMITS.collections} مجموعة و${LIMITS.folders} مجلد)`}
                </li>
              )}
            </ul>
          )}
          {result.over &&
            result.over.collections +
              result.over.folders +
              result.over.sources >
              0 && (
              <p className="inline-warning">
                {`تجاوز الملف حدود رِواق: ${result.over.collections} مجموعة و${result.over.folders} مجلداً و${result.over.sources} مصدراً لم تنتقل (الحد ${LIMITS.collections} مجموعة، ${LIMITS.folders} مجلد لكل مجموعة، ${LIMITS.catalogs} مصدراً من كل نوع لكل مجلد).`}
              </p>
            )}
          {result.skippedSources > 0 && (
            <details className="nuvio-unsupported">
              <summary>
                {n(result.skippedSources, SOURCES)} لا يقرؤها رِواق بعد؛ حُفظت
                كما هي وتعود في ملف نوفيو
              </summary>
              <ul>
                {(result.unsupported || []).map((u, i) => (
                  <li key={i} dir="auto">
                    {u.collection} ← {u.folder}: {u.title || u.provider}{" "}
                    <small>({u.provider})</small>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <button
            className="primary"
            onClick={() => {
              notice("اكتمل النقل من نوفيو");
              onClose();
            }}
          >
            تم
          </button>
        </>
      )}
    </Modal>
  );
}

const MODE_TEXT = {
  merge: [
    "دمج",
    "المجموعة الموجودة تتحدّث مجلداً مجلداً ومجلداتك الأخرى تبقى؛ الجديدة تُضاف. الاستيراد مرة ثانية لا يكرر شيئاً.",
  ],
  add: ["إضافة نسخ", "تُضاف نسخة جديدة بجانب مجموعاتك حتى لو كانت موجودة."],
  replace: [
    "استبدال",
    "تحل المجموعات المختارة محل كل مجموعاتك في هذا الملف الشخصي.",
  ],
};

/** What a pasted Nuvio file holds, which of it to bring, and how. */
function NuvioPreview({ peek, only, setOnly, mode, setMode }) {
  const { report } = peek;
  const over =
    report.over.collections + report.over.folders + report.over.sources;
  return (
    <div className="nuvio-preview">
      <p className="muted">
        {`في الملف ${peek.collections.length} مجموعة و${report.folders} مجلداً و${report.sources} مصدراً يقرؤه رِواق.`}
        {report.unsupported.length > 0 &&
          ` ${report.unsupported.length} مصدراً لا يقرؤه بعد سيُحفظ كما هو.`}
      </p>
      {over > 0 && (
        <p className="inline-warning">
          {`لن يتسع كله: ${report.over.collections} مجموعة و${report.over.folders} مجلداً و${report.over.sources} مصدراً فوق حدود رِواق.`}
        </p>
      )}
      <fieldset className="nuvio-pick">
        <legend>المجموعات</legend>
        {peek.collections.map((c) => (
          <label key={c.id}>
            <input
              type="checkbox"
              checked={only.includes(c.id)}
              onChange={(e) =>
                setOnly(
                  e.target.checked
                    ? [...only, c.id]
                    : only.filter((id) => id !== c.id),
                )
              }
            />
            <span dir="auto">
              <b>{c.title}</b>
              <small>{arabicCount(c.folders.length, FOLDERS)}</small>
            </span>
          </label>
        ))}
        {peek.collections.length > 1 && (
          <button
            type="button"
            className="text-button"
            onClick={() =>
              setOnly(
                only.length === peek.collections.length
                  ? []
                  : peek.collections.map((c) => c.id),
              )
            }
          >
            {only.length === peek.collections.length
              ? "ألغِ الكل"
              : "اختر الكل"}
          </button>
        )}
      </fieldset>
      <fieldset className="nuvio-mode">
        <legend>طريقة الاستيراد</legend>
        {IMPORT_MODES.map((id) => (
          <label key={id} className={mode === id ? "selected" : ""}>
            <input
              type="radio"
              name="nuvio-mode"
              checked={mode === id}
              onChange={() => setMode(id)}
            />
            <span>
              <b>{MODE_TEXT[id][0]}</b>
              <small>{MODE_TEXT[id][1]}</small>
            </span>
          </label>
        ))}
      </fieldset>
    </div>
  );
}
