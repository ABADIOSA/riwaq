/**
 * "What's new" after an update: the highlights of each release since the
 * one the viewer last saw, shown once, from text shipped inside the app (no
 * network). Versions come from the running app, never a literal in the UI.
 * Browser-safe.
 */

export const WHATS_NEW = [
  {
    version: "0.46.1",
    title: "أزرار المشغّل تستجيب للنقر",
    items: [
      "أزرار أدوات المشغّل صارت تستجيب: نافذتها كانت ما تقبل التركيز، فيرمي ويندوز ضغطة الفأرة وتطلع التلميحات بدون نقرة. الحين توصلها النقرة كاملة.",
      "اختصاراتك كلها تشتغل من أدوات المشغّل، حتى اللي غيّرتها بنفسك. وEsc يقفل اللوحة أول، وF8 يستعيد الأدوات حتى لو علّقت.",
      "بعد ما تغيّر الصوت أو تضغط زر بالفأرة، المسافة توقف الفيديو بدل ما تعيد نفس الزر.",
      "زر Tab صار يتنقّل بين أزرار المشغّل، فالتخطي من زره أو من مفتاح تختاره في الاختصارات.",
    ],
    en: {
      title: "The player buttons respond to clicks",
      items: [
        "The player's buttons respond again: their window could not take focus, so Windows discarded the mouse press and tooltips showed without a click. It now gets the whole click.",
        "All your shortcuts work from the player controls, including the ones you changed. Esc closes the panel first, and F8 recovers the controls even when they froze.",
        "After you change the volume or click a button, Space pauses instead of pressing that button again.",
        "Tab now moves between the player's buttons, so skip with its button or a key you choose in the shortcuts.",
      ],
    },
  },
  {
    version: "0.46.0",
    title: "تورنت يلقى مشاركين أكثر، وTorrServer احتياطياً",
    items: [
      "المحرك المدمج صار يسأل متتبعات عامة إضافية، منها متتبعات HTTPS للشبكات اللي تحجب UDP، ويبدأ شبكة DHT من آخر تشغيل، ويعيد السؤال كل 30 ثانية لما يكون المشاركين قليلين.",
      "«اسمح للمشاركين يتصلون فيك» (مفعّل من البداية) يطلب من الراوتر يفتح منفذ للمحرك، و«افحص الشبكة» يقول لك وش اللي توصله شبكتك. تلقاهم في صفحة محرك P2P.",
      "حزمة موسم كاملة؟ المحرك يشغّل الحلقة اللي سمّتها الإضافة بدل أكبر ملف.",
      "TorrServer احتياطياً: نزّله من صفحة محرك P2P، ولما المحرك المدمج ما يلقى بيانات خلال 40 ثانية يجرّب رِواق نفس التورنت فيه قبل المصدر التالي.",
      "المثبّت يسمح مرة ثانية بالتثبيت لكل مستخدمي الجهاز، بموافقة المسؤول.",
      "أدوات المشغّل ما تعلق: MPV كان يبدأ سحب نافذته لما تضغط على الصورة وتحرك الفأرة شوي، فتنمسك كل النقرات في رِواق. وصار رِواق يشتغل أخف وقت المشاهدة.",
    ],
    en: {
      title: "Torrents that find more peers, and TorrServer as a fallback",
      items: [
        "The built-in engine now also asks public trackers, HTTPS ones included for networks that block UDP, starts the DHT from the last run, and asks again every 30 seconds while there are few peers.",
        "“Let peers connect to you” (on from the start) asks your router to open a port for the engine, and “Check the network” tells you what your network reaches. Both are on the P2P engine page.",
        "A whole season pack? The engine plays the episode the addon names instead of the largest file.",
        "TorrServer as a fallback: download it from the P2P engine page, and when the built-in engine gets no data within 40 seconds, Riwaq tries the same torrent there before the next source.",
        "The installer can install for every user of the PC again, with administrator approval.",
        "The player controls no longer freeze: MPV started dragging its own window when you pressed on the picture and moved the mouse a little, which held every click in Riwaq. Riwaq also does less work while a title plays.",
      ],
    },
  },
  {
    version: "0.45.1",
    title: "قائمة المشغّل ما تعلّق الأزرار",
    items: [
      "قائمة الزر الأيمن في المشغّل صارت جزء من أدوات رِواق نفسها بدل قائمة ويندوز. قائمة ويندوز كانت ممكن تنفتح مخفية وتمسك كل النقرات، فتعلق الأزرار وما تقدر تتحكم بشي.",
      "النقرة اللي تقفل القائمة ما توقف الفيديو، وEsc يقفلها بدون ما يوقف المشاهدة. والقائمة نفسها تنفتح من نقرة يمين على صورة MPV.",
    ],
    en: {
      title: "The player menu no longer freezes the controls",
      items: [
        "The player's right-click menu is now part of Riwaq's own controls instead of a Windows menu, which could open out of sight and hold every click, so no button responded.",
        "The click that closes the menu does not pause, and Esc closes it without stopping the viewing. A right click on MPV's own picture opens the same menu.",
      ],
    },
  },
  {
    version: "0.45.0",
    title: "تنزيلات، قائمة للمشغّل، وإصلاحات من ملاحظاتكم",
    items: [
      "نزّل الفيديو وشاهده بدون إنترنت: من قائمة الزر الأيمن في المشغّل، وتلقاه في زر التنزيلات فوق. يشتغل مع ملفات الفيديو الكاملة والتورنت.",
      "قائمة الزر الأيمن في المشغّل: إيقاف مؤقت، والترجمة والصوت، ولقطة شاشة، ونسخ رابط التورنت، والتنزيل.",
      "الإعدادات تبدأ بالأساسيات (اللغة والترجمة والجودة والتورنت)، والباقي في «إعدادات متقدمة». و«واجهة هادئة» تخفي أزرار الحساب والملفات من التنقل.",
      "إغلاق رِواق أو الإيقاف وقت تجهيز المصدر صار سليم، بدون رسالة خطأ وبدون فيديو يشتغل بعد ما توقفه.",
      "التورنت بالمحرك المدمج يعرض المشاركين والسرعة وقت التجهيز، والتورنت اللي ما يوصل منه شي خلال 40 ثانية ينتقل للمصدر التالي.",
      "شريط الصوت يتحرك مع الفأرة ويمتلي عند 100%، وزر لإزالة عمل من «نكمل الحكاية»، وأسهم الصفوف بجانب «عرض الكل»، والواجهة الإنجليزية بدون عربي في المعرض وفريق العمل.",
    ],
    en: {
      title: "Downloads, a player menu, and fixes from your feedback",
      items: [
        "Download a video and watch it offline: from the player's right-click menu, then from the Downloads button at the top. Complete video files and torrents work.",
        "A right-click menu in the player: pause, subtitles and audio, screenshot, copy the torrent link, and download.",
        "Settings start with the basics (language, subtitles, quality and torrents); the rest is under “Advanced settings”. “Quiet interface” hides the account and profile buttons from the navigation.",
        "Closing Riwaq, or stopping while a source is being prepared, now works cleanly: no error message, and no video starting after you stopped it.",
        "Torrents on the built-in engine show peers and speed while they start, and one that sends nothing within 40 seconds moves on to the next source.",
        "The volume slider follows the mouse and is full at 100%, a button removes a title from “Continue watching”, row arrows sit beside “See all”, and the English interface shows no Arabic in the gallery and credits.",
      ],
    },
  },
  {
    version: "0.44.1",
    title: "إشعارات رِواق من أجهزة المالك",
    items: [
      "صاحب رِواق صار ينشر الإشعارات من التطبيق نفسه على الأجهزة اللي يختارها، بعد ما يتأكد GitHub إنه هو. ما تغيّر شي عندك.",
    ],
    en: {
      title: "Riwaq notices from the owner's devices",
      items: [
        "Riwaq's owner can now publish notices from the app itself on the devices chosen for it, once GitHub confirms the owner's identity. Nothing changes for you.",
      ],
    },
  },
  {
    version: "0.44.0",
    title: "إشعارات رِواق، وأدوات تحكم أثبت",
    items: [
      "جرس إشعارات في الشريط العلوي: أخبار رِواق وتنبيهات الفريق بالعربي والإنجليزي، وتقدر توقف الاستقبال من نفس النافذة.",
      "أدوات التحكم ترجع لو انعاد تحميلها أو علّقت، وأدوات MPV تشتغل احتياطاً لين ترجع. والمشاهدة ما تبدأ بقفزة في الصورة.",
      "F8 يستعيد أدوات التحكم: داخل رِواق يعيد تحميلها، ومع «HDR حقيقي» يكمل المشاهدة داخل رِواق من نفس اللحظة.",
      "Esc يغلق نافذة «HDR حقيقي» دائماً، وإغلاق محرك التورنت ما يعلّق، و«تشخيص كامل» صار يفحص أدوات التحكم.",
    ],
    en: {
      title: "Riwaq notifications, and steadier player controls",
      items: [
        "A notification bell in the top bar: Riwaq news and team notices in Arabic and English, with reception switchable from the same window.",
        "The controls come back after a reload or a freeze, with MPV's controls standing in until they do, and a viewing no longer starts with the picture jumping.",
        "F8 restores the controls: inside Riwaq it reloads them; with “True HDR” it continues the viewing inside Riwaq from the same moment.",
        "Esc always closes the “True HDR” window, the torrent engine no longer hangs when it shuts down, and the full diagnostic now checks the player controls.",
      ],
    },
  },
  {
    version: "0.43.1",
    title: "HDR حقيقي، وأدوات رِواق فوقه",
    items: [
      "مع «HDR حقيقي»، المصادر بـ HDR أو Dolby Vision تفتح في نافذة MPV الخاصة، وأدوات تحكم رِواق صارت فوقها بدل أدوات MPV.",
      "التشغيل والتقديم والترجمة والصوت وتخطي المقدمة ومعاينة الشريط كلها نفس اللي داخل رِواق. وEsc يرجعك.",
      "إذا تعذّر وضع أدوات رِواق فوق النافذة، ترجع أدوات MPV احتياطاً، فما تبقى بدون تحكم أبداً.",
    ],
    en: {
      title: "True HDR, with Riwaq's controls over it",
      items: [
        "With “True HDR”, HDR and Dolby Vision sources open in MPV's own window, and Riwaq's controls now sit over it instead of MPV's.",
        "Play, seek, subtitles, audio, intro skipping and seek previews work as they do inside Riwaq. Esc takes you back.",
        "If Riwaq's controls cannot be laid over the window, MPV's come back as a fallback, so you are never left without controls.",
      ],
    },
  },
  {
    version: "0.43.0",
    title: "التورنت يشتغل بدون Stremio Service",
    items: [
      "محرك تورنت مدمج واختياري: فعّله من الإعدادات ← المصادر والمكتبة ← محرك P2P، أو من الدليل اللي يطلع أول ما تشغّل مصدر تورنت. ما يحتاج تثبّت أي برنامج.",
      "أو Stremio Service الرسمي بخطوات واضحة: رابط صفحته الرسمية، ورِواق يتحقق كل ثلاث ثوانٍ ويكمّل التشغيل أول ما يرد.",
      "المحرك يجيب الأجزاء اللي تشاهدها بس ويحذفها لما تخلص، أو يخلّي ذاكرة 2 أو 5 أو 10 جيجا. والسرعة والمشاركة بيدك.",
      "رِواق ما يفتح منافذ في الراوتر ولا يعلن عن نفسه في شبكتك، والمحرك ما يشتغل إلا إذا اخترته.",
    ],
    en: {
      title: "Torrents play without Stremio Service",
      items: [
        "An optional built-in torrent engine: turn it on in Settings → Sources & library → P2P engine, or from the guide that opens the first time you play a torrent source. Nothing to install.",
        "Or the official Stremio Service, step by step: a link to its official page, and Riwaq checks every three seconds and resumes as soon as it answers.",
        "The engine fetches only the pieces you watch and deletes them when you finish, or keeps a 2, 5 or 10 GB cache. Speed and sharing are up to you.",
        "Riwaq never opens router ports or announces itself on your network, and the engine runs only if you choose it.",
      ],
    },
  },
  {
    version: "0.42.0",
    title: "رِواق بالإنجليزي، و«نكمل الحكاية» على نفس المصدر",
    items: [
      "واجهة إنجليزية كاملة: الإعدادات ← اللغة والترجمة ← لغة الواجهة. تتغير فوراً والتخطيط ينقلب من اليسار لليمين، ولكل ملف شخصي لغته.",
      "«نكمل الحكاية» يكمّل على نفس المصدر اللي كنت تشاهد منه بدون قائمة المصادر، وإذا ما عاد متاح يختار أقرب مصدر من نفس الإضافة.",
      "أغنية العمل توقف أول ما تفتح المصادر، فما يتداخل صوتها مع الفيلم، وتنبيه أول مرة يشرح وش هي.",
      "البحث في الإعدادات يفهم العربي والإنجليزي.",
    ],
    en: {
      title: "Riwaq in English, and “Continue watching” on the same source",
      items: [
        "A full English interface: Settings → Language & subtitles → Interface language. It switches at once, the layout turns left-to-right, and each profile keeps its own language.",
        "“Continue watching” resumes on the source you were watching, without the sources list; if it's gone, Riwaq picks the closest source from the same addon.",
        "The title's theme song stops as soon as the sources open, so it never plays over the film, and a one-time hint explains what it is.",
        "Settings search understands Arabic and English.",
      ],
    },
  },
  {
    version: "0.41.0",
    title: "شيدرات Anime4K، تتبّع AniList، وأغانيك بأغلفتها",
    items: [
      "شيدرات GLSL مثل Harbor: أوضاع Anime4K الاثنا عشر وFSRCNNX، تنزّلها من مصدرها الرسمي بضغطة أو تختار مجلدك، وتبدّل بينها أثناء المشاهدة.",
      "تتبّع الأنمي في AniList: اربط حسابك، وكل حلقة تكملها ترفع تقدّمك في قائمتك (إذا فعّلته)، وقائمتا «أشاهده» و«أريد مشاهدته» تنضم لرِواق.",
      "ربط Simkl رجع يشتغل: تطبيقات Simkl الجديدة (AUTH V2) كانت ترجع خطأ 400، والقديمة تكمل بنفس الطريقة.",
      "حالة Discord صارت «يشاهد» مع البوستر والحلقة وشريط التقدم وزر لصفحة العمل على IMDb.",
      "أغانيك صارت بأسمائها الحقيقية وأغلفتها: العنوان والفنان والألبوم من الملف نفسه، مع تبويبي «الألبومات» و«الفنانون».",
      "الأسماء العربية المكتوبة بترميز ويندوز القديم تظهر صح، والأغاني المضافة قبل التحديث تتحدّث معلوماتها تلقائياً.",
      "مزامنة حساب رِواق أثبت: تسجيل الخروج يسري فوراً، وتغييرات جهازك الثاني تنتظر نهاية الفيديو بدل ما تقطع مشاهدتك.",
    ],
  },
  {
    version: "0.40.0",
    title: "حساب رِواق: إعداداتك معك في كل مكان",
    items: [
      "حساب اختياري تماماً: سوّه من الإعدادات ← الحسابات والربط ← حساب رِواق، وتنتقل مكتبتك ومتابعتك ومجموعاتك وإعداداتك بين أجهزتك وموقع رِواق.",
      "بدون إيميل ولا رقم جوال، وكل شي يتشفّر في جهازك بكلمة مرورك قبل ما يطلع؛ حتى نحن ما نقدر نقرأه.",
      "رمز استرداد يظهر لك مرة وحدة وقت التسجيل يرجّع حسابك لو نسيت كلمة المرور.",
      "تعديلين بنفس الوقت على جهازين؟ الاثنين ينحفظون، والحذف يبقى حذف.",
      "إصلاح في الموقع: ربط Spotify وLetterboxd كان يفشل في المتصفح، وصار يشتغل.",
    ],
  },
  {
    version: "0.39.0",
    title: "رِواق على الويب",
    items: [
      "رِواق صار يشتغل من المتصفح بدون تحميل: نفس الواجهة ونفس المحرّك، لمن ما يقدر أو ما يبغى يثبّت البرنامج.",
      "كل إصدار جديد ينزل للبرنامج والموقع مع بعض من نفس الكود، والصفحة المفتوحة تنبهك إذا نزلت نسخة أحدث.",
      "بياناتك في الموقع مشفّرة داخل متصفحك، والنسخة الاحتياطية تنتقل بين البرنامج والموقع في الاتجاهين.",
      "التورنت والصيغ اللي ما يشغلها المتصفح تشتغل إذا كان Stremio Service شغّال على جهازك.",
      "إصلاح: إضافة تثبّتها أول مرة والإنترنت بطيء ما تنحذف إذا تأخر Cinemeta.",
    ],
  },
  {
    version: "0.38.4",
    title: "الصورة رجعت: السبب انعرف وانحل",
    items: [
      "السبب الحقيقي للصوت بدون صورة: خيار «فيديو بلا خطوط» يرسم الصورة بطريقة ويندوز القديمة، فتنرسم تحت صفحة رِواق نفسها. شلنا الخيار نهائياً.",
      "إذا كان مفعّلاً عندك، رجع HDR إلى «تحويل إلى SDR» لأن مشاهداتك كانت أصلاً داخل رِواق، و«HDR حقيقي» في نافذة MPV موجود في الإعدادات متى ما بغيته.",
      "باقي إعدادات الصورة (أعلى جودة، OLED، RTX) تبقى مثل ما اخترتها.",
    ],
  },
  {
    version: "0.38.3",
    title: "الصورة تظهر من أول مرة",
    items: [
      "حماية إضافية: نافذة MPV ممكن تنولد بمقاس 1×1 قبل ما يأخذ سطح الفيديو مقاسه، فيشتغل الصوت بدون صورة.",
      "رِواق صار يعطي السطح مقاسه قبل ما يبدأ MPV، ويضبط نافذة MPV على مقاس السطح بنفسه مع كل تغيير وكل ثانيتين.",
      "لو ما أخذت النافذة المقاس، يعيد التشغيل مرة وحدة من نفس اللحظة بنفس إعداداتك، بدون وضع التوافق وبدون زر.",
      "التشخيص يقارن مقاس نافذة MPV بمقاس السطح، ويسجل كل تصحيح.",
    ],
  },
  {
    version: "0.38.2",
    title: "زر «إصلاح الصورة» ومشغّل أثبت",
    items: [
      "صوت بدون صورة؟ افتح لوحة الترجمة والصوت (الزر الأيمن أو C) ثم «إصلاح الصورة»: يعيد التشغيل من نفس اللحظة بإعدادات أبسط، والضغطة الثانية تفك الفيديو بالمعالج.",
      "المشغّل يتصل بـ MPV قبل ما يحمّل الفيديو، فما يفوته بدء أي ملف مهما كان سريعاً، وفحص الصورة صار يشتغل مع كل مشاهدة.",
      "إيقاف وتشغيل متتاليين بدون تداخل، ووضع التوافق يوقف RTX والمؤثرات المخصصة فعلاً لهذه المشاهدة.",
      "مصدر ما بدأ خلال دقيقة يعيد الاتصال ثم يجرّب التالي، والكرت اللي يتأخر في التجهيز ما يفشّل التشغيل.",
      "التشخيص يفرّق بين سطح رِواق ونافذة MPV نفسها، عشان نعرف سبب أي شاشة رصاصية.",
    ],
  },
  {
    version: "0.38.1",
    title: "إصلاح الصوت بدون صورة",
    items: [
      "السبب: من 0.37 صار المشغّل يرسل لـ MPV أمراً يعيد بناء سلسلة الفيديو مع بداية كل مشاهدة، حتى مع RTX مطفأ. هذا الأمر انشال، وما يُرسل إلا إذا شغّلت RTX فعلاً.",
      "MPV المرفق صار الإصدار الرسمي المستقر v0.41.0 من مشروع MPV نفسه، بدل النسخ اليومية اللي تنحذف وتتغير.",
      "كشف أقوى لاختفاء الصورة: إذا وقفت الإطارات عن الوصول للشاشة والصوت شغّال، يعيد التشغيل بوضع التوافق تلقائياً.",
    ],
  },
  {
    version: "0.38.0",
    title: "مشغّل ما يعلّق ولا تختفي صورته",
    items: [
      "HDR بطريقتين بس: «تحويل إلى SDR» (الافتراضي، صورة مضمونة على أي شاشة)، و«HDR حقيقي» على سطح بملء الشاشة مثل نيتفليكس وديزني بلس، بأدوات تحكم MPV وEsc للرجوع. ما فيه وضع تجريبي يخفي الصورة.",
      "مخزن تحميل كبير (حتى 2 جيجا) مثل منصات البث، وإعادة اتصال تلقائية لو انقطع الرابط، فملفات Blu-ray Remux الضخمة تشتغل بسلاسة.",
      "مراقب للتشغيل: إذا علق، يعيد الاتصال من نفس اللحظة ثم يجرّب المصدر التالي. ولو اختفت الصورة، يعيد التشغيل بوضع التوافق على مرحلتين.",
      "تمرير الصوت إلى جهاز الاستقبال (Atmos وTrueHD وDTS-HD) مثل مشغل Blu-ray، وشارات Dolby Vision وREMUX وIMAX وAtmos في المشغّل.",
      "«تشخيص كامل» يعرض أخطاء MPV في آخر مشاهدة، بدون روابط ولا مفاتيح، ونسخة MPV المرفقة صارت v0.41.",
    ],
  },
  {
    version: "0.37.0",
    title: "استوديو المشغّل: صورة وصوت على مقاسك",
    items: [
      "جودة الفيديو: ملفات MPV (سلس، متوازن، أعلى جودة)، وتسريع العتاد، والعارض، ولوحة العرض OLED أو LCD، ووضعي توافق، وتجربة NVIDIA RTX للتكبير وHDR.",
      "الصوت: تطبيع المستوى، ودمج المحيطي إلى ستيريو مع حوار واضح، وملفات صوت (باس، حوار، ليلي…)، وتعزيز حتى 600%، واختيار جهاز الإخراج. يتغير فوراً أثناء المشاهدة.",
      "المشغّل: جودة البث تحت العنوان، ومؤقت نوم في الشريط العلوي (بالدقائق أو بعد هذه الحلقة)، ونافذة صوت صغيرة، والبقاء بملء الشاشة.",
      "التخطي: خيار مستقل للملخص، وزر يختفي بعد ثوانٍ، وتوقيتات المقدمة والنهاية من TheIntroDB (مع مفتاحك الاختياري) وAniSkip للأنمي إذا فعّلتها.",
      "سرعة الإنترنت: حدد سرعتك أو قِسها، والمصادر الثقيلة عليها تنزل في الترتيب مع السبب.",
    ],
  },
  {
    version: "0.36.0",
    title: "أغنية العمل الرسمية، مو نسخ المعجبين",
    items: [
      "رِواق يقرأ من Wikidata ألبوم الموسيقى الرسمي للعمل ومؤلف موسيقاه، ويختار الأغنية من الألبوم نفسه أولاً (Spotify أو Apple Music أو Deezer).",
      "مع مفتاح TMDB اللي عندك، يعرف مؤلف موسيقى العمل، وما يقبل إلا أغنية من هذا المؤلف.",
      "نسخ المعجبين والكفرات والريمكسات و«مستوحاة من» ونسخ البيانو والـLo-Fi ما تشتغل.",
      "شارة «رسمية» على الأغنية لما تكون من الألبوم أو المؤلف، وإعداد «الثقة» في الإعدادات ← الأجواء ← أغنية العمل.",
    ],
  },
  {
    version: "0.35.0",
    title: "أغنية العمل تشتغل فعلاً، وكاملة على Spotify",
    items: [
      "إصلاح: الأغنية ما كانت تشتغل مع بيانات TMDB العربية، لأن البحث كان بالاسم المترجم. صار رِواق يبحث بالاسم الأصلي.",
      "إذا ربطت Spotify (Premium)، أغنية العمل تشتغل كاملة على Spotify وتوقف لما تطلع من الصفحة، بدون ما تقاطع موسيقاك.",
      "إذا ما لقى رِواق الأغنية بثقة يقول لك، ويعطيك زر تبحث عنها في منصتك.",
      "موسيقاك من جهازك: أضف أغانيك، وسوّ قوائم وطابوراً ومفضلة، ومشغّل صغير يكمل وأنت تتنقل ويوقف أول ما تبدأ المشاهدة.",
    ],
  },
  {
    version: "0.34.0",
    title: "رِواق مشغّل Spotify، وأغنية لكل عمل",
    items: [
      "اربط Spotify من غرفة الموسيقى: رِواق يعرض اللي يشتغل ويتحكم فيه، ويشغّل قوائمك ومحفوظاتك، وينقل التشغيل بين أجهزتك.",
      "أغنية العمل: تفتح صفحة فيلم أو مسلسل وتشتغل أغنيته (مقطع 30 ثانية) إذا لقاها رِواق بثقة. تقدر تخليها زر أو تطفيها من الإعدادات ← الأجواء.",
      "«مو هذي» تمنع أغنية عمل ما تبيها، والأغنية ما تشتغل فوق Spotify أو أثناء المشاهدة.",
    ],
  },
  {
    version: "0.33.0",
    title: "موسيقى وثيم لكل عمل",
    items: [
      "غرفة «موسيقى»: اختر منصاتك (Spotify، أنغامي، Apple Music، YouTube Music وغيرها)، واحفظ قوائمك وألبوماتك، وابحث فيها، وتنفتح في منصتك.",
      "زر «موسيقى العمل» في صفحة كل فيلم ومسلسل يفتح موسيقاه في منصتك الأساسية.",
      "صفحة العمل تاخذ ألوانها من العمل نفسه: من صورته أو من نوعه. تقدر تغيّرها أو تطفيها من الإعدادات ← الأجواء.",
    ],
  },
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

/**
 * The notes in an interface language. Arabic is the text itself; English
 * uses each release's `en` block, so a release without one is left out.
 * With none in English at all, the Arabic notes stand.
 */
export function notesIn(lang, list = WHATS_NEW) {
  if (lang !== "en") return list;
  const english = list
    .filter((n) => n.en?.title && Array.isArray(n.en.items))
    .map((n) => ({ version: n.version, title: n.en.title, items: n.en.items }));
  return english.length ? english : list;
}

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
