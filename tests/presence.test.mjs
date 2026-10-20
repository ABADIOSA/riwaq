import test from "node:test";
import assert from "node:assert/strict";
import { RIWAQ_ICON, buildActivity, episodeLine } from "../core/presence.mjs";

const at = 1_800_000_000_000;
test("browsing can be hidden without hiding playback or overriding off privacy", () => {
  assert.equal(buildActivity({ browsing: false }), null);
  assert.equal(buildActivity({ browsing: true }).type, 0);
  assert.deepEqual(
    buildActivity({ ...viewing, browsing: false }),
    buildActivity(viewing),
  );
  assert.equal(
    buildActivity({ ...viewing, browsing: false, detail: "off" }),
    null,
  );
});
const viewing = {
  playing: true,
  title: "Daredevil: Born Again",
  year: "2025",
  poster: "https://images.metahub.space/poster/medium/tt18923754/img",
  imdb: "tt18923754",
  season: "1",
  number: "3",
  episodeTitle: "Optics",
  position: 600,
  duration: 3000,
  at,
};

test("episode artwork accompanies the cover without leaking it at generic/off privacy levels", () => {
  const episodePoster = "https://image.tmdb.org/t/p/w400/episode.jpg";
  const full = buildActivity({ ...viewing, episodePoster });
  assert.equal(full.assets.large_image, viewing.poster);
  assert.equal(full.assets.small_image, episodePoster);
  assert.equal(full.assets.small_text, "S1 · E3 — Optics");
  const generic = buildActivity({
    ...viewing,
    episodePoster,
    detail: "generic",
  });
  assert.ok(!JSON.stringify(generic).includes(episodePoster));
  for (const value of [
    "http://host/image.jpg",
    "https://user:secret@host/image.jpg",
    "https://host/image.jpg?token=private",
    "https://host/image.jpg#secret",
    "https://private-addon.test/secret-token/episode.jpg",
  ])
    assert.equal(
      buildActivity({ ...viewing, episodePoster: value }).assets.small_image,
      RIWAQ_ICON,
    );
  assert.equal(
    buildActivity({ ...viewing, live: true, episodePoster }).assets.small_image,
    RIWAQ_ICON,
  );
});

test("a viewing shows as Watching the title, with poster, episode and a progress bar", () => {
  const a = buildActivity(viewing);
  assert.equal(a.type, 3);
  assert.equal(a.status_display_type, 2, "the member list shows the title");
  assert.equal(a.details, "Daredevil: Born Again");
  assert.equal(a.state, "S1 · E3 — Optics");
  assert.equal(a.assets.large_image, viewing.poster);
  assert.equal(a.assets.large_text, "Daredevil: Born Again (2025)");
  assert.equal(a.assets.small_image, RIWAQ_ICON);
  assert.deepEqual(a.timestamps, { start: at - 600_000, end: at + 2_400_000 });
  assert.deepEqual(a.buttons, [
    {
      label: "صفحة العمل على IMDb",
      url: "https://www.imdb.com/title/tt18923754/",
    },
  ]);
  assert.ok(a.buttons[0].label.length <= 32);
});

test("paused, film and live viewings", () => {
  const paused = buildActivity({ ...viewing, paused: true });
  assert.equal(paused.state, "S1 · E3 — Optics · متوقف مؤقتاً");
  assert.equal(paused.timestamps, undefined);
  assert.equal(paused.assets.small_text, "متوقف مؤقتاً");
  const film = buildActivity({
    ...viewing,
    season: undefined,
    number: undefined,
    episodeTitle: "",
  });
  assert.equal(film.state, "2025");
  const live = buildActivity({ ...viewing, live: true, season: undefined });
  assert.deepEqual(live.timestamps, { start: at - 600_000 });
});

test("the generic level shares no title, poster or link", () => {
  const g = buildActivity({ ...viewing, detail: "generic" });
  assert.equal(g.details, "يشاهد شيئاً");
  assert.equal(g.status_display_type, 0);
  assert.equal(g.assets.large_image, RIWAQ_ICON);
  assert.equal(g.buttons, undefined);
  assert.doesNotMatch(JSON.stringify(g), /Daredevil|tt18923754|Optics/);
  assert.equal(buildActivity({ ...viewing, detail: "off" }), null);
});

test("only https pictures and real IMDb IDs are passed to Discord", () => {
  for (const poster of [
    "http://plain.example/p.jpg",
    "https://user:pw@host.example/p.jpg",
    `https://host.example/${"x".repeat(400)}`,
    "file:///C:/Users/me/p.jpg",
  ]) {
    const a = buildActivity({ ...viewing, poster });
    assert.equal(a.assets.large_image, RIWAQ_ICON, poster.slice(0, 30));
    assert.equal(a.assets.small_image, undefined);
  }
  assert.equal(
    buildActivity({ ...viewing, imdb: "C:\\\\tt1\\\\movie.mkv" }).buttons,
    undefined,
  );
  assert.equal(
    buildActivity({ ...viewing, imdb: "kitsu:1" }).buttons,
    undefined,
  );
});

test("episode lines and Discord's text limits", () => {
  assert.equal(episodeLine({ season: 0, number: 2 }), "S0 · E2");
  assert.equal(episodeLine({ episode: "S01E02" }), "S01E02");
  assert.equal(episodeLine({ episode: "x" }), "");
  const long = buildActivity({ ...viewing, title: "ع".repeat(300) });
  assert.equal(long.details.length, 128);
  assert.equal(buildActivity({ ...viewing, title: "" }).details, "بلا عنوان");
  assert.equal(buildActivity({ playing: false }).type, 0);
});
