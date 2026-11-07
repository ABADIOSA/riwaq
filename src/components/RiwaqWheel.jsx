import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Lock } from "lucide-react";
import {
  WHEEL,
  rimPath,
  wheelAngle,
  wheelKey,
  wheelLayout,
  wheelSlot,
} from "../../core/wheel.mjs";

/*
 * Riwaq's wheel (core/wheel.mjs has the geometry and the reasons). The
 * destinations sit on the rim of a wheel whose hub lies beyond the window's
 * side edge. The buttons move along the arc and stay upright. The <nav>
 * holds them in a stable order for Tab and screen readers.
 *
 * Arrow Up and Down move between destinations, Home and End go to the first
 * and last; Tab still walks through everything. A wheel gesture or drag
 * brings a button to the lens; click, Enter or Space opens its page.
 */
const TICK_EVERY = 4;
const SCROLL_STEP = 48;
const DRAG_THRESHOLD = 8;
const LENS_SIZE = 56;
const wrap = (index, count) => ((index % count) + count) % count;

export default function RiwaqWheel({
  items,
  open,
  rtl,
  navId,
  label = "التنقل الرئيسي",
}) {
  const nav = useRef(null);
  const buttons = useRef([]);
  const drag = useRef(null);
  const dragged = useRef(false);
  const lastClick = useRef(null);
  const previousSlots = useRef(new Map());
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [dragOffset, setDragOffset] = useState(null);
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
  const activeId = items[active]?.id;
  const [cursorId, setCursorId] = useState(activeId);
  const focused = items.findIndex((item) => item.id === cursorId);
  const cursor = focused < 0 ? Math.max(0, active) : focused;
  const count = items.length;
  const slots = items.map((_, index) =>
    wheelSlot(index, cursor, count, dragOffset ?? 0),
  );
  const wrapped = items.map((item, index) => {
    const previous = previousSlots.current.get(item.id);
    return (
      previous !== undefined && Math.abs(previous - slots[index]) > count / 2
    );
  });
  useLayoutEffect(() => {
    previousSlots.current = new Map(
      items.map(({ id }, index) => [id, slots[index]]),
    );
  });
  useLayoutEffect(() => {
    if (activeId) setCursorId(activeId);
  }, [activeId]);
  // The stage may be wider than the wheel (the narrow drawer).
  const width = Math.max(WHEEL[layout.mode], size.width || 0);
  const scrolling = layout.height > height + 1;
  // Drawn once the stage is measured, and turning only after that first
  // frame: the measured layout must not animate in from a guessed one.
  const measured = height > 0;
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!measured || ready) return;
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, [measured, ready]);
  const anchor = layout.items[Math.floor((layout.items.length - 1) / 2)];
  useLayoutEffect(() => {
    if (scrolling) nav.current.scrollTop = anchor.y - height / 2;
  }, [anchor.y, cursor, height, scrolling]);

  const focusItem = useCallback((index) => {
    const button = buttons.current[index];
    if (!button) return;
    setCursorId(button.dataset.wheelId);
    button.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const stage = nav.current;
    if (!measured || count < 2) return;
    let pending = 0;
    let last = 0;
    const rotate = (event) => {
      const mode = event.deltaMode;
      const y = event.deltaY;
      if (event.ctrlKey || !y) return;
      event.preventDefault();
      if (drag.current) return;
      const unit =
        mode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : mode === WheelEvent.DOM_DELTA_PAGE
            ? SCROLL_STEP
            : 1;
      const delta = y * unit;
      if (event.timeStamp - last > 180 || pending * delta < 0) pending = 0;
      last = event.timeStamp;
      pending += delta;
      if (Math.abs(pending) < SCROLL_STEP) return;
      focusItem(wrap(cursor + Math.sign(pending), count));
      pending = 0;
    };
    stage.addEventListener("wheel", rotate, { passive: false });
    return () => stage.removeEventListener("wheel", rotate);
  }, [count, cursor, focusItem, measured]);
  // Physical x for SVG and the lens; the buttons use logical insets.
  const px = (x) => (rtl ? width - x : x);
  const hub = { x: px(layout.hub.x), y: layout.hub.y };
  // The rim's ticks as two paths (minor, major), only around the visible arc.
  const ticks = useMemo(() => {
    const span = Math.abs(layout.items[0]?.angle || 0);
    const reach = Math.ceil((span + 12) / TICK_EVERY) * TICK_EVERY;
    const facing = rtl ? 180 : 0;
    let minor = "";
    let major = "";
    for (let off = -reach; off <= reach; off += TICK_EVERY) {
      const r = ((facing + off) * Math.PI) / 180;
      const long = off % (TICK_EVERY * 5) === 0;
      const inner = layout.radius + (long ? 9 : 12);
      const outer = layout.radius + 16;
      const seg = `M${(hub.x + Math.cos(r) * inner).toFixed(1)} ${(hub.y + Math.sin(r) * inner).toFixed(1)}L${(hub.x + Math.cos(r) * outer).toFixed(1)} ${(hub.y + Math.sin(r) * outer).toFixed(1)}`;
      if (long) major += seg;
      else minor += seg;
    }
    return (
      <>
        <path d={minor} />
        <path className="major" d={major} />
      </>
    );
  }, [layout.radius, layout.items, hub.x, hub.y, rtl]);
  const inset = WHEEL.apex[layout.mode] - WHEEL.item / 2;
  const onKeyDown = (e) => {
    const index = buttons.current.indexOf(document.activeElement);
    if (index < 0) return;
    const next = wheelKey(e.key, index, items.length);
    if (next === null) return;
    e.preventDefault();
    focusItem(next);
  };
  const startDrag = (event) => {
    if (event.button !== 0 || !event.isPrimary || count < 2) return;
    dragged.current = false;
    drag.current = { id: event.pointerId, y: event.clientY, moved: false };
  };
  const dragSteps = (dy) =>
    Math.max(1 - count, Math.min(count - 1, dy / layout.step));
  const moveDrag = (event) => {
    const start = drag.current;
    if (start?.id !== event.pointerId) return;
    const dy = event.clientY - start.y;
    if (!start.moved) {
      if (Math.abs(dy) < DRAG_THRESHOLD) return;
      start.moved = true;
      nav.current.setPointerCapture(event.pointerId);
    }
    setDragOffset(dragSteps(dy));
  };
  const endDrag = (event) => {
    const start = drag.current;
    if (start?.id !== event.pointerId) return;
    drag.current = null;
    if (!start.moved) return;
    dragged.current = true;
    setDragOffset(null);
    if (event.type === "pointerup") {
      const steps = Math.round(dragSteps(event.clientY - start.y));
      focusItem(wrap(cursor - steps, count));
    }
  };
  const select = (event, item) => {
    if (event.detail > 0) {
      if (dragged.current) return;
      const now = performance.now();
      const last = lastClick.current;
      if (
        last &&
        event.detail > 1 &&
        last.id !== item.id &&
        now - last.at < 350 &&
        Math.hypot(event.clientX - last.x, event.clientY - last.y) < 8
      )
        return;
      lastClick.current = {
        id: item.id,
        at: now,
        x: event.clientX,
        y: event.clientY,
      };
    }
    setCursorId(item.id);
    item.onClick();
  };
  return (
    <nav
      ref={nav}
      id={navId}
      className={`riwaq-destinations wheel-stage ${open ? "is-open" : "is-compact"} ${active < 0 ? "is-idle" : ""} ${scrolling ? "is-scrolling" : ""} ${ready ? "is-ready" : ""} ${dragOffset !== null ? "is-dragging" : ""}`}
      aria-label={label}
      onKeyDown={onKeyDown}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={(event) => {
        // Touch first captures to the button. Its lost capture during the
        // transfer to the stage must not cancel the drag.
        if (event.target === event.currentTarget) endDrag(event);
      }}
      onPointerLeave={(event) => {
        if (!drag.current?.moved) endDrag(event);
      }}
      style={{ "--wheel-radius": `${rtl ? -layout.radius : layout.radius}px` }}
    >
      {measured && (
        <>
          <svg
            className="wheel-rim"
            width={width}
            height={layout.height}
            viewBox={`0 0 ${width} ${layout.height}`}
            aria-hidden="true"
            focusable="false"
          >
            <path
              className="wheel-rim-line"
              d={rimPath(layout, { rtl, width })}
            />
            <g className="wheel-ticks">{ticks}</g>
            {layout.items.map((item, i) => {
              // A short spoke from each destination toward the hub.
              const dx = hub.x - px(item.x);
              const dy = hub.y - item.y;
              const d = Math.hypot(dx, dy) || 1;
              return (
                <line
                  key={i}
                  className={`wheel-spoke ${item === anchor ? "active" : ""}`}
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
              left: px(anchor.x) - LENS_SIZE / 2,
              top: anchor.y - LENS_SIZE / 2,
            }}
          />
          {items.map((item, i) => {
            const slot = slots[i];
            const angle = wheelAngle(layout, slot) * (rtl ? -1 : 1);
            // Fade the half slot beyond each end before it wraps.
            const opacity = Math.min(
              1,
              1 + slot * 2,
              1 + (count - 1 - slot) * 2,
            );
            const Icon = item.Icon;
            return (
              <button
                key={item.id}
                ref={(el) => (buttons.current[i] = el)}
                className={`riwaq-destination wheel-item ${item.current ? "selected" : ""} ${wrapped[i] ? "wheel-wrap" : ""}`}
                data-wheel-id={item.id}
                aria-current={item.current ? "page" : undefined}
                aria-label={item.label}
                title={item.label}
                style={{
                  insetInlineStart: `${inset}px`,
                  top: `${layout.hub.y - WHEEL.item / 2}px`,
                  "--wheel-angle": `${angle}deg`,
                  opacity,
                  // Open, a destination reaches to the rail's far side with its
                  // name: the whole line is its target.
                  width: open
                    ? `${Math.max(WHEEL.item, width - inset - 10)}px`
                    : undefined,
                }}
                onFocus={() => {
                  // Pointer focus happens before a click. Keep the hit
                  // target still until the press finishes.
                  if (!drag.current) setCursorId(item.id);
                }}
                onClick={(event) => select(event, item)}
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
        </>
      )}
    </nav>
  );
}
