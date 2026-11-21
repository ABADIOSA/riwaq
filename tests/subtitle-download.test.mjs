// Issue #157: "Download subtitles" in the player menu. The bounded fetch
// and file checks (core/subtitle-export.mjs) and main's choices and save
// (electron/subtitle-save.mjs), over a loopback HTTP fixture, a temporary
// folder and a stand-in Save dialog. No outside request is made.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SUBTITLE_MAX,
  fetchSubtitle,
  localHost,
  safeFileName,
  subtitleFileName,
  subtitleFormat,
  subtitleUrl,
} from "../core/subtitle-export.mjs";
import {
  saveSubtitle,
  subtitleMenu,
  subtitleSources,
} from "../electron/subtitle-save.mjs";
import { translate } from "../core/i18n.mjs";

const SRT =
  "1\r\n00:00:01,000 --> 00:00:02,500\r\nمرحبا\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nأهلاً\r\n";
const VTT = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n";
const ASS =
  "[Script Info]\nScriptType: v4.00+\n\n[Events]\nFormat: Layer, Start, End, Style, Text\nDialogue: 0,0:00:01.00,0:00:02.00,Default,Hi\n";
const bytes = (text) => new TextEncoder().encode(text);
// "مرحبا" in Windows-1256: an Arabic file that is not UTF-8.
const CP1256 = Uint8Array.from([
  ...bytes("1\r\n00:00:01,000 --> 00:00:02,000\r\n"),
  0xe3,
  0xd1,
  0xcd,
  0xc8,
  0xc7,
  ...bytes("\r\n"),
]);

async function fixture(routes) {
  const server = createServer((req, res) => {
    const route = routes[req.url];
    if (!route) {
      res.writeHead(404).end("missing");
      return;
    }
    route(req, res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((r) => server.close(r)) };
}

test("subtitleFormat accepts SRT, WebVTT and ASS by their content, and refuses the rest", () => {
  assert.equal(subtitleFormat(bytes(SRT)), "srt");
  assert.equal(subtitleFormat(bytes("\uFEFF" + SRT)), "srt");
  assert.equal(subtitleFormat(CP1256), "srt");
  assert.equal(subtitleFormat(bytes(VTT)), "vtt");
  assert.equal(subtitleFormat(bytes(ASS)), "ass");
  assert.equal(subtitleFormat(bytes(ASS.replace("v4.00+", "v4.00"))), "ssa");
  const utf16 = new Uint8Array([
    0xff,
    0xfe,
    ...new Uint8Array(
      new Uint16Array([...SRT].map((c) => c.charCodeAt(0))).buffer,
    ),
  ]);
  assert.equal(subtitleFormat(utf16), "srt");
  for (const bad of [
    "",
    "<!doctype html><html>00:00:01,000 --> 00:00:02,000</html>",
    "just text",
    "[Script Info]\nno events",
    "WEBVTT\n\nno cues",
  ])
    assert.equal(subtitleFormat(bytes(bad)), null, JSON.stringify(bad));
  assert.equal(
    subtitleFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 1])),
    null,
  );
});

test("file names are valid on Windows and name the title, episode and language", () => {
  assert.equal(
    subtitleFileName({
      title: "The Show",
      videoId: "tt1234567:1:2",
      lang: "ar",
      format: "srt",
    }),
    "The Show S01E02.ar.srt",
  );
  assert.equal(
    subtitleFileName({
      title: 'A/B: "C"? <D>|*',
      videoId: "tt1",
      lang: "",
      format: "vtt",
    }),
    "A B C D.vtt",
  );
  assert.equal(subtitleFileName({ title: "CON", format: "srt" }), "Riwaq.srt");
  assert.equal(
    subtitleFileName({ title: "...", lang: "x y", format: "exe" }),
    "Riwaq.srt",
  );
  assert.equal(safeFileName("name.  "), "name");
  assert.equal(safeFileName("\u202Egnp.exe"), "gnp.exe");
  assert.ok(safeFileName("ا".repeat(400)).length <= 120);
  assert.equal(safeFileName("a\\..\\..\\b"), "a .. .. b");
});

