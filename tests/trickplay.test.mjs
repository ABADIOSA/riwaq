import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isHomeHost,
  thumbnailArgs,
  thumbnailSlot,
  thumbnailsAllowed,
} from "../core/trickplay.mjs";
import { Thumbnailer } from "../electron/thumbnails.mjs";
import { HUD_METHODS } from "../core/hud.mjs";
import { DEFAULT_SETTINGS, safeSettings } from "../core/protocol.mjs";

const server = "http://127.0.0.1:11470";

test("home hosts are this machine and the home network only", () => {
  for (const host of [
    "localhost",
    "127.0.0.1",
    "192.168.1.20",
    "10.0.0.5",
    "172.20.1.1",
    "nas.local",
    "[::1]",
    "fd12:3456::1",
  ])
    assert.ok(isHomeHost(host), host);
  for (const host of [
    "172.32.0.1",
    "8.8.8.8",
    "real-debrid.com",
    "",
    "192.169.1.1",
  ])
    assert.ok(!isHomeHost(host), host);
});

test("previews follow the viewer's reach: off, local only, or every source", () => {
  const file = { local: true, url: "C:\\Films\\a.mkv" };
  const nas = { url: "http://192.168.1.20:8096/video.mkv" };
  const debrid = { url: "https://download.real-debrid.com/x.mkv" };
  const torrent = { url: `${server}/abc/0` };
  const live = { url: "http://192.168.1.20/live.m3u8", live: true };
  assert.equal(thumbnailsAllowed(file, "local", server), true);
  assert.equal(thumbnailsAllowed(nas, "local", server), true);
  assert.equal(thumbnailsAllowed(debrid, "local", server), false);
  assert.equal(
    thumbnailsAllowed(torrent, "local", server),
    false,
    "a torrent through the local server is still a torrent",
  );
  assert.equal(thumbnailsAllowed(debrid, "all", server), true);
  assert.equal(thumbnailsAllowed(file, "off", server), false);
  assert.equal(thumbnailsAllowed(live, "all", server), false, "never live");
  assert.equal(thumbnailsAllowed({ url: "file:///c/x" }, "all"), false);
  assert.equal(thumbnailsAllowed(null, "all"), false);
  assert.equal(thumbnailsAllowed(nas, "sometimes"), false);
});

test("previews share slices of the film", () => {
  assert.equal(
    thumbnailSlot(61, 600),
    60,
    "five-second slices for short films",
  );
  assert.equal(thumbnailSlot(62.4, 600), 60);
  assert.equal(
    thumbnailSlot(4000, 7200),
    3996,
    "36-second slices for a two-hour film",
  );
  assert.equal(thumbnailSlot(-5, 600), 0);
  assert.equal(thumbnailSlot(9999, 600), 599, "never past the end");
});

test("the preview MPV is silent, scaled, and keeps headers safe", () => {
  const args = thumbnailArgs({
    url: "https://host/x.mkv",
    headers: { Referer: "https://a,b", "Bad Header": "x", Cookie: "a\nb" },
    at: 90.7,
    outDir: "/tmp/o",
  });
  for (const flag of [
    "--no-config",
    "--audio=no",
    "--frames=1",
    "--vo=image",
    "--start=90",
    "--vo-image-outdir=/tmp/o",
  ])
    assert.ok(args.includes(flag), flag);
  assert.deepEqual(args.slice(-2), ["--", "https://host/x.mkv"]);
  assert.ok(args.includes("--http-header-fields=Referer: https://a\\,b"));
  assert.ok(
    !args.some((a) => a.includes("Cookie") || a.includes("Bad Header")),
  );
});

test("seek previews are a HUD method and a validated setting", () => {
  assert.ok(HUD_METHODS.has("trickplay"));
  assert.equal(DEFAULT_SETTINGS.seekThumbnails, "local");
  assert.equal(
    safeSettings({ seekThumbnails: "all" }, DEFAULT_SETTINGS).seekThumbnails,
    "all",
  );
  assert.equal(
    safeSettings({ seekThumbnails: "yes" }, DEFAULT_SETTINGS).seekThumbnails,
    "local",
  );
});

/** A fake MPV: writes a JPEG (or not) into the out dir, then exits. */
function fakeSpawn(behaviour) {
  const calls = [];
  const spawn = (exe, args) => {
    const child = new EventEmitter();
    child.killed = false;
    child.kill = () => {
      child.killed = true;
      setImmediate(() => child.emit("exit", null));
    };
    calls.push({ args, child });
    const outDir = args
      .find((a) => a.startsWith("--vo-image-outdir="))
      .slice(18);
    const mode = behaviour(calls.length);
    if (mode === "ok")
      setImmediate(() => {
        writeFileSync(
          join(outDir, "00000001.jpg"),
          Buffer.from([0xff, 0xd8, 0xff]),
        );
        child.emit("exit", 0);
      });
    else if (mode === "fail") setImmediate(() => child.emit("exit", 1));
    // "hang": waits to be killed.
    return child;
  };
  return { spawn, calls };
}

test("a frame comes back as a JPEG data URL, is cached, and leaves no files", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "riwaq-thumb-"));
  const { spawn, calls } = fakeSpawn(() => "ok");
  const thumbs = new Thumbnailer({ tmpDir: tmp, spawn });
  thumbs.reset({ local: true, url: "C:\\a.mkv" });
  const opts = {
    duration: 600,
    executable: "mpv",
    mode: "local",
    serverUrl: server,
  };
  const image = await thumbs.frame({ ...opts, at: 61 });
  assert.equal(image, "data:image/jpeg;base64,/9j/");
  assert.equal(await thumbs.frame({ ...opts, at: 62 }), image, "same slice");
  assert.equal(calls.length, 1, "cached, not grabbed twice");
  assert.deepEqual(readdirSync(tmp), [], "temporary frames are removed");
  assert.equal(await thumbs.frame({ ...opts, mode: "off", at: 200 }), null);
  thumbs.reset({ url: "https://debrid.example/x.mkv" });
  assert.equal(
    await thumbs.frame({ ...opts, at: 61 }),
    null,
    "local mode skips debrid",
  );
  assert.equal(calls.length, 1);
});

test("a newer request replaces an older one, and failures stop previews", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "riwaq-thumb-"));
  const { spawn, calls } = fakeSpawn((n) =>
    n === 1 ? "hang" : n === 2 ? "ok" : "fail",
  );
  const thumbs = new Thumbnailer({ tmpDir: tmp, spawn });
  thumbs.reset({ url: "http://192.168.1.2/x.mkv" });
  const opts = {
    duration: 600,
    executable: "mpv",
    mode: "local",
    serverUrl: server,
  };
  const first = thumbs.frame({ ...opts, at: 10 });
  const second = thumbs.frame({ ...opts, at: 300 });
  assert.equal(await first, null, "the older grab is cancelled");
  assert.ok(calls[0].child.killed);
  assert.match(await second, /^data:image\/jpeg/);
  for (const at of [100, 150, 200])
    assert.equal(await thumbs.frame({ ...opts, at }), null);
  const before = calls.length;
  assert.equal(await thumbs.frame({ ...opts, at: 400 }), null);
  assert.equal(calls.length, before, "three failures in a row stop grabbing");
  thumbs.reset({ url: "http://192.168.1.2/y.mkv" });
  assert.equal(thumbs.failures, 0, "a new viewing starts fresh");
});
