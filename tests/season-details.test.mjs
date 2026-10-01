import test from "node:test";
import assert from "node:assert/strict";
import {
  episodeDetails,
  fillOverviews,
  needsEnglish,
  parseSeason,
  seasonRequest,
} from "../core/season-details.mjs";
import { Client } from "../core/client.mjs";

test("a season request needs a numeric TMDB ID and a season number", () => {
  assert.deepEqual(seasonRequest(1396, 2, "ar-SA"), {
    path: "tv/1396/season/2",
    params: { language: "ar-SA" },
  });
  assert.equal(seasonRequest("x", 1), null);
  assert.equal(seasonRequest(1396, 1.5), null);
});

test("TMDB episodes become stills, descriptions, runtimes and ratings", () => {
  const season = parseSeason({
    episodes: [
      {
        episode_number: 1,
        name: "الطيار",
        overview: "  يبدأ  كل شيء ",
        still_path: "/a.jpg",
        runtime: 58,
        vote_average: 8.24,
        vote_count: 10,
        air_date: "2008-01-20",
      },
      {
        episode_number: 2,
        name: "الحلقة 2",
        overview: "",
        still_path: "../bad.jpg",
        vote_average: 0,
      },
      { episode_number: "x" },
    ],
  });
  assert.deepEqual(season[1], {
    title: "الطيار",
    overview: "يبدأ كل شيء",
    thumb: "https://image.tmdb.org/t/p/w400/a.jpg",
    runtime: 58,
    rating: 8.2,
    airDate: "2008-01-20",
  });
  assert.equal(season[2].title, "", "a generic name says nothing");
  assert.equal(season[2].thumb, "");
  assert.equal(Object.keys(season).length, 2);
  assert.equal(needsEnglish(season), true);
  const filled = fillOverviews(season, {
    2: { overview: "Walt cooks.", title: "Cat's in the Bag" },
  });
  assert.equal(filled[2].overview, "Walt cooks.");
  assert.equal(filled[2].overviewLang, "en");
  assert.equal(filled[1].overview, "يبدأ كل شيء", "Arabic kept");
});

test("the addon's fields come first, Arabic from TMDB wins over English", () => {
  const video = {
    title: "Pilot",
    overview: "A teacher turns to crime.",
    thumbnail: "https://episodes.metahub.space/tt1/1/1/w780.jpg",
    rating: "9.0",
  };
  const d = episodeDetails(video, {
    title: "الطيار",
    overview: "معلم كيمياء يتحول إلى الجريمة.",
    thumb: "https://image.tmdb.org/t/p/w400/a.jpg",
    runtime: 58,
    rating: 8.2,
  });
  assert.equal(d.title, "الطيار");
  assert.equal(d.overview, "معلم كيمياء يتحول إلى الجريمة.");
  assert.equal(d.thumb, video.thumbnail, "the addon's still first");
  assert.equal(d.rating, 9);
  assert.equal(d.runtime, 58);
  const bare = episodeDetails(
    { name: "Ep", thumbnail: "http://insecure/x.jpg" },
    null,
  );
  assert.deepEqual(bare, {
    title: "Ep",
    overview: "",
    overviewLang: "",
    thumb: "",
    runtime: 0,
    rating: 0,
  });
  const english = episodeDetails(
    { title: "Ep" },
    { overview: "Walt cooks.", overviewLang: "en" },
  );
  assert.equal(english.overviewLang, "en");
});

test("the client reads a season in Arabic, fills from English and caches", async () => {
  const asked = [];
  const c = new Client({
    load: () => ({}),
    save: () => {},
    request: async (url) => {
      const u = new URL(url);
      asked.push(`${u.pathname}?${u.searchParams.get("language") || ""}`);
      if (u.pathname === "/3/find/tt0903747")
        return { tv_results: [{ id: 1396 }] };
      if (u.pathname === "/3/tv/1396/season/1")
        return u.searchParams.get("language") === "ar-SA"
          ? {
              episodes: [
                { episode_number: 1, name: "الطيار", overview: "" },
                { episode_number: 2, name: "", overview: "" },
              ],
            }
          : {
              episodes: [
                { episode_number: 1, name: "Pilot", overview: "Walt." },
                { episode_number: 2, name: "Cat", overview: "Bag." },
              ],
            };
      throw new Error("HTTP 404");
    },
  });
  assert.deepEqual(await c.seasonDetails({ id: "tt0903747", season: 1 }), {
    needs: ["tmdb"],
    episodes: {},
  });
  c.dataHub.save({ id: "tmdb", key: "a".repeat(32) });
  const info = await c.seasonDetails({ id: "tt0903747:1:1", season: 1 });
  assert.equal(info.episodes[1].title, "الطيار");
  assert.equal(info.episodes[1].overview, "Walt.");
  assert.equal(info.episodes[2].overviewLang, "en");
  const before = asked.length;
  await c.seasonDetails({ id: "tt0903747", season: 1 });
  assert.equal(asked.length, before, "cached");
  await assert.rejects(c.seasonDetails({ id: "nope", season: 1 }), /غير صالح/);
});
