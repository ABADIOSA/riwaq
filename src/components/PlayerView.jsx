import React, { useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  Maximize,
  Minimize2,
  X,
  SlidersHorizontal,
  Volume2,
  RotateCcw,
  RotateCw,
  Subtitles,
  SkipForward,
  SkipBack,
  Camera,
  Repeat,
  Moon,
  Activity,
  Radio,
} from "lucide-react";
import { IconButton } from "./UI.jsx";
import PlayerDock from "./PlayerDock.jsx";
import { clock } from "../lib/helpers.js";
import { call } from "../lib/api.js";
import { seekAmount } from "../../core/hotkeys.mjs";

export default function PlayerView({
  player,
  state,
  act,
  hidden,
  onSettings,
  onAdvance,
  update,
  dockRequest,
  onEpisode,
}) {
  const surface = useRef(),
    [dock, setDock] = useState(null),
    [still, setStill] = useState(false),
    stillTimer = useRef();
  const mini = player.pip,
    // Full screen gives the whole window to the picture; MPV's own controller
    // draws over it, because HTML cannot paint above the native surface.
    immersive = !!player.fullscreen && !mini,
    // The HUD window draws the controls over the picture; the theater then
    // only gives the whole window to the video.
    hudMode = !!player.overlay && !mini,
    command = (action, value) => act("playerCommand", { action, value });
  const series = player.mediaType === "series";
  const sleepLeft = player.sleepAt
    ? Math.max(0, Math.round((player.sleepAt - Date.now()) / 60000))
    : 0;
  useEffect(() => {
    let pending;
    const report = () => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => {
        const r = surface.current?.getBoundingClientRect();
        if (r)
          call("videoBounds", {
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            viewportWidth: window.innerWidth,
            visible: !hidden,
          }).catch(() => {});
      });
    };
    const observer = new ResizeObserver(report);
    if (surface.current) observer.observe(surface.current);
    window.addEventListener("resize", report);
    report();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(pending);
      window.removeEventListener("resize", report);
      call("videoBounds", { visible: false }).catch(() => {});
    };
  }, [mini, hidden, immersive, hudMode, !!dock]);
  useEffect(() => {
    const onKey = (e) => {
      if (hidden || ["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName))
        return;
      if (e.code === "Space") {
        e.preventDefault();
        command("pause");
      }
      if (e.key.toLowerCase() === "f") command("fullscreen");
      if (e.key.toLowerCase() === "c" && !mini) {
        if (hudMode) call("hudPanel").catch(() => {});
        else setDock((open) => (open ? null : "subs"));
      }
      if (e.key === "Escape" && player.fullscreen) {
        e.preventDefault();
        command("exitFullscreen");
      }
      // The same steps as MPV's own keys (core/hotkeys.mjs seekAmount).
      if (e.key === "ArrowRight" || e.key === "ArrowLeft")
        command(
          "seekBy",
          seekAmount(
            `${e.key === "ArrowRight" ? "forward" : "back"}${e.shiftKey ? "Long" : ""}`,
            state.settings,
          ),
        );
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    player.position,
    player.fullscreen,
    player.overlay,
    hidden,
    state.settings.seekStep,
    state.settings.seekLongStep,
  ]);
  // A right click or C inside MPV asks for the panel; the mini player has none.
  useEffect(() => {
    if (dockRequest && !mini) setDock((open) => (open ? null : "subs"));
  }, [dockRequest]);
  useEffect(() => {
    if (mini) setDock(null);
  }, [mini]);
  return (
    <section
      onMouseMove={() => {
        // Without the HUD, the page still hides the pointer when the picture
        // is the thing under it and the pointer has been still.
        setStill(false);
        clearTimeout(stillTimer.current);
        stillTimer.current = setTimeout(() => setStill(true), 2500);
      }}
      className={`theater ${still && !mini ? "pointer-still" : ""} ${mini ? "mini-theater" : ""} ${immersive || hudMode ? "immersive" : ""} ${dock && !hudMode ? "docked" : ""}`}
      aria-label="المشغل المدمج"
    >
      <header className="theater-header">
        <div>
          <span className="eyebrow">RIWAQ CINEMA</span>
          <h2 dir="auto">{player.name}</h2>
        </div>
        <div className="button-row">
          <IconButton
            title={mini ? "تكبير المشغل" : "تصغير ومتابعة التصفح"}
            onClick={() => command("pip")}
          >
            <Minimize2 size={19} />
          </IconButton>
          <IconButton title="إيقاف المشاهدة" onClick={() => act("stop")}>
            <X size={20} />
          </IconButton>
        </div>
      </header>
      <div className="video-surface" ref={surface}>
        {player.loading && (
          <span className="video-loading">جاري تجهيز المشاهدة…</span>
        )}
        {player.error && <p>{player.error}</p>}
        {player.skip && !player.skip.hidden && !hidden && (
          <button
            className="skip-segment"
            onClick={() => command("skipSegment")}
          >
            <SkipForward size={16} /> {player.skip.label}
            <small>{player.skip.remaining} ث</small>
          </button>
        )}
        {player.stats && !hidden && (
          <dl className="player-stats" dir="ltr">
            <div>
              <dt>Resolution</dt>
              <dd>
                {player.width || "?"}×{player.height || "?"}
                {player.fps ? ` @ ${Number(player.fps).toFixed(2)}` : ""}
              </dd>
            </div>
            <div>
              <dt>Decoder</dt>
              <dd>{player.decoder || "sw"}</dd>
            </div>
            <div>
              <dt>Bitrate</dt>
              <dd>
                {player.videoBitrate
                  ? `${Math.round(player.videoBitrate / 1000)} kbps`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>Buffer</dt>
              <dd>
                {player.bufferedUntil
                  ? `${Math.max(0, Math.round(player.bufferedUntil - (player.position || 0)))}s`
                  : "—"}
                {player.buffering ? ` (${player.buffering}%)` : ""}
              </dd>
            </div>
            <div>
              <dt>Picture</dt>
              <dd>{player.shader || "none"}</dd>
            </div>
          </dl>
        )}
      </div>
      {dock && !hudMode && (
        <PlayerDock
          player={player}
          state={state}
          act={act}
          update={update}
          tab={dock}
          setTab={setDock}
          onEpisode={onEpisode}
          onClose={() => setDock(null)}
        />
      )}
      <div className="theater-controls">
        <div className="seek-line" dir="ltr">
          <span>{player.live ? "مباشر" : clock(player.position)}</span>
          <span className="seek-track">
            <input
              type="range"
              aria-label="موضع التشغيل"
              min="0"
              max={player.duration || 1}
              step="1"
              disabled={!!player.live}
              value={Math.min(player.position || 0, player.duration || 1)}
              onChange={(e) => command("seek", Number(e.target.value))}
            />
            {player.duration > 0 &&
              (player.segments || []).map((segment, index) => (
                <i
                  key={index}
                  className={`seek-marker ${segment.kind}`}
                  style={{
                    insetInlineStart: `${(segment.start / player.duration) * 100}%`,
                    width: `${((segment.end - segment.start) / player.duration) * 100}%`,
                  }}
                />
              ))}
            {player.abLoop && player.duration > 0 && (
              <i
                className="seek-loop"
                style={{
                  insetInlineStart: `${(player.abLoop.a / player.duration) * 100}%`,
                  width: `${(((player.abLoop.b ?? player.position) - player.abLoop.a) / player.duration) * 100}%`,
                }}
              />
            )}
          </span>
          <span>
            {player.live ? <Radio size={14} /> : clock(player.duration)}
          </span>
          {!player.live && player.duration > 0 && (
            <small className="ends-at" dir="rtl">
              ينتهي{" "}
              {new Intl.DateTimeFormat("ar-SA", {
                hour: "numeric",
                minute: "2-digit",
                calendar: "gregory",
                numberingSystem: "latn",
              }).format(
                Date.now() +
                  ((player.duration - (player.position || 0)) /
                    (player.speed || 1)) *
                    1000,
              )}
            </small>
          )}
        </div>
        <div className="theater-actions">
          <div className="button-row">
            <IconButton
              title="إيقاف مؤقت أو تشغيل"
              onClick={() => command("pause")}
            >
              {player.pause ? (
                <Play fill="currentColor" />
              ) : (
                <Pause fill="currentColor" />
              )}
            </IconButton>
            {!mini && series && (
              <IconButton
                title="الحلقة السابقة"
                onClick={() => onAdvance?.(-1)}
              >
                <SkipBack size={19} />
              </IconButton>
            )}
            {!mini && (
              <>
                <IconButton
                  title="رجوع"
                  onClick={() =>
                    command(
                      "seek",
                      (player.position || 0) - state.settings.seekStep,
                    )
                  }
                >
                  <RotateCcw size={20} />
                </IconButton>
                <IconButton
                  title="تقديم"
                  onClick={() =>
                    command(
                      "seek",
                      (player.position || 0) + state.settings.seekStep,
                    )
                  }
                >
                  <RotateCw size={20} />
                </IconButton>
                <Volume2 size={19} />
                <input
                  className="volume-slider"
                  aria-label="مستوى الصوت المدمج"
                  type="range"
                  min="0"
                  max={player.volumeMax || 150}
                  value={player.volume || 0}
                  onChange={(e) => command("volume", Number(e.target.value))}
                />
                <small>{Math.round(player.volume || 0)}%</small>
              </>
            )}
            {!mini && series && (
              <IconButton title="الحلقة التالية" onClick={() => onAdvance?.(1)}>
                <SkipForward size={19} />
              </IconButton>
            )}
          </div>
          <div className="button-row">
            {!mini && (
              <>
                <IconButton
                  title={
                    player.abLoop
                      ? player.abLoop.b === null
                        ? "حدّد نهاية التكرار"
                        : "إلغاء التكرار"
                      : "تكرار مقطع A/B"
                  }
                  className={player.abLoop ? "icon-button on" : "icon-button"}
                  onClick={() => command("abLoop", player.position)}
                >
                  <Repeat size={19} />
                </IconButton>
                <IconButton
                  title={
                    sleepLeft ? `إيقاف بعد ${sleepLeft} دقيقة` : "مؤقّت النوم"
                  }
                  className={sleepLeft ? "icon-button on" : "icon-button"}
                  onClick={() => command("sleep", sleepLeft ? 0 : 30)}
                >
                  <Moon size={19} />
                </IconButton>
                <IconButton
                  title="التقاط صورة"
                  onClick={async () => {
                    await command("screenshot");
                    await act("openScreenshots");
                  }}
                >
                  <Camera size={19} />
                </IconButton>
                <IconButton
                  title="إحصائيات التشغيل"
                  className={player.stats ? "icon-button on" : "icon-button"}
                  onClick={() => command("stats")}
                >
                  <Activity size={19} />
                </IconButton>
              </>
            )}
            <IconButton
              title="الترجمة والصوت (C)"
              className={dock ? "icon-button on" : "icon-button"}
              onClick={() => setDock(dock ? null : "subs")}
            >
              <Subtitles size={20} />
            </IconButton>
            <IconButton title="إعدادات المشغل" onClick={onSettings}>
              <SlidersHorizontal size={20} />
            </IconButton>
            <IconButton
              title={player.fullscreen ? "الخروج من ملء الشاشة" : "ملء الشاشة"}
              onClick={() => command("fullscreen")}
            >
              <Maximize size={20} />
            </IconButton>
          </div>
        </div>
      </div>
    </section>
  );
}
