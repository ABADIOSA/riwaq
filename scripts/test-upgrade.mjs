// Windows integration test. Builds a uniquely named, isolated NSIS fixture
// using the production updater, then really upgrades it and checks DPAPI data.
// It never installs or removes the user's Riwaq application.
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, copyFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { resolve, join, basename } from "node:path";
import { generateKeyPairSync, createHash, sign } from "node:crypto";
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { installerName } from "../core/update-package.mjs";

if (process.platform !== "win32")
  throw new Error("Requires a Windows desktop session.");
const root = resolve(`.cache/upgrade-${Date.now()}`),
  fixture = join(root, "app"),
  target = join(root, "installed");
const product = `RiwaqUpdateTest${Date.now()}`;
const before = "0.8.0-test.0",
  after = "0.8.0-test.1";
const keys = generateKeyPairSync("ed25519");
const { version: electronVersion } = JSON.parse(
  await readFile("node_modules/electron/package.json", "utf8"),
);
for (const dir of [
  fixture,
  join(fixture, "core"),
  join(fixture, "electron"),
  join(root, "data"),
])
  await mkdir(dir, { recursive: true });
for (const file of [
  "core/updates.mjs",
  "core/update-package.mjs",
  "electron/updater.mjs",
])
  await copyFile(file, join(fixture, file));
