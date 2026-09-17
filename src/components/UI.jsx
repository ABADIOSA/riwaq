import React, { useState, useEffect, useRef } from "react";
import { LoaderCircle, Film, X, Play, Star, ChevronLeft } from "lucide-react";
import { typeName, clock, imgUrl, episodeList } from "../lib/helpers.js";
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
export function Poster({ meta, onOpen, progress }) {
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
          ? `متبقي ${Math.max(0, Math.round((progress.duration - progress.position) / 60))} دقيقة`
          : meta.releaseInfo || meta.year || typeName(meta.type)}
      </span>
    </button>
  );
}
export function Rail({ title, subtitle, metas, onOpen, onMore, progressMap }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="rail">
      <div className="section-heading">
        <div>
          <h2>{title}</h2>
          {subtitle && <span>{subtitle}</span>}
        </div>
        {(onMore || metas.length > 14) && (
          <button
            className="text-button"
            onClick={onMore || (() => setExpanded(!expanded))}
          >
            عرض الكل <ChevronLeft size={16} />
          </button>
        )}
      </div>
      <div className="poster-row">
        {metas.slice(0, expanded ? metas.length : 14).map((m, i) => (
          <Poster
            key={`${m.type}:${m.id}:${i}`}
            meta={m}
            onOpen={onOpen}
            progress={progressMap?.[m.id]}
          />
        ))}
      </div>
    </section>
  );
}
