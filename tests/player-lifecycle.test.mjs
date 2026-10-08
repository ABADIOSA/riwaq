import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  LOAD_REPLY_MS,
  Player,
  playerArgs,
  safeVideo,
  STARTUP_STALL_MS,
} from "../electron/player.mjs";
import { DEFAULT_SETTINGS } from "../core/protocol.mjs";

function harness({
  exitOnQuit = true,
  exitOnKill = false,
  autoConnect = true,
  // Milliseconds before MPV answers loadfile; null never answers.
  loadReply = 0,
} = {}) {
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
        if (exitOnKill) queueMicrotask(() => child.emit("exit", 1));
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
        if (command[0] === "loadfile" && loadReply !== null) {
          const answer = () =>
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
          if (loadReply > 0) setTimeout(answer, loadReply);
          else queueMicrotask(answer);
        }
      };
      sockets.push(socket);
      if (autoConnect) queueMicrotask(() => socket.emit("connect"));
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

test("MPV starts idle without its logo, embedded or in its own window", () => {
  for (const separate of [false, true]) {
    const flags = playerArgs({
      pipe: "p",
      host: 7,
      settings: DEFAULT_SETTINGS,
      url: "https://cdn.example/video.mkv",
      title: "t",
      separate,
      deferLoad: true,
    });
    const options = flags.filter((f) => f.startsWith("--script-opts=")).at(-1);
    assert.match(options, /osc-idlescreen=no/, `separate: ${separate}`);
    assert.ok(flags.includes("--idle=yes"));
    assert.ok(!flags.includes("https://cdn.example/video.mkv"));
  }
});

const settle = async (until) => {
  for (let i = 0; i < 50 && !until(); i++)
    await new Promise((resolve) => setImmediate(resolve));
};

test("a slow answer to loadfile (a waking GPU) still starts the viewing", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = harness({ loadReply: 5000 });
  const started = h.player.start(h.args);
  await settle(() => h.commands.some((c) => c[0] === "loadfile"));
  t.mock.timers.tick(5000);
  const state = await started;
  assert.equal(state.active, true);
  assert.equal(h.player.fileLoaded, true);
  assert.ok(!h.commands.some((c) => c[0] === "quit"));
  await h.player.stop();
});

test("a loadfile MPV never answers gives up after the load timeout and quits MPV", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = harness({ loadReply: null });
  const failed = assert.rejects(
    h.player.start(h.args),
    /تعذّر إرسال المصدر إلى MPV/,
  );
  await settle(() => h.commands.some((c) => c[0] === "loadfile"));
  t.mock.timers.tick(3000);
  await settle(() => false);
  assert.equal(
    h.player.state.active,
    true,
    "the usual reply time is too short",
  );
  t.mock.timers.tick(LOAD_REPLY_MS - 3000);
  await failed;
  assert.ok(h.commands.some((c) => c[0] === "quit"));
  assert.equal(h.player.state.active, false);
});

test("a playlist redirect keeps watching the entry it hands over to", async () => {
  const h = harness();
  await h.player.start(h.args);
  const socket = h.sockets[0];
  socket.emit(
    "data",
    Buffer.from('{"event":"end-file","reason":"redirect"}\n'),
  );
  assert.notEqual(h.player.watchdog, null);
  socket.emit("data", Buffer.from('{"event":"file-loaded"}\n'));
  assert.equal(h.player.fileLoaded, true);
  socket.emit("data", Buffer.from('{"event":"end-file","reason":"eof"}\n'));
  assert.equal(h.player.watchdog, null);
  await h.player.stop();
});

test("a start superseded while connecting kills its MPV at once", async (t) => {
  const h = harness({
    autoConnect: false,
    exitOnKill: true,
    exitOnQuit: false,
  });
  const rejected = assert.rejects(h.player.start(h.args), /بدأ تشغيل مصدر آخر/);
  await settle(() => h.sockets.length > 0);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let stopped = false;
  const stopping = h.player.stop().then(() => (stopped = true));
  h.sockets[0].emit("connect");
  await rejected;
  await settle(() => stopped);
  assert.equal(h.children[0].killed, true);
  assert.equal(stopped, true, "Stop did not wait out the quit timeout");
  await stopping;
});

function fakeHost(fixes = []) {
  const host = {
    handle: 7,
    calls: [],
    prepare() {
      host.calls.push("prepare");
    },
    hide() {},
    syncChild() {
      host.calls.push("sync");
      return fixes.length ? fixes.shift() : null;
    },
  };
  return host;
}

test("the hidden surface is sized before MPV starts, and never for MPV's own window", async () => {
  const h = harness();
  const host = fakeHost();
  let spawnedAtPrepare = null;
  host.prepare = () => (spawnedAtPrepare = h.children.length);
  h.player.host = host;
  await h.player.start(h.args);
  assert.equal(spawnedAtPrepare, 0, "prepared before the spawn");
  spawnedAtPrepare = null;
  await h.player.start({ ...h.args, separate: true });
  assert.equal(spawnedAtPrepare, null);
  await h.player.stop();
});

test("MPV's window is corrected when the picture starts, and the fix is reported", async () => {
  const h = harness();
  const fix = {
    resize: true,
    show: false,
    width: 1600,
    height: 900,
    from: { width: 1, height: 1 },
  };
  const host = fakeHost([fix]);
  const reported = [];
  h.player.host = host;
  h.player.onSurfaceFixed = (f) => reported.push(f);
  await h.player.start(h.args);
  assert.ok(host.calls.includes("sync"), "checked on file-loaded");
  assert.deepEqual(reported, [fix]);
  h.sockets[0].emit(
    "data",
    Buffer.from(
      '{"event":"property-change","name":"vo-configured","data":true}\n',
    ),
  );
  assert.equal(host.calls.filter((c) => c === "sync").length, 2);
  await h.player.stop();
});

test("a window that never takes the size restarts the viewing once, with the same settings", async () => {
  const h = harness();
  const fix = {
    resize: true,
    width: 1600,
    height: 900,
    from: { width: 1, height: 1 },
  };
  const host = fakeHost();
  host.syncChild = () => fix;
  const reported = [];
  h.player.host = host;
  h.player.onSurfaceFixed = (f) => reported.push(f);
  await h.player.start(h.args);
  // file-loaded already counted one correction; the watchdog adds the rest.
  for (let i = 0; i < 6; i++) h.player.checkStall();
  await settle(() => h.children.length > 1 && h.player.state.active);
  assert.equal(h.children.length, 2, "one restart, not one per check");
  assert.equal(reported.filter((f) => f.restart).length, 1);
  // Same settings: only the position and the pipe's name differ.
  const fixed = (args) =>
    args.filter((a) => !/^--(start|input-ipc-server)=/.test(a));
  assert.deepEqual(fixed(h.starts[1].args), fixed(h.starts[0].args));
  for (let i = 0; i < 6; i++) h.player.checkStall();
  await settle(() => false);
  assert.equal(h.children.length, 2, "the restart keeps its one restart");
  await h.player.stop();
});
