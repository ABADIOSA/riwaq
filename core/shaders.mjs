/**
 * GLSL shader chains for MPV (issue #70, Harbor's Anime4K and FSRCNNX).
 *
 * Riwaq bundles no shader file. A chain comes from one of two places the
 * viewer chooses: their own folder of .glsl/.hook files, or, on their click,
 * an upstream release Riwaq downloads into its data folder. Each download is
 * pinned by address, size and SHA-256 (electron/shaders.mjs checks them);
 * nothing else is ever fetched. Presets name files, never paths: main joins
 * them to the folder that holds them. Browser-safe.
 */
import { isAnime } from "./anime.mjs";

export { isAnime };

/** Upstream releases Riwaq can download on the viewer's click. */
export const SHADER_PACKS = {
  anime4k: {
    id: "anime4k",
    name: "Anime4K",
    version: "4.0.1",
    license: "MIT",
    home: "https://github.com/bloc97/Anime4K",
    // One zip of every Anime4K 4.0 shader.
    archive: {
      url: "https://github.com/bloc97/Anime4K/releases/download/v4.0.1/Anime4K_v4.0.zip",
      size: 776303,
      sha256:
        "139cd282086457c5adc79caf7b75b8b825091d71c9b54958c18745fea62d7ed7",
    },
  },
  fsrcnnx: {
    id: "fsrcnnx",
    name: "FSRCNNX",
    version: "1.1",
    license: "LGPL-3.0",
    home: "https://github.com/igv/FSRCNN-TensorFlow",
    files: [
      {
        name: "FSRCNNX_x2_8-0-4-1.glsl",
        url: "https://github.com/igv/FSRCNN-TensorFlow/releases/download/1.1/FSRCNNX_x2_8-0-4-1.glsl",
        size: 71296,
        sha256:
          "e800dbc5c1c95185cc82216c597724533ff5f2880179f256eef600f03e8dc2ae",
      },
      {
        name: "FSRCNNX_x2_16-0-4-1.glsl",
        url: "https://github.com/igv/FSRCNN-TensorFlow/releases/download/1.1/FSRCNNX_x2_16-0-4-1.glsl",
        size: 246868,
        sha256:
          "d5a24a271e5d9a3f7f7a053b150c460a44c25b3cf7f770857d57cc3a2e1c9965",
      },
    ],
  },
};

/** Hosts a pinned download may pass through (GitHub's release redirect). */
export const SHADER_HOSTS = [
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
];

const A4K = (name) => `Anime4K_${name}.glsl`;
// Anime4K's own mpv templates (md/Template/GLSL_Windows_*/input.conf), in
// their order: HQ for higher-end cards, Fast for lower-end ones.
const anime4k = (tier) => {
  const [big, small, tail] = tier === "hq" ? ["VL", "M", "M"] : ["M", "S", "S"];
  const pre = [A4K("AutoDownscalePre_x2"), A4K("AutoDownscalePre_x4")];
  const clamp = A4K("Clamp_Highlights");
  const up = A4K(`Upscale_CNN_x2_${big}`);
  const end = A4K(`Upscale_CNN_x2_${tail}`);
  return {
    a: [clamp, A4K(`Restore_CNN_${big}`), up, ...pre, end],
    b: [clamp, A4K(`Restore_CNN_Soft_${big}`), up, ...pre, end],
    c: [clamp, A4K(`Upscale_Denoise_CNN_x2_${big}`), ...pre, end],
    aa: [
      clamp,
      A4K(`Restore_CNN_${big}`),
      up,
      A4K(`Restore_CNN_${small}`),
      ...pre,
      end,
    ],
    bb: [
      clamp,
      A4K(`Restore_CNN_Soft_${big}`),
      up,
      ...pre,
      A4K(`Restore_CNN_Soft_${small}`),
      end,
    ],
    ca: [
      clamp,
      A4K(`Upscale_Denoise_CNN_x2_${big}`),
      ...pre,
      A4K(`Restore_CNN_${small}`),
      end,
    ],
  };
};
const MODES = [
  ["a", "A", "لأنمي 1080p"],
  ["b", "B", "لأنمي 720p"],
  ["c", "C", "لأنمي 480p"],
  ["aa", "A+A", "A بقوة أكبر"],
  ["bb", "B+B", "B بقوة أكبر"],
  ["ca", "C+A", "C ثم A"],
];

