import React from "react";
import { BRAND_MARK } from "../../core/brand.mjs";

/**
 * Riwaq's official mark (core/brand.mjs, assets/icon.svg): three arches in
 * the current colour. Decorative wherever it appears: the control or text
 * beside it carries the name for assistive technology.
 */
export default function RiwaqMark({ className = "" }) {
  return (
    <svg
      className={`riwaq-mark ${className}`.trim()}
      viewBox={BRAND_MARK.viewBox}
      aria-hidden="true"
      focusable="false"
    >
      {BRAND_MARK.arches.map(({ d, filled }) => (
        <path
          key={d}
          d={d}
          fill={filled ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth={BRAND_MARK.stroke}
        />
      ))}
    </svg>
  );
}
