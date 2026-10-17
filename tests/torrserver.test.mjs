import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TORRSERVER,
  torrServerFile,
  torrServerSettings,
  torrServerStatus,
  torrServerStreamUrl,
} from "../core/torrserver.mjs";
import { PUBLIC_TRACKERS } from "../core/torrent-engine.mjs";
import { TorrServerHost } from "../electron/torrserver.mjs";

const read = (p) =>
  readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const HASH = "c".repeat(40);

// Every field TorrServer MatriX.145.1 keeps in settings.json (read from a
// real run): a missing one would be read as zero.
const TORRSERVER_FIELDS = [
  "CacheSize",
  "ConnectionsLimit",
  "DefaultTrackers",
  "DisableDHT",
  "DisablePEX",
  "DisableTCP",
  "DisableUPNP",
  "DisableUTP",
  "DisableUpload",
  "DownloadRateLimit",
  "EnableBonjour",
  "EnableDLNA",
  "EnableDebug",
  "EnableIPv6",
  "EnableLPD",
  "EnableRutorSearch",
  "EnableTorznabSearch",
  "ForceEncrypt",
  "FriendlyName",
  "LPDIPv6",
  "MergeAllM3U",
  "PeersListenPort",
  "PreloadCache",
  "ReaderReadAHead",
  "RemoveCacheOnDrop",
  "ResponsiveMode",
  "RetrackersMode",
  "ShowFSActiveTorr",
  "SslCert",
  "SslKey",
  "SslPort",
  "StoreSettingsInJson",
  "StoreViewedInJson",
  "TMDBSettings",
  "TorrentDisconnectTimeout",
  "TorrentsSavePath",
  "TorznabUrls",
  "TrackTimecode",
  "TrackersListURL",
  "UploadRateLimit",
  "UseDisk",
];

test("the pinned TorrServer release is one upstream file with a size and digest", () => {
  assert.equal(TORRSERVER.version, "MatriX.145.1");
  assert.equal(
    TORRSERVER.url,
    `https://github.com/YouROK/TorrServer/releases/download/${TORRSERVER.version}/TorrServer-windows-amd64.exe`,
  );
  assert.equal(TORRSERVER.size, 63547904);
  assert.match(TORRSERVER.sha256, /^[a-f0-9]{64}$/);
  assert.equal(TORRSERVER.license, "GPL-3.0");
  assert.ok(Object.isFrozen(TORRSERVER));
});

test("TorrServer's settings never announce it on the LAN and follow the viewer", () => {
  const sets = torrServerSettings({}, 16 * 1024 ** 3).BitTorr;
  assert.deepEqual(Object.keys(sets).sort(), [...TORRSERVER_FIELDS].sort());
  assert.equal(sets.EnableBonjour, false);
  assert.equal(sets.EnableLPD, false);
  assert.equal(sets.EnableDLNA, false);
  assert.equal(sets.EnableRutorSearch, false);
  assert.equal(sets.EnableTorznabSearch, false);
  assert.equal(sets.UseDisk, false, "pieces stay in memory");
  assert.equal(sets.DisableUPNP, false, "incoming peers are on by default");
  assert.equal(sets.DisableUTP, false, "uTP is why it is the fallback");
  assert.equal(sets.DefaultTrackers, PUBLIC_TRACKERS.join("\n"));
  assert.equal(sets.CacheSize, 256 * 1024 * 1024);
  assert.equal(sets.ConnectionsLimit, 55);
  assert.equal(sets.DownloadRateLimit, 0);
  assert.equal(sets.UploadRateLimit, 0);
  const calm = torrServerSettings(
    {
      torrentIncoming: false,
      torrentProfile: "gentle",
      torrentUpload: "minimal",
    },
    4 * 1024 ** 3,
  ).BitTorr;
  assert.equal(calm.DisableUPNP, true);
  assert.equal(calm.ConnectionsLimit, 35);
  assert.equal(calm.UploadRateLimit, 32);
  assert.ok(calm.DownloadRateLimit > 0);
  assert.equal(calm.CacheSize, 128 * 1024 * 1024);
});

