import React, { useEffect, useMemo, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import VolumeSlider from "./VolumeSlider.jsx";
import {
  chapterAt,
  chapterMarks,
  endsAt,
  timeCounter,
} from "../../core/player-time.mjs";
import { language } from "../../core/i18n.mjs";

/*
 * The player's bottom bar pieces (issue #140), shared by the HUD and the
 * theater so both behave the same: the time counter, the volume control
 * whose slider stays folded until wanted, the chapter strip under the
 * timeline, and the "ends at" clock. Numbers and the timeline stay
 * left-to-right in Arabic too.
 */

const COUNTER_KEY = "riwaq.timeCounter";
const savedMode = () => {
  try {
    return localStorage.getItem(COUNTER_KEY) === "remaining"
      ? "remaining"
      : "elapsed";
  } catch {
    return "elapsed";
  }
};

/** "elapsed / total"; a click (or Enter) shows "-remaining / total". */
export function TimeCounter({ player, className = "" }) {
  const [mode, setMode] = useState(savedMode);
  const live = !!player.live || !(player.duration > 0);
  const toggle = () => {
    const next = mode === "remaining" ? "elapsed" : "remaining";
    setMode(next);
    try {
      localStorage.setItem(COUNTER_KEY, next);
    } catch {}
  };
  const text = timeCounter(player, mode);
  if (live)
    return (
      <span className={`time-counter ${className}`} dir="ltr">
        {text}
      </span>
    );
  return (
    <button
      type="button"
      className={`time-counter ${className}`}
      dir="ltr"
      title={mode === "remaining" ? "اعرض الوقت المنقضي" : "اعرض الوقت المتبقي"}
      aria-label={
        mode === "remaining"
          ? `الوقت المتبقي ${text}، اضغط لعرض الوقت المنقضي`
          : `الوقت المنقضي ${text}، اضغط لعرض الوقت المتبقي`
      }
      onClick={toggle}
    >
      {text}
    </button>
  );
}

/**
 * The volume button and its slider. The slider is folded until the pointer
 * rests on the control or the keyboard focuses it (CSS), a touch on the
 * button opens it (a second touch mutes), and it stays open while it is
 * being dragged even when the pointer wanders off.
 */
export function VolumeControl({
  volume = 0,
  max = 150,
  muted = false,
  onMute,
  onChange,
  showValue = true,
  // Unfolds for a moment after a key or the wheel changed the volume.
  reveal = false,
}) {
  const [touchOpen, setTouchOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const pointer = useRef("mouse");
  const box = useRef(null);
  useEffect(() => {
    if (!dragging) return;
    const end = () => setDragging(false);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [dragging]);
  // A touch elsewhere folds a slider a touch opened.
  useEffect(() => {
    if (!touchOpen) return;
    const away = (e) => {
      if (!box.current?.contains(e.target)) setTouchOpen(false);
    };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [touchOpen]);
  const silent = muted || !volume;
  return (
    <div
      ref={box}
      className={`volume-group ${touchOpen || dragging || reveal ? "open" : ""}`}
      onPointerDownCapture={(e) => {
        pointer.current = e.pointerType || "mouse";
        if (e.target.closest?.(".volume-control")) setDragging(true);
      }}
    >
      <button
        type="button"
        className="volume-button"
        title={silent ? "إلغاء كتم الصوت (M)" : "كتم الصوت (M)"}
        aria-label={silent ? "إلغاء كتم الصوت" : "كتم الصوت"}
        aria-pressed={!!muted}
        onClick={() => {
          if (pointer.current === "touch" && !touchOpen)
            return setTouchOpen(true);
          onMute?.();
        }}
      >
        {silent ? <VolumeX size={19} /> : <Volume2 size={19} />}
      </button>
      <span className="volume-fold">
        <VolumeSlider
          volume={volume}
          max={max}
          muted={muted}
          onChange={onChange}
        />
        {showValue && (
          <small className="volume-value" dir="ltr">
            {Math.round(volume || 0)}%
          </small>
        )}
      </span>
    </div>
  );
}

/** Chapters for this player state; memoized on what they depend on. */
export function useChapters(player) {
  return useMemo(
    () =>
      chapterMarks(player.chapters, player.duration, { live: !!player.live }),
    [player.chapters, player.duration, player.live],
  );
}

/** Thin dividers on the timeline where chapters begin. */
export function ChapterTicks({ marks, duration, className = "chapter-tick" }) {
  if (!marks.length || !(duration > 0)) return null;
  return marks
    .filter((m) => m.start > 0)
    .map((m) => (
      <i
        key={m.index}
        className={className}
        aria-hidden="true"
        style={{ left: `${(m.start / duration) * 100}%` }}
      />
    ));
}

/**
 * The chapters under the timeline, each as wide as it lasts, titled when
 * there is room (always in its tooltip). The playing one is marked; a click
 * goes to a chapter's start. Untitled chapters are numbered.
 */
export function ChapterStrip({ marks, position, duration, onSeek }) {
  if (!marks.length || !(duration > 0)) return null;
  const current = chapterAt(marks, position);
  return (
    <div className="chapter-strip" dir="ltr" role="group" aria-label="الفصول">
      {marks[0].start > 0 && (
        <span
          aria-hidden="true"
          style={{ flexBasis: 0, flexGrow: marks[0].start }}
        />
      )}
      {marks.map((m) => {
        const name = m.title || `الفصل ${m.index + 1}`;
        const playing = current?.index === m.index;
        return (
          <button
            key={m.index}
            type="button"
            className={`chapter ${playing ? "playing" : ""}`}
            style={{ flexGrow: Math.max(0.0001, m.end - m.start) }}
            title={name}
            aria-label={`${name}، انتقل إلى بداية الفصل`}
            aria-current={playing ? "true" : undefined}
            onClick={() => onSeek?.(m.start)}
          >
            <span dir="auto">{name}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The playing chapter's title beside the counter, as on YouTube. */
export function ChapterNow({ marks, position }) {
  const current = chapterAt(marks, position);
  if (!current) return null;
  return (
    <small className="chapter-now" dir="auto">
      {current.title || `الفصل ${current.index + 1}`}
    </small>
  );
}

/** "Ends 10:42 PM" (ص/م in Arabic); "tomorrow" when past midnight. */
export function EndsAt({ player, className = "" }) {
  const [now, setNow] = useState(() => Date.now());
  // The clock moves while paused too: it is the end if playback resumed.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  const end = endsAt(player, { now, locale: language() });
  if (!end) return null;
  return (
    <small className={`ends-at ${className}`}>
      {end.days > 0 ? `ينتهي ${end.time} · غدًا` : `ينتهي ${end.time}`}
    </small>
  );
}
