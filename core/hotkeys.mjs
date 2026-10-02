/**
 * Playback hotkeys.
 *
 * Riwaq owns the key map rather than leaving it to MPV defaults, so a viewer
 * can rebind everything and so the same action name drives both the MPV
 * input.conf and the on-screen controls. MPV runs with --no-config and
 * --load-scripts=no, which means this file is the entire keyboard surface.
 */

export const HOTKEY_ACTIONS = [
  {
    id: "playPause",
    label: "تشغيل / إيقاف مؤقت",
    command: "cycle pause",
    binding: "SPACE",
  },
  {
    id: "seekBack",
    label: "رجوع قصير",
    command: "script-message riwaq-seek back",
    binding: "LEFT",
  },
  {
    id: "seekForward",
    label: "تقديم قصير",
    command: "script-message riwaq-seek forward",
    binding: "RIGHT",
  },
  {
    id: "seekBackLong",
    label: "رجوع طويل",
    command: "script-message riwaq-seek backLong",
    binding: "Shift+LEFT",
  },
  {
    id: "seekForwardLong",
    label: "تقديم طويل",
    command: "script-message riwaq-seek forwardLong",
    binding: "Shift+RIGHT",
  },
  {
    id: "frameBack",
    label: "إطار للخلف",
    command: "frame-back-step",
    binding: ",",
  },
  {
    id: "frameForward",
    label: "إطار للأمام",
    command: "frame-step",
    binding: ".",
  },
  {
    id: "volumeUp",
    label: "رفع الصوت",
    command: "add volume 5",
    binding: "UP",
  },
  {
    id: "volumeDown",
    label: "خفض الصوت",
    command: "add volume -5",
    binding: "DOWN",
  },
  { id: "mute", label: "كتم الصوت", command: "cycle mute", binding: "m" },
  {
    id: "speedUp",
    label: "تسريع",
    command: "multiply speed 1.1",
    binding: "]",
  },
  {
    id: "speedDown",
    label: "إبطاء",
    command: "multiply speed 0.9",
    binding: "[",
  },
  {
    id: "speedReset",
    label: "سرعة طبيعية",
    command: "set speed 1.0",
    binding: "BS",
  },
  {
    id: "subtitleCycle",
    label: "تبديل الترجمة",
    command: "cycle sub",
    binding: "j",
  },
  {
    id: "subtitleToggle",
    label: "إظهار/إخفاء الترجمة",
    command: "cycle sub-visibility",
    binding: "v",
  },
  {
    id: "subtitleDelayUp",
    label: "تأخير الترجمة +",
    command: "add sub-delay 0.1",
    binding: "z",
  },
  {
    id: "subtitleDelayDown",
    label: "تأخير الترجمة −",
    command: "add sub-delay -0.1",
    binding: "Shift+z",
  },
  {
    id: "audioCycle",
    label: "تبديل مسار الصوت",
    command: "cycle audio",
    binding: "#",
  },
  {
    id: "audioDelayUp",
    label: "تأخير الصوت +",
    command: "add audio-delay 0.1",
    binding: "k",
  },
  {
    id: "audioDelayDown",
    label: "تأخير الصوت −",
    command: "add audio-delay -0.1",
    binding: "Shift+k",
  },
  {
    id: "screenshot",
    label: "التقاط صورة",
    command: "script-message riwaq-screenshot",
    binding: "s",
  },
  {
    id: "stats",
    label: "إحصائيات التشغيل",
    command: "script-message riwaq-stats",
    binding: "i",
  },
  {
    id: "fullscreen",
    label: "ملء الشاشة",
    command: "script-message riwaq-fullscreen",
    binding: "f",
  },
  {
    id: "miniPlayer",
    label: "المشغّل المصغّر",
    command: "script-message riwaq-mini",
    binding: "p",
  },
  {
    id: "skipSegment",
    label: "تخطي المقدمة أو الخاتمة",
    command: "script-message riwaq-skip",
    binding: "TAB",
  },
  {
    id: "prevEpisode",
    label: "الحلقة السابقة",
    command: "script-message riwaq-prev",
    binding: "<",
  },
  {
    id: "nextEpisode",
    label: "الحلقة التالية",
    command: "script-message riwaq-next",
    binding: ">",
  },
  {
    id: "loopPoint",
    label: "نقطة تكرار A/B",
    command: "script-message riwaq-loop",
    binding: "l",
  },
  {
    id: "shaderCycle",
    label: "تبديل مرشّح الصورة",
    command: "script-message riwaq-shader",
    binding: "u",
  },
  {
    id: "panel",
    label: "لوحة الترجمة والصوت",
    command: "script-message riwaq-panel",
    binding: "c",
  },
  {
    id: "close",
    label: "الخروج من ملء الشاشة أو إغلاق المشغّل",
    command: "script-message riwaq-stop",
    binding: "ESC",
  },
];