test("TorrServer's counts read like the built-in engine's", () => {
  assert.equal(torrServerStatus(null), null);
  assert.deepEqual(
    torrServerStatus({
      active_peers: 7,
      download_speed: 1048576.6,
      loaded_size: 10,
      bytes_read_useful_data: 4096,
      file_stats: [{ id: 1, path: "a.mkv", length: 5 }],
    }),
    { metadata: true, peers: 7, down: 1048577, bytes: 4096 },
  );
  assert.deepEqual(torrServerStatus({ active_peers: -3, file_stats: "x" }), {
    metadata: false,
    peers: 0,
    down: 0,
    bytes: 0,
  });
});

test("the addon's file is found in TorrServer's sorted list, never guessed", () => {
  // TorrServer numbers files after a natural sort by path, so Ep2 is 1 and
  // Ep10 is 2, while the torrent itself lists Ep10 first.
  const stats = {
    file_stats: [
      { id: 1, path: "Show/Show.Ep2.mkv", length: 200 },
      { id: 2, path: "Show/Show.Ep10.mkv", length: 100 },
      { id: 3, path: "Show/sample.mkv", length: 5 },
    ],
  };
  const files = [
    { path: "Show/Show.Ep10.mkv", length: 100 },
    { path: "Show/Show.Ep2.mkv", length: 200 },
    { path: "Show/sample.mkv", length: 5 },
  ];
  assert.equal(torrServerFile(stats, { fileIdx: 0, files }), 2);
  assert.equal(torrServerFile(stats, { fileIdx: 1, files }), 1);
  assert.equal(torrServerFile(stats, { filename: "show.ep10.MKV" }), 2);
  // An index without the torrent's list or a name is refused.
  assert.equal(torrServerFile(stats, { fileIdx: 0 }), 0);
  assert.equal(torrServerFile(stats, { fileIdx: 0, files: [] }), 0);
  // No index at all: the largest video, as the built-in engine plays.
  assert.equal(torrServerFile(stats, {}), 1);
  assert.equal(
    torrServerFile(
      { file_stats: [{ id: 1, path: "one.mp4", length: 1 }] },
      {
        fileIdx: 4,
      },
    ),
    1,
    "a single file needs no matching",
  );
  assert.equal(torrServerFile({ file_stats: [] }, {}), 0);
  assert.equal(
    torrServerStreamUrl("http://127.0.0.1:9", HASH, {
      id: 2,
      path: "Show/Ep 10 #1.mkv",
    }),
    `http://127.0.0.1:9/stream/Ep%2010%20%231.mkv?link=${HASH}&index=2&play`,
  );
});

/**
 * A stand-in for TorrServer that follows its protocol as read from its
 * source: -p/-i/-d/-a, accs.db Basic auth on the API, settings.json read at
 * start, /stream for torrents it holds without the password.
 */
