/**
 * The bridge methods the web edition cannot answer, each with the sentence
 * the viewer sees. Everything else in electron/preload.cjs's allowlist is
 * implemented by web/bridge.js; tests/web-parity.test.mjs fails when a new
 * method is added to the desktop without a decision here or there.
 */
const DESKTOP = "تحتاج نسخة رِواق لسطح المكتب";
// The owner's GitHub token is sealed by Windows on a chosen device only.
const OWNER =
  "أدوات المالك تعمل في نسخة رِواق لسطح المكتب على الأجهزة اللي يختارها المالك.";
export const DESKTOP_ONLY = {
  playbackMenu:
    "قائمة المشغل الإضافية متاحة في تطبيق ويندوز؛ استخدم أدوات المشغل الظاهرة هنا.",
  offlineList: "التنزيل والمشاهدة دون إنترنت متاحان في تطبيق ويندوز.",
  offlineCancel: "التنزيل والمشاهدة دون إنترنت متاحان في تطبيق ويندوز.",
  offlineRemove: "التنزيل والمشاهدة دون إنترنت متاحان في تطبيق ويندوز.",
  offlinePlay: "التنزيل والمشاهدة دون إنترنت متاحان في تطبيق ويندوز.",
  choosePlayer: `اختيار MPV ${DESKTOP}؛ الموقع يشغّل الفيديو بمشغّل المتصفح.`,
  chooseShader: `مرشّحات GLSL تعمل داخل MPV و${DESKTOP}.`,
  chooseShaderFolder: `مرشّحات GLSL تعمل داخل MPV و${DESKTOP}.`,
  shaderLibrary: `مرشّحات GLSL تعمل داخل MPV و${DESKTOP}.`,
  shaderDownload: `مرشّحات GLSL تعمل داخل MPV و${DESKTOP}.`,
  shaderRemove: `مرشّحات GLSL تعمل داخل MPV و${DESKTOP}.`,
  audioDevices: `اختيار جهاز إخراج الصوت ${DESKTOP}؛ المتصفح يستخدم جهاز النظام.`,
  nuvioScan: `قراءة بيانات نوفيو من جهازك ${DESKTOP}. استخدم ملف النسخة الاحتياطية من نوفيو بدلاً منها.`,
  presenceSave: `حالة Discord تتصل بتطبيق Discord على جهازك و${DESKTOP}.`,
  torrentEngineClear: `المحرك المدمج للتورنت يعمل داخل ${DESKTOP}؛ الموقع يستخدم Stremio Service.`,
  ownerState: OWNER,
  ownerOpen: OWNER,
  ownerActivate: OWNER,
  ownerForget: OWNER,
  ownerPreview: OWNER,
  ownerPublish: OWNER,
  ownerTokenPage: OWNER,
};
