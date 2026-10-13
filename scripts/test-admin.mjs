// Real Windows Electron / IPC. GitHub and the native chooser are fixtures;
// no announcement is sent and no real token is used. Build Riwaq first.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const { _electron } = require(process.env.RIWAQ_PLAYWRIGHT || "playwright");
if (process.platform !== "win32")
  throw Error("Run this native smoke on Windows");
const out = resolve(".cache/admin-smoke");
mkdirSync(out, { recursive: true });
const bootstrap = join(out, "bootstrap.mjs"),
  profile = join(out, `profile-${Date.now()}`);
const previewBoot = join(out, "preview.mjs"),
  previewResult = join(out, "preview-result.json");
writeFileSync(
  previewBoot,
  `
import {app,BrowserWindow} from "electron";import {writeFileSync} from "node:fs";
globalThis.fetch=async(url)=>new Response(JSON.stringify(String(url).includes("raw.githubusercontent.com")?{schema:1,items:[]}:String(url).endsWith("manifest.json")?{id:"preview.fixture",name:"Offline",version:"1.0.0",resources:["catalog"],types:["movie"],catalogs:[]}:{metas:[]}));
await import(${JSON.stringify(pathToFileURL(resolve("electron/main.mjs")).href)});
app.whenReady().then(()=>setTimeout(()=>{writeFileSync(${JSON.stringify(previewResult)},JSON.stringify({data:app.getPath("userData"),windows:BrowserWindow.getAllWindows().length}));app.quit();},2500));
`,
);
writeFileSync(
  bootstrap,
  `
import {dialog} from "electron";
import childProcess from "node:child_process";import {syncBuiltinESMExports} from "node:module";
const originalSpawn=childProcess.spawn;
childProcess.spawn=(file,args,options)=>{
 if(options?.env?.RIWAQ_DATA_DIR){globalThis.adminLaunch={file,args,data:options.env.RIWAQ_DATA_DIR};return originalSpawn(file,[${JSON.stringify(previewBoot)}],options);}
 return originalSpawn(file,args,options);
};syncBuiltinESMExports();
globalThis.adminWrites=[];globalThis.adminConfirmations=0;
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(process.cwd())}]});
dialog.showMessageBox=async()=>{globalThis.adminConfirmations++;return {response:1};};
globalThis.fetch=async(url,args={})=>{
  if(!String(url).startsWith("https://api.github.com/"))throw Error("Offline test");
  let value;
  if(url.endsWith("/user"))value={login:"ABADIOSA"};
  else if(url.endsWith("/repos/ABADIOSA/riwaq"))value={private:false,default_branch:"main",permissions:{push:true}};
  else if(args.method==="PUT"){globalThis.adminWrites.push(JSON.parse(args.body));value={commit:{sha:"c".repeat(40)}};}
  else if(url.includes("/releases?"))value=[{tag_name:"v0.43.1",name:"Riwaq",published_at:new Date().toISOString(),prerelease:true}];
  else value={encoding:"base64",size:24,sha:"a".repeat(40),content:Buffer.from('{"schema":1,"items":[]}').toString("base64")};
  return new Response(JSON.stringify(value),{headers:{"Content-Type":"application/json"}});
};
await import(${JSON.stringify(pathToFileURL(resolve("admin/main.mjs")).href)});
`,
);
const env = { ...process.env, RIWAQ_ADMIN_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({
  executablePath: resolve("node_modules/electron/dist/electron.exe"),
  args: [bootstrap],
  cwd: process.cwd(),
  env,
  timeout: 20000,
});
const errors = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.waitForSelector("#editor");
  await page.waitForFunction(() => !!window.riwaqAdmin);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(980, 780),
  );
  await page.locator("[name=arTitle]").fill("خبر تجريبي للمراجعة");
  await page
    .locator("[name=arBody]")
    .fill("هذه رسالة محلية في الاختبار. لا ترسل للمستخدمين.");
  await page.locator("[name=enTitle]").fill("Review fixture");
  await page
    .locator("[name=enBody]")
    .fill("Local fixture only. No real broadcast.");
  await page.locator("#save").click();
  await page.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("حُفظت"),
  );
  await page.locator("#token").fill("github_pat_" + "x".repeat(70));
  await page.locator("#connect").click();
  await page.waitForFunction(() =>
    document.querySelector("#connection").textContent.includes("متصل بحساب"),
  );
  assert.equal(await page.locator("#token").inputValue(), "");
  await page.locator("#preview").click();
  await page.waitForSelector("#previewCard:not([hidden])");
  assert.equal(await app.evaluate(() => globalThis.adminWrites.length), 0);
  await page.locator("[name=arTitle]").fill("المعاينة المعدّلة");
  assert.ok(await page.locator("#publish").isDisabled());
  await page.locator("#preview").click();
  await page.waitForFunction(
    () => !document.querySelector("#publish").disabled,
  );
  await page.screenshot({
    path: join(out, "admin-preview-980.png"),
    fullPage: true,
  });
  await page.locator("#publish").click();
  await page.waitForFunction(() =>
    document.querySelector("#status").textContent.startsWith("نُشر"),
  );
  const write = await app.evaluate(() => globalThis.adminWrites[0]);
  const feed = JSON.parse(Buffer.from(write.content, "base64").toString());
  assert.equal(feed.items[0].ar.title, "المعاينة المعدّلة");
  assert.equal(write.sha, "a".repeat(40));
  assert.equal(await app.evaluate(() => globalThis.adminConfirmations), 1);
  assert.ok(
    !readFileSync(join(profile, "draft.json"), "utf8").includes("github_pat_"),
  );
  await page.locator("#refreshReleases").click();
  await page.waitForSelector("#releases button");
  await page.locator("#choose").click();
  await page.waitForFunction(() =>
    document.querySelector("#workspace").textContent.includes("codex/"),
  );
  await page.locator("#build").click();
  for (let i = 0; i < 300; i++) {
    const state = await page.evaluate(() => window.riwaqAdmin.call("state"));
    if (!state.task && state.log.includes("Exit: 0")) break;
    if (!state.task && /Exit:/.test(state.log))
      throw Error(state.log.slice(-5000));
    if (i === 299) throw Error("Build task timeout");
    await new Promise((r) => setTimeout(r, 100));
  }
  const previousJob = (
    await page.evaluate(() => window.riwaqAdmin.call("state"))
  ).jobId;
  await page.locator("#launch").click();
  for (let i = 0; i < 150; i++) {
    const current = await page.evaluate(() => window.riwaqAdmin.call("state"));
    if (
      current.jobId > previousJob &&
      !current.task &&
      current.log.includes("Exit: 0")
    )
      break;
    if (i === 149) throw Error("Preview launch timeout");
    await new Promise((r) => setTimeout(r, 100));
  }
  const launch = await app.evaluate(() => globalThis.adminLaunch);
  const previewState = JSON.parse(readFileSync(previewResult, "utf8"));
  assert.equal(launch.file, resolve("node_modules/electron/dist/electron.exe"));
  assert.deepEqual(launch.args, [process.cwd()]);
  assert.equal(previewState.data, launch.data);
  assert.ok(previewState.data.startsWith(join(profile, "sandboxes")));
  assert.ok(previewState.windows > 0);
  await page.reload();
  await page.waitForFunction(() => !!window.riwaqAdmin);
  assert.equal(
    await page.locator("[name=arTitle]").inputValue(),
    "المعاينة المعدّلة",
  );
  assert.equal(
    (await page.evaluate(() => window.riwaqAdmin.call("state"))).connected,
    true,
  );
  const width = await page.evaluate(
    () => document.documentElement.scrollWidth <= innerWidth,
  );
  assert.ok(width, "admin has no horizontal overflow at 980px");
  assert.deepEqual(errors, []);
  console.log(
    "Admin Windows smoke passed: draft, owner connection, preview invalidation, manual confirmation, mock publication, reload, GitHub releases, native workspace selection, real build and source preview with isolated data; no real broadcast.",
  );
} finally {
  await app.close();
}

