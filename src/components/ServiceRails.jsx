import React, { useEffect, useState } from "react";
import { Rail } from "./UI.jsx";
import { call } from "../lib/api.js";
import { withoutWatched } from "../../core/library.mjs";

/**
 * Home rows for the streaming services the viewer pays for: what is popular
 * on each, from TMDB with their own key. Nothing shows until services are
 * chosen in Settings.
 */
export default function ServiceRails({ state, watched, onOpen, onSettings }) {
  const chosen = state.settings.streamingServices || [];
  const signature = chosen.map((s) => s.id).join(",");
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!chosen.length) return setData(null);
    let live = true;
    call("serviceRows")
      .then((r) => live && setData(r))
      .catch(() => live && setData({ rows: [], needs: [] }));
    return () => {
      live = false;
    };
  }, [
    signature,
    state.settings.region,
    state.providers?.find?.((p) => p.id === "tmdb")?.configured,
  ]);
  if (!chosen.length || !data) return null;
  if (data.needs?.includes("tmdb"))
    return (
      <div className="folder-needs service-needs">
        <p>صفوف خدماتك للبث تحتاج مفتاح TMDB مجانياً.</p>
        <button className="primary small" onClick={() => onSettings("data")}>
          أضف مفتاح TMDB
        </button>
      </div>
    );
  return data.rows.map((row) => {
    const metas = withoutWatched(row.metas, watched);
    return metas.length ? (
      <Rail
        key={row.key}
        title={
          <span className="service-title">
            {row.logo && <img src={row.logo} alt="" />}
            الأشهر على {row.name}
          </span>
        }
        subtitle="من TMDB حسب منطقتك"
        metas={metas}
        onOpen={onOpen}
      />
    ) : null;
  });
}
