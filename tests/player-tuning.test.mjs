import test from "node:test";
import assert from "node:assert/strict";
import {
  AUDIO_PROFILES,
  EQ_BANDS,
  audioArgs,
  audioFilters,
  cleanAudioDevice,
  hwdecValue,
  liveTuning,
  parseAudioDevices,
  profileChain,
  qualityChips,
  rtxFilters,
  videoArgs,
} from "../core/player-tuning.mjs";
import { DEFAULT_SETTINGS, safeSettings } from "../core/protocol.mjs";
import { Player, playerArgs } from "../electron/player.mjs";
import { collectBackup, restoreState } from "../core/backup.mjs";
import { mpvLogProblems } from "../core/diagnose.mjs";

test("every sound profile has one gain per band, and the filter is built from them", () => {
  for (const [id, profile] of Object.entries(AUDIO_PROFILES)) {
    assert.equal(profile.gains.length, EQ_BANDS.length, id);
    const chain = profileChain(id);
    for (const [index, gain] of profile.gains.entries())
      assert.equal(
        chain.includes(`f=${EQ_BANDS[index]}:t=o:w=1.2:g=${gain}`),
        gain !== 0,
        `${id} band ${EQ_BANDS[index]}`,
      );
  }
  assert.equal(profileChain("flat"), "");
  assert.equal(profileChain("nonsense"), "", "an unknown profile is flat");
  assert.match(profileChain("night"), /acompressor=/);
  assert.doesNotMatch(profileChain("bass"), /acompressor/);
});

test("audio filters are labelled, so a change replaces rather than stacks", () => {
  assert.equal(audioFilters({}), "");
  assert.equal(
    audioFilters({ audioNormalize: true }),
    "@riwaqnorm:lavfi=[dynaudnorm=f=150:g=15:p=0.9]",
  );
  const both = audioFilters({ audioProfile: "voice", audioNormalize: true });
  assert.match(both, /^@riwaqeq:lavfi=\[equalizer=f=60.*\],@riwaqnorm:/);
});

test("the sound's start-up options: ceiling, filters, downmix and output", () => {
  assert.deepEqual(audioArgs({}), ["--volume-max=150"]);
  assert.deepEqual(audioArgs({ volumeMax: 999 }), ["--volume-max=150"]);
  const args = audioArgs({
    volumeMax: 300,
    audioDownmix: true,
    audioDevice: "wasapi/{0.0.0.00000000}.{abc-123}",
  });
  assert.deepEqual(args, [
    "--volume-max=300",
    "--audio-channels=stereo",
    "--audio-swresample-o=clev=1.0",
    "--audio-device=wasapi/{0.0.0.00000000}.{abc-123}",
  ]);
  assert.equal(audioArgs({ audioDevice: "auto" }).length, 1);
});

test("an audio device name is printable and carries no quotes", () => {
  assert.equal(cleanAudioDevice("auto"), "");
  assert.equal(cleanAudioDevice("wasapi/x"), "wasapi/x");
  assert.equal(cleanAudioDevice("bad'name"), "");
  assert.equal(cleanAudioDevice('bad"name'), "");
  assert.equal(cleanAudioDevice("line\nbreak"), "");
  assert.equal(cleanAudioDevice("x".repeat(241)), "");
  assert.equal(cleanAudioDevice(42), "");
});

test("MPV's device listing is read as ids and names", () => {
  const listing = [
    "List of detected audio devices:",
    "  'auto' (Autoselect device)",
    "  'wasapi/{0.0.0.00000000}.{6a0e}' (Speakers (Realtek(R) Audio))",
    "  'openal/OpenAL Soft on Speakers' (OpenAL Soft on Speakers)",
    "  'wasapi/{0.0.0.00000000}.{6a0e}' (duplicate)",
    "garbage line",
  ].join("\r\n");
  assert.deepEqual(parseAudioDevices(listing), [
    {
      id: "wasapi/{0.0.0.00000000}.{6a0e}",
      name: "Speakers (Realtek(R) Audio)",
    },
    {
      id: "openal/OpenAL Soft on Speakers",
      name: "OpenAL Soft on Speakers",
    },
  ]);
  assert.deepEqual(parseAudioDevices(""), []);
});

