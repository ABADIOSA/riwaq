import React, { useEffect, useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { Rail } from "./UI.jsx";
import { call } from "../lib/api.js";

/**
 * AI suggestions for a search, asked for only when the viewer presses the
 * button: every question is sent to the provider they chose, with their key.
 */
export default function AiSearchRow({ query, ai, onOpen, onSettings }) {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setResult(null);
    setError("");
  }, [query]);
  if (!ai?.configured || !query || query.trim().length < 3) return null;
  const provider = ai.providers.find((p) => p.id === ai.provider)?.name || "";
  const ask = async () => {
    setBusy(true);
    setError("");
    try {
      setResult(await call("aiSearch", { query }));
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };
  if (!result)
    return (
      <div className="ai-ask">
        <button className="secondary" disabled={busy} onClick={ask}>
          {busy ? (
            <Loader2 size={16} className="spin" />
          ) : (
            <Sparkles size={16} />
          )}{" "}
          {busy ? "يفكّر…" : `اسأل ${provider} عن «${query}»`}
        </button>
        <small>
          {error ||
            "يرسل رِواق جملتك فقط إلى المزوّد الذي اخترته، ثم يبحث عن اقتراحاته في مصادرك."}
        </small>
        {error && (
          <button className="text-button" onClick={() => onSettings("ai")}>
            إعدادات البحث الذكي
          </button>
        )}
      </div>
    );
  return result.metas.length ? (
    <Rail
      title={
        <span className="service-title">
          <Sparkles size={17} /> اقتراحات {provider}
        </span>
      }
      subtitle={
        result.unmatched.length
          ? `لم نجد ${result.unmatched.length} من ${result.suggested} في مصادرك`
          : `وجدنا كل الاقتراحات (${result.suggested})`
      }
      metas={result.metas}
      onOpen={onOpen}
    />
  ) : (
    <div className="ai-ask">
      <small>
        لم نجد اقتراحات {provider} في مصادرك. جرّب وصفاً آخر أو أضف مفتاح TMDB
        لمطابقة أدق.
      </small>
    </div>
  );
}