test("subtitle addresses: http(s) only, no credentials, local only at a trusted origin", () => {
  assert.equal(
    subtitleUrl("https://subs.example/x.srt#frag"),
    "https://subs.example/x.srt",
  );
  for (const bad of [
    "file:///C:/x.srt",
    "ftp://a/x",
    "javascript:alert(1)",
    "https://u:p@a.example/x",
    "nonsense",
  ])
    assert.throws(() => subtitleUrl(bad), undefined, bad);
  assert.throws(() => subtitleUrl("http://192.168.1.4/x.srt"));
  // Codex's final acceptance: naming a local address grants nothing; only
  // the supplying addon's own local origin (scheme, host and port) does.
  assert.throws(() => subtitleUrl("http://127.0.0.1:11470/x.vtt"));
  assert.equal(
    subtitleUrl("http://127.0.0.1:11470/x.vtt", {
      trusted: ["http://127.0.0.1:11470"],
    }),
    "http://127.0.0.1:11470/x.vtt",
  );
  for (const other of [
    "http://127.0.0.1:11471/x.vtt",
    "https://127.0.0.1:11470/x.vtt",
    "http://localhost:11470/x.vtt",
    "http://192.168.1.4:11470/x.vtt",
  ])
    assert.throws(
      () => subtitleUrl(other, { trusted: ["http://127.0.0.1:11470"] }),
      /شبكتك/,
      other,
    );
  for (const host of [
    "localhost",
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.0.1",
    "169.254.0.1",
    "[::1]",
    "[fd00::1]",
    "nas",
    "box.local",
  ])
    assert.equal(localHost(host), true, host);
  for (const host of ["subs.example", "8.8.8.8", "172.32.0.1"])
    assert.equal(localHost(host), false, host);
});

test("fetchSubtitle: an addon's local address, a broken one, a timeout and a size cap", async () => {
  const srv = await fixture({
    "/ok.srt": (req, res) => {
      assert.equal(req.headers.cookie, undefined);
      res
        .writeHead(200, { "Content-Type": "application/x-subrip" })
        .end(Buffer.from(SRT));
    },
    "/slow.srt": () => {},
    "/huge.srt": (req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      const chunk = Buffer.alloc(256 * 1024, 0x41);
      let sent = 0;
      const push = () => {
        while (sent < 24 && res.write(chunk)) sent++;
        if (sent < 24) res.once("drain", push);
        else res.end();
      };
      push();
    },
    "/page.srt": (req, res) =>
      res.writeHead(200, { "Content-Type": "text/html" }).end("<html>"),
    "/hop.srt": (req, res) => res.writeHead(302, { Location: "/ok.srt" }).end(),
  });
  try {
    // The fixture stands in for a configured local addon: its origin is
    // trusted, as main's trustedOrigin names it.
    const trusted = [srv.base];
    // Without that trust the same address is refused before any request.
    await assert.rejects(fetchSubtitle(srv.base + "/ok.srt"), /شبكتك/);
    const got = await fetchSubtitle(srv.base + "/ok.srt", { trusted });
    assert.equal(Buffer.from(got).toString(), SRT);
    assert.equal(
      Buffer.from(
        await fetchSubtitle(srv.base + "/hop.srt", { trusted }),
      ).toString(),
      SRT,
    );
    await assert.rejects(
      fetchSubtitle(srv.base + "/missing.srt", { trusted }),
      /HTTP 404/,
    );
    await assert.rejects(
      fetchSubtitle(srv.base + "/slow.srt", { timeout: 300, trusted }),
      /مهلة/,
    );
    await assert.rejects(
      fetchSubtitle(srv.base + "/huge.srt", { max: 1024 * 1024, trusted }),
      /كبير/,
    );
    await assert.rejects(
      fetchSubtitle(srv.base + "/page.srt", { trusted }),
      /لم يرسل ملف ترجمة/,
    );
    const controller = new AbortController();
    const pending = fetchSubtitle(srv.base + "/slow.srt", {
      signal: controller.signal,
      timeout: 10000,
      trusted,
    });
    controller.abort();
    await assert.rejects(pending);
  } finally {
    await srv.close();
  }
});

test("fetchSubtitle never lets a public address redirect into the viewer's network", async () => {
  const seen = [];
  const fake = async (url) => {
    seen.push(url);
    if (url.startsWith("https://subs.example/a"))
      return new Response(null, {
        status: 302,
        headers: { Location: "http://127.0.0.1:8080/secret" },
      });
    if (url.startsWith("https://subs.example/b"))
      return new Response(null, {
        status: 301,
        headers: { Location: "file:///etc/passwd" },
      });
    if (url.startsWith("https://subs.example/loop"))
      return new Response(null, {
        status: 302,
        headers: { Location: "/loop" },
      });
    return new Response("unexpected", { status: 500 });
  };
  await assert.rejects(
    fetchSubtitle("https://subs.example/a", { fetch: fake }),
    /شبكتك/,
  );
  await assert.rejects(
    fetchSubtitle("https://subs.example/b", { fetch: fake }),
    /غير مدعوم/,
  );
  await assert.rejects(
    fetchSubtitle("https://subs.example/loop", { fetch: fake }),
    /تحويلات/,
  );
  assert.ok(
    !seen.some((u) => u.includes("127.0.0.1") || u.startsWith("file:")),
  );
});