test("the picture's start-up options follow each choice", () => {
  assert.deepEqual(videoArgs({}), [
    "--hwdec=auto-safe",
    "--vo=gpu-next",
    "--target-colorspace-hint=no",
  ]);
  assert.ok(videoArgs({ hdr: true }).includes("--target-colorspace-hint=yes"));
  assert.equal(videoArgs({ videoQuality: "smooth" })[0], "--profile=fast");
  assert.equal(
    videoArgs({ videoQuality: "high" })[0],
    "--profile=high-quality",
  );
  assert.ok(videoArgs({ renderer: "gpu" }).includes("--vo=gpu"));
  // Both compatibility modes leave the path HDR needs.
  const simple = videoArgs({ hdr: true, simpleColor: true });
  assert.ok(simple.includes("--target-colorspace-hint=no"));
  assert.ok(simple.includes("--d3d11-output-format=rgba8"));
  const lineless = videoArgs({ hdr: true, linelessVideo: true });
  assert.ok(lineless.includes("--d3d11-flip=no"));
  assert.ok(lineless.includes("--target-colorspace-hint=no"));
  assert.ok(
    videoArgs({ displayPanel: "oled" }).includes("--target-contrast=inf"),
  );
  assert.ok(
    videoArgs({ displayPanel: "lcd" }).includes("--target-contrast=1000"),
  );
});

test("decoding: off wins, RTX and 'force' use D3D11, auto uses MPV's safe list", () => {
  assert.equal(hwdecValue({}), "auto-safe");
  assert.equal(hwdecValue({ hwdec: "on" }), "d3d11va");
  assert.equal(hwdecValue({ rtxUpscale: true }), "d3d11va");
  assert.equal(hwdecValue({ hwdec: "off", rtxUpscale: true }), "no");
  assert.equal(hwdecValue({ hardwareDecoding: false, hwdec: "on" }), "no");
});

test("playerArgs carries the tuning once, before the picture profile", () => {
  const args = playerArgs({
    pipe: "p",
    settings: { ...DEFAULT_SETTINGS, shader: "sharp", audioNormalize: true },
    url: "https://example.com/v.mkv",
    title: "t",
  });
  assert.equal(args.filter((a) => a.startsWith("--hwdec=")).length, 1);
  assert.equal(args.filter((a) => a.startsWith("--vo=")).length, 1);
  assert.ok(args.includes("--volume-max=150"));
  assert.ok(args.some((a) => a.startsWith("--af=@riwaqnorm")));
  assert.ok(
    args.indexOf("--hwdec=auto-safe") <
      args.indexOf("--scale=ewa_lanczossharp"),
  );
  assert.equal(args.at(-1), "https://example.com/v.mkv");
});

test("a settings change reaches a running viewing", () => {
  const pairs = Object.fromEntries(
    liveTuning({ audioProfile: "bass", volumeMax: 200, audioDownmix: true }),
  );
  assert.match(pairs.af, /^@riwaqeq:/);
  assert.equal(pairs["volume-max"], 200);
  assert.equal(pairs["audio-channels"], "stereo");
  assert.equal(pairs["audio-device"], "auto");
  assert.equal(pairs["target-contrast"], "auto");
  const sent = [];
  const states = [];
  const player = new Player({ onState: (s) => states.push(s) });
  player.send = (c) => sent.push(c);
  player.applyTuning({ volumeMax: 300 });
  assert.equal(sent.length, 0, "nothing without a viewing");
  player.state = { active: true, live: true };
  player.applyTuning({ volumeMax: 300 });
  assert.ok(sent.some((c) => c[1] === "volume-max" && c[2] === 300));
  assert.equal(player.state.volumeMax, 300);
  const count = sent.length;
  player.applyTuning({ volumeMax: 300 });
  assert.equal(sent.length, count, "an unchanged setting is not sent again");
  player.applyTuning({ volumeMax: 300, audioNormalize: true });
  assert.equal(sent.length, count + 1);
  assert.equal(sent.at(-1)[1], "af");
});

test("the volume command respects the viewer's ceiling", () => {
  const sent = [];
  let settings = { volumeMax: 100 };
  const player = new Player({ onState: () => {}, settingsNow: () => settings });
  player.send = (c) => sent.push(c);
  player.state = { active: true };
  player.command({ action: "volume", value: 140 });
  assert.deepEqual(sent.at(-1), ["set_property", "volume", 100]);
  settings = { volumeMax: 400 };
  player.command({ action: "volume", value: 350 });
  assert.deepEqual(sent.at(-1), ["set_property", "volume", 350]);
});

