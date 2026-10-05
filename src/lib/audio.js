/**
 * Riwaq's own small audio player, for theme-song previews
 * (core/theme-song.mjs). One song at a time, each on a fresh element so a
 * fading song never silences the next. Only HTTPS previews from Apple's and
 * Deezer's preview hosts play (the CSP allows only those as media).
 */
const HOSTS = [/^audio-ssl\.itunes\.apple\.com$/, /\.dzcdn\.net$/];
const listeners = new Set();
let current = null;
let element = null;
// What Spotify is doing (MusicBar keeps it current), so a theme never
// plays over the viewer's music.
let externalPlaying = false;

export const okPreview = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && HOSTS.some((h) => h.test(url.hostname));
  } catch {
    return false;
  }
};
const changed = () => listeners.forEach((fn) => fn(current));
export const audioNow = () => current;
export function onAudio(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const setExternalPlaying = (value) => {
  externalPlaying = !!value;
  if (externalPlaying) stopAudio(undefined, { fadeMs: 100 });
};
let localPlaying = false;
export const setLocalPlaying = (value) => {
  localPlaying = !!value;
  if (localPlaying) stopAudio(undefined, { fadeMs: 0 });
};
export const externalMusicPlaying = () => externalPlaying || localPlaying;
// A viewing in Riwaq's player: no theme starts over it (App keeps this).
let videoPlaying = false;
export const setVideoPlaying = (value) => {
  videoPlaying = !!value;
  if (videoPlaying) stopAudio(undefined, { fadeMs: 300 });
};
export const videoIsPlaying = () => videoPlaying;

function fade(audio, to, ms, done) {
  clearInterval(audio._fade);
  if (!ms) {
    audio.volume = to;
    done?.();
    return;
  }
  const from = audio.volume;
  const steps = Math.max(1, Math.round(ms / 50));
  let i = 0;
  audio._fade = setInterval(() => {
    i++;
    audio.volume = Math.min(1, Math.max(0, from + (to - from) * (i / steps)));
    if (i >= steps) {
      clearInterval(audio._fade);
      done?.();
    }
  }, 50);
}

/** Plays a song preview for `owner` (a title page), fading in. */
export function playPreview(
  song,
  { owner, volume = 0.35, gentle = true } = {},
) {
  if (
    !song ||
    !okPreview(song.preview) ||
    externalMusicPlaying() ||
    videoPlaying
  )
    return false;
  stopAudio(undefined, { fadeMs: 300 });
  const audio = document.createElement("audio");
  audio.preload = "auto";
  audio.src = song.preview;
  audio.volume = 0;
  element = audio;
  current = { ...song, owner, playing: true };
  audio.onended = () => {
    if (element !== audio) return;
    current = current && { ...current, playing: false, ended: true };
    changed();
  };
  const started = audio.play();
  started?.catch?.(() => {
    if (element !== audio) return;
    current = current && { ...current, playing: false };
    changed();
  });
  fade(audio, Math.min(1, Math.max(0, volume)), gentle ? 1500 : 0);
  changed();
  return true;
}

/** Stops the song (only `owner`'s, when given), fading out. */
export function stopAudio(owner, { fadeMs = 600 } = {}) {
  if (!current || (owner && current.owner !== owner)) return;
  const audio = element;
  element = null;
  current = null;
  if (audio)
    fade(audio, 0, fadeMs, () => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    });
  changed();
}

/** Pause or resume the song. */
export function toggleAudio() {
  if (!current || !element) return;
  if (element.paused) {
    element.play().catch(() => {});
    current = { ...current, playing: true, ended: false };
  } else {
    element.pause();
    current = { ...current, playing: false };
  }
  changed();
}
