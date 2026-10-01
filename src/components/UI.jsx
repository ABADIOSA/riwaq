import React, { memo, useState, useEffect, useRef, useContext } from "react";
import {
  LoaderCircle,
  Film,
  X,
  Play,
  Star,
  ChevronLeft,
  ChevronRight,
  Check,
} from "lucide-react";
import { WatchedContext } from "../lib/watched.js";
import { typeName, clock, imgUrl, episodeList } from "../lib/helpers.js";
import { titleKey } from "../../core/library.mjs";
import { arabicCount, MINUTES } from "../../core/arabic.mjs";
export function IconButton({ title, children, ...props }) {
  return (
    <button className="icon-button" title={title} aria-label={title} {...props}>
      {children}
    </button>
  );
}
export function Busy({ text = "جاري التحميل…" }) {
  return (
    <div className="busy">
      <LoaderCircle className="spin" size={22} />
      <span>{text}</span>
    </div>
  );
}
export function Empty({ icon: Icon = Film, title, children, action }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={32} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Modal({ children, onClose, className = "" }) {
  const ref = useRef();
  useEffect(() => {
    const d = ref.current;
    d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${className}`}
      onCancel={(e) => {
        e.preventDefault();
        // A dialog opened from another closes alone.
        e.stopPropagation();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-inner">
        <IconButton
          title="إغلاق"
          className="icon-button modal-close"
          onClick={onClose}
        >
          <X size={21} />
        </IconButton>
        {children}
      </div>
    </dialog>
  );
}
// Cards and rows re-render only when their own props change: a playback
// tick or a hero turn must not redraw thousands of posters.
export const Poster = memo(function Poster({ meta, onOpen, progress }) {
  const finished = useContext(WatchedContext);
  const seen = finished?.has(`${meta.type}:${meta.id}`);
  return (
    <button
      className="poster-card"
      onClick={() => onOpen(meta, progress?.videoId)}
      aria-label={`تفاصيل ${meta.name}`}
    >
      <div className="poster-image">
        {imgUrl(meta.poster) ? (
          <img
            src={imgUrl(meta.poster)}
            alt=""
            loading="lazy"
            onError={(e) => (e.currentTarget.style.opacity = "0")}
          />
        ) : null}
        <Film className="poster-fallback" size={36} />
        <div className="poster-shade" />
        <span className="poster-play">
          <Play size={22} fill="currentColor" />
        </span>
        {meta.imdbRating && (
          <span className="rating">
            <Star size={11} fill="currentColor" />
            {meta.imdbRating}
          </span>
        )}
        {seen && (
          <span className="watched-mark" title="شاهدته">
            <Check size={13} strokeWidth={3} />
          </span>
        )}
        {progress && (
          <span className="progress-line">
            <i
              style={{
                width: `${Math.min(100, (progress.position / (progress.duration || progress.position * 2)) * 100)}%`,
              }}
            />
          </span>
        )}
      </div>
      <strong dir="auto">{meta.name}</strong>
      <span className="poster-sub">
        {progress
          ? progress.duration > 0
            ? `متبقي ${arabicCount(Math.max(0, Math.round((progress.duration - progress.position) / 60)), MINUTES)}`
            : `وصلت إلى ${clock(progress.position)}`
          : meta.releaseInfo || meta.year || typeName(meta.type)}
      </span>
    </button>
  );
});
/**
 * A horizontal row moved with arrows instead of a scrollbar. Each arrow
 * moves most of a screen; an arrow hides at its end of the row, and both
 * hide when everything fits. Wheel, touchpad and keyboard focus still
 * scroll it. The page is right-to-left, so "next" moves toward the left.
 */
export function ScrollRow({
  as: Tag = "div",
  className = "",
  children,
  onNearEnd,
  ...rest
}) {
  const ref = useRef(null);
  const nearEnd = useRef(onNearEnd);
  nearEnd.current = onNearEnd;
  const [edges, setEdges] = useState({ start: true, end: true });
  const measure = () => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const pos = Math.abs(el.scrollLeft);
    const next = { start: pos <= 2, end: max <= 2 || pos >= max - 2 };
    // Within a screen and a half of the end: a row that renders in steps
    // adds its next cards before the viewer reaches them.
    // A row off screen is not laid out and measures zero: it waits.
    if (
      nearEnd.current &&
      el.clientWidth > 0 &&
      max - pos <= el.clientWidth * 1.5
    )
      nearEnd.current();
    setEdges((was) =>
      was.start === next.start && was.end === next.end ? was : next,
    );
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const resize = new ResizeObserver(measure);
    resize.observe(el);
    const mutate = new MutationObserver(measure);
    mutate.observe(el, { childList: true });
    return () => {
      el.removeEventListener("scroll", measure);
      resize.disconnect();
      mutate.disconnect();
    };
  }, []);
  const move = (forward) => {
    const el = ref.current;
    if (!el) return;
    const rtl = getComputedStyle(el).direction === "rtl";
    const step = Math.max(el.clientWidth * 0.85, 160);
    el.scrollBy({
      left: (forward ? 1 : -1) * (rtl ? -step : step),
      behavior: document.querySelector(".reduced-motion") ? "auto" : "smooth",
    });
  };
  return (
    <div
      className={`scroll-row-wrap ${edges.start ? "" : "can-back"} ${edges.end ? "" : "can-forward"}`}
    >
      {!edges.start && (
        <button
          type="button"
          className="scroll-arrow scroll-back"
          aria-label="السابق"
          title="السابق"
          onClick={() => move(false)}
        >
          <ChevronRight size={22} />
        </button>
      )}
      <Tag ref={ref} className={`scroll-row ${className}`} {...rest}>
        {children}
      </Tag>
      {!edges.end && (
        <button
          type="button"
          className="scroll-arrow scroll-forward"
          aria-label="التالي"
          title="التالي"
          onClick={() => move(true)}
        >
          <ChevronLeft size={22} />
        </button>
      )}
    </div>
  );
}
const RAIL_LIMIT = 60;
// A rail renders its first cards and adds more as the viewer moves along
// it, so a home page of a hundred catalogs is not six thousand cards.
const RAIL_FIRST = 12;
const RAIL_STEP = 12;
export const Rail = memo(function Rail({
  title,
  subtitle,
  metas,
  onOpen,
  onMore,
  progressMap,
}) {
  const total = Math.min(metas.length, RAIL_LIMIT);
  const [count, setCount] = useState(RAIL_FIRST);
  return (
    <section className="rail">
      <div className="section-heading">
        <div>
          <h2>{title}</h2>
          {subtitle && <span>{subtitle}</span>}
        </div>
        {onMore && (
          <button className="text-button" onClick={onMore}>
            عرض الكل <ChevronLeft size={16} />
          </button>
        )}
      </div>
      <ScrollRow
        className="poster-row"
        onNearEnd={
          count < total
            ? () => setCount((c) => Math.min(total, c + RAIL_STEP))
            : undefined
        }
      >
        {metas.slice(0, Math.min(count, total)).map((m, i) => (
          <Poster
            key={`${m.type}:${m.id}:${i}`}
            meta={m}
            onOpen={onOpen}
            progress={progressMap?.[titleKey(m)]}
          />
        ))}
      </ScrollRow>
    </section>
  );
});
