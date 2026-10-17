/**
 * English for Riwaq's interface, keyed by the Arabic text the code shows
 * (core/i18n.mjs). `{name}` marks a part filled in at run time. Each area
 * keeps its own file under en/, built from scripts/i18n-strings.mjs.
 */
import core from "./en/core.mjs";
import library from "./en/library.mjs";
import settings from "./en/settings.mjs";
import settingsPlayer from "./en/settings-player.mjs";
import settingsContent from "./en/settings-content.mjs";
import settingsMore from "./en/settings-more.mjs";
import sentences from "./en/sentences.mjs";
import mainMessages from "./en/main.mjs";
import messages from "./en/messages.mjs";
import torrents from "./en/torrents.mjs";
import shell from "./en/shell.mjs";
import title from "./en/title.mjs";
import announcements from "./en/announcements.mjs";
import review083 from "./en/review083.mjs";
import owner from "./en/owner.mjs";
import engine046 from "./en/engine046.mjs";
import feedback094 from "./en/feedback094.mjs";

export default {
  ...core,
  ...library,
  ...settings,
  ...settingsPlayer,
  ...settingsContent,
  ...settingsMore,
  ...sentences,
  ...mainMessages,
  ...messages,
  ...torrents,
  ...shell,
  ...title,
  ...announcements,
  ...review083,
  ...owner,
  ...engine046,
  ...feedback094,
  الإعدادات: "Settings",
  "فلاتر الكتالوج": "Catalog filters",
  "كتالوج الإضافة": "Addon catalog",
  "تتبّع الأنمي اختياري عند إكمال الحلقة، واستيراد قوائم المشاهدة والتخطيط والتوقف والمتروك والإعادة والمكتمل من AniList.":
    "Optional anime progress tracking after a finished episode, and import of current, planned, paused, dropped, repeating and completed AniList lists.",
  "استيراد قوائم الأفلام والمسلسلات والأنمي من Simkl حسب حالة المشاهدة، مع تتبّع تشغيل اختياري.":
    "Import Simkl movie, show and anime lists by watch status, with optional playback tracking.",
  "تتبّع التشغيل في Simkl": "Track playback on Simkl",
  "يرسل بدء التشغيل والتوقف المؤقت والإيقاف إلى Simkl، ويسجّل المشاهدة عند الإيقاف بعد 80%. لا يُرسل شيء حتى تفعّل هذا الخيار.":
    "Send start, pause and stop to Simkl, marking watched when stopped after 80%. Nothing is sent until you enable this option.",
  "بانتظار الإرسال:": "Pending:",
  "AniList · متروك": "AniList · Dropped",
  "AniList · إعادة المشاهدة": "AniList · Repeating",
  "تعذّر إرسال التتبع إلى Simkl؛ جرّب المزامنة لاحقاً.":
    "Could not send tracking to Simkl; try syncing later.",
  أشاهده: "Watching",
  "أريد مشاهدته": "Plan to watch",
  متروك: "Dropped",
  "استجابة مكتبة Simkl غير صالحة": "Invalid Simkl library response",
  "استجابة مكتبة AniList غير صالحة": "Invalid AniList library response",
  "لا توجد حلقة بهذا الرقم في الموسم المحدد.":
    "No episode with this number in the selected season.",
  "هذه الحلقة لم تصدر بعد.": "This episode has not been released yet.",
  "رقم الحلقة": "Episode number",
  "انتقل للحلقة": "Go to episode",
  "تفاصيل الحلقة المختارة": "Selected episode details",
  "لا يتوفر وصف لهذه الحلقة.": "No description is available for this episode.",
  "نسبة الأبعاد": "Aspect ratio",
};
