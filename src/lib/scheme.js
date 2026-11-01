/**
 * Light and dark (issue #126, core/appearance.mjs). "system" follows the
 * operating system through prefers-color-scheme, which Electron ties to
 * Windows' app mode, and changes live. The scheme drawn last is remembered
 * on this device so the very first paint after a restart is not the wrong
 * colour (the app state arrives a moment later).
 */
import { useEffect, useState } from "react";

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
