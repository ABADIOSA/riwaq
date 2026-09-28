import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DesktopUpdates } from "../electron/updater.mjs";
import {
  verifyManifest,
  installerName,
  assetUrl,
  updateUrlAllowed,
  fetchUpdate,
  readManifest,
} from "../core/update-package.mjs";

const keys = generateKeyPairSync("ed25519");
const binary = Buffer.from("A controlled installer fixture; never executed");
function signed(extra = {}, key = keys.privateKey) {
  const data = {
    schema: 1,
    repo: "ABADIOSA/riwaq",
    version: "0.9.0",
    platform: "win32-x64",
    channel: "beta",
    publishedAt: "2026-09-27T00:00:00Z",
    filename: installerName("0.9.0"),
    size: binary.length,
    sha512: createHash("sha512").update(binary).digest("hex"),
    notes: "جديد رِواق",
    ...extra,
  };
  const bytes = Buffer.from(JSON.stringify(data));
  return JSON.stringify({
    payload: bytes.toString("base64"),
    signature: sign(null, bytes, key).toString("base64"),
  });
}
const release = (version = "0.9.0", extra = {}) => ({
  tag_name: `v${version}`,
  name: `Riwaq ${version}`,
  html_url: `https://github.com/ABADIOSA/riwaq/releases/tag/v${version}`,
  prerelease: true,
  assets: [{ name: "riwaq-update.json" }],
  ...extra,
});
async function rig({
  envelope = signed(),
  bytes = binary,
  releases = [release()],
  options = {},
  preferences = {},
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), "riwaq-updater-"));
  const launched = [],
    requests = [],
    changes = [];
  let updater;
  const client = {
    state: { updates: { autoDownload: false, ...preferences } },
    profiles: { gate() {} },
    persist() {},
    publicState: () => ({ update: updater.publicState() }),
    request: async (url) => {
      requests.push(url);
      return releases;
    },
  };
  updater = new DesktopUpdates(client, {
    current: "0.8.0",
    directory,
    publicKey: keys.publicKey,
    installed: true,
    installDirectory: "C:\\Test Riwaq",
    onChange: (state) => changes.push(state),
    launch: async (...args) => {
      launched.push(args);
    },
    fetcher: async (url) => {
      requests.push(url);
      return new Response(url.endsWith(".json") ? envelope : bytes);
    },
    ...options,
  });
  return { updater, client, directory, launched, requests, changes };
}

test("signed metadata is pinned to the key, version, platform and channel", () => {
  assert.equal(verifyManifest(signed(), keys.publicKey).version, "0.9.0");
  const wrong = generateKeyPairSync("ed25519");
  assert.throws(
    () => verifyManifest(signed({}, wrong.privateKey), keys.publicKey),
    /توقيع/,
  );
  const changed = JSON.parse(signed());
  changed.payload = Buffer.from(JSON.stringify({ version: "9.0.0" })).toString(
    "base64",
  );
  assert.throws(
    () => verifyManifest(JSON.stringify(changed), keys.publicKey),
    /توقيع/,
  );
  for (const extra of [
    { repo: "other/repo" },
    { platform: "linux-x64" },
    { filename: "../evil.exe" },
    { size: 0 },
    { sha512: "abc" },
    { schema: 2 },
  ])
    assert.throws(() => verifyManifest(signed(extra), keys.publicKey));
  assert.throws(() =>
    verifyManifest(signed(), keys.publicKey, { version: "0.9.1" }),
  );
  assert.throws(() =>
    verifyManifest(signed(), keys.publicKey, { channel: "stable" }),
  );
  assert.equal(
    verifyManifest(signed({ channel: "stable" }), keys.publicKey, {
      channel: "stable",
    }).channel,
    "stable",
  );
});

