import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "../core/client.mjs";
import { parseCsv } from "../core/integrations.mjs";
const create = (request, initial = {}) =>
  new Client({ load: () => structuredClone(initial), save: () => {}, request });

test("an in-flight list sync cannot replace another profile's connected lists", async () => {
  for (const service of ["trakt", "simkl"]) {
    const c = create(async () => ({}));
    let release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    if (service === "trakt") {
      c.integrations.trakt = async (path) =>
        path === "/users/settings" ? pending : [];
    } else c.integrations.simkl = () => pending;
    const syncing = c.integrations.sync(service);
    c.profiles.create({ name: "second" });
    const second = c.profiles.store.list.find((p) => p.id !== "default").id;
    c.profiles.switch({ id: second });
    const ownLists = [
      { key: "own", service, name: "Second profile", metas: [] },
    ];
    c.state.connectedLists = ownLists;
    release(
      service === "trakt" ? { user: { username: "test" } } : { movies: [] },
    );
    await assert.rejects(syncing, /تغير الملف الشخصي/);
    assert.deepEqual(c.state.connectedLists, ownLists);
    c.profiles.switch({ id: "default" });
    assert.deepEqual(c.state.connectedLists, []);
  }
});

test("provider secrets stay outside renderer state and removal disables access", async () => {
  const c = create(async () => ({}));
  c.dataHub.save({ id: "tmdb", key: "private-test-value" });
  assert.equal(c.state.providers.tmdb.key, "private-test-value");
  assert.ok(!JSON.stringify(c.publicState()).includes("private-test-value"));
  c.dataHub.save({ id: "tmdb", enabled: false });
  assert.equal(c.publicState().providers[0].enabled, false);
  c.dataHub.save({ id: "tmdb", clear: true });
  assert.equal(c.publicState().providers[0].configured, false);
  await assert.rejects(c.dataHub.request("tmdb", "configuration"));
});
test("metadata merges TMDB and OMDb while a failed ratings service leaves addon data usable", async () => {
  const calls = [];
  const c = create(async (url, options) => {
    const u = new URL(url);
    calls.push({ u, options });
    if (u.host === "api.themoviedb.org") {
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.Authorization, "Bearer tmdb-token");
      if (u.pathname.includes("/find/"))
        return { movie_results: [{ id: 278 }] };
      return {
        title: "الخلاص",
        overview: "وصف عربي",
        poster_path: "/poster.jpg",
        vote_average: 8.7,
        credits: { cast: [{ name: "Actor" }] },
        "watch/providers": {
          results: {
            SA: {
              flatrate: [{ provider_name: "Example", logo_path: "/logo.png" }],
            },
          },
        },
      };
    }
    if (u.host === "www.omdbapi.com")
      return {
        Ratings: [{ Source: "Internet Movie Database", Value: "9.3/10" }],
      };
    throw new Error("HTTP 429");
  });
  for (const id of ["tmdb", "omdb", "mdblist"])
    c.dataHub.save({ id, key: id === "tmdb" ? "tmdb-token" : "private-key" });
  const m = await c.dataHub.enrich({
    id: "tt0111161",
    type: "movie",
    name: "Original",
    videos: [{ id: "episode" }],
  });
  assert.equal(m.name, "الخلاص");
  assert.equal(m.ratings.length, 2);
  assert.deepEqual(m.dataFailures, ["MDBList"]);
  assert.equal(m.videos[0].id, "episode");
  assert.equal(m.watchProviders[0].name, "Example");
  assert.ok(calls.every((x) => x.options.redirect === "error"));
});
test("provider test rejects API-level errors and never reports success for invalid OMDb key", async () => {
  const c = create(async () => ({
    Response: "False",
    Error: "Invalid API key!",
  }));
  c.dataHub.save({ id: "omdb", key: "bad-key" });
  const state = await c.dataHub.test("omdb");
  assert.equal(state.providers.find((p) => p.id === "omdb").status, "error");
});
test("Trakt uses current auth origin, enforces polling interval and keeps device and token secret", async () => {
  const calls = [];
  const c = create(async (url, options) => {
    calls.push(url);
    if (url.endsWith("/code"))
      return {
        device_code: "private-device",
        user_code: "ABCD1234",
        interval: 5,
        expires_in: 600,
      };
    if (url.endsWith("/token"))
      return {
        access_token: "private-token",
        refresh_token: "private-refresh",
        expires_in: 604800,
      };
    throw new Error(url);
  });
  c.integrations.save({
    id: "trakt",
    clientId: "app-id",
    clientSecret: "private-secret",
  });
  const d = await c.integrations.begin("trakt");
  assert.equal(d.code, "ABCD1234");
  assert.ok(!JSON.stringify(d).includes("private-device"));
  assert.equal((await c.integrations.poll()).pending, true);
  assert.equal(calls.length, 1);
  c.integrations.devices.get("trakt").next = 0;
  assert.equal((await c.integrations.poll()).connected, true);
  assert.ok(calls.every((u) => u.startsWith("https://auth.trakt.tv/")));
  assert.ok(
    !/private-(?:token|refresh|secret)/.test(JSON.stringify(c.publicState())),
  );
});
test("expired device code and rate limiting do not leak or continue authorization", async () => {
  const c = create(async (u) =>
    u.endsWith("/code")
      ? { device_code: "d", user_code: "U", interval: 5, expires_in: 600 }
      : Promise.reject(new Error("HTTP 429")),
  );
  c.integrations.save({ id: "trakt", clientId: "a", clientSecret: "b" });
  await c.integrations.begin();
  c.integrations.devices.get("trakt").next = 0;
  assert.equal((await c.integrations.poll()).interval, 10);
  c.integrations.devices.get("trakt").expires = 0;
  await assert.rejects(c.integrations.poll());
  assert.equal(c.integrations.devices.size, 0);
});
test("parallel Trakt reads refresh a single-use token once and atomically save replacement", async () => {
  let refresh = 0;
  const c = create(
    async (url, options) => {
      if (url.includes("auth.trakt.tv")) {
        refresh++;
        await new Promise((r) => setTimeout(r, 5));
        return {
          access_token: "new",
          refresh_token: "new-refresh",
          expires_in: 604800,
        };
      }
      assert.equal(options.headers.Authorization, "Bearer new");
      return [];
    },
    {
      integrations: {
        trakt: {
          clientId: "a",
          clientSecret: "b",
          token: {
            access_token: "old",
            refresh_token: "old-refresh",
            created_at: 1,
            expires_in: 2,
          },
        },
      },
    },
  );
  await Promise.all([
    c.integrations.trakt("/sync/watchlist/movies"),
    c.integrations.trakt("/sync/watchlist/shows"),
  ]);
  assert.equal(refresh, 1);
  assert.equal(c.state.integrations.trakt.token.refresh_token, "new-refresh");
});
test("Trakt watchlist import uses IMDb IDs and retains prior lists on network failure", async () => {
  let fail = false;
  const c = create(
    async (u) => {
      if (fail) throw new Error("HTTP 500");
      if (u.includes("settings")) return { user: { username: "fixture" } };
      return [
        { movie: { title: "Film", ids: { imdb: "tt0111161" } } },
        { movie: { title: "No IMDb", ids: { tmdb: 123 } } },
      ];
    },
    {
      integrations: {
        trakt: { clientId: "a", token: { access_token: "token" } },
      },
    },
  );
  await c.integrations.sync("trakt");
  assert.equal(c.state.connectedLists[0].metas.length, 1);
  const previous = structuredClone(c.state.connectedLists);
  fail = true;
  await assert.rejects(c.integrations.sync("trakt"));
  assert.deepEqual(c.state.connectedLists, previous);
});
test("history is opt-in, retries offline and deduplicates completed episode writes", async () => {
  let offline = true,
    calls = 0;
  const c = create(
    async (u, o) => {
      calls++;
      if (offline) throw new Error("HTTP 503");
      assert.equal(
        JSON.parse(o.body).shows[0].seasons[0].episodes[0].number,
        3,
      );
      return { added: { episodes: 1 } };
    },
    {
      integrations: {
        trakt: { clientId: "a", token: { access_token: "token" } },
      },
    },
  );
  const m = { id: "tt1234", name: "Show", type: "series" };
  c.integrations.queueHistory(m, "tt1234:2:3", 95, 100);
  assert.equal(calls, 0);
  c.integrations.save({ id: "trakt", trackHistory: true });
  c.integrations.queueHistory(m, "tt1234:2:3", 95, 100);
  await c.integrations.flushing?.catch(() => {});
  assert.equal(c.state.integrations.trakt.pending.length, 1);
  offline = false;
  await c.integrations.flushHistory();
  assert.equal(c.state.integrations.trakt.pending.length, 0);
  c.integrations.queueHistory(m, "tt1234:2:3", 95, 100);
  assert.equal(calls, 2);
  c.integrations.disconnect("trakt");
  assert.equal(c.publicState().integrations[0].pending, 0);
});
test("changing application credentials clears token and pending history but preserves unchanged client id", () => {
  const c = create(async () => ({}), {
    integrations: {
      trakt: {
        clientId: "app",
        clientSecret: "old",
        token: { access_token: "secret" },
        pending: [{}],
      },
    },
  });
  c.integrations.save({ id: "trakt", clientSecret: "new" });
  assert.equal(c.state.integrations.trakt.clientId, "app");
  assert.equal(c.state.integrations.trakt.token, undefined);
  assert.equal(c.publicState().integrations[0].pending, 0);
});
test("Letterboxd public bridge installs a configured addon without passwords and disconnect removes it", async () => {
  let seen;
  const c = create(async (url) => {
    seen = url;
    return {
      id: "stremboxd",
      name: "Letterboxd",
      version: "1.0",
      resources: ["catalog"],
      types: ["movie"],
      catalogs: [{ id: "letterboxd-watchlist", type: "movie" }],
    };
  });
  c.integrations.save({ id: "letterboxd", username: "public_user" });
  await c.integrations.sync("letterboxd");
  const encoded = new URL(seen).pathname.split("/")[1];
  const config = JSON.parse(Buffer.from(encoded, "base64url"));
  assert.equal(config.u, "public_user");
  assert.equal(config.c.watchlist, true);
  assert.equal(c.state.addons.length, 1);
  c.integrations.disconnect("letterboxd");
  assert.equal(c.state.addons.length, 0);
});
test("CSV parses quoted titles and commas, rejects truncation and only accepts exact TMDB title/year matches", async () => {
  const rows = parseCsv(
    '\uFEFFDate,Name,Year\r\n2026-01-01,"Film, \"\"One\"\"",2001\r\n',
  );
  assert.equal(rows[0].Name, 'Film, "One"');
  await assert.rejects(async () => parseCsv('Name\n"missing quote'));
  const c = create(async (url) =>
    new URL(url).pathname.includes("search")
      ? {
          results: [{ id: 1, title: "Wrong Film", release_date: "2001-01-01" }],
        }
      : { imdb_id: "tt123" },
  );
  c.dataHub.save({ id: "tmdb", key: "token" });
  assert.equal(await c.dataHub.resolve("Right Film", "2001"), null);
});
test("Simkl PIN authentication never exposes bearer token and imports supported titles", async () => {
  const c = create(async (url) => {
    const p = new URL(url).pathname;
    // An app registered before AUTH V2 is refused by the device endpoint.
    if (p === "/oauth2/device")
      throw Object.assign(new Error("HTTP 401"), {
        status: 401,
        code: "invalid_client",
      });
    if (p === "/oauth/pin")
      return { user_code: "PIN", interval: 5, expires_in: 600 };
    if (p === "/oauth/pin/PIN")
      return { result: "OK", access_token: "simkl-private" };
    return {
      movies: [
        {
          status: "plantowatch",
          movie: { title: "Movie", ids: { imdb: "tt111" } },
        },
      ],
      anime: [
        {
          status: "watching",
          show: { title: "Anime", ids: { imdb: "tt222" } },
        },
      ],
    };
  });
  c.integrations.save({ id: "simkl", clientId: "simkl-id" });
  await c.integrations.begin("simkl");
  c.integrations.devices.get("simkl").next = 0;
  await c.integrations.poll("simkl");
  await c.integrations.sync("simkl");
  assert.equal(c.state.connectedLists.flatMap((l) => l.metas).length, 2);
  assert.ok(!JSON.stringify(c.publicState()).includes("simkl-private"));
});

