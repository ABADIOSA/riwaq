import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { magnetOf } from "../core/torrent-engine.mjs";
import { parseStream } from "../core/stream-engine.mjs";
import { translate } from "../core/i18n.mjs";

const read = (path) =>
  readFileSync(fileURLToPath(new URL("../" + path, import.meta.url)), "utf8");

// #113 asked for "Copy torrent link" beside "Copy magnet link". A Stremio
// stream reaches Riwaq as an info hash with trackers; nothing carries a
// separate .torrent file, so a second item would copy the same magnet.
test("the player menu copies a torrent's magnet once and says why there is no torrent file", () => {
  const menu = read("src/components/PlayerMenu.jsx");
  assert.equal(menu.match(/run\("copy/g)?.length, 1);
  assert.match(menu, /aria-describedby="magnet-note"/);
  assert.match(menu, /id="magnet-note"/);
  assert.doesNotMatch(menu, /copyTorrent|\.torrent"/);
  assert.equal(
    translate(
      "لا يوفّر هذا المصدر ملف تورنت منفصلاً؛ رابط المغناطيس يحمل معرّفه ومتتبّعاته.",
      "en",
    ),
    "This source has no separate torrent file; the magnet link carries its hash and trackers.",
  );
  const main = read("electron/main.mjs");
  const action = main.slice(
    main.indexOf("async function playbackAction"),
    main.indexOf("// The built-in torrent engine"),
  );
  assert.deepEqual(
    [...action.matchAll(/action === "(\w+)"/g)].map((m) => m[1]),
    ["screenshot", "copyMagnet", "download"],
  );
  // The clipboard only ever receives the magnet built from the hash.
  assert.deepEqual(
    [...action.matchAll(/clipboard\.writeText\(([^)]*\))/g)].map((m) => m[1]),
    ["magnetOf(stream)"],
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