function fakeTorrServer({
  ignoreSettings = false,
  open = false,
  metaAfter = 1,
} = {}) {
  const runs = [];
  // Polls answered without file stats; read at each request, so a test can
  // change it between starts.
  const fake = { runs, metaAfter };
  const spawn = (exe, args, options) => {
    const child = new EventEmitter();
    const flag = (name) => args[args.indexOf(name) + 1];
    const data = flag("-d");
    const accounts = JSON.parse(readFileSync(join(data, "accs.db"), "utf8"));
    const sets = JSON.parse(
      readFileSync(join(data, "settings.json"), "utf8"),
    ).BitTorr;
    if (ignoreSettings) sets.EnableBonjour = true;
    const auth =
      "Basic " +
      Buffer.from(Object.entries(accounts)[0].join(":")).toString("base64");
    const torrents = new Map();
    const run = { exe, args, options, child, torrents, sets, requests: [] };
    runs.push(run);
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const url = new URL(req.url, "http://x");
        run.requests.push(`${req.method} ${url.pathname}`);
        const json = (status, value) => {
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(value === undefined ? "" : JSON.stringify(value));
        };
        if (url.pathname === "/echo") return res.end("MatriX.145.1");
        if (url.pathname.startsWith("/stream/")) {
          const hash = url.searchParams.get("link");
          return torrents.has(hash) ? res.end("video") : json(401);
        }
        if (!open && req.headers.authorization !== auth) return json(401);
        if (url.pathname === "/shutdown") {
          json(200, "ok");
          return setImmediate(() => child.kill());
        }
        const message = body ? JSON.parse(body) : {};
        if (url.pathname === "/settings") return json(200, sets);
        if (url.pathname === "/torrents") {
          const hash = message.hash || message.link?.match(/btih:(\w+)/)?.[1];
          if (message.action === "add") {
            torrents.set(hash, { polls: 0, link: message.link });
            return json(200, { hash });
          }
          if (message.action === "drop") {
            torrents.delete(hash);
            return json(200);
          }
          if (message.action === "get") {
            const entry = torrents.get(hash);
            if (!entry) return json(404);
            entry.polls++;
            return json(200, {
              hash,
              active_peers: 3,
              download_speed: 2048,
              loaded_size: 0,
              ...(entry.polls > fake.metaAfter
                ? {
                    file_stats: [
                      { id: 1, path: "Pack/E02.mkv", length: 20 },
                      { id: 2, path: "Pack/E10.mkv", length: 10 },
                    ],
                  }
                : {}),
            });
          }
        }
        json(404);
      });
    });
    server.listen(Number(flag("-p")), "127.0.0.1");
    child.kill = () => {
      server.closeAllConnections?.();
      server.close(() => child.emit("exit", 0));
    };
    return child;
  };
  fake.spawn = spawn;
  return fake;
}

function installed(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), "riwaq-ts-"));
  const bytes = Buffer.from("not really TorrServer");
  const release = {
    version: "MatriX.145.1",
    url: TORRSERVER.url,
    size: bytes.length,
    sha256: sha(bytes),
  };
  mkdirSync(join(dir, release.version));
  writeFileSync(join(dir, release.version, "TorrServer.exe"), bytes);
  return { dir, release, ...extra };
}

test("Stop during the echo handshake cannot relaunch an obsolete server", async () => {
  const fake = fakeTorrServer();
  let resume,
    intercepted = false;
  const host = new TorrServerHost({
    ...installed(),
    spawn: fake.spawn,
    fetch: async (url, options) => {
      if (!intercepted && String(url).endsWith("/echo")) {
        intercepted = true;
        await new Promise((r) => {
          resume = r;
        });
      }
      return fetch(url, options);
    },
  });
  const starting = host.start();
  const rejected = assert.rejects(starting, { code: "ABORT_ERR" });
  try {
    while (!resume) await new Promise((r) => setTimeout(r, 5));
    await host.stop();
    resume();
    await rejected;
    assert.equal(fake.runs.length, 1);
    assert.equal(host.running, false);
    await host.start();
    assert.equal(host.running, true);
    assert.equal(fake.runs.length, 2);
  } finally {
    resume?.();
    await host.stop();
  }
});

test("cancelling a TorrServer metadata wait promptly drops its lease and permits idle shutdown", async () => {
  const fake = fakeTorrServer(),
    abort = new AbortController();
  let ready;
  const firstPoll = new Promise((r) => {
    ready = r;
  });
  const host = new TorrServerHost({
    ...installed(),
    spawn: fake.spawn,
    pollMs: 30000,
    idleMs: 10,
  });
  const pending = host.url(
    { infoHash: HASH, behaviorHints: { filename: "E02.mkv" } },
    {},
    {
      signal: abort.signal,
      onStatus: (s) => {
        if (s && !s.metadata) ready();
      },
    },
  );
  const rejected = assert.rejects(pending, { code: "ABORT_ERR" });
  try {
    await firstPoll;
    abort.abort();
    await rejected;
    assert.equal(host.active.size, 0);
    assert.equal(host.pending.size, 0);
    assert.equal(fake.runs[0].torrents.has(HASH), false);
    assert.ok(host.idle);
  } finally {
    await host.stop();
  }
});

