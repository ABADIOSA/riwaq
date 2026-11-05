import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Lock } from "lucide-react";
import {
  WHEEL,
  rimPath,
  wheelKey,
  wheelLayout,
  wheelTurn,
} from "../../core/wheel.mjs";

/*
 * Riwaq's wheel (core/wheel.mjs has the geometry and the reasons). The
 * destinations sit on the rim of a wheel whose hub lies beyond the window's
 * side edge; choosing one turns the rim and its glass lens to it, while the
 * buttons stay where they are, upright and clickable at once. The <nav>
 * holds the buttons directly, in reading order, so Tab, screen readers and
 * the existing selectors see a plain list of destinations.
 *
 * Arrow Up and Down move between destinations, Home and End go to the first
 * and last; Tab still walks through everything.
 */
const TICK_EVERY = 4;

export default function RiwaqWheel({
  items,
  open,
  rtl,
  navId,
  label = "التنقل الرئيسي",
}) {
  const nav = useRef(null);
  const buttons = useRef([]);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const height = size.height;
  useLayoutEffect(() => {
    const el = nav.current;
    if (!el) return;
    const measure = () =>
      setSize((was) =>
        was.width === el.clientWidth && was.height === el.clientHeight
          ? was
          : { width: el.clientWidth, height: el.clientHeight },
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const layout = useMemo(
    () => wheelLayout({ count: items.length, height, open }),
    [items.length, height, open],
  );
  const active = items.findIndex((item) => item.current);
  const last = useRef(0);
  const turn = wheelTurn(layout, active, { rtl, previous: last.current });
  last.current = turn;
  // The stage may be wider than the wheel (the narrow drawer).
  const width = Math.max(WHEEL[layout.mode], size.width || 0);
  const scrolling = layout.height > height + 1;
  // Physical x for SVG and the lens; the buttons use logical insets.
  const px = (x) => (rtl ? width - x : x);
  const hub = { x: px(layout.hub.x), y: layout.hub.y };
  const ticks = useMemo(() => {
    const out = [];
    for (let deg = 0; deg < 360; deg += TICK_EVERY) {
      const r = (deg * Math.PI) / 180;
      const long = deg % (TICK_EVERY * 5) === 0;
      const inner = layout.radius + (long ? 9 : 12);
      const outer = layout.radius + 16;
      out.push(
        <line
          key={deg}
          className={long ? "major" : undefined}
          x1={hub.x + Math.cos(r) * inner}
          y1={hub.y + Math.sin(r) * inner}
          x2={hub.x + Math.cos(r) * outer}
          y2={hub.y + Math.sin(r) * outer}
        />,
      );
    }
    return out;
  }, [layout.radius, hub.x, hub.y]);
  const apex = { x: px(layout.hub.x + layout.radius), y: layout.hub.y };
  const LENS = 56;
  const onKeyDown = (e) => {
    const index = buttons.current.indexOf(document.activeElement);
    if (index < 0) return;
    const next = wheelKey(e.key, index, items.length);
    if (next === null) return;
    e.preventDefault();
    buttons.current[next]?.focus();
  };
  return (
    <nav
      ref={nav}
      id={navId}
      className={`riwaq-destinations wheel-stage ${open ? "is-open" : "is-compact"} ${active < 0 ? "is-idle" : ""} ${scrolling ? "is-scrolling" : ""}`}
      aria-label={label}
      onKeyDown={onKeyDown}
      style={{ "--wheel-height": `${layout.height}px` }}
    >
      <svg
        className="wheel-rim"
        width={width}
        height={layout.height}
        viewBox={`0 0 ${width} ${layout.height}`}
        aria-hidden="true"
        focusable="false"
      >
        <path className="wheel-rim-line" d={rimPath(layout, { rtl, width })} />
        <g
          className="wheel-ticks"
          style={{
            transform: `rotate(${turn}deg)`,
            transformOrigin: `${hub.x}px ${hub.y}px`,
          }}
        >
          {ticks}
        </g>
        {layout.items.map((item, i) => {
          // A short spoke from each destination toward the hub.
          const dx = hub.x - px(item.x);
          const dy = hub.y - item.y;
          const d = Math.hypot(dx, dy) || 1;
          return (
            <line
              key={i}
              className={`wheel-spoke ${i === active ? "active" : ""}`}
              x1={px(item.x) + (dx / d) * 25}
              y1={item.y + (dy / d) * 25}
              x2={px(item.x) + (dx / d) * 36}
              y2={item.y + (dy / d) * 36}
            />
          );
        })}
      </svg>
      <span
        className="wheel-lens"
        aria-hidden="true"
        style={{
          left: apex.x - LENS / 2,
          top: apex.y - LENS / 2,
          transform: `rotate(${turn}deg)`,
          transformOrigin: `${hub.x - (apex.x - LENS / 2)}px ${LENS / 2}px`,
        }}
      />
      {items.map((item, i) => {
        const at = layout.items[i];
        const Icon = item.Icon;
        return (
          <button
            key={item.id}
            ref={(el) => (buttons.current[i] = el)}
            className={`riwaq-destination wheel-item ${item.current ? "selected" : ""}`}
            aria-current={item.current ? "page" : undefined}
            aria-label={item.label}
            title={item.label}
            style={{
              insetInlineStart: `${at.x - WHEEL.item / 2}px`,
              top: `${at.y - WHEEL.item / 2}px`,
              // Open, a destination reaches to the rail's far side with its
              // name: the whole line is its target.
              width: open
                ? `${Math.max(WHEEL.item, width - (at.x - WHEEL.item / 2) - 10)}px`
                : undefined,
            }}
            onClick={item.onClick}
          >
            <span className="wheel-disc" aria-hidden="true">
              <Icon size={20} />
            </span>
            <span className="wheel-label">{item.label}</span>
            {item.locked && (
              <Lock size={11} className="nav-lock" aria-hidden="true" />
            )}
          </button>
        );
      })}
    </nav>
  );
}
