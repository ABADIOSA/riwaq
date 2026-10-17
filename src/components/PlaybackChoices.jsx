import React, { useEffect, useRef } from "react";
import { Gauge, Proportions } from "lucide-react";

const FIELDS = [
  [
    "speed",
    "سرعة التشغيل",
    Gauge,
    [
      [0.5, "0.5×"],
      [0.75, "0.75×"],
      [1, "1×"],
      [1.25, "1.25×"],
      [1.5, "1.5×"],
      [2, "2×"],
    ],
  ],
  [
    "aspect",
    "نسبة الأبعاد",
    Proportions,
    [
      [-1, "تلقائي"],
      ["16:9", "16:9"],
      ["4:3", "4:3"],
      ["2.35:1", "2.35:1"],
    ],
  ],
];

/** Small HTML pickers shared by the native HUD and web/theater controls. */
export default function PlaybackChoices({ player, act, open, setOpen }) {
  const root = useRef(null);
  useEffect(() => {
    setOpen(null);
  }, [player.videoId, player.active]);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(null);
    const outside = (e) => {
      if (!root.current?.contains(e.target)) close();
    };
    const key = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        close();
        root.current?.querySelector(`[data-choice="${open}"]`)?.focus();
      }
      if (
        ["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key) &&
        root.current?.contains(e.target)
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const buttons = [
          ...root.current.querySelectorAll('[role="menuitemradio"]'),
        ];
        const index = buttons.indexOf(document.activeElement);
        const next =
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? buttons.length - 1
              : (index + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
                buttons.length;
        buttons[next]?.focus();
      }
    };
    const frame = requestAnimationFrame(() =>
      (
        root.current?.querySelector(
          '[role="menuitemradio"][aria-checked="true"]',
        ) || root.current?.querySelector('[role="menuitemradio"]')
      )?.focus(),
    );
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", close);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", close);
    };
  }, [open]);
  return (
    <div className="playback-choices" ref={root}>
      {FIELDS.map(([id, label, Icon, values]) => {
        const selected = player[id] ?? (id === "speed" ? 1 : -1);
        const equal = (value) =>
          id === "aspect" && String(value).includes(":")
            ? Math.abs(
                Number(selected) -
                  value.split(":").reduce((a, b) => Number(a) / Number(b)),
              ) < 0.001 || selected === value
            : Number(selected) === Number(value);
        return (
          <div className="playback-choice" key={id}>
            <button
              title={label}
              data-choice={id}
              aria-haspopup="menu"
              aria-expanded={open === id}
              disabled={id === "speed" && player.live}
              onClick={() => setOpen(open === id ? null : id)}
            >
              <Icon size={19} />
            </button>
            {open === id && (
              <div
                className="playback-choice-menu"
                role="menu"
                aria-label={label}
              >
                {values.map(([value, name]) => (
                  <button
                    key={value}
                    role="menuitemradio"
                    aria-checked={equal(value)}
                    onClick={() => {
                      setOpen(null);
                      act("playerCommand", { action: id, value });
                    }}
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
