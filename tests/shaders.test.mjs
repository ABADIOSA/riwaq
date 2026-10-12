import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import {
  SHADER_PACKS,
  SHADER_PRESETS,
  chosenPreset,
  cleanShaderChain,
  isAnime,
  packFiles,
  presetPlace,
  resolveShaders,
  shaderCycle,
  shaderFamily,
  shaderFileName,
  shaderOptions,
  shaderWish,
} from "../core/shaders.mjs";
import {
  ShaderStore,
  fetchPinned,
  scanShaderFolder,
  zipFiles,
} from "../electron/shaders.mjs";
import { Player, playerArgs, safeVideo } from "../electron/player.mjs";
import { DEFAULT_SETTINGS, safeSettings } from "../core/protocol.mjs";

const posix = (dir, name) => `${dir}/${name}`;
const library = {
  packs: { anime4k: "/data/shaders/anime4k-4.0.1" },
  own: { dir: "/me/shaders", files: ["CAS.glsl", "FSR.glsl", "ravu-r3.hook"] },
};

test("Anime4K presets follow the upstream mpv templates, file for file", () => {
  const a = SHADER_PRESETS.find((p) => p.id === "anime4k-a-hq");
  assert.deepEqual(a.files, [
    "Anime4K_Clamp_Highlights.glsl",
    "Anime4K_Restore_CNN_VL.glsl",
    "Anime4K_Upscale_CNN_x2_VL.glsl",
    "Anime4K_AutoDownscalePre_x2.glsl",
    "Anime4K_AutoDownscalePre_x4.glsl",
    "Anime4K_Upscale_CNN_x2_M.glsl",
  ]);
  const ca = SHADER_PRESETS.find((p) => p.id === "anime4k-ca-fast");
  assert.deepEqual(ca.files, [
    "Anime4K_Clamp_Highlights.glsl",
    "Anime4K_Upscale_Denoise_CNN_x2_M.glsl",
    "Anime4K_AutoDownscalePre_x2.glsl",
    "Anime4K_AutoDownscalePre_x4.glsl",
    "Anime4K_Restore_CNN_S.glsl",
    "Anime4K_Upscale_CNN_x2_S.glsl",
  ]);
  const bb = SHADER_PRESETS.find((p) => p.id === "anime4k-bb-hq");
  assert.deepEqual(bb.files.slice(-2), [
    "Anime4K_Restore_CNN_Soft_M.glsl",
    "Anime4K_Upscale_CNN_x2_M.glsl",
  ]);
  assert.equal(SHADER_PRESETS.filter((p) => p.pack === "anime4k").length, 12);
  assert.equal(packFiles("anime4k").length, 14);
  // Every download is pinned to an HTTPS GitHub release, size and SHA-256.
  for (const pack of Object.values(SHADER_PACKS))
    for (const file of pack.archive ? [pack.archive] : pack.files) {
      assert.match(
        file.url,
        /^https:\/\/github\.com\/[\w-]+\/[\w-]+\/releases\/download\//,
      );
      assert.match(file.sha256, /^[0-9a-f]{64}$/);
      assert.ok(file.size > 0);
    }
});

test("shader names never carry a folder, and families are named", () => {
  assert.equal(shaderFileName("Anime4K_Thin_HQ.glsl"), "Anime4K_Thin_HQ.glsl");
  assert.equal(shaderFileName("ravu-zoom-r3.hook"), "ravu-zoom-r3.hook");
  for (const bad of [
    "../x.glsl",
    "a/b.glsl",
    "a\\b.glsl",
    "C:x.glsl",
    "x.txt",
    ".glsl",
    "x..y.glsl",
    42,
  ])
    assert.equal(shaderFileName(bad), "", String(bad));
  assert.equal(shaderFamily("FSR.glsl"), "AMD FSR");
  assert.equal(shaderFamily("FSRCNNX_x2_8-0-4-1.glsl"), "FSRCNNX");
  assert.equal(shaderFamily("CAS-scaled.glsl"), "AMD CAS");
  assert.equal(shaderFamily("NVScaler.glsl"), "NVIDIA NIS");
  assert.equal(shaderFamily("Finish.glsl"), "");
  assert.deepEqual(
    cleanShaderChain(
      ["b.glsl", "../a.glsl", "b.glsl", "c.hook", "x.glsl"],
      ["b.glsl", "c.hook"],
    ),
    ["b.glsl", "c.hook"],
  );
  assert.equal(
    cleanShaderChain(Array.from({ length: 30 }, (_, i) => `s${i}.glsl`)).length,
    16,
  );
});

