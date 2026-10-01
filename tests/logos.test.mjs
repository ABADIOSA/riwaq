import test from "node:test";
import assert from "node:assert/strict";
import {
  logoCandidates,
  logoFindRequest,
  logoImagesRequest,
  logoOrder,
  metahubLogo,
  parseLogoFind,
  pickLogos,
} from "../core/logos.mjs";
import { DEFAULT_SETTINGS, safeSettings } from "../core/protocol.mjs";

const body = {
  logos: [
    { file_path: "/en1.png", iso_639_1: "en", vote_average: 5.4 },
    { file_path: "/en2.png", iso_639_1: "en", vote_average: 5.9 },
    { file_path: "/ar.svg", iso_639_1: "ar", vote_average: 1 },
    { file_path: "/ja.png", iso_639_1: "ja", vote_average: 5 },
    { file_path: "/none.png", iso_639_1: null, vote_average: 9 },
    { file_path: "/fr.png", iso_639_1: "fr", vote_average: 9 },
    { file_path: "../bad.png", iso_639_1: "ar" },
    { file_path: "/photo.jpg", iso_639_1: "ar" },
  ],
};

test("logos rank Arabic first, or the original language first", () => {
  assert.deepEqual(logoOrder("arabic", "ja"), ["ar", "ja", "en", null]);
  assert.deepEqual(logoOrder("original", "ja"), ["ja", "en", "ar", null]);
  assert.deepEqual(logoOrder("original", "en"), ["en", "ar", null]);
  assert.deepEqual(logoOrder("arabic", "bad!"), ["ar", "en", null]);
  assert.deepEqual(
    pickLogos(body, "arabic", "ja", 4).map((l) => l.url),
    [
      "https://image.tmdb.org/t/p/original/ar.svg",
      "https://image.tmdb.org/t/p/w500/ja.png",
      "https://image.tmdb.org/t/p/w500/en2.png",
      "https://image.tmdb.org/t/p/w500/en1.png",
    ],
  );
  assert.deepEqual(
    pickLogos(body, "original", "ja", 2).map((l) => l.lang),
    ["ja", "en"],
  );
  // French is neither Arabic, English, the original nor textless.
  assert.ok(!pickLogos(body, "arabic", "en", 10).some((l) => l.lang === "fr"));
  assert.deepEqual(pickLogos(body, "text", "ja"), []);
  assert.deepEqual(pickLogos({ logos: "x" }), []);
});

test("logo requests take only validated IDs and languages", () => {
  assert.deepEqual(logoFindRequest("tt4154796"), {
    path: "find/tt4154796",
    params: { external_source: "imdb_id" },
  });
  assert.equal(logoFindRequest("tt1/../x"), null);
  assert.deepEqual(
    parseLogoFind(
      { tv_results: [{ id: 1399, original_language: "en" }] },
      "series",
    ),
    { tmdbId: "1399", original: "en" },
  );
  assert.equal(parseLogoFind({ movie_results: [] }, "movie"), null);
  assert.equal(
    parseLogoFind(
      { movie_results: [{ id: 5, original_language: "<x>" }] },
      "movie",
    ).original,
    "",
  );
  assert.deepEqual(logoImagesRequest("movie", "299536", "ja"), {
    path: "movie/299536/images",
    params: { include_image_language: "ar,en,null,ja" },
  });
  assert.equal(
    logoImagesRequest("series", "1399", "en").params.include_image_language,
    "ar,en,null",
  );
  assert.equal(logoImagesRequest("movie", "1/../2"), null);
});

test("logo candidates fall back from TMDB to the addon and metahub", () => {
  assert.equal(
    metahubLogo("tt0944947:1:2"),
    "https://images.metahub.space/logo/medium/tt0944947/img",
  );
  assert.equal(metahubLogo("kitsu:1"), "");
  assert.deepEqual(
    logoCandidates({
      tmdb: [{ url: "https://image.tmdb.org/t/p/w500/a.png" }],
      addonLogo: "https://images.metahub.space/logo/medium/tt0944947/img",
      id: "tt0944947",
      mode: "arabic",
    }),
    [
      "https://image.tmdb.org/t/p/w500/a.png",
      "https://images.metahub.space/logo/medium/tt0944947/img",
    ],
  );
  assert.deepEqual(
    logoCandidates({
      addonLogo: "http://user:pw@example.com/logo.png",
      id: "kitsu:1",
      mode: "arabic",
    }),
    [],
  );
  assert.deepEqual(
    logoCandidates({ addonLogo: "https://x.example/l.png", mode: "text" }),
    [],
  );
});

test("logo and hero settings are validated", () => {
  assert.equal(DEFAULT_SETTINGS.titleLogos, "arabic");
  assert.equal(DEFAULT_SETTINGS.heroAutoplay, true);
  const next = safeSettings({ titleLogos: "original", heroAutoplay: false });
  assert.equal(next.titleLogos, "original");
  assert.equal(next.heroAutoplay, false);
  const bad = safeSettings({ titleLogos: "huge", heroAutoplay: "yes" });
  assert.equal(bad.titleLogos, "arabic");
  assert.equal(bad.heroAutoplay, true);
});

test("titleLogos asks TMDB once per title and mode, and only with a key", async () => {
  const { Client } = await import("../core/client.mjs");
  const calls = [];
  const fake = {
    state: {
      settings: { titleLogos: "arabic" },
      providers: { tmdb: { key: "k", enabled: true } },
    },
    async tmdbCall(path, params) {
      calls.push(path);
      if (path.startsWith("find/"))
        return { movie_results: [{ id: 299536, original_language: "en" }] };
      return body;
    },
  };
  const titleLogos = Client.prototype.titleLogos.bind(fake);
  const first = await titleLogos({ type: "movie", id: "tt4154796" });
  assert.equal(first.logos[0].lang, "ar");
  await titleLogos({ type: "movie", id: "tt4154796" });
  assert.deepEqual(calls, ["find/tt4154796", "movie/299536/images"]);
  fake.state.providers.tmdb.key = "";
  assert.deepEqual(await titleLogos({ type: "movie", id: "tt0000001" }), {
    logos: [],
    needs: ["tmdb"],
  });
  fake.state.settings.titleLogos = "text";
  assert.deepEqual(
    (await titleLogos({ type: "movie", id: "tt4154796" })).logos,
    [],
  );
  await assert.rejects(titleLogos({ type: "tv", id: "x" }));
});
