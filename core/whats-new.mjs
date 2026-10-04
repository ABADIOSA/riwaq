/**
 * "What's new" after an update: the highlights of each release since the
 * one the viewer last saw, shown once, from text shipped inside the app (no
 * network). Versions come from the running app, never a literal in the UI.
 * Browser-safe.
 */

export const WHATS_NEW = [
  {
    version: "0.32.0",
    title: "لقّ مصدرك بسرعة",
    items: [
      "ابحث في المصادر: اكتب اسم فريق الإصدار أو REMUX أو «عربي»، وتنفلتر القائمة فوراً.",
      "فلاتر سريعة: ترجمة أو دبلجة عربية، مخزّن، HDR ودولبي فيجن، رابط مباشر، تورنت، وجنب كل واحد عدده.",
      "في «ترتيب إضافاتي» كل إضافة لها عنوان تقدر تطويه.",
      "ثبات أكثر: «احذف المتوقفة» و«عطّل اللي ما تستجيب» صارت تشتغل فعلاً، وضغطتين سريعتين على «تشغيل» ما عادت تشغّل مشغّلين، وإغلاق البرنامج أثناء المشاهدة ما يطلع رسالة خطأ.",
    ],
  },
  {
    version: "0.31.1",
    title: "المصادر بترتيب إضافاتك فعلاً",
    items: [
      "«ترتيب إضافاتي» صار يحترم ترتيب كل إضافة لمصادرها، يعني إعدادات الفرز اللي ضبطتها في AIOStreams وTorrentio، مثل ستريميو.",
      "بدّل بين «ترتيب رِواق» و«ترتيب إضافاتي» من قائمة المصادر نفسها، بدون بحث جديد.",
      "نسختين من نفس الإضافة ما عادت تختلط مصادرهما.",
      "«بوصلة ذوقك» في اكتشف تبدأ مطويّة وما تذكر الإضافات.",
    ],
  },
  {
    version: "0.31.0",
    title: "المصادر ما تنتظر المتأخر",
    items: [
      "قائمة المصادر تطلع بعد 4 ثوانٍ كحد أقصى إذا وصل مصدر، بدل ما تنتظر الإضافة الأبطأ لين تنتهي مهلتها.",
      "الإضافات المتأخرة تكمل بحثها، ولما ترد يطلع زر «أضفها للقائمة» بدون بحث جديد.",
      "صفوف رِواق من TMDB صار لها أنواع، فتعرف «جلسة اليوم» مزاج كل عمل فيها.",
      "«بوصلة ذوقك» في الرئيسية واكتشف: اختر الأنواع اللي تحبها، وقل «أحببته» أو «لا تقترحه»، وكل اقتراح يقول سببه. على جهازك ولكل ملف شخصي.",
    ],
  },
  {
    version: "0.30.1",
    title: "إضافاتك تحت الفحص",
    items: [
      "صفحة الإضافات ← «افحص الإضافات»: تعرف وش يعمل، ووش بطيء، ووش توقف نهائياً، ووش لا يستجيب الآن، ووش يحتاج Stremio Service، ووش مكرر.",
      "احذف الإضافات المتوقفة بضغطة (مع تأكيد)، وعطّل اللي ما تستجيب لين ترجع.",
      "التشخيص الكامل صار أدق: ما يحسب سطح الفيديو المخفي مشكلة، ويفحص Trakt بمفتاح تطبيقك، ويبيّن الإضافات المحلية والمكررة.",
    ],
  },
  {
    version: "0.30.0",
    title: "تشخيص كامل بضغطة زر",
    items: [
      "الإعدادات ← النظام ← «تشخيص كامل»: يفحص التشفير والتخزين وMPV وسطح الفيديو والشبكة والإضافات والتحديثات، ويجمع آخر الأخطاء.",
      "انسخ التقرير أو احفظه كملف وأرسله؛ ما فيه مفاتيح ولا روابط إضافات ولا كلمات مرور، واسم مستخدم ويندوز مخفي.",
    ],
  },
  {
    version: "0.29.0",
    title: "تعرّف على الجديد بسهولة",
    items: [
      "نافذة «الجديد في رِواق» تطلع مرة وحدة بعد كل تحديث، وتلقاها دائماً في الإعدادات ← التحديثات.",
      "اضغط «?» في أي مكان وتطلع لك اختصارات لوحة المفاتيح، ومنها اختصارات المشاهدة اللي خصصتها.",
      "البحث في الإعدادات يقول لك إذا ما لقى شي، ويقترح كلمات تجرّبها.",
    ],
  },
  {
    version: "0.28.1",
    title: "كل أزرار الإعدادات تشتغل",
    items: [
      "انحناء البطاقات ونمط الزوايا وتدرّج اللون ونمط الشعار ولونه صارت تطبّق في واجهة رِواق.",
      "«جلسة اليوم» بصيغ جمع عربية صحيحة، وحرف العمل بدل إطار فاضي.",
    ],
  },
  {
    version: "0.28.0",
    title: "«اكتشف» بتصنيف رِواق",
    items: [
      "أقسام: أفلام، مسلسلات، عربي، حول العالم، أنمي، للعائلة، وثائقي.",
      "دراما خليجية ومصرية وشامية، تركي وكوري وهندي، كلاسيكيات وأعلى تقييماً.",
      "ولا إضافة تُذكر: كتالوجاتها تنضم لأقسامها بدون أسماء.",
    ],
  },
  {
    version: "0.27.0",
    title: "الحلقة التالية جاهزة",
    items: [
      "مصادر الحلقة التالية تتجهّز قبل نهاية الحالية، فيبدأ التشغيل التلقائي فوراً.",
      "توقف التخطي التلقائي للمقدمة في مسلسل تحب مقدمته.",
      "واجهة رِواق الجديدة و«جلسة اليوم» على قد وقتك ومزاجك.",
    ],
  },
  {
    version: "0.26.0",
    title: "رِواق يتذكّر مسلسلاتك",
    items: [
      "الحلقة التالية تبدأ بنفس المصدر وفريق الإصدار.",
      "نفس لغة الصوت والترجمة اللي اخترتها.",
      "خطوة تقديم موحّدة، وخطوة طويلة مع Shift.",
    ],
  },
];

