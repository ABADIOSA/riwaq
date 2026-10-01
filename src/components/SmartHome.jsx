import React, { memo, useMemo, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { blendRows, groupRows } from "../../core/smart-groups.mjs";
import { arabicCount, CATALOGS } from "../../core/arabic.mjs";
import { Rail, ScrollRow } from "./UI.jsx";

const rowLabel = (row) => (row.name === "Popular" ? "الأكثر شعبية" : row.name);

/**
 * Riwaq's sections on home (core/smart-groups.mjs): one shelf per group of
 * addon catalogs instead of one row per catalog, so dozens of addons still
 * read as a handful of tidy shelves.
 */
export default function SmartShelves({ rows, hidden, onOpen, onMore }) {
  const groups = useMemo(() => groupRows(rows, { hidden }), [rows, hidden]);
  return groups.map((group) => (
    <SmartShelf key={group.id} group={group} onOpen={onOpen} onMore={onMore} />
  ));
}

/**
 * One group: chips for "all" and each of its catalogs above a single row.
 * "All" takes one title from each catalog in turn; a catalog's chip shows
 * that catalog and offers its full page.
 */
const SmartShelf = memo(function SmartShelf({ group, onOpen, onMore }) {
  const [pick, setPick] = useState("all");
  const row = group.rows.find((r) => r.key === pick) || null;
  const metas = useMemo(
    () => (row ? row.metas : blendRows(group.rows)),
    [row, group.rows],
  );
  const names = group.rows.map(rowLabel);
  const label = (r, i) =>
    names.indexOf(names[i]) !== names.lastIndexOf(names[i])
      ? `${names[i]} · ${r.provider}`
      : names[i];
  const header = (
    <div className="smart-head">
      <div className="section-heading">
        <div>
          <h2>{group.name}</h2>
          <span>
            {group.rows.length > 1
              ? `${arabicCount(group.rows.length, CATALOGS)} من إضافاتك`
              : `${rowLabel(group.rows[0])} · ${group.rows[0].provider}`}
          </span>
        </div>
        {(row || group.rows.length === 1) && (
          <button
            className="text-button"
            onClick={() => onMore(row || group.rows[0])}
          >
            عرض الكل <ChevronLeft size={16} />
          </button>
        )}
      </div>
      {group.rows.length > 1 && (
        <ScrollRow
          className="smart-chips"
          role="tablist"
          aria-label={`كتالوجات ${group.name}`}
        >
          <button
            role="tab"
            aria-selected={!row}
            className={row ? "" : "selected"}
            onClick={() => setPick("all")}
          >
            الكل
          </button>
          {group.rows.map((r, i) => (
            <button
              key={r.key}
              role="tab"
              aria-selected={row?.key === r.key}
              className={row?.key === r.key ? "selected" : ""}
              title={`${rowLabel(r)} · ${r.provider}`}
              onClick={() => setPick(r.key)}
            >
              {label(r, i)}
            </button>
          ))}
        </ScrollRow>
      )}
    </div>
  );
  return (
    <Rail
      key={row?.key || "all"}
      className={`smart-shelf group-${group.id}`}
      header={header}
      metas={metas}
      onOpen={onOpen}
    />
  );
});