test("RTX Video: only on D3D11 frames, upscale by the display factor, HDR for SDR only", () => {
  const video = { decoder: "d3d11va", height: 1080, displayHeight: 2160 };
  assert.deepEqual(
    rtxFilters({ rtxUpscale: true }, { ...video, decoder: "nvdec" }),
    [],
  );
  assert.deepEqual(rtxFilters({ rtxUpscale: true }, video), [
    "@riwaqrtx:d3d11vpp=scale=2:scaling-mode=nvidia",
  ]);
  assert.deepEqual(
    rtxFilters({ rtxUpscale: true }, { ...video, height: 2160 }),
    [],
    "nothing to upscale at the display's size",
  );
  assert.deepEqual(
    rtxFilters({ rtxHdr: true }, video),
    [],
    "needs the HDR signal",
  );
  const hdr = rtxFilters({ rtxHdr: true, hdr: true }, video);
  assert.equal(hdr.length, 3);
  assert.ok(hdr.every((f) => f.includes("nvidia-true-hdr")));
  assert.deepEqual(
    rtxFilters({ rtxHdr: true, hdr: true }, { ...video, transfer: "pq" }),
    [],
    "an HDR picture is not converted again",
  );
  const both = rtxFilters({ rtxHdr: true, hdr: true, rtxUpscale: true }, video);
  assert.equal(both.at(-1), "@riwaqrtx:d3d11vpp=scale=2:scaling-mode=nvidia");
});

test("the player tries RTX filters in order and reports what took", async () => {
  const tried = [];
  const states = [];
  const player = new Player({
    onState: (s) => states.push(s.rtx),
    settingsNow: () => ({ rtxUpscale: true, rtxHdr: true, hdr: true }),
    displayHeight: () => 2160,
  });
  player.state = { active: true, decoder: "d3d11va", height: 1080 };
  player.request = async (command) => {
    tried.push(command.join(" "));
    // This card refuses true HDR but upscales.
    return !command[2]?.includes("nvidia-true-hdr");
  };
  await player.refreshRtx();
  assert.equal(tried[0], "vf remove @riwaqrtx");
  assert.equal(tried.length, 5);
  assert.equal(player.state.rtx, "upscale");
  await player.refreshRtx();
  assert.equal(tried.length, 5, "the same chain is not applied twice");
});

test("quality chips read what MPV reports, a wide film counts as 4K", () => {
  assert.deepEqual(
    qualityChips({
      width: 3840,
      height: 1600,
      transfer: "pq",
      tracks: [
        { type: "video", selected: true, codec: "hevc" },
        { type: "audio", selected: true, codec: "eac3", channels: 6 },
        { type: "audio", selected: false, codec: "aac", channels: 2 },
      ],
    }),
    ["4K", "HDR10", "HEVC", "E-AC3 5.1"],
  );
  assert.deepEqual(qualityChips({ width: 1280, height: 720 }), ["720p"]);
  assert.deepEqual(qualityChips({}), []);
});

test("settings keep the new choices and refuse the rest", () => {
  const next = safeSettings({
    videoQuality: "high",
    hwdec: "on",
    renderer: "gpu",
    displayPanel: "oled",
    audioProfile: "night",
    volumeMax: 600,
    bandwidthCap: 100,
    skipRecap: "auto",
    skipHideAfter: 10,
    volumeOsdPosition: "top-left",
    hudQualityStyle: "bar",
    simpleColor: true,
    keepFullscreen: true,
    audioDevice: "wasapi/x",
  });
  assert.equal(next.videoQuality, "high");
  assert.equal(next.volumeMax, 600);
  assert.equal(next.bandwidthCap, 100);
  assert.equal(next.skipRecap, "auto");
  assert.equal(next.audioDevice, "wasapi/x");
  const refused = safeSettings({
    videoQuality: "ultra",
    volumeMax: 1000,
    bandwidthCap: 7,
    audioDevice: "x'y",
    renderer: "d3d9",
  });
  assert.equal(refused.videoQuality, "balanced");
  assert.equal(refused.volumeMax, 150);
  assert.equal(refused.bandwidthCap, 0);
  assert.equal(refused.audioDevice, "auto");
  assert.equal(refused.renderer, "gpu-next");
});

