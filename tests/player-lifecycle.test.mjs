import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  Player,
  playerArgs,
  safeVideo,
  STARTUP_STALL_MS,
} from "../electron/player.mjs";
import { DEFAULT_SETTINGS } from "../core/protocol.mjs";

function harness({ exitOnQuit = true } = {}) {
  const children = [],
    sockets = [],
    commands = [],
    starts = [];
  const player = new Player({
    onState() {},
    onProgress() {},
    onEnded() {},
    spawnProcess(exe, args, options) {
      const child = new EventEmitter();
      child.kill = () => {
        child.killed = true;
      };
      children.push(child);
      starts.push({ args, options });
      return child;
    },
    connectSocket() {
      const socket = new EventEmitter();
      const child = children.at(-1);
      socket.writable = true;
      socket.destroy = () => {
        socket.writable = false;
      };
      socket.write = (line) => {
        const { command, request_id } = JSON.parse(line);
        commands.push(command);
        if (command[0] === "quit" && exitOnQuit)
          queueMicrotask(() => child.emit("exit", 0));
        if (command[0] === "loadfile")
          queueMicrotask(() => {
            // A fast file loads in the same read as the command response.
            socket.emit(
              "data",
              Buffer.from(
                JSON.stringify({ request_id, error: "success" }) +
                  "\n" +
                  JSON.stringify({ event: "file-loaded" }) +
                  "\n",
              ),
            );
          });
      };
      sockets.push(socket);
      queueMicrotask(() => socket.emit("connect"));
      return socket;
    },
  });
  const args = {
    executable: process.execPath,
    settings: DEFAULT_SETTINGS,
    url: "https://cdn.example/video.mkv",
    meta: { id: "tt1", name: "Test", type: "movie" },
    videoId: "tt1",
  };
  return { player, children, sockets, commands, starts, args };
}

test("subscriptions precede loading and a fast file-loaded event survives start", async () => {
  const h = harness();
  let loaded = 0;
  h.player.onLoaded = () => loaded++;
  await h.player.start(h.args);
  assert.equal(loaded, 1);
  assert.equal(h.player.fileLoaded, true);
  assert.ok(
    h.commands.findIndex((c) => c[0] === "observe_property") <
      h.commands.findIndex((c) => c[0] === "loadfile"),
  );
  assert.ok(!h.starts[0].args.includes(h.args.url));
  assert.equal(h.starts[0].options.windowsHide, false);
  await h.player.stop();
});

test("Stop cancels a start waiting for the previous process to exit", async () => {
  const h = harness({ exitOnQuit: false });
  await h.player.start(h.args);
  const replacement = h.player.start({ ...h.args, videoId: "tt2" });
  const rejected = assert.rejects(replacement, /بدأ تشغيل مصدر آخر/);
  const stopped = h.player.stop();
  h.children[0].emit("exit", 0);
  await Promise.all([rejected, stopped]);
  assert.equal(h.children.length, 1);
  assert.equal(h.player.state.active, false);
  assert.equal(h.player.watchdog, null);
});

test("a late retired socket cannot overwrite a new viewing or finish its commands", async () => {
  const h = harness();
  await h.player.start(h.args);
  const old = h.sockets[0];
  await h.player.start({ ...h.args, videoId: "tt2" });
  old.emit(
    "data",
    Buffer.from('{"event":"property-change","name":"time-pos","data":999}\n'),
  );
  assert.equal(h.player.state.position, 0);
  assert.equal(h.player.state.videoId, "tt2");
  const pending = h.player.request(["vf", "add", "test"]);
  await h.player.stop();
  assert.equal(await pending, false);
  assert.equal(h.player.pending.size, 0);
});

test("forced termination clears the active state even without an exit event", async (t) => {
  const h = harness({ exitOnQuit: false });
  await h.player.start(h.args);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const stopped = h.player.stop();
  assert.equal(h.player.state.active, false);
  t.mock.timers.tick(1500);
  await stopped;
  assert.equal(h.children[0].killed, true);
  assert.equal(h.player.child, null);
  assert.equal(h.player.socket, null);
});

test("compatibility disables custom picture effects and cannot restore RTX from live settings", async () => {
  const h = harness();
  const settings = {
    ...DEFAULT_SETTINGS,
    shader: "custom",
    shaderPath: "C:\\fx.glsl",
    toneMapping: "hable",
    rtxUpscale: true,
  };
  h.player.settingsNow = () => settings;
  await h.player.start({ ...h.args, settings });
  await h.player.restartSafe(1);
  assert.equal(h.player.state.compatibilityStage, 1);
  h.player.state.decoder = "d3d11va";
  h.player.state.height = 720;
  h.player.displayHeight = () => 2160;
  await h.player.refreshRtx();
  assert.ok(!h.commands.some((c) => c[0] === "vf"));
  await h.player.command({ action: "repairVideo" });
  assert.equal(h.player.state.compatibilityStage, 2);
  assert.ok(h.starts.at(-1).args.includes("--hwdec=no"));
  const flags = playerArgs({
    pipe: "p",
    settings: { ...settings, ...safeVideo(1) },
    url: "u",
    title: "t",
  });
  assert.ok(!flags.some((f) => /glsl|tone-mapping|hdr-compute-peak/.test(f)));
  await h.player.stop();
});

test("RTX changes serialize: turning it off during an add removes the completed filter", async () => {
  let settings = { rtxUpscale: true };
  let finish;
  const commands = [];
  const p = new Player({
    onState() {},
    settingsNow: () => settings,
    displayHeight: () => 2160,
  });
  p.state = { active: true, height: 1080, decoder: "d3d11va" };
  p.request = async (c) => {
    commands.push(c);
    return c[1] === "add" ? new Promise((r) => (finish = r)) : true;
  };
  const first = p.refreshRtx();
  settings = {};
  const second = p.refreshRtx();
  finish(true);
  await Promise.all([first, second]);
  assert.deepEqual(
    commands.map((c) => c[1]),
    ["add", "remove"],
  );
  assert.equal(p.rtxAdded, false);
  assert.equal(p.state.rtx, null);
});

test("a late RTX reply never changes the replacement viewing", async () => {
  let finish;
  const p = new Player({
    onState() {},
    settingsNow: () => ({ rtxUpscale: true }),
    displayHeight: () => 2160,
  });
  p.state = { active: true, height: 1080, decoder: "d3d11va" };
  p.request = () => new Promise((r) => (finish = r));
  const job = p.refreshRtx();
  p.state = { active: true, rtx: null };
  p.rtxAdded = false;
  finish(true);
  await job;
  assert.equal(p.rtxAdded, false);
  assert.equal(p.state.rtx, null);
});

test("a source stuck before file-loaded times out once and an ended file stops the watchdog", () => {
  const stalls = [];
  const p = new Player({ onState() {}, onProgress() {} });
  p.state = { active: true, position: 0, loading: true };
  p.fileLoaded = false;
  p.lastMove = 0;
  p.onStall = (info) => stalls.push(info);
  p.checkStall(STARTUP_STALL_MS - 1);
  assert.equal(stalls.length, 0);
  p.checkStall(STARTUP_STALL_MS);
  p.checkStall(STARTUP_STALL_MS * 2);
  assert.equal(stalls.length, 1);
  assert.equal(stalls[0].startup, true);
  p.startWatchdog();
  p.event({ event: "end-file", reason: "error" });
  assert.equal(p.watchdog, null);
});
