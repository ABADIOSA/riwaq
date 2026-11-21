// Issue #157, Codex's final acceptance (2026-11-21): saving a subtitle must
// (1) reach a local address only at the own local origin of the configured,
// enabled addon that supplied it, enforced where the socket connects, and
// (2) stay bound to the viewing, the profile activation and the chosen
// track through the fetch and the Save dialog. Synthetic endpoints only: a
// loopback fixture stands in for a configured local addon, a fake resolver
// and request stand in for public names; no outside request is made and no
// real private service is touched.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { EventEmitter } from "node:events";
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SUBTITLE_HOST_BLOCKED,
  fetchSubtitle,
  trustedOrigin,
} from "../core/subtitle-export.mjs";
import { requestSubtitle } from "../electron/subtitle-http.mjs";
import {
  sameSource,
  saveSubtitle,
  subtitleSources,
  writeInPlace,
} from "../electron/subtitle-save.mjs";
import { Client } from "../core/client.mjs";

const SRT = "1\r\n00:00:01,000 --> 00:00:02,000\r\nمرحبا\r\n";
const read = (path) =>
  readFileSync(fileURLToPath(new URL("../" + path, import.meta.url)), "utf8");

async function fixture(routes) {
  const hits = [];
  const server = createServer((req, res) => {
    hits.push({ url: req.url, headers: req.headers });
    const route = routes[req.url];
    if (!route) return res.writeHead(404).end("missing");
    route(req, res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, hits, close: () => new Promise((r) => server.close(r)) };
}

/**
 * A stand-in for node:http's request that never opens a socket: it asks
 * the connection's own `lookup` where it would connect (as net.connect
 * does), records that, then answers from `routes` by URL.
 */
function fakeHttp(routes, connected) {
  return (url, options, onResponse) => {
    const req = new EventEmitter();
    req.end = () => {
      options.lookup(url.hostname, { all: true }, (error, addresses) => {
        if (error) return req.emit("error", error);
        connected.push({
          host: url.hostname,
          addresses,
          headers: options.headers,
        });
        const route = routes[url.toString()];
        const response = new EventEmitter();
        Object.assign(response, {
          statusCode: route?.status || (route ? 200 : 404),
          headers: route?.headers || {},
          readableHighWaterMark: 16384,
        });
        // A minimal readable for Readable.toWeb.
        const { Readable } = awaitReadable;
        const body = Readable.from(
          route?.body ? [Buffer.from(route.body)] : [],
        );
        Object.assign(body, {
          statusCode: response.statusCode,
          headers: response.headers,
        });
        onResponse(body);
      });
    };
    return req;
  };
}
const awaitReadable = await import("node:stream");

/** A resolver answering each name from a table, call by call. */
const resolver = (table) => {
  const calls = {};
  const lookup = (host, options, callback) => {
    const answers = table[host];
    const n = (calls[host] = (calls[host] || 0) + 1);
    const pick = Array.isArray(answers?.[0])
      ? answers[n - 1] || answers.at(-1)
      : answers;
    if (!pick)
      return callback(
        Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }),
      );
    callback(
      null,
      pick.map((address) => ({
        address,
        family: address.includes(":") ? 6 : 4,
      })),
    );
  };
  return { lookup, calls };
};

test("a local origin is trusted only as a configured addon's own, never from the subtitle's address", () => {
  assert.equal(
    trustedOrigin("http://127.0.0.1:11470/local-addon/manifest.json"),
    "http://127.0.0.1:11470",
  );
  assert.equal(
    trustedOrigin("http://nas.local:7000/x/manifest.json"),
    "http://nas.local:7000",
  );
  // A public addon gives no local trust; a malformed or credentialed one none.
  for (const addon of [
    "https://opensubtitles-v3.strem.io/manifest.json",
    "https://u:p@127.0.0.1/manifest.json",
    "file:///C:/addon/manifest.json",
    "nonsense",
    "",
  ])
    assert.equal(trustedOrigin(addon), "", addon);
});