test("TorrServer runs on loopback with a password, Riwaq's settings and a clean environment", async () => {
  const fake = fakeTorrServer();
  const { dir, release } = installed();
  process.env.RIWAQ_TEST_SECRET = "must not leak";
  const host = new TorrServerHost({
    dir,
    release,
    spawn: fake.spawn,
    pollMs: 10,
    idleMs: 60,
  });
  try {
    assert.equal(host.state().installed, true);
    const url = await host.url(
      { infoHash: HASH.toUpperCase(), fileIdx: 0 },
      {},
      {
        files: [
          { path: "Pack/E10.mkv", length: 10 },
          { path: "Pack/E02.mkv", length: 20 },
        ],
      },
    );
    assert.equal(
      url,
      `${host.origin}/stream/E10.mkv?link=${HASH}&index=2&play`,
    );
    const [run] = fake.runs;
    assert.deepEqual(run.args.slice(0, 1), ["-p"]);
    assert.deepEqual(run.args.slice(2), [
      "-i",
      "127.0.0.1",
      "-d",
      join(dir, "data"),
      "-a",
    ]);
    assert.equal(run.options.shell, false);
    assert.equal(run.options.windowsHide, true);
    assert.equal("RIWAQ_TEST_SECRET" in run.options.env, false);
    assert.equal(run.sets.EnableBonjour, false);
    // The password is random and only in its own folder.
    const accounts = JSON.parse(
      readFileSync(join(dir, "data", "accs.db"), "utf8"),
    );
    assert.match(accounts.riwaq, /^[a-f0-9]{48}$/);
    assert.ok(!url.includes(accounts.riwaq));
    // MPV's address works without the password while the torrent is held.
    assert.equal(await (await fetch(url)).text(), "video");
    assert.equal((await fetch(host.origin + "/settings")).status, 401);
    assert.deepEqual(await host.status(HASH), {
      metadata: true,
      peers: 3,
      down: 2048,
      bytes: 0,
    });
    assert.deepEqual(Object.keys(host.state()).sort(), [
      "installed",
      "installing",
      "progress",
      "running",
      "size",
      "version",
    ]);
    // Two viewings of one torrent: the last to end drops it.
    await host.url({ infoHash: HASH, behaviorHints: { filename: "E02.mkv" } });
    await host.release(HASH);
    assert.equal(run.torrents.has(HASH), true);
    await host.release(HASH);
    assert.equal(run.torrents.has(HASH), false);
    assert.equal((await fetch(url)).status, 401);
    // Idle, it stops by itself.
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(host.running, false);
    assert.ok(run.requests.includes("GET /shutdown"));
  } finally {
    delete process.env.RIWAQ_TEST_SECRET;
    await host.stop();
  }
});

test("TorrServer starts again for new settings only when nothing plays", async () => {
  const fake = fakeTorrServer();
  const { dir, release } = installed();
  const host = new TorrServerHost({
    dir,
    release,
    spawn: fake.spawn,
    pollMs: 5,
  });
  try {
    await host.url(
      { infoHash: HASH, fileIdx: 0, behaviorHints: {} },
      {},
      {
        files: [{ path: "Pack/E02.mkv", length: 20 }],
      },
    );
    await host.start({ torrentIncoming: false });
    assert.equal(fake.runs.length, 1, "a torrent is playing");
    await host.release(HASH);
    await host.start({ torrentIncoming: false });
    assert.equal(fake.runs.length, 2);
    assert.equal(fake.runs[1].sets.DisableUPNP, true);
    await host.start({ torrentIncoming: false });
    assert.equal(fake.runs.length, 2, "same settings, same program");
  } finally {
    await host.stop();
  }
});

test("a TorrServer that runs open or ignores Riwaq's settings is stopped", async () => {
  for (const options of [{ open: true }, { ignoreSettings: true }]) {
    const fake = fakeTorrServer(options);
    const { dir, release } = installed();
    const host = new TorrServerHost({ dir, release, spawn: fake.spawn });
    await assert.rejects(host.start({}), /تعذّر تشغيل TorrServer/);
    assert.equal(host.running, false);
    assert.equal(fake.runs.length, 2, "tried twice, then refused");
  }
});

