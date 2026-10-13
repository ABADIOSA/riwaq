import { readFile, realpath, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";

export async function inspectWorkspace(path) {
  const root = await realpath(path);
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  if (pkg.name !== "riwaq" || pkg.main !== "electron/main.mjs")
    throw new Error("Choose a Riwaq source checkout");
  await access(join(root, "node_modules/vite/bin/vite.js"));
  await access(join(root, "electron/main.mjs"));
  return { root, version: pkg.version };
}
export function workspaceRuntime(root) {
  return process.platform === "darwin"
    ? join(
        root,
        "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
      )
    : join(
        root,
        "node_modules/electron/dist",
        process.platform === "win32" ? "electron.exe" : "electron",
      );
}
/** Fixed tasks only. Choosing a checkout explicitly trusts that source code. */
export function workspaceTask(root, task, dataDir, electronPath) {
  const env = {};
  for (const key of [
    "SystemRoot",
    "WINDIR",
    "PATH",
    "Path",
    "TEMP",
    "TMP",
    "LOCALAPPDATA",
    "APPDATA",
    "USERPROFILE",
    "HOME",
    "LANG",
    "DISPLAY",
    "XAUTHORITY",
  ])
    if (process.env[key]) env[key] = process.env[key];
  if (task === "launch")
    return {
      file: electronPath,
      args: [root],
      options: {
        cwd: root,
        env: { ...env, RIWAQ_DATA_DIR: resolve(dataDir) },
        shell: false,
        windowsHide: true,
      },
    };
  const tasks = {
    build: ["node_modules/vite/bin/vite.js", "build"],
    test: ["--test", "tests/*.test.mjs"],
  };
  if (!Object.hasOwn(tasks, task)) throw new Error("Unknown workspace task");
  return {
    file: "node",
    args: tasks[task],
    options: {
      cwd: root,
      env,
      shell: false,
      windowsHide: true,
    },
  };
}
export async function gitStatus(root) {
  // Read only, scoped ownership exception for the checkout selected in the native dialog.
  const run = (args) =>
    new Promise((res, rej) => {
      const proc = spawn(
        "git",
        [
          "-c",
          `safe.directory=${root.replaceAll("\\", "/")}`,
          "-C",
          root,
          ...args,
        ],
        { shell: false, windowsHide: true },
      );
      let out = "";
      proc.stdout.on("data", (b) => {
        if (out.length < 16000) out += b.toString();
      });
      proc.on("error", () => rej(new Error("Git unavailable")));
      proc.on("close", (code) =>
        code === 0 ? res(out.trim()) : rej(new Error("Git status unavailable")),
      );
      const timer = setTimeout(() => proc.kill(), 5000);
      proc.once("close", () => clearTimeout(timer));
    });
  const branch = await run(["branch", "--show-current"]);
  const commit = await run(["rev-parse", "--short", "HEAD"]);
  const changes = await run(["status", "--porcelain"]);
  return { branch: branch || "detached", commit, dirty: !!changes };
}
export function sandboxDirectory(adminData, root) {
  // Stable per-checkout sandbox; never the installed app's data directory.
  return join(
    adminData,
    "sandboxes",
    createHash("sha256").update(root).digest("hex").slice(0, 24),
  );
}
