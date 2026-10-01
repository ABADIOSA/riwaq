import React, { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Image as ImageIcon,
  Heart,
  Wallpaper,
  X,
} from "lucide-react";
import { resolveAppearance } from "../../core/appearance.mjs";
import { arabicCount } from "../../core/arabic.mjs";
import { call } from "../lib/api.js";

const TABS = [
  ["backdrops", "الخلفيات"],
  ["posters", "البوسترات"],
  ["logos", "الشعارات"],
  ["fanart", "أعمال المعجبين"],
];
const IMAGES = {
  zero: "لا صور",
  one: "صورة واحدة",
  two: "صورتان",
  few: "{n} صور",
  many: "{n} صورة",
  other: "{n} صورة",
};
const LANGS = [
  ["", "الكل"],
  ["ar", "العربية"],
  ["en", "الإنجليزية"],
  ["none", "بلا نص"],
];

/**
 * The artwork gallery on a title's page: tabs for backgrounds, posters,
 * logos and fan art, a language filter, and a viewer with arrows. A
 * background can become Riwaq's own wallpaper.
 */
export default function ArtworkGallery({
  meta,
  state,
  update,
  notice,
  onSettings,
}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("backdrops");
  const [lang, setLang] = useState("");
  const [viewing, setViewing] = useState(-1);
  const tmdbOn = state.providers?.find?.((p) => p.id === "tmdb")?.configured;
  const fanartOn = state.providers?.find?.(
    (p) => p.id === "fanart",
  )?.configured;
  useEffect(() => {
    let live = true;
    setData(null);
    setError("");
    call("artwork", { type: meta.type, id: meta.id })
      .then((d) => {
        if (!live) return;
        setData(d);
        // Open on the first tab that has something.
        const first = TABS.find(([id]) => d[id]?.length)?.[0];
        if (first) setTab(first);
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [meta.type, meta.id, tmdbOn, fanartOn]);
  if (!["movie", "series"].includes(meta.type)) return null;
  const all = data?.[tab] || [];
  const langs = new Set(all.map((i) => i.lang || "none"));
  const items = all.filter(
    (i) => !lang || (lang === "none" ? !i.lang : i.lang === lang),
  );
  const current = items[viewing];
  const step = (d) =>
    setViewing((i) =>
      items.length ? (i + d + items.length) % items.length : -1,
    );
  return (
    <section className="artwork-gallery">
      <div className="section-heading">
        <div>
          <h2>معرض العمل</h2>
          <span>
            {data
              ? TABS.map(
                  ([id, label]) => `${label} ${data[id]?.length || 0}`,
                ).join(" · ")
              : "نجمع الصور…"}
          </span>
        </div>
      </div>
      <div className="title-tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "selected" : ""}
            onClick={() => {
              setTab(id);
              setLang("");
              setViewing(-1);
            }}
          >
            {label}
            {data && <small>{data[id]?.length || 0}</small>}
          </button>
        ))}
      </div>
      {(tab === "posters" || tab === "logos") && langs.size > 1 && (
        <div className="choice-row gallery-langs">
          {LANGS.filter(([id]) => !id || langs.has(id)).map(([id, label]) => (
            <button
              key={id}
              className={lang === id ? "selected" : ""}
              onClick={() => setLang(id)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {error && <p className="inline-warning">{error}</p>}
      {!data && !error && (
        <div className={`gallery-grid gallery-${tab}`}>
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className="gallery-skeleton" />
          ))}
        </div>
      )}
      {data && items.length > 0 && (
        <div className={`gallery-grid gallery-${tab}`}>
          {items.map((item, i) => (
            <button
              key={item.full}
              className="gallery-item"
              onClick={() => setViewing(i)}
              title={[item.kind, item.source, item.lang]
                .filter(Boolean)
                .join(" · ")}
            >
              <img
                src={item.thumb}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={(e) =>
                  e.currentTarget.parentElement.classList.add("broken")
                }
              />
              {item.kind && <em>{item.kind}</em>}
            </button>
          ))}
        </div>
      )}
      {data && !items.length && (
        <p className="subtle gallery-empty">
          <ImageIcon size={16} />
          {tab === "fanart"
            ? fanartOn
              ? "لا أعمال معجبين لهذا العمل على Fanart.tv بعد."
              : "أعمال المعجبين تأتي من Fanart.tv بمفتاحك المجاني."
            : "لا صور هنا بعد."}
        </p>
      )}
      {data && (data.needs?.length > 0 || data.failed?.length > 0) && (
        <p className="subtle gallery-note">
          {data.needs?.length > 0 && (
            <>
              لمعرض أكبر أضف مفتاح{" "}
              {data.needs
                .map((n) => (n === "tmdb" ? "TMDB" : "Fanart.tv"))
                .join(" و")}{" "}
              المجاني.{" "}
              <button
                className="text-button"
                onClick={() => onSettings?.("data")}
              >
                مزوّدو البيانات
              </button>
            </>
          )}
          {data.failed?.length > 0 &&
            ` تعذّر الوصول إلى ${data.failed.join("، ")} الآن.`}
        </p>
      )}
      {current && (
        <div
          className="gallery-viewer"
          role="dialog"
          aria-label="عارض الصور"
          tabIndex={-1}
          ref={(el) => el?.focus()}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setViewing(-1);
            }
            // Right is back in a right-to-left page.
            if (e.key === "ArrowLeft") step(1);
            if (e.key === "ArrowRight") step(-1);
          }}
          onClick={(e) => e.target === e.currentTarget && setViewing(-1)}
        >
          <img
            src={current.full}
            alt=""
            referrerPolicy="no-referrer"
            className={`viewer-${tab}`}
          />
          <div className="viewer-bar">
            <span>
              {viewing + 1} / {items.length}
              {current.kind ? ` · ${current.kind}` : ""} · {current.source}
              {current.lang ? ` · ${current.lang}` : ""}
              {current.width ? ` · ${current.width}×${current.height}` : ""}
              {current.likes ? (
                <>
                  {" "}
                  · <Heart size={12} /> {current.likes}
                </>
              ) : null}
            </span>
            <div className="button-row">
              {tab === "backdrops" && (
                <button
                  className="secondary small"
                  onClick={async () => {
                    const look = resolveAppearance(state.settings);
                    if (
                      await update("settings", {
                        appearance: { ...look, wallpaper: current.full },
                      })
                    )
                      notice("صارت هذه الصورة خلفية رِواق (المظهر ← الأجواء)");
                  }}
                >
                  <Wallpaper size={15} /> اجعلها خلفية رِواق
                </button>
              )}
              <button
                className="secondary small"
                onClick={() =>
                  call("openArtwork", { url: current.full }).catch((e) =>
                    notice(e.message),
                  )
                }
              >
                <ExternalLink size={15} /> افتح بالحجم الكامل
              </button>
              <button
                className="icon-button"
                title="السابقة"
                aria-label="الصورة السابقة"
                onClick={() => step(-1)}
              >
                <ChevronRight size={20} />
              </button>
              <button
                className="icon-button"
                title="التالية"
                aria-label="الصورة التالية"
                onClick={() => step(1)}
              >
                <ChevronLeft size={20} />
              </button>
              <button
                className="icon-button"
                title="إغلاق"
                aria-label="إغلاق العارض"
                onClick={() => setViewing(-1)}
              >
                <X size={20} />
              </button>
            </div>
          </div>
        </div>
      )}
      {data && (
        <p className="subtle gallery-credit">
          {arabicCount(
            TABS.reduce((n, [id]) => n + (data[id]?.length || 0), 0),
            IMAGES,
          )}{" "}
          من{" "}
          {[
            ...new Set(
              TABS.flatMap(([id]) => (data[id] || []).map((i) => i.source)),
            ),
          ].join(" و")}
          . الصور ملك أصحابها.
        </p>
      )}
    </section>
  );
}
