import React, { useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Captions,
  SlidersHorizontal,
  Maximize,
  Minimize,
  Minimize2,
  X,
  Radio,
  Loader2,
} from "lucide-react";
import PlayerDock from "./PlayerDock.jsx";
import { api, call } from "../lib/api.js";
import { clock } from "../lib/helpers.js";
import { resolveAppearance } from "../../core/appearance.mjs";

// Controls fade after the pointer has been still this long, and the pointer
// hides with them. Paused playback and an open panel keep them up.
const IDLE_MS = 2500;
// A click waits this long to see whether it becomes a double click.
const CLICK_MS = 230;

const endsAt = (player) =>
  new Intl.DateTimeFormat("ar-SA", {
    hour: "numeric",
    minute: "2-digit",
    calendar: "gregory",
    numberingSystem: "latn",
  }).format(
    Date.now() +
      ((player.duration - (player.position || 0)) / (player.speed || 1)) * 1000,
  );

const episodeOf = (videoId) => {
  const parts = String(videoId || "").split(":");
  return parts.length >= 3 && Number.isInteger(Number(parts[2]))
    ? `الموسم ${Number(parts[1])} · الحلقة ${Number(parts[2])}`
    : "";
};

/**
 * The player HUD, drawn in a transparent window laid over the video. It owns
 * the pointer over the picture: controls and pointer fade together.
 */
