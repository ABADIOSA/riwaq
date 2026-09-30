import React, { useEffect, useRef, useState } from "react";
import { imgUrl } from "../lib/helpers.js";

const EVENTS = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"];
const SLIDE_MS = 9000;

/**
 * The ambient screensaver: after the chosen idle minutes, and never while
 * something plays, Riwaq drifts through the artwork of titles on screen with
 * an optional clock. Any key, click or movement brings the app back, and
 * that first input is swallowed so it does not also press a button.
 */
export default function Screensaver({ minutes, clock, items, blocked }) {
  const [on, setOn] = useState(false);
  const [index, setIndex] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const timer = useRef();
  const showing = useRef(false);
  const art = items.filter((m) => imgUrl(m.background)).slice(0, 30);

  useEffect(() => {
    if (!minutes || blocked) {
      showing.current = false;
      setOn(false);
      return;
    }
    const arm = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        showing.current = true;
        setOn(true);
      }, minutes * 60000);
    };
    const wake = (event) => {
      if (showing.current) {
        if (event.type !== "mousemove") {
          event.preventDefault();
          event.stopPropagation();
        }
        showing.current = false;
        setOn(false);
      }
      arm();
    };
    arm();
    EVENTS.forEach((name) =>
      window.addEventListener(name, wake, { capture: true, passive: false }),
    );
    return () => {
      clearTimeout(timer.current);
      EVENTS.forEach((name) =>
        window.removeEventListener(name, wake, { capture: true }),
      );
    };
  }, [minutes, blocked]);

  useEffect(() => {
    if (!on) return;
    setIndex(Math.floor(Math.random() * Math.max(1, art.length)));
    const slides = setInterval(() => setIndex((i) => i + 1), SLIDE_MS);
    const ticks = setInterval(() => setNow(new Date()), 15000);
    setNow(new Date());
    return () => {
      clearInterval(slides);
      clearInterval(ticks);
    };
  }, [on]);

  if (!on) return null;
  const current = art.length ? art[index % art.length] : null;
  return (
    <div className="screensaver" role="presentation">
      {current && (
        <div
          key={current.id + index}
          className="screensaver-art"
          style={{ backgroundImage: `url("${imgUrl(current.background)}")` }}
        />
      )}
      <div className="screensaver-shade" />
      {clock && (
        <time className="screensaver-clock">
          {now.toLocaleTimeString("ar-SA", {
            hour: "numeric",
            minute: "2-digit",
            numberingSystem: "latn",
          })}
        </time>
      )}
      {current && (
        <div className="screensaver-title">
          <b dir="auto">{current.name}</b>
          {current.releaseInfo && <small>{current.releaseInfo}</small>}
        </div>
      )}
    </div>
  );
}