test("installer identity cannot become a path or arbitrary URL", () => {
  for (const bad of ["../9.0.0", "1.2.3/evil", "v0.9.0", "0.9.0?x"])
    assert.throws(() => installerName(bad));
  assert.throws(() => assetUrl("0.9.0", "other.exe"));
  assert.equal(
    assetUrl("0.9.0"),
    "https://github.com/ABADIOSA/riwaq/releases/download/v0.9.0/riwaq-update.json",
  );
  for (const bad of [
    "http://github.com/ABADIOSA/riwaq/releases/download/v1/x",
    "https://evil.test/x",
    "https://github.com/other/repo/releases/download/v1/x",
    "https://token@github.com/ABADIOSA/riwaq/releases/download/v1/x",
    "https://github.com:444/ABADIOSA/riwaq/releases/download/v1/x",
  ])
    assert.equal(updateUrlAllowed(bad), false);
});

test("redirects cannot escape GitHub asset hosts", async () => {
  const calls = [];
  await assert.rejects(
    fetchUpdate(assetUrl("0.9.0"), {
      fetcher: async (url) => {
        calls.push(url);
        return new Response(null, {
          status: 302,
          headers: { location: "https://evil.test/payload" },
        });
      },
    }),
    /غير مسموح/,
  );
  assert.equal(calls.length, 1);
  let count = 0;
  await assert.rejects(
    fetchUpdate(assetUrl("0.9.0"), {
      fetcher: async () => {
        count++;
        return new Response(null, {
          status: 302,
          headers: { location: assetUrl("0.9.0") },
        });
      },
    }),
  );
  assert.equal(count, 6);
});

test("oversized metadata is bounded before parsing", async () => {
  await assert.rejects(
    readManifest(assetUrl("0.9.0"), {
      fetcher: async () => new Response("x".repeat(100001)),
    }),
    /الحد/,
  );
});

test("download, restart recovery and installation retain verified identity", async () => {
  const r = await rig();
  await r.updater.check();
  assert.equal(r.updater.publicState().canDownload, true);
  await r.updater.download();
  assert.equal(r.updater.publicState().status, "ready");
  assert.deepEqual(
    await readFile(join(r.directory, installerName("0.9.0"))),
    binary,
  );
  const second = new DesktopUpdates(r.client, {
    current: "0.8.0",
    directory: r.directory,
    publicKey: keys.publicKey,
    installed: true,
    launch: r.updater.launch,
    installDirectory: "C:\\Test Riwaq",
  });
  await second.restore();
  assert.equal(second.publicState().status, "ready");
  assert.equal(await second.install(), true);
  assert.equal(r.launched.length, 1);
  assert.equal(r.launched[0][0], join(r.directory, installerName("0.9.0")));
  assert.equal(r.launched[0][1].directory, "C:\\Test Riwaq");
  assert.equal(await second.install(), false);
  assert.ok(!JSON.stringify(second.publicState()).includes(r.directory));
});

test("a damaged or truncated download is never staged or executed", async () => {
  for (const bytes of [
    Buffer.alloc(binary.length, 0),
    binary.subarray(0, 4),
    Buffer.alloc(binary.length + 1),
  ]) {
    const r = await rig({ bytes });
    await r.updater.check();
    await r.updater.download();
    assert.equal(r.updater.publicState().status, "error");
    assert.equal(await r.updater.install(), false);
    assert.equal(r.launched.length, 0);
    assert.ok(
      !(await readdir(r.directory)).some(
        (p) => p.endsWith(".part") || p === "pending-update.json",
      ),
    );
  }
});

test("cache tampering after download blocks installation", async () => {
  const r = await rig();
  await r.updater.check();
  await r.updater.download();
  await writeFile(
    join(r.directory, installerName("0.9.0")),
    Buffer.alloc(binary.length, 1),
  );
  assert.equal(await r.updater.install(), false);
  assert.equal(r.launched.length, 0);
});

test("invalid signatures never reach the download stage", async () => {
  const r = await rig({
    envelope: signed(
      { sha512: "1".repeat(128) },
      generateKeyPairSync("ed25519").privateKey,
    ),
  });
  await r.updater.check();
  assert.equal(r.updater.publicState().status, "error");
  await assert.rejects(r.updater.download());
  assert.ok(!r.requests.some((url) => url.endsWith(".exe")));
});

