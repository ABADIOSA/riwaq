import React, { useState } from "react";
import {
  Library,
  ListOrdered,
  Play,
  ArrowUp,
  ArrowDown,
  Trash2,
  Check,
  Search,
} from "lucide-react";
import { Empty, Poster, Rail, IconButton } from "./UI.jsx";
import {
  continueWatching,
  latestProgress,
  isCompleted,
  filterLibrary,
  titleKey,
} from "../../core/library.mjs";
import { imgUrl, typeName, clock } from "../lib/helpers.js";

export default function LibraryView({ state, update, onOpen, notice }) {
  const [tab, setTab] = useState("saved"),
    [search, setSearch] = useState(""),
    [type, setType] = useState(""),
    [sort, setSort] = useState("recent"),
    [busy, setBusy] = useState(false);
  const latest = latestProgress(state.progress),
    resume = continueWatching(state.progress),
    queue = state.queue || [];
  const sets = {
    saved: [...state.favorites].reverse(),
    continue: resume,
    queue,
    history: latest,
    connected: state.connectedLists || [],
  };
  const counts = {
    saved: state.favorites.length,
    continue: resume.length,
    queue: queue.length,
    history: latest.length,
    connected: sets.connected.length,
  };
  const options = { search, type, sort: tab === "queue" ? "recent" : sort };
  const items = tab === "connected" ? [] : filterLibrary(sets[tab], options);
  const change = async (method, input) => {
    if (busy) return;
    setBusy(true);
    try {
      return await update(method, input);
    } finally {
      setBusy(false);
    }
  };
  const editHistory = async (item, action) => {
    if (
      await change("historyEdit", {
        action,
        meta: item.meta,
        videoId: item.videoId,
      })
    )
      notice(
        action === "complete"
          ? "تم وضع علامة شاهدته محلياً"
          : "أزيلت المشاهدة من سجل هذا الملف",
      );
  };
  return (
    <div className="page-body library-studio">
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR PERSONAL CINEMA</span>
          <h1>حكاياتك، على ترتيبك.</h1>
          <p>مكتبة وطابور مشاهدة محفوظان لهذا الملف الشخصي.</p>
        </div>
        <Library size={32} />
      </div>
      <div className="library-summary">
        <div>
          <b>{state.favorites.length}</b>
          <span>في مكتبتي</span>
        </div>
        <div>
          <b>{resume.length}</b>
          <span>حكاية نكملها</span>
        </div>
        <div>
          <b>{queue.length}</b>
          <span>بانتظار المشاهدة</span>
        </div>
      </div>
      <div className="library-tabs" role="tablist" aria-label="أقسام المكتبة">
        {[
          ["saved", "قائمتي"],
          ["continue", "متابعة المشاهدة"],
          ["queue", "طابور المشاهدة"],
          ["history", "سجل المشاهدة"],
          ["connected", "قوائم المنصات"],
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            aria-controls="library-content"
            className={tab === id ? "selected" : ""}
            onClick={() => setTab(id)}
          >
            {label}
            <small>{counts[id]}</small>
          </button>
        ))}
      </div>
      <div className="library-toolbar">
        <label className="library-search">
          <Search size={18} />
          <input
            aria-label="ابحث في مكتبتي"
            placeholder="ابحث داخل مكتبتك…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select
          aria-label="نوع عناوين المكتبة"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="">كل الأنواع</option>
          <option value="movie">أفلام</option>
          <option value="series">مسلسلات</option>
          <option value="anime">أنمي</option>
        </select>
        {tab !== "queue" && (
          <select
            aria-label="ترتيب المكتبة"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="recent">الأحدث إضافة</option>
            <option value="name">الاسم</option>
            <option value="year">سنة الإنتاج</option>
          </select>
        )}
      </div>
      <div id="library-content" role="tabpanel">
        {tab === "queue" && (
          <p className="subtle">
            اختر المصدر عند التشغيل. يُزال العنوان بعد بدء المشاهدة. الترتيب
            محفوظ ويمكن تعديله بالسهمين.
          </p>
        )}
        {tab === "saved" && items.length > 0 && (
          <div className="poster-grid">
            {items.map((meta) => (
              <div className="library-poster" key={titleKey(meta)}>
                <Poster meta={meta} onOpen={onOpen} />
                <button
                  disabled={busy}
                  className="library-remove"
                  onClick={() => change("favorite", meta)}
                  aria-label={`إزالة ${meta.name} من مكتبتي`}
                >
                  <Trash2 size={14} /> إزالة من مكتبتي
                </button>
              </div>
            ))}
          </div>
        )}
        {["queue", "continue", "history"].includes(tab) && (
          <div className="watch-list">
            {items.map((item) => {
              const key = item.key || `${item.meta.type}:${item.videoId}`,
                index = queue.findIndex((q) => q.key === item.key);
              return (
                <article
                  className="watch-row"
                  key={key}
                  data-queue-key={item.key}
                >
                  <span className="watch-number">
                    {tab === "queue" ? (
                      String(index + 1).padStart(2, "0")
                    ) : isCompleted(item) ? (
                      <Check size={20} />
                    ) : (
                      <Play size={18} />
                    )}
                  </span>
                  <button
                    className="watch-cover"
                    onClick={() => onOpen(item.meta, item.videoId)}
                    aria-label={`تفاصيل ${item.meta.name}`}
                  >
                    {imgUrl(item.meta.poster) && (
                      <img src={imgUrl(item.meta.poster)} alt="" />
                    )}
                    <Play size={19} />
                  </button>
                  <div className="watch-description">
                    <h3 dir="auto">{item.meta.name}</h3>
                    <p>
                      {item.label || typeName(item.meta.type)}
                      {tab !== "queue" &&
                        ` · ${isCompleted(item) ? "شاهدته" : clock(item.position) + (item.duration > 0 ? " / " + clock(item.duration) : "")}`}
                    </p>
                    {item.videoId !== item.meta.id && !item.label && (
                      <small dir="auto">{item.videoId}</small>
                    )}
                  </div>
                  <div className="watch-actions">
                    <button
                      className="secondary"
                      onClick={() => onOpen(item.meta, item.videoId)}
                    >
                      <Play size={15} />
                      {tab === "continue" ? "متابعة" : "شاهد"}
                    </button>
                    {tab === "queue" ? (
                      <>
                        <IconButton
                          title={`تقديم ${item.meta.name} في الطابور`}
                          disabled={busy || index <= 0}
                          onClick={() =>
                            change("queueEdit", {
                              action: "move",
                              key,
                              direction: -1,
                            })
                          }
                        >
                          <ArrowUp size={17} />
                        </IconButton>
                        <IconButton
                          title={`تأخير ${item.meta.name} في الطابور`}
                          disabled={busy || index === queue.length - 1}
                          onClick={() =>
                            change("queueEdit", {
                              action: "move",
                              key,
                              direction: 1,
                            })
                          }
                        >
                          <ArrowDown size={17} />
                        </IconButton>
                        <IconButton
                          title={`إزالة ${item.meta.name} من الطابور`}
                          disabled={busy}
                          onClick={() =>
                            change("queueEdit", { action: "remove", key })
                          }
                        >
                          <Trash2 size={17} />
                        </IconButton>
                      </>
                    ) : (
                      <>
                        {!isCompleted(item) && (
                          <IconButton
                            title={`شاهدت ${item.meta.name}`}
                            disabled={busy}
                            onClick={() => editHistory(item, "complete")}
                          >
                            <Check size={17} />
                          </IconButton>
                        )}
                        <IconButton
                          title={`إزالة ${item.meta.name} من السجل`}
                          disabled={busy}
                          onClick={() => editHistory(item, "remove")}
                        >
                          <Trash2 size={17} />
                        </IconButton>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {tab === "connected" &&
          sets.connected.map((list) => {
            const metas = filterLibrary(list.metas || [], options);
            return metas.length ? (
              <Rail
                key={list.key}
                title={list.name}
                metas={metas}
                onOpen={onOpen}
              />
            ) : null;
          })}
        {tab !== "connected" && items.length === 0 && (
          <Empty
            icon={tab === "queue" ? ListOrdered : Library}
            title={
              search || type
                ? "لا توجد عناوين مطابقة"
                : tab === "queue"
                  ? "رتّب سهرتك القادمة"
                  : "مساحة لحكايات جديدة"
            }
          >
            {tab === "queue"
              ? "أضف فيلمًا أو حلقة من صفحة التفاصيل بزر «أضف إلى الطابور»."
              : "احفظ عناوين من صفحة التفاصيل، أو استورد مكتبتك من حساب ستريميو."}
          </Empty>
        )}
        {tab === "connected" &&
          !sets.connected.some(
            (l) => filterLibrary(l.metas || [], options).length,
          ) && (
            <Empty icon={Library} title="لا توجد قوائم مطابقة">
              اربط منصاتك من الإعدادات ثم حدّث قوائمك.
            </Empty>
          )}
      </div>
    </div>
  );
}