test("a preset plays from its pack, or from the viewer's folder when it holds every file", () => {
  const preset = SHADER_PRESETS.find((p) => p.id === "fsrcnnx-8");
  assert.equal(presetPlace(preset, library), null);
  const own = {
    own: {
      dir: "/me",
      files: ["FSRCNNX_x2_8-0-4-1.glsl", ...packFiles("anime4k").slice(0, 5)],
    },
  };
  assert.deepEqual(presetPlace(preset, own), {
    dir: "/me",
    files: ["FSRCNNX_x2_8-0-4-1.glsl"],
  });
  // Half of Anime4K in the folder is not a playable preset.
  assert.ok(!shaderOptions({}, own).some((o) => o.pack === "anime4k"));
  const options = shaderOptions(
    { shaderChain: ["FSR.glsl", "CAS.glsl", "gone.glsl"] },
    library,
  );
  assert.equal(options.filter((o) => o.pack === "anime4k").length, 12);
  const chain = options.find((o) => o.id === "chain");
  assert.equal(chain.hint, "FSR.glsl ← CAS.glsl");
});

test("Anime4K plays on anime under the auto scope, everywhere on request", () => {
  const settings = { shaderPreset: "anime4k-a-hq" };
  const anime = resolveShaders(settings, library, {
    meta: { id: "kitsu:11", type: "series" },
    join: posix,
  });
  assert.equal(anime.id, "anime4k-a-hq");
  assert.equal(
    anime.files[0],
    "/data/shaders/anime4k-4.0.1/Anime4K_Clamp_Highlights.glsl",
  );
  assert.equal(anime.files.length, 6);
  const film = resolveShaders(settings, library, {
    meta: { id: "tt0111161", type: "movie", genres: ["Drama"] },
    join: posix,
  });
  assert.deepEqual(film, {
    id: "",
    label: "",
    files: [],
    skipped: "anime4k-a-hq",
  });
  assert.equal(
    resolveShaders(settings, library, {
      meta: { id: "tt1" },
      force: true,
      join: posix,
    }).files.length,
    6,
  );
  assert.equal(
    resolveShaders({ ...settings, shaderScope: "all" }, library, {
      meta: { id: "tt1" },
      join: posix,
    }).files.length,
    6,
  );
  // The viewer's chain keeps their order; missing files drop out.
  assert.deepEqual(
    resolveShaders(
      {
        shaderPreset: "chain",
        shaderChain: ["ravu-r3.hook", "nope.glsl", "CAS.glsl"],
      },
      library,
      { join: posix },
    ).files,
    ["/me/shaders/ravu-r3.hook", "/me/shaders/CAS.glsl"],
  );
  // A preset whose pack is not installed plays nothing.
  assert.deepEqual(
    resolveShaders({ shaderPreset: "fsrcnnx-16" }, library).files,
    [],
  );
});

