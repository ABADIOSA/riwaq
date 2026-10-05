import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  SPOTIFY_REDIRECT,
  SpotifyHub,
  authorizeUrl,
  cleanClientId,
  pkce,
  playbackView,
  playlistsView,
  spotifyUriOk,
} from "../core/spotify.mjs";
import { spotifyUri } from "../core/music.mjs";
import { Client } from "../core/client.mjs";

const source = (file) =>
  readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8");
const ID = "0123456789abcdef0123456789abcdef";

test("the sign-in is PKCE with the viewer's Client ID and a loopback redirect", () => {
  assert.equal(cleanClientId(` ${ID.toUpperCase()} `), ID);
  assert.equal(cleanClientId("short"), "");
  const { verifier, challenge } = pkce();
  assert.ok(verifier.length >= 43);
  assert.equal(
    challenge,
    createHash("sha256").update(verifier).digest("base64url"),
  );
  const url = new URL(authorizeUrl({ clientId: ID, challenge, state: "s1" }));
  assert.equal(url.origin, "https://accounts.spotify.com");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(
    url.searchParams.get("redirect_uri"),
    "http://127.0.0.1:47811/callback",
  );
  assert.equal(url.searchParams.get("state"), "s1");
  assert.match(url.searchParams.get("scope"), /user-modify-playback-state/);
  assert.equal(url.searchParams.get("client_secret"), null);
  assert.equal(SPOTIFY_REDIRECT, "http://127.0.0.1:47811/callback");
});

test("saved Spotify pages become playable URIs; others do not", () => {
  assert.equal(
    spotifyUri("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"),
    "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M",
  );
  assert.equal(
    spotifyUri("https://open.spotify.com/intl-ar/track/4uLU6hMCjMI75M1A2tKUQC"),
    "spotify:track:4uLU6hMCjMI75M1A2tKUQC",
  );
  assert.equal(spotifyUri("https://open.spotify.com/search/x"), "");
  assert.equal(
    spotifyUri("https://evil.example/playlist/37i9dQZF1DXcBWIGoYBM5M"),
    "",
  );
  assert.ok(spotifyUriOk("spotify:album:4aawyAB9vmqN3uQ7FjRGTy"));
  assert.ok(!spotifyUriOk("spotify:album:../x"));
});

function rig(replies) {
  const bag = {};
  const calls = [];
  let saves = 0;
  let clock = 1000;
  const hub = new SpotifyHub({
    bag: () => bag,
    save: () => saves++,
    now: () => clock,
    request: async (url, init = {}) => {
      calls.push({ url, ...init });
      const reply = replies.shift();
      if (!reply) throw new Error(`unexpected ${url}`);
      return typeof reply === "function" ? reply(url, init) : reply;
    },
  });
  return { hub, bag, calls, tick: (ms) => (clock += ms), saves: () => saves };
}
const TOKEN = {
  status: 200,
  data: { access_token: "a1", refresh_token: "r1", expires_in: 3600 },
};

test("linking keeps tokens in the encrypted bag only, never in public state", async () => {
  const { hub, bag, calls } = rig([
    TOKEN,
    { status: 200, data: { display_name: "Abadi", product: "premium" } },
  ]);
  hub.setClientId(ID);
  const pub = await hub.exchange("code1", "verifier1");
  const form = new URLSearchParams(calls[0].body);
  assert.equal(form.get("grant_type"), "authorization_code");
  assert.equal(form.get("code_verifier"), "verifier1");
  assert.equal(form.get("client_secret"), null);
  assert.equal(calls[0].url, "https://accounts.spotify.com/api/token");
  assert.equal(calls[1].headers.Authorization, "Bearer a1");
  assert.deepEqual(pub, {
    configured: true,
    connected: true,
    name: "Abadi",
    premium: true,
    redirect: SPOTIFY_REDIRECT,
  });
  assert.equal(bag.token.refresh_token, "r1");
  assert.doesNotMatch(JSON.stringify(pub), /a1|r1/);
  assert.throws(() => hub.setClientId("nope"), /32/);
});

test("an expiring token is refreshed once, keeping a rotated refresh token", async () => {
  const { hub, bag, calls, tick } = rig([
    TOKEN,
    { status: 200, data: { display_name: "A" } },
    {
      status: 200,
      data: { access_token: "a2", expires_in: 3600, refresh_token: "r2" },
    },
    { status: 204 },
    { status: 204 },
  ]);
  hub.setClientId(ID);
  await hub.exchange("c", "v");
  tick(3600 * 1000);
  await Promise.all([
    hub.control({ action: "pause" }),
    hub.control({ action: "next" }),
  ]);
  assert.equal(
    calls.filter((c) => c.url.endsWith("/api/token")).length,
    2,
    "one refresh for two calls",
  );
  assert.equal(bag.token.refresh_token, "r2");
  assert.equal(calls.at(-1).headers.Authorization, "Bearer a2");
});