test("transport: an untrusted name that resolves to this computer, the LAN or metadata never connects", async () => {
  const connected = [];
  const routes = { "https://subs.example/a.srt": { body: SRT } };
  for (const [name, answers] of [
    ["loopback v4", ["127.0.0.1"]],
    ["private v4", ["10.0.0.5"]],
    ["private 192.168", ["192.168.1.20"]],
    ["CGNAT", ["100.64.0.1"]],
    ["metadata", ["169.254.169.254"]],
    ["loopback v6", ["::1"]],
    ["unique-local v6", ["fd00::1"]],
    ["link-local v6", ["fe80::1"]],
    ["v4-mapped v6", ["::ffff:127.0.0.1"]],
    ["unspecified", ["0.0.0.0"]],
    ["documentation", ["203.0.113.9"]],
  ]) {
    const { lookup } = resolver({ "subs.example": answers });
    await assert.rejects(
      requestSubtitle(
        "https://subs.example/a.srt",
        {},
        {
          lookup,
          https: fakeHttp(routes, connected),
        },
      ),
      (error) => error.code === SUBTITLE_HOST_BLOCKED,
      name,
    );
  }
  assert.equal(connected.length, 0);
});

test("transport: a mixed answer keeps only the public addresses; DNS rebinding is checked at every connection", async () => {
  const connected = [];
  const routes = {
    "https://subs.example/a.srt": { body: SRT },
    "https://rebind.example/a.srt": { body: SRT },
  };
  const { lookup } = resolver({
    "subs.example": ["93.184.216.34", "127.0.0.1", "2606:4700::1", "fd00::2"],
    // Public on the first answer, this computer on the second.
    "rebind.example": [["93.184.216.35"], ["127.0.0.1"]],
  });
  const deps = { lookup, https: fakeHttp(routes, connected) };
  const first = await requestSubtitle("https://subs.example/a.srt", {}, deps);
  assert.equal(first.status, 200);
  assert.deepEqual(
    connected[0].addresses.map((a) => a.address),
    ["93.184.216.34", "2606:4700::1"],
  );
  await requestSubtitle("https://rebind.example/a.srt", {}, deps);
  await assert.rejects(
    requestSubtitle("https://rebind.example/a.srt", {}, deps),
    (error) => error.code === SUBTITLE_HOST_BLOCKED,
  );
  assert.equal(connected.length, 2);
});

test("transport: IP literals and local names outside the trusted origins are refused before any socket", async () => {
  const srv = await fixture({ "/x.srt": (q, r) => r.writeHead(200).end(SRT) });
  try {
    const port = new URL(srv.base).port;
    for (const url of [
      `${srv.base}/x.srt`,
      `http://localhost:${port}/x.srt`,
      `http://[::1]:${port}/x.srt`,
      "http://169.254.169.254/latest/meta-data/",
      "http://192.168.1.1/x.srt",
      "http://nas/x.srt",
      "http://box.local/x.srt",
      "http://[::ffff:7f00:1]/x.srt",
    ])
      await assert.rejects(
        requestSubtitle(url, {}),
        (error) => error.code === SUBTITLE_HOST_BLOCKED,
        url,
      );
    // Another port on the same host is another origin.
    await assert.rejects(
      requestSubtitle(`${srv.base}/x.srt`, {
        trusted: [`http://127.0.0.1:${Number(port) + 1}`],
      }),
      (error) => error.code === SUBTITLE_HOST_BLOCKED,
    );
    assert.equal(srv.hits.length, 0);
    // The configured addon's own origin connects, with Accept and nothing else.
    const response = await requestSubtitle(`${srv.base}/x.srt`, {
      trusted: [srv.base],
      headers: {
        Accept: "text/plain",
        Cookie: "session=1",
        Authorization: "Bearer synthetic",
      },
    });
    assert.equal(response.status, 200);
    await response.body.cancel();
    assert.equal(srv.hits.length, 1);
    assert.equal(srv.hits[0].headers.accept, "text/plain");
    assert.equal(srv.hits[0].headers.cookie, undefined);
    assert.equal(srv.hits[0].headers.authorization, undefined);
    assert.equal(srv.hits[0].headers["proxy-authorization"], undefined);
  } finally {
    await srv.close();
  }
});