const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,6}$/;

/** -1, 0 or 1, comparing dotted numeric versions. */
export function compareVersions(a = "", b = "") {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** A stored "seen" version, or "" when it is not one. */
export function cleanSeenVersion(value) {
  return typeof value === "string" && VERSION.test(value) ? value : "";
}

/**
 * The releases a viewer has not seen: newer than `seen`, not newer than the
 * running `current`, newest first, at most `limit`.
 */
export function unseenNotes({ seen, current, list = WHATS_NEW, limit = 4 }) {
  if (!VERSION.test(current || "")) return [];
  return list
    .filter(
      (n) =>
        compareVersions(n.version, current) <= 0 &&
        (!seen || compareVersions(n.version, seen) > 0),
    )
    .sort((a, b) => compareVersions(b.version, a.version))
    .slice(0, limit);
}

/**
 * The version the viewer last saw. A profile from before this feature has
 * no record, yet has used Riwaq (titles, progress or addons): it last saw
 * the release before the feature. A fresh install has seen everything.
 */
export function lastSeen({ seenVersion, used = false, current }) {
  const seen = cleanSeenVersion(seenVersion);
  if (seen) return seen;
  return used ? "0.28.1" : current || "";
}

/** Whether to open "what's new" on start. */
export function shouldShowWhatsNew({ seenVersion, used, current }) {
  const seen = lastSeen({ seenVersion, used, current });
  return (
    !!seen &&
    compareVersions(current, seen) > 0 &&
    unseenNotes({ seen, current }).length > 0
  );
}