/**
 * Every preset: a label, the pack whose files it needs, and those files in
 * order. `anime` presets follow the scope setting (animation only by default).
 */
export const SHADER_PRESETS = [
  ...["hq", "fast"].flatMap((tier) => {
    const chains = anime4k(tier);
    return MODES.map(([mode, label, hint]) => ({
      id: `anime4k-${mode}-${tier}`,
      label: `Anime4K ${label} (${tier === "hq" ? "HQ" : "Fast"})`,
      hint: `${hint} · ${tier === "hq" ? "لكروت الشاشة القوية" : "لكروت الشاشة المتوسطة"}`,
      pack: "anime4k",
      anime: true,
      files: chains[mode],
    }));
  }),
  {
    id: "fsrcnnx-8",
    label: "FSRCNNX x2 (8)",
    hint: "تكبير حادّ للأفلام والمسلسلات · خفيف",
    pack: "fsrcnnx",
    anime: false,
    files: ["FSRCNNX_x2_8-0-4-1.glsl"],
  },
  {
    id: "fsrcnnx-16",
    label: "FSRCNNX x2 (16)",
    hint: "أدق من 8 · يحتاج كرت شاشة أقوى",
    pack: "fsrcnnx",
    anime: false,
    files: ["FSRCNNX_x2_16-0-4-1.glsl"],
  },
];
const PRESET = new Map(SHADER_PRESETS.map((p) => [p.id, p]));

/** Every file a pack's presets use (what a download must deliver). */
export function packFiles(packId) {
  return [
    ...new Set(
      SHADER_PRESETS.filter((p) => p.pack === packId).flatMap((p) => p.files),
    ),
  ];
}

/** A shader file name: no folder, no separator, .glsl or .hook. */
export function shaderFileName(name) {
  return typeof name === "string" &&
    /^[\w][\w .()+,'&-]{0,118}\.(glsl|hook)$/i.test(name) &&
    !name.includes("..")
    ? name
    : "";
}

// Families of shaders people keep in their own folders, by file name.
const FAMILIES = [
  [/^Anime4K_/i, "Anime4K"],
  [/^FSRCNNX/i, "FSRCNNX"],
  [/FSR(?!CNN)|FidelityFX.?Super/i, "AMD FSR"],
  [/FidelityFX.?CAS|(?:^|[\W_])CAS(?:[\W_]|$)/, "AMD CAS"],
  [/NVScaler|NVSharpen|(?:^|[\W_])NIS(?:[\W_]|$)/, "NVIDIA NIS"],
  [/^ravu/i, "RAVU"],
  [/nnedi3/i, "NNEDI3"],
  [/SSimSuperRes/i, "SSimSuperRes"],
  [/SSimDownscaler/i, "SSimDownscaler"],
  [/KrigBilateral/i, "KrigBilateral"],
  [/adaptive.?sharpen/i, "Adaptive Sharpen"],
  [/deband/i, "Deband"],
  [/film.?grain|grain/i, "Film grain"],
  [/ArtCNN/i, "ArtCNN"],
];
/** A friendly family name for a file in the viewer's folder, or "". */
export function shaderFamily(name) {
  return FAMILIES.find(([pattern]) => pattern.test(name))?.[1] || "";
}

/**
 * The viewer's own chain: unique file names, at most 16, in their order.
 * When `available` is given, names missing from it are dropped.
 */
export function cleanShaderChain(list, available) {
  const have = available ? new Set(available) : null;
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const name = shaderFileName(raw);
    if (!name || out.includes(name) || (have && !have.has(name))) continue;
    out.push(name);
    if (out.length >= 16) break;
  }
  return out;
}

/**
 * What the library holds: `packs` maps a pack ID to its folder when it is
 * installed, `own` is the viewer's folder and the shader files found in it.
 * A preset is available when every file it needs is in one place: its
 * downloaded pack first, then the viewer's own folder (where Anime4K is
 * often kept already).
 */
