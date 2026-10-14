import React, { useEffect, useRef, useState } from "react";
import {
  VOLUME_MAIN_SHARE,
  volumeAt,
  volumeRatio,
} from "../../core/player-tuning.mjs";

/**
 * The player's volume slider (issue #82). It reads full at 100%, with a
 * shorter boost part after it when the maximum is higher. It follows the
 * pointer itself (pointer capture) and moves at once while MPV catches up:
 * the native range in the HUD's window, bound to the volume MPV reported,
 * felt stuck.
 */
const SEND_MS = 60;
const SETTLE_MS = 800;

export default function VolumeSlider({
  volume = 0,
  max = 150,
  muted = false,
  onChange,
  label = "مستوى الصوت",
}) {
  const [local, setLocal] = useState(null);
  const track = useRef(null);
  const dragging = useRef(false);
  const sent = useRef({ at: 0, timer: null, value: 0 });
  const settle = useRef(null);
  const top = Math.max(1, Number(max) || 100);
  const shown = local ?? Math.max(0, Math.min(top, Number(volume) || 0));
  const ratio = volumeRatio(shown, top);
  const boost = top > 100;

  useEffect(
    () => () => {
      clearTimeout(sent.current.timer);
      clearTimeout(settle.current);
    },
    [],
  );
  // Once MPV reports what the pointer chose, the slider follows MPV again.
  useEffect(() => {
    if (local !== null && !dragging.current && Math.round(volume) === local)
      setLocal(null);
  }, [volume, local]);

  const send = (value) => {
    const s = sent.current;
    s.value = value;
    clearTimeout(s.timer);
    const wait = SEND_MS - (Date.now() - s.at);
    const go = () => {
      s.at = Date.now();
      onChange?.(s.value);
    };
    if (wait <= 0) go();
    else s.timer = setTimeout(go, wait);
  };
  const choose = (value) => {
    clearTimeout(settle.current);
    setLocal(value);
    send(value);
  };
  const release = () => {
    clearTimeout(settle.current);
    settle.current = setTimeout(() => setLocal(null), SETTLE_MS);
  };
  const at = (e) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect?.width) return shown;
    return volumeAt((e.clientX - rect.left) / rect.width, top);
  };
  const down = (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragging.current = true;
    choose(at(e));
  };
  const move = (e) => {
    if (dragging.current) choose(at(e));
  };
  const up = (e) => {
    if (!dragging.current) return;
    dragging.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    release();
  };
  const key = (e) => {
    const step = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5 }[
      e.key
    ];
    if (!step) return;
    e.preventDefault();
    e.stopPropagation();
    choose(Math.max(0, Math.min(top, Math.round(shown) + step)));
    release();
  };

  const main = Math.min(ratio, boost ? VOLUME_MAIN_SHARE : 1);
  return (
    <div
      className={`volume-control${muted ? " muted" : ""}`}
      dir="ltr"
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={top}
      aria-valuenow={Math.round(shown)}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={key}
    >
      <div className="volume-track" ref={track}>
        {boost && (
          <i
            className="volume-boost-zone"
            style={{ insetInlineStart: `${VOLUME_MAIN_SHARE * 100}%` }}
          />
        )}
        <i className="volume-fill" style={{ width: `${main * 100}%` }} />
        {boost && ratio > VOLUME_MAIN_SHARE && (
          <i
            className="volume-fill boost"
            style={{
              insetInlineStart: `${VOLUME_MAIN_SHARE * 100}%`,
              width: `${(ratio - VOLUME_MAIN_SHARE) * 100}%`,
            }}
          />
        )}
        <i
          className="volume-knob"
          style={{ insetInlineStart: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}
