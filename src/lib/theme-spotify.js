/**
 * A title's theme played through the viewer's Spotify (core/spotify.mjs):
 * only when nothing of theirs is playing there, and paused again when its
 * page goes, if it is still the theme Riwaq started. The viewer's own music
 * is never interrupted or paused.
 */
import { call } from "./api.js";

let started = null;

/** Plays `uri` on Spotify for a title page; false when it should not or cannot. */
export async function startSpotifyTheme(uri) {
  const now = await call("spotifyState").catch(() => null);
  if (!now?.connected) return false;
  const theirs = now.playback?.playing && now.playback?.track?.uri !== started;
  if (theirs) return false;
  try {
    await call("spotifyControl", { action: "play", uri });
    started = uri;
    return true;
  } catch {
    return false;
  }
}

/** Pauses the theme `uri` if Spotify is still playing it. */
export async function stopSpotifyTheme(uri) {
  if (!uri || started !== uri) return;
  started = null;
  const now = await call("spotifyState").catch(() => null);
  if (now?.playback?.playing && now.playback.track?.uri === uri)
    await call("spotifyControl", { action: "pause" }).catch(() => {});
}

/** Pause or resume the theme on Spotify. */
export const toggleSpotifyTheme = (playing) =>
  call("spotifyControl", { action: playing ? "pause" : "play" });
