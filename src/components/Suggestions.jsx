import React, { memo, useEffect, useState } from "react";
import { Link2, RefreshCw, Sparkles, X } from "lucide-react";
import { call } from "../lib/api.js";
import { Busy, Poster, ScrollRow } from "./UI.jsx";

const KINDS = [
  ["movies", "أفلام"],
  ["shows", "مسلسلات"],
];

/**
 * Trakt's suggestions for the signed-in viewer, built from what they watch
 * and rate there. Films or series, a refresh, and "not interested" on each
 * card, which tells Trakt to stop suggesting it. Without a Trakt account
 * the section invites the viewer to connect one.
 */
function TraktSuggestions({ trakt, onOpen, onSettings, notice }) {
  const connected = !!trakt?.connected;
  const [kind, setKind] = useState("movies");
  const [lists, setLists] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const load = (force = false) => {
    setLoading(true);
    setError("");
    call("traktSuggestions", { kind, force })
      .then((r) => setLists((was) => ({ ...was, [kind]: r.metas || [] })))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    if (connected) load();
  }, [connected, kind, trakt?.username]);

  if (!connected)
    return (
      <section className="rail suggest-rail">
        <div className="section-heading">
          <div>
            <h2>اقتراحات تراكت</h2>
            <span>أفلام ومسلسلات مختارة لك</span>
          </div>
        </div>
        <div className="suggest-invite">
          <Sparkles size={22} />
          <p>
            اربط حساب تراكت، ويقترح عليك أفلاماً ومسلسلات حسب ما تشاهده وتقيّمه
            هناك.
          </p>
          <button
            className="secondary small"
            onClick={() => onSettings("connections")}
          >
            <Link2 size={15} /> اربط تراكت
          </button>
        </div>
      </section>
    );

  const metas = lists[kind] || [];
  return (
    <section className="rail suggest-rail">
      <div className="smart-head">
        <div className="section-heading">
          <div>
            <h2>مقترحة لك من تراكت</h2>
            <span>
              {trakt.username
                ? `حسب ما شاهده وقيّمه ${trakt.username}`
                : "حسب ما تشاهده وتقيّمه"}
            </span>
          </div>
          <button
            className="text-button"
            title="اقتراحات جديدة"
            disabled={loading}
            onClick={() => load(true)}
          >
            <RefreshCw size={15} /> تحديث
          </button>
        </div>
        <div className="smart-chips" role="tablist" aria-label="نوع الاقتراحات">
          {KINDS.map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={kind === id}
              className={kind === id ? "selected" : ""}
              onClick={() => setKind(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {loading && !metas.length ? (
        <Busy text="نجيب اقتراحاتك من تراكت…" />
      ) : error ? (
        <p className="inline-warning">تعذّر جلب الاقتراحات: {error}</p>
      ) : !metas.length ? (
        <p className="subtle suggest-empty">
          ما عند تراكت اقتراحات بعد. قيّم أو شاهد أعمالاً أكثر وارجع لاحقاً.
        </p>
      ) : (
        <ScrollRow className="poster-row">
          {metas.map((m) => (
            <div className="suggest-card" key={m.id}>
              <Poster meta={m} onOpen={onOpen} />
              <button
                className="suggest-hide"
                title="مو مهتم"
                aria-label={`مو مهتم بـ ${m.name}`}
                onClick={async () => {
                  try {
                    await call("traktHideSuggestion", { kind, id: m.id });
                    setLists((was) => ({
                      ...was,
                      [kind]: (was[kind] || []).filter((x) => x.id !== m.id),
                    }));
                    notice?.(`لن يقترح تراكت «${m.name}» بعد الآن`);
                  } catch (e) {
                    notice?.(e.message);
                  }
                }}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </ScrollRow>
      )}
    </section>
  );
}

export default memo(TraktSuggestions);
