import { recordError } from "./diagnostics.js";

export const api = window.riwaq;

export const call = (method, args) =>
  api
    ? api.call(method, args).catch((error) => {
        // Kept for the diagnostic report; the caller still handles it.
        recordError(`call:${method}`, error);
        throw error;
      })
    : Promise.reject(new Error("افتح نسخة رِواق لسطح المكتب لتشغيل الميزات"));
