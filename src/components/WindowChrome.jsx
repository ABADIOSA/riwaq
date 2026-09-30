import React, { useEffect, useState } from "react";
import { Minus, Square, Copy, X } from "lucide-react";
import { api, call } from "../lib/api.js";

/** The window as main created it: its frame, and whether it is maximized. */
export function useWindowState() {
  const [win, setWin] = useState({ frame: "native", wanted: "native" });
  useEffect(() => {
    call("windowInfo")
      .then(setWin)
      .catch(() => {});
    return api?.on?.("window", setWin);
  }, []);
  return [win, setWin];
}

/**
 * Riwaq's own title bar, shown when the viewer turned Windows' bar off. The
 * whole strip drags the window. In the hybrid mode Windows draws its own
 * buttons over the top corner; in Riwaq's mode the buttons are drawn here,
 * on the left as Arabic Windows places them, in the chosen style.
 */
export default function WindowBar({ win, controls = "filled", title }) {
  if (win.frame === "native" || win.fullscreen) return null;
  const act = (action) => call("windowControl", { action }).catch(() => {});
  return (
    <div
      className={`window-bar ${win.frame === "hybrid" ? "hybrid" : ""}`}
      onDoubleClick={() => act("maximize")}
    >
      <span className="window-bar-title">{title}</span>
      {win.frame === "riwaq" && (
        <div
          className={`window-buttons style-${controls}`}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <button
            className="window-close"
            title="إغلاق"
            aria-label="إغلاق"
            onClick={() => act("close")}
          >
            <X size={15} />
          </button>
          <button
            title={win.maximized ? "استعادة" : "تكبير"}
            aria-label={win.maximized ? "استعادة" : "تكبير"}
            onClick={() => act("maximize")}
          >
            {win.maximized ? <Copy size={13} /> : <Square size={12} />}
          </button>
          <button
            title="تصغير"
            aria-label="تصغير"
            onClick={() => act("minimize")}
          >
            <Minus size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Whether a press on this element is on "empty space" the viewer may drag
 * the window by: page backgrounds and headings, never a control, a card,
 * artwork, text being edited or the player.
 */
export function isEmptySpace(target) {
  if (!target || typeof target.closest !== "function") return false;
  if (
    target.closest(
      "button,a,input,select,textarea,label,summary,[role=button],[role=tab],[contenteditable],.poster-card,.episode,.rail-track,img,video,.modal,.player-shell,.hero-actions,.window-buttons,.search-box",
    )
  )
    return false;
  return !!target.closest(
    ".content,.sidebar,.topbar,.page-body,.page-heading,.section-heading,.studio-content,.studio-nav,.window-bar",
  );
}
