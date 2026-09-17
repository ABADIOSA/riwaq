const { contextBridge, ipcRenderer } = require("electron");
const allowed = new Set([
  "init",
  "catalog",
  "metadata",
  "streams",
  "subtitles",
  "install",
  "updateAddon",
  "settings",
  "favorite",
  "login",
  "cancelLogin",
  "logout",
  "sync",
  "configure",
  "play",
  "videoBounds",
  "providerSave",
  "providerTest",
  "integrationSave",
  "integrationSync",
  "integrationDisconnect",
  "traktLogin",
  "traktPoll",
  "letterboxdImport",
  "openService",
  "playerCommand",
  "stop",
  "subtitle",
  "localSubtitle",
  "localVideo",
  "choosePlayer",
  "diagnostics",
  "exportAddons",
  "importAddons",
  "profileCreate",
  "profileUpdate",
  "profileRemove",
  "profileSwitch",
  "profilePin",
  "profileUnlock",
  "profileLock",
  "setHotkey",
  "resetHotkeys",
  "notifySave",
  "notifyTest",
  "presenceSave",
  "liveAdd",
  "liveUpdate",
  "liveRefresh",
  "liveChannels",
  "liveGuide",
  "liveFavorite",
  "playChannel",
  "openScreenshots",
  "chooseShader",
]);
contextBridge.exposeInMainWorld("riwaq", {
  call: async (method, args) => {
    if (!allowed.has(method)) throw new Error("Unknown action");
    const r = await ipcRenderer.invoke("riwaq", method, args);
    if (!r.ok) throw new Error(r.error);
    return r.value;
  },
  on: (name, fn) => {
    if (!["state", "player", "notice", "ended", "playerRequest"].includes(name))
      return () => {};
    const handler = (_event, data) => fn(data);
    ipcRenderer.on("riwaq:" + name, handler);
    return () => ipcRenderer.removeListener("riwaq:" + name, handler);
  },
});
