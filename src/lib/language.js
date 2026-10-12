/**
 * The interface language for a React tree (core/i18n.mjs). It is set during
 * render, before any element is created, so the first paint is already in
 * the viewer's language; the page's lang and dir follow, and the choice is
 * remembered on this device for the very first paint after a restart.
 */
import { useEffect } from "react";
import {
  cleanLanguage,
  direction,
  setLanguage,
  translate,
} from "../../core/i18n.mjs";

const SAVED = "riwaq.language";

/** The language this device last used, before the app state arrives. */
export function savedLanguage() {
  try {
    return cleanLanguage(localStorage.getItem(SAVED));
  } catch {
    return "ar";
  }
}

export function applyDocumentLanguage(lang) {
  document.documentElement.lang = lang;
  document.documentElement.dir = direction(lang);
  document.title = translate("رِواق — Riwaq", lang);
}

export function useInterfaceLanguage(value) {
  const lang = cleanLanguage(value ?? savedLanguage());
  setLanguage(lang);
  useEffect(() => {
    applyDocumentLanguage(lang);
    try {
      localStorage.setItem(SAVED, lang);
    } catch {}
  }, [lang]);
  return lang;
}