test("a file without metadata or a known file gives its start back", async () => {
  // No metadata however many polls fit in readyMs: a fast reply once polled
  // again and got the files, failing on the mapping instead.
  const fake = fakeTorrServer({ metaAfter: Infinity });
  const { dir, release } = installed();
  const host = new TorrServerHost({
    dir,
    release,
    spawn: fake.spawn,
    pollMs: 5,
    readyMs: 1,
  });
  try {
    await assert.rejects(
      host.url({ infoHash: HASH, fileIdx: 0 }, {}),
      /ما وصلت بيانات التورنت/,
    );
    assert.equal(fake.runs[0].torrents.size, 0, "dropped");
    fake.metaAfter = 1;
    host.readyMs = 5000;
    await assert.rejects(
      host.url({ infoHash: HASH, fileIdx: 1 }, {}),
      /أي ملف/,
    );
    assert.equal(fake.runs[0].torrents.size, 0);
    assert.equal(host.active.size, 0);
  } finally {
    await host.stop();
  }
});

test("a TorrServer file changed after its download is deleted, never run", async () => {
  const fake = fakeTorrServer();
  const { dir, release } = installed();
  writeFileSync(
    join(dir, release.version, "TorrServer.exe"),
    "x".repeat(release.size),
  );
  const host = new TorrServerHost({ dir, release, spawn: fake.spawn });
  await assert.rejects(host.start({}), /تغيّر بعد تنزيله/);
  assert.equal(existsSync(join(dir, release.version, "TorrServer.exe")), false);
  assert.equal(fake.runs.length, 0);
  assert.equal(host.state().installed, false);
});

test("the download follows only GitHub's release hosts and keeps only the pinned bytes", async () => {
  const bytes = Buffer.from("pinned TorrServer bytes");
  const release = {
    version: "MatriX.145.1",
    url: TORRSERVER.url,
    size: bytes.length,
    sha256: sha(bytes),
  };
  const seen = [];
  const fetchFrom = (body, target) => async (url) => {
    seen.push(url);
    if (url.startsWith("https://github.com/"))
      return new Response(null, { status: 302, headers: { location: target } });
    return new Response(body, {
      status: 200,
      headers: { "content-length": String(body.length) },
    });
  };
  const assets = "https://release-assets.githubusercontent.com/asset?sig=1";
  const dir = mkdtempSync(join(tmpdir(), "riwaq-ts-"));
  mkdirSync(join(dir, "MatriX.140"), { recursive: true });
  const host = new TorrServerHost({
    dir,
    release,
    fetch: fetchFrom(bytes, assets),
  });
  const state = await host.install();
  assert.equal(state.installed, true);
  assert.deepEqual(seen, [release.url, assets]);
  assert.ok(
    readFileSync(join(dir, release.version, "TorrServer.exe")).equals(bytes),
  );
  assert.equal(existsSync(join(dir, "MatriX.140")), false, "the old one goes");
  // Another host, a wrong body, or a redirect elsewhere: nothing is kept.
  for (const [body, target, error] of [
    [Buffer.from("tampered bytes!!!!!!!!!"), assets, /بصمة الملف/],
    [bytes, "https://evil.example/TorrServer.exe", /غير موثوق/],
    [bytes, "http://release-assets.githubusercontent.com/x", /غير موثوق/],
  ]) {
    const other = mkdtempSync(join(tmpdir(), "riwaq-ts-"));
    const bad = new TorrServerHost({
      dir: other,
      release,
      fetch: fetchFrom(body, target),
    });
    await assert.rejects(bad.install(), error);
    assert.equal(bad.state().installed, false);
    assert.equal(existsSync(join(other, release.version)), false);
  }
});

