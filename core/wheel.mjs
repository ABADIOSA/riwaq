/**
 * Riwaq's wheel navigation (November 2026): the destinations sit on the rim
 * of a large wheel whose hub lies just beyond the window's side edge (right
 * in Arabic, left in English), so the visible part is the arc nearest the
 * content. The destinations rotate around the hub as the viewer brings one
 * to the wheel's middle, while text and icons stay upright.
 *
 * Geometry is in CSS pixels measured from the window's side edge (`x`) and
 * the top of the wheel's area (`y`); the component mirrors it for Arabic.
 */
export const WHEEL = {
  // The rail's width: compact (icons and the lens) or open (with names).
  compact: 92,
  open: 236,
  // A destination's hit target (and the minimum WCAG-friendly size).
  item: 44,
  // Space from one destination's centre to the next.
  minStep: 48,
  maxStep: 62,
  // Above the first and below the last destination (room for the lens).
  pad: 30,
  // How far the arc's middle reaches past its ends.
  bulge: { compact: 22, open: 34 },
  // The middle destination's centre, from the window edge.
  apex: { compact: 56, open: 62 },
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const DEG = 180 / Math.PI;

/**
 * Where `count` destinations sit in an area `height` tall. Returns the
 * wheel's radius and hub, each destination's centre and angle (degrees,
 * 0 at the middle, negative above), and the height the arc needs (more
 * than `height` only when the window is too short; the area then scrolls).
 */
export function wheelLayout({ count, height, open = false }) {
  const n = Math.max(1, Math.floor(Number(count) || 0));
  const mode = open ? "open" : "compact";
  const room = Math.max(0, (Number(height) || 0) - WHEEL.pad * 2);
  const step = n > 1 ? clamp(room / (n - 1), WHEEL.minStep, WHEEL.maxStep) : 0;
  const half = (step * (n - 1)) / 2;
  const bulge = WHEEL.bulge[mode];
  // The circle through both ends and the middle: r = (h² + s²) / 2s.
  const radius = n > 1 ? (half * half + bulge * bulge) / (2 * bulge) : 400;
  const needed = step * (n - 1) + WHEEL.pad * 2;
  const top = Math.max(WHEEL.pad, ((Number(height) || needed) - 2 * half) / 2);
  const hub = { x: WHEEL.apex[mode] - radius, y: top + half };
  const items = Array.from({ length: n }, (_, i) => {
    const y = top + i * step;
    const dy = y - hub.y;
    const x = hub.x + Math.sqrt(Math.max(0, radius * radius - dy * dy));
    return {
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      angle: Math.round(Math.asin(clamp(dy / radius, -1, 1)) * DEG * 100) / 100,
    };
  });
  return {
    mode,
    radius,
    hub,
    step,
    items,
    width: WHEEL[mode],
    height: Math.max(needed, Number(height) || 0),
  };
}

/**
 * The slot on the arc for a destination. The cursor snaps to the same
 * middle slot and the other destinations wrap through the ends. During a
 * drag, fractional offsets turn continuously until the cursor snaps.
 */
export function wheelSlot(index, cursor, count, offset = 0) {
  const anchor = Math.floor((count - 1) / 2);
  const slot = anchor + index - cursor + offset + 0.5;
  return (((slot % count) + count) % count) - 0.5;
}

/** The angle along the arc for an integer or fractional slot. */
export function wheelAngle(layout, slot) {
  const dy = (slot - (layout.items.length - 1) / 2) * layout.step;
  return Math.asin(clamp(dy / layout.radius, -1, 1)) * DEG;
}

/** The SVG path of the visible rim, from just above the first to below the last. */
export function rimPath(layout, { rtl = false, width } = {}) {
  const { hub, radius, items } = layout;
  if (!items.length) return "";
  const extra = Math.min(40, layout.step || 40);
  const y1 = items[0].y - extra;
  const y2 = items.at(-1).y + extra;
  const x = (y) =>
    hub.x + Math.sqrt(Math.max(0, radius * radius - (y - hub.y) ** 2));
  const fx = (value) => (rtl ? (width ?? layout.width) - value : value);
  const sweep = rtl ? 0 : 1;
  return `M ${fx(x(y1)).toFixed(1)} ${y1.toFixed(1)} A ${radius.toFixed(1)} ${radius.toFixed(1)} 0 0 ${sweep} ${fx(x(y2)).toFixed(1)} ${y2.toFixed(1)}`;
}

/** Arrow keys and Home/End on the wheel: which destination gets focus. */
export function wheelKey(key, index, count) {
  if (!(count > 0)) return null;
  if (key === "ArrowDown") return Math.min(count - 1, index + 1);
  if (key === "ArrowUp") return Math.max(0, index - 1);
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}
