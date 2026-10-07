/**
 * The picture and sound of a viewing, from MPV's own options (Harbor's
 * Video quality, Audio and Player engine pages, rebuilt for Riwaq). Every
 * choice here is an MPV option or an FFmpeg filter MPV ships; nothing is
 * downloaded. Settings that MPV can change on a running instance are applied
 * live (`liveTuning`); the rest apply to the next viewing. Pure.
 */

/** Ten bands are more than a viewer can read; seven show the shape. */
export const EQ_BANDS = [60, 150, 400, 1000, 2500, 6000, 12000];

/**
 * Sound profiles: gains in dB per band of EQ_BANDS. The settings preview
 * draws these numbers, and the filter is built from the same numbers, so the
 * picture is the sound. Night mode also compresses loud moments.
 */
export const AUDIO_PROFILES = {
  flat: {
    label: "مسطح",
    text: "بدون تشكيل. الصوت كما مُزج.",
    gains: [0, 0, 0, 0, 0, 0, 0],
  },
  bass: {
    label: "تفخيم الباس",
    text: "باس أعمق للأفلام والموسيقى، بدون ما يغطي الحوار.",
    gains: [6, 4, 1, 0, 0, 0, 0],
  },
  voice: {
    label: "وضوح الصوت البشري",
    text: "يرفع نطاق الكلام ويخفف الطنين، للحوار الخافت.",
    gains: [-3, -2, 0, 2, 4, 2, 0],
  },
  lessbass: {
    label: "باس أقل",
    text: "للسماعات الصغيرة أو الجيران، يخفف الاهتزاز.",
    gains: [-6, -4, -1, 0, 0, 0, 0],
  },
  night: {
    label: "الوضع الليلي",
    text: "يضغط الانفجارات ويرفع الهمس، فتشاهد ليلاً بصوت منخفض.",
    gains: [-3, -2, 0, 2, 3, 1, -1],
    compress: true,
  },
};
export const AUDIO_PROFILE_IDS = Object.keys(AUDIO_PROFILES);
export const VOLUME_MAX = [100, 150, 200, 300, 400, 600];
export const VIDEO_QUALITY = ["smooth", "balanced", "high"];
export const HWDEC_MODES = ["auto", "on", "off"];
export const RENDERERS = ["gpu-next", "gpu"];
export const DISPLAY_PANELS = ["auto", "oled", "lcd"];

const NORMALIZE = "dynaudnorm=f=150:g=15:p=0.9";
// Night mode: loud moments are pressed down and the whole made up again.
const COMPRESS =
  "acompressor=threshold=0.08:ratio=4:attack=5:release=250:makeup=2";

/** The FFmpeg filter chain for a profile, or "" when it is flat. */
export function profileChain(id) {
  const profile = AUDIO_PROFILES[id] || AUDIO_PROFILES.flat;
  const parts = profile.gains
    .map((gain, index) =>
      gain ? `equalizer=f=${EQ_BANDS[index]}:t=o:w=1.2:g=${gain}` : "",
    )
    .filter(Boolean);
  if (profile.compress) parts.push(COMPRESS);
  return parts.join(",");
}

/**
 * MPV's audio filter list for these settings, "" for none. Each filter is
 * labelled so a later change replaces it rather than stacking another.
 */
export function audioFilters(settings = {}) {
  const filters = [];
  const chain = profileChain(settings.audioProfile);
  if (chain) filters.push(`@riwaqeq:lavfi=[${chain}]`);
  if (settings.audioNormalize) filters.push(`@riwaqnorm:lavfi=[${NORMALIZE}]`);
  return filters.join(",");
}

/** The loudest the volume can go, in percent. */
export const volumeMax = (settings = {}) =>
  VOLUME_MAX.includes(Number(settings.volumeMax))
    ? Number(settings.volumeMax)
    : 150;

/**
 * An audio output as MPV names it ("wasapi/{…}", "openal/…"), or "" for
 * Windows' default. Printable, at most 240 characters, no quotes.
 */
export function cleanAudioDevice(value) {
  if (typeof value !== "string" || value === "auto") return "";
  return /^[^\u0000-\u001f\u007f'"]{1,240}$/.test(value) ? value : "";
}

/** MPV's `--audio-device=help` listing, as [{ id, name }]. */
export function parseAudioDevices(text) {
  const devices = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = /^\s*'([^']+)'\s+\((.*)\)\s*$/.exec(line);
    if (!match) continue;
    const id = cleanAudioDevice(match[1]);
    if (!id || devices.some((d) => d.id === id)) continue;
    devices.push({ id, name: match[2].slice(0, 160) || id });
    if (devices.length >= 40) break;
  }
  return devices;
}

/** Downmixing keeps the centre (dialogue) channel at full level. */
const DOWNMIX = ["--audio-channels=stereo", "--audio-swresample-o=clev=1.0"];

/** Start-up options for the sound. */
export function audioArgs(settings = {}) {
  const args = [`--volume-max=${volumeMax(settings)}`];
  const filters = audioFilters(settings);
  if (filters) args.push(`--af=${filters}`);
  if (settings.audioDownmix) args.push(...DOWNMIX);
  const device = cleanAudioDevice(settings.audioDevice);
  if (device) args.push(`--audio-device=${device}`);
  return args;
}

/** How MPV decodes: Windows' D3D11 decoder when forced, MPV's safe list on auto. */
export function hwdecValue(settings = {}) {
  if (settings.hardwareDecoding === false || settings.hwdec === "off")
    return "no";
  // NVIDIA's processing needs frames that stay on the GPU.
  if (settings.hwdec === "on" || settings.rtxUpscale || settings.rtxHdr)
    return "d3d11va";
  return "auto-safe";
}