test("fetch over main's transport: trusted local addon succeeds, unconfigured local and public→local fail", async () => {
  const srv = await fixture({
    "/ok.srt": (q, r) =>
      r.writeHead(200, { "Content-Type": "application/x-subrip" }).end(SRT),
    "/out.srt": (q, r) =>
      r.writeHead(302, { Location: "https://subs.example/pub.srt" }).end(),
  });
  try {
    const trusted = [srv.base];
    const real = (url, init) => requestSubtitle(url, init);
    assert.equal(
      Buffer.from(
        await fetchSubtitle(srv.base + "/ok.srt", { fetch: real, trusted }),
      ).toString(),
      SRT,
    );
    // Unconfigured: the same loopback address with no trusted origin.
    await assert.rejects(
      fetchSubtitle(srv.base + "/ok.srt", { fetch: real }),
      /شبكتك/,
    );
    const hitsBefore = srv.hits.length;
    // Public addresses (resolved by a stand-in) redirecting home.
    const connected = [];
    const { lookup } = resolver({
      "subs.example": ["93.184.216.34"],
      "evil.example": ["127.0.0.1"],
    });
    const routes = {
      "https://subs.example/home.srt": {
        status: 302,
        headers: { location: srv.base + "/ok.srt" },
      },
      "https://subs.example/dns.srt": {
        status: 302,
        headers: { location: "https://evil.example/x.srt" },
      },
      "https://subs.example/pub.srt": {
        status: 302,
        headers: { location: srv.base + "/ok.srt" },
      },
    };
    const mixed = (url, init) =>
      new URL(url).hostname === "127.0.0.1"
        ? requestSubtitle(url, init)
        : requestSubtitle(url, init, {
            lookup,
            https: fakeHttp(routes, connected),
          });
    // Even with the local addon trusted, a chain that went public is out.
    await assert.rejects(
      fetchSubtitle("https://subs.example/home.srt", { fetch: mixed, trusted }),
      /شبكتك/,
    );
    await assert.rejects(
      fetchSubtitle("https://subs.example/dns.srt", { fetch: mixed, trusted }),
      /شبكتك/,
    );
    // Local addon → public → back to the local addon: trust ended at the
    // public hop.
    await assert.rejects(
      fetchSubtitle(srv.base + "/out.srt", { fetch: mixed, trusted }),
      /شبكتك/,
    );
    assert.equal(srv.hits.length, hitsBefore + 1); // only /out.srt itself
    assert.ok(!connected.some((c) => c.host === "evil.example"));
  } finally {
    await srv.close();
  }
});

