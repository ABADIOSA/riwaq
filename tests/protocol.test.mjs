import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAddon,
  resourceUrl,
  accepts,
  catalogExtras,
  mergeAddons,
  torrentUrl,
  continueWatching,
  safeSettings,
  DEFAULT_SETTINGS,
} from "../core/protocol.mjs";
import { playerArgs } from "../electron/player.mjs";

test("configured addon URL preserves path, encoded secrets and query", () => {
  assert.equal(
    normalizeAddon(
      "stremio://example.test/key%2Fvalue/manifest.json?token=abc",
    ),
    "https://example.test/key%2Fvalue/manifest.json?token=abc",
  );
  assert.equal(
    normalizeAddon(" https://example.test/config/ "),
    "https://example.test/config/manifest.json",
  );
  for (const url of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "https://user:password@example.com/manifest.json",
  ])
    assert.throws(() => normalizeAddon(url));
});
test("resource requests encode IDs, search and configuration without losing query", () => {
  const url = resourceUrl(
    "https://example.test/private%2Fkey/manifest.json?api=token",
    "stream",
    "series",
    "tt123:1:2",
    { search: "a/b & العربية" },
  );
  assert.equal(
    url,
    "https://example.test/private%2Fkey/stream/series/tt123%3A1%3A2/search=a%2Fb%20%26%20%D8%A7%D9%84%D8%B9%D8%B1%D8%A8%D9%8A%D8%A9.json?api=token",
  );
});
test("resource-level types and prefixes override manifest-level restrictions", () => {
  const m = {
    types: ["movie"],
    idPrefixes: ["tt"],
    resources: [
      "meta",
      { name: "stream", types: ["series"] },
      { name: "subtitles", types: ["series"], idPrefixes: ["kitsu:"] },
    ],
  };
  assert.equal(accepts(m, "meta", "movie", "tt1"), true);
  assert.equal(accepts(m, "meta", "series", "tt1"), false);
  assert.equal(accepts(m, "stream", "series", "custom:1"), true);
  assert.equal(accepts(m, "subtitles", "series", "tt1"), false);
});
test("catalog extras honor required inputs and search capability", () => {
  assert.equal(
    catalogExtras({ extra: [{ name: "search", isRequired: true }] }),
    null,
  );
  assert.equal(catalogExtras({ extra: [] }, "query"), null);
  assert.deepEqual(
    catalogExtras(
      {
        extra: [
          { name: "genre", isRequired: true, options: ["Drama"] },
          { name: "skip" },
        ],
      },
      "",
      "",
      100,
    ),
    { skip: 100, genre: "Drama" },
  );
  assert.deepEqual(catalogExtras({ extra: [{ name: "search" }] }, "عربي"), {
    search: "عربي",
  });
});
test("sync preserves differently configured instances and disabled local state", () => {
  const m = { id: "same", name: "one" };
  const local = [
    {
      transportUrl: "https://example.test/a/manifest.json",
      enabled: false,
      manifest: m,
    },
  ];
  const result = mergeAddons(local, [
    {
      transportUrl: local[0].transportUrl,
      manifest: { ...m, name: "updated" },
    },
    { transportUrl: "https://example.test/b/manifest.json", manifest: m },
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].enabled, false);
  assert.equal(result[0].manifest.name, "updated");
  assert.equal(result[1].enabled, true);
  assert.equal(local[0].manifest.name, "one");
});
test("torrent paths use largest-file sentinel and preserve trackers", () => {
  const hash = "A".repeat(40);
  const url = torrentUrl(
    {
      infoHash: hash,
      sources: ["tracker:udp://tracker.test:80", "dht:" + hash],
    },
    "http://127.0.0.1:11470",
  );
  assert.ok(url.includes("/" + "a".repeat(40) + "/-1"));
  assert.equal(new URL(url).searchParams.get("tr"), "udp://tracker.test:80");
  assert.throws(() =>
    torrentUrl({ infoHash: "../../../bad" }, "http://localhost:1"),
  );
});
test("continue watching excludes finished titles", () => {
  assert.deepEqual(
    continueWatching({
      a: { position: 97, duration: 100, updated: 3 },
      b: { position: 50, duration: 100, updated: 2 },
      c: { position: 12, duration: 0, updated: 4 },
    }).map((p) => p.updated),
    [4, 2],
  );
});
test("settings clamp values and reject executable overrides from renderer", () => {
  const result = safeSettings({
    subtitleSize: 1000,
    subtitleDelay: -100,
    mpvPath: "attacker.exe",
    quality: "banana",
    subtitleLanguage: "ara;exec",
  });
  assert.equal(result.subtitleSize, 80);
  assert.equal(result.subtitleDelay, -60);
  assert.equal(result.mpvPath, "");
  assert.equal(result.quality, "2160");
  assert.equal(result.subtitleLanguage, DEFAULT_SETTINGS.subtitleLanguage);
  assert.throws(() => safeSettings({ serverUrl: "file:///etc/passwd" }));
});
test("MPV arguments keep stream input separate from options and reject header injection", () => {
  const args = playerArgs({
    pipe: "pipe",
    settings: DEFAULT_SETTINGS,
    url: "https://media.test/$(bad)",
    title: "test --script=bad",
    headers: { Authorization: "Bearer secret", X: "bad\r\nInjected: yes" },
  });
  assert.deepEqual(args.slice(-2), ["--", "https://media.test/$(bad)"]);
  assert.ok(args.includes("--no-config"));
  assert.ok(args.includes("--load-scripts=no"));
  assert.ok(!args.some((s) => s.includes("Injected")));
});
