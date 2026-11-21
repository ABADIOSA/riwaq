import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { call } from "../lib/api.js";
import "../downloads-quality.css";

/**
 * The player's right-click menu, drawn in the page that holds the controls
 * (the HUD over the picture, or the theater), as Harbor and Nuvio HTPC do.
 * It is never a native menu: one owned by the non-focusable HUD, or under
 * MPV's always-on-top window, can open out of sight and keep every click in
 * Riwaq until it closes. Main says which items apply to this viewing and runs
 * a chosen one only for the same viewing (playbackMenu/playbackAction).
 */
export default function PlayerMenu({ at, onClose, onError, request = call }) {
  const [options, setOptions] = useState(null);
  // Issue #157: the subtitle choices, shown in place of the items when
  // several can be saved and none is the selected one.
  const [picking, setPicking] = useState(false);
  const [place, setPlace] = useState(at);
  const box = useRef(null);
  const close = useRef(onClose);
  const requestAtOpen = useRef(request);
  close.current = onClose;

  useEffect(() => {
    let live = true;
    requestAtOpen
      .current("playbackMenu")
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
  useEffect(() => {
    if (options) box.current?.querySelector("button:not(:disabled)")?.focus();
  }, [options, picking]);
  useEffect(() => {
    const previous = document.activeElement;
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true });
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
  }, [options, picking]);

  if (!options) return null;
  // The theater passes its own helper, which shows a refusal as a notice.
  const run = (action, extra = {}) =>
    Promise.resolve(
      request("playbackAction", {
        action,
        videoId: options.videoId,
        sessionId: options.sessionId,
        profileId: options.profileId,
        ...extra,
      }),
    ).catch((e) => onError?.(e.message));
  // Issue #157: the selected subtitle when it can be saved, or the only one.
  const subtitles = {
    choices: Array.isArray(options.subtitles?.choices)
      ? options.subtitles.choices
      : [],
    reason: options.subtitles?.reason || "",
  };
  const direct =
    subtitles.choices.find((c) => c.selected) ||
    (subtitles.choices.length === 1 ? subtitles.choices[0] : null);
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
      onKeyDown={(e) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
        e.preventDefault();
        e.stopPropagation();
        const buttons = [
          ...box.current.querySelectorAll("button:not(:disabled)"),
        ];
        const at = buttons.indexOf(document.activeElement);
        const next =
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? buttons.length - 1
              : (at + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
                buttons.length;
        buttons[next]?.focus();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {picking ? (
        <>
          <p className="menu-note menu-heading" id="subtitle-choices">
            اختر الترجمة التي تريد حفظها
          </p>
          {subtitles.choices.map((c) => (
            <button
              key={c.id}
              role="menuitem"
              className="subtitle-choice"
              aria-describedby="subtitle-choices"
              onClick={pick(() => run("downloadSubtitles", { choice: c.id }))}
            >
              <span dir="auto">{c.label}</span>
            </button>
          ))}
          <hr />
          <button
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation();
              setPicking(false);
            }}
          >
            رجوع
          </button>
        </>
      ) : (
        <>
          <button role="menuitem" onClick={pick(() => run("screenshot"))}>
            التقط لقطة شاشة
          </button>
          {options.torrent && (
            // A torrent's two links (#113): the address it plays from on this
            // computer, for another player, and its magnet, to share. Main keeps
            // both and writes the clipboard itself.
            <>
              <button
                role="menuitem"
                disabled={!options.torrentLink}
                title="رابط تشغيل على هذا الجهاز لمشغّل آخر مثل VLC"
                aria-describedby={
                  !options.torrentLink ? "torrent-link-unavailable" : undefined
                }
                onClick={pick(() => run("copyTorrentLink"))}
              >
                نسخ رابط التورنت
              </button>
              {!options.torrentLink && (
                <p className="menu-note" id="torrent-link-unavailable">
                  رابط التورنت يتوفر حين يعمل من محرك على هذا الجهاز
                </p>
              )}
              <button role="menuitem" onClick={pick(() => run("copyMagnet"))}>
                نسخ رابط المغناطيس
              </button>
            </>
          )}
          <button
            role="menuitem"
            disabled={!options.download}
            aria-describedby={
              !options.download ? "download-unavailable" : undefined
            }
            onClick={pick(() => run("download"))}
          >
            تنزيل الفيديو
          </button>
          {!options.download && (
            <p className="download-unavailable" id="download-unavailable">
              {options.downloadReason}
            </p>
          )}
          <button
            role="menuitem"
            className="subtitle-download"
            disabled={!subtitles.choices.length}
            aria-describedby={
              !subtitles.choices.length ? "subtitles-unavailable" : undefined
            }
            aria-haspopup={
              !direct && subtitles.choices.length ? "menu" : undefined
            }
            onClick={
              direct
                ? pick(() => run("downloadSubtitles", { choice: direct.id }))
                : (e) => {
                    e.stopPropagation();
                    setPicking(true);
                  }
            }
          >
            تنزيل الترجمة
            {direct && (
              // Which subtitle is saved, so another language never is.
              <span className="menu-detail" dir="auto" title={direct.label}>
                {direct.label}
              </span>
            )}
          </button>
          {!subtitles.choices.length && (
            <p
              className="download-unavailable subtitle-note"
              id="subtitles-unavailable"
            >
              {subtitles.reason}
            </p>
          )}
        </>
      )}
    </div>
  );
}
