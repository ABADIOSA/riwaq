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
 * the system's) never starts a GIF. The still slots (cover, backdrop,
 * logo) never move at all (StillImage).
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

/**
 * Whether a picture address might move: a GIF or WebP by its name or data
 * type, or a picture from this computer in the web edition (an object
 * address says nothing of its type).
 */
export function mayMove(src) {
  if (typeof src !== "string" || !src) return false;
  if (/^data:image\/(gif|webp)/i.test(src) || /^blob:/i.test(src)) return true;
  try {
    return /\.(gif|webp)$/i.test(new URL(src).pathname);
  } catch {
    return false;
  }
}
// The longest side a frozen still is kept at: sharp on a card or a hero at
// twice the pixel density, without holding a full-size bitmap per card.
const STILL_MAX = 960;

/**
 * A picture in a still slot (a cover, a backdrop, a logo): never moves,
 * whatever the motion setting (PR #155 review, F8). A picture that might
 * be animated is drawn once into a canvas, which shows the first frame
 * (the canvas rule for animated images), at most STILL_MAX a side;
 * anything else is a plain image. The loader is let go once drawn or when
 * the element goes.
 */
export function StillImage({
  src,
  className = "",
  alt = "",
  onError,
  lazy = true,
}) {
  const canvas = useRef(null);
  const moving = mayMove(src);
  const failed = useRef(onError);
  failed.current = onError;
  useEffect(() => {
    if (!moving) return;
    let live = true;
    const img = new Image();
    const release = () => {
      img.onload = img.onerror = null;
      img.removeAttribute("src");
    };
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.onload = () => {
      const c = canvas.current;
      if (live && c && img.naturalWidth && img.naturalHeight) {
        const scale = Math.min(
          1,
          STILL_MAX / Math.max(img.naturalWidth, img.naturalHeight),
        );
        c.width = Math.max(1, Math.round(img.naturalWidth * scale));
        c.height = Math.max(1, Math.round(img.naturalHeight * scale));
        c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
        c.dataset.ready = "1";
      }
      release();
    };
    img.onerror = () => {
      release();
      if (live) failed.current?.();
    };
    img.src = src;
    return () => {
      live = false;
      release();
    };
  }, [src, moving]);
  if (!moving)
    return (
      <img
        className={className}
        src={src}
        alt={alt}
        loading={lazy ? "lazy" : undefined}
        decoding="async"
        referrerPolicy="no-referrer"
        onError={onError}
      />
    );
  return (
    <canvas
      ref={canvas}
      className={`${className} still-frame`}
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : "true"}
    />
  );
}

// Pictures the viewer chose from this computer: Riwaq keeps them by an
// opaque ID and hands back an address only it can serve. Cached per ID.
const localCache = new Map();
export function useArt(src) {
  return useArtState(src).url;
}
/**
 * The same, saying whether a picture from this computer is missing here
 * (another device's, or gone): `missing` once the answer came back empty,
 * so the editor can say so instead of failing silently. A missing answer
 * is not cached, so a picture picked again shows at once.
 */
export function useArtState(src) {
  const local = typeof src === "string" && LOCAL_ART.test(src);
  const [state, setState] = useState(() => ({
    url: local ? localCache.get(src) || "" : src || "",
    missing: false,
  }));
  useEffect(() => {
    if (!local) return setState({ url: src || "", missing: false });
    if (localCache.has(src))
      return setState({ url: localCache.get(src), missing: false });
    let live = true;
    setState({ url: "", missing: false });
    call("collectionArt", { id: src })
      .then((found) => {
        const value = typeof found === "string" ? found : "";
        if (value) localCache.set(src, value);
        if (live) setState({ url: value, missing: !value });
      })
      .catch(() => live && setState({ url: "", missing: true }));
    return () => {
      live = false;
    };
  }, [src, local]);
  return state;
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
    // Leaving the card before the GIF arrived stops the probe too.
    return () => {
      live = false;
      probe.onload = probe.onerror = null;
      probe.removeAttribute("src");
    };
  }, [wants, gifReady, gifSrc]);
  const showGif = wants && gifReady;
  return (
    <span
      className={`collection-art ${showGif ? "playing" : ""} ${className}`}
      aria-hidden="true"
    >
      {stillSrc && !stillBroken ? (
        <StillImage
          className="art-still"
          src={stillSrc}
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
        <StillImage
          className="folder-logo"
          src={logo}
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
