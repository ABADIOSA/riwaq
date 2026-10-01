import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanCountdowns,
  dayOf,
  midnightOf,
  parseReleaseDates,
  releaseTarget,
  remaining,
} from "../core/countdown.mjs";
import { DEFAULT_SETTINGS, safeSettings } from "../core/protocol.mjs";

const NOW = new Date("2026-10-01T12:20:00Z"); // 15:20 in Riyadh
const RIYADH = 180;

test("a film not out yet counts down to midnight of its day on the viewer's clock", () => {
  const meta = {
    type: "movie",
    id: "tt21357150",
    name: "Avengers: Doomsday",
    released: "2026-12-18T00:00:00.000Z",
  };
  const target = releaseTarget(meta, NOW, RIYADH);
  assert.deepEqual(target, {
    day: "2026-12-18",
    kind: "release",
    label: "موعد الإصدار",
  });
  const at = midnightOf(target.day, RIYADH);
  assert.equal(at.toISOString(), "2026-12-17T21:00:00.000Z");
  assert.deepEqual(remaining(at, NOW), {
    done: false,
    days: 77,
    hours: 8,
    minutes: 40,
    seconds: 0,
  });
  assert.equal(
    releaseTarget({ ...meta, released: "2021-10-22" }, NOW, RIYADH),
    null,
    "already out",
  );
  assert.equal(remaining(at, new Date("2026-12-18T00:00:00Z")).done, true);
});

test("a series counts down to its next episode", () => {
  const meta = {
    type: "series",
    id: "tt1",
    released: "2020-01-01",
    videos: [
      { id: "tt1:1:1", season: 1, episode: 1, released: "2020-01-01" },
      {
        id: "tt1:2:3",
        season: 2,
        episode: 3,
        released: "2026-10-09T01:00:00Z",
      },
      {
        id: "tt1:2:2",
        season: 2,
        episode: 2,
        released: "2026-10-02T01:00:00Z",
      },
      {
        id: "tt1:0:1",
        season: 0,
        episode: 1,
        released: "2026-10-01T23:00:00Z",
      },
    ],
  };
  const target = releaseTarget(meta, NOW, RIYADH);
  assert.equal(target.kind, "episode");
  assert.equal(target.videoId, "tt1:2:2", "the nearest numbered episode");
  assert.equal(target.label, "الحلقة 2 من الموسم 2");
  assert.equal(
    releaseTarget({ ...meta, videos: [meta.videos[0]] }, NOW, RIYADH),
    null,
  );
});

test("TMDB release dates give the Saudi cinema date first", () => {
  const body = {
    results: [
      {
        iso_3166_1: "US",
        release_dates: [{ release_date: "2026-12-18T00:00:00.000Z", type: 3 }],
      },
      {
        iso_3166_1: "SA",
        release_dates: [
          { release_date: "2027-03-01T00:00:00.000Z", type: 4 },
          { release_date: "2026-12-17T00:00:00.000Z", type: 3 },
        ],
      },
    ],
  };
  assert.deepEqual(parseReleaseDates(body, "SA"), {
    day: "2026-12-17",
    type: 3,
    label: "السينما",
    region: "SA",
  });
  assert.equal(parseReleaseDates(body, "EG"), null);
  assert.equal(parseReleaseDates({}, "SA"), null);
});

test("pinned countdowns are validated and kept to twelve", () => {
  const list = cleanCountdowns([
    {
      type: "movie",
      id: "tt21357150",
      name: "Doomsday",
      day: "2026-12-18",
      localDay: "2026-12-17",
      localLabel: "السينما",
      background:
        "https://images.metahub.space/background/large/tt21357150/img",
      logo: "http://insecure/logo.png",
    },
    { type: "movie", id: "tt21357150", day: "2026-12-18" },
    { type: "tv", id: "x", day: "2026-12-18" },
    { type: "movie", id: "bad id!", day: "2026-12-18" },
    { type: "series", id: "tt1", day: "not a day" },
  ]);
  assert.equal(list.length, 1);
  assert.equal(list[0].localDay, "2026-12-17");
  assert.equal(list[0].logo, "", "only HTTPS pictures");
  assert.equal(dayOf("2026-12-18T00:00:00Z"), "2026-12-18");
  assert.equal(dayOf("someday"), "");
  const many = Array.from({ length: 20 }, (_, i) => ({
    type: "movie",
    id: `tt${100000 + i}`,
    day: "2027-01-01",
  }));
  assert.equal(cleanCountdowns(many).length, 12);
  assert.deepEqual(DEFAULT_SETTINGS.countdowns, []);
  assert.equal(safeSettings({ countdowns: many }).countdowns.length, 12);
  assert.ok(DEFAULT_SETTINGS.homeSections.includes("countdowns"));
});
