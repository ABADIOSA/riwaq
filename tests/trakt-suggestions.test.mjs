import test from "node:test";
import assert from "node:assert/strict";
import { Integrations } from "../core/integrations.mjs";
import { DEFAULT_HOME_SECTIONS, visibleHomeSections } from "../core/home.mjs";
import { safeSettings } from "../core/protocol.mjs";
import { HUD_METHODS } from "../core/hud.mjs";

function rig() {
  const calls = [];
  const client = {
    state: {
      integrations: {
        trakt: {
          clientId: "id",
          clientSecret: "secret",
          username: "abadi",
          token: {
            access_token: "a",
            refresh_token: "r",
            created_at: Math.floor(Date.now() / 1000),
            expires_in: 86400,
          },
        },
      },
      addons: [],
      connectedLists: [],
    },
    cache: new Map(),
    persist() {},
    publicState() {
      return {};
    },
    adultFilter: (m) => m,
    async request(url, options) {
      calls.push([
        url,
        options?.method || "GET",
        options?.headers?.Authorization,
      ]);
      if (options?.method === "DELETE") return null;
      return [
        { title: "Dune", year: 2021, ids: { trakt: 1, imdb: "tt1160419" } },
        { title: "No IMDb", year: 2020, ids: { trakt: 2 } },
        { title: "Arrival", year: 2016, ids: { trakt: 3, imdb: "tt2543164" } },
      ];
    },
  };
  return { client, calls, integrations: new Integrations(client) };
}

test("Trakt's suggestions are read for the signed-in account and cached", async () => {
  const { integrations, calls } = rig();
  const first = await integrations.recommendations("movies");
  assert.equal(first.connected, true);
  assert.deepEqual(
    first.metas.map((m) => [m.id, m.type]),
    [
      ["tt1160419", "movie"],
      ["tt2543164", "movie"],
    ],
  );
  assert.equal(
    calls[0][0],
    "https://api.trakt.tv/recommendations/movies?ignore_collected=true&ignore_watchlisted=false&limit=40",
  );
  assert.equal(calls[0][2], "Bearer a");
  await integrations.recommendations("movies");
  assert.equal(calls.length, 1, "served from the cache");
  await integrations.recommendations("movies", { force: true });
  assert.equal(calls.length, 2);
  const shows = await integrations.recommendations("shows");
  assert.equal(shows.metas[0].type, "series");
  await assert.rejects(integrations.recommendations("people"));
});

test("not interested tells Trakt and drops the title from the cached list", async () => {
  const { integrations, calls } = rig();
  await integrations.recommendations("movies");
  assert.equal(
    await integrations.hideRecommendation("movies", "tt1160419"),
    true,
  );
  assert.deepEqual(calls.at(-1).slice(0, 2), [
    "https://api.trakt.tv/recommendations/movies/tt1160419",
    "DELETE",
  ]);
  const after = await integrations.recommendations("movies");
  assert.deepEqual(
    after.metas.map((m) => m.id),
    ["tt2543164"],
  );
  await assert.rejects(integrations.hideRecommendation("movies", "1/../x"));
});

test("without an account nothing is requested; a reply never fills another account", async () => {
  const { integrations, client, calls } = rig();
  client.state.integrations.trakt.token = null;
  assert.deepEqual(await integrations.recommendations("movies"), {
    connected: false,
    metas: [],
  });
  assert.equal(calls.length, 0);
  // The account changes while the request is in flight.
  const next = rig();
  next.client.request = async () => {
    next.client.state.integrations.trakt = {
      clientId: "other",
      token: { access_token: "b" },
    };
    return [];
  };
  await assert.rejects(
    next.integrations.recommendations("movies"),
    /تغير الحساب/,
  );
  // Disconnecting forgets cached suggestions.
  const third = rig();
  await third.integrations.recommendations("movies");
  third.integrations.disconnect("trakt");
  assert.equal(third.integrations.suggestions.size, 0);
});

test("the suggestions section joins arrangements saved before it existed", () => {
  assert.ok(DEFAULT_HOME_SECTIONS.includes("suggestions"));
  const old = ["hero", "countdowns", "continue", "upnext", "catalogs"];
  // Saved before 0.25 (no homeSeen): the new section appears after up next.
  assert.deepEqual(visibleHomeSections(old, undefined), [
    "hero",
    "countdowns",
    "continue",
    "upnext",
    "suggestions",
    "catalogs",
  ]);
  // Hidden knowingly after it existed: it stays hidden.
  assert.deepEqual(visibleHomeSections(old, DEFAULT_HOME_SECTIONS), old);
  assert.deepEqual(
    safeSettings({ homeSeen: ["suggestions", "evil"] }).homeSeen,
    ["suggestions"],
  );
  // Suggestions are main-window actions, never the player overlay's.
  assert.ok(!HUD_METHODS.has("traktSuggestions"));
  assert.ok(!HUD_METHODS.has("traktHideSuggestion"));
});
