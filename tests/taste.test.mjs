import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanTaste,
  editTaste,
  tasteGenres,
  tasteCandidates,
  recommendTaste,
  tasteProfile,
  tasteAffinity,
} from "../core/taste.mjs";
import { Client } from "../core/client.mjs";
import { collectBackup, restoreState } from "../core/backup.mjs";
import { planSession } from "../core/session.mjs";
import { visibleHomeSections, DEFAULT_HOME_SECTIONS } from "../core/home.mjs";
import { HUD_METHODS } from "../core/hud.mjs";
const movie = (id, genres = ["Comedy"], extra = {}) => ({
  id,
  type: "movie",
  name: id,
  genres,
  ...extra,
});
const feedback = (meta, value = "like") => ({
  action: "feedback",
  meta,
  value,
});

test("taste matches Arabic and English declared genres without guessing from titles", () => {
  assert.deepEqual(
    tasteGenres({
      genres: [
        "إثارة",
        "Thriller",
        "دِراما",
        "Science Fiction",
        null,
        "not-a-genre",
      ],
    }),
    ["thriller", "drama", "scifi"],
  );
  assert.deepEqual(tasteGenres(movie("Funny Comedy Movie", [])), []);
});
test("stored taste is bounded, deduplicated, validated and carries no supplied URLs", () => {
  const records = Array.from({ length: 310 }, (_, i) => ({
    ...movie(String(i)),
    genres: ["comedy", "garbage"],
    value: "like",
    updated: i,
    streamUrl: "secret",
  }));
  const taste = cleanTaste({
    genres: ["comedy", "bad", "comedy"],
    exploration: "bad",
    feedback: [
      ...records,
      { ...records[309], value: "hide", updated: 999 },
      null,
      { ...records[0], name: 123 },
    ],
  });
  assert.equal(taste.feedback.length, 300);
  assert.equal(taste.feedback[0].value, "hide");
  assert.deepEqual(taste.genres, ["comedy"]);
  assert.equal(taste.exploration, "balanced");
  assert.ok(!JSON.stringify(taste).includes("secret"));
  assert.throws(() => editTaste(taste, feedback(movie("x"), "fake")));
});
test("liking produces an evidence-based reason, hiding is reversible and does not erase likes for other titles", () => {
  const taste = editTaste({}, feedback(movie("A story", ["Mystery"])), 100);
  const picks = recommendTaste(
    [
      movie("A story", ["Mystery"]),
      movie("match", ["Mystery"]),
      movie("other", ["Comedy"]),
    ],
    taste,
  );
  assert.equal(picks[0].meta.id, "match");
  assert.match(picks[0].reason, /A story/);
  const hidden = editTaste(taste, feedback(picks[0].meta, "hide"), 200);
  assert.deepEqual(recommendTaste([picks[0].meta], hidden), []);
  assert.equal(
    recommendTaste(
      [picks[0].meta],
      editTaste(hidden, feedback(picks[0].meta, "clear")),
    ).length,
    1,
  );
  assert.equal(hidden.feedback.filter((f) => f.value === "like").length, 1);
});
test("recommendations exclude future and completed titles and never invent a duration", () => {
  const metas = [
    movie("done"),
    movie("future", [], { releaseInfo: "2099" }),
    movie("unknown"),
    movie("short", [], { runtime: "85 min" }),
    movie("long", [], { runtime: 125 }),
    movie("show", [], { type: "series", runtime: 40 }),
  ];
  const options = {
    watched: new Set(["movie:done"]),
    maxMinutes: 90,
    now: Date.parse("2026-10-03"),
  };
  assert.deepEqual(
    recommendTaste(metas, {}, options).map((p) => p.meta.id),
    ["short"],
  );
  assert.deepEqual(
    recommendTaste(
      metas,
      {},
      { ...options, maxMinutes: 0, type: "series" },
    ).map((p) => p.meta.id),
    ["show"],
  );
});
test("curious mode reserves room for a known different genre and familiar mode respects explicit choices", () => {
  const metas = [
    ...Array.from({ length: 9 }, (_, i) => movie("comedy" + i)),
    movie("different", ["Documentary"]),
    movie("unknown", []),
  ];
  const curious = recommendTaste(metas, {
    genres: ["comedy"],
    exploration: "curious",
  });
  assert.equal(curious[0].meta.id, "different");
  assert.match(curious[0].reason, /نوع مختلف/);
  assert.ok(
    !recommendTaste(metas, {
      genres: ["comedy"],
      exploration: "familiar",
    }).some((p) => p.meta.id === "different"),
  );
  assert.equal(recommendTaste(metas, {}).length, 8);
});
test("catalog sampling interleaves, deduplicates and fills missing genres on duplicate metadata", () => {
  const pool = tasteCandidates([
    { metas: [movie("same", []), movie("a")] },
    { metas: [movie("same", ["Mystery"]), movie("b")] },
    { metas: [movie("c")] },
  ]);
  assert.deepEqual(
    pool.map((m) => m.id),
    ["same", "c", "a", "b"],
  );
  assert.deepEqual(pool[0].genres, ["Mystery"]);
  assert.equal(
    tasteCandidates(
      Array.from({ length: 80 }, (_, r) => ({
        metas: Array.from({ length: 100 }, (_, i) => movie(`${r}-${i}`)),
      })),
    ).length,
    600,
  );
});
test("taste affinity can break a session tie while preserving time and intermission constraints", () => {
  const candidates = [movie("a", ["Drama"]), movie("b", ["Comedy"])].map(
    (meta) => ({ meta, key: meta.id, minutes: 50, origin: "discover" }),
  );
  const profile = tasteProfile({ genres: ["comedy"] });
  const plan = planSession(candidates, {
    budget: 60,
    affinity: (meta) => tasteAffinity(meta, profile),
  });
  assert.equal(plan.items[0].meta.id, "b");
  assert.equal(plan.minutes, 50);
});
test("taste edits stay with their profile, survive restart and backup, and refuse stale owners", () => {
  let saved;
  const c = new Client({
    load: () => ({}),
    save: (s) => {
      saved = structuredClone(s);
    },
  });
  c.tasteEdit({ ...feedback(movie("mine")), profileId: "default" });
  c.tasteEdit({
    action: "preferences",
    genres: ["comedy"],
    profileId: "default",
  });
  c.profiles.create({ name: "guest" });
  const guest = c.profiles.store.list.find((p) => p.id !== "default").id;
  c.profiles.switch({ id: guest });
  assert.deepEqual(c.state.settings.taste.feedback, []);
  assert.throws(
    () => c.tasteEdit({ ...feedback(movie("late")), profileId: "default" }),
    /تغير الملف/,
  );
  c.profiles.switch({ id: "default" });
  const restart = new Client({ load: () => saved, save() {} });
  assert.equal(restart.state.settings.taste.feedback[0].id, "mine");
  const { payload } = collectBackup(saved);
  payload.profiles.data.default.settings.taste.feedback[0].streamUrl = "secret";
  const restored = restoreState({}, payload);
  assert.equal(
    restored.profiles.data.default.settings.taste.feedback[0].id,
    "mine",
  );
  assert.ok(
    !JSON.stringify(restored.profiles.data.default.settings.taste).includes(
      "secret",
    ),
  );
  c.tasteEdit({ action: "reset", profileId: "default" });
  assert.deepEqual(c.state.settings.taste, cleanTaste({}));
});
test("taste mutations respect the library room PIN and are never available to the player HUD", () => {
  const c = new Client({ load: () => ({}), save() {} });
  c.profiles.setPin({ id: "default", pin: "1234" });
  c.profiles.store.list[0].lockedRooms = ["library"];
  c.profiles.unlocked = false;
  assert.throws(() =>
    c.tasteEdit({ ...feedback(movie("x")), profileId: "default" }),
  );
  assert.deepEqual(c.state.settings.taste.feedback, []);
  assert.ok(!HUD_METHODS.has("tasteEdit"));
});
test("the new shelf joins existing homes but a deliberate hide remains hidden", () => {
  const old = DEFAULT_HOME_SECTIONS.filter((id) => id !== "taste");
  assert.ok(visibleHomeSections(old, old).includes("taste"));
  assert.ok(!visibleHomeSections(old, DEFAULT_HOME_SECTIONS).includes("taste"));
});
