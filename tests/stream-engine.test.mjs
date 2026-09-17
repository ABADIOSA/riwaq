import test from "node:test";
import assert from "node:assert/strict";
import {
  parseStream,
  trustStream,
  scoreStream,
  tierOf,
  sizeLabel,
  analyzeStreams,
} from "../core/stream-engine.mjs";

const remux = {
  name: "Torrentio\n4k",
  title:
    "Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX.DV.HDR.HEVC.TrueHD.7.1.Atmos-FraMeSToR\n👤 214 💾 78.4 GB",
  infoHash: "a".repeat(40),
};
const cachedWeb = {
  name: "[RD+] Torrentio",
  title: "Dune Part Two 2024 1080p WEB-DL DDP5.1 Atmos H264-FLUX\n💾 9.2 GB",
  url: "https://example.test/one",
};

test("parses resolution, HDR flavour, codec, source, audio and channels", () => {
  const parsed = parseStream(remux);
  assert.equal(parsed.resolution, 2160);
  assert.equal(parsed.hdr, "DV+HDR10");
  assert.equal(parsed.codec, "HEVC");
  assert.equal(parsed.source, "REMUX");
  assert.equal(parsed.audio, "Atmos");
  assert.equal(parsed.channels, "7.1");
  assert.equal(parsed.group, "FraMeSToR");
  assert.equal(parsed.trustedGroup, true);
  assert.equal(parsed.seeders, 214);
  assert.equal(parsed.kind, "torrent");
});

test("a file size is never read as an audio channel layout", () => {
  const parsed = parseStream({
    title: "فيلم 2024 1080p WEB-DL مترجم 💾 2.1 جيجا",
  });
  assert.equal(parsed.channels, "");
  assert.equal(parsed.size, Math.round(2.1 * 1024 ** 3));
});

test("WEB-DL does not register as a Debrid-Link cache hit", () => {
  const plain = parseStream({ title: "Movie 2024 1080p WEB-DL x264" });
  assert.equal(plain.debrid, "");
  assert.equal(plain.cached, false);
  const cached = parseStream(cachedWeb);
  assert.equal(cached.debrid, "RD");
  assert.equal(cached.cached, true);
  const queued = parseStream({
    title: "[RD download] Movie 2024 2160p WEB-DL",
  });
  assert.equal(queued.debrid, "RD");
  assert.equal(queued.cached, false);
});

test("Arabic subtitles and Arabic dubs are separate facts", () => {
  const subbed = parseStream({ title: "فيلم 2024 1080p WEB-DL مترجم عربي" });
  assert.equal(subbed.arabic.sub, true);
  assert.equal(subbed.arabic.dub, false);
  const dubbed = parseStream({ title: "فيلم 2024 1080p WEBRip مدبلج للعربية" });
  assert.equal(dubbed.arabic.dub, true);
  assert.equal(dubbed.arabic.sub, false);
  assert.ok(subbed.languages.includes("ar"));
});

test("regional flag emoji resolve to languages", () => {
  assert.ok(parseStream({ title: "Movie 1080p 🇸🇦" }).languages.includes("ar"));
  assert.ok(
    parseStream({ title: "Movie 1080p 🇯🇵 1080p" }).languages.includes("ja"),
  );
});

test("a .ts container is not mistaken for a telesync", () => {
  assert.equal(
    parseStream({ title: "Show.S01E01.1080p.WEB-DL.ts" }).source,
    "WEB-DL",
  );
  assert.equal(parseStream({ title: "Movie 2024 TS x264" }).source, "TS");
});

test("season and episode are read from both common notations", () => {
  assert.deepEqual(
    (({ season, episode }) => ({ season, episode }))(
      parseStream({ title: "Show.Name.S02E05.1080p" }),
    ),
    { season: 2, episode: 5 },
  );
  assert.deepEqual(
    (({ season, episode }) => ({ season, episode }))(
      parseStream({ title: "Show Name 3x11 720p" }),
    ),
    { season: 3, episode: 11 },
  );
});

test("trust drops samples, trailers, promotional junk and the wrong episode", () => {
  const drop = (stream, context) =>
    trustStream(parseStream(stream), context).rejections.map((r) => r.code);
  assert.deepEqual(drop({ title: "Movie.2024.1080p-SAMPLE.mkv" }), ["sample"]);
  assert.deepEqual(drop({ title: "Movie 2024 Official Trailer 1080p" }), [
    "trailer",
  ]);
  assert.deepEqual(drop({ title: "Movie 2024 1080p www.freemovies.test" }), [
    "junk",
  ]);
  assert.deepEqual(
    drop(
      { title: "Show.S02E07.1080p.WEB-DL" },
      { requested: { season: 2, episode: 5 } },
    ),
    ["episode"],
  );
  assert.deepEqual(drop({ title: "Movie 2024 HDCAM x264" }), ["cam"]);
});

test("a season pack is not rejected for missing the requested episode", () => {
  const parsed = parseStream({ title: "Show.Name.S02.COMPLETE.1080p.WEB-DL" });
  assert.equal(parsed.pack, true);
  assert.equal(
    trustStream(parsed, { requested: { season: 2, episode: 5 } }).ok,
    true,
  );
});