await writeFile(
  join(fixture, "public.pem"),
  keys.publicKey.export({ type: "spki", format: "pem" }),
);
await writeFile(
  join(fixture, "main.mjs"),
  `
import { app, safeStorage } from 'electron';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DesktopUpdates } from './electron/updater.mjs';
const root = ${JSON.stringify(root)}, here = dirname(fileURLToPath(import.meta.url));
app.setPath('userData', join(root, 'data'));
if (!app.requestSingleInstanceLock()) app.exit(0);
app.whenReady().then(async () => {
  const file = join(root, 'data', 'profile.bin');
  const original = { favorites: ['tt1375666'], settings: { theme: 'royal' }, progress: 1234 };
  if (!existsSync(file)) writeFileSync(file, safeStorage.encryptString(JSON.stringify(original)));
  const restored = JSON.parse(safeStorage.decryptString(readFileSync(file)));
  if (JSON.stringify(restored) !== JSON.stringify(original)) throw new Error('Profile changed during upgrade');
  if (app.getVersion() === ${JSON.stringify(after)}) {
    writeFileSync(join(root, 'result.json'), JSON.stringify({ passed: true, version: app.getVersion(), profilePreserved: true, encryption: safeStorage.isEncryptionAvailable() }));
    app.quit(); return;
  }
  const config = JSON.parse(readFileSync(join(root, 'fixture.json'), 'utf8'));
  let updater;
  const client = { state: { updates: { autoDownload: false } }, profiles: { gate() {} }, persist() {}, publicState: () => ({ update: updater.publicState() }), request: async () => [config.release] };
  updater = new DesktopUpdates(client, { current: app.getVersion(), directory: join(root, 'data', 'updates'), publicKey: readFileSync(join(here, 'public.pem'), 'utf8'), installed: true, installDirectory: dirname(process.execPath), fetcher: (url, options) => fetch(config.server + '/' + new URL(url).pathname.split('/').pop(), options), onChange: state => writeFileSync(join(root, 'status.json'), JSON.stringify(state)) });
  await updater.check(); await updater.download();
  if (updater.publicState().status !== 'ready') throw new Error('Update did not stage');
  if (!await updater.install()) throw new Error('Installer did not start');
  app.quit();
}).catch(error => { writeFileSync(join(root, 'failure.txt'), error.stack); app.exit(1); });
`,
);
const config = {
  appId: `app.riwaq.upgrade-test.${Date.now()}`,
  productName: product,
  electronVersion,
  electronDist: resolve("node_modules/electron/dist"),
  files: [
    "main.mjs",
    "core/**/*",
    "electron/**/*",
    "public.pem",
    "package.json",
  ],
  win: { target: "nsis", signAndEditExecutable: false },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: false,
    createDesktopShortcut: false,
    createStartMenuShortcut: false,
    deleteAppDataOnUninstall: false,
    runAfterFinish: true,
    artifactName: "Riwaq-Setup-${version}-win-x64.exe",
  },
};
const env = {
  ...process.env,
  ELECTRON_BUILDER_CACHE: resolve(".cache/builder"),
};
delete env.ELECTRON_RUN_AS_NODE;
const run = (exe, args) =>
  new Promise((res, rej) => {
    const child = spawn(exe, args, {
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (b) => (output += b));
    child.stderr.on("data", (b) => (output += b));
    child.on("error", rej);
    child.on("exit", (code) =>
      code === 0 ? res(output) : rej(new Error(output.slice(-6000))),
    );
  });
for (const version of [before, after]) {
  const out = join(root, version);
  await writeFile(
    join(fixture, "package.json"),
    JSON.stringify({
      name: "riwaq-upgrade-test",
      version,
      main: "main.mjs",
      type: "module",
      description: "Isolated Riwaq updater verification",
      author: "Riwaq",
      build: { ...config, directories: { output: out } },
    }),
  );
  console.log(`Building isolated installer ${version}`);
  await run(process.execPath, [
    resolve("node_modules/electron-builder/cli.js"),
    "--projectDir",
    fixture,
    "--win",
    "nsis",
    "--x64",
    "--publish",
    "never",
  ]);
}
const installer = join(root, after, installerName(after));
const hash = createHash("sha512");
for await (const b of createReadStream(installer)) hash.update(b);
const payload = Buffer.from(
  JSON.stringify({
    schema: 1,
    repo: "ABADIOSA/riwaq",
    version: after,
    platform: "win32-x64",
    channel: "beta",
    publishedAt: new Date().toISOString(),
    filename: installerName(after),
    size: (await stat(installer)).size,
    sha512: hash.digest("hex"),
    notes: "Isolated Windows upgrade test",
  }),
);
const envelope = JSON.stringify({
  payload: payload.toString("base64"),
  signature: sign(null, payload, keys.privateKey).toString("base64"),
});
const server = createServer((req, res) => {
  if (req.url === "/riwaq-update.json") {
    res.end(envelope);
    return;
  }
  if (req.url === "/" + installerName(after)) {
    res.writeHead(200);
    createReadStream(installer).pipe(res);
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
await writeFile(
  join(root, "fixture.json"),
  JSON.stringify({
    server: `http://127.0.0.1:${server.address().port}`,
    release: {
      tag_name: "v" + after,
      name: after,
      html_url: `https://github.com/ABADIOSA/riwaq/releases/tag/v${after}`,
      prerelease: true,
      assets: [{ name: "riwaq-update.json" }],
    },
  }),
);
try {
  console.log("Installing the isolated first version");
  await run(join(root, before, installerName(before)), ["/S", `/D=${target}`]);
  const child = spawn(join(target, product + ".exe"), [], {
    env,
    windowsHide: true,
    stdio: "ignore",
  });
  child.on("error", (error) => console.error(error));
  const deadline = Date.now() + 150000;
  let result;
  while (Date.now() < deadline) {
    try {
      result = JSON.parse(await readFile(join(root, "result.json"), "utf8"));
      break;
    } catch {}
    try {
      throw new Error(await readFile(join(root, "failure.txt"), "utf8"));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.equal(
    result?.passed,
    true,
    "New version must relaunch after a real NSIS replacement",
  );
  assert.equal(result.version, after);
  assert.equal(result.profilePreserved, true);
  await writeFile(
    resolve(".cache/upgrade-results.json"),
    JSON.stringify(
      { ...result, before, after, root, installer: basename(installer) },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(result));
} finally {
  server.closeAllConnections();
  server.close();
  // Both resolved paths must remain inside this test's generated workspace.
  assert.ok(target.startsWith(root + "/") || target.startsWith(root + "\\"));
  try {
    await run(join(target, `Uninstall ${product}.exe`), ["/S"]);
  } catch {}
}
