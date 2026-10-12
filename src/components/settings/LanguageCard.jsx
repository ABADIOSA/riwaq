import React from "react";
import { Languages } from "lucide-react";
import { cleanLanguage } from "../../../core/i18n.mjs";

// Each language is named in its own script and never translated.
const CHOICES = [
  ["ar", "العربية"],
  ["en", "English"],
];

/**
 * The interface language (core/i18n.mjs, issue #74). Titles and
 * descriptions keep coming from their sources; switching to English offers
 * to ask TMDB for English descriptions too.
 */
export function LanguageCard({ state, update }) {
  const s = state.settings;
  const current = cleanLanguage(s.uiLanguage);
  return (
    <section className="settings-card language-card">
      <h2>
        <Languages size={18} /> لغة الواجهة
      </h2>
      <p>
        القوائم والأزرار والإعدادات تتغير فوراً. أسماء الأعمال وأوصافها تجي من
        مصادرها بلغتها.
      </p>
      <div className="choice-row" role="radiogroup" aria-label="لغة الواجهة">
        {CHOICES.map(([id, name]) => (
          <button
            key={id}
            role="radio"
            translate="no"
            lang={id}
            dir={id === "ar" ? "rtl" : "ltr"}
            aria-checked={current === id}
            className={current === id ? "selected" : ""}
            onClick={() => update("settings", { uiLanguage: id })}
          >
            {name}
          </button>
        ))}
      </div>
      {current === "en" && s.metadataLanguage === "ar-SA" && (
        <div className="setting-row">
          <div>
            <b>أوصاف TMDB بالإنجليزية كذلك؟</b>
            <p>
              أسماء الأعمال وأوصافها من TMDB الحين بالعربية. تقدر تخليها
              بالإنجليزية مثل الواجهة.
            </p>
          </div>
          <button
            className="secondary small"
            onClick={() => update("settings", { metadataLanguage: "en-US" })}
          >
            اجعلها بالإنجليزية
          </button>
        </div>
      )}
    </section>
  );
}
