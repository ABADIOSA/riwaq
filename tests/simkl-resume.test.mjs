import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "../core/client.mjs";
import { simklPlaybackMark, simklPlaybacks } from "../core/simkl.mjs";
import { resumeStart } from "../core/resume.mjs";
import { playerArgs } from "../electron/player.mjs";

// Simkl's own example response for GET /sync/playback (its API docs).
const EXAMPLE = [
  {
    id: 123,
    progress: 45.5,
    paused_at: "2024-01-15T10:30:00.000Z",
    type: "episode",
    episode: {
      season: 1,
      episode: 5,
      title: "Episode 5",
      tvdb_season: 1,
      tvdb_number: 5,
    },
    show: {
      title: "Breaking Bad",
      year: 2008,
      ids: {
        simkl: 12345,
        slug: "breaking-bad",
        tmdb: 1429,
        imdb: "tt0903747",
      },
    },
  },
  {
    id: 124,
    progress: 75,
    paused_at: "2024-01-15T11:15:00.000Z",
    type: "movie",
    movie: {
      title: "Inception",
      year: 2010,
      ids: { simkl: 67890, slug: "inception", tmdb: 27205, imdb: "tt1375666" },
    },
  },
];
const at = (iso) => Date.parse(iso);

test("#92 Simkl's paused sessions become resume points with playable IDs", () => {
  const points = simklPlaybacks(EXAMPLE);
  assert.deepEqual(
    points.map((p) => [p.meta.type, p.videoId, p.percent, p.pausedAt]),
    [
      ["movie", "tt1375666", 75, at("2024-01-15T11:15:00.000Z")],
      ["series", "tt0903747:1:5", 45.5, at("2024-01-15T10:30:00.000Z")],
    ],
    "newest first",
  );
  assert.equal(points[0].meta.name, "Inception");
  assert.match(points[0].meta.poster, /^https:\/\/images\.metahub\.space\//);
  assert.deepEqual(simklPlaybacks(null), [], "no sessions at all");
  assert.throws(() => simklPlaybacks({ movies: [] }), /استئناف Simkl/);
});

test("#92 an anime keeps the episode under the ID its addon uses, never a guessed season", () => {
  const [both] = simklPlaybacks([
    {
      progress: 30,
      paused_at: "2026-10-16T12:00:00Z",
      type: "episode",
      // TVDB numbering for IMDb catalogs, AniDB's absolute number for anime.
      episode: { season: 1, number: 30, tvdb_season: 2, tvdb_number: 4 },
      show: {
        title: "Frieren",
        ids: { imdb: "tt22248376", kitsu: "46474", mal: 52991 },
      },
    },
  ]);
  assert.equal(both.videoId, "tt22248376:2:4");
  assert.equal(both.alternates[0].videoId, "kitsu:46474:30");
  assert.equal(both.duration, 25 * 60, "Simkl's anime runtime");
  const [noImdb] = simklPlaybacks([
    {
      progress: 50,
      paused_at: "2026-10-16T12:00:00Z",
      type: "episode",
      episode: { season: 1, episode: 7 },
      anime: { title: "Bebop", ids: { mal: "1", anilist: "1" } },
    },
  ]);
  assert.equal(noImdb.videoId, "mal:1:7");
  assert.deepEqual(
    simklPlaybacks([
      // A later AniDB season cannot be told apart without IMDb: left out.
      {
        progress: 50,
        paused_at: "2026-10-16T12:00:00Z",
        type: "episode",
        episode: { season: 2, number: 3 },
        show: { title: "X", ids: { kitsu: "9" } },
      },
      // No playable ID, a finished item, an unknown type, a bad date.
      {
        progress: 40,
        paused_at: "2026-10-16T12:00:00Z",
        type: "movie",
        movie: { title: "Y", ids: { simkl: 5 } },
      },
      { ...EXAMPLE[1], progress: 97 },
      { ...EXAMPLE[1], type: "show" },
      { ...EXAMPLE[1], paused_at: "yesterday" },
      { ...EXAMPLE[1], movie: { title: "Z", ids: { imdb: "tt1; DROP" } } },
    ]),
    [],
  );
});

test("#92 resume points never overwrite newer or same-place local progress", () => {
  const c = new Client({
    request: async () => ({}),
    load: () => ({}),
    save: () => {},
  });
  const [movie, episode] = simklPlaybacks(EXAMPLE);
  // Riwaq's own pause, sent to Simkl and read back: the same place.
  c.state.progress["series:tt0903747:1:5"] = {
    meta: { id: "tt0903747", type: "series", name: "Breaking Bad" },
    videoId: "tt0903747:1:5",
    position: 1365,
    duration: 3000,
    updated: episode.pausedAt - 5000,
  };
  // Watched further on this device after the pause.
  c.state.progress["movie:tt1375666"] = {
    meta: { id: "tt1375666", type: "movie", name: "Inception" },
    videoId: "tt1375666",
    position: 600,
    duration: 8880,
    updated: movie.pausedAt + 1000,
  };
  assert.equal(c.importResume([movie, episode]), 0);
  assert.equal(c.state.progress["movie:tt1375666"].position, 600);

  // Elsewhere, later and further on: it is taken, with its percentage.
  c.state.progress["movie:tt1375666"].updated = movie.pausedAt - 60000;
  c.state.progress["movie:tt1375666"].hiddenAt = movie.pausedAt + 1;
  assert.equal(c.importResume([movie]), 1);
  const saved = c.state.progress["movie:tt1375666"];
  assert.equal(saved.startPercent, 75);
  assert.equal(saved.updated, movie.pausedAt);
  assert.equal(saved.position / saved.duration, 0.75);
  assert.equal(
    saved.hiddenAt,
    movie.pausedAt + 1,
    "a hidden title stays hidden",
  );

  // A manual watched mark after the pause wins too.
  c.state.progress["movie:tt1375666"] = {
    ...saved,
    completed: true,
    updated: 1,
    markedAt: movie.pausedAt + 1,
  };
  assert.equal(c.importResume([movie]), 0);
});

test("#92 an anime watched through its Kitsu ID resumes under that key, not a duplicate", () => {
  const c = new Client({
    request: async () => ({}),
    load: () => ({}),
    save: () => {},
  });
  c.state.progress["series:kitsu:46474:30"] = {
    meta: { id: "kitsu:46474", type: "series", name: "Frieren" },
    videoId: "kitsu:46474:30",
    position: 60,
    duration: 1440,
    updated: 1,
  };
  const points = simklPlaybacks([
    {
      progress: 60,
      paused_at: "2026-10-16T12:00:00Z",
      type: "episode",
      episode: { season: 1, number: 30, tvdb_season: 2, tvdb_number: 4 },
      show: { title: "Frieren", ids: { imdb: "tt22248376", kitsu: "46474" } },
    },
  ]);
  assert.equal(c.importResume(points), 1);
  assert.equal(c.state.progress["series:tt22248376:2:4"], undefined);
  assert.equal(c.state.progress["series:kitsu:46474:30"].startPercent, 60);
});

test("#92 a resume point starts at its exact percentage, in MPV and after a restore", () => {
  assert.deepEqual(
    resumeStart({ position: 2025, duration: 2700, startPercent: 75 }),
    { start: 2025, startPercent: 75 },
  );
  assert.deepEqual(resumeStart({ position: 600, duration: 6000 }), {
    start: 600,
  });
  assert.deepEqual(resumeStart({ position: 5900, duration: 6000 }), {
    start: 0,
  });
  assert.deepEqual(
    resumeStart({ position: 10, duration: 100, completed: true }),
    { start: 0 },
  );
  assert.deepEqual(resumeStart(undefined), { start: 0 });
  const args = (extra) =>
    playerArgs({ pipe: "p", settings: {}, url: "https://x/y", ...extra });
  assert.ok(args({ start: 2025, startPercent: 75 }).includes("--start=75%"));
  assert.ok(args({ start: 2025, startPercent: 99 }).includes("--start=2025"));
  assert.ok(args({ start: 30 }).includes("--start=30"));

  const c = new Client({
    request: async () => ({}),
    load: () => ({}),
    save: () => {},
  });
  c.importResume(simklPlaybacks(EXAMPLE));
  const passphrase = "a long enough passphrase";
  const { text } = c.exportBackup({ passphrase });
  const copy = new Client({
    request: async () => ({}),
    load: () => ({}),
    save: () => {},
  });
  copy.restoreBackup({ text, passphrase });
  assert.equal(
    copy.state.progress["series:tt0903747:1:5"]?.startPercent,
    45.5,
    "backups and accounts keep the percentage",
  );
});

test("#92 resume is its own opt-in, read only when Simkl's activities changed, for the profile that asked", async () => {
  const calls = [];
  let mark = "2026-10-16T12:00:00Z";
  const c = new Client({
    request: async (url) => {
      const path = new URL(url).pathname;
      calls.push(path);
      if (path === "/sync/all-items") return {};
      if (path === "/sync/activities")
        return { tv_shows: { playback: mark }, movies: { playback: mark } };
      if (path === "/sync/playback") return EXAMPLE;
      return {};
    },
    load: () => ({}),
    save: () => {},
  });
  Object.assign(c.integrations.get("simkl"), {
    clientId: "fixture",
    token: { access_token: "private-fixture" },
  });
  await c.integrations.sync("simkl");
  assert.deepEqual(calls, ["/sync/all-items"], "off by default: no reads");
  assert.equal(c.state.progress["movie:tt1375666"], undefined);

  c.integrations.save({ id: "simkl", resume: true });
  assert.equal(
    c.integrations.publicState().find((s) => s.id === "simkl").resume,
    true,
  );
  calls.length = 0;
  await c.integrations.sync("simkl");
  assert.deepEqual(calls, [
    "/sync/all-items",
    "/sync/activities",
    "/sync/playback",
  ]);
  assert.equal(c.state.progress["movie:tt1375666"].startPercent, 75);

  calls.length = 0;
  await c.integrations.sync("simkl");
  assert.deepEqual(
    calls,
    ["/sync/all-items", "/sync/activities"],
    "unchanged activities: the sessions are not read again",
  );

  // Turning it off and on again reads them afresh.
  c.integrations.save({ id: "simkl", resume: false });
  c.integrations.save({ id: "simkl", resume: true });
  calls.length = 0;
  await c.integrations.sync("simkl");
  assert.ok(calls.includes("/sync/playback"));

  // Without a token, the option cannot be on.
  const empty = new Client({
    request: async () => ({}),
    load: () => ({}),
    save: () => {},
  });
  empty.integrations.save({ id: "simkl", resume: true });
  assert.equal(empty.integrations.get("simkl").resume, false);
  mark = "";
  assert.equal(simklPlaybackMark(null), "");
  assert.equal(simklPlaybackMark({}), "", "no times: read every time");
  assert.equal(
    simklPlaybackMark({ anime: { playback: "2026-10-16T12:00:00Z" } }),
    "||2026-10-16T12:00:00Z",
  );
});

test("#92 a profile switch during the sync writes no resume point", async () => {
  let switchProfile;
  const c = new Client({
    request: async (url) => {
      const path = new URL(url).pathname;
      if (path === "/sync/playback") {
        switchProfile();
        return EXAMPLE;
      }
      return path === "/sync/activities" ? {} : {};
    },
    load: () => ({}),
    save: () => {},
  });
  Object.assign(c.integrations.get("simkl"), {
    clientId: "fixture",
    token: { access_token: "private-fixture" },
    resume: true,
  });
  switchProfile = () => (c.profiles.store.active = "someone-else");
  await assert.rejects(c.integrations.sync("simkl"), /الملف الشخصي/);
  assert.equal(c.state.progress["movie:tt1375666"], undefined);
});
