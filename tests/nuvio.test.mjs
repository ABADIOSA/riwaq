import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import {
  NUVIO_STORES,
  nuvioFolders,
  nuvioPreview,
  nuvioProfile,
  parseProperties,
  readNuvioZip,
} from "../core/nuvio.mjs";
import { Client } from "../core/client.mjs";

/** Writes like java.util.Properties.store: escapes, \uXXXX, ISO-8859-1. */
function storeProperties(entries) {
  // Java escapes each UTF-16 unit, so an emoji becomes a surrogate pair.
  const escape = (text, key) =>
    String(text)
      .split("")
      .map((ch, i) => {
        const code = ch.charCodeAt(0);
        if (ch === "\\") return "\\\\";
        if (ch === "\t") return "\\t";
        if (ch === "\n") return "\\n";
        if (ch === "\r") return "\\r";
        if (ch === "\f") return "\\f";
        if ("=:#!".includes(ch)) return `\\${ch}`;
        if (ch === " " && (key || i === 0)) return "\\ ";
        if (code < 0x20 || code > 0x7e)
          return `\\u${code.toString(16).toUpperCase().padStart(4, "0")}`;
        return ch;
      })
      .join("");
  return [
    "#Nuvio desktop preferences",
    "#Tue Sep 29 07:00:00 AST 2026",
    ...Object.entries(entries).map(
      ([k, v]) => `${escape(k, true)}=${escape(v)}`,
    ),
  ].join("\n");
}

const COLLECTIONS = [
  {
    id: "c1",
    title: "أبطال مارفل",
    pinToTop: true,
    folders: [
      {
        id: "f1",
        title: "الأفلام",
        coverEmoji: "🦸",
        sources: [
          {
            provider: "addon",
            addonId: "com.linvo.cinemeta",
            type: "movie",
            catalogId: "top",
          },
          { provider: "tmdb", tmdbSourceType: "COLLECTION", tmdbId: 86311 },
        ],
      },
    ],
  },
];
const STORES = {
  nuvio_profiles: {
    profiles: JSON.stringify({
      userId: "u",
      activeProfileIndex: 1,
      profiles: [
        { profile_index: 1, name: "عبادي" },
        { profile_index: 2, name: "Kids" },
      ],
    }),
  },
  nuvio_addons: {
    installed_addon_urls_1: JSON.stringify([
      "https://v3-cinemeta.strem.io/manifest.json",
      "https://torrentio.strem.fun/qualityfilter=cam/manifest.json",
      "https://opensubtitles.strem.io",
      "javascript:alert(1)",
      "https://v3-cinemeta.strem.io/manifest.json",
    ]),
    addon_enabled_states_1: JSON.stringify({
      "https://torrentio.strem.fun/qualityfilter=cam/manifest.json": false,
    }),
  },
  nuvio_collections: { collections_1: JSON.stringify(COLLECTIONS) },
  nuvio_plugins: {
    plugins_state_1: JSON.stringify({
      pluginsEnabled: true,
      repositories: [
        {
          manifestUrl: "https://plugins.example/repo/manifest.json",
          name: "Repo",
          scraperCount: 12,
        },
        { manifestUrl: "file:///C:/evil", name: "Evil" },
      ],
      scrapers: [{ id: "s1", code: "fetch('https://x').then(steal)" }],
    }),
  },
  nuvio_tmdb_settings: {
    tmdb_api_key_1: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
    tmdb_language_1: "ar",
  },
  nuvio_library: {
    library_1: JSON.stringify({
      items: [
        {
          id: "tt1375666",
          type: "movie",
          name: "Inception",
          poster: "https://img/p.jpg",
        },
        { id: "tt0903747", type: "series", name: "Breaking Bad" },
        { id: "", type: "movie", name: "broken" },
      ],
    }),
    library_2: JSON.stringify({
      items: [{ id: "tt0114709", type: "movie", name: "Toy Story" }],
    }),
  },
};
const asText = () =>
  Object.fromEntries(
    Object.entries(STORES).map(([name, entries]) => [
      name,
      storeProperties(entries),
    ]),
  );