// The actual Riwaq renderer and main IPC, with only fetch responses mocked.
const appBoot = join(out, "riwaq.mjs"),
  now = Date.now();
const feed = {
  schema: 1,
  items: [
    {
      id: "native_fixture_001",
      at: now - 1000,
      expires: now + 86400000,
      platform: "desktop",
      ar: {
        title: "رسالة من الفريق",
        body: "اختبار صندوق الإشعارات على ويندوز.",
      },
      en: { title: "Team notice", body: "Windows notification fixture." },
      link: "",
    },
  ],
};
writeFileSync(
  appBoot,
  `
import {app} from "electron";app.getVersion=()=>"0.43.1";
globalThis.fetch=async(url)=>new Response(JSON.stringify(String(url).includes("raw.githubusercontent.com")?${JSON.stringify(feed)}:String(url).endsWith("manifest.json")?{id:"cinemeta.fixture",name:"Offline",version:"1.0.0",resources:["catalog"],types:["movie"],catalogs:[]}:{metas:[]}),{headers:{"Content-Type":"application/json"}});
await import(${JSON.stringify(pathToFileURL(resolve("electron/main.mjs")).href)});
`,
);
const nativeEnv = { ...env, RIWAQ_DATA_DIR: join(out, `viewer-${Date.now()}`) };
delete nativeEnv.RIWAQ_SMOKE;
const viewer = await _electron.launch({
  executablePath: resolve("node_modules/electron/dist/electron.exe"),
  args: [appBoot],
  cwd: process.cwd(),
  env: nativeEnv,
  timeout: 20000,
});
try {
  const page = await viewer.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.waitForSelector(".notification-trigger");
  const call = (method, args) =>
    page.evaluate(([m, a]) => window.riwaq.call(m, a), [method, args]);
  // Dismiss the first-run highlights through the real UI if present.
  if (await page.locator(".whats-new").count())
    await page.locator(".whats-new .primary").click();
  // Pixel comparison of the Arabic shell with/without the added bell.
  // There are no changes to existing layout CSS; differences belong in the topbar.
  await page.waitForTimeout(300);
  const bar = await page.locator(".topbar").boundingBox();
  await page.locator(".notification-trigger").evaluate((el) => {
    el.style.display = "none";
  });
  const before = join(out, "shell-before-bell.png"),
    after = join(out, "shell-with-bell.png");
  await page.screenshot({ path: before, animations: "disabled" });
  await page.locator(".notification-trigger").evaluate((el) => {
    el.style.display = "";
  });
  await page.screenshot({ path: after, animations: "disabled" });
  const changed = await viewer.evaluate(
    ({ nativeImage }, [before, after, bar]) => {
      const a = nativeImage.createFromPath(before),
        b = nativeImage.createFromPath(after),
        size = a.getSize();
      const x = a.toBitmap(),
        y = b.toBitmap();
      let outside = 0;
      for (let row = 0; row < size.height; row++)
        if (
          row < Math.floor(bar.y) - 1 ||
          row > Math.ceil(bar.y + bar.height) + 1
        )
          for (let col = 0; col < size.width; col++) {
            const p = (row * size.width + col) * 4;
            if (x[p] !== y[p] || x[p + 1] !== y[p + 1] || x[p + 2] !== y[p + 2])
              outside++;
          }
      return outside;
    },
    [before, after, bar],
  );
  assert.equal(
    changed,
    0,
    "existing Arabic shell pixels stay unchanged outside the topbar",
  );
  await page.locator(".notification-trigger").click();
  await page.waitForSelector(".notification-list article");
  assert.equal(await page.locator(".notification-count").textContent(), "1");
  await page.getByRole("button", { name: "قراءة الكل", exact: true }).click();
  await page.waitForFunction(
    () => !document.querySelector(".notification-count"),
  );
  assert.equal((await call("announcementState")).unread, 0);
  await page.getByLabel("استقبال أخبار رِواق").uncheck();
  assert.equal((await call("announcementState")).enabled, false);
  await page.getByLabel("استقبال أخبار رِواق").check();
  await viewer.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => !w.webContents.getURL().endsWith("#hud"))
      .setSize(980, 680),
  );
  await page.screenshot({ path: join(out, "inbox-ar-980.png") });
  await page.locator(".notification-center .modal-close").click();
  await call("settings", { uiLanguage: "en" });
  await page
    .getByRole("button", { name: "Riwaq notifications", exact: true })
    .click();
  await page.getByText("Team notice", { exact: true }).waitFor();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({ path: join(out, "inbox-en-980.png") });
  assert.deepEqual(errors, []);
  console.log(
    "Riwaq Windows inbox passed: real IPC fetch, read/unread, opt out/in, Arabic/English and 980x680 layout.",
  );
} finally {
  await viewer.close();
}