/**
 * Seconds a seek key moves, from the viewer's settings at the moment of the
 * press. The arrow keys ask main through a script message instead of carrying
 * a fixed "seek 10", so the keyboard, the on-screen buttons and the HUD all
 * use the same step, and a changed step applies without restarting MPV.
 */
export const SEEK_DIRECTIONS = ["back", "forward", "backLong", "forwardLong"];
export function seekAmount(direction, settings = {}) {
  if (!SEEK_DIRECTIONS.includes(direction)) return 0;
  const long = direction.endsWith("Long");
  const step = Number(long ? settings.seekLongStep : settings.seekStep);
  const fallback = long ? 60 : 10;
  const seconds =
    Number.isFinite(step) && step > 0 && step <= 600 ? step : fallback;
  return direction.startsWith("back") ? -seconds : seconds;
}

// MPV accepts these verbatim; anything else risks an input.conf that silently
// fails to parse and leaves the viewer with no keyboard at all.
const MODIFIER = /^(Ctrl|Alt|Shift|Meta)$/;
const NAMED_KEY =
  /^(SPACE|ESC|ENTER|TAB|BS|DEL|INS|HOME|END|PGUP|PGDWN|UP|DOWN|LEFT|RIGHT|F([1-9]|1[0-2])|MBTN_(LEFT|RIGHT|MID)(_DBL)?|WHEEL_(UP|DOWN))$/;

export function validBinding(value) {
  if (typeof value !== "string" || !value || value.length > 40) return false;
  const parts = value.split("+");
  const key = parts.pop();
  if (!parts.every((part) => MODIFIER.test(part))) return false;
  return NAMED_KEY.test(key) || /^[\x21-\x7e]$/.test(key);
}

/** Bindings a viewer has changed, merged over the defaults and validated. */
export function resolveBindings(custom = {}) {
  const bindings = {};
  for (const action of HOTKEY_ACTIONS) {
    const override = custom[action.id];
    bindings[action.id] = validBinding(override) ? override : action.binding;
  }
  return bindings;
}

/** Actions sharing a key, so the settings view can show the clash. */
export function findConflicts(bindings) {
  const byKey = new Map();
  for (const [id, binding] of Object.entries(bindings)) {
    if (!byKey.has(binding)) byKey.set(binding, []);
    byKey.get(binding).push(id);
  }
  return [...byKey.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([binding, ids]) => ({ binding, actions: ids }));
}

/**
 * Renders the MPV input.conf. Later lines win in MPV, so a conflicting binding
 * resolves to the last action rather than breaking the file.
 */
export function inputConf(custom = {}) {
  const bindings = resolveBindings(custom);
  const lines = [
    "# Generated by Riwaq. Edits here are replaced on the next launch.",
  ];
  for (const action of HOTKEY_ACTIONS)
    lines.push(`${bindings[action.id]} ${action.command}`);
  // The double click to fullscreen is not rebindable: it is a pointer gesture.
  lines.push("MBTN_LEFT_DBL script-message riwaq-fullscreen");
  // A right click opens the subtitle and audio panel beside the picture.
  lines.push("MBTN_RIGHT script-message riwaq-panel");
  return lines.join("\n") + "\n";
}

export function publicHotkeys(custom = {}) {
  const bindings = resolveBindings(custom);
  const conflicts = findConflicts(bindings);
  return HOTKEY_ACTIONS.map((action) => ({
    id: action.id,
    label: action.label,
    binding: bindings[action.id],
    isDefault: bindings[action.id] === action.binding,
    conflict: conflicts.some((entry) => entry.actions.includes(action.id)),
  }));
}