const oauthError = (status, code) =>
  Object.assign(new Error(`HTTP ${status}`), { status, code });

test("Simkl AUTH V2: device code, pending and slow-down answers, then a token", async () => {
  const calls = [];
  let polls = 0;
  const c = create(async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ path: u.pathname, params: u.searchParams, init });
    if (u.pathname === "/oauth2/device")
      return {
        device_code: "dev-code",
        user_code: "ABCD-1234",
        verification_uri: "https://simkl.com/pin",
        verification_uri_complete: "https://simkl.com/pin/ABCD-1234",
        expires_in: 900,
        interval: 5,
      };
    if (u.pathname === "/oauth2/token") {
      polls++;
      if (polls === 1) throw oauthError(400, "authorization_pending");
      if (polls === 2) throw oauthError(400, "slow_down");
      return {
        access_token: "v2-access",
        refresh_token: "v2-refresh",
        expires_in: 604800,
        token_type: "Bearer",
      };
    }
    return {
      movies: [
        {
          status: "plantowatch",
          movie: { title: "Movie", ids: { imdb: "tt111" } },
        },
      ],
    };
  });
  c.version = "0.41.0";
  c.integrations.save({ id: "simkl", clientId: "v2-public-id" });
  const started = await c.integrations.begin("simkl");
  assert.equal(started.code, "ABCD-1234");
  assert.equal(started.url, "https://simkl.com/pin/ABCD-1234");
  const device = calls[0];
  assert.equal(device.init.method, "POST");
  const body = new URLSearchParams(device.init.body);
  assert.equal(body.get("client_id"), "v2-public-id");
  assert.equal(body.get("scope"), "media:read media:write");
  assert.equal(body.get("client_secret"), null, "V2 apps have no secret");
  for (const [name, value] of [
    ["client_id", "v2-public-id"],
    ["app-name", "riwaq"],
    ["app-version", "0.41.0"],
  ])
    assert.equal(device.params.get(name), value, name);
  assert.match(device.init.headers["User-Agent"], /^Riwaq\/0\.41\.0/);

  const d = c.integrations.devices.get("simkl");
  d.next = 0;
  assert.equal((await c.integrations.poll("simkl")).pending, true);
  d.next = 0;
  assert.deepEqual(await c.integrations.poll("simkl"), {
    pending: true,
    interval: 10,
  });
  d.next = 0;
  assert.equal((await c.integrations.poll("simkl")).connected, true);
  const token = calls.find((x) => x.path === "/oauth2/token");
  assert.equal(
    new URLSearchParams(token.init.body).get("grant_type"),
    "urn:ietf:params:oauth:grant-type:device_code",
  );
  await c.integrations.sync("simkl");
  const list = calls.at(-1);
  assert.equal(list.path, "/sync/all-items");
  assert.equal(list.init.headers.Authorization, "Bearer v2-access");
  assert.equal(list.params.get("app-name"), "riwaq");
  assert.equal(c.state.connectedLists.flatMap((l) => l.metas).length, 1);
  assert.doesNotMatch(JSON.stringify(c.publicState()), /v2-access|v2-refresh/);
});