test("main falls back to TorrServer only for a dead built-in torrent, and never twice", () => {
  const main = read("electron/main.mjs");
  const fallback = main.slice(main.indexOf("async function tryTorrServer("));
  const body = fallback.slice(0, fallback.indexOf("\n}\n"));
  assert.match(body, /torrServerFallback === false\) return false;/);
  assert.match(body, /if \(!host\.installed\(\)\) return false;/);
  assert.match(body, /torrentHost\?\.files\(hash\)/);
  assert.match(body, /\{ engine: "torrserver", files: files \|\| undefined \}/);
  // A cancelled attempt (Stop, another pick) ends the fallback there.
  assert.match(
    body,
    /attempt = playbackRequest\.current;\s*await pending;\s*return true;/,
  );
  const watch = main.slice(main.indexOf("function watchTorrentStart("));
  const watchBody = watch.slice(0, watch.indexOf("\n}\n"));
  assert.match(
    watchBody,
    /if \(!fallback && \(await tryTorrServer\(viewing, hash\)\)\) return;\s*\/\/[^\n]*\n\s*if \(nowPlaying !== viewing \|\| !player\.state\.active\) return;\s*if \(await tryNextSource\(\)\) return;/,
  );
  // The built-in address failing during the attempt does not skip ahead.
  assert.match(
    main,
    /if \(failed && !\(torrServerTrying && torrServerTrying === nowPlaying\)\)\s*tryNextSource\(\);/,
  );
  // The interface's play passes one argument: the engine is main's choice.
  assert.match(
    main,
    /return \{ ok: true, value: await methods\[method\]\(args\) \};/,
  );
  assert.match(main, /\{ engine: forced, files \} = \{\},/);
  assert.match(
    main,
    /if \(!url && stream\.infoHash && forced === "torrserver"\)/,
  );
  // Its torrents are watched too, released with the viewing, and stopped
  // at quit; its address is the torrent server's for seek previews.
  assert.match(main, /: fallbackHash\s*\? \[fallbackHash, "torrserver"\]/);
  assert.match(
    main,
    /if \(fallbackTorrent\) torrServer\?\.release\(fallbackTorrent\);/,
  );
  assert.match(main, /\.then\(\(\) => torrServer\?\.stop\(\)\)/);
  assert.match(main, /torrentHost\?\.origin,\s*torrServer\?\.origin,/);
  // Installing and removing sit behind the Settings room lock.
  for (const name of ["torrServerInstall", "torrServerRemove"])
    assert.match(
      main,
      new RegExp(
        `${name}: async \\(\\) => \\{\\s*client\\.profiles\\.gate\\("settings"\\);`,
      ),
    );
  for (const name of [
    "torrServerState",
    "torrServerInstall",
    "torrServerRemove",
  ]) {
    assert.match(read("electron/preload.cjs"), new RegExp(`"${name}"`));
    assert.match(read("web/desktop-only.js"), new RegExp(`${name}:`));
  }
});

test("the fallback setting is kept, and the built-in engine lends only file names", async () => {
  const { safeSettings, DEFAULT_SETTINGS } =
    await import("../core/protocol.mjs");
  assert.equal(DEFAULT_SETTINGS.torrServerFallback, true);
  assert.equal(
    safeSettings({ torrServerFallback: false }).torrServerFallback,
    false,
  );
  assert.equal(
    safeSettings({ torrServerFallback: 1 }).torrServerFallback,
    true,
  );
  const { TorrentHost } = await import("../electron/torrent.mjs");
  const host = new TorrentHost({
    fork: () => {
      const child = new EventEmitter();
      child.postMessage = ({ id, method }) =>
        setImmediate(() =>
          child.emit("message", {
            id,
            result:
              method === "start"
                ? { origin: "http://127.0.0.1:9" }
                : method === "files"
                  ? [
                      { path: "Pack/E01.mkv", length: 5, url: "x" },
                      { path: 7, length: "big" },
                    ]
                  : "http://127.0.0.1:9/t",
          }),
        );
      child.kill = () => setImmediate(() => child.emit("exit"));
      return child;
    },
    cacheDir: "/unused",
  });
  try {
    assert.equal(await host.files(HASH), null, "not running yet");
    await host.url({ infoHash: HASH }, {});
    assert.deepEqual(await host.files(HASH), [
      { path: "Pack/E01.mkv", length: 5 },
      { path: "", length: 0 },
    ]);
  } finally {
    await host.stop();
  }
  assert.match(read("electron/torrent-host.mjs"), /"files"/);
});