test("safety level decides how much rough material survives", () => {
  const cam = parseStream({ title: "Movie 2024 HDCAM x264" });
  assert.equal(trustStream(cam, { safety: "strict", hideCam: true }).ok, false);
  assert.equal(trustStream(cam, { safety: "off", hideCam: true }).ok, true);
  const screener = parseStream({ title: "Movie 2024 DVDSCR x264" });
  assert.equal(trustStream(screener, { safety: "strict" }).ok, false);
  assert.equal(trustStream(screener, { safety: "balanced" }).ok, true);
});

test("a file far below its claimed bitrate is rejected as undersized", () => {
  const stub = parseStream({ title: "Movie 2024 2160p WEB-DL 💾 90 MB" });
  const context = { requested: { runtime: 120 }, safety: "strict" };
  assert.deepEqual(
    trustStream(stub, context).rejections.map((r) => r.code),
    ["undersized"],
  );
  assert.equal(trustStream(stub, { ...context, safety: "off" }).ok, true);
});

test("a size limit removes offers larger than the viewer's ceiling", () => {
  const parsed = parseStream(remux);
  assert.equal(trustStream(parsed, { sizeLimit: 20 * 1024 ** 3 }).ok, false);
  assert.equal(trustStream(parsed, { sizeLimit: 0 }).ok, true);
});

test("scoring explains itself and honours the quality ceiling", () => {
  const uhd = scoreStream(parseStream(remux), { quality: "1080" });
  const hd = scoreStream(parseStream(cachedWeb), { quality: "1080" });
  assert.ok(uhd.reasons.some((r) => r.code === "resolution"));
  assert.ok(hd.score > 0);
  // Above the ceiling, extra pixels stop paying for themselves.
  const atCeiling = scoreStream(parseStream(remux), { quality: "2160" });
  assert.ok(atCeiling.score > uhd.score);
});

test("an Arabic dub only wins when Arabic audio was asked for", () => {
  const dubbed = parseStream({ title: "فيلم 2024 1080p WEB-DL مدبلج عربي" });
  const wanted = scoreStream(dubbed, {
    audioLanguage: "ara,ar",
    subtitleLanguage: "ara",
  });
  const unwanted = scoreStream(dubbed, {
    audioLanguage: "eng",
    subtitleLanguage: "eng",
  });
  assert.ok(wanted.score > unwanted.score);
  assert.ok(
    unwanted.reasons.some((r) => r.code === "arabic-dub" && r.points < 0),
  );
});

test("a cached debrid offer can be demoted by preference", () => {
  const parsed = parseStream(cachedWeb);
  const first = scoreStream(parsed, { preferCached: true });
  const later = scoreStream(parsed, { preferCached: false });
  assert.ok(first.score > later.score);
});

test("tiers separate Dolby Vision, HDR and rough sources", () => {
  assert.equal(tierOf(parseStream(remux)), "4K_DV");
  assert.equal(
    tierOf(parseStream({ title: "Movie 2160p HDR10 WEB-DL" })),
    "4K_HDR",
  );
  assert.equal(tierOf(parseStream({ title: "Movie 2160p WEB-DL" })), "4K");
  assert.equal(
    tierOf(parseStream({ title: "Movie 1080p HDR WEB-DL" })),
    "1080p_HDR",
  );
  assert.equal(tierOf(parseStream({ title: "Movie 720p WEB-DL" })), "720p");
  assert.equal(tierOf(parseStream({ title: "Movie 1080p HDCAM" })), "ROUGH");
});

test("the pipeline ranks, groups and reports what it removed", () => {
  const result = analyzeStreams(
    [
      remux,
      cachedWeb,
      { title: "Movie 2024 1080p-SAMPLE.mkv", url: "https://example.test/s" },
    ],
    {
      quality: "2160",
      hideCam: true,
      audioLanguage: "ara,eng",
      subtitleLanguage: "ara,eng",
    },
    { requested: { runtime: 166 } },
  );
  assert.equal(result.kept.length, 2);
  assert.equal(result.dropped.length, 1);
  assert.equal(result.dropped[0].rejections[0].code, "sample");
  assert.equal(result.kept[0].tier, "4K_DV");
  assert.deepEqual(
    result.groups.map((g) => g.tier),
    ["4K_DV", "1080p"],
  );
  assert.ok(result.kept[0].score >= result.kept[1].score);
});

test("equal offers keep the order their addons returned them in", () => {
  const twin = (name) => ({
    name,
    title: "Movie 2024 1080p WEB-DL x264",
    url: `https://example.test/${name}`,
  });
  const result = analyzeStreams([twin("a"), twin("b"), twin("c")], {}, {});
  assert.deepEqual(
    result.kept.map((entry) => entry.stream.name),
    ["a", "b", "c"],
  );
});

test("human readable sizes", () => {
  assert.equal(sizeLabel(0), "");
  assert.equal(sizeLabel(1536), "1.5 KB");
  assert.equal(sizeLabel(2.5 * 1024 ** 3), "2.5 GB");
});