test("Simkl V2 tokens refresh when expired or refused, once at a time", async () => {
  let refreshes = 0,
    lists = 0;
  const c = create(async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname === "/oauth2/token") {
      refreshes++;
      const body = new URLSearchParams(init.body);
      assert.equal(body.get("grant_type"), "refresh_token");
      assert.equal(body.get("refresh_token"), "old-refresh");
      return { access_token: `fresh-${refreshes}`, expires_in: 604800 };
    }
    lists++;
    if (init.headers.Authorization === "Bearer stale")
      throw oauthError(401, "invalid_token");
    return { movies: [] };
  });
  c.integrations.save({ id: "simkl", clientId: "id" });
  const s = c.integrations.get("simkl");
  // Expired a week ago: refreshed before the request.
  s.token = {
    access_token: "old",
    refresh_token: "old-refresh",
    expires_in: 604800,
    created_at: Math.floor(Date.now() / 1000) - 700000,
    v2: true,
  };
  await Promise.all([c.integrations.sync("simkl"), c.integrations.simkl("/x")]);
  assert.equal(refreshes, 1, "two requests share one refresh");
  assert.equal(s.token.access_token, "fresh-1");
  assert.equal(s.token.refresh_token, "old-refresh", "kept when not rotated");
  // Refused (401) while not yet expired: one refresh, one retry.
  s.token.access_token = "stale";
  s.token.created_at = Math.floor(Date.now() / 1000);
  await c.integrations.simkl("/y");
  assert.equal(refreshes, 2);
  assert.equal(s.token.access_token, "fresh-2");
});

