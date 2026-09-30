/**
 * The player's layout (Harbor's Player layout page): which HUD controls show.
 * A preset names a set of hidden controls; "custom" uses the viewer's own.
 * Play/pause, the timeline and stop always stay. Pure.
 */

export const HUD_CONTROLS = [
  ["title", "العنوان والحلقة"],
  ["episodes", "الحلقة السابقة والتالية"],
  ["seek", "الرجوع والتقديم"],
  ["volume", "مستوى الصوت"],
  ["ends", "وقت الانتهاء"],
  ["subs", "الترجمة والصوت"],
  ["settings", "إعدادات المشغل"],
  ["pip", "المشغل المصغر"],
  ["fullscreen", "ملء الشاشة"],
];
export const HUD_PRESETS = {
  full: [],
  minimal: ["seek", "volume", "ends", "pip"],
  cinema: ["title", "episodes", "seek", "volume", "ends", "settings", "pip"],
};
const IDS = HUD_CONTROLS.map(([id]) => id);

/** The viewer's own hidden list, validated. */
export const cleanHudHidden = (value) =>
  Array.isArray(value)
    ? [...new Set(value.filter((id) => IDS.includes(id)))]
    : [];

/** The controls hidden for these settings. */
export function hudHidden(settings = {}) {
  const layout = settings.hudLayout || "full";
  if (layout === "custom") return new Set(cleanHudHidden(settings.hudHidden));
  return new Set(HUD_PRESETS[layout] || []);
}
