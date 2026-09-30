import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanServices,
  debridRequest,
  parseDebridAccount,
  parseWatchProviders,
  serviceSources,
} from "../core/services.mjs";
import {
  authHeader,
  cleanServers,
  copyLabel,
  findEpisode,
  indexLibrary,
  parseLogin,
  parsePublicInfo,
  publicServer,
  serverBase,
  streamUrl,
} from "../core/home-servers.mjs";
import {
  TORRENT_PROFILES,
  profileOf,
  serverSummary,
  updatedValues,
} from "../core/streaming-server.mjs";
import { DEFAULT_SETTINGS, safeSettings } from "../core/protocol.mjs";
import { Client } from "../core/client.mjs";

const DAY = 86400000;
const NOW = Date.UTC(2026, 8, 1);
const manifest = {
  id: "test.provider",
  name: "Fixture",
  version: "1.0.0",
  types: ["movie", "series"],
  resources: ["stream"],
  catalogs: [],
};
const client = (options = {}) =>
  new Client({
    load: () => ({}),
    save: () => {},
    version: "0.15.0",
    ...options,
  });

test("debrid requests put each key where its service expects it", () => {
  const rd = debridRequest("realdebrid", "K1");
  assert.equal(rd.url, "https://api.real-debrid.com/rest/1.0/user");
  assert.equal(rd.headers.Authorization, "Bearer K1");
  const pm = debridRequest("premiumize", "K2");
  assert.equal(new URL(pm.url).searchParams.get("apikey"), "K2");
  assert.deepEqual(pm.headers, {});
  assert.throws(() => debridRequest("nope", "K"));
});

test("debrid accounts read as ok, soon or expired, never guessed", () => {
  const rd = parseDebridAccount(
    "realdebrid",
    {
      type: "premium",
      expiration: new Date(NOW + 40 * DAY).toISOString(),
      username: "abadi",
    },
    NOW,
  );
  assert.deepEqual(
    { status: rd.status, days: rd.days, name: rd.name },
    { status: "ok", days: 40, name: "abadi" },
  );
  assert.equal(
    parseDebridAccount(
      "alldebrid",
      {
        data: {
          user: { isPremium: true, premiumUntil: (NOW + 3 * DAY) / 1000 },
        },
      },
      NOW,
    ).status,
    "soon",
  );
  assert.equal(
    parseDebridAccount("realdebrid", { type: "free" }, NOW).status,
    "expired",
  );
  const tb = parseDebridAccount(
    "torbox",
    { data: { plan: 2, email: "someone@example.com" } },
    NOW,
  );
  assert.equal(tb.status, "ok");
  assert.equal(tb.days, null);
  assert.ok(!tb.name.includes("someone"));
  const dl = parseDebridAccount(
    "debridlink",
    { value: { accountType: 1, premiumLeft: 10 * 86400, pseudo: "x" } },
    NOW,
  );
  assert.equal(dl.days, 10);
});

test("watch providers and chosen services are validated", () => {
  const list = parseWatchProviders({
    results: [
      {
        provider_id: 8,
        provider_name: "Netflix",
        display_priority: 2,
        logo_path: "/n.jpg",
      },
      { provider_id: 1, provider_name: "Shahid", display_priority: 1 },
      { provider_id: "x", provider_name: "Bad" },
      { provider_id: 9, provider_name: "Evil", logo_path: "/../x" },
    ],
  });
  assert.deepEqual(
    list.map((p) => p.name),
    ["Shahid", "Netflix", "Evil"],
  );
  assert.equal(list[1].logo, "https://image.tmdb.org/t/p/w92/n.jpg");
  assert.equal(list[2].logo, "");
  const chosen = cleanServices([
    { id: 8, name: "Netflix", logo: "https://image.tmdb.org/t/p/w92/n.jpg" },
    { id: 8, name: "Twice" },
    { id: 5, name: "X", logo: "https://evil.test/a.png" },
    { id: -1 },
  ]);
  assert.equal(chosen.length, 2);
  assert.equal(chosen[1].logo, "");
  assert.deepEqual(
    safeSettings({ ...DEFAULT_SETTINGS, streamingServices: chosen })
      .streamingServices,
    chosen,
  );
  const sources = serviceSources(chosen[0], "SA");
  assert.deepEqual(
    sources.map((s) => [s.media, s.filters.withWatchProviders]),
    [
      ["movie", "8"],
      ["tv", "8"],
    ],
  );
  assert.equal(sources[0].filters.watchRegion, "SA");
});

