import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { localTorrentLink, magnetOf } from "../core/torrent-engine.mjs";
import { parseStream } from "../core/stream-engine.mjs";
import { translate } from "../core/i18n.mjs";

const read = (path) =>
  readFileSync(fileURLToPath(new URL("../" + path, import.meta.url)), "utf8");

// #113: Take a screenshot, Copy torrent link, Copy magnet link, Download
// video. The torrent link is the address the torrent plays from on this
// computer (for another player); the magnet is its hash and trackers.
test("the player menu lists the four items of #113 in order", () => {
  const menu = read("src/components/PlayerMenu.jsx");
  const runs = [...menu.matchAll(/run\("(\w+)"\)/g)].map((m) => m[1]);
  assert.deepEqual(runs, [
    "screenshot",
    "copyTorrentLink",
    "copyMagnet",
    "download",
  ]);
  const labels = [
    "التقط لقطة شاشة",
    "نسخ رابط التورنت",
    "نسخ رابط المغناطيس",
    "تنزيل الفيديو",
  ];
  const at = labels.map((label) => menu.indexOf(label));
  assert.ok(at.every((i) => i > 0));
  assert.deepEqual(
    [...at].sort((a, b) => a - b),
    at,
  );
  assert.deepEqual(
    labels.map((label) => translate(label, "en")),
    [
      "Take a screenshot",
      "Copy torrent link",
      "Copy magnet link",
      "Download video",
    ],
  );
  // No word about a missing torrent file is left from 0.53.0.
  assert.doesNotMatch(menu, /magnet-note|ملف تورنت منفصل/);
  const main = read("electron/main.mjs");
  const action = main.slice(
    main.indexOf("async function playbackAction"),
    main.indexOf("// The built-in torrent engine"),
  );
  assert.deepEqual(
    [...action.matchAll(/action === "(\w+)"/g)].map((m) => m[1]),
    ["screenshot", "copyTorrentLink", "copyMagnet", "download"],
  );
  // The clipboard receives only an engine's checked address or the magnet.
  assert.deepEqual(
    [...action.matchAll(/clipboard\.writeText\(([^)]*\)?)\)/g)].map(
      (m) => m[1],
    ),
    ["link", "magnetOf(stream)"],
  );
  assert.match(
    action,
    /const link = localTorrentLink\(player\.source\?\.url, torrentEngines\(\)\)/,
  );
});

test("a torrent link is only a torrent engine's own address on this computer", () => {
  const hash = "b".repeat(40);
  const engines = [
    "http://127.0.0.1:11470",
    "http://127.0.0.1:52011",
    "http://127.0.0.1:40123",
  ];
  for (const address of [
    // Stremio Service, the built-in engine (path token, file hint), TorrServer.
    `http://127.0.0.1:11470/${hash}/0`,
    `http://127.0.0.1:52011/${"c".repeat(32)}/${hash}/3?f=Show%20S01E02.mkv`,
    `http://127.0.0.1:40123/stream/Show.mkv?link=${hash}&index=2&play`,
  ])
    assert.equal(localTorrentLink(address, engines), new URL(address).href);
  assert.equal(
    localTorrentLink(`http://localhost:11470/${hash}/0`, [
      "http://localhost:11470/",
    ]),
    `http://localhost:11470/${hash}/0`,
  );
  for (const address of [
    // A debrid or home-server address, even on this computer.
    "https://debrid.example/dl/secret-token/file.mkv",
    "http://127.0.0.1:8096/Videos/1/stream?api_key=secret",
    // Credentials, another scheme, another host on the engine's port.
    `http://user:pass@127.0.0.1:11470/${hash}/0`,
    `https://127.0.0.1:11470/${hash}/0`,
    `http://192.168.1.4:11470/${hash}/0`,
    `http://127.0.0.2:11470/${hash}/0`,
    "magnet:?xt=urn:btih:" + hash,
    "",
    null,
    "not a url",
  ])
    assert.equal(localTorrentLink(address, engines), "", String(address));
  // No engine running: nothing to copy, whatever the address.
  assert.equal(localTorrentLink(`http://127.0.0.1:11470/${hash}/0`, []), "");
  assert.equal(
    localTorrentLink(`http://127.0.0.1:11470/${hash}/0`, ["garbage", null]),
    "",
  );
  // A remote Stremio server is the viewer's, but its address is not copied.
  assert.equal(
    localTorrentLink(`http://192.168.1.4:11470/${hash}/0`, [
      "http://192.168.1.4:11470",
    ]),
    "",
  );
});

test("a magnet holds the hash and trackers only, never the stream's address or headers", () => {
  const hash = "a".repeat(40);
  const stream = {
    infoHash: hash.toUpperCase(),
    fileIdx: 2,
    sources: ["tracker:udp://tracker.example:80/announce", "dht:" + hash],
    url: "https://debrid.example/dl/secret-token/file.mkv",
    behaviorHints: { proxyHeaders: { request: { Authorization: "x" } } },
  };
  assert.equal(parseStream(stream).kind, "torrent");
  const magnet = magnetOf(stream);
  assert.equal(
    magnet,
    `magnet:?xt=urn:btih:${hash}&tr=${encodeURIComponent("udp://tracker.example:80/announce")}`,
  );
  assert.doesNotMatch(magnet, /secret-token|debrid|Authorization/);
  // A direct link is not a torrent, and has no magnet to copy.
  assert.equal(parseStream({ url: stream.url }).kind, "http");
  assert.throws(() => magnetOf({ url: stream.url }));
});
