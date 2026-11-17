import React, { useEffect, useId, useMemo, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import {
  UNKNOWN,
  chosenFacets,
  facetCount,
  facetPanel,
  toggleFacet,
} from "../../core/source-facets.mjs";

/**
 * The source picker's advanced filters (issue #154, core/source-facets.mjs):
 * a button that opens the groups, the chosen values as removable pills, and
 * "Clear all". Everything works on the list already loaded; nothing is asked
 * of the addons again. Each value is a toggle button with its count; groups
 * are fieldsets, so a screen reader hears "Dolby Vision, 3, pressed" inside
 * "Dynamic range".
 */
export default function SourceFacets({
  streams,
  chosen,
  onChange,
  remember = false,
  onRemember,
}) {
  const [open, setOpen] = useState(() => facetCount(chosen) > 0);
  // The box answers at once; the profile's setting follows.
  const [keep, setKeep] = useState(!!remember);
  useEffect(() => setKeep(!!remember), [remember]);
  const panelId = useId();
  const panel = useMemo(() => facetPanel(streams, chosen), [streams, chosen]);
  const picked = useMemo(
    () => chosenFacets(chosen, streams),
    [chosen, streams],
  );
  const count = facetCount(chosen);
  if (!panel.length && !count) return null;
  return (
    <div className="source-facets">
      <div className="source-facets-bar">
        <button
          type="button"
          className={`facet-toggle ${open ? "open" : ""}`}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen(!open)}
        >
          <SlidersHorizontal size={15} aria-hidden="true" />
          <span>فلاتر متقدمة</span>
          {count > 0 && <bdi className="facet-badge">{count}</bdi>}
        </button>
        {picked.map((f) => (
          <button
            type="button"
            key={`${f.group}:${f.value}`}
            className="facet-pill"
            aria-label={`إزالة الفلتر: ${f.label}`}
            title="إزالة الفلتر"
            onClick={() => onChange(toggleFacet(chosen, f.group, f.value))}
          >
            <span dir="auto">{f.label}</span>
            <X size={13} aria-hidden="true" />
          </button>
        ))}
        {count > 0 && (
          <button
            type="button"
            className="text-button facet-clear"
            onClick={() => onChange({})}
          >
            مسح الكل
          </button>
        )}
      </div>
      {open && (
        <div className="facet-panel" id={panelId}>
          {panel.map((group) => (
            <fieldset className="facet-group" key={group.id}>
              <legend>{group.title}</legend>
              <div className="facet-values">
                {group.values.map((v) => (
                  <button
                    type="button"
                    key={v.id}
                    className={`facet ${v.chosen ? "chosen" : ""} ${v.id === UNKNOWN ? "unknown" : ""}`}
                    aria-pressed={v.chosen}
                    disabled={!v.count && !v.chosen}
                    title={
                      v.id === UNKNOWN
                        ? "مصادر لا يذكر وصفها شيئاً عن هذا"
                        : undefined
                    }
                    onClick={() =>
                      onChange(toggleFacet(chosen, group.id, v.id))
                    }
                  >
                    <span dir="auto">{v.label}</span>
                    <bdi className="facet-count">{v.count}</bdi>
                  </button>
                ))}
              </div>
            </fieldset>
          ))}
          {onRemember && (
            <label className="facet-remember">
              <input
                type="checkbox"
                checked={keep}
                onChange={(e) => {
                  setKeep(e.target.checked);
                  onRemember(e.target.checked);
                }}
              />
              <span>تذكّر هذه الفلاتر لملفك الشخصي</span>
            </label>
          )}
          <p className="facet-note">
            «غير مذكور»: المصدر لا يذكر شيئاً عن ذلك، ولا يعني أنه بلا الميزة.
            الفلاتر تعرض فقط، ولا تغيّر ترتيب رِواق ولا التشغيل التلقائي.
          </p>
        </div>
      )}
    </div>
  );
}