test("the old single-file custom profile still plays as the file preset", () => {
  const old = { shader: "custom", shaderPath: "C:\\fx\\a.glsl" };
  assert.equal(chosenPreset(old), "file");
  assert.deepEqual(resolveShaders(old).files, ["C:\\fx\\a.glsl"]);
  assert.equal(
    chosenPreset({ ...old, shaderPreset: "fsrcnnx-8" }),
    "fsrcnnx-8",
  );
  assert.equal(chosenPreset({ shader: "anime", shaderPath: "C:\\a.glsl" }), "");
  assert.equal(chosenPreset({ shaderPreset: "rm -rf" }), "");
  assert.equal(chosenPreset({ shader: "custom", shaderPath: "C:\\a.exe" }), "");
});

test("anime is recognised by its IDs, type or genres", () => {
  assert.ok(isAnime({ id: "mal:5114" }));
  assert.ok(isAnime({ id: "anilist:1" }));
  assert.ok(isAnime({ id: "tt1", type: "anime" }));
  assert.ok(isAnime({ id: "tt1", genres: ["Action", "Anime"] }));
  assert.ok(isAnime({ id: "tt1", genres: ["أنمي"] }));
  assert.ok(isAnime({ id: "tt1", genres: ["Animation"], country: "Japan" }));
  assert.ok(!isAnime({ id: "tt1", genres: ["Animation"], country: "USA" }));
  assert.ok(!isAnime({ id: "tt1", genres: ["Drama"] }));
  assert.ok(!isAnime());
});

test("the shader key steps through the current pack's modes, then off", () => {
  const options = shaderOptions(
    {},
    {
      packs: { anime4k: "/a", fsrcnnx: "/f" },
    },
  );
  assert.equal(shaderCycle("", options), "anime4k-a-hq");
  assert.equal(shaderCycle("anime4k-a-hq", options), "anime4k-b-hq");
  assert.equal(shaderCycle("fsrcnnx-8", options), "fsrcnnx-16");
  assert.equal(shaderCycle("fsrcnnx-16", options), "");
  assert.equal(shaderCycle("", []), "");
});

test("settings keep a known preset and a clean chain; the folder is main's alone", () => {
  const next = safeSettings(
    {
      shaderPreset: "anime4k-c-fast",
      shaderScope: "all",
      shaderChain: ["a.glsl", "../b.glsl"],
      shaderDir: "C:\\Windows",
    },
    DEFAULT_SETTINGS,
  );
  assert.equal(next.shaderPreset, "anime4k-c-fast");
  assert.equal(next.shaderScope, "all");
  assert.deepEqual(next.shaderChain, ["a.glsl"]);
  assert.equal(next.shaderDir, "");
  assert.equal(safeSettings({ shaderPreset: "x;y" }, next).shaderPreset, "");
  assert.equal(safeSettings({ shaderScope: "odd" }, next).shaderScope, "all");
  assert.notEqual(
    shaderWish({ shaderPreset: "fsrcnnx-8" }),
    shaderWish({ shaderPreset: "fsrcnnx-16" }),
  );
});

test("a pinned download refuses other hosts, a wrong size and a wrong digest", async () => {
  const body = Buffer.from("//!HOOK MAIN\nvoid main(){}\n");
  const file = {
    url: "https://github.com/o/r/releases/download/1/x.glsl",
    size: body.length,
    sha256: createHash("sha256").update(body).digest("hex"),
  };
  const via = (location) => async (url) =>
    url.startsWith("https://github.com/")
      ? new Response(null, { status: 302, headers: { location } })
      : new Response(body);
  const ok = await fetchPinned(file, {
    fetch: via("https://release-assets.githubusercontent.com/a/x.glsl"),
  });
  assert.equal(ok.toString(), body.toString());
  for (const location of [
    "https://evil.example/x.glsl",
    "http://release-assets.githubusercontent.com/x.glsl",
    "https://user:pw@objects.githubusercontent.com/x.glsl",
  ])
    await assert.rejects(
      fetchPinned(file, { fetch: via(location) }),
      /غير موثوق/,
    );
  await assert.rejects(
    fetchPinned(
      { ...file, sha256: "0".repeat(64) },
      { fetch: via("https://objects.githubusercontent.com/x") },
    ),
    /بصمة/,
  );
  await assert.rejects(
    fetchPinned(
      { ...file, size: 4 },
      { fetch: async () => new Response(body) },
    ),
    /أكبر/,
  );
  await assert.rejects(
    fetchPinned({ ...file, url: "https://example.com/x.glsl" }),
    /غير موثوق/,
  );
});

