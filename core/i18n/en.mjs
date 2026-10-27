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
import onboarding from "./en/onboarding.mjs";
import downloadsQuality from "./en/downloads-quality.mjs";
import quality110 from "./en/quality110.mjs";

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
  ...onboarding,
  ...downloadsQuality,
  ...quality110,
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
  "تنزيل المصدر دون تشغيل": "Download this source without playing",
  "بدأ التنزيل؛ يمكنك إغلاق المشغل ومتابعته من التنزيلات.":
    "Download started. You can close the player and follow it in Downloads.",
  "جاري تحميل المعاينة": "Loading preview",
  "المعاينة غير متاحة": "Preview unavailable",
  "معاينة المشهد": "Scene preview",
  "الترجمة (C أو الزر الأيمن)": "Subtitles (C or right click)",
  "الترجمة (C)": "Subtitles (C)",
  "متوقف مؤقتاً · يمكن استئنافه": "Paused · resumable",
  "نزّل مباشرة من قائمة المصادر أو أثناء المشاهدة. يستمر التنزيل بعد إغلاق المشغل؛ عند إغلاق التطبيق يتوقف ويمكن استئنافه من هنا. إذا لم يدعم المصدر الاستئناف الآمن يبدأ من جديد.":
    "Download from the source list or while watching. Downloads continue after closing the player. Closing the app pauses them; resume here afterwards. Sources without safe range support restart from the beginning.",
  "استئناف التنزيل": "Resume download",
  "ملاءمة الصورة: {1}": "Picture fit: {1}",
  "تمديد الصورة": "Stretch",
  "قص الأطراف": "Crop",
  "ملاءمة الشاشة": "Fit",
  "إظهار جلسة اليوم": "Show today's session",
  "عند إخفائها تبدأ الرئيسية مباشرة بصفوف الأفلام والمسلسلات.":
    "When hidden, Home opens directly with movie and series rows.",
  "إحصاءات الاستخدام الاختيارية": "Optional usage statistics",
  "ساعدنا في معرفة عدد الأجهزة النشطة. نرسل معرّفاً عشوائياً لهذا الجهاز، إصدار التطبيق ونوعه فقط؛ لا نرسل اسمك أو حسابك أو سجل المشاهدة أو روابط المصادر. تبقى المشاركة معطلة حتى تختارها، ولا تنتقل الموافقة مع النسخ الاحتياطية أو حساب رِواق.":
    "Help us measure active devices. Only a random device identifier, app version and platform are sent, never your name, account, viewing history or source URLs. Sharing is off until you choose it; consent is excluded from backups and account sync.",
  "يرسل التطبيق نبضة كل دقيقتين أثناء الاستخدام. تُحذف البيانات القديمة خلال 32 يوماً؛ إيقاف المشاركة يطلب حذف بيانات الجهاز، وإذا تعذر الاتصال تنتهي تلقائياً. قد يعالج مزوّد الاستضافة عنوان الشبكة لتقديم الخدمة والحماية.":
    "The app sends a pulse every two minutes while in use. Old records expire within 32 days. Turning sharing off requests deletion; if offline, records expire automatically. The hosting provider may process network addresses to deliver and protect the service.",
  "إيقاف المشاركة وحذف بيانات الجهاز":
    "Stop sharing and request device data deletion",
  "المشاركة بإحصاءات الاستخدام": "Share usage statistics",
  "ملف التنزيل غير صالح": "Invalid download file",
  "تغيّر ملف المصدر؛ أعد التنزيل من البداية":
    "The source file changed. Restart this download.",
  "اختر المصدر مجدداً لبدء تنزيل جديد":
    "Select the source again to start a new download",
  "التنزيل غير قابل للاستئناف": "This download cannot be resumed",
  "التنزيل متاح في تطبيق ويندوز.":
    "Downloads are available in the Windows app.",
};
