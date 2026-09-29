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
  LayoutGrid,
  Link2,
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
import { Busy, Empty, Modal, Poster, Rail } from "./UI.jsx";
import {
  SHAPES,
  TMDB_PRESETS,
  parseTmdbSource,
  parseTraktSource,
  titlePlaces,
} from "../../core/collections.mjs";
import { sourceLabel } from "../../core/collection-sources.mjs";
import { arabicCount } from "../../core/arabic.mjs";

const FOLDERS = {
  zero: "لا مجلدات",
  one: "مجلد واحد",
  two: "مجلدان",
  few: "{n} مجلدات",
  many: "{n} مجلداً",
  other: "{n} مجلد",
};
const TITLES = {
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
ADDONS.one = "إضافة واحدة";
const REPOS = forms("مستودع", "مستودعان", "مستودعات", "مستودعاً", "مستودع");
const TOOLS = forms("أداة", "أداتان", "أدوات", "أداة");
TOOLS.one = "أداة واحدة";
const SOURCES = forms("مصدر", "مصدران", "مصادر", "مصدراً", "مصدر");
const n = (count, f) => arabicCount(Number(count) || 0, f);
const TMDB_KIND_LABELS = {
  list: "قائمة",
  collection: "سلسلة أفلام",
  company: "استوديو",
  network: "شبكة",
  discover: "اكتشف",
  person: "ممثل",
  director: "مخرج",
};
const SHAPE_LABELS = { poster: "ملصق", landscape: "عريض", square: "مربّع" };
const TEMPLATES = [
  { emoji: "🍿", title: "سهرة الويكند", folders: ["أفلام", "مسلسلات"] },
  { emoji: "🦸", title: "عالم الأبطال", folders: ["الأفلام", "المسلسلات"] },
  { emoji: "🎌", title: "أنمي", folders: ["مستمر", "مكتمل"] },
];
const titleCount = (c) =>
  c.folders.reduce((n, f) => n + (f.titles?.length || 0), 0);

/** A folder or collection face: its cover, or its emoji on the accent. */
function Face({ item, className = "" }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={`collection-face ${className}`}>
      {item.cover && !broken ? (
        <img
          src={item.cover}
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
  const pinned = (state.collections || []).filter(
    (c) => c.pinned && c.folders.length,
  );
  if (!pinned.length) return null;
  return pinned.map((c) => (
    <section key={c.id} className="rail pinned-collection">
      <div className="section-heading">
        <div>
          <h2>
            {c.emoji && <span className="pinned-emoji">{c.emoji}</span>}
            <span dir="auto">{c.title}</span>
          </h2>
          <span>مجموعتك · {arabicCount(c.folders.length, FOLDERS)}</span>
        </div>
        <button className="text-button" onClick={() => onOpen(c.id)}>
          عرض المجموعة
        </button>
      </div>
      <div className="folder-row">
        {c.folders.map((f) => (
          <button
            key={f.id}
            className={`folder-tile shape-${f.shape}`}
            onClick={() => onOpen(c.id, f.id)}
          >
            <Face item={f} />
            <strong dir="auto">{f.title}</strong>
          </button>
        ))}
      </div>
    </section>
  ));
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
}) {
  const collections = state.collections || [];
  const open = collections.find((c) => c.id === target?.id);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ emoji: "", title: "" });
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
        onBack={() => setTarget(null)}
      />
    );
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
          <div className="collection-grid">
            {collections.map((c, i) => (
              <div key={c.id} className="collection-card">
                <button
                  className="collection-open"
                  onClick={() => setTarget({ id: c.id })}
                >
                  <Face item={c} className="large" />
                  <span>
                    <strong dir="auto">
                      {c.emoji && !c.cover ? "" : c.emoji} {c.title}
                    </strong>
                    <small>
                      {arabicCount(c.folders.length, FOLDERS)} ·{" "}
                      {arabicCount(titleCount(c), TITLES)}
                    </small>
                  </span>
                </button>
                <div className="collection-tools">
                  <button
                    title={c.pinned ? "إلغاء التثبيت" : "ثبّت على الرئيسية"}
                    className={c.pinned ? "on" : ""}
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
                    title="قدّمها"
                    disabled={i === 0}
                    onClick={() =>
                      update("collectionsEdit", {
                        action: "move",
                        collectionId: c.id,
                        direction: "up",
                      })
                    }
                  >
                    <ArrowUp size={15} />
                  </button>
                  <button
                    title="أخّرها"
                    disabled={i === collections.length - 1}
                    onClick={() =>
                      update("collectionsEdit", {
                        action: "move",
                        collectionId: c.id,
                        direction: "down",
                      })
                    }
                  >
                    <ArrowDown size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
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
    </div>
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
  onBack,
}) {
  const [folderId, setFolderId] = useState(
    collection.folders.some((f) => f.id === initialFolder)
      ? initialFolder
      : collection.folders[0]?.id || "",
  );
  const [editing, setEditing] = useState(false);
  const [newFolder, setNewFolder] = useState("");
  const folder =
    collection.folders.find((f) => f.id === folderId) || collection.folders[0];
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
        style={
          collection.cover
            ? { backgroundImage: `url("${collection.cover}")` }
            : undefined
        }
      >
        <div className="collection-hero-inner">
          <button className="text-button" onClick={onBack}>
            <ArrowRight size={16} /> كل المجموعات
          </button>
          {editing ? (
            <CollectionFields collection={collection} edit={edit} />
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
      {(collection.view === "tabs" || editing) && (
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
              {f.emoji} {f.title}
            </h2>
            <FolderContent
              collection={collection}
              folder={f}
              update={update}
              notice={notice}
              onOpen={onOpen}
              onSettings={onSettings}
              compact
            />
          </section>
        ))
      ) : (
        folder && (
          <>
            {editing && (
              <FolderEditor
                key={`editor-${folder.id}`}
                collection={collection}
                folder={folder}
                edit={edit}
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

function CollectionFields({ collection, edit }) {
  return (
    <div className="collection-fields">
      <Field
        label="الرمز"
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
      <Field
        label="صورة الغلاف (رابط https)"
        dir="ltr"
        maxLength={2000}
        value={collection.cover}
        onCommit={(cover) => edit({ action: "update", cover })}
      />
    </div>
  );
}

function FolderEditor({ collection, folder, edit, onRemoved }) {
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
        <Field
          label="غلاف المجلد (رابط https)"
          dir="ltr"
          maxLength={2000}
          value={folder.cover}
          onCommit={(cover) => folderEdit({ action: "folderUpdate", cover })}
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
function FolderContent({
  collection,
  folder,
  update,
  notice,
  onOpen,
  onSettings,
  editing = false,
  compact = false,
}) {
  const [data, setData] = useState(null);
  const tmdb = folder.tmdb || [];
  const trakt = folder.trakt || [];
  const signature = JSON.stringify([folder.catalogs, tmdb, trakt]);
  useEffect(() => {
    if (!folder.catalogs.length && !tmdb.length && !trakt.length) {
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
  }, [folder.id, signature]);
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
          {data.rows.map((row) => (
            <Rail
              key={row.index}
              title={row.name}
              subtitle={`${typeName(row.type)} · ${row.provider}`}
              metas={row.metas}
              onOpen={onOpen}
            />
          ))}
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
          {!titles.length &&
            !data.rows.length &&
            !data.error &&
            !data.needs?.length && (
              <Empty icon={Folders} title="المجلد فارغ">
                {editing
                  ? "اختر كتالوجاً من الأعلى، أو افتح أي عمل واضغط «أضف لمجموعة»."
                  : "اضغط «تعديل» لتضيف كتالوجات، أو افتح أي عمل واضغط «أضف لمجموعة»."}
              </Empty>
            )}
          {data.missing?.length > 0 && (
            <p className="inline-warning">
              كتالوجات لم نجد إضافتها: {data.missing.join("، ")}. ثبّت الإضافة
              أو أزل الكتالوج من المجلد.
            </p>
          )}
          {data.failures?.length > 0 && (
            <p className="inline-warning">
              لم تستجب: {data.failures.join("، ")}
            </p>
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
  const paste = async () => {
    setBusy(true);
    const r = await act("importNuvioCollections", { text });
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
            onChange={(e) => setText(e.target.value)}
          />
          <div className="button-row">
            <button
              className="primary"
              disabled={!text.trim() || busy}
              onClick={paste}
            >
              استورد المجموعات
            </button>
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
          <p className="subtle">
            الإضافات تُثبّت بعد فحص ملفها كما لو أضفتها بيدك. مصادر TMDB وTrakt
            داخل مجموعات نوفيو لا تنتقل لأنها لا تأتي من إضافة. الأدوات البرمجية
            (Plugins) شيفرة JavaScript من أطراف أخرى: رِواق ينقل قائمة
            مستودعاتها ليحفظها لك، ولا يشغّل شيفرتها.
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
          {result.skippedSources > 0 && (
            <p className="subtle">
              {n(result.skippedSources, SOURCES)} من TMDB أو Trakt لم ينتقل.
            </p>
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
