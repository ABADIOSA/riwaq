import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { call } from "../lib/api.js";

/**
 * The player's right-click menu, drawn in the page that holds the controls
 * (the HUD over the picture, or the theater), as Harbor and Nuvio HTPC do.
 * It is never a native menu: one owned by the non-focusable HUD, or under
 * MPV's always-on-top window, can open out of sight and keep every click in
 * Riwaq until it closes. Main says which items apply to this viewing and runs
 * a chosen one only for the same viewing (playbackMenu/playbackAction).
 */
export default function PlayerMenu({
  at,
  onClose,
  onPause,
  onPanel,
  onStop,
  onError,
  request = call,
}) {
  const [options, setOptions] = useState(null);
  const [place, setPlace] = useState(at);
  const box = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    let live = true;
    call("playbackMenu")
      .then((found) => {
        if (!live) return;
        if (found) setOptions(found);
        else close.current();
      })
      .catch(() => live && close.current());
    return () => {
      live = false;
    };
  }, []);
  // A press anywhere else, Escape, or the window losing focus closes it.
  useEffect(() => {
    const down = (e) => {
      if (!box.current?.contains(e.target)) close.current();
    };
    const key = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      close.current();
    };
    const blur = () => close.current();
    document.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", blur);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", blur);
    };
  }, []);
  // It opens at the pointer and stays inside the window.
  useLayoutEffect(() => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.max(8, Math.min(at.x, window.innerWidth - rect.width - 8));
    const y = Math.max(8, Math.min(at.y, window.innerHeight - rect.height - 8));
    if (x !== place.x || y !== place.y) setPlace({ x, y });
  }, [options]);

  if (!options) return null;
  // The theater passes its own helper, which shows a refusal as a notice.
  const run = (action) =>
    Promise.resolve(
      request("playbackAction", { action, videoId: options.videoId }),
    ).catch((e) => onError?.(e.message));
  const pick = (fn) => (e) => {
    e.stopPropagation();
    close.current();
    fn();
  };
  const keep = (e) => e.stopPropagation();
  return (
    <div
      ref={box}
      className="player-menu"
      role="menu"
      aria-label="قائمة المشغّل"
      style={{ left: place.x, top: place.y }}
      onPointerDown={keep}
      onPointerUp={keep}
      onClick={keep}
      onDoubleClick={keep}
      onWheel={keep}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <button role="menuitem" onClick={pick(onPause)}>
        {options.paused ? "استئناف المشاهدة" : "إيقاف مؤقت"}
      </button>
      <button role="menuitem" onClick={pick(onPanel)}>
        الترجمة والصوت
      </button>
      <button role="menuitem" onClick={pick(() => run("screenshot"))}>
        التقط لقطة شاشة
      </button>
      {options.torrent && (
        <button role="menuitem" onClick={pick(() => run("copyMagnet"))}>
          نسخ رابط التورنت
        </button>
      )}
      <button
        role="menuitem"
        disabled={!options.download}
        onClick={pick(() => run("download"))}
      >
        تنزيل الفيديو للمشاهدة لاحقًا
      </button>
      <hr />
      <button role="menuitem" onClick={pick(onStop)}>
        إيقاف المشاهدة
      </button>
    </div>
  );
}