test("home server helpers never keep passwords or leak tokens", () => {
  assert.equal(
    serverBase(" http://192.168.1.10:8096/jellyfin/?x=1#y "),
    "http://192.168.1.10:8096/jellyfin",
  );
  assert.throws(() => serverBase("http://u:p@host"));
  assert.throws(() => serverBase("ftp://host"));
  assert.match(
    authHeader({ deviceId: "d", version: "1", token: "T" }),
    /^MediaBrowser Client="Riwaq".*Token="T"$/,
  );
  assert.equal(
    parsePublicInfo({ Id: "s", ProductName: "Emby Server", ServerName: "Home" })
      .kind,
    "emby",
  );
  assert.throws(() => parsePublicInfo({ ProductName: "nginx" }));
  assert.throws(() => parseLogin({ User: { Id: "u" } }));
  const [server] = cleanServers([
    {
      id: "s1",
      url: "http://nas:8096",
      userId: "u1",
      token: "SECRET",
      password: "never",
      name: "NAS",
    },
    { id: "bad", url: "http://nas", userId: "u", token: "" },
  ]);
  assert.ok(!("password" in server));
  assert.equal(cleanServers([server, server]).length, 1);
  const shown = publicServer(server);
  assert.ok(!JSON.stringify(shown).includes("SECRET"));
  assert.equal(shown.host, "nas:8096");
  const url = new URL(streamUrl(server, "item1"));
  assert.equal(url.pathname, "/Videos/item1/stream");
  assert.equal(url.searchParams.get("static"), "true");
  const index = indexLibrary([
    { Id: "a", Type: "Movie", ProviderIds: { Imdb: "tt0111161" } },
    { Id: "b", Type: "Series", ProviderIds: { IMDB: "tt0903747" } },
    { Id: "c", Type: "Movie", ProviderIds: { Imdb: "junk" } },
  ]);
  assert.deepEqual([...index.keys()], ["movie:tt0111161", "series:tt0903747"]);
  assert.equal(
    findEpisode({ Items: [{ IndexNumber: 2, Id: "e2" }] }, 2).Id,
    "e2",
  );
  assert.equal(
    copyLabel({
      Container: "mkv",
      Size: 5,
      MediaStreams: [{ Type: "Video", Height: 1080, Codec: "hevc" }],
    }).resolution,
    "1080p",
  );
});

test("the streaming server keeps its own values and profiles round-trip", () => {
  const values = {
    serverVersion: "4.20.8",
    appPath: "C:\\Users\\someone\\stremio",
    cacheRoot: "C:\\Users\\someone\\cache",
    cacheSize: 2147483648,
    ...TORRENT_PROFILES.balanced,
  };
  const summary = serverSummary(values);
  assert.deepEqual(summary, {
    version: "4.20.8",
    profile: "balanced",
    cacheSize: 2147483648,
    editable: true,
  });
  assert.ok(!JSON.stringify(summary).includes("someone"));
  const next = updatedValues(values, { profile: "fast", cacheSize: null });
  assert.equal(profileOf(next), "fast");
  assert.equal(next.cacheSize, null);
  assert.equal(next.appPath, values.appPath);
  assert.throws(() => updatedValues(values, { cacheSize: 7 }));
  assert.equal(profileOf({ btMaxConnections: 1 }), "custom");
});

test("debrid keys stay in main and are checked without redirects", async () => {
  const calls = [];
  const c = client({
    request: async (url, init) => {
      calls.push({ url, init });
      return { type: "premium", expiration: Date.now() + 20 * DAY };
    },
  });
  assert.throws(() => c.services.debridSave({ id: "realdebrid", key: "a b" }));
  c.services.debridSave({ id: "realdebrid", key: " TOKEN " });
  const state = await c.services.debridCheck({ id: "realdebrid" });
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[0].init.headers.Authorization, "Bearer TOKEN");
  const rd = state.services.debrid.find((d) => d.id === "realdebrid");
  assert.equal(rd.name, "Real-Debrid");
  assert.equal(rd.status, "ok");
  assert.ok(rd.days >= 19);
  assert.ok(!JSON.stringify(state).includes("TOKEN"));
  c.services.debridSave({ id: "realdebrid", clear: true });
  assert.equal(c.state.debrid.realdebrid, undefined);
});