/**
 * Start-up options for the picture: MPV's own quality profiles, the
 * renderer, the display's HDR signal and panel, and two compatibility modes.
 * Simple colour and the lineless mode both turn the HDR signal off, since
 * they work by leaving the path HDR needs.
 */
export function videoArgs(settings = {}) {
  const args = [];
  if (settings.videoQuality === "smooth") args.push("--profile=fast");
  else if (settings.videoQuality === "high")
    args.push("--profile=high-quality");
  args.push(`--hwdec=${hwdecValue(settings)}`);
  args.push(`--vo=${settings.renderer === "gpu" ? "gpu" : "gpu-next"}`);
  const plain = !!settings.simpleColor || !!settings.linelessVideo;
  args.push(
    `--target-colorspace-hint=${settings.hdr && !plain ? "yes" : "no"}`,
  );
  if (settings.simpleColor)
    args.push("--d3d11-output-format=rgba8", "--dither-depth=8");
  if (settings.linelessVideo) args.push("--d3d11-flip=no");
  if (settings.displayPanel === "oled") args.push("--target-contrast=inf");
  else if (settings.displayPanel === "lcd") args.push("--target-contrast=1000");
  return args;
}

/**
 * The properties a running MPV takes as they are, for a settings change
 * during a viewing: [property, value] pairs.
 */
export function liveTuning(settings = {}) {
  const pairs = [
    ["af", audioFilters(settings)],
    ["volume-max", volumeMax(settings)],
    ["audio-device", cleanAudioDevice(settings.audioDevice) || "auto"],
    ["audio-channels", settings.audioDownmix ? "stereo" : "auto-safe"],
  ];
  if (settings.displayPanel === "oled") pairs.push(["target-contrast", "inf"]);
  else if (settings.displayPanel === "lcd")
    pairs.push(["target-contrast", 1000]);
  else pairs.push(["target-contrast", "auto"]);
  return pairs;
}

/**
 * NVIDIA RTX Video through MPV's D3D11 video processor. Upscaling asks for
 * the factor from the picture to the display; HDR is for SDR pictures on an
 * HDR display only. Each entry is one filter to try, in order: MPV keeps the
 * old chain when a filter cannot start, so a card without the feature just
 * stays as it was. "" when there is nothing to do.
 */
export function rtxFilters(settings = {}, video = {}) {
  if (video.decoder !== "d3d11va") return [];
  const height = Number(video.height) || 0;
  const display = Number(video.displayHeight) || 0;
  const parts = [];
  if (settings.rtxUpscale && height > 0 && display > height * 1.1) {
    const scale = Math.min(4, Math.round((display / height) * 100) / 100);
    parts.push(`scale=${scale}:scaling-mode=nvidia`);
  }
  const sdr = !["pq", "hlg"].includes(video.transfer);
  const hdr = settings.rtxHdr && settings.hdr && sdr;
  if (!parts.length && !hdr) return [];
  const base = parts.join(":");
  const join = (...more) =>
    `@riwaqrtx:d3d11vpp=${[base, ...more].filter(Boolean).join(":")}`;
  if (!hdr) return [join()];
  // The 10-bit output format's name differs between MPV builds.
  return [
    join("nvidia-true-hdr", "format=x2bgr10"),
    join("nvidia-true-hdr", "format=rgb30"),
    join("nvidia-true-hdr"),
    ...(base ? [join()] : []),
  ];
}

/**
 * What the HUD shows under the title: resolution, HDR, video codec and the
 * audio, from what MPV reports about the playing file.
 */
export function qualityChips(player = {}) {
  const chips = [];
  const height = Number(player.height) || 0;
  const width = Number(player.width) || 0;
  if (height || width) {
    // A wide film is cropped in height: judge by the width too.
    const lines = Math.max(height, Math.round((width * 9) / 16));
    chips.push(
      lines >= 2000
        ? "4K"
        : lines >= 1400
          ? "1440p"
          : lines >= 1000
            ? "1080p"
            : lines >= 700
              ? "720p"
              : `${height}p`,
    );
  }
  if (player.transfer === "pq") chips.push("HDR10");
  else if (player.transfer === "hlg") chips.push("HLG");
  const tracks = Array.isArray(player.tracks) ? player.tracks : [];
  const video = tracks.find((t) => t.type === "video" && t.selected);
  const codec = String(video?.codec || "").toLowerCase();
  const codecName =
    {
      hevc: "HEVC",
      h264: "H.264",
      av1: "AV1",
      vp9: "VP9",
      mpeg2video: "MPEG-2",
    }[codec] || "";
  if (codecName) chips.push(codecName);
  const audio = tracks.find((t) => t.type === "audio" && t.selected);
  if (audio) {
    const name =
      {
        eac3: "E-AC3",
        ac3: "AC3",
        truehd: "TrueHD",
        dts: "DTS",
        "dts-hd": "DTS-HD",
        aac: "AAC",
        opus: "Opus",
        flac: "FLAC",
        mp3: "MP3",
      }[String(audio.codec || "").toLowerCase()] || "";
    const channels = Number(audio.channels) || 0;
    const layout =
      channels >= 8
        ? "7.1"
        : channels >= 6
          ? "5.1"
          : channels === 2
            ? "2.0"
            : "";
    const label = [name, layout].filter(Boolean).join(" ");
    if (label) chips.push(label);
  }
  return chips;
}
