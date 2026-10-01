import test from "node:test";
import assert from "node:assert/strict";
import {
  artworkHost,
  fanartRequest,
  mergeArtwork,
  metaArtwork,
  parseFanart,
  parseTmdbImages,
  tmdbImagesRequest,
} from "../core/artwork.mjs";
import { DEFAULT_SETTINGS, safeSettings } from "../core/protocol.mjs";
import { Client } from "../core/client.mjs";

const manifest = {
  id: "meta.provider",
  name: "Meta",
  version: "1.0.0",
  types: ["movie", "series"],
  resources: ["meta"],
  catalogs: [],
  idPrefixes: ["tt"],
};

test("TMDB images: Arabic posters first, textless backdrops first, SVG kept whole", () => {
  assert.deepEqual(tmdbImagesRequest("series", 1399), {
    path: "tv/1399/images",
    params: { include_image_language: "ar,en,null" },
  });
  assert.equal(tmdbImagesRequest("movie", "x"), null);
  const out = parseTmdbImages({
    backdrops: [
      { file_path: "/en.jpg", iso_639_1: "en", vote_average: 9 },
      {
        file_path: "/clean.jpg",
        iso_639_1: null,
        vote_average: 5,
        width: 3840,
        height: 2160,
      },
      { file_path: "../bad.jpg" },
    ],
    posters: [
      { file_path: "/en.jpg", iso_639_1: "en", vote_average: 8 },
      { file_path: "/ar.jpg", iso_639_1: "ar", vote_average: 2 },
    ],
    logos: [{ file_path: "/logo.svg", iso_639_1: "en" }],
  });
  assert.deepEqual(
    out.backdrops.map((i) => i.thumb),
    [
      "https://image.tmdb.org/t/p/w780/clean.jpg",
      "https://image.tmdb.org/t/p/w780/en.jpg",
    ],
  );
  assert.equal(
    out.backdrops[0].full,
    "https://image.tmdb.org/t/p/original/clean.jpg",
  );
  assert.equal(out.backdrops[0].width, 3840);
  assert.equal(out.posters[0].lang, "ar");
  assert.equal(
    out.logos[0].thumb,
    "https://image.tmdb.org/t/p/original/logo.svg",
  );
});

test("Fanart.tv art is sorted into tabs, with previews and only its own host", () => {
  assert.equal(
    fanartRequest("movie", { imdb: "tt0111161" }),
    "movies/tt0111161",
  );
  assert.equal(fanartRequest("movie", { tmdbId: 278 }), "movies/278");
  assert.equal(fanartRequest("series", { tvdbId: 121361 }), "tv/121361");
  assert.equal(fanartRequest("series", { imdb: "tt0944947" }), null);
  const a = "https://assets.fanart.tv/fanart/movies/278";
  const out = parseFanart({
    moviebackground: [{ url: `${a}/bg1.jpg`, likes: "2", lang: "" }],
    movieposter: [{ url: `${a}/p.jpg`, lang: "en", likes: "1" }],
    hdmovielogo: [
      { url: `${a}/l1.png`, lang: "en", likes: "1" },
      { url: `${a}/l2.png`, lang: "ar", likes: "5" },
    ],
    hdmovieclearart: [{ url: `${a}/c.png`, lang: "00" }],
    moviedisc: [{ url: `${a}/d.png` }],
    moviethumb: [{ url: "https://evil.example/x.jpg" }],
  });
  assert.equal(
    out.backdrops[0].thumb,
    "https://assets.fanart.tv/preview/movies/278/bg1.jpg",
  );
  assert.equal(out.backdrops[0].full, `${a}/bg1.jpg`);
  assert.deepEqual(
    out.logos.map((l) => l.lang),
    ["ar", "en"],
    "most liked first",
  );
  assert.deepEqual(
    out.fanart.map((f) => f.kind),
    ["فن شفاف", "قرص"],
  );
  assert.equal(out.fanart[0].lang, "", "00 means no language");
  assert.equal(out.posters[0].source, "Fanart.tv");
});

test("without keys the gallery still has the addon's and metahub's images", () => {
  const out = metaArtwork({
    id: "tt0111161",
    poster: "https://images.metahub.space/poster/medium/tt0111161/img",
    background: "http://insecure.example/bg.jpg",
    logo: "https://addon.example/logo.png",
  });
  assert.equal(out.backdrops.length, 1, "http dropped, metahub added");
  assert.equal(out.posters.length, 2);
  assert.equal(out.logos[0].full, "https://addon.example/logo.png");
  const merged = mergeArtwork(out, {
    posters: [{ full: out.posters[0].full, thumb: "x" }],
  });
  assert.equal(merged.posters.length, 2, "no repeats");
});

