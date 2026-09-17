export const api = window.riwaq;
export const call = (method, args) =>
  api
    ? api.call(method, args)
    : Promise.reject(new Error("افتح نسخة رِواق لسطح المكتب لتشغيل الميزات"));