test("a backup never carries this PC's audio output", () => {
  const state = {
    profiles: {
      list: [{ id: "p1", name: "A" }],
      active: "p1",
      data: {
        p1: { settings: { ...DEFAULT_SETTINGS, audioDevice: "wasapi/x" } },
      },
    },
    settings: { ...DEFAULT_SETTINGS, audioDevice: "wasapi/here" },
  };
  const { payload } = collectBackup(state);
  assert.equal(payload.profiles.data.p1.settings.audioDevice, undefined);
  const restored = restoreState(state, payload);
  assert.equal(restored.profiles.data.p1.settings.audioDevice, "wasapi/here");
});

test("sound without a picture is reported once, six seconds after loading", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const failed = [];
  const player = new Player({ onState: () => {} });
  player.onVideoFailed = (info) => failed.push(info);
  player.videoId = "tt1:1:1";
  const video = [{ type: "video", selected: true }];
  player.state = { active: true, tracks: video, voConfigured: false };
  player.watchVideo();
  t.mock.timers.tick(5900);
  assert.equal(failed.length, 0);
  t.mock.timers.tick(200);
  assert.deepEqual(failed, [{ videoId: "tt1:1:1" }]);
  // A picture that came up, or a file with no video track, is left alone.
  player.state = { active: true, tracks: video, voConfigured: true };
  player.watchVideo();
  t.mock.timers.tick(7000);
  player.state = { active: true, tracks: [{ type: "audio", selected: true }] };
  player.watchVideo();
  t.mock.timers.tick(7000);
  assert.equal(failed.length, 1);
});

test("the compatibility restart keeps the viewing and its position", async () => {
  const player = new Player({ onState: () => {} });
  const starts = [];
  player.start = async (args) => starts.push(args);
  assert.equal(player.restartSafe(), null, "nothing to restart yet");
  player.lastStart = {
    url: "https://x/v.mkv",
    settings: {
      renderer: "gpu-next",
      hwdec: "on",
      rtxUpscale: true,
      audioProfile: "night",
    },
    videoId: "tt1:1:1",
  };
  player.state = { active: true, position: 754.2 };
  await player.restartSafe();
  assert.equal(starts[0].start, 754.2);
  assert.equal(starts[0].safe, true);
  assert.equal(starts[0].url, "https://x/v.mkv");
  assert.equal(starts[0].settings.renderer, "gpu");
  assert.equal(starts[0].settings.hwdec, "off");
  assert.equal(starts[0].settings.rtxUpscale, false);
  assert.equal(starts[0].settings.audioProfile, "night", "sound choices stay");
  const args = playerArgs({
    pipe: "p",
    settings: { ...DEFAULT_SETTINGS, ...starts[0].settings },
    url: "u",
    title: "t",
    logFile: "C:\\riwaq\\logs\\mpv-last.log",
  });
  assert.ok(args.includes("--hwdec=no"));
  assert.ok(args.includes("--vo=gpu"));
  assert.ok(args.includes("--log-file=C:\\riwaq\\logs\\mpv-last.log"));
});

test("only MPV's problem lines reach the diagnostic, sanitized", () => {
  const log = [
    "[cplayer] Command line: mpv --http-header-fields=Authorization: Bearer abc",
    "[vo/gpu-next/d3d11] Failed to create swapchain: Error 0x887A0004",
    "[vo/gpu-next] Could not initialize the video output",
    "[ffmpeg] https://debrid.example.com/dl/SECRETTOKEN123/file.mkv: error 403",
    "[cplayer] Playing: C:\\Users\\Abadi\\Videos\\x.mkv",
    "[vo/gpu-next/d3d11] Failed to create swapchain: Error 0x887A0004",
  ].join("\n");
  const lines = mpvLogProblems(log, { home: "C:\\Users\\Abadi" });
  assert.equal(lines.length, 3, "duplicates and ordinary lines are dropped");
  assert.ok(lines.every((l) => !/Bearer|SECRETTOKEN|Authorization/.test(l)));
  assert.ok(lines.some((l) => /debrid\.example\.com/.test(l)));
  assert.match(lines[0], /swapchain/);
});