test("a refused refresh ends the link and removes credentials", async () => {
  const { hub, bag, tick } = rig([
    TOKEN,
    { status: 200, data: {} },
    { status: 400, data: { error: "invalid_grant" } },
  ]);
  hub.setClientId(ID);
  await hub.exchange("c", "v");
  tick(3600 * 1000);
  await assert.rejects(hub.playback(), /اربطه من جديد/);
  assert.equal(bag.token, undefined);
  assert.equal(bag.clientId, ID, "the Client ID (not secret) stays");
  assert.equal(hub.publicState().connected, false);
});

test("controls send the right request; Spotify's refusals read in Arabic", async () => {
  const { hub, calls } = rig([
    TOKEN,
    { status: 200, data: {} },
    { status: 204 },
    { status: 204 },
    {
      status: 404,
      data: { error: { status: 404, reason: "NO_ACTIVE_DEVICE" } },
    },
    {
      status: 403,
      data: { error: { status: 403, reason: "PREMIUM_REQUIRED" } },
    },
    { status: 204 },
  ]);
  hub.setClientId(ID);
  await hub.exchange("c", "v");
  await hub.control({
    action: "play",
    uri: "spotify:track:4uLU6hMCjMI75M1A2tKUQC",
  });
  assert.deepEqual(JSON.parse(calls.at(-1).body), {
    uris: ["spotify:track:4uLU6hMCjMI75M1A2tKUQC"],
  });
  await hub.control({
    action: "play",
    uri: "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M",
    deviceId: "abcdef0123456789",
  });
  assert.deepEqual(JSON.parse(calls.at(-1).body), {
    context_uri: "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M",
  });
  assert.match(calls.at(-1).url, /device_id=abcdef0123456789/);
  await assert.rejects(hub.control({ action: "pause" }), /افتح تطبيق Spotify/);
  await assert.rejects(hub.control({ action: "next" }), /Premium/);
  await assert.rejects(
    hub.control({ action: "play", uri: "spotify:bad" }),
    /غير صالح/,
  );
  await assert.rejects(hub.control({ action: "volume", volume: 140 }), /الصوت/);
  await assert.rejects(hub.control({ action: "transfer" }), /جهاز/);
  await assert.rejects(hub.control({ action: "rm -rf" }), /غير معروف/);
  await hub.control({ action: "volume", volume: 40 });
  assert.match(calls.at(-1).url, /volume_percent=40/);
});

test("playback and playlists are reduced to names, times and checked pictures", () => {
  const view = playbackView({
    is_playing: true,
    progress_ms: 61000,
    item: {
      name: "Song",
      duration_ms: 200000,
      uri: "spotify:track:4uLU6hMCjMI75M1A2tKUQC",
      artists: [{ name: "Mohammed Abdu" }],
      album: {
        name: "Album",
        images: [
          { url: "https://evil.example/a.jpg" },
          { url: "https://i.scdn.co/image/ab67" },
        ],
      },
    },
    device: {
      id: "abcdef0123456789",
      name: "PC",
      type: "Computer",
      volume_percent: 55,
    },
  });
  assert.equal(view.track.image, "https://i.scdn.co/image/ab67");
  assert.deepEqual(view.track.artists, ["Mohammed Abdu"]);
  assert.equal(view.device.volume, 55);
  const show = playbackView({
    item: { name: "Ep", show: { name: "Podcast" }, images: [] },
  });
  assert.deepEqual(show.track.artists, ["Podcast"]);
  assert.equal(playbackView(null), null);
  const lists = playlistsView({
    items: [
      {
        uri: "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M",
        name: "طرب",
        tracks: { total: 12 },
      },
      { uri: "bad" },
    ],
  });
  assert.deepEqual(
    lists.map((l) => [l.name, l.tracks]),
    [["طرب", 12]],
  );
});

test("the client shows Spotify by flags only, and backups carry it only with secrets", () => {
  const c = new Client({
    load: () => ({
      integrations: {
        spotify: {
          clientId: ID,
          token: { access_token: "a", refresh_token: "r" },
          name: "N",
        },
      },
    }),
    save: () => {},
  });
  const pub = c.publicState();
  assert.equal(pub.spotify.connected, true);
  assert.doesNotMatch(JSON.stringify(pub), /"r"|access_token|refresh_token/);
  assert.match(source("core/backup.mjs"), /"simkl",\s+"spotify",/);
  const main = source("electron/main.mjs");
  assert.match(main, /url\.searchParams\.get\("state"\) !== nonce/);
  assert.match(main, /spotifyServer\.listen\(SPOTIFY_PORT, "127\.0\.0\.1"/);
  assert.match(main, /cancelLogin\(\);\s+cancelSpotifyLink\(\);/);
  assert.match(main, /shell\.openExternal\("spotify:"\)/);
  for (const m of [
    "spotifyConnect",
    "spotifyDisconnect",
    "spotifyState",
    "spotifyPlaylists",
    "spotifyControl",
    "spotifyOpenApp",
  ])
    assert.match(source("electron/preload.cjs"), new RegExp(`"${m}"`));
});
