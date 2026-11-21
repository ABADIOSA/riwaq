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
 * Whether a picture is certain to have one frame. Only a JPEG data URL
 * qualifies: the only data URLs here are Riwaq's own pictures from this
 * computer, typed by main (or the web store) from their sniffed bytes. A
 * name proves nothing (PR #155 third review, N7: an APNG at an address
 * ending ".jpg", directly or after a redirect, moved in a still slot), so
 * every other picture is drawn through a canvas.
 */
export function surelyStill(src) {
  return typeof src === "string" && /^data:image\/jpe?g[;,]/i.test(src);
}
// A still is drawn at the size its element shows it, at the screen's
// density, enough to cover the box as `object-fit: cover` would (N8: a
// fixed 960 px longest side blurred a full-width hero and still held a
// large bitmap for a small card), never above the picture's own size or
// STILL_MAX a side; STILL_FALLBACK when the element has no size yet.
const STILL_MAX = 2560;
const STILL_FALLBACK = 960;
function stillScale(element, width, height) {
  const box = element?.getBoundingClientRect?.();
  const longest = Math.max(width, height);
  const cap = STILL_MAX / longest;
  if (!box?.width || !box?.height)
    return Math.min(1, cap, STILL_FALLBACK / longest);
  const dpr = Math.min(3, globalThis.devicePixelRatio || 1);
  const cover = Math.max(box.width / width, box.height / height) * dpr;
  return Math.min(1, cap, cover);
}

// One observer for every lazy still (N8): a picture is asked for only
// when its element comes near the screen, as a lazy <img> is, so a long
// grid does not download and decode what nobody scrolled to.
const nearWaiters = new Map();
let nearObserver = null;
function whenNear(element, run) {
  if (typeof IntersectionObserver !== "function") {
    run();
    return () => {};
  }
  nearObserver ||= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const go = nearWaiters.get(entry.target);
        nearWaiters.delete(entry.target);
        nearObserver.unobserve(entry.target);
        go?.();
      }
    },
    // scrollMargin reaches into scrolling rows and pages where supported.
    { rootMargin: "300px", scrollMargin: "300px" },
  );
  nearWaiters.set(element, run);
  nearObserver.observe(element);
  return () => {
    nearWaiters.delete(element);
    nearObserver.unobserve(element);
  };
}

/**
 * A picture in a still slot (a cover, a backdrop, a logo): never moves,
 * whatever the motion setting (PR #155 review, F8, R7, N7). Every picture
 * but Riwaq's own JPEGs is drawn once into a canvas, which shows the first
 * frame of an animated image (GIF, APNG, WebP, AVIF), at the element's
 * size; a picture from another site draws without being read back (no
 * CORS needed). Lazy (the default) waits until the element is near the
 * screen (N8). A new address clears the previous picture at once, so a
 * slow or failed one never leaves another folder's picture showing, and a
 * failure is reported to `onError` (N10). The loader is let go once drawn
 * or when the element goes.
 */
export function StillImage({
  src,
  className = "",
  alt = "",
  onError,
  lazy = true,
}) {
  const canvas = useRef(null);
  const moving = !!src && !surelyStill(src);
  const failed = useRef(onError);
  failed.current = onError;
  useEffect(() => {
    if (!moving) return;
    const c = canvas.current;
    // Whatever the canvas showed belongs to the previous address.
    if (c) {
      c.width = 0;
      c.height = 0;
      delete c.dataset.ready;
      delete c.dataset.failed;
    }
    let live = true;
    let img = null;
    const release = () => {
      if (!img) return;
      img.onload = img.onerror = null;
      img.removeAttribute("src");
    };
    const load = () => {
      if (!live) return;
      img = new Image();
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      img.onload = () => {
        const el = canvas.current;
        if (live && el && img.naturalWidth && img.naturalHeight) {
          const scale = stillScale(el, img.naturalWidth, img.naturalHeight);
          el.width = Math.max(1, Math.round(img.naturalWidth * scale));
          el.height = Math.max(1, Math.round(img.naturalHeight * scale));
          el.getContext("2d")?.drawImage(img, 0, 0, el.width, el.height);
          el.dataset.ready = "1";
        }
        release();
      };
      img.onerror = () => {
        release();
        if (!live) return;
        if (canvas.current) canvas.current.dataset.failed = "1";
        failed.current?.();
      };
      img.src = src;
    };
    const stop = lazy && c ? whenNear(c, load) : (load(), () => {});
    return () => {
      live = false;
      stop();
      release();
    };
  }, [src, moving, lazy]);
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
/**
 * Forgets every picture fetched for the previous profile activation (a
 * switch, a lock, a restore): the next profile asks main again, which
 * checks it may read each one (PR #155 second review, artwork ownership).
 */
export function forgetLocalArt() {
  localCache.clear();
}
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
  // Tied to the address that failed (R8): a tile reused for another
  // folder never keeps the previous one's broken logo.
  const [brokenLogo, setBrokenLogo] = useState("");
  const logoBroken = !!logo && brokenLogo === logo;
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
          onError={() => setBrokenLogo(logo)}
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
