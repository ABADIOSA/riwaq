import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import { readFileSync, writeFileSync, mkdirSync, accessSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { AdminGithub } from "./github.mjs";
import {
  inspectWorkspace,
  workspaceTask,
  gitStatus,
  sandboxDirectory,
  workspaceRuntime,
} from "./workspace.mjs";
import { announcementLink } from "../core/announcements.mjs";

app.setName("Riwaq Admin");
app.setPath(
  "userData",
  process.env.RIWAQ_ADMIN_DATA_DIR ||
    join(app.getPath("appData"), "Riwaq Admin"),
);
const data = app.getPath("userData");
mkdirSync(data, { recursive: true });
const stateFile = join(data, "draft.json");
let draft = {};
try {
  draft = JSON.parse(readFileSync(stateFile, "utf8"));
} catch {}
let win,
  workspace = null,
  child = null,
  taskName = "",
  preparing = false,
  jobId = 0,
  log = "";
const github = new AdminGithub();
const home = fileURLToPath(new URL("./", import.meta.url));
const page = pathToFileURL(join(home, "index.html")).href;
const state = () => ({
  connected: !!github.token,
  draft,
  workspace,
  task: taskName || (preparing ? "preparing" : ""),
  jobId,
  log,
});
function append(value) {
  log = (log + value).slice(-24000);
  if (win && !win.isDestroyed())
    win.webContents.send("admin-log", { log, task: taskName });
}
const actions = {
  state,
  connect: async ({ token }) => {
    await github.connect(token);
    return state();
  },
  disconnect: () => {
    github.disconnect();
    return state();
  },
  draft: (value) => {
    // Only draft text is persisted; never persist tokens or IPC argument bags.
    draft = Object.fromEntries(
      [
        "arTitle",
        "arBody",
        "enTitle",
        "enBody",
        "platform",
        "minVersion",
        "maxVersion",
        "days",
        "link",
      ].map((k) => [k, String(value?.[k] || "").slice(0, 3000)]),
    );
    github.previewed = null;
    writeFileSync(stateFile, JSON.stringify(draft), { mode: 0o600 });
    return state();
  },
  preview: (value) => github.preview(value),
  publish: async ({ nonce }) => {
    if (!github.previewed || github.previewed.nonce !== nonce)
      throw new Error("Preview again before publishing");
    const { response } = await dialog.showMessageBox(win, {
      type: "question",
      title: "نشر إشعار رِواق",
      message: github.previewed.item.ar.title,
      detail:
        "سينشر للجمهور المحدد في المعاينة. سيصل عند فتح التطبيق أو تحديث صندوق الإشعارات.",
      buttons: ["إلغاء", "نشر الإشعار"],
      defaultId: 0,
      cancelId: 0,
    });
    if (response !== 1) return { published: false };
    return github.publish(nonce);
  },
  chooseWorkspace: () =>
    exclusiveWorkspace(async () => {
      const selected = await dialog.showOpenDialog(win, {
        title: "اختر مجلد مصدر رِواق المثبتة اعتمادياته",
        properties: ["openDirectory"],
      });
      if (!selected.canceled) {
        const next = await inspectWorkspace(selected.filePaths[0]);
        workspace = { ...next, ...(await gitStatus(next.root)) };
      }
      return state();
    }),
  task: ({ id }) =>
    exclusiveWorkspace(async () => {
      if (!workspace || child)
        throw new Error("Choose a checkout and finish the running task first");
      jobId++;
      log = "";
      workspace = {
        ...(await inspectWorkspace(workspace.root)),
        ...(await gitStatus(workspace.root)),
      };
      const sandbox = sandboxDirectory(data, workspace.root);
      mkdirSync(sandbox, { recursive: true });
      if (id === "launch") accessSync(join(workspace.root, "dist/index.html"));
      const command = workspaceTask(
        workspace.root,
        id,
        sandbox,
        workspaceRuntime(workspace.root),
      );
      if (id === "launch") command.options.stdio = "ignore";
      taskName = id;
      log = "";
      const proc = spawn(command.file, command.args, command.options);
      child = proc;
      proc.stdout?.on("data", (b) => append(b.toString()));
      proc.stderr?.on("data", (b) => append(b.toString()));
      proc.on("error", () => append("Task failed to start\n"));
      proc.on("close", (code) => {
        if (child === proc) {
          child = null;
          taskName = "";
          append(`\nExit: ${code}\n`);
        }
      });
      return state();
    }),
  stopTask: () => {
    if (taskName === "launch") throw new Error("Close the test app window");
    child?.kill();
    return state();
  },
  releases: () => github.releases(),
  open: async ({ id, tag }) => {
    if (id === "source" && workspace) {
      const error = await shell.openPath(workspace.root);
      if (error) throw new Error("Could not open source folder");
      return;
    }
    const links = {
      repo: "https://github.com/ABADIOSA/riwaq/",
      reviews: "https://github.com/ABADIOSA/riwaq/pulls",
      token: "https://github.com/settings/personal-access-tokens/new",
      release: `https://github.com/ABADIOSA/riwaq/releases/tag/${encodeURIComponent(String(tag || ""))}`,
    };
    if (!links[id]) throw new Error("Unknown destination");
    const url = id === "token" ? links[id] : announcementLink(links[id]);
    await shell.openExternal(url);
  },
};
async function exclusiveWorkspace(fn) {
  if (preparing || child) throw new Error("Stop the current task first");
  preparing = true;
  try {
    await fn();
  } finally {
    preparing = false;
  }
  return state();
}
app
  .whenReady()
  .then(async () => {
    win = new BrowserWindow({
      width: 1200,
      height: 850,
      minWidth: 900,
      minHeight: 680,
      title: "رِواق — الاستوديو الإداري",
      backgroundColor: "#10131b",
      webPreferences: {
        preload: join(home, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event) => event.preventDefault());
    win.webContents.session.setPermissionRequestHandler((_c, _p, cb) =>
      cb(false),
    );
    ipcMain.handle("riwaq-admin", async (event, method, args) => {
      if (
        win.isDestroyed() ||
        event.sender !== win.webContents ||
        event.senderFrame !== win.webContents.mainFrame ||
        event.senderFrame.url !== page ||
        !Object.hasOwn(actions, method)
      )
        return { ok: false, error: "الطلب غير مسموح" };
      try {
        return { ok: true, value: await actions[method](args) };
      } catch (error) {
        const code = /HTTP (\d{3})/.exec(error.message)?.[1];
        return {
          ok: false,
          error:
            code === "409"
              ? "تغير ملف الإشعارات، عاين المسودة مجددًا."
              : code === "401" || code === "403"
                ? "تحقق من صلاحية GitHub والرمز."
                : "تعذر الإجراء. تحقق من الاتصال والصلاحية والمصدر ثم أعد المعاينة.",
        };
      }
    });
    await win.loadFile(join(home, "index.html"));
  })
  .catch(() => {
    dialog.showErrorBox("Riwaq Admin", "تعذر بدء الاستوديو الإداري.");
    app.exit(1);
  });
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  if (taskName !== "launch") child?.kill();
  else child?.unref();
  github.token = "";
});
