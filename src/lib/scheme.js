/**
 * Light and dark (issue #126, core/appearance.mjs). "system" follows the
 * operating system through prefers-color-scheme, which Electron ties to
 * Windows' app mode, and changes live. The scheme drawn last is remembered
 * on this device so the very first paint after a restart is not the wrong
 * colour (the app state arrives a moment later).
 */
import { useEffect, useState } from "react";
import { api, isWeb } from "./api.js";

const QUERY = "(prefers-color-scheme: dark)";
const SAVED = "riwaq.scheme";

const media = () => {
  try {
    return window.matchMedia(QUERY);
  } catch {
    return null;
  }
};

/** Whether the system asks for dark; dark when it cannot be read. */
export const systemDark = () => media()?.matches ?? true;

/** A Windows contrast theme can reach Electron before the renderer's media
 * query, or bypass that query after a reload. Use either signal. */
export function watchForcedColors() {
  const query = window.matchMedia("(forced-colors: active)");
  let native = false;
  let updated = false;
  const paint = () =>
    document.documentElement.classList.toggle(
      "forced-colors",
      native || query.matches,
    );
  const update = (forced) => {
    if (typeof forced !== "boolean") return;
    updated = true;
    native = forced;
    paint();
  };
  query.addEventListener("change", paint);
  paint();
  if (api && !isWeb) {
    api.on?.("systemContrast", update);
    api
      .call("systemContrast")
      .then((forced) => {
        if (!updated) update(forced);
      })
      .catch(() => {});
  }
}

export function useSystemDark() {
  const [dark, setDark] = useState(systemDark);
  useEffect(() => {
    const m = media();
    if (!m) return;
    const on = () => setDark(m.matches);
    on();
    m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, []);
  return dark;
}

/** The scheme this device drew last, for the document before React. */
export function savedScheme() {
  try {
    return localStorage.getItem(SAVED) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function rememberScheme(scheme) {
  const value = scheme === "light" ? "light" : "dark";
  document.documentElement.dataset.scheme = value;
  try {
    localStorage.setItem(SAVED, value);
  } catch {}
}