test("old unsigned releases remain manual and downgrade is impossible", async () => {
  const old = await rig({ releases: [release("0.7.0")] });
  await old.updater.check();
  assert.equal(old.updater.publicState().status, "current");
  await assert.rejects(old.updater.download());
  const legacy = await rig({ releases: [release("0.9.0", { assets: [] })] });
  await legacy.updater.check();
  assert.equal(legacy.updater.publicState().status, "manual");
  assert.equal(legacy.updater.publicState().canDownload, false);
});

test("stable channel excludes previews and future checks obey the selected channel", async () => {
  const r = await rig({
    releases: [release("0.9.0"), release("0.8.0", { prerelease: false })],
    preferences: { channel: "stable" },
  });
  await r.updater.check();
  assert.equal(r.updater.publicState().status, "current");
  await r.updater.configure({ channel: "beta" });
  assert.equal(r.updater.store.checkedAt, null);
  await r.updater.check();
  assert.equal(r.updater.publicState().status, "available");
  await r.updater.download();
  await r.updater.configure({ channel: "stable" });
  assert.equal(r.updater.publicState().status, "idle");
  assert.ok(!(await readdir(r.directory)).includes("pending-update.json"));
});

test("checks are single-flight and disabled checks stay manual", async () => {
  const r = await rig({ preferences: { enabled: false } });
  await r.updater.check();
  assert.equal(r.requests.length, 0);
  await Promise.all([
    r.updater.check({ force: true }),
    r.updater.check({ force: true }),
  ]);
  assert.equal(
    r.requests.filter((url) => url.includes("api.github.com")).length,
    1,
  );
  await r.updater.check();
  assert.equal(r.requests.length, 2);
});

test("auto download stages a release without ever interrupting playback to install", async () => {
  const r = await rig({ preferences: { autoDownload: true } });
  await r.updater.check();
  await r.updater.downloading;
  assert.equal(r.updater.publicState().status, "ready");
  assert.equal(r.launched.length, 0);
});

test("portable and development copies cannot download or self-install", async () => {
  const r = await rig({
    options: { installed: false },
    preferences: { autoDownload: true },
  });
  await r.updater.check();
  assert.equal(r.updater.publicState().canDownload, false);
  await assert.rejects(r.updater.download(), /Setup/);
  assert.equal(r.launched.length, 0);
});

test("OS shutdown and a disabled exit preference defer an already downloaded update", async () => {
  const r = await rig();
  await r.updater.check();
  await r.updater.download();
  r.updater.sessionEnding = true;
  assert.equal(await r.updater.install({ automatic: true }), false);
  r.updater.sessionEnding = false;
  await r.updater.configure({ installOnExit: false });
  assert.equal(await r.updater.install({ automatic: true }), false);
  assert.equal(await r.updater.install({ automatic: false }), true);
});

test("a cache already applied to the running version is discarded", async () => {
  const r = await rig();
  await r.updater.check();
  await r.updater.download();
  r.updater.current = "0.9.0";
  await r.updater.restore();
  assert.equal(r.updater.manifest, null);
  assert.ok(!(await readdir(r.directory)).includes("pending-update.json"));
});

test("settings changes honor the parental settings gate", async () => {
  const r = await rig();
  r.client.profiles.gate = () => {
    throw new Error("locked");
  };
  await assert.rejects(r.updater.configure({ enabled: false }), /locked/);
  assert.notEqual(r.updater.store.enabled, false);
});

test("a failing installer spawn is reported without claiming installation", async () => {
  const r = await rig({
    options: {
      launch: async () => {
        throw new Error("spawn failure");
      },
    },
  });
  await r.updater.check();
  await r.updater.download();
  assert.equal(await r.updater.install(), false);
  assert.equal(r.updater.publicState().status, "error");
});

test("cancelled downloads discard partial bytes and can be retried", async () => {
  const r = await rig();
  await r.updater.check();
  r.updater.fetcher = async (_url, { signal }) => {
    signal.throwIfAborted();
    await new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
    });
  };
  const pending = r.updater.download();
  r.updater.cancel();
  await pending;
  assert.equal(r.updater.publicState().status, "available");
  r.updater.fetcher = async () => new Response(binary);
  await r.updater.download();
  assert.equal(r.updater.publicState().status, "ready");
});