export default function Hud() {
  const [state, setState] = useState(null);
  const [player, setPlayer] = useState({ active: false });
  const [awake, setAwake] = useState(true);
  const [dock, setDock] = useState(null);
  const [notice, setNotice] = useState("");
  const [seekHover, setSeekHover] = useState(null);
  const [flash, setFlash] = useState(null);
  const [skipNext, setSkipNext] = useState("");
  const idle = useRef();
  const click = useRef();
  const overControls = useRef(false);

  const act = (method, args) =>
    call(method, args).catch((e) => {
      setNotice(e.message);
      return null;
    });
  const update = async (method, args) => {
    const result = await act(method, args);
    if (result) setState(result);
    return result;
  };
  const command = (action, value) => act("playerCommand", { action, value });

  const wake = () => {
    setAwake(true);
    clearTimeout(idle.current);
    idle.current = setTimeout(() => {
      if (!overControls.current) setAwake(false);
    }, IDLE_MS);
  };

  useEffect(() => {
    document.documentElement.classList.add("hud-root");
    act("init").then((s) => s && setState(s));
    if (!api) return;
    const off = [
      api.on("state", setState),
      api.on("player", setPlayer),
      api.on("notice", (text) => setNotice(text)),
      api.on("hudCommand", ({ type }) => {
        if (type === "panel") {
          setDock((open) => (open ? null : "subs"));
          wake();
        }
      }),
    ];
    wake();
    return () => off.forEach((fn) => fn());
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    setDock(null);
  }, [player.videoId]);

  const shown = awake || player.pause || !!dock || player.loading;
  const series = player.mediaType === "series";
  // Main hides the pointer itself (CSS cursor alone does not in this window).
  useEffect(() => {
    call("hudIdle", { idle: !!player.active && !shown }).catch(() => {});
  }, [shown, player.active]);
  const pulse = (kind) => {
    setFlash({ kind, at: Date.now() });
  };
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 600);
    return () => clearTimeout(timer);
  }, [flash]);

  if (!player.active) return <div className="hud-stage idle" />;

  const nextCard =
    series &&
    player.duration > 60 &&
    player.duration - (player.position || 0) <= 45 &&
    skipNext !== player.videoId &&
    !player.error;
  const onStageClick = (e) => {
    if (e.target !== e.currentTarget) return;
    clearTimeout(click.current);
    click.current = setTimeout(() => {
      if (dock) return setDock(null);
      command("pause");
      pulse(player.pause ? "play" : "pause");
    }, CLICK_MS);
  };
  const onStageDouble = (e) => {
    if (e.target !== e.currentTarget) return;
    clearTimeout(click.current);
    command("fullscreen");
  };
  const onWheel = (e) => {
    const volume = Math.max(
      0,
      Math.min(150, (player.volume || 0) + (e.deltaY < 0 ? 5 : -5)),
    );
    command("volume", volume);
    pulse("volume");
    wake();
  };
  const seekTo = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(
      0,
      Math.min(1, (event.clientX - rect.left) / rect.width),
    );
    return ratio * (player.duration || 0);
  };

  return (
    <div
      className={`hud-stage ${shown ? "awake" : "asleep"}`}
      style={
        state
          ? { "--hud-accent": resolveAppearance(state.settings).colors.accent }
          : undefined
      }
      onMouseMove={wake}
      onClick={onStageClick}
      onDoubleClick={onStageDouble}
      onContextMenu={(e) => {
        e.preventDefault();
        setDock(dock ? null : "subs");
        wake();
      }}
      onWheel={onWheel}
    >
      <header
        className="hud-top"
        onMouseEnter={() => (overControls.current = true)}
        onMouseLeave={() => (overControls.current = false)}
      >
        <div className="hud-title">
          <span className="eyebrow">RIWAQ CINEMA</span>
          <h1 dir="auto">{player.name}</h1>
          {series && <small>{episodeOf(player.videoId)}</small>}
        </div>
        <div className="hud-buttons">
          <button title="تصغير ومتابعة التصفح" onClick={() => command("pip")}>
            <Minimize2 size={19} />
          </button>
          <button title="إيقاف المشاهدة" onClick={() => act("stop")}>
            <X size={20} />
          </button>
        </div>
      </header>

      {player.loading && (
        <div className="hud-center">
          <Loader2 className="hud-spin" size={38} />
          <span>جاري تجهيز المشاهدة…</span>
        </div>
      )}
      {player.error && <p className="hud-error">{player.error}</p>}
      {flash && (
        <div className={`hud-flash ${flash.kind}`} key={flash.at}>
          {flash.kind === "pause" ? (
            <Pause size={34} fill="currentColor" />
          ) : flash.kind === "play" ? (
            <Play size={34} fill="currentColor" />
          ) : (
            <span>{Math.round(player.volume || 0)}%</span>
          )}
        </div>
      )}
      {notice && <div className="hud-notice">{notice}</div>}
      {player.stats && (
        <dl className="hud-stats" dir="ltr">
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
            </dd>
          </div>
        </dl>
      )}
      {player.skip && (
        <button
          className={`hud-skip ${nextCard ? "raised" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            command("skipSegment");
          }}
        >
          <SkipForward size={16} /> {player.skip.label}
          <small>{player.skip.remaining} ث</small>
        </button>
      )}
      {nextCard && (
        <div className="hud-next" onClick={(e) => e.stopPropagation()}>
          <span>
            <small>الحلقة التالية</small>
            <b>
              {state?.settings.autoplay
                ? "تبدأ تلقائياً عند النهاية"
                : "جاهزة متى ما أردت"}
            </b>
          </span>
          <button
            className="hud-next-play"
            onClick={() => act("hudRequest", { type: "next" })}
          >
            <SkipForward size={16} /> شغّل الآن
          </button>
          <button onClick={() => setSkipNext(player.videoId)}>لاحقاً</button>
        </div>
      )}
      {dock && state && (
        <div
          className="hud-dock"
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onMouseEnter={() => (overControls.current = true)}
          onMouseLeave={() => (overControls.current = false)}
        >
          <PlayerDock
            player={player}
            state={state}
            act={act}
            update={update}
            tab={dock}
            setTab={setDock}
            onEpisode={(videoId) =>
              act("hudRequest", { type: "episode", videoId })
            }
            onClose={() => setDock(null)}
          />
        </div>
      )}

      <footer
        className="hud-bottom"
        onMouseEnter={() => (overControls.current = true)}
        onMouseLeave={() => (overControls.current = false)}
      >
        <div className="hud-seek" dir="ltr">
          <span>{player.live ? "مباشر" : clock(player.position)}</span>
          <div
            className="hud-track"
            onMouseMove={(e) =>
              !player.live &&
              setSeekHover({
                x: e.clientX - e.currentTarget.getBoundingClientRect().left,
                t: seekTo(e),
              })
            }
            onMouseLeave={() => setSeekHover(null)}
            onClick={(e) => !player.live && command("seek", seekTo(e))}
          >
            <i
              className="hud-buffer"
              style={{
                width: `${player.duration ? Math.min(100, ((player.bufferedUntil || 0) / player.duration) * 100) : 0}%`,
              }}
            />
            <i
              className="hud-progress"
              style={{
                width: `${player.duration ? Math.min(100, ((player.position || 0) / player.duration) * 100) : 0}%`,
              }}
            />
            {player.duration > 0 &&
              (player.segments || []).map((segment, index) => (
                <i
                  key={index}
                  className={`hud-marker ${segment.kind}`}
                  style={{
                    left: `${(segment.start / player.duration) * 100}%`,
                    width: `${((segment.end - segment.start) / player.duration) * 100}%`,
                  }}
                />
              ))}
            {seekHover && (
              <b className="hud-seek-time" style={{ left: seekHover.x }}>
                {clock(seekHover.t)}
              </b>
            )}
          </div>
          <span>
            {player.live ? <Radio size={14} /> : clock(player.duration)}
          </span>
        </div>
        <div className="hud-actions">
          <div className="hud-group">
            <button
              className="hud-main"
              title="تشغيل أو إيقاف مؤقت (Space)"
              onClick={() => command("pause")}
            >
              {player.pause ? (
                <Play size={22} fill="currentColor" />
              ) : (
                <Pause size={22} fill="currentColor" />
              )}
            </button>
            {series && (
              <button
                title="الحلقة السابقة"
                onClick={() => act("hudRequest", { type: "previous" })}
              >
                <SkipBack size={19} />
              </button>
            )}
            <button
              title="رجوع"
              onClick={() =>
                command(
                  "seek",
                  (player.position || 0) - (state?.settings.seekStep || 10),
                )
              }
            >
              <RotateCcw size={19} />
            </button>
            <button
              title="تقديم"
              onClick={() =>
                command(
                  "seek",
                  (player.position || 0) + (state?.settings.seekStep || 10),
                )
              }
            >
              <RotateCw size={19} />
            </button>
            {series && (
              <button
                title="الحلقة التالية"
                onClick={() => act("hudRequest", { type: "next" })}
              >
                <SkipForward size={19} />
              </button>
            )}
            <button
              title="كتم الصوت"
              onClick={() => command("mute")}
              className="hud-volume-icon"
            >
              {player.muted || !player.volume ? (
                <VolumeX size={19} />
              ) : (
                <Volume2 size={19} />
              )}
            </button>
            <input
              className="hud-volume"
              aria-label="مستوى الصوت"
              type="range"
              min="0"
              max="150"
              value={player.volume || 0}
              onChange={(e) => command("volume", Number(e.target.value))}
            />
            <small>{Math.round(player.volume || 0)}%</small>
          </div>
          <div className="hud-group">
            {!player.live && player.duration > 0 && (
              <small className="hud-ends">ينتهي {endsAt(player)}</small>
            )}
            <button
              title="الترجمة والصوت (C أو الزر الأيمن)"
              className={dock ? "on" : ""}
              onClick={() => setDock(dock ? null : "subs")}
            >
              <Captions size={20} />
            </button>
            <button
              title="إعدادات المشغل"
              onClick={() => act("hudRequest", { type: "settings" })}
            >
              <SlidersHorizontal size={19} />
            </button>
            <button
              title={player.fullscreen ? "الخروج من ملء الشاشة" : "ملء الشاشة"}
              onClick={() => command("fullscreen")}
            >
              {player.fullscreen ? (
                <Minimize size={19} />
              ) : (
                <Maximize size={19} />
              )}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