/** A small zip: stored and deflated entries, central directory, end record. */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text, deflate] of entries) {
    const raw = Buffer.from(text);
    const data = deflate ? deflateRawSync(raw) : raw;
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

test("a zip gives up only the flat shader files a pack names", () => {
  const archive = zip([
    ["Anime4K_Clamp_Highlights.glsl", "clamp", true],
    ["Anime4K_Restore_CNN_S.glsl", "restore", false],
    ["../Anime4K_Thin_HQ.glsl", "escape", false],
    ["nested/Anime4K_Thin_HQ.glsl", "nested", false],
    ["readme.txt", "hello", false],
  ]);
  const out = zipFiles(archive, [
    "Anime4K_Clamp_Highlights.glsl",
    "Anime4K_Restore_CNN_S.glsl",
    "../Anime4K_Thin_HQ.glsl",
    "nested/Anime4K_Thin_HQ.glsl",
  ]);
  assert.deepEqual(
    [...out.keys()],
    ["Anime4K_Clamp_Highlights.glsl", "Anime4K_Restore_CNN_S.glsl"],
  );
  assert.equal(out.get("Anime4K_Clamp_Highlights.glsl").toString(), "clamp");
  assert.throws(() => zipFiles(Buffer.from("not a zip"), []), /zip/);
});

test("the store reports installed packs and the viewer's folder, and a bad download leaves nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "riwaq-shaders-"));
  const store = new ShaderStore({
    dir,
    fetch: async (url) =>
      url.startsWith("https://github.com/")
        ? new Response(null, {
            status: 302,
            headers: {
              location: "https://release-assets.githubusercontent.com/z",
            },
          })
        : new Response(Buffer.alloc(10)),
  });
  await assert.rejects(store.download("fsrcnnx"), /حجم|بصمة/);
  assert.deepEqual(readdirSync(dir), []);
  await assert.rejects(store.download("nope"), /غير معروفة/);
  // A pack in place with its marker counts as installed; a stale version does not.
  const folder = store.folder("fsrcnnx");
  mkdirSync(folder, { recursive: true });
  for (const name of packFiles("fsrcnnx"))
    writeFileSync(join(folder, name), "x");
  writeFileSync(
    join(folder, ".riwaq-pack"),
    JSON.stringify({ version: "0.9" }),
  );
  assert.equal(store.installed("fsrcnnx"), "");
  writeFileSync(
    join(folder, ".riwaq-pack"),
    JSON.stringify({ version: "1.1" }),
  );
  assert.equal(store.installed("fsrcnnx"), folder);
  const own = join(dir, "mine");
  mkdirSync(own);
  for (const name of ["FSR.glsl", "notes.txt", "ravu.hook"])
    writeFileSync(join(own, name), "x");
  mkdirSync(join(own, "sub.glsl"));
  assert.deepEqual(scanShaderFolder(own), ["FSR.glsl", "ravu.hook"]);
  const view = store.describe({ shaderDir: own });
  assert.equal(view.packs.find((p) => p.id === "fsrcnnx").installed, true);
  assert.deepEqual(
    view.own.files.map((f) => f.family),
    ["AMD FSR", "RAVU"],
  );
  assert.equal(
    store.describe({ shaderDir: join(dir, "gone") }).own.missing,
    true,
  );
  assert.equal(store.remove("fsrcnnx"), true);
  assert.equal(store.installed("fsrcnnx"), "");
});

