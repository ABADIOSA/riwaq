import React, { useEffect, useRef, useState } from "react";
import { Folders } from "lucide-react";
import { LOCAL_ART } from "../../core/collections.mjs";
import { call } from "../lib/api.js";

/*
 * Collection and folder artwork (November 2026 beta, Nuvio's folder look):
 * the still cover first; the moving cover (a GIF) only while that one card
 * is hovered or has keyboard focus, and only once it has loaded, so the
 * still stays until then and no grid ever plays every GIF at once. Leaving
 * the card unmounts the GIF (it stops decoding). A GIF that fails falls back
 * to the still for the rest of the session; a card with no picture shows
 * its emoji on the theme's colours. Reduced motion (Riwaq's own switch or
 * the system's) never starts a GIF.
 */

/** Whether motion should stay still: Riwaq's switch, or the system's. */
export function useReducedMotion(setting = false) {
  const query = "(prefers-reduced-motion: reduce)";
  const [system, setSystem] = useState(
    () => typeof matchMedia === "function" && matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const list = matchMedia(query);
    const change = () => setSystem(list.matches);
    list.addEventListener?.("change", change);
    return () => list.removeEventListener?.("change", change);
  }, []);
  return !!setting || system;
}

// Pictures the viewer chose from this computer: Riwaq keeps them by an
// opaque ID and hands back an address only it can serve. Cached per ID.
const localCache = new Map();
export function useArt(src) {
  const local = typeof src === "string" && LOCAL_ART.test(src);
  const [url, setUrl] = useState(() =>
    local ? localCache.get(src) || "" : src || "",
  );
  useEffect(() => {
    if (!local) return setUrl(src || "");
    if (localCache.has(src)) return setUrl(localCache.get(src));
    let live = true;
    call("collectionArt", { id: src })
      .then((found) => {
        const value = typeof found === "string" ? found : "";
        localCache.set(src, value);
        if (live) setUrl(value);
      })
      .catch(() => live && setUrl(""));
    return () => {
      live = false;
    };
  }, [src, local]);
  return url;
}

// GIFs that failed this session: never asked for again.
const brokenGifs = new Set();

/**
 * The picture of a card. `active` says the card is hovered or focused;
 * `still` picks which still to use first (a folder's cover, else its
 * backdrop).
 */
export function CollectionArt({
  item,
  active = false,
  reduced = false,
  wide = false,
  className = "",
}) {
  const stillSrc = useArt(
    wide ? item.backdrop || item.cover : item.cover || item.backdrop,
  );
  const gifSrc = useArt(item.gif && item.gifOn !== false ? item.gif : "");
  const [stillBroken, setStillBroken] = useState(false);
  const [gifReady, setGifReady] = useState(false);
  const wants = active && !reduced && !!gifSrc && !brokenGifs.has(gifSrc);
  useEffect(() => setStillBroken(false), [stillSrc]);
  useEffect(() => {
    setGifReady(false);
  }, [gifSrc]);
  // Load the GIF the first time the card is wanted; show it only when it
  // is there, so the still never gives way to a blank.
  useEffect(() => {
    if (!wants || gifReady) return;
    let live = true;
    const probe = new Image();
    probe.decoding = "async";
    probe.referrerPolicy = "no-referrer";
    probe.onload = () => live && setGifReady(true);
    probe.onerror = () => {
      brokenGifs.add(gifSrc);
      if (live) setGifReady(false);
    };
    probe.src = gifSrc;
    return () => {
      live = false;
    };
  }, [wants, gifReady, gifSrc]);
  const showGif = wants && gifReady;
  return (
    <span
      className={`collection-art ${showGif ? "playing" : ""} ${className}`}
      aria-hidden="true"
    >
      {stillSrc && !stillBroken ? (
        <img
          className="art-still"
          src={stillSrc}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setStillBroken(true)}
        />
      ) : (
        <span className="art-placeholder">
          <b>{item.emoji || <Folders size={26} />}</b>
        </span>
      )}
      {showGif && (
        <img
          className="art-gif"
          src={gifSrc}
          alt=""
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => {
            brokenGifs.add(gifSrc);
            setGifReady(false);
          }}
        />
      )}
    </span>
  );
}

/** Hover or keyboard focus on a card, as one flag. */
export function useActive() {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  return {
    active: hover || focus,
    props: {
      onPointerEnter: () => setHover(true),
      onPointerLeave: () => setHover(false),
      onFocus: () => setFocus(true),
      onBlur: () => setFocus(false),
    },
  };
}

/**
 * A folder card: its artwork in its shape, its logo or name (or neither,
 * when the cover says it: the name stays its accessible name), and the
 * glow around it while hovered or focused when the folder asks for one.
 */
export function FolderTile({
  folder,
  reduced = false,
  onClick,
  selected,
  role,
  className = "",
  forceActive,
}) {
  const { active, props } = useActive();
  const on = forceActive ?? active;
  const logo = useArt(folder.logo || "");
  const [logoBroken, setLogoBroken] = useState(false);
  const ref = useRef(null);
  return (
    <button
      ref={ref}
      type="button"
      className={`folder-tile shape-${folder.shape || "poster"} ${folder.glow ? "glow" : ""} ${folder.hideTitle ? "title-hidden" : ""} ${on ? "is-active" : ""} ${selected ? "selected" : ""} ${className}`}
      role={role}
      aria-selected={role === "tab" ? !!selected : undefined}
      aria-label={
        folder.hideTitle || (logo && !logoBroken) ? folder.title : undefined
      }
      onClick={onClick}
      {...props}
    >
      <CollectionArt item={folder} active={on} reduced={reduced} />
      {logo && !logoBroken ? (
        <img
          className="folder-logo"
          src={logo}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setLogoBroken(true)}
        />
      ) : (
        !folder.hideTitle && (
          <strong dir="auto">
            {folder.emoji && !folder.cover ? "" : folder.emoji} {folder.title}
          </strong>
        )
      )}
    </button>
  );
}
