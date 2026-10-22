import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Check, Folders, ListPlus, LoaderCircle, Plus } from "lucide-react";
import { createPortal } from "react-dom";
import { PosterActionsContext } from "../lib/poster-actions.js";
import { WatchedContext } from "../lib/watched.js";
import { call } from "../lib/api.js";
import { quickQueueTarget } from "../../core/quick-queue.mjs";
import { AddToCollection } from "./Collections.jsx";

/** One menu for every poster; cards subscribe only to the stable open callback. */
export default function PosterActions({
  children,
  state,
  update,
  notice,
  watched,
}) {
  const [menu, setMenu] = useState(null);
  const [collecting, setCollecting] = useState(null);
  const [busy, setBusy] = useState(false);
  const panel = useRef(null);
  const latest = useRef(state);
  latest.current = state;
  const request = useRef(0);
  const open = useCallback((event, meta, videoId) => {
    event.preventDefault();
    event.stopPropagation();
    const anchor = event.currentTarget;
    const rect = anchor.getBoundingClientRect();
    request.current++;
    setBusy(false);
    setMenu({
      meta,
      videoId,
      anchor,
      x: event.clientX || rect.left,
      y: event.clientY || rect.top,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    });
  }, []);
  const close = (focus = false) => {
    request.current++;
    if (focus && menu?.anchor?.isConnected)
      menu.anchor.focus({ preventScroll: true });
    setMenu(null);
    setBusy(false);
  };
  useEffect(() => {
    request.current++;
    setMenu(null);
    setCollecting(null);
    setBusy(false);
    return () => {
      request.current++;
    };
  }, [state.profiles?.active]);
  useLayoutEffect(() => {
    if (!menu || !panel.current) return;
    const el = panel.current;
    const rect = el.getBoundingClientRect();
    el.style.left = `${Math.max(8, Math.min(menu.x, innerWidth - rect.width - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(menu.y, innerHeight - rect.height - 8))}px`;
    el.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const outside = (event) => {
      if (!panel.current?.contains(event.target)) close();
    };
    const dismiss = (event) => {
      // Focusing/scrolling a poster can leave a queued scroll event from before
      // the menu opened. Only a subsequent movement should dismiss it.
      if (
        event.type === "scroll" &&
        event.target === document &&
        window.scrollX === menu.scrollX &&
        window.scrollY === menu.scrollY
      )
        return;
      if (!panel.current?.contains(event.target)) close();
    };
    const key = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      } else if (event.key === "Tab") close(true);
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("keydown", key, true);
    };
  }, [menu]);
  const saved =
    menu &&
    state.favorites?.some(
      (m) => m.id === menu.meta.id && m.type === menu.meta.type,
    );
  const addQueue = async () => {
    const generation = ++request.current;
    const profileId = state.profiles?.active;
    setBusy(true);
    try {
      const meta =
        menu.meta.type === "movie"
          ? menu.meta
          : await call("metadata", { type: menu.meta.type, id: menu.meta.id });
      if (
        generation !== request.current ||
        latest.current.profiles?.active !== profileId
      )
        return;
      const target = quickQueueTarget(
        meta,
        latest.current.progress,
        menu.videoId,
      );
      if (!target) throw new Error("لا توجد حلقة متاحة لإضافتها إلى الطابور");
      const result = await update("queueEdit", {
        action: "add",
        meta,
        ...target,
        profileId,
      });
      if (generation !== request.current) return;
      if (result) {
        notice("أضيف إلى طابور المشاهدة في مكتبتي");
        close(true);
      }
    } catch (error) {
      if (generation === request.current) notice(error.message);
    } finally {
      if (generation === request.current) setBusy(false);
    }
  };
  return (
    <PosterActionsContext.Provider value={open}>
      <WatchedContext.Provider value={watched}>
        {children}
      </WatchedContext.Provider>
      {menu &&
        createPortal(
          <div
            ref={panel}
            className="poster-actions"
            role="menu"
            aria-label="إجراءات العمل"
            aria-busy={busy}
            onContextMenu={(e) => e.preventDefault()}
            onKeyDown={(e) => {
              if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key))
                return;
              e.preventDefault();
              e.stopPropagation();
              const buttons = [
                ...panel.current.querySelectorAll("button:not(:disabled)"),
              ];
              const at = buttons.indexOf(document.activeElement);
              const next =
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? buttons.length - 1
                    : (at + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
                      buttons.length;
              buttons[next]?.focus();
            }}
          >
            <strong dir="auto">{menu.meta.name}</strong>
            <button
              role="menuitem"
              disabled={busy || saved}
              onClick={async () => {
                const generation = ++request.current;
                setBusy(true);
                const result = await update("favorite", menu.meta);
                if (generation !== request.current) return;
                if (result) close(true);
                else setBusy(false);
              }}
            >
              {saved ? <Check size={17} /> : <Plus size={17} />}
              {saved ? "في مكتبتي" : "أضف إلى مكتبتي"}
            </button>
            <button
              role="menuitem"
              disabled={busy}
              onClick={() => {
                setCollecting(menu);
                close();
              }}
            >
              <Folders size={17} />
              أضف لمجموعة
            </button>
            <button role="menuitem" disabled={busy} onClick={addQueue}>
              {busy ? (
                <LoaderCircle size={17} className="spin" />
              ) : (
                <ListPlus size={17} />
              )}
              أضف إلى الطابور
            </button>
          </div>,
          menu.anchor.closest("dialog[open], .app") || document.body,
        )}
      {collecting &&
        createPortal(
          <AddToCollection
            meta={collecting.meta}
            state={state}
            update={update}
            onClose={() => {
              collecting.anchor?.focus({ preventScroll: true });
              setCollecting(null);
            }}
          />,
          collecting.anchor.closest(".app") || document.body,
        )}
    </PosterActionsContext.Provider>
  );
}
