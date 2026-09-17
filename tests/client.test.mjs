import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Client, fetchJson } from "../core/client.mjs";
import { keyFor } from "../core/protocol.mjs";
const manifest = {
  id: "test.provider",
  name: "Fixture",
  version: "1.0.0",
  types: ["movie", "series"],
  resources: ["catalog", "meta", "stream", "subtitles"],
  catalogs: [
    {
      type: "movie",
      id: "popular",
      name: "Popular",
      extra: [{ name: "search" }, { name: "skip" }],
    },
  ],
};
function client(options = {}) {
  let saved;
  const c = new Client({
    load: () => ({}),
    save: (s) => {
      saved = structuredClone(s);
    },
    ...options,
  });
  return c;
}
test("real HTTP addon pipeline: install, catalog, metadata, streams and subtitles", async (t) => {
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/manifest.json") return res.end(JSON.stringify(manifest));
    if (req.url.startsWith("/catalog/"))
      return res.end(
        JSON.stringify({
          metas: [{ id: "tt1", name: "Fixture movie", type: "movie" }],
        }),
      );
    if (req.url.startsWith("/meta/"))
      return res.end(
        JSON.stringify({
          meta: { id: "tt1", type: "movie", name: "Fixture movie" },
        }),
      );
    if (req.url.startsWith("/stream/"))
      return res.end(
        JSON.stringify({
          streams: [
            { name: "1080p", url: "https://media.test/video?token=PRIVATE" },
            {
              name: "1080p duplicate",
              url: "https://media.test/video?token=PRIVATE",
            },
            { name: "4K HDR", url: "https://media.test/4k" },
          ],
        }),
      );
    if (req.url.startsWith("/subtitles/"))
      return res.end(
        JSON.stringify({
          subtitles: [
            {
              id: "Arabic",
              lang: "ara",
              url: "https://subtitle.test/private-key/sub.srt",
            },
          ],
        }),
      );
    res.writeHead(404);
    res.end("{}");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const c = client();
  await c.install(`http://127.0.0.1:${server.address().port}/manifest.json`);
  assert.equal((await c.catalog()).rows[0].metas[0].id, "tt1");
  assert.equal(
    (await c.metadata({ type: "movie", id: "tt1" })).name,
    "Fixture movie",
  );
  const result = await c.getStreams({ type: "movie", id: "tt1" });
  assert.equal(result.streams.length, 2);
  assert.equal(result.streams[0].resolution, 2160);
  assert.ok(!JSON.stringify(result).includes("PRIVATE"));
  const subs = await c.getSubtitles({
    type: "movie",
    id: "tt1",
    streamKey: result.streams[0].key,
  });
  assert.equal(subs[0].lang, "ara");
  assert.ok(!JSON.stringify(subs).includes("private-key"));
});
test("failed provider is surfaced while working provider results survive", async () => {
  const c = client({
    load: () => ({
      addons: [
        { transportUrl: "https://bad.test/manifest.json", manifest },
        {
          transportUrl: "https://ok.test/manifest.json",
          manifest: { ...manifest, name: "working" },
        },
      ],
    }),
    request: async (url) => {
      if (url.includes("bad.test")) throw new Error("no");
      return {
        streams: [{ url: "https://media.test/v", name: "720p" }],
        metas: [{ id: "tt1", name: "test" }],
      };
    },
  });
  const streams = await c.getStreams({ type: "movie", id: "tt1" });
  assert.equal(streams.streams.length, 1);
  assert.deepEqual(streams.failures, ["Fixture"]);
  const catalogs = await c.catalog();
  assert.equal(catalogs.rows.length, 1);
  assert.equal(catalogs.failures.length, 1);
});
test("account import preserves configured addons, converts milliseconds, never writes cloud", async () => {
  const methods = [];
  const c = client({
    load: () => ({
      addons: [
        {
          transportUrl: "https://local.test/manifest.json",
          enabled: false,
          manifest,
        },
      ],
    }),
    api: async (method, payload) => {
      methods.push(method);
      assert.equal(payload.authKey, "test-secret");
      return {
        getUser: { email: "test@example.test" },
        addonCollectionGet: {
          addons: [
            {
              transportUrl: "https://remote.test/config-secret/manifest.json",
              manifest,
            },
            {
              transportUrl: "ipfs://legacy",
              manifest: { ...manifest, name: "Legacy" },
            },
          ],
        },
        datastoreMeta: [["tt1", "time"]],
        datastoreGet: [
          {
            _id: "tt1",
            name: "Movie",
            type: "movie",
            removed: false,
            temp: false,
            _mtime: "2026-01-01",
            state: { timeOffset: 25000, duration: 100000, video_id: "tt1" },
          },
        ],
      }[method];
    },
  });
  await c.authenticate("test-secret");
  const result = await c.sync();
  assert.equal(result.imported, 1);
  assert.equal(result.skipped.length, 1);
  assert.equal(c.state.addons.length, 2);
  assert.equal(c.state.addons[0].enabled, false);
  assert.equal(c.state.progress["movie:tt1"].position, 25);
  assert.equal(c.state.favorites.length, 1);
  assert.ok(!JSON.stringify(c.publicState()).includes("test-secret"));
  assert.ok(!JSON.stringify(c.publicState()).includes("config-secret"));
  assert.ok(methods.every((m) => !m.endsWith("Set") && !m.endsWith("Put")));
});
test("invalid cloud response does not erase local addons", async () => {
  const c = client({
    load: () => ({
      auth: { authKey: "key" },
      addons: [{ transportUrl: "https://local.test/manifest.json", manifest }],
    }),
    api: async () => ({}),
  });
  await assert.rejects(() => c.sync());
  assert.equal(c.state.addons.length, 1);
});
test("malformed manifest is rejected before changing persisted data", async () => {
  const c = client({ request: async () => ({ id: "malformed" }) });
  await assert.rejects(() => c.install("https://example.test/manifest.json"));
  assert.equal(c.state.addons.length, 0);
});
test("local library, addon order and progress persist without cloud mutations", () => {
  let saved;
  const c = client({
    load: () => ({
      addons: [
        { transportUrl: "https://a.test/manifest.json", manifest },
        { transportUrl: "https://b.test/manifest.json", manifest },
      ],
    }),
    save: (s) => {
      saved = structuredClone(s);
    },
  });
  c.favorite({ id: "tt1", type: "movie", name: "Title" });
  c.recordProgress({ id: "tt1", type: "movie", name: "Title" }, "tt1", 23, 100);
  c.updateAddon({ key: keyFor("https://b.test/manifest.json"), action: "up" });
  assert.equal(saved.favorites.length, 1);
  assert.equal(saved.progress["movie:tt1"].position, 23);
  assert.equal(saved.addons[0].transportUrl, "https://b.test/manifest.json");
  c.favorite({ id: "tt1", type: "movie", name: "Title" });
  assert.equal(saved.favorites.length, 0);
});