test("a refused Simkl refresh ends the session but keeps the client ID", async () => {
  const c = create(async (url) => {
    if (new URL(url).pathname === "/oauth2/token")
      throw oauthError(400, "invalid_grant");
    return {};
  });
  c.integrations.save({ id: "simkl", clientId: "keep-me" });
  const s = c.integrations.get("simkl");
  s.token = {
    access_token: "a",
    refresh_token: "r",
    expires_in: 10,
    created_at: 1,
    v2: true,
  };
  await assert.rejects(c.integrations.simkl("/z"), /اربط الحساب من جديد/);
  assert.equal(s.token, undefined);
  assert.equal(s.clientId, "keep-me");
  assert.equal(
    c.publicState().integrations.find((i) => i.id === "simkl").connected,
    false,
  );
});

test("a V2 app sent to the old PIN, and Simkl's other refusals, read in Arabic", async () => {
  const { simklProblem } = await import("../core/integrations.mjs");
  assert.match(
    simklProblem(oauthError(400, "unauthorized_client")).message,
    /Client ID/,
  );
  assert.match(simklProblem(oauthError(429, "")).message, /429/);
  assert.equal(simklProblem(oauthError(503, "")).status, 503);
  const plain = new Error("offline");
  assert.equal(simklProblem(plain), plain);
});
