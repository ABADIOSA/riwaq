import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  HEALTH_LABELS,
  classifyHealth,
  duplicateAddons,
  healthSummary,
  isLocalAddon,
} from "../core/addon-health.mjs";
import { probeAddons, runDiagnostics } from "../electron/diagnose.mjs";
import { ErrorLog, sanitize } from "../core/diagnose.mjs";
import { Client } from "../core/client.mjs";
import { DEFAULT_SETTINGS } from "../core/protocol.mjs";

const source = (file) =>
  readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8");

test("an addon is working, slow, gone for good, down for now, or needs the local service", () => {
  assert.equal(classifyHealth({ status: 200, ms: 400 }).state, "ok");
  assert.equal(classifyHealth({ status: 200, ms: 3500 }).state, "slow");
  assert.equal(classifyHealth({ status: 404 }).state, "gone");
  assert.equal(classifyHealth({ status: 410 }).state, "gone");
  assert.equal(classifyHealth({ status: 521 }).state, "down");
  assert.equal(classifyHealth({ status: "timeout" }).state, "down");
  assert.equal(
    classifyHealth({ status: "error", local: true }).state,
    "needs-server",
  );
  // A local addon that answers 404 is still gone.
  assert.equal(classifyHealth({ status: 404, local: true }).state, "gone");
  assert.ok(isLocalAddon("http://127.0.0.1:11470/local-addon/manifest.json"));
  assert.ok(isLocalAddon("http://localhost:11470/x/manifest.json"));
  assert.ok(!isLocalAddon("https://torrentio.strem.fun/manifest.json"));
  assert.ok(!isLocalAddon("not a url"));
  assert.equal(HEALTH_LABELS.gone, "توقفت نهائياً");
});

test("an addon installed twice is flagged, the first copy kept", () => {
  const dupes = duplicateAddons([
    { key: "a", manifest: { id: "aiometadata", name: "AIOMetadata" } },
    { key: "b", manifest: { id: "other", name: "Other" } },
    { key: "c", manifest: { id: "aiometadata", name: "AIOMetadata" } },
    { key: "d", manifest: { name: "Nameless" } },
    { key: "e", manifest: { name: "nameless " } },
  ]);
  assert.deepEqual(dupes, [
    { key: "c", of: "a" },
    { key: "e", of: "d" },
  ]);
  assert.deepEqual(
    healthSummary([{ state: "ok" }, { state: "gone" }, { state: "gone" }]),
    { ok: 1, slow: 0, gone: 2, down: 0, "needs-server": 0 },
  );
});

const SECRET = "f".repeat(40);
const addon = (key, host, name, extra = {}) => ({
  key,
  enabled: true,
  transportUrl: `https://${host}/${SECRET}/manifest.json`,
  manifest: { id: key, name },
  ...extra,
});

test("addons are probed by key and name; their addresses never come back", async () => {
  const addons = [
    addon("good", "good.example", "Good"),
    addon("gone", "gone.example", "Gone"),
    addon("slow", "slow.example", "Slow"),
    {
      ...addon("local", "x", "Local Files"),
      transportUrl: "http://127.0.0.1:11470/local-addon/manifest.json",
    },
  ];
  let now = 0;
  const fetcher = async (url) => {
    if (url.includes("127.0.0.1")) throw new Error("refused");
    return {
      status: url.includes("gone") ? 404 : 200,
      body: null,
      headers: { get: () => null },
    };
  };
  const { results, duplicates } = await probeAddons(addons, { fetcher });
  const by = Object.fromEntries(results.map((r) => [r.key, r.state]));
  assert.deepEqual(by, {
    good: "ok",
    gone: "gone",
    slow: "ok",
    local: "needs-server",
  });
  assert.deepEqual(duplicates, []);
  assert.doesNotMatch(JSON.stringify(results), new RegExp(SECRET));
  assert.doesNotMatch(JSON.stringify(results), /example|127\.0\.0\.1/);
  void now;
});