// MPV's raw track list as main holds it: an addon subtitle (loaded by its
// address under an addon key), a file the viewer opened, an embedded track.
const ADDON = "https://subs.example/ar.srt";
const tracks = (selected) => [
  { id: 1, type: "video" },
  {
    id: 2,
    type: "sub",
    lang: "eng",
    title: "English",
    selected: selected === 2,
  },
  {
    id: 3,
    type: "sub",
    lang: "ar",
    title: "OpenSubtitles",
    external: true,
    "external-filename": ADDON,
    selected: selected === 3,
  },
  {
    id: 4,
    type: "sub",
    lang: "fr",
    external: true,
    "external-filename": "/home/viewer/film.fr.srt",
    selected: selected === 4,
  },
  {
    id: 5,
    type: "sub",
    external: true,
    "external-filename": "/home/viewer/film.exe",
  },
  {
    id: 6,
    type: "sub",
    external: true,
    "external-filename": "https://elsewhere.example/x.srt",
  },
];
const external = new Map([[ADDON, { key: "k1" }]]);
const ADDON_ORIGIN = "https://subs.example/manifest.json";
const sources = (selected, origin = ADDON_ORIGIN) =>
  subtitleSources({
    tracks: tracks(selected),
    externalSubs: external,
    addonUrl: (k) => (k === "k1" ? ADDON : ""),
    addonOrigin: (k) => (k === "k1" ? origin : ""),
  });

test("choices: addon and local subtitles can be saved, embedded ones cannot; the page sees ids and labels only", () => {
  const all = sources(3);
  assert.deepEqual(
    all.map((s) => [s.id, s.kind]),
    [
      ["t2", "embedded"],
      ["t3", "addon"],
      ["t4", "file"],
      ["t5", "other"],
      ["t6", "other"],
    ],
  );
  const menu = subtitleMenu(all);
  assert.deepEqual(menu, {
    choices: [
      { id: "t3", label: "العربية · OpenSubtitles", selected: true },
      { id: "t4", label: "الفرنسية · ملف على هذا الجهاز", selected: false },
    ],
    reason: "",
  });
  const text = JSON.stringify(menu);
  assert.ok(!text.includes("http") && !text.includes("/home/"));
  assert.equal(
    translate(menu.choices[1].label, "en"),
    "French · file on this computer",
  );
  const embedded = subtitleMenu(
    sources(2).filter((s) => s.kind === "embedded"),
  );
  assert.deepEqual(embedded.choices, []);
  assert.equal(embedded.reason, "مدمجة في ملف الفيديو");
  assert.equal(translate(embedded.reason, "en"), "Inside the video file");
  assert.equal(subtitleMenu([]).reason, "لا ترجمة محمّلة");
});