export function presetPlace(preset, library = {}) {
  if (!preset) return null;
  const packDir = library.packs?.[preset.pack];
  if (packDir) return { dir: packDir, files: preset.files };
  const own = new Set(library.own?.files || []);
  if (library.own?.dir && preset.files.every((f) => own.has(f)))
    return { dir: library.own.dir, files: preset.files };
  return null;
}

/** The presets this library can play, plus the viewer's chain if any. */
export function shaderOptions(settings = {}, library = {}) {
  const options = SHADER_PRESETS.filter((p) => presetPlace(p, library)).map(
    ({ id, label, hint, pack, anime }) => ({ id, label, hint, pack, anime }),
  );
  const chain = cleanShaderChain(settings.shaderChain, library.own?.files);
  if (library.own?.dir && chain.length)
    options.push({
      id: "chain",
      label: "سلسلتك",
      hint: chain.join(" ← "),
      pack: "own",
      anime: false,
    });
  if (legacyPath(settings))
    options.push({
      id: "file",
      label: "ملف GLSL",
      hint: "",
      pack: "file",
      anime: false,
    });
  return options;
}

const legacyPath = (settings) =>
  typeof settings.shaderPath === "string" &&
  /\.(glsl|hook)$/i.test(settings.shaderPath)
    ? settings.shaderPath
    : "";

/**
 * The preset a settings object asks for. Before 0.41 a single file was the
 * "custom" picture profile; that still plays as the "file" preset.
 */
export function chosenPreset(settings = {}) {
  const id =
    typeof settings.shaderPreset === "string" ? settings.shaderPreset : "";
  if (id === "chain" || id === "file" || PRESET.has(id)) return id;
  if (!id && settings.shader === "custom" && legacyPath(settings))
    return "file";
  return "";
}

/**
 * The files one viewing plays, in order, as absolute paths (`join` comes
 * from main). An Anime4K preset under the `auto` scope plays only for
 * anime; `force` (a pick during the viewing) plays it anyway.
 */
export function resolveShaders(
  settings = {},
  library = {},
  {
    meta = {},
    force = false,
    preset,
    join = (dir, name) => `${dir}\\${name}`,
  } = {},
) {
  const id = preset ?? chosenPreset(settings);
  if (!id) return { id: "", label: "", files: [] };
  if (id === "file") {
    const path = legacyPath(settings);
    return path
      ? { id, label: "ملف GLSL", files: [path] }
      : { id: "", label: "", files: [] };
  }
  if (id === "chain") {
    const chain = cleanShaderChain(settings.shaderChain, library.own?.files);
    return library.own?.dir && chain.length
      ? {
          id,
          label: "سلسلتك",
          files: chain.map((name) => join(library.own.dir, name)),
        }
      : { id: "", label: "", files: [] };
  }
  const p = PRESET.get(id);
  const place = presetPlace(p, library);
  if (!place) return { id: "", label: "", files: [] };
  if (p.anime && !force && settings.shaderScope !== "all" && !isAnime(meta))
    return { id: "", label: "", files: [], skipped: id };
  return {
    id,
    label: p.label,
    files: place.files.map((name) => join(place.dir, name)),
  };
}

/**
 * The order the shader key steps through: off, then the presets of the
 * current one's pack (all of them when nothing is on).
 */
export function shaderCycle(current, options = []) {
  const now = options.find((o) => o.id === current);
  const same = now ? options.filter((o) => o.pack === now.pack) : options;
  const ids = ["", ...same.map((o) => o.id)];
  return ids[(ids.indexOf(current) + 1) % ids.length] ?? "";
}

const SHADER_KEYS = [
  "shader",
  "shaderPath",
  "shaderPreset",
  "shaderScope",
  "shaderChain",
  "shaderDir",
];
/** The settings a shader choice reads, copied out of a settings object. */
export const shaderFields = (settings = {}) =>
  Object.fromEntries(SHADER_KEYS.map((key) => [key, settings[key]]));

/** One string per shader choice, so a running viewing applies only changes. */
export const shaderWish = (settings = {}) =>
  JSON.stringify([
    chosenPreset(settings),
    settings.shaderScope === "all" ? "all" : "auto",
    cleanShaderChain(settings.shaderChain),
    settings.shaderDir || "",
    settings.shaderPath || "",
  ]);
