/**
 * Riwaq's brand in the masthead (0.57, issue #159): always Riwaq's own mark,
 * the three arches of assets/icon.svg, and its name only where the
 * navigation itself shows names.
 *
 * - The wheel open, or the straight sidebar expanded: the mark and «رِواق».
 * - The wheel compact, the sidebar collapsed, or a narrow window (the
 *   navigation folded into its drawer): the mark alone, on the axis of the
 *   navigation's icons. The open drawer carries the mark and the name.
 *
 * There is no setting for it. Before 0.57 the Logo page offered the mark
 * and name, the mark, the name, or a picture from a link (`logoStyle`,
 * `logoImage`). Those two keys stay in saved appearance, validated as
 * before and never read for drawing (core/appearance.mjs): a 0.56.0 device
 * syncing the same account, a backup and a shared theme keep their values,
 * and none of them can bring back a name-only brand, a blank one or a
 * remote picture. The same pattern as `settingsMode` and
 * `volumeOsdPosition`.
 */

/** "full" (mark and name) or "mark" for the navigation's current state. */
export function brandLayout({
  narrow = false,
  navStyle = "wheel",
  wheelOpen = false,
  sidebarCollapsed = false,
} = {}) {
  if (narrow) return "mark";
  const expanded = navStyle === "rail" ? !sidebarCollapsed : !!wheelOpen;
  return expanded ? "full" : "mark";
}

/**
 * The official mark: three arches standing on one line, the tallest first,
 * the middle one filled (assets/icon.svg, its group translated to the
 * origin). Drawn with the current colour; never mirrored in Arabic, as a
 * logo is not.
 */
export const BRAND_MARK = {
  viewBox: "-5 7 162 144",
  stroke: 9,
  arches: [
    { d: "M0 151V37a25 25 0 0 1 50 0v114", filled: false },
    { d: "M51 151V67a25 25 0 0 1 50 0v84", filled: true },
    { d: "M102 151V97a25 25 0 0 1 50 0v54", filled: false },
  ],
};
