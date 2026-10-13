// Startup and local draft persistence from an actual packaged Windows app.
// No network request, credential, publication or source mutation.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";
import { mkdirSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
const require = createRequire(import.meta.url);
const { _electron, chromium } = require(
  process.env.RIWAQ_PLAYWRIGHT || "playwright",
);
const exe = resolve(
  process.argv[2] || "release-admin/win-unpacked/Riwaq Admin.exe",
);
const profile = resolve(`.cache/admin-package-${Date.now()}`);
mkdirSync(profile, { recursive: true });
const env = { ...process.env, RIWAQ_ADMIN_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
const errors = [];
async function launch() {
  if (!exe.includes("win-unpacked")) {
    const socket = createServer();
    await new Promise((r) => socket.listen(0, "127.0.0.1", r));
    const port = socket.address().port;
    await new Promise((r) => socket.close(r));
    const proc = spawn(exe, [`--remote-debugging-port=${port}`], {
      env,
      windowsHide: true,
      stdio: "ignore",
    });
    let browser;
    try {
      for (let i = 0; i < 200; i++) {
        try {
          await fetch(`http://127.0.0.1:${port}/json/version`);
          break;
        } catch {}
        if (i === 199) throw Error("Portable startup timeout");
        await new Promise((r) => setTimeout(r, 100));
      }
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      const page = browser.contexts()[0].pages()[0];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.waitForSelector("#editor");
      assert.ok(page.url().includes("app.asar"));
      return {
        page,
        packagedFromUrl: page.url().includes("app.asar"),
        app: {
          close: async () => {
            await page.evaluate(() => window.close()).catch(() => {});
            await browser.close().catch(() => {});
            for (let i = 0; i < 100 && proc.exitCode === null; i++)
              await new Promise((r) => setTimeout(r, 100));
            assert.notEqual(
              proc.exitCode,
              null,
              "portable process exits normally",
            );
          },
        },
      };
    } catch (error) {
      await browser?.close().catch(() => {});
      proc.kill();
      throw error;
    }
  }
  const app = await _electron.launch({
    executablePath: exe,
    args: [],
    env,
    timeout: 20000,
  });
  const page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.waitForSelector("#editor");
  return { app, page };
}
let run = await launch();
try {
  assert.ok(
    run.packagedFromUrl ||
      (await run.app.evaluate(({ app }) => app.isPackaged)),
  );
  assert.equal(
    (await run.page.evaluate(() => window.riwaqAdmin.call("state"))).connected,
    false,
  );
  await run.page.locator("[name=arTitle]").fill("مسودة الحزمة");
  await run.page.locator("[name=arBody]").fill("حفظ محلي دون إرسال.");
  await run.page.locator("#save").click();
  await run.page.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("حُفظت"),
  );
  assert.equal(
    JSON.parse(readFileSync(join(profile, "draft.json"), "utf8")).arTitle,
    "مسودة الحزمة",
  );
} finally {
  await run.app.close();
}
run = await launch();
try {
  assert.equal(
    await run.page.locator("[name=arTitle]").inputValue(),
    "مسودة الحزمة",
  );
  assert.equal(
    (await run.page.evaluate(() => window.riwaqAdmin.call("state"))).connected,
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Packaged Riwaq Admin passed: startup, main/preload IPC, draft save and restore, no credential or broadcast.",
  );
} finally {
  await run.app.close();
}
