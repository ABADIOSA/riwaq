import test from "node:test";
import assert from "node:assert/strict";
import { isAdultAddon, isAdultMeta, withoutAdult } from "../core/adult.mjs";
import { spoilerIds } from "../core/spoilers.mjs";
import { HUD_PRESETS, cleanHudHidden, hudHidden } from "../core/hud-layout.mjs";
import { awardFamilies } from "../core/awards.mjs";
import {
  aiModel,
  aiQuery,
  aiRequest,
  cleanAiStore,
  parseAiTitles,
} from "../core/ai-search.mjs";
import { bestMatch } from "../core/ai-hub.mjs";
import { DEFAULT_SETTINGS, safeSettings } from "../core/protocol.mjs";
import { safeAppearance, themeClasses } from "../core/appearance.mjs";
import { Client } from "../core/client.mjs";

const client = (options = {}) =>
  new Client({ load: () => ({}), save: () => {}, ...options });
const reply = (content) => ({ choices: [{ message: { content } }] });

test("adult addons and titles are recognised by their declared flags", () => {
  assert.equal(isAdultAddon({ behaviorHints: { adult: true } }), true);
  assert.equal(isAdultAddon({ behaviorHints: {} }), false);
  assert.equal(isAdultMeta({ adult: true }), true);
  assert.equal(isAdultMeta({ genres: ["Drama", "Erotic"] }), true);
  assert.equal(isAdultMeta({ genres: ["Adult Animation"] }), false);
  assert.equal(isAdultMeta({ genres: ["دراما"] }), false);
  assert.deepEqual(
    withoutAdult([{ id: "a" }, { id: "b", adult: true }]).map((m) => m.id),
    ["a"],
  );
});

test("spoiler protection keeps the current, next and finished episodes clear", () => {
  const videos = [
    { id: "s:0:1", season: 0, episode: 1 },
    ...[1, 2, 3, 4, 5].map((e) => ({ id: `s:1:${e}`, season: 1, episode: e })),
  ];
  const done = { position: 100, duration: 100 };
  const progress = { "series:s:1:1": done, "series:s:1:2": done };
  assert.deepEqual(
    [...spoilerIds(videos, progress, { type: "series" })],
    ["s:1:4", "s:1:5"],
  );
  assert.deepEqual(
    [...spoilerIds(videos, progress, { type: "series", current: "s:1:5" })],
    ["s:1:4"],
  );
  // Nothing watched: the first episode is next, the rest wait.
  assert.equal(spoilerIds(videos, {}, {}).has("s:1:1"), false);
  assert.equal(spoilerIds(videos, {}, {}).has("s:1:2"), true);
  assert.equal(spoilerIds(videos, {}, {}).has("s:0:1"), false);
});

test("player layouts hide only known controls", () => {
  assert.deepEqual(cleanHudHidden(["seek", "nope", "seek", "pause"]), ["seek"]);
  assert.deepEqual(hudHidden({}).size, 0);
  assert.deepEqual([...hudHidden({ hudLayout: "cinema" })], HUD_PRESETS.cinema);
  assert.deepEqual(
    [...hudHidden({ hudLayout: "custom", hudHidden: ["volume"] })],
    ["volume"],
  );
  const s = safeSettings(
    { hudLayout: "custom", hudHidden: ["volume", "x"], spoilerGuard: "titles" },
    DEFAULT_SETTINGS,
  );
  assert.deepEqual(
    [s.hudLayout, s.hudHidden, s.spoilerGuard],
    ["custom", ["volume"], "titles"],
  );
  assert.equal(safeSettings({ hudLayout: "wild" }).hudLayout, "full");
  assert.equal(safeSettings({ awardIcons: false }).awardIcons, false);
});

test("the watched mark is an appearance choice with its own root class", () => {
  assert.equal(safeAppearance({}).posterWatched, true);
  assert.match(themeClasses({ posterWatched: false }), /no-watched-marks/);
  assert.doesNotMatch(themeClasses({}), /no-watched-marks/);
});

test("awards group into families in Arabic or English", () => {
  const { families, other } = awardFamilies([
    { name: "Academy Award for Best Picture" },
    { name: "جائزة الأوسكار لأفضل مخرج" },
    { name: "Golden Globe Award for Best Actor" },
    { name: "Primetime Emmy Award for Outstanding Drama Series" },
    { name: "Some Local Prize" },
  ]);
  assert.deepEqual(
    families.map((f) => [f.id, f.count]),
    [
      ["oscar", 2],
      ["globe", 1],
      ["emmy", 1],
    ],
  );
  assert.equal(other, 1);
});

