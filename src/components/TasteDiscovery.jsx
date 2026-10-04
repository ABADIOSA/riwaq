import React, { useMemo, useRef, useState } from "react";
import {
  Compass,
  SlidersHorizontal,
  ThumbsUp,
  EyeOff,
  RotateCcw,
  Check,
  X,
} from "lucide-react";
import {
  TASTE_GENRES,
  cleanTaste,
  tasteCandidates,
  recommendTaste,
} from "../../core/taste.mjs";
import { titleKey } from "../../core/library.mjs";
import { arabicCount, EXCLUDED, LIKES } from "../../core/arabic.mjs";
import { Poster, ScrollRow } from "./UI.jsx";

export function TasteFeedback({ meta, state, update }) {
  const [busy, setBusy] = useState(false);
  const controls = useRef(null);
  if (!["movie", "series"].includes(meta?.type)) return null;
  const value = state.settings.taste?.feedback?.find(
    (f) => titleKey(f) === titleKey(meta),
  )?.value;
  const choose = async (next) => {
    const focused = controls.current?.contains(document.activeElement);
    const shelf = controls.current?.closest(".taste-discovery");
    setBusy(true);
    try {
      const saved = await update("tasteEdit", {
        action: "feedback",
        profileId: state.profiles?.active,
        meta,
        value: value === next ? "clear" : next,
      });
      if (saved && focused && shelf)
        requestAnimationFrame(() => {
          if (!controls.current?.isConnected && shelf.isConnected)
            shelf
              .querySelector(".taste-pick button, .taste-customize")
              ?.focus({ preventScroll: true });
        });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="taste-feedback"
      ref={controls}
      role="group"
      aria-label={`رأيك في ${meta.name}`}
    >
      <button
        disabled={busy}
        className={value === "like" ? "chosen" : ""}
        aria-pressed={value === "like"}
        onClick={() => choose("like")}
        title="يحسّن اقتراحات رِواق في هذا الملف فقط"
      >
        <ThumbsUp size={15} />
        {value === "like" ? "أحببته · تراجع" : "أحببته"}
      </button>
      <button
        disabled={busy}
        className={value === "hide" ? "chosen" : ""}
        aria-pressed={value === "hide"}
        onClick={() => choose("hide")}
        title="يستبعد العمل من بوصلة ذوقك وجلسة رِواق، ويبقى قابلاً للبحث"
      >
        <EyeOff size={15} />
        {value === "hide" ? "استعد الاقتراح" : "لا تقترحه"}
      </button>
    </div>
  );
}

export default function TasteDiscovery({
  rows,
  state,
  update,
  onOpen,
  watched,
  loading,
  collapsed = false,
}) {
  const taste = useMemo(
    () => cleanTaste(state.settings.taste),
    [state.settings.taste],
  );
  // On Discover the panel starts closed so the page's own tabs stay in view.
  const [editing, setEditing] = useState(
      () =>
        !collapsed &&
        !taste.genres.length &&
        !taste.feedback.some((f) => f.value === "like"),
    ),
    [busy, setBusy] = useState(false),
    [confirmReset, setConfirmReset] = useState(false);
  const [type, setType] = useState(""),
    [maxMinutes, setMaxMinutes] = useState(0);
  const pool = useMemo(() => tasteCandidates(rows), [rows]);
  const picks = useMemo(
    () => recommendTaste(pool, taste, { watched, type, maxMinutes }),
    [pool, taste, watched, type, maxMinutes],
  );
  const hidden = taste.feedback.filter((f) => f.value === "hide");
  const liked = taste.feedback.filter((f) => f.value === "like");
  const configured = taste.genres.length || liked.length;
  const save = async (action) => {
    setBusy(true);
    try {
      return await update("tasteEdit", {
        ...action,
        profileId: state.profiles?.active,
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="taste-discovery" aria-label="بوصلة ذوقك">
      <header className="taste-heading">
        <div>
          <span className="taste-eyebrow">
            <Compass size={15} /> RIWAQ / MADE FOR YOU
          </span>
          <h2>بوصلة ذوقك.</h2>
          <p>
            {configured
              ? "اختيارات تشبهك، ومساحة لما لم تجربه بعد."
              : "ابدأ بالأنواع التي تحبها. كل اختيار يجعل البوصلة أقرب لك."}
          </p>
        </div>
        <button
          className="secondary taste-customize"
          aria-expanded={editing}
          onClick={() => {
            setEditing(!editing);
            setConfirmReset(false);
          }}
        >
          <SlidersHorizontal size={17} />
          {editing ? "إغلاق التخصيص" : "اضبط ذوقك"}
        </button>
      </header>
      {editing && (
        <div className="taste-controls">
          <div
            className="taste-genre-chips"
            role="group"
            aria-label="الأنواع التي تحبها"
          >
            {TASTE_GENRES.map(([id, name]) => (
              <button
                key={id}
                disabled={busy}
                className={taste.genres.includes(id) ? "chosen" : ""}
                aria-pressed={taste.genres.includes(id)}
                onClick={() =>
                  save({
                    action: "preferences",
                    genres: taste.genres.includes(id)
                      ? taste.genres.filter((g) => g !== id)
                      : [...taste.genres, id],
                  })
                }
              >
                {taste.genres.includes(id) && <Check size={13} />} {name}
              </button>
            ))}
          </div>
          <div
            className="taste-exploration"
            role="group"
            aria-label="مساحة الاكتشاف"
          >
            {[
              ["familiar", "قريب من ذوقي"],
              ["balanced", "توازن"],
              ["curious", "وسّع عالمي"],
            ].map(([id, name]) => (
              <button
                key={id}
                disabled={busy}
                className={taste.exploration === id ? "chosen" : ""}
                aria-pressed={taste.exploration === id}
                onClick={() => save({ action: "preferences", exploration: id })}
              >
                {name}
              </button>
            ))}
          </div>
          <p className="taste-privacy">
            على جهازك ولكل ملف شخصي. نتعلم من الأنواع التي تختارها و«أحببته»
            فقط، ولا نرسل هذه التفضيلات إلى منصاتك.
          </p>
          {editing && (
            <div className="taste-manage">
              <p>
                اختياراتك المحفوظة: {arabicCount(liked.length, LIKES)} ·{" "}
                {arabicCount(hidden.length, EXCLUDED)}
              </p>
              <details>
                <summary>راجع اختياراتك وتراجع عنها</summary>
                <div className="taste-history">
                  {taste.feedback.length ? (
                    taste.feedback.map((f) => (
                      <div key={titleKey(f)}>
                        <span dir="auto">{f.name}</span>
                        <small>
                          {f.value === "like" ? "أحببته" : "لا تقترحه"}
                        </small>
                        <button
                          disabled={busy}
                          aria-label={`تراجع عن رأيك في ${f.name}`}
                          onClick={() =>
                            save({
                              action: "feedback",
                              meta: f,
                              value: "clear",
                            })
                          }
                        >
                          <RotateCcw size={14} /> تراجع
                        </button>
                      </div>
                    ))
                  ) : (
                    <p>لم تحفظ رأياً في عمل بعد.</p>
                  )}
                </div>
              </details>
              {!confirmReset ? (
                <button
                  className="text-button"
                  onClick={() => setConfirmReset(true)}
                >
                  ابدأ ذوقي من جديد
                </button>
              ) : (
                <div className="taste-reset">
                  <span>نمحو الأنواع والآراء في هذا الملف فقط؟</span>
                  <button
                    disabled={busy}
                    onClick={async () => {
                      if (await save({ action: "reset" }))
                        setConfirmReset(false);
                    }}
                  >
                    نعم، امسحها
                  </button>
                  <button onClick={() => setConfirmReset(false)}>إلغاء</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      <div className="taste-filters">
        <span>من فهارسك</span>
        <label>
          النوع
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              if (e.target.value === "series") setMaxMinutes(0);
            }}
          >
            <option value="">أفلام ومسلسلات</option>
            <option value="movie">أفلام</option>
            <option value="series">مسلسلات</option>
          </select>
        </label>
        <label>
          وقت الفيلم
          <select
            value={maxMinutes}
            onChange={(e) => {
              setMaxMinutes(Number(e.target.value));
              if (Number(e.target.value)) setType("movie");
            }}
          >
            <option value="0">أي مدة</option>
            <option value="90">حتى 90 دقيقة</option>
            <option value="120">حتى ساعتين</option>
          </select>
        </label>
        {(type || maxMinutes > 0) && (
          <button
            className="text-button"
            onClick={() => {
              setType("");
              setMaxMinutes(0);
            }}
          >
            <X size={14} /> امسح المرشحات
          </button>
        )}
      </div>
      {maxMinutes > 0 && (
        <p className="taste-note">
          يعرض أفلاماً بمدة معلومة فقط. قد يغيب عمل مدته غير معروفة.
        </p>
      )}
      {picks.length ? (
        <ScrollRow className="taste-row">
          {picks.map((pick) => (
            <article
              className="taste-pick"
              key={titleKey(pick.meta)}
              data-title-id={pick.meta.id}
            >
              <Poster meta={pick.meta} onOpen={onOpen} />
              <p className="taste-reason">{pick.reason}</p>
              <TasteFeedback meta={pick.meta} state={state} update={update} />
            </article>
          ))}
        </ScrollRow>
      ) : (
        <div className="taste-empty" role="status">
          <Compass size={26} />
          <p>
            {loading
              ? "ننتظر أعمالاً من فهارسك…"
              : "لا توجد اقتراحات تطابق اختياراتك الآن. جرّب «توازن» أو امسح المرشحات أو تصفّح أقساماً أخرى لمزيد من الأعمال."}
          </p>
        </div>
      )}
      <p className="taste-note">
        «لا تقترحه» يغيّر البوصلة والجلسة فقط؛ تبقى الأعمال في البحث ومكتبتك.
        الاقتراح لا يؤكد توفر مصدر تشغيل.
      </p>
    </section>
  );
}
