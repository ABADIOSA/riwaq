import React, { memo, useMemo } from "react";
import { KeyRound } from "lucide-react";
import {
  NEEDS_TMDB,
  blendedSection,
  discoverTabs,
} from "../../core/discover.mjs";
import { typeName } from "../lib/helpers.js";
import { Rail, ScrollRow } from "./UI.jsx";

/**
 * Discover arranged by Riwaq (core/discover.mjs): a tab per section, Riwaq's
 * rows for that section, then the addons' titles of that section folded
 * into one row per kind. No addon or catalog name appears on this page.
 */
export default function DiscoverSections({
  tab,
  setTab,
  rows,
  tmdb,
  loading,
  onOpen,
  onMore,
  onSettings,
}) {
  const own = useMemo(() => rows.filter((r) => r.feed), [rows]);
  const addonRows = useMemo(() => rows.filter((r) => !r.feed), [rows]);
  const tabs = useMemo(
    () => discoverTabs({ tmdb, addonRows }),
    [tmdb, addonRows],
  );
  const mine = own.filter((r) => r.metas.length && (!r.tab || r.tab === tab));
  const blended = useMemo(() => {
    const shown = new Set(
      mine.flatMap((r) => r.metas.map((m) => `${m.type}:${m.id}`)),
    );
    return blendedSection(addonRows, tab, shown);
  }, [addonRows, tab, mine]);
  const tabName = tabs.find((t) => t.id === tab)?.name || "";
  // The tabs belong to the rows they switch (issue #148): one block under
  // a single separator, the tabs right above the first row's heading, with
  // no line or empty band of their own between them.
  return (
    <section className="discover-sections" aria-label="الأقسام">
      <ScrollRow
        className="filter-tabs discover-tabs"
        role="tablist"
        aria-label="الأقسام"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "selected" : ""}
            onClick={() => setTab(t.id)}
          >
            {t.name}
          </button>
        ))}
      </ScrollRow>
      {!tmdb && NEEDS_TMDB.includes(tab) && (
        <div className="discover-hint">
          <KeyRound size={18} />
          <p>
            صفوف «{tabName}» المرتّبة حسب اللغة والبلد تحتاج مفتاح TMDB. أضفه
            مرة واحدة ويمتلئ القسم.
          </p>
          <button className="text-button" onClick={() => onSettings("data")}>
            أضف المفتاح
          </button>
        </div>
      )}
      {mine.map((row, index) => (
        <DiscoverRail
          key={row.key}
          row={row}
          onOpen={onOpen}
          onMore={onMore}
          first={index === 0}
        />
      ))}
      {blended.map((row, index) => (
        <Rail
          key={row.key}
          className={!mine.length && index === 0 ? "discover-first" : ""}
          title={row.name}
          subtitle={row.subtitle}
          metas={row.metas}
          onOpen={onOpen}
          onMore={() => onMore(row)}
        />
      ))}
      {!loading && !mine.length && !blended.length && (
        <p className="subtle discover-empty">
          ما فيه أعمال في «{tabName}» الحين. جرّب قسماً آخر.
        </p>
      )}
    </section>
  );
}

/** One of Riwaq's rows: its own name, the kind of title, and its full page. */
const DiscoverRail = memo(function DiscoverRail({
  row,
  onOpen,
  onMore,
  first = false,
}) {
  return (
    <Rail
      className={first ? "discover-first" : ""}
      title={row.name}
      subtitle={typeName(row.type)}
      metas={row.metas}
      onOpen={onOpen}
      onMore={() => onMore(row)}
    />
  );
});
