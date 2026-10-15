import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { TorrServerHost } from "../electron/torrserver.mjs";
import { PlaybackRequest } from "../core/playback-request.mjs";
import { namedFile, pickFile } from "../core/torrent-engine.mjs";
import { torrServerFile } from "../core/torrserver.mjs";

test("Stop while TorrServer verifies its file prevents a late process and an obsolete start cannot replace the next one", async () => {
  const host = new TorrServerHost({ dir: "/unused" });
  let resume,
    calls = 0;
  host.verify = () =>
    new Promise((r) => {
      resume = r;
    });
  host.launch = async () => {
    calls++;
    return "current";
  };
  const old = host.start();
  const rejected = assert.rejects(old, { code: "ABORT_ERR" });
  await host.stop();
  host.verify = async () => {};
  assert.equal(await host.start(), "current");
  resume();
  await rejected;
  assert.equal(calls, 1);
});

test("both torrent engines distinguish duplicate filenames, and refuse ambiguous or missing hints", () => {
  const files = [
    { path: "Pack/S01/E01.mkv", name: "E01.mkv", length: 200 },
    { path: "Pack/S02/E01.mkv", name: "E01.mkv", length: 100 },
  ];
  assert.equal(namedFile(files, "S02\\E01.mkv"), 1);
  assert.equal(pickFile(files, undefined, "S02/E01.mkv"), 1);
  assert.equal(pickFile(files, undefined, "E01.mkv"), -1);
  assert.equal(pickFile(files, undefined, "missing.mkv"), -1);
  assert.equal(pickFile(files), 0);
  assert.equal(pickFile(files, 0, "S02/E01.mkv"), 0);
  const stats = { file_stats: files.map((f, i) => ({ ...f, id: i + 1 })) };
  assert.equal(torrServerFile(stats, { filename: "S02/E01.mkv" }), 2);
  assert.equal(torrServerFile(stats, { filename: "E01.mkv" }), 0);
  assert.equal(torrServerFile(stats, { filename: "missing.mkv" }), 0);
  assert.equal(torrServerFile(stats, { fileIdx: 1, files }), 2);
});
test("a cancelled URL rejects promptly during verification and never launches an idle server later", async () => {
  const host = new TorrServerHost({ dir: "/unused" }),
    abort = new AbortController();
  let resume,
    launched = 0;
  host.verify = () =>
    new Promise((r) => {
      resume = r;
    });
  host.launch = async () => {
    launched++;
    return "late";
  };
  const pending = host.url(
    { infoHash: "b".repeat(40) },
    {},
    { signal: abort.signal },
  );
  const rejected = assert.rejects(pending, { code: "ABORT_ERR" });
  abort.abort();
  await rejected;
  assert.equal(host.pending.size, 0);
  resume();
  await new Promise((r) => setImmediate(r));
  assert.equal(launched, 0);
});

const fallbackSource = readFileSync(
  new URL("../electron/main.mjs", import.meta.url),
  "utf8",
);
const begin = fallbackSource.indexOf("async function tryTorrServer(");
const fallback = fallbackSource.slice(
  begin,
  fallbackSource.indexOf("\n}\n", begin) + 2,
);
function fixture() {
  const playbackRequest = new PlaybackRequest(),
    request = playbackRequest.begin();
  const viewing = { key: "source", id: "episode", request };
  let resume,
    plays = 0;
  const context = {
    playbackRequest,
    nowPlaying: viewing,
    player: { state: { active: true }, meta: { name: "Fixture" } },
    client: { state: { settings: {} } },
    torrServers: () => ({ installed: () => true }),
    torrentHost: {
      files: () =>
        new Promise((r) => {
          resume = r;
        }),
    },
    emit() {},
    logError() {},
    play: async () => {
      plays++;
      playbackRequest.begin();
    },
    torrServerTrying: null,
  };
  const run = runInNewContext(`(${fallback})`, context);
  return {
    context,
    viewing,
    run,
    resolve: () => resume([]),
    plays: () => plays,
  };
}
test("Stop while fallback reads the old torrent file list cannot start a new viewing", async () => {
  const f = fixture(),
    pending = f.run(f.viewing, "a".repeat(40));
  f.context.playbackRequest.cancel();
  f.context.player.state.active = false;
  f.resolve();
  assert.equal(await pending, true);
  assert.equal(f.plays(), 0);
});
test("a new user source preparation supersedes the old torrent fallback even while the old picture still plays", async () => {
  const f = fixture(),
    pending = f.run(f.viewing, "a".repeat(40));
  const latest = f.context.playbackRequest.begin("new-source");
  f.resolve();
  assert.equal(await pending, true);
  assert.equal(f.plays(), 0);
  assert.equal(f.context.playbackRequest.current, latest);
  assert.ok(f.viewing.request.signal.aborted);
});
