import React, { useEffect, useRef, useState } from "react";
import {
  ambientOptions,
  artOfElement,
  layerStyle,
} from "../../core/ambient.mjs";

/**
 * The artwork glow behind the app. It follows the title under the pointer
 * (or keyboard focus) when the viewer asks, and otherwise the hero or the
 * open title page. Cards offer their picture through `data-ambient`
 * attributes, read here by one delegated listener, so hovering never
 * re-renders the app or its rows. Two layers crossfade; a picture is loaded
 * before it is shown, so the glow never flashes empty.
 */
export default function AmbientLayer({ appearance, fallback, reduceMotion }) {
  const options = ambientOptions(appearance);
  if (reduceMotion) options.fade = 0;
  const [layers, setLayers] = useState([fallback || "", ""]);
  const [front, setFront] = useState(0);
  const hovered = useRef("");
  const shown = useRef(fallback || "");
  const timer = useRef(0);
  const live = useRef({});
  live.current = { options, fallback, front };

  // Shows a picture once it has loaded, on the layer that is hidden now.
  const show = (url) => {
    if (!url || url === shown.current) return;
    shown.current = url;
    const picture = new Image();
    picture.onload = () => {
      if (shown.current !== url) return;
      const back = 1 - live.current.front;
      setLayers((was) => {
        const next = [...was];
        next[back] = url;
        return next;
      });
      setFront(back);
    };
    picture.src = url;
  };

  // The hero turned or a title opened: follow it unless a card holds the glow.
  useEffect(() => {
    if (!hovered.current || options.follow === "hero") show(fallback);
  }, [fallback, options.follow]);

  useEffect(() => {
    if (options.follow !== "hover") {
      hovered.current = "";
      return;
    }
    const aim = (target) => {
      const { options: o, fallback: home } = live.current;
      const card = target?.closest?.("[data-ambient],[data-ambient-poster]");
      const url = card ? artOfElement(card, o.image) : "";
      if (url === hovered.current && (url || o.leave === "stay")) return;
      clearTimeout(timer.current);
      if (!url) {
        if (o.leave === "stay" || !hovered.current) return;
        // Leaving the cards: back to the hero after a short pause, so moving
        // between two cards over the gap does not flash the hero.
        timer.current = setTimeout(() => {
          hovered.current = "";
          show(live.current.fallback || home);
        }, o.delay + 200);
        return;
      }
      timer.current = setTimeout(() => {
        hovered.current = url;
        show(url);
      }, o.delay);
    };
    const onOver = (e) => aim(e.target);
    const onFocus = (e) => aim(e.target);
    document.addEventListener("pointerover", onOver, { passive: true });
    document.addEventListener("focusin", onFocus);
    return () => {
      clearTimeout(timer.current);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("focusin", onFocus);
    };
  }, [options.follow]);

  return (
    <div className="ambience-stack" aria-hidden="true">
      {layers.map((url, i) => (
        <div
          key={i}
          className="ambience-layer"
          style={layerStyle(url, options, i === front && !!url)}
        />
      ))}
    </div>
  );
}