test("stream results carry tiers, reasons and what the engine removed", async () => {
  const c = client({
    load: () => ({
      addons: [{ transportUrl: "https://ok.test/manifest.json", manifest }],
    }),
    request: async () => ({
      streams: [
        {
          name: "good",
          title: "Show.S01E02.2160p.WEB-DL.DV.HEVC.Atmos-FLUX 💾 12 GB",
          url: "https://media.test/a",
        },
        {
          name: "wrong",
          title: "Show.S01E05.1080p.WEB-DL",
          url: "https://media.test/b",
        },
        {
          name: "sample",
          title: "Show.S01E02.1080p-SAMPLE.mkv",
          url: "https://media.test/c",
        },
      ],
    }),
  });
  const result = await c.getStreams({ type: "series", id: "tt1:1:2" });
  assert.equal(result.streams.length, 1);
  assert.equal(result.streams[0].tier, "4K_DV");
  assert.equal(result.streams[0].sizeLabel, "12 GB");
  assert.ok(result.streams[0].reasons.length > 0);
  assert.deepEqual(
    result.dropped.map((entry) => entry.reasons[0].code).sort(),
    ["episode", "sample"],
  );
  assert.deepEqual(
    result.groups.map((group) => group.tier),
    ["4K_DV"],
  );
});

test("the safety setting reaches the engine through the client", async () => {
  const request = async () => ({
    streams: [
      {
        name: "cam",
        title: "Movie 2024 HDCAM x264",
        url: "https://media.test/a",
      },
    ],
  });
  const strict = client({
    load: () => ({
      addons: [{ transportUrl: "https://ok.test/manifest.json", manifest }],
    }),
    request,
  });
  assert.equal(
    (await strict.getStreams({ type: "movie", id: "tt1" })).streams.length,
    0,
  );
  const relaxed = client({
    load: () => ({
      addons: [{ transportUrl: "https://ok.test/manifest.json", manifest }],
      settings: { streamSafety: "off", hideCam: false },
    }),
    request,
  });
  assert.equal(
    (await relaxed.getStreams({ type: "movie", id: "tt1" })).streams.length,
    1,
  );
});
