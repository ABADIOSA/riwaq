import React, { useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  MonitorSpeaker,
  X,
} from "lucide-react";
import { call } from "../lib/api.js";
import { setExternalPlaying } from "../lib/audio.js";

const clock = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Riwaq as the Spotify player (core/spotify.mjs): what is playing on the
 * viewer's Spotify, with its controls and devices. Polled every five
 * seconds only while linked, visible and no viewing is on; hidden over the
 * video (HTML cannot paint on the native surface).
 */
export default function MusicBar({ linked, hidden, suppressed, act, onRoom }) {
  const [now, setNow] = useState(null),
    [devices, setDevices] = useState([]),
    [closed, setClosed] = useState(""),
    [busy, setBusy] = useState(false),
    [volume, setVolume] = useState(null);
  const volumeTimer = useRef(null);
  useEffect(() => {
    if (!linked || hidden) return;
    let live = true,
      reading = false;
    const read = () => {
      if (document.visibilityState !== "visible" || reading) return;
      reading = true;
      call("spotifyState")
        .then((s) => {
          if (!live) return;
          setNow(s.playback);
          setDevices(s.devices || []);
          if (!s.error) setExternalPlaying(!!s.playback?.playing);
        })
        .catch(() => {})
        .finally(() => {
          reading = false;
        });
    };
    read();
    const timer = setInterval(read, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [linked, hidden]);
  useEffect(() => {
    if (!linked) {
      setExternalPlaying(false);
      setNow(null);
      setDevices([]);
      setClosed("");
      setVolume(null);
    }
    return () => clearTimeout(volumeTimer.current);
  }, [linked, hidden]);
  const track = now?.track;
  if (!linked || hidden || suppressed || !track || closed === track.uri)
    return null;
  const control = async (action, extra = {}) => {
    setBusy(true);
    try {
      const next = await act("spotifyControl", { action, ...extra });
      if (next) {
        setNow(next);
        setExternalPlaying(!!next.playing);
      }
    } finally {
      setBusy(false);
    }
  };
  const changeVolume = (value) => {
    setVolume(value);
    clearTimeout(volumeTimer.current);
    volumeTimer.current = setTimeout(
      () => control("volume", { volume: value }),
      350,
    );
  };
  return (
    <aside className="music-bar" aria-label="يشتغل الآن على Spotify">
      {track.image ? (
        <img src={track.image} alt="" referrerPolicy="no-referrer" />
      ) : (
        <span className="music-bar-art" />
      )}
      <button className="music-bar-text" onClick={onRoom} title="غرفة الموسيقى">
        <b dir="auto">{track.name}</b>
        <small dir="auto">
          {track.artists.join("، ")}
          {now.duration > 0 &&
            ` · ${clock(now.progress)} / ${clock(now.duration)}`}
        </small>
      </button>
      {/* Media controls read left to right in every language. */}
      <div className="music-bar-controls" dir="ltr">
        <button
          disabled={busy}
          onClick={() => control("previous")}
          aria-label="السابق"
        >
          <SkipBack size={17} />
        </button>
        <button
          className="music-bar-main"
          disabled={busy}
          onClick={() => control(now.playing ? "pause" : "play")}
          aria-label={now.playing ? "إيقاف مؤقت" : "تشغيل"}
        >
          {now.playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button
          disabled={busy}
          onClick={() => control("next")}
          aria-label="التالي"
        >
          <SkipForward size={17} />
        </button>
      </div>
      {now.device && now.device.volume !== null && (
        <label className="music-bar-volume" title="مستوى الصوت">
          <Volume2 size={15} />
          <input
            type="range"
            min="0"
            max="100"
            value={volume ?? now.device.volume ?? 50}
            onChange={(e) => changeVolume(Number(e.target.value))}
            aria-label="مستوى صوت Spotify"
          />
        </label>
      )}
      {devices.length > 0 && (
        <label className="music-bar-device" title="شغّل على جهاز">
          <MonitorSpeaker size={15} />
          <select
            value={devices.find((d) => d.active)?.id || ""}
            onChange={(e) =>
              e.target.value &&
              control("transfer", { deviceId: e.target.value })
            }
            aria-label="جهاز التشغيل"
          >
            {!devices.some((d) => d.active) && <option value="">جهاز</option>}
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        className="music-bar-close"
        onClick={() => setClosed(track.uri)}
        aria-label="أخفِ الشريط لهذه الأغنية"
      >
        <X size={15} />
      </button>
    </aside>
  );
}
