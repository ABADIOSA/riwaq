/**
 * English for the 0.56.0 final release blockers (Codex's final acceptance,
 * 2026-11-21): the Live TV favourites limit (core/live-hub.mjs) and the
 * subtitle download's authorization (core/subtitle-export.mjs,
 * electron/subtitle-save.mjs). Keyed by the Arabic the code shows.
 */
export default {
  "بلغت القنوات المفضلة حدها ({n})؛ أزل قناة لتضيف أخرى":
    "Your favourite channels have reached the limit ({n}); remove one to add another",
  "مصدر الترجمة يشير إلى عنوان على شبكتك، فلم تُحفظ":
    "The subtitle source points to an address on your network, so it was not saved",
  // Singular since 0.57 (#157): one subtitle is saved at a time.
  "الإضافة التي جاءت منها هذه الترجمة لم تعد مثبتة":
    "The addon this subtitle came from is no longer installed",
  "انتهت المشاهدة التي طُلبت منها الترجمة؛ لم تُحفظ":
    "The viewing this subtitle was requested from has ended; nothing was saved",
};