test("only the artwork hosts may be opened in the browser", () => {
  assert.equal(artworkHost("https://image.tmdb.org/t/p/original/a.jpg"), true);
  assert.equal(
    artworkHost("https://assets.fanart.tv/fanart/movies/1/a.jpg"),
    true,
  );
  assert.equal(artworkHost("http://image.tmdb.org/t/p/original/a.jpg"), false);
  assert.equal(artworkHost("https://evil.example/a.jpg"), false);
  assert.equal(artworkHost("file:///C:/a.jpg"), false);
});

test("sources wait for Play unless the viewer asks for them on opening", () => {
  assert.equal(DEFAULT_SETTINGS.sourcesOnOpen, false);
  assert.equal(safeSettings({ sourcesOnOpen: true }).sourcesOnOpen, true);
  assert.equal(safeSettings({ sourcesOnOpen: "yes" }).sourcesOnOpen, false);
});

function client(request, keys = {}) {
  const c = new Client({
    load: () => ({
      addons: [
        { transportUrl: "https://meta.example/manifest.json", manifest },
      ],
    }),
    save: () => {},
    request,
  });
  for (const [id, key] of Object.entries(keys)) c.dataHub.save({ id, key });
  return c;
}

test("the client gathers TMDB and Fanart.tv art with keys kept in main", async () => {
  const seen = [];
  const c = client(
    async (url) => {
      seen.push(url);
      const u = new URL(url);
      if (u.hostname === "meta.example")
        return {
          meta: {
            id: "tt0903747",
            type: "series",
            name: "Breaking Bad",
            poster: "https://meta.example/p.jpg",
          },
        };
      if (u.pathname === "/3/find/tt0903747")
        return { tv_results: [{ id: 1396 }] };
      if (u.pathname === "/3/tv/1396")
        return { name: "بريكنغ باد", external_ids: { tvdb_id: 81189 } };
      if (u.pathname === "/3/tv/1396/images")
        return {
          backdrops: [{ file_path: "/b.jpg" }],
          posters: [{ file_path: "/p.jpg", iso_639_1: "ar" }],
          logos: [],
        };
      if (u.pathname === "/3/tv/1396/external_ids") return { tvdb_id: 81189 };
      if (
        u.hostname === "webservice.fanart.tv" &&
        u.pathname === "/v3/tv/81189"
      )
        return {
          characterart: [
            {
              url: "https://assets.fanart.tv/fanart/tv/81189/characterart/x.png",
              likes: "3",
            },
          ],
        };
      throw new Error("HTTP 404");
    },
    { tmdb: "a".repeat(32), fanart: "FANARTKEY" },
  );
  const art = await c.artwork({ type: "series", id: "tt0903747" });
  assert.deepEqual(art.needs, []);
  assert.deepEqual(art.failed, []);
  assert.ok(art.backdrops.some((b) => b.source === "TMDB"));
  assert.equal(
    art.posters[0].full,
    "https://meta.example/p.jpg",
    "the addon's own poster first",
  );
  assert.equal(art.fanart[0].kind, "رسم الشخصيات");
  const text = JSON.stringify(art);
  assert.ok(!text.includes("FANARTKEY") && !text.includes("a".repeat(32)));
  assert.ok(
    seen.some((u) => u.includes("api_key=FANARTKEY")),
    "the key went only to Fanart.tv",
  );
  // Cached: a second look sends nothing.
  const before = seen.length;
  await c.artwork({ type: "series", id: "tt0903747" });
  assert.equal(seen.length, before);
});

test("missing keys are named, and a title Fanart.tv lacks is not a failure", async () => {
  const bare = client(async (url) => {
    if (url.includes("meta.example"))
      return { meta: { id: "tt0111161", type: "movie", name: "X" } };
    throw new Error("HTTP 404");
  });
  const art = await bare.artwork({ type: "movie", id: "tt0111161" });
  assert.deepEqual(art.needs, ["tmdb", "fanart"]);
  assert.equal(art.backdrops[0].source, "Metahub");
  const fanartOnly = client(
    async (url) => {
      if (url.includes("meta.example"))
        return { meta: { id: "tt0111161", type: "movie", name: "X" } };
      throw new Error("HTTP 404");
    },
    { fanart: "K" },
  );
  const art2 = await fanartOnly.artwork({ type: "movie", id: "tt0111161" });
  assert.deepEqual(art2.failed, []);
  assert.deepEqual(art2.needs, ["tmdb"]);
  await assert.rejects(bare.artwork({ type: "tv", id: "x" }), /غير صالح/);
});