test("saving: the selected addon subtitle, the exact bytes, cancel writes nothing, a stale or embedded choice is refused", async () => {
  const dir = mkdtempSync(join(tmpdir(), "riwaq-subtitle-"));
  try {
    const fetch = async (url) => {
      assert.equal(url, ADDON);
      return new Response(CP1256, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    };
    const asked = [];
    const target = join(dir, "picked.srt");
    const done = await saveSubtitle({
      choice: "t3",
      sources: sources(3),
      title: "The Show",
      videoId: "tt1:1:2",
      downloads: dir,
      fetch,
      showSaveDialog: async (options) => {
        asked.push(options);
        return { canceled: false, filePath: target };
      },
    });
    assert.deepEqual(done, { saved: true, name: "picked.srt", format: "srt" });
    assert.deepEqual(new Uint8Array(readFileSync(target)), CP1256);
    assert.equal(asked[0].defaultPath, join(dir, "The Show S01E02.ar.srt"));
    assert.ok(asked[0].properties.includes("showOverwriteConfirmation"));
    assert.deepEqual(readdirSync(dir), ["picked.srt"]);
    // An existing file is replaced only once the dialog (which asks first) returns it.
    writeFileSync(target, "old");
    await saveSubtitle({
      choice: "t3",
      sources: sources(3),
      downloads: dir,
      fetch,
      showSaveDialog: async () => ({ canceled: true }),
    }).then((r) => assert.deepEqual(r, { saved: false }));
    assert.equal(readFileSync(target, "utf8"), "old");
    await saveSubtitle({
      choice: "t3",
      sources: sources(3),
      downloads: dir,
      fetch,
      showSaveDialog: async () => ({ canceled: false, filePath: target }),
    });
    assert.deepEqual(new Uint8Array(readFileSync(target)), CP1256);
    for (const [choice, message] of [
      ["t2", /مدمجة/],
      ["t9", /لم تعد/],
      ["../x", /اختر ترجمة/],
      [undefined, /اختر ترجمة/],
    ])
      await assert.rejects(
        saveSubtitle({
          choice,
          sources: sources(3),
          downloads: dir,
          fetch,
          showSaveDialog: async () => assert.fail("no dialog"),
        }),
        message,
      );
    await assert.rejects(
      saveSubtitle({
        choice: "t3",
        sources: sources(3),
        downloads: dir,
        fetch: async () => new Response("<html>login</html>", { status: 200 }),
        showSaveDialog: async () =>
          assert.fail("no dialog for a file that is not a subtitle"),
      }),
      /ليس ملف ترجمة/,
    );
    await assert.rejects(
      saveSubtitle({
        choice: "t3",
        sources: sources(3),
        downloads: dir,
        fetch,
        showSaveDialog: async () => ({
          canceled: false,
          filePath: "relative.srt",
        }),
      }),
      /غير صالح/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saving a subtitle file the viewer opened copies it; one that is gone or too large is refused", async () => {
  const dir = mkdtempSync(join(tmpdir(), "riwaq-subtitle-"));
  try {
    const own = join(dir, "film.fr.srt");
    writeFileSync(own, VTT);
    const list = subtitleSources({
      tracks: [
        {
          id: 7,
          type: "sub",
          lang: "fr",
          external: true,
          "external-filename": own,
          selected: true,
        },
      ],
      externalSubs: new Map(),
      addonUrl: () => "",
    });
    const target = join(dir, "out", "copy.vtt");
    const done = await saveSubtitle({
      choice: "t7",
      sources: list,
      downloads: dir,
      showSaveDialog: async (o) => {
        assert.equal(o.defaultPath, join(dir, "Riwaq.fr.vtt"));
        return { canceled: false, filePath: join(dir, "copy.vtt") };
      },
    });
    assert.equal(done.saved, true);
    assert.equal(readFileSync(join(dir, "copy.vtt"), "utf8"), VTT);
    writeFileSync(own, Buffer.alloc(SUBTITLE_MAX + 1, 0x41));
    await assert.rejects(
      saveSubtitle({
        choice: "t7",
        sources: list,
        showSaveDialog: async () => assert.fail(),
      }),
      /كبير/,
    );
    rmSync(own);
    await assert.rejects(
      saveSubtitle({
        choice: "t7",
        sources: list,
        showSaveDialog: async () => assert.fail(),
      }),
      /لم يعد موجوداً/,
    );
    assert.equal(existsSync(target), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const read = (path) =>
  readFileSync(fileURLToPath(new URL("../" + path, import.meta.url)), "utf8");

test("main: the menu gets ids and labels, the save is gated, checked for this viewing and never given to the web", () => {
  const main = read("electron/main.mjs");
  const menu = main.slice(
    main.indexOf("function playbackMenu"),
    main.indexOf("function torrentEngines"),
  );
  assert.match(menu, /subtitles: subtitleMenu\(viewingSubtitles\(\)\)/);
  const save = main.slice(
    main.indexOf("async function saveViewingSubtitle"),
    main.indexOf("function torrentEngines"),
  );
  assert.match(save, /client\.profiles\.gate\("library"\)/);
  assert.match(save, /dialog\.showSaveDialog\(parent, options\)/);
  const action = main.slice(
    main.indexOf("async function playbackAction"),
    main.indexOf("// The built-in torrent engine"),
  );
  // The viewing check comes before any action, the new one included.
  assert.ok(
    action.indexOf("انتهت هذه المشاهدة") <
      action.indexOf('"downloadSubtitles"'),
  );
  assert.match(read("web/desktop-only.js"), /playbackAction/);
  // The page never reads an address or a path from the choices.
  const component = read("src/components/PlayerMenu.jsx");
  assert.doesNotMatch(component, /\.url\b|\.path\b|filePath/);
});
