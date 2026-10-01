import React, { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  Plus,
  Star,
} from "lucide-react";
import { imgUrl, typeName } from "../lib/helpers.js";
import { TitleLogo, preloadLogos } from "./TitleLogo.jsx";

export const HERO_SECONDS = 9;

/**
 * The home page's featured titles: the work's logo instead of its typed
 * name, arrows on both sides, dots with the time left, the arrow keys, and
 * an optional slow turn to the next title that waits while the pointer or
 * the keyboard is on it. The page is right to left, so "next" is on the left.
 */
export default function HomeHero({
  items,
  index,
  setIndex,
  settings,
  favorites,
  running,
  onOpen,
  onFavorite,
}) {
  const count = items.length;
  const at = count ? ((index % count) + count) % count : 0;
  const hero = items[at];
  const mode = settings.titleLogos || "arabic";
  const [held, setHeld] = useState(false);
  const [stopped, setStopped] = useState(false);
  const box = useRef(null);
  const auto =
    settings.heroAutoplay !== false && !settings.reduceMotion && count > 1;
  const turning = auto && running && !held && !stopped;
  const go = (step) => setIndex((((at + step) % count) + count) % count);

  useEffect(() => {
    preloadLogos(items, mode);
    for (const m of items)
      if (imgUrl(m.background)) new Image().src = imgUrl(m.background);
  }, [items.map((m) => m.id).join("|"), mode]);

  useEffect(() => {
    if (!turning) return;
    const timer = setTimeout(() => {
      if (!document.hidden) go(1);
    }, HERO_SECONDS * 1000);
    return () => clearTimeout(timer);
  }, [turning, at, count]);

  if (!hero) return null;
  const saved = favorites.some((m) => m.id === hero.id);
  return (
    <section
      ref={box}
      className={`hero ${count > 1 ? "has-arrows" : ""} ${turning ? "turning" : ""}`}
      aria-roledescription="carousel"
      aria-label="أعمال مختارة"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => {
        if (!box.current?.contains(e.relatedTarget)) setHeld(false);
      }}
      onKeyDown={(e) => {
        if (count < 2 || e.target.closest("input,textarea,select")) return;
        if (e.key === "ArrowLeft") go(1);
        else if (e.key === "ArrowRight") go(-1);
        else return;
        e.preventDefault();
      }}
    >
      <div
        key={`bg-${hero.id}`}
        className="hero-backdrop"
        style={{
          backgroundImage: imgUrl(hero.background)
            ? `url("${imgUrl(hero.background)}")`
            : undefined,
        }}
      />
      <div className="hero-gradient" />
      <div
        className="hero-content"
        key={`c-${hero.id}`}
        aria-live={turning ? "off" : "polite"}
      >
        <span className="eyebrow">
          <span /> من عالم السينما إلى رِواقك
        </span>
        <TitleLogo meta={hero} mode={mode} className="hero-title" />
        <div className="hero-meta">
          {hero.imdbRating && (
            <span className="hero-rating">
              <Star size={15} fill="currentColor" /> {hero.imdbRating}
            </span>
          )}
          <span>{hero.releaseInfo}</span>
          <span>{typeName(hero.type)}</span>
          {hero.genres?.slice(0, 2).map((g) => (
            <span key={g}>{g}</span>
          ))}
        </div>
        <p dir="auto">
          {hero.description ||
            "اكتشف التفاصيل، واختر مصدر المشاهدة المناسب من إضافاتك."}
        </p>
        <div className="button-row">
          <button className="primary" onClick={() => onOpen(hero)}>
            <Play fill="currentColor" size={18} />
            استكشف وشاهد
          </button>
          <button className="secondary" onClick={() => onFavorite(hero)}>
            {saved ? <Check size={20} /> : <Plus size={20} />}
            مكتبتي
          </button>
        </div>
      </div>
      {count > 1 && (
        <>
          <button
            className="hero-arrow prev"
            aria-label="العمل السابق"
            title="السابق"
            onClick={() => go(-1)}
          >
            <ChevronRight size={22} />
          </button>
          <button
            className="hero-arrow next"
            aria-label="العمل التالي"
            title="التالي"
            onClick={() => go(1)}
          >
            <ChevronLeft size={22} />
          </button>
        </>
      )}
      <div className="hero-footer">
        <span>
          اختيارات من إضافاتك <span className="hero-line" />
          <span className="hero-count" dir="ltr">
            {at + 1} / {count}
          </span>
        </span>
        <div className="hero-controls">
          {auto && (
            <button
              className="hero-toggle"
              aria-label={stopped ? "تشغيل التقليب" : "إيقاف التقليب"}
              title={stopped ? "تشغيل التقليب" : "إيقاف التقليب"}
              onClick={() => setStopped(!stopped)}
            >
              {stopped ? <Play size={12} /> : <Pause size={12} />}
            </button>
          )}
          <div className="hero-pages">
            {items.map((m, i) => (
              <button
                key={m.id || i}
                aria-label={`عرض ${m.name}`}
                aria-current={i === at ? "true" : undefined}
                className={i === at ? "selected" : ""}
                onClick={() => setIndex(i)}
              >
                {i === at && turning && (
                  <i
                    key={at}
                    style={{ animationDuration: `${HERO_SECONDS}s` }}
                  />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
