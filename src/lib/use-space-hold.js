import { useEffect, useRef, useState } from "react";
import { holdSpeed } from "../../core/hold-speed.mjs";

/** Space taps pause; holding temporarily speeds up. Native controls keep Space. */
export function useSpaceHold({
  player,
  settings,
  hotkeys,
  command,
  tap,
  enabled = true,
  blocked = () => false,
}) {
  const latest = useRef();
  latest.current = {
    player,
    settings,
    hotkeys,
    command,
    tap,
    enabled,
    blocked,
  };
  const [holding, setHolding] = useState(false);
  const gesture = useRef(null);
  if (!gesture.current)
    gesture.current = holdSpeed({
      speed: (value) => latest.current.command("speed", value),
      tap: () => latest.current.tap(),
      change: setHolding,
    });
  useEffect(() => {
    const release = (event) => {
      if (event.code !== "Space" || !gesture.current.busy) return;
      event.preventDefault();
      gesture.current.up();
    };
    const cancel = () => gesture.current.cancel();
    const visibility = () => {
      if (document.hidden) cancel();
    };
    window.addEventListener("keyup", release);
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("keyup", release);
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", visibility);
      gesture.current.cancel();
    };
  }, []);
  // A pending press must never affect a replacement video or hidden surface.
  useEffect(() => {
    gesture.current.cancel(false);
  }, [player.videoId, player.active]);
  useEffect(() => {
    if (!enabled || player.pause) gesture.current.cancel();
  }, [enabled, player.pause]);
  return {
    holding,
    busy: () => gesture.current.busy,
    down(event, binding) {
      if (event.code !== "Space") return false;
      if (gesture.current.busy) {
        event.preventDefault();
        return true;
      }
      const current = latest.current;
      const matches = current.hotkeys?.filter((key) => key.binding === "SPACE");
      if (
        binding !== "SPACE" ||
        !current.enabled ||
        !current.player.active ||
        current.blocked() ||
        matches?.at(-1)?.id !== "playPause"
      )
        return false;
      event.preventDefault();
      if (!event.repeat)
        gesture.current.down({
          rate:
            current.player.live || current.player.pause
              ? 0
              : Number(current.settings?.holdSpeed ?? 2),
          previous: () => Number(latest.current.player.speed) || 1,
        });
      return true;
    },
  };
}