test("Java properties parse back exactly, Arabic and JSON included", () => {
  for (const [name, text] of Object.entries(asText())) {
    const parsed = parseProperties(text);
    assert.deepEqual({ ...parsed }, STORES[name], name);
  }
  const tricky = parseProperties(
    [
      "! comment",
      "  key\\ with\\ spaces = value one",
      "colon:value",
      "multi = first \\",
      "    second",
      "empty",
      "escaped\\=key=v\\\\",
    ].join("\r\n"),
  );
  assert.equal(tricky["key with spaces"], "value one");
  assert.equal(tricky.colon, "value");
  assert.equal(tricky.multi, "first second");
  assert.equal(tricky.empty, "");
  assert.equal(tricky["escaped=key"], "v\\");
});

test("a Nuvio profile is read and cleaned", () => {
  const stores = Object.fromEntries(
    Object.entries(asText()).map(([n, t]) => [n, parseProperties(t)]),
  );
  const preview = nuvioPreview(stores);
  assert.deepEqual(
    preview.map((p) => [p.index, p.name]),
    [
      [1, "عبادي"],
      [2, "Kids"],
    ],
  );
  assert.deepEqual(
    { ...preview[0], index: undefined, name: undefined },
    {
      index: undefined,
      name: undefined,
      addons: 3,
      collections: 1,
      folders: 1,
      skippedSources: 0,
      plugins: 1,
      scrapers: 12,
      library: 2,
      tmdbKey: true,
      tmdbSources: 1,
      folderList: [
        {
          collection: "أبطال مارفل",
          title: "الأفلام",
          sources: 2,
          unsupported: 0,
        },
      ],
    },
  );
  assert.ok(
    !JSON.stringify(preview).includes("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"),
    "the preview says a key exists, never what it is",
  );
  const p = nuvioProfile(stores, 1);
  assert.deepEqual(
    p.addons.map((a) => [a.url, a.enabled]),
    [
      ["https://v3-cinemeta.strem.io/manifest.json", true],
      ["https://torrentio.strem.fun/qualityfilter=cam/manifest.json", false],
      ["https://opensubtitles.strem.io/manifest.json", true],
    ],
    "deduplicated, manifest path added, junk refused, enabled state kept",
  );
  assert.deepEqual(p.plugins, [
    {
      url: "https://plugins.example/repo/manifest.json",
      name: "Repo",
      scrapers: 12,
    },
  ]);
  assert.ok(!JSON.stringify(p).includes("steal"), "scraper code is never kept");
  assert.equal(p.collections.collections[0].title, "أبطال مارفل");
  assert.equal(nuvioProfile(stores, 2).library[0].name, "Toy Story");
  assert.deepEqual(nuvioPreview({}), []);
});

