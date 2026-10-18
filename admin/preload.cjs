const { contextBridge, ipcRenderer } = require("electron");
const methods = new Set([
  "state",
  "connect",
  "disconnect",
  "draft",
  "preview",
  "publish",
  "chooseWorkspace",
  "task",
  "stopTask",
  "releases",
  "downloadStats",
  "metricsConnect",
  "metricsDisconnect",
  "usageStats",
  "open",
]);
contextBridge.exposeInMainWorld("riwaqAdmin", {
  call: async (method, args) => {
    if (!methods.has(method)) throw new Error("Unknown admin action");
    const result = await ipcRenderer.invoke("riwaq-admin", method, args);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  },
  onLog: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("admin-log", listener);
    return () => ipcRenderer.removeListener("admin-log", listener);
  },
});