test("AI requests carry only the viewer's sentence and refuse redirects", () => {
  assert.equal(aiQuery("  فيلم\nهادئ   عن الفضاء "), "فيلم هادئ عن الفضاء");
  assert.throws(() => aiQuery("a"));
  assert.equal(aiQuery("x".repeat(500)).length, 300);
  assert.equal(aiModel("groq", "bad model!"), "llama-3.3-70b-versatile");
  assert.equal(
    aiModel("openrouter", "openai/gpt-4o-mini"),
    "openai/gpt-4o-mini",
  );
  assert.throws(() => aiModel("other", ""));
  const { url, init } = aiRequest({
    provider: "groq",
    key: "gsk_1",
    model: "",
    query: "space films",
  });
  assert.equal(url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(init.redirect, "error");
  assert.equal(init.headers.Authorization, "Bearer gsk_1");
  const body = JSON.parse(init.body);
  assert.equal(body.messages.at(-1).content, "space films");
  assert.equal(body.messages.length, 2);
});

test("AI replies are parsed defensively", () => {
  const titles = parseAiTitles(
    reply(
      '```json\n{"titles":[{"title":"Interstellar","year":2014,"type":"movie"},{"title":"interstellar","type":"movie"},{"title":"Dark","year":"2017","type":"tv series"},{"title":""},{"title":"Old","year":1700}]}\n```',
    ),
  );
  assert.deepEqual(titles, [
    { title: "Interstellar", year: 2014, type: "movie" },
    { title: "Dark", year: 2017, type: "series" },
    { title: "Old", year: null, type: "movie" },
  ]);
  assert.deepEqual(parseAiTitles(reply("sorry, no")), []);
  assert.deepEqual(parseAiTitles({}), []);
  assert.equal(
    parseAiTitles(reply('Here: {"titles":[{"title":"Alien"}]} enjoy')).length,
    1,
  );
  assert.equal(cleanAiStore({ provider: "groq", key: "" }), null);
  assert.equal(cleanAiStore({ provider: "x", key: "k" }), null);
});

test("search results match suggested titles by name and year", () => {
  const metas = [
    { id: "tt1", type: "movie", name: "Dune", releaseInfo: "1984" },
    { id: "tt2", type: "movie", name: "Dune", releaseInfo: "2021" },
    { id: "tt3", type: "series", name: "Dune" },
  ];
  assert.equal(
    bestMatch(metas, { title: "Dune", year: 2021, type: "movie" }).id,
    "tt2",
  );
  assert.equal(bestMatch(metas, { title: "dune", type: "series" }).id, "tt3");
  assert.equal(bestMatch(metas, { title: "Arrival", type: "movie" }), null);
});

test("AI search keeps its key in main and finds titles through TMDB", async () => {
  const calls = [];
  const c = client({
    request: async (url, init = {}) => {
      calls.push({ url, init });
      if (url.startsWith("https://api.groq.com"))
        return reply(
          '{"titles":[{"title":"Arrival","year":2016,"type":"movie"},{"title":"Nothing Real","type":"movie"}]}',
        );
      const u = new URL(url);
      if (u.pathname === "/3/search/movie")
        return u.searchParams.get("query") === "Arrival"
          ? {
              results: [
                {
                  id: 329865,
                  title: "Arrival",
                  release_date: "2016-11-10",
                  poster_path: "/a.jpg",
                },
              ],
            }
          : { results: [] };
      if (u.pathname === "/3/movie/329865/external_ids")
        return { imdb_id: "tt2543164" };
      throw new Error("HTTP 404");
    },
  });
  c.dataHub.save({ id: "tmdb", key: "a".repeat(32) });
  await assert.rejects(
    c.ai.search({ query: "films about language" }),
    /أضف مفتاح/,
  );
  c.ai.save({ provider: "groq", key: "gsk_SECRET", model: "" });
  const state = c.publicState();
  assert.ok(!JSON.stringify(state).includes("gsk_SECRET"));
  assert.equal(state.aiSearch.configured, true);
  const result = await c.ai.search({ query: "films about language" });
  assert.deepEqual(
    result.metas.map((m) => m.id),
    ["tt2543164"],
  );
  assert.deepEqual(result.unmatched, ["Nothing Real"]);
  assert.equal(result.via, "tmdb");
  const ask = calls.find((r) => r.url.startsWith("https://api.groq.com"));
  assert.equal(ask.init.redirect, "error");
  // Saving again with the same provider and no key keeps the key.
  c.ai.save({ provider: "groq", model: "llama-3.1-8b-instant" });
  assert.equal(c.state.aiSearch.key, "gsk_SECRET");
  assert.throws(() => c.ai.save({ provider: "openrouter" }), /المفتاح/);
  c.ai.save({ clear: true });
  assert.equal(c.state.aiSearch, undefined);
});

test("a rejected AI key reads as rejected, not as no results", async () => {
  const c = client({
    request: async () => {
      throw new Error("HTTP 401");
    },
  });
  c.ai.save({ provider: "openrouter", key: "sk-or-1" });
  await assert.rejects(c.ai.search({ query: "anything good" }), /رفض/);
  assert.equal(c.publicState().aiSearch.status, "rejected");
});

test("a profile that hides adult content skips adult addons and titles", async () => {
  const normal = {
    id: "normal",
    name: "Normal",
    version: "1.0.0",
    types: ["movie"],
    resources: ["catalog"],
    catalogs: [{ type: "movie", id: "top", name: "Top" }],
  };
  const adult = {
    ...normal,
    id: "adult",
    name: "Adult",
    behaviorHints: { adult: true },
  };
  const c = client({
    load: () => ({
      addons: [
        { transportUrl: "https://normal.test/manifest.json", manifest: normal },
        { transportUrl: "https://adult.test/manifest.json", manifest: adult },
      ],
    }),
    request: async () => ({
      metas: [
        { id: "tt1", name: "Fine" },
        { id: "tt2", name: "Flagged", genres: ["Erotic"] },
      ],
    }),
  });
  assert.equal(c.catalogPlan().length, 2);
  const id = c.publicState().profiles.active;
  c.profiles.update({ id, hideAdult: true });
  assert.equal(c.catalogPlan().length, 1);
  const { rows } = await c.catalog();
  assert.deepEqual(
    rows[0].metas.map((m) => m.id),
    ["tt1"],
  );
  // Showing it again goes through the Settings lock.
  c.profiles.setPin({ id, pin: "2468" });
  c.profiles.update({ id, lockedRooms: ["settings"] });
  c.profiles.unlocked = false;
  assert.throws(() => c.profiles.update({ id, hideAdult: false }), /محمي/);
  c.profiles.update({ id, hideAdult: true });
  c.profiles.unlocked = true;
  c.profiles.update({ id, hideAdult: false });
  assert.equal(c.catalogPlan().length, 2);
});