test("over main's transport the timeout, cancellation and size cap still hold", async () => {
  const srv = await fixture({
    "/slow.srt": () => {},
    "/huge.srt": (q, r) => {
      r.writeHead(200, { "Content-Type": "text/plain" });
      const chunk = Buffer.alloc(256 * 1024, 0x41);
      let sent = 0;
      const push = () => {
        while (sent < 12 && r.write(chunk)) sent++;
        if (sent < 12) r.once("drain", push);
        else r.end();
      };
      push();
    },
  });
  try {
    const options = {
      fetch: (u, i) => requestSubtitle(u, i),
      trusted: [srv.base],
    };
    await assert.rejects(
      fetchSubtitle(srv.base + "/slow.srt", { ...options, timeout: 300 }),
      /مهلة/,
    );
    await assert.rejects(
      fetchSubtitle(srv.base + "/huge.srt", { ...options, max: 1024 * 1024 }),
      /كبير/,
    );
    const controller = new AbortController();
    const pending = fetchSubtitle(srv.base + "/slow.srt", {
      ...options,
      timeout: 10000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 50);
    await assert.rejects(pending);
  } finally {
    await srv.close();
  }
});

test("the client names a subtitle's addon only while that addon is installed and enabled", async () => {
  const LOCAL = "http://127.0.0.1:7000/fixture/manifest.json";
  const c = new Client({
    load: () => ({}),
    save: () => {},
    request: async () => ({
      subtitles: [
        { id: "a", url: "http://127.0.0.1:7000/sub/a.srt", lang: "ara" },
      ],
    }),
  });
  c.state.addons = [
    {
      transportUrl: LOCAL,
      enabled: true,
      manifest: {
        id: "local.subs",
        name: "Local subs",
        version: "1.0.0",
        resources: ["subtitles"],
        types: ["movie"],
        catalogs: [],
      },
    },
  ];
  const [entry] = await c.getSubtitles({ type: "movie", id: "tt0000001" });
  assert.equal(c.subtitleOrigin(entry.key), LOCAL);
  assert.equal(
    trustedOrigin(c.subtitleOrigin(entry.key)),
    "http://127.0.0.1:7000",
  );
  c.state.addons[0].enabled = false;
  assert.equal(c.subtitleOrigin(entry.key), "");
  c.state.addons = [];
  assert.equal(c.subtitleOrigin(entry.key), "");
  assert.equal(c.subtitleOrigin("unknown"), "");
  // Never in what the page sees.
  assert.ok(!JSON.stringify(entry).includes("127.0.0.1"));
});

// ── Binding a save to its viewing ─────────────────────────────────────
const ADDON = "https://subs.example/ar.srt";
const ORIGIN = "https://subs.example/manifest.json";
const track = (id, file, selected = false) => ({
  id,
  type: "sub",
  lang: "ar",
  external: true,
  "external-filename": file,
  selected,
});
function viewing() {
  const v = {
    videoId: "tt1:1:2",
    token: 1,
    activation: 1,
    locked: false,
    tracks: [track(3, ADDON, true), track(4, "https://subs.example/en.srt")],
    origins: { k1: ORIGIN, k2: ORIGIN },
  };
  const external = () =>
    new Map([
      [ADDON, { key: "k1" }],
      ["https://subs.example/en.srt", { key: "k2" }],
    ]);
  v.sources = () =>
    subtitleSources({
      tracks: v.tracks,
      externalSubs: external(),
      addonUrl: (k) =>
        ({ k1: ADDON, k2: "https://subs.example/en.srt" })[k] || "",
      addonOrigin: (k) => v.origins[k] || "",
    });
  // What main's stillValid checks, over this stand-in viewing.
  v.bind = () => {
    const at = { videoId: v.videoId, token: v.token, activation: v.activation };
    return (source) => {
      if (
        v.videoId !== at.videoId ||
        v.token !== at.token ||
        v.activation !== at.activation
      )
        throw new Error("انتهت المشاهدة التي طُلبت منها الترجمة؛ لم تُحفظ");
      if (v.locked) throw new Error("المكتبة مقفلة");
      const now = v.sources().find((s) => s.id === source.id);
      if (!sameSource(now, source))
        throw new Error("لم تعد هذه الترجمة في المشاهدة");
    };
  };
  return v;
}
const okResponse = () =>
  new Response(SRT, { status: 200, headers: { "Content-Type": "text/plain" } });

async function attempt(v, { during, afterDialog, fetchError } = {}) {
  const written = [];
  const dialogs = [];
  let release;
  const gate = new Promise((r) => (release = r));
  const run = saveSubtitle({
    choice: "t3",
    sources: v.sources(),
    title: "Show",
    videoId: v.videoId,
    downloads: "/tmp",
    stillValid: v.bind(),
    fetch: async (url, init) => {
      await gate;
      if (fetchError) throw fetchError;
      init.signal?.throwIfAborted();
      return okResponse();
    },
    showSaveDialog: async () => {
      dialogs.push(1);
      afterDialog?.();
      return { canceled: false, filePath: join(tmpdir(), "riwaq-never.srt") };
    },
    write: async (path, bytes) => written.push({ path, bytes }),
  });
  during?.();
  release();
  const result = await run.then(
    (r) => ({ ok: r }),
    (e) => ({ error: e.message }),
  );
  return { result, written, dialogs };
}

test("binding: an unchanged viewing saves the chosen track", async () => {
  const v = viewing();
  const { result, written, dialogs } = await attempt(v);
  assert.equal(result.ok.saved, true);
  assert.equal(written.length, 1);
  assert.equal(dialogs.length, 1);
});

for (const [name, during, message] of [
  ["playback ends during the fetch", (v) => (v.token = 0), /انتهت المشاهدة/],
  [
    "the video changes during the fetch",
    (v) => ((v.videoId = "tt9"), v.token++),
    /انتهت المشاهدة/,
  ],
  [
    "the profile switches during the fetch",
    (v) => v.activation++,
    /انتهت المشاهدة/,
  ],
  [
    "A → B → A during a held request (a new activation of A)",
    (v) => (v.activation += 2),
    /انتهت المشاهدة/,
  ],
  ["the library locks during the fetch", (v) => (v.locked = true), /مقفلة/],
  [
    "the chosen track goes away",
    (v) => (v.tracks = v.tracks.filter((t) => t.id !== 3)),
    /لم تعد/,
  ],
  [
    "the chosen track now plays another file",
    (v) => (v.tracks = [track(3, "https://subs.example/en.srt", true)]),
    /لم تعد/,
  ],
  [
    "the supplying addon is removed or disabled",
    (v) => (v.origins.k1 = ""),
    /لم تعد/,
  ],
])
  test(`binding: ${name} → no dialog, nothing written`, async () => {
    const v = viewing();
    const { result, written, dialogs } = await attempt(v, {
      during: () => during(v),
    });
    assert.match(result.error || "", message);
    assert.equal(dialogs.length, 0);
    assert.equal(written.length, 0);
  });

test("binding: switching which subtitle is shown still saves the one chosen, never another", async () => {
  const v = viewing();
  const { result, written } = await attempt(v, {
    during: () =>
      (v.tracks = [
        track(3, ADDON, false),
        track(4, "https://subs.example/en.srt", true),
      ]),
  });
  assert.equal(result.ok.saved, true);
  assert.equal(new TextDecoder().decode(written[0].bytes), SRT);
});

for (const [name, change] of [
  ["playback ends", (v) => (v.token = 0)],
  ["another video starts", (v) => ((v.videoId = "tt9"), v.token++)],
  ["the profile switches", (v) => v.activation++],
])
  test(`binding: the Save dialog stays open while ${name} → nothing written`, async () => {
    const v = viewing();
    const { result, written, dialogs } = await attempt(v, {
      afterDialog: () => change(v),
    });
    assert.match(result.error || "", /انتهت المشاهدة/);
    assert.equal(dialogs.length, 1);
    assert.equal(written.length, 0);
  });

test("binding: a fetch cancelled because the viewing ended says so, not a network error", async () => {
  const v = viewing();
  const { result, written } = await attempt(v, {
    during: () => (v.token = 0),
    fetchError: new Error("aborted"),
  });
  assert.match(result.error, /انتهت المشاهدة/);
  assert.equal(written.length, 0);
});

test("binding: main's signal cancels a fetch still out", async () => {
  const v = viewing();
  const cancel = new AbortController();
  let seen;
  const run = saveSubtitle({
    choice: "t3",
    sources: v.sources(),
    downloads: "/tmp",
    signal: cancel.signal,
    stillValid: v.bind(),
    fetch: (url, init) =>
      new Promise((resolve, reject) => {
        seen = init.signal;
        init.signal.addEventListener("abort", () => reject(new Error("abort")));
      }),
    showSaveDialog: async () => assert.fail("no dialog"),
    write: async () => assert.fail("no write"),
  });
  await new Promise((r) => setTimeout(r, 10));
  v.token = 0;
  cancel.abort();
  await assert.rejects(run, /انتهت المشاهدة/);
  assert.equal(seen.aborted, true);
});

test("binding: a cancelled dialog writes nothing; an addon no longer installed is refused before any fetch", async () => {
  const v = viewing();
  const cancelled = await saveSubtitle({
    choice: "t3",
    sources: v.sources(),
    downloads: "/tmp",
    stillValid: v.bind(),
    fetch: async () => okResponse(),
    showSaveDialog: async () => ({ canceled: true }),
    write: async () => assert.fail("no write"),
  });
  assert.deepEqual(cancelled, { saved: false });
  v.origins.k1 = "";
  await assert.rejects(
    saveSubtitle({
      choice: "t3",
      sources: v.sources(),
      downloads: "/tmp",
      stillValid: v.bind(),
      fetch: async () => assert.fail("no fetch"),
      showSaveDialog: async () => assert.fail("no dialog"),
    }),
    /لم تعد مثبتة/,
  );
});

test("a write that fails leaves no temporary file behind", async () => {
  const dir = mkdtempSync(join(tmpdir(), "riwaq-subtitle-"));
  try {
    // The target is a folder: the rename fails after the temporary write.
    const target = join(dir, "taken.srt");
    mkdirSync(target);
    await assert.rejects(writeInPlace(target, new TextEncoder().encode(SRT)));
    assert.deepEqual(readdirSync(dir), ["taken.srt"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("retiring the viewing during staging preserves the existing subtitle", async () => {
  const dir = mkdtempSync(join(tmpdir(), "riwaq-subtitle-"));
  const input = join(dir, "input.srt");
  const target = join(dir, "saved.srt");
  try {
    writeFileSync(input, SRT);
    writeFileSync(target, "Existing subtitle");
    await assert.rejects(
      saveSubtitle({
        choice: "t1",
        sources: [{ id: "t1", kind: "file", path: input, lang: "en" }],
        showSaveDialog: async () => ({ canceled: false, filePath: target }),
        stillValid: () => {
          if (readdirSync(dir).some((name) => name.endsWith(".part")))
            throw new Error("Viewing retired during staging");
        },
      }),
      /Viewing retired during staging/,
    );
    assert.equal(readFileSync(target, "utf8"), "Existing subtitle");
    assert.deepEqual(readdirSync(dir).sort(), ["input.srt", "saved.srt"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("main: the save uses the connection-checked transport and is bound to its viewing", () => {
  const main = read("electron/main.mjs");
  const save = main.slice(
    main.indexOf("async function saveViewingSubtitle"),
    main.indexOf("function torrentEngines"),
  );
  assert.match(save, /fetch: requestSubtitle/);
  assert.match(save, /stillValid,/);
  assert.match(save, /signal: cancel\.signal/);
  assert.match(save, /client\.profiles\.ticket\(\)/);
  assert.match(save, /client\.profiles\.holds\(ticket\)/);
  assert.match(save, /player\.startToken !== sessionId/);
  assert.match(save, /sameSource\(now, source\)/);
  assert.match(save, /clearInterval\(watch\)/);
  assert.match(main, /addonOrigin: \(key\) => client\.subtitleOrigin\(key\)/);
  // The transport keeps artwork's connection-time check, never a bare fetch.
  const transport = read("electron/subtitle-http.mjs");
  assert.match(transport, /publicLookup\(lookup, SUBTITLE_HOST_BLOCKED\)/);
  assert.match(transport, /agent: false/);
  // Artwork's own protection is unchanged.
  const artwork = read("electron/artwork-http.mjs");
  assert.match(artwork, /lookup: publicLookup\(lookup\)/);
  assert.match(
    artwork,
    /if \(!publicArtworkUrl\(url\)\) throw blockedAddress\(\)/,
  );
});