/** A small zip writer: one deflated and one stored entry, plus a stranger. */
function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text, method] of files) {
    const raw = Buffer.from(text, "latin1");
    const data = method === 8 ? deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

test("a Nuvio settings backup zip is read, and only its known stores", () => {
  const text = asText();
  const archive = zip([
    ["preferences/nuvio_addons.properties", text.nuvio_addons, 8],
    ["preferences/nuvio_collections.properties", text.nuvio_collections, 0],
    ["preferences/nuvio_trakt_auth.properties", "access_token=secret", 0],
    ["backup-info.txt", "Nuvio settings backup", 0],
  ]);
  const stores = readNuvioZip(archive);
  assert.deepEqual(Object.keys(stores).sort(), [
    "nuvio_addons",
    "nuvio_collections",
  ]);
  assert.ok(
    !JSON.stringify(stores).includes("secret"),
    "auth stores are not opened",
  );
  assert.equal(nuvioProfile(stores, 1).addons.length, 3);
  assert.throws(() => readNuvioZip(Buffer.from("not a zip")), /zip/);
  assert.throws(
    () => readNuvioZip(zip([["backup-info.txt", "x", 0]])),
    /لم نجد بيانات نوفيو/,
  );
  assert.deepEqual(NUVIO_STORES.includes("nuvio_trakt_auth"), false);
});

test("Nuvio's folders on Windows, newest layout first", () => {
  assert.deepEqual(
    nuvioFolders({ LOCALAPPDATA: "C:\\L", APPDATA: "C:\\R" }).map(
      (f) => f.path,
    ),
    ["C:\\L\\NuvioHTPC", "C:\\R\\Nuvio", "C:\\L\\Nuvio"],
  );
  assert.equal(
    nuvioFolders({}, "C:\\Users\\a")[0].path,
    "C:\\Users\\a\\AppData\\Local\\NuvioHTPC",
  );
});

test("importing: addons through the manifest check, the rest merged", async () => {
  const stores = Object.fromEntries(
    Object.entries(asText()).map(([n, t]) => [n, parseProperties(t)]),
  );
  const manifest = (id) => ({
    id,
    name: id,
    version: "1.0.0",
    resources: ["catalog"],
    types: ["movie"],
    catalogs: [],
  });
  const client = new Client({
    load: () => ({
      addons: [
        {
          transportUrl: "https://v3-cinemeta.strem.io/manifest.json",
          manifest: manifest("com.linvo.cinemeta"),
        },
      ],
      favorites: [{ id: "tt1375666", type: "movie", name: "Inception" }],
    }),
    save: () => {},
    request: async (url) => {
      if (url.includes("torrentio")) return manifest("com.stremio.torrentio");
      throw new Error("HTTP 500");
    },
  });
  const { result, state } = await client.importNuvio(stores, {
    profile: 1,
    parts: {
      addons: true,
      collections: true,
      library: true,
      plugins: true,
      tmdbKey: true,
    },
  });
  assert.equal(result.addons, 1, "cinemeta was already installed");
  assert.deepEqual(result.addonFailures, ["opensubtitles.strem.io"]);
  const torrentio = state.addons.find((a) => a.id === "com.stremio.torrentio");
  assert.equal(torrentio.enabled, false, "Nuvio's disabled state carries over");
  assert.equal(result.collections, 1);
  assert.equal(result.skippedSources, 0, "the TMDB source carried over");
  assert.equal(result.library, 1, "Inception was already saved");
  assert.equal(result.plugins, 1);
  assert.deepEqual(state.nuvioPlugins[0].name, "Repo");
  assert.equal(result.tmdbKey, "imported");
  assert.equal(
    client.state.providers.tmdb.key,
    "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
    "the key goes to the encrypted provider store",
  );
  assert.ok(
    !JSON.stringify(state).includes("a1b2c3d4e5f6"),
    "and never into the interface state",
  );
  assert.ok(
    !JSON.stringify(state).includes("plugins.example/repo"),
    "repo URLs stay in main",
  );
  // Nothing chosen, nothing changed.
  const again = await client.importNuvio(stores, { profile: 1, parts: {} });
  assert.deepEqual(
    { ...again.result, addonFailures: again.result.addonFailures.length },
    {
      addons: 0,
      addonFailures: 0,
      collections: 0,
      skippedSources: 0,
      library: 0,
      plugins: 0,
      tmdbKey: "",
    },
  );
  await assert.rejects(client.importNuvio(stores, { profile: 0 }), /اختر/);
  const pasted = client.importNuvioCollections({
    text: JSON.stringify(COLLECTIONS),
  });
  assert.equal(
    pasted.result.collections,
    1,
    "a re-import updates the same collection",
  );
  assert.equal(pasted.state.collections.length, 1);
  assert.throws(() => client.importNuvioCollections({ text: "" }), /الصق/);
});

test("a shape-only diagnostic report, with no addresses or keys", async () => {
  const { nuvioDiagnostics } = await import("../core/nuvio.mjs");
  const stores = Object.fromEntries(
    Object.entries(asText()).map(([n, t]) => [n, parseProperties(t)]),
  );
  const report = nuvioDiagnostics(stores, 1);
  assert.match(report, /collection keys: collections_1/);
  assert.match(report, /folder 0 "الأفلام": \{/);
  assert.match(report, /sources: 2/);
  assert.match(report, /provider=tmdb tmdbSourceType=COLLECTION/);
  for (const secret of ["a1b2c3d4", "https://", "torrentio"])
    assert.ok(!report.includes(secret), `no ${secret} in the report`);
  assert.match(nuvioDiagnostics({}, 3), /no collections_3/);
});