test("a home server signs in once, keeps the token and offers your copy first", async () => {
  const seen = [];
  const request = async (url, init = {}) => {
    seen.push({ url, init });
    assert.equal(init.redirect ?? "error", "error");
    if (url.endsWith("/System/Info/Public"))
      return { Id: "srv", ProductName: "Jellyfin Server", ServerName: "NAS" };
    if (url.endsWith("/Users/AuthenticateByName"))
      return { AccessToken: "TOKEN123", User: { Id: "user1", Name: "abadi" } };
    if (url.includes("/Users/user1/Items"))
      return {
        Items: [
          {
            Id: "m1",
            Type: "Movie",
            Name: "Film",
            ProviderIds: { Imdb: "tt0111161" },
            MediaSources: [
              {
                Container: "mkv",
                Size: 4 * 1024 ** 3,
                MediaStreams: [{ Type: "Video", Height: 2160, Codec: "hevc" }],
              },
            ],
          },
        ],
      };
    if (url.includes("/stream/"))
      return { streams: [{ url: "https://media.test/v", name: "720p" }] };
    throw new Error("HTTP 404");
  };
  const c = client({
    request,
    load: () => ({
      addons: [{ transportUrl: "https://addon.test/manifest.json", manifest }],
    }),
  });
  const state = await c.services.homeServerAdd({
    url: "http://192.168.1.5:8096",
    username: "abadi",
    password: "hunter2",
  });
  const login = seen.find((r) => r.url.endsWith("AuthenticateByName"));
  assert.equal(login.init.method, "POST");
  assert.match(login.init.headers["X-Emby-Authorization"], /Client="Riwaq"/);
  const text = JSON.stringify(state);
  assert.ok(!text.includes("TOKEN123") && !text.includes("hunter2"));
  assert.ok(!JSON.stringify(c.state).includes("hunter2"));
  assert.equal(state.services.homeServers[0].status, "ok");
  assert.equal(state.services.homeServers[0].items, 1);
  const result = await c.getStreams({ type: "movie", id: "tt0111161" });
  assert.equal(result.streams[0].home, true);
  assert.equal(result.streams[0].resolution, 2160);
  assert.ok(!JSON.stringify(result).includes("TOKEN123"));
  const stored = c.streams.get(result.streams[0].key);
  assert.match(
    stored.url,
    /\/Videos\/m1\/stream\?static=true&api_key=TOKEN123$/,
  );
  // A disabled server offers nothing; removing it forgets the token.
  const id = state.services.homeServers[0].id;
  c.services.homeServerToggle({ id, enabled: false });
  const off = await c.getStreams({ type: "movie", id: "tt0111161" });
  assert.ok(!off.streams.some((s) => s.home));
  c.services.homeServerRemove({ id });
  assert.ok(!JSON.stringify(c.state).includes("TOKEN123"));
});

test("service rows need a TMDB key and never request without one", async () => {
  let asked = 0;
  const c = client({
    request: async () => {
      asked++;
      return {};
    },
  });
  c.state.settings.streamingServices = [{ id: 8, name: "Netflix" }];
  assert.deepEqual(await c.services.serviceRows(), {
    rows: [],
    needs: ["tmdb"],
  });
  assert.equal(asked, 0);
});

test("streaming server changes are verified by reading them back", async () => {
  let values = {
    cacheSize: 0,
    serverVersion: "4.20",
    ...TORRENT_PROFILES.gentle,
  };
  const c = client({
    request: async (url, init = {}) => {
      assert.equal(url, "http://127.0.0.1:11470/settings");
      if (init.method === "POST") values = JSON.parse(init.body);
      return { values };
    },
  });
  const info = await c.services.streamServerSave({ profile: "fast" });
  assert.equal(info.profile, "fast");
  assert.equal(values.cacheSize, 0);
  const stubborn = client({ request: async () => ({ values: { ...values } }) });
  await assert.rejects(stubborn.services.streamServerSave({ cacheSize: null }));
  const down = client({
    request: async () => {
      throw new Error("offline");
    },
  });
  assert.deepEqual(await down.services.streamServerInfo(), {
    reachable: false,
  });
});
