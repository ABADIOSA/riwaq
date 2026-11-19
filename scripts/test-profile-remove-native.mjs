/**
 * The sixth pass's V1 check in the real Electron app (PR #155): a profile
 * removal whose encrypted write is refused must leave its downloads on
 * disk and in its records, across a later unrelated save and a restart;
 * a removal that is written deletes them, and a file another program holds
 * stays on a durable clean-up list until a later start deletes it.
 *
 * Mirrors Codex's fifth-review fixture (native-offline-refusal.mjs): real
 * main, real IPC, the real profile.bin write (encrypted by safeStorage,
 * DPAPI on Windows), a directory occupying profile.bin.tmp to refuse it.
 * Off Windows, safeStorage uses Chromium's basic store
 * (--password-store=basic); the Windows run is the one that proves DPAPI.
 *
 *   npm run build
 *   node scripts/test-profile-remove-native.mjs [path to the app]
 *
 * Playwright from RIWAQ_PLAYWRIGHT, the project, or a global install. On
 * Linux without a display, run under xvfb-run. Prints JSON; exits 1 on the
 * first failed assertion.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { open as openHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const appDir = resolve(process.argv[2] || ".");
const require = createRequire(join(appDir, "package.json"));
const playwright = (() => {
  for (const name of [process.env.RIWAQ_PLAYWRIGHT, "playwright"]) {
    if (!name) continue;
    try {
      return require(name);
    } catch {}
  }
  return createRequire(import.meta.url)("playwright");
})();
const { _electron } = playwright;
const win = process.platform === "win32";
const executablePath = join(
  appDir,
  "node_modules/electron/dist",
  win ? "electron.exe" : "electron",
);
const root = await mkdtemp(join(tmpdir(), "riwaq-v1-native-"));
const profileFile = join(root, "profile.bin");
const blocker = profileFile + ".tmp";
const offlineDir = join(root, "offline");
const ids = { b: "6".repeat(32), c: "7".repeat(32), a: "8".repeat(32) };
const media = (id) => join(offlineDir, id + ".media");
const marker = (id) => Buffer.from("disposable offline fixture " + id);
const exists = (path) =>
  access(path).then(
    () => true,
    () => false,
  );
const results = { platform: process.platform, steps: [] };
const step = (name, data = {}) => results.steps.push({ name, ...data });

let app;
let page;
const call = (method, args) =>
  page.evaluate(
    ([name, value]) =>
      window.riwaq.call(name, value).then(
        (result) => ({ ok: true, result }),
        (error) => ({ ok: false, error: String(error?.message || error) }),
      ),
    [method, args],
  );
const must = async (method, args) => {
  const out = await call(method, args);
  if (!out.ok) throw new Error(`${method}: ${out.error}`);
  return out.result;
};
async function open() {
  app = await _electron.launch({
    executablePath,
    args: [
      ...(win ? [] : ["--no-sandbox", "--password-store=basic"]),
      // Off Windows, a folder whose main loads a stand-in for the Win32
      // video host first, then this app's electron/main.mjs.
      process.env.RIWAQ_ELECTRON_APP || appDir,
    ],
    cwd: appDir,
    env: {
      ...process.env,
      RIWAQ_DATA_DIR: root,
      RIWAQ_ACCOUNT_SERVER: "http://127.0.0.1:1",
    },
  });
  page = await app.firstWindow();
  await page.waitForFunction(
    () => window.riwaq && document.querySelector(".app"),
  );
}
async function close() {
  await app?.close();
  app = null;
}
const decrypt = (bytes) =>
  app.evaluate(
    ({ safeStorage }, b64) =>
      JSON.parse(safeStorage.decryptString(Buffer.from(b64, "base64"))),
    bytes.toString("base64"),
  );
const record = (id, name) => ({
  id,
  meta: { id: "tt1234567", type: "movie", name },
  videoId: "tt1234567",
  status: "ready",
  bytes: marker(id).length,
  total: marker(id).length,
  at: 1,
});

try {
  await open();
  await must("onboardingComplete");
  const a = (await must("init")).profiles.active;
  const created = await must("profileCreate", { name: "Download fixture B" });
  const b = created.profiles.list.find(
    (p) => p.name === "Download fixture B",
  ).id;
  const withC = await must("profileCreate", { name: "Download fixture C" });
  const c = withC.profiles.list.find((p) => p.name === "Download fixture C").id;
  await must("profileSwitch", { id: b });
  await must("collectionsEdit", {
    action: "create",
    title: "Fixture collection kept",
  });
  await must("profileSwitch", { id: a });
  // Seed three completed downloads (B's, C's and A's) through the real
  // encrypted file, as Codex's fixture does.
  const seeded = await app.evaluate(
    ({ safeStorage }, { file, b, c, a, recs }) => {
      const fs = process.getBuiltinModule("node:fs");
      const data = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
      data.offline = { [b]: [recs.b], [c]: [recs.c], [a]: [recs.a] };
      return safeStorage.encryptString(JSON.stringify(data)).toString("base64");
    },
    {
      file: profileFile,
      b,
      c,
      a,
      recs: {
        b: record(ids.b, "B's download"),
        c: record(ids.c, "C's download"),
        a: record(ids.a, "A's download"),
      },
    },
  );
  await close();
  await mkdir(offlineDir, { recursive: true });
  for (const id of Object.values(ids)) await writeFile(media(id), marker(id));
  await writeFile(profileFile, Buffer.from(seeded, "base64"));
  await open();
  await must("profileSwitch", { id: b });
  assert.equal(
    (await must("offlineList", { profileId: b })).items[0]?.id,
    ids.b,
  );
  await must("profileSwitch", { id: a });

  // 1. The write is refused: B, its collection, its record and its bytes
  // stay, now and after an unrelated save and a restart.
  await mkdir(blocker);
  const fileBefore = await readFile(profileFile);
  let refused;
  try {
    refused = await call("profileRemove", { id: b });
    assert.equal(refused.ok, false, "the refused removal must report failure");
    assert.deepEqual(await readFile(profileFile), fileBefore);
    assert.ok((await must("init")).profiles.list.some((p) => p.id === b));
    assert.deepEqual(await readFile(media(ids.b)), marker(ids.b));
  } finally {
    await rmdir(blocker);
  }
  step("refused removal", { error: refused.error, mediaKept: true });
  await must("settings", { uiLanguage: "en" });
  await close();
  await open();
  const kept = await must("profileSwitch", { id: b });
  assert.equal(kept.collections[0]?.title, "Fixture collection kept");
  const list = (await must("offlineList", { profileId: b })).items;
  assert.equal(list.length, 1);
  assert.equal(list[0].id, ids.b);
  assert.equal(list[0].status, "ready");
  assert.deepEqual(await readFile(media(ids.b)), marker(ids.b));
  const durable = await decrypt(await readFile(profileFile));
  assert.equal(durable.offline[b][0].id, ids.b);
  assert.ok(!durable.offlineTrash?.length);
  step("after unrelated save and restart", {
    profileKept: true,
    collectionKept: true,
    recordKept: true,
    mediaBytesKept: true,
  });

  // 2. The same removal, written: B's file goes, A's and C's stay.
  await must("profileSwitch", { id: a });
  const removed = await must("profileRemove", { id: b });
  assert.ok(!removed.profiles.list.some((p) => p.id === b));
  assert.equal(removed.offlineCleanup, undefined);
  assert.equal(await exists(media(ids.b)), false);
  assert.deepEqual(await readFile(media(ids.c)), marker(ids.c));
  assert.deepEqual(await readFile(media(ids.a)), marker(ids.a));
  const afterRemove = await decrypt(await readFile(profileFile));
  assert.equal(afterRemove.offline[b], undefined);
  assert.ok(!afterRemove.offlineTrash?.length);
  step("written removal", { mediaDeleted: true, othersKept: true });

  // 3. A held file (Windows: another program has it open without delete
  // sharing). Elsewhere a file cannot be held that way, so the step is
  // reported as skipped there; tests/profile-remove-downloads.test.mjs
  // covers the same path with a refusing deleteFile.
  if (win) {
    const handle = await openHandle(media(ids.c), "r");
    let held;
    try {
      held = await must("profileRemove", { id: c });
      assert.ok(!held.profiles.list.some((p) => p.id === c));
      assert.ok(held.offlineCleanup?.pending >= 1);
      const durableHeld = await decrypt(await readFile(profileFile));
      assert.ok(durableHeld.offlineTrash.some((e) => e.id === ids.c));
    } finally {
      await handle.close();
    }
    await close();
    await open();
    // The start-up sweep deletes it once nothing holds it.
    await page.waitForTimeout(1500);
    assert.equal(await exists(media(ids.c)), false);
    const swept = await decrypt(await readFile(profileFile));
    assert.ok(!swept.offlineTrash?.some((e) => e.id === ids.c));
    step("held file", {
      pendingReported: held.offlineCleanup.pending,
      sweptAfterRestart: true,
    });
  } else {
    await must("profileRemove", { id: c });
    assert.equal(await exists(media(ids.c)), false);
    step("held file", {
      skipped: "a file cannot be held against deletion here",
    });
  }
  assert.deepEqual(await readFile(media(ids.a)), marker(ids.a));

  // 4. A crash after the removal was written, before its files went: the
  // durable clean-up list names a file still on disk. The next start
  // deletes it, and never a file a live record still names (A's).
  const orphan = "9".repeat(32);
  const withTrash = await app.evaluate(
    ({ safeStorage }, { file, orphan, live }) => {
      const fs = process.getBuiltinModule("node:fs");
      const data = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
      data.offlineTrash = [
        { id: orphan, at: 1 },
        { id: live, at: 1 },
      ];
      return safeStorage.encryptString(JSON.stringify(data)).toString("base64");
    },
    { file: profileFile, orphan, live: ids.a },
  );
  await close();
  await writeFile(media(orphan), marker(orphan));
  await writeFile(join(offlineDir, orphan + ".part"), marker(orphan));
  await writeFile(join(offlineDir, orphan + ".poster.jpg"), marker(orphan));
  await writeFile(profileFile, Buffer.from(withTrash, "base64"));
  await open();
  for (let i = 0; i < 50 && (await exists(media(orphan))); i++)
    await page.waitForTimeout(100);
  assert.equal(await exists(media(orphan)), false);
  assert.equal(await exists(join(offlineDir, orphan + ".part")), false);
  assert.equal(await exists(join(offlineDir, orphan + ".poster.jpg")), false);
  assert.deepEqual(await readFile(media(ids.a)), marker(ids.a));
  let recovered;
  for (let i = 0; i < 50; i++) {
    recovered = await decrypt(await readFile(profileFile));
    if (!recovered.offlineTrash?.length) break;
    await page.waitForTimeout(100);
  }
  assert.deepEqual(recovered.offlineTrash, []);
  assert.equal(recovered.offline[a][0].id, ids.a);
  step("crash after the write, before clean-up", {
    sweptAtStart: true,
    liveRecordNeverDeleted: true,
  });
  results.ok = true;
  console.log(JSON.stringify(results, null, 2));
} catch (error) {
  results.ok = false;
  results.error = String(error?.stack || error);
  console.log(JSON.stringify(results, null, 2));
  process.exitCode = 1;
} finally {
  await close().catch(() => {});
  await rm(root, { recursive: true, force: true }).catch(() => {});
}