test("several addons can be removed at once, behind the addons lock", () => {
  const c = new Client({
    load: () => ({
      addons: [
        addon("a", "a.example", "A"),
        addon("b", "b.example", "B"),
        addon("c", "c.example", "C"),
      ],
    }),
    save: () => {},
  });
  const keys = c.state.addons.map((a) => a.key);
  c.removeAddons({ keys: [keys[0], keys[2], "unknown"] });
  assert.deepEqual(
    c.state.addons.map((a) => a.manifest.name),
    ["B"],
  );
  c.removeAddons({ keys: [] });
  assert.equal(c.state.addons.length, 1);
  assert.match(
    source("core/client.mjs"),
    /removeAddons\(\{ keys \} = \{\}\) \{\n\s+this\.profiles\.gate\("addons"\)/,
  );
});

test("main serves addon health and removal behind the lock, main window only", () => {
  const main = source("electron/main.mjs");
  const health = main.slice(main.indexOf("addonsHealth: async"));
  assert.match(health.slice(0, 160), /client\.profiles\.gate\("addons"\)/);
  for (const m of ["addonsHealth", "removeAddons"])
    assert.match(source("electron/preload.cjs"), new RegExp(`"${m}"`));
  assert.doesNotMatch(source("core/hud.mjs"), /addonsHealth|removeAddons/);
  const page = source("src/components/Addons.jsx");
  assert.match(page, /call\("addonsHealth"\)/);
  assert.match(page, /update\("removeAddons"/);
  assert.match(page, /اضغط مرة ثانية للتأكيد/);
});

function diagRig({ traktClientId = "", trakt403 = true, surface } = {}) {
  const seen = [];
  const deps = {
    app: {
      getVersion: () => "0.30.1",
      isPackaged: true,
      getPath: () => process.cwd(),
      getGPUInfo: async () => ({}),
      getGPUFeatureStatus: () => ({}),
    },
    client: {
      state: {
        settings: { ...DEFAULT_SETTINGS },
        addons: [
          addon("a", "dup.example", "AIOMetadata", {
            manifest: { id: "aio", name: "AIOMetadata" },
          }),
          addon("b", "dup2.example", "AIOMetadata", {
            manifest: { id: "aio", name: "AIOMetadata" },
          }),
          {
            ...addon("local", "x", "Local Files"),
            transportUrl: "http://127.0.0.1:11470/local-addon/manifest.json",
          },
        ],
      },
      integrations: {
        get: () => ({ clientId: traktClientId }),
        traktHeaders: (s) => ({
          "User-Agent": "Riwaq/0.30.1",
          "trakt-api-version": "2",
          "trakt-api-key": s.clientId,
        }),
      },
      publicState: () => ({}),
    },
    executable: () => "/nonexistent/mpv.exe",
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (t) => Buffer.from(t),
      decryptString: (b) => b.toString(),
    },
    screen: { getAllDisplays: () => [] },
    videoHost: surface ? { inspect: () => surface } : undefined,
    errors: new ErrorLog(),
    fetcher: async (url, init) => {
      seen.push({ url, headers: init?.headers || {} });
      if (url.includes("127.0.0.1")) throw new Error("refused");
      if (url.includes("trakt"))
        return {
          status: init.headers["trakt-api-key"] ? 200 : trakt403 ? 403 : 200,
          body: null,
          headers: { get: () => null },
        };
      return { status: 200, body: null, headers: { get: () => null } };
    },
    run: async () => ({ code: 0, out: "" }),
  };
  return { deps, seen };
}

test("report fixes: idle surface, Trakt with the viewer's client ID, local addons, duplicates", async () => {
  // A hidden surface with no viewing is not a warning.
  let { deps } = diagRig({
    surface: { embedded: true, visible: false, siblingsClipped: false },
  });
  let report = await runDiagnostics(deps);
  let by = Object.fromEntries(report.checks.map((c) => [c.id, c]));
  assert.equal(by["video-surface"].status, "ok");
  assert.match(by["video-surface"].detail, /أثناء المشاهدة/);
  // A visible surface whose siblings do not clip still warns.
  ({ deps } = diagRig({
    surface: { embedded: true, visible: true, siblingsClipped: false },
  }));
  report = await runDiagnostics(deps);
  by = Object.fromEntries(report.checks.map((c) => [c.id, c]));
  assert.equal(by["video-surface"].status, "warn");
  // Without a client ID, Trakt's 403 means reachable; with one, it is sent.
  assert.equal(by["net-trakt"].status, "ok");
  assert.match(by["net-trakt"].detail, /يحتاج Client ID/);
  const withKey = diagRig({ traktClientId: "abc123" });
  report = await runDiagnostics(withKey.deps);
  by = Object.fromEntries(report.checks.map((c) => [c.id, c]));
  assert.equal(by["net-trakt"].status, "ok");
  const traktCall = withKey.seen.find((s) => s.url.includes("trakt"));
  assert.equal(traktCall.headers["trakt-api-key"], "abc123");
  assert.doesNotMatch(JSON.stringify(report), /abc123/);
  // The local addon needs Stremio Service; the second AIOMetadata is a duplicate.
  assert.match(by.addons.detail, /تحتاج Stremio Service: Local Files/);
  assert.match(by.addons.detail, /مكررة: AIOMetadata/);
  assert.equal(by.addons.data.duplicates, 1);
  // The local service's port survives sanitizing; remote paths do not.
  assert.equal(
    sanitize("http://127.0.0.1:11470/settings"),
    "http://127.0.0.1:11470/…",
  );
  assert.equal(
    sanitize(`https://a.example:8443/${SECRET}`),
    "https://a.example/…",
  );
});
