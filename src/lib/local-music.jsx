import { useEffect, useRef, useState } from "react";
import { MusicTransport } from "../../core/music-player.mjs";
import { api, call } from "./api.js";
import { setLocalPlaying } from "./audio.js";

const empty = { tracks: [], playlists: [], queue: [] };
export function useLocalMusic(state, videoActive, notice) {
  const owner = state.profiles?.active;
  const current = useRef({
    owner,
    linked: state.spotify?.connected,
    videoActive,
  });
  current.current = { owner, linked: state.spotify?.connected, videoActive };
  const [library, setLibrary] = useState(empty),
    [playback, setPlayback] = useState(null),
    [busy, setBusy] = useState(false),
    [problem, setProblem] = useState("");
  const version = useRef(0),
    pending = useRef(false);
  const [engine] = useState(() => {
    const prepare = async (isCurrent) => {
      const captured = current.current.owner;
      if (current.current.videoActive)
        throw new Error("أوقف المشاهدة قبل تشغيل الموسيقى");
      if (current.current.linked) {
        const spotify = await call("spotifyState");
        if (!isCurrent()) throw new Error("بدأ تشغيل أغنية أخرى");
        if (spotify.error)
          throw new Error(
            "تعذّر معرفة حالة Spotify؛ أوقفه وافصل الربط قبل تشغيل ملفاتك",
          );
        if (spotify.playback?.playing)
          await call("spotifyControl", { action: "pause" });
      }
      if (captured !== current.current.owner || !isCurrent())
        throw new Error("تغير الملف الشخصي");
      return captured;
    };
    return new MusicTransport({
      createAudio: () => document.createElement("audio"),
      beforeResume: prepare,
      resolve: async (id, isCurrent) => {
        const captured = await prepare(isCurrent);
        return call("musicLocalSource", { profileId: captured, id });
      },
      changed: (next) => {
        setPlayback(next);
        setLocalPlaying(next.playing || next.loading);
      },
    });
  });
  useEffect(() => {
    const token = ++version.current;
    engine.stop();
    engine.queue([]);
    setLibrary(empty);
    setProblem("");
    if (owner)
      call("musicLocalLibrary", { profileId: owner })
        .then((data) => {
          if (token !== version.current) return;
          setLibrary(data);
          engine.queue(data.queue);
        })
        .catch(
          (error) => token === version.current && setProblem(error.message),
        );
    return () => {
      ++version.current;
      engine.stop();
    };
  }, [owner, state.profiles?.unlocked, engine]);
  useEffect(() => api?.on("musicStop", () => engine.stop()), [engine]);
  useEffect(() => {
    if (videoActive) engine.stop();
  }, [videoActive, engine]);
  useEffect(() => {
    if (!navigator.mediaSession) return;
    const actions = {
      play: () => engine.resume(),
      pause: () => engine.pause(),
      stop: () => engine.stop(),
      nexttrack: () => engine.next(),
      previoustrack: () => engine.previous(),
      seekto: (e) => engine.seek(e.seekTime),
    };
    if (playback?.id && !videoActive)
      for (const [key, action] of Object.entries(actions)) {
        try {
          navigator.mediaSession.setActionHandler(key, action);
        } catch {}
      }
    return () => {
      for (const key of Object.keys(actions)) {
        try {
          navigator.mediaSession.setActionHandler(key, null);
        } catch {}
      }
    };
  }, [!!playback?.id, videoActive, engine]);
  useEffect(() => {
    if (!navigator.mediaSession) return;
    const track = library.tracks.find((t) => t.id === playback?.id);
    navigator.mediaSession.metadata =
      track && typeof window.MediaMetadata !== "undefined"
        ? new window.MediaMetadata({
            title: track.title,
            artist: "مكتبتك في رِواق",
          })
        : null;
    navigator.mediaSession.playbackState = !track
      ? "none"
      : playback?.playing
        ? "playing"
        : "paused";
  }, [playback?.id, playback?.playing, library.tracks]);
  const mutate = async (method, args = {}) => {
    if (pending.current) return null;
    const token = version.current;
    pending.current = true;
    setBusy(true);
    try {
      const data = await call(method, { ...args, profileId: owner });
      if (token !== version.current) return null;
      setLibrary(data);
      setProblem("");
      if (engine.state.id && !data.tracks.some((t) => t.id === engine.state.id))
        engine.stop();
      if (JSON.stringify(engine.state.queue) !== JSON.stringify(data.queue))
        engine.queue(data.queue);
      return data;
    } catch (error) {
      if (token === version.current) {
        setProblem(error.message);
        notice(error.message);
      }
      return null;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const edit = (args) => mutate("musicLocalEdit", args);
  const play = async (id, ids) => {
    if (ids?.indexOf(id) >= 500)
      ids = [...ids.slice(ids.indexOf(id)), ...ids.slice(0, ids.indexOf(id))];
    if (ids && !(await edit({ action: "queue", ids }))) return;
    if (current.current.owner !== owner) return;
    return engine.play(id);
  };
  return {
    library,
    playback: playback || engine.state,
    engine,
    busy,
    problem,
    edit,
    play,
    importFiles: async () => {
      const data = await mutate("musicLocalImport");
      if (data)
        notice(
          `أُضيفت ${data.added} أغنية${data.skipped ? ` · لم تُضف ${data.skipped} ملفات مكررة أو غير مدعومة أو تتجاوز الحد` : ""}`,
        );
    },
  };
}