test("MPV gets one --glsl-shader per file in order, and none in compatibility mode", () => {
  const args = playerArgs({
    pipe: "p",
    settings: DEFAULT_SETTINGS,
    url: "u",
    title: "t",
    shaders: ["C:\\a b\\one.glsl", "C:\\x;y\\two.glsl", "bad\nline.glsl"],
  });
  assert.deepEqual(
    args.filter((a) => a.startsWith("--glsl")),
    ["--glsl-shader=C:\\a b\\one.glsl", "--glsl-shader=C:\\x;y\\two.glsl"],
  );
  const safe = playerArgs({
    pipe: "p",
    settings: {
      ...DEFAULT_SETTINGS,
      shaderPreset: "file",
      shaderPath: "C:\\a.glsl",
      ...safeVideo(1),
    },
    url: "u",
    title: "t",
  });
  assert.ok(!safe.some((a) => a.startsWith("--glsl")));
});

function fakePlayer(settings, lib = library) {
  const commands = [];
  const player = new Player({
    onState() {},
    shaderLibrary: () => lib,
  });
  player.send = (command) => commands.push(command);
  player.settings = settings;
  player.meta = { id: "tt1", type: "movie", genres: ["Drama"] };
  player.state = { active: true };
  return { player, commands };
}

test("a viewing switches presets live by name, and the key cycles them", () => {
  const { player, commands } = fakePlayer({ ...DEFAULT_SETTINGS });
  const start = player.glslFor(player.settings, player.meta);
  assert.equal(start.id, "");
  player.state.glslOptions = start.options;
  player.command({ action: "glsl", value: "anime4k-b-fast" });
  // A pick during the viewing plays even on a film.
  assert.equal(player.state.glsl, "anime4k-b-fast");
  assert.equal(player.state.glslLabel, "Anime4K B (Fast)");
  const set = commands.at(-1);
  assert.equal(set[0], "set_property");
  assert.equal(set[1], "glsl-shaders");
  assert.equal(set[2].length, 6);
  assert.ok(set[2].every((f) => f.startsWith("/data/shaders/anime4k-4.0.1")));
  player.command({ action: "cycleShader" });
  assert.equal(player.state.glsl, "anime4k-c-fast");
  player.command({ action: "glsl", value: "" });
  assert.deepEqual(commands.at(-1), ["set_property", "glsl-shaders", []]);
  // Unknown names change nothing.
  const before = commands.length;
  player.command({ action: "glsl", value: "fsrcnnx-8" });
  assert.equal(commands.length, before);
  // Compatibility mode plays no shader at all.
  player.compatibility = true;
  player.command({ action: "glsl", value: "anime4k-a-hq" });
  assert.equal(commands.length, before);
  assert.deepEqual(player.glslFor(player.settings, player.meta).files, []);
});

test("a shader change in Settings reaches the running viewing once", () => {
  const { player, commands } = fakePlayer({ ...DEFAULT_SETTINGS });
  player.glslWish = shaderWish(player.settings);
  player.tuningSent = new Map();
  player.refreshRtx = () => {};
  const next = {
    ...DEFAULT_SETTINGS,
    shaderPreset: "chain",
    shaderChain: ["CAS.glsl"],
  };
  player.applyTuning(next);
  assert.equal(player.state.glsl, "chain");
  assert.deepEqual(commands.filter((c) => c[1] === "glsl-shaders").at(-1)[2], [
    join("/me/shaders", "CAS.glsl"),
  ]);
  const count = commands.length;
  player.applyTuning(next);
  assert.equal(commands.filter((c) => c[1] === "glsl-shaders").length, 1);
  assert.ok(commands.length >= count);
  // Anime4K chosen in Settings follows the scope on a film.
  player.applyTuning({ ...DEFAULT_SETTINGS, shaderPreset: "anime4k-a-hq" });
  assert.equal(player.state.glsl, "");
  assert.equal(player.state.glslSkipped, "anime4k-a-hq");
  assert.deepEqual(commands.at(-1), ["set_property", "glsl-shaders", []]);
});
