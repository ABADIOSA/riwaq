رِواق 0.46.1 لويندوز x64 وعلى الويب — أزرار المشغّل تستجيب للنقر، واختصاراتك تشتغل من أدوات المشغّل.

## الجديد في 0.46.1

- **أزرار المشغّل تستجيب للنقر** (بلاغ المالك بعد 0.46.0: التلميحات تطلع والنقرات ما تشتغل): نافذة أدوات المشغّل كانت ما تقبل التركيز، وChromium يرد على ضغطة الفأرة في نافذة بهالشكل بـ «لا تفعّلها وارمِ الضغطة»، فتنرمي ضغطة الزر وتوصل رفعته لحالها. الزر ما يعتبرها نقرة، ومرور الفأرة ما يتأثر. الحين النافذة تقبل التركيز وتوصلها النقرة كاملة، ورِواق ما ياخذ لها التركيز من برنامج ثاني أبداً.
- **اختصاراتك من أدوات المشغّل:** كلها تشتغل منها، حتى اللي غيّرتها بنفسك، وتوصل لـ MPV مفتاح واحد بس بدون أوامر. Esc يقفل اللوحة أو القائمة أول، وF8 يستعيد الأدوات حتى لو علّقت صفحتها.
- **المسافة توقف الفيديو دائماً:** بعد شريط الصوت تبقى الأسهم له والباقي للمشغّل، وبعد ما تضغط زر بالفأرة المسافة ما تعيده. واللي يتنقّل بلوحة المفاتيح يضغط الزر مثل قبل.
- **Tab** صار يتنقّل بين أزرار المشغّل، فالتخطي من زره أو من مفتاح تختاره في الاختصارات.

## من 0.46.0

- **التورنت يلقى مشاركين أكثر:** المحرك المدمج يسأل متتبعات عامة إضافية فوق متتبعات الإضافة، منها متتبعات HTTPS للشبكات اللي تحجب UDP. وشبكة DHT تبدأ من ستة موجّهات ومن عقد آخر تشغيل، والتورنت اللي مشاركينه أقل من 40 يعيد السؤال كل 30 ثانية. مأخوذة من Harbor وNuvio HTPC.
- **«اسمح للمشاركين يتصلون فيك»** (مفعّل من البداية): يطلب من الراوتر (UPnP وNAT-PMP) يفتح منفذ المحرك. خادم المشاهدة نفسه يبقى على جهازك بس، وقد يسألك جدار حماية ويندوز أول مرة.
- **«افحص الشبكة»** في صفحة **محرك P2P**: عقد DHT، والمتتبعات عبر UDP وHTTPS، واستقبال المشاركين.
- **حزم المواسم:** المحرك يشغّل الملف اللي سمّته الإضافة بدل أكبر ملف.
- **TorrServer احتياطياً:** برنامج تورنت مفتوح المصدر (GPL-3.0) من [YouROK/TorrServer](https://github.com/YouROK/TorrServer)، تنزّله بضغطة من صفحة **محرك P2P**. لما المحرك المدمج ما يلقى بيانات خلال 40 ثانية، يجرّب رِواق نفس التورنت فيه قبل المصدر التالي. رِواق ما يحمله معه: ينزل الإصدار MatriX.145.1 من GitHub، ويتأكد رِواق من حجمه وبصمته قبل ما يحفظه وقبل أول تشغيل. يشتغل على جهازك بس بكلمة سر عشوائية، وبدون إعلان في الشبكة المحلية. وهو بنفسه يسأل icanhazip.com عن عنوانك العام ويجلب قوائم متتبعات من GitHub.
- **التثبيت لكل المستخدمين** ([#86](https://github.com/ABADIOSA/riwaq/issues/86)): خيار «Anyone who uses this computer» صار متاح بموافقة المسؤول، وكل تحديث بعدها يطلب الموافقة نفسها.
- **أدوات المشغّل ما تعلق:** MPV، لما تضغط على صورته وتحرك الفأرة 3 بكسل، كان يبدأ سحب نافذته بحلقة ويندوز تمسك الفأرة. ونافذته جزء من نافذة رِواق، فكل النقرات في رِواق تروح لهالحلقة، وإذا بدأت بعد ما فلتّ الزر تنتظر نقرة ثانية. انطفى السحب (`--window-dragging=no`). وصار رِواق أخف وقت المشاهدة: تحديثات ذاكرة التحميل تطلع مع الموضع كل ربع ثانية، ونافذة الأدوات ما تتحرك إلا لو تغيّر مكانها وتاخذ اللي تحتاجه بس، والموضع ينحفظ كل 20 ثانية وفوراً عند الإيقاف.


## من 0.45.1

- **الأزرار ما تعلق بسبب القائمة:** في 0.45.0 كانت النقرة اليمين في المشغّل تفتح قائمة ويندوز مربوطة بنافذة أدوات التحكم، وهي نافذة ما تاخذ التركيز. هالنوع من القوائم ممكن ينفتح مخفي ويمسك كل النقرات، فما تقدر تتحكم بشي. الحين القائمة جزء من أدوات رِواق نفسها، مثل Harbor وNuvio HTPC.
- النقرة اللي تقفل القائمة ما توقف الفيديو، وEsc يقفلها بدون ما يوقف المشاهدة، والنقرة اليمين على صورة MPV تفتح نفس القائمة.

## من 0.45.0

من بلاغ مستخدم على 0.44.1 ([#82](https://github.com/ABADIOSA/riwaq/issues/82))، مع مراجعة كوديكس ([#84](https://github.com/ABADIOSA/riwaq/pull/84)):

- **التنزيل للمشاهدة بدون إنترنت:** من قائمة الزر الأيمن في المشغّل، والتنزيلات في زر فوق. ملفات الفيديو الكاملة والتورنت، بدون HLS/DASH أو البث المباشر، وما يكمّل تنزيل انقطع. الموسم والحلقة وعنوانها يظهرون مع كل تنزيل. التنزيلات على هذا الجهاز بس، ما تدخل النسخ الاحتياطية ولا حساب رِواق، وحذف ملف شخصي يحذف تنزيلاته (وإذا تعذّر حذف ملف، يبقى سجله لإعادة المحاولة).
- **قائمة الزر الأيمن في المشغّل:** إيقاف مؤقت، والترجمة والصوت، ولقطة شاشة، ونسخ رابط التورنت، والتنزيل، وإيقاف المشاهدة. الروابط المباشرة ما تنسخ لأنها ممكن فيها مفاتيحك.
- **إعدادات أساسية أولاً:** اللغة والترجمة والجودة والتورنت في صفحة وحدة، والباقي في «إعدادات متقدمة». و«واجهة هادئة» تخفي أزرار الحساب والملفات ودعوة ربط ستريميو.
- **الإغلاق والإيقاف:** إغلاق رِواق أثناء المشاهدة صار يقفل التطبيق صح، بدون رسالة «Object has been destroyed» وبدون ما تبقى نافذة MPV سودا. والإيقاف وقت تجهيز المصدر ما يخلّي الفيديو يشتغل بعدها.
- **التورنت بالمحرك المدمج:** عدد المشاركين والسرعة تحت «جاري تجهيز المشاهدة»، والتورنت اللي ما يوصل منه شي خلال 40 ثانية ينتقل للمصدر التالي، وإذا ما فيه مصدر ثاني توقف المشاهدة برسالة واضحة.
- **شريط الصوت** يتحرك مع الفأرة فوراً ويشتغل بالأسهم، ويمتلي عند 100%، والتعزيز فوقها جزء ثاني بلون مختلف. ونقرة على صورة MPV توقفها مؤقتاً، والضغط المستمر يسرّعها. وخط التقدم بدون توهّج.
- **«نكمل الحكاية»:** زر ✕ يشيل العمل وتقدّمك يبقى. وزر لإخفاء اقتراح ربط ستريميو، وأسهم الصفوف بجانب «عرض الكل».
- **لغة الواجهة** أول شي في الإعدادات الأساسية، وفي المتقدمة صارت في المظهر. والواجهة الإنجليزية تعرض معرض العمل وأسماء فريق العمل بالإنجليزي.

## من 0.44.1

- **إشعارات رِواق من أجهزة المالك:** صاحب رِواق صار ينشر الإشعارات من التطبيق العام نفسه على الأجهزة اللي يختارها. الجهاز يصير جهاز مالك بس لما يندخل فيه رمز GitHub يتأكد GitHub إنه لحساب المالك وله صلاحية الكتابة، والرمز ينحفظ مشفّراً بتشفير ويندوز على ذاك الجهاز بس. حذف الرمز من GitHub يشيل الجهاز.
- ما تغيّر شي عند المشاهدين، وأجهزتهم ما تكلّم GitHub لهذا أبداً.

## من 0.44.0

- **إشعارات رِواق:** جرس في الشريط العلوي فيه أخبار رِواق وتنبيهات الفريق بالعربي والإنجليزي، مع عدّاد لغير المقروء. «استقبال أخبار رِواق» في نفس النافذة يوقفه. يقرأ ملف الإشعارات العام من GitHub عند الفتح وكل 15 دقيقة، بدون أي بيانات عنك.
- **أدوات تحكم أثبت:** ترجع لو انعاد تحميلها أو علّقت، وأدوات MPV تشتغل احتياطاً لين ترجع، والمشاهدة ما تبدأ بقفزة في الصورة.
- **F8 يستعيد أدوات التحكم:** داخل رِواق يعيد تحميلها. ومع «HDR حقيقي» يكمل المشاهدة داخل رِواق من نفس اللحظة بألوان SDR لهذه المشاهدة بس.
- **إصلاحات:** Esc يغلق نافذة «HDR حقيقي» دائماً، وإغلاق محرك التورنت ما يعلّق، و«تشخيص كامل» صار يفحص أدوات التحكم.

## من 0.43.1

- **HDR حقيقي، وأدوات رِواق فوقه:** مع «HDR حقيقي» (الإعدادات ← جودة الفيديو)، مصادر HDR وDolby Vision تفتح في نافذة MPV الخاصة عشان يعرضها ويندوز بـ HDR فعلي. قبل كذا كانت أدوات MPV تحل محل أدوات رِواق هناك. الحين رِواق يلقى النافذة ويحط أدواته فوقها بالضبط ويلحقها لو تحركت.
- **ما تبقى بدون تحكم:** أدوات MPV احتياط لين تنحط أدوات رِواق فعلاً، وترجع لو تعذّر وضعها.
- أزرار المشغّل المصغّر والإعدادات وملء الشاشة تختفي فوق نافذة MPV، لأن نافذة رِواق وراها. نقرتين على الصورة أو زر F يبدّل ملء الشاشة.

## من 0.43.0

- **محرك تورنت مدمج واختياري:** ما يحتاج تثبّت أي برنامج. فعّله من الإعدادات ← المصادر والمكتبة ← محرك P2P، أو من الدليل اللي يطلع أول ما تشغّل مصدر تورنت.
  - يجيب الأجزاء اللي تشاهدها بس، ويحذفها لما تخلص، أو يخلّي ذاكرة 2 أو 5 أو 10 جيجا.
  - تختار السرعة (هادئ، متوازن، سريع) وقد إيش يشارك أثناء المشاهدة.
  - ما يفتح منافذ في الراوتر ولا يعلن عن نفسه في شبكتك. ومثل أي برنامج تورنت، عنوان IP حقك يظهر للمشاركين.
  - يشتغل في عملية مستقلة، وخادمه على جهازك بس (‎127.0.0.1) تحت مسار عشوائي.
- **أو Stremio Service الرسمي بخطوات:** الدليل يعطيك رابط صفحته الرسمية، ورِواق يتحقق كل ثلاث ثوانٍ ويكمّل التشغيل على نفس المصدر أول ما يرد. وصفحة «خادم البث» فيها زر التنزيل لما ما يرد.
- **ليش ما نرفق خادم Stremio نفسه؟** فريق Stremio قال إن `server.js` فيه كود مملوك وما هو للتوزيع خارج تطبيقاتهم ([stremio-shell#435](https://github.com/Stremio/stremio-shell/issues/435)). عشان كذا المحرك المدمج مبني على WebTorrent (MIT).
- **الحجم:** ملفات البرنامج تكبر قرابة 33 ميجا بعد التثبيت، أغلبها مكتبة WebRTC الأصلية اللي يحتاجها WebTorrent.

## من 0.42.0

- **واجهة إنجليزية:** من الإعدادات ← اللغة والترجمة ← لغة الواجهة، اختر English. القوائم والأزرار والإعدادات ورسائل الأخطاء ونوافذ الحفظ وحالة Discord وشاشة المشغّل كلها تتغير فوراً، والتخطيط ينقلب من اليسار لليمين. لكل ملف شخصي لغته، والبحث في الإعدادات يفهم العربي والإنجليزي.
- **الواجهة العربية ما تغيّرت:** قارنّا 34 شاشة عربية قبل التغيير وبعده بكسل ببكسل، وطلعت متطابقة.
- **أسماء الأعمال وأوصافها:** تجي من مصادرها بلغتها. مع الواجهة الإنجليزية يعرض رِواق تحويل أوصاف TMDB للإنجليزية بضغطة.
- **«نكمل الحكاية» على نفس المصدر (#74):** الضغط على عمل في متابعة المشاهدة يكمل من حيث وقفت على المصدر نفسه بدون قائمة المصادر. إذا تغيّر رابطه يختار أقرب مصدر من نفس الإضافة وفريق الإصدار، وإذا ما عاد موجود تظهر القائمة مع تنبيه. تقدر تطفيه من إعدادات المشغّل.
- **صوت قبل اختيار المصدر (#74):** كان صوت أغنية العمل، مو الفيلم. صارت توقف أول ما تفتح المصادر، وما تشتغل أبداً مع «نكمل الحكاية»، وأول مرة تشتغل يطلع تنبيه يشرح وش هي ومن وين تطفيها.
- عدد المشاركين في التورنت صار يقول «مشارك» بدل «مصدر» عشان ما يختلط بعدد المصادر.

## من 0.41.0

- **شيدرات GLSL مثل Harbor:** أوضاع Anime4K الاثنا عشر (A وB وC وA+A وB+B وC+A بجودتي HQ وFast) وFSRCNNX. رِواق ما يرفق أي شيدر: اضغط «تنزيل» ويجيب الإصدار الرسمي من GitHub ويتحقق من بصمته قبل حفظه، أو اختر مجلدك ورتّب سلسلتك. زر «الشيدر» في المشغّل يبدّل الوضع فوراً، وAnime4K على الأنمي فقط إلا إذا اخترت غير كذا.
- **تتبّع الأنمي في AniList:** اربط حسابك برمز من صفحة AniList (بدون كلمة مرور). إذا فعّلت التسجيل، كل حلقة أنمي تكملها ترفع تقدّمك في قائمتك، والتقدّم ما ينقص أبداً. وقائمتا «أشاهده» و«أريد مشاهدته» تنضم لرِواق.
- **إصلاح Simkl:** تطبيقات Simkl الجديدة (AUTH V2) كانت ترجع خطأ 400. صار الربط برمز تدخله في صفحة Simkl بدون Client Secret، والتطبيقات القديمة تكمل بنفس الطريقة.
- **مزامنة الحساب أثناء المشاهدة:** تسجيل الخروج يسري فوراً، وتغييرات جهازك الثاني تنتظر نهاية الفيديو بدل ما تقطع المشاهدة، وما تنزل من جديد مع كل حفظ وهي تنتظر.
- **حالة Discord جديدة:** «يشاهد» مع البوستر والحلقة وشريط التقدم وزر لصفحة العمل على IMDb.

- **أسماء حقيقية:** رِواق يقرأ العنوان والفنان والألبوم والسنة ورقم المقطع من ملف الأغنية نفسه: MP3 وFLAC وOGG وOpus وM4A وWAV.
- **الأغلفة:** غلاف الألبوم جنب كل أغنية وفي شريط المشغّل وفي أدوات تحكم ويندوز للوسائط. يُصغّر في الذاكرة ولا يُحفظ على القرص.
- **الألبومات والفنانون:** تبويبان جديدان. الألبوم يفتح أغانيه بترتيبها، والبحث بالأغنية أو الفنان أو الألبوم.
- **العربي صح:** الأسماء العربية المكتوبة بترميز ويندوز القديم تظهر عربي. والملف بلا معلومات يأخذ الفنان والعنوان من اسمه.
- **مكتبتك القديمة:** أغانيك المضافة قبل التحديث تتحدّث معلوماتها تلقائياً، ومفضلاتك وقوائمك تبقى.

## من 0.40.0

- **حساب رِواق الاختياري:** من الإعدادات ← الحسابات والربط ← حساب رِواق. تنتقل مكتبتك ومتابعتك ومجموعاتك وملفاتك الشخصية وإعداداتك بين أجهزتك وموقع رِواق. رِواق يشتغل كامل بدون حساب.
- **مشفّر من جهازك:** اسم مستخدم وكلمة مرور بس، بدون إيميل. البيانات تتشفّر في جهازك قبل ما تطلع، والخادم ما يقدر يقرأها ولا يعرف كلمة مرورك. رمز استرداد يظهر مرة وحدة وقت التسجيل.
- **مزامنة ما تضيّع شي:** تعديلين بنفس الوقت على جهازين ينحفظون الاثنين، والحذف يبقى حذف. المفاتيح والحسابات المربوطة ما تتزامن إلا إذا فعّلتها.
- **إصلاح للموقع:** ربط Spotify وLetterboxd من المتصفح صار يشتغل.

## من 0.39.0

- **رِواق على الويب:** لمن ما يقدر أو ما يبغى يحمّل البرنامج: https://abadiosa.github.io/riwaq/ — نفس الواجهة ونفس المحرّك، لأنه نفس الكود.
- **ينزل مع كل إصدار:** هذا الإصدار نفسه ينشر الموقع من نفس الكود، والصفحة المفتوحة تنبهك لما تنزل نسخة أحدث.
- **بياناتك مشفّرة في متصفحك:** ولا شيء يروح لخادم لنا. النسخة الاحتياطية تنتقل بين البرنامج والموقع في الاتجاهين.
- **التورنت والصيغ الثقيلة على الويب:** تشتغل إذا كان Stremio Service شغّال على جهازك.
- **إصلاح للبرنامج والموقع:** إضافة تثبّتها أول مرة والإنترنت بطيء ما عاد ينمسح لو تأخر Cinemeta.

## من 0.38.4

- **السبب الحقيقي:** خيار «فيديو بلا خطوط» (من 0.37) كان يرسل لـ MPV طريقة رسم ويندوز القديمة (`--d3d11-flip=no`). نافذة رِواق يرسمها Chromium بطبقة فوق هالطريقة، فتنرسم الصورة تحت صفحة رِواق: الصوت شغّال وMPV يقول كل شي تمام، والظاهر صفحة المشغّل الرصاصية. زر الإصلاح كان ينجح لأنه يطفي الخيار.
- **الحل:** شلنا الخيار نهائياً، وما يوصل MPV أبداً.
- **إعداداتك:** إذا كان مفعّلاً عندك، رجع HDR إلى «تحويل إلى SDR»، لأن الخيار كان يمنع نافذة «HDR حقيقي» أصلاً وكانت مشاهداتك داخل رِواق. «HDR حقيقي» في نافذة MPV موجود في الإعدادات متى ما بغيته. باقي اختياراتك (أعلى جودة، OLED، RTX) ما تتغير.

## من 0.38.3

- **حماية إضافية:** MPV ينشئ نافذته بمقاس سطح الفيديو لحظتها، وفي أول مشاهدة كان السطح لسا 1×1. النافذة تبقى بكسل واحد، فيشتغل الصوت ويرسم MPV الإطارات، والظاهر خلفية السطح الرصاصية. زر الإصلاح كان ينجح لأن السطح وقتها أخذ مقاسه.
- **الحل:** رِواق يعطي السطح مقاسه قبل ما يبدأ MPV، ويضبط نافذة MPV على مقاس السطح بنفسه مع كل تغيير وعند بدء الصورة وكل ثانيتين، بدل الاعتماد على إشعار من ويندوز ممكن يضيع.
- **احتياط:** لو ما أخذت النافذة المقاس ثلاث مرات متتالية، يعيد التشغيل مرة وحدة من نفس اللحظة بنفس إعداداتك.
- **تشخيص:** «سطح الفيديو المدمج» يقارن مقاس نافذة MPV بمقاس السطح، وكل تصحيح يُسجّل في سجل الأخطاء.

## من 0.38.2

- **«إصلاح الصورة»:** إذا اشتغل الصوت والصورة ما ظهرت، افتح لوحة الترجمة والصوت (الزر الأيمن أو C) ثم «الصوت يعمل بدون صورة؟». يعيد التشغيل من نفس اللحظة بإعدادات صورة أبسط، والضغطة الثانية تفك الفيديو بالمعالج.
- **فحص الصورة مع كل مشاهدة:** المشغّل يتصل بـ MPV قبل تحميل الفيديو، فما يفوته بدء الملفات السريعة.
- **بدون تداخل:** الإيقاف والتشغيل المتتاليان ما يتصادمون، ووضع التوافق يوقف RTX والمؤثرات المخصصة فعلاً.
- **ما يعلّق عند البداية:** مصدر ما بدأ خلال دقيقة يعيد الاتصال ثم يجرّب التالي، والكرت اللي يتأخر في التجهيز ما يفشّل التشغيل، وما يومض شعار MPV قبل المشاهدة.
- **تشخيص أدق:** يفرّق بين سطح رِواق ونافذة MPV نفسها.

## من 0.38.1

- **السبب:** من 0.37، المشغّل كان يرسل لـ MPV أمراً يعيد بناء سلسلة الفيديو مع بداية كل مشاهدة، حتى مع RTX مطفأ. انشال، وما يُرسل إلا مع RTX.
- **MPV رسمي مستقر:** الإصدار الرسمي v0.41.0 من مشروع MPV نفسه، بدل النسخ اليومية.
- **كشف أقوى:** إذا وقفت الإطارات عن الوصول للشاشة والصوت شغّال، يعيد التشغيل بوضع التوافق تلقائياً.

## من 0.38.0

- **HDR بطريقتين مضمونتين:** «تحويل إلى SDR» (الافتراضي، تظهر الصورة على أي شاشة)، و«HDR حقيقي» على سطح بملء الشاشة مثل نيتفليكس وديزني بلس، فيه أدوات تحكم MPV وEsc للرجوع. شلنا الوضع المضمّن اللي ممكن يخفي الصورة.
- **ملفات Blu-ray Remux:** مخزن تحميل حتى 2 جيجا حسب ذاكرة جهازك، وانتظار قصير قبل أول إطار، وإعادة اتصال تلقائية لو انقطع الرابط.
- **ما يعلّق:** مراقب يعيد الاتصال من نفس اللحظة إذا علق التشغيل، ثم يجرّب المصدر التالي، ومؤشر «يخزّن مؤقتاً».
- **ما تختفي الصورة:** إعادة تشغيل تلقائية بوضع التوافق على مرحلتين.
- **مسرح منزلي:** تمرير Atmos وTrueHD وDTS-HD إلى جهاز الاستقبال، وشارات Dolby Vision وREMUX وIMAX وAtmos.
- أخطاء MPV في «تشخيص كامل»، ونسخة MPV v0.41.

## من 0.37.0

- **جودة الفيديو:** ملفات MPV (سلس، متوازن، أعلى جودة)، وتسريع العتاد، والعارض، ووضعا توافق للكروت القديمة والشاشات اللي يطلع فيها خط عند الحافة، ولوحة العرض OLED أو LCD، وتحويل HDR.
- **NVIDIA RTX Video (تجريبي):** تكبير بالذكاء الاصطناعي وتحويل SDR إلى HDR لكروت RTX، وشارة في المشغّل متى اشتغل.
- **الصوت:** تطبيع المستوى، ودمج المحيطي إلى ستيريو مع حوار واضح، وملفات صوت (باس، حوار، ليلي…)، وتعزيز حتى 600%، واختيار جهاز الإخراج. يتغير فوراً أثناء المشاهدة.
- **المشغّل:** جودة البث تحت العنوان، ومؤقت نوم في الشريط العلوي (بالدقائق أو بعد هذه الحلقة)، ونافذة صوت صغيرة، والبقاء بملء الشاشة.
- **التخطي:** خيار مستقل للملخص، وزر يختفي بعد ثوانٍ، وتوقيتات المقدمة والنهاية من TheIntroDB (مع مفتاحك الاختياري) وAniSkip للأنمي إذا فعّلتها.
- **سرعة الإنترنت:** حدد سرعتك أو قِسها، والمصادر الثقيلة عليها تنزل في الترتيب مع السبب.
- مع كل مزايا 0.36.0.

## الملف المناسب

استخدم **Riwaq-Setup-0.46.1-win-x64.exe** للتثبيت مرة واحدة وتفعيل التحديثات التالية داخل التطبيق. من ثبّت 0.8 أو أحدث يصله هذا التحديث من داخل رِواق. مكتبتك وإعداداتك تبقى محفوظة. النسخة المحمولة **Riwaq-0.46.1-win-x64.exe** متاحة للاستخدام اليدوي.

## التحقق والحدود

نجحت الاختبارات الآلية (844)، ومنها إن أدوات المشغّل ما ترسل لـ MPV غير مفتاح واحد، وإن شريط الصوت ما يبلع المسافة وEsc، وإن الزر اللي ضغطته بالفأرة ما تعيده المسافة. وجُرّبت صفحة أدوات المشغّل في Chromium حقيقي بجسر وهمي: الفحص فشل على النسخة قبل إصلاح لوحة المفاتيح ونجح بعده. وجرّب كوديكس على ويندوز بـ Electron وMPV فعليين، قبل إصلاح لوحة المفاتيح الأخير، نقرات ويندوز حقيقية على الترجمة والصوت وخط التقدم والصوت والإيقاف، والمفاتيح، وF8 والأدوات معلّقة عمداً، داخل رِواق وفوق نافذة MPV. سبب ضياع النقرات مقروء من كود Chromium نفسه وما انعاد إنتاجه على جهاز المالك، والفيديو التجريبي SDR. نجحت الاختبارات الآلية (839)، ومنها إن MPV ما يقدر يسحب نافذته، وإن تحديثات ذاكرة التحميل ما تعيد رسم الأدوات كل مرة، وإن الموضع ينحفظ كل 20 ثانية وفوراً عند الإيقاف، وسرب تورنت محلي حقيقي يشغّل الحلقة اللي سمّتها الإضافة من حزمة، وTorrServer وهمي يتبع بروتوكوله، وتنزيل لا يقبل غير ملف الإصدار المثبّت. وجرّب كوديكس على ويندوز: ضغط وتحريك على نافذة MPV والأدوات مطفية، وبعدها الأزرار والقائمة والتنزيلات والإغلاق استجابت؛ وTorrServer الحقيقي لويندوز مع سرب محلي؛ وخيار التثبيت لكل المستخدمين صار متاحاً في المثبّت (الفحص يلغي قبل التثبيت). وجُرّب TorrServer نسخة Linux مع سرب محلي: شغّل الحلقة الصحيحة بالرقم وبالاسم بايت ببايت، ورفض الطلبات بدون كلمة السر، وما بقى بعد الإيقاف. وجُرّبت صفحة محرك P2P في Chromium بجسر وهمي بالعربي والإنجليزي. ما جُرّب راوتر حقيقي، ولا سرب عام، ولا تثبيت فعلي لكل المستخدمين. نجحت الاختبارات الآلية (806)، ومنها اختبار يمنع أي قائمة ويندوز في المشغّل. وجُرّبت القائمة الجديدة في Chromium بجسر وهمي بالعربي والإنجليزي: تنفتح عند المؤشر، وتنفذ أوامرها، وتنقفل بالنقر برا بدون إيقاف الفيديو، والأزرار تشتغل بعدها. السبب ما انعاد إنتاجه على ويندوز هنا. نجحت الاختبارات الآلية (805)، ومنها إغلاق النافذة بدون إرسال لصفحة انتهت، وسرب تورنت محلي يعدّ البيانات وينحفظ منه ملف على القرص، وقاعدة التورنت الميت، وإلغاء التشغيل عند الإيقاف وقت التجهيز، وشريط الصوت، وإزالة عمل من «نكمل الحكاية». وجُرّبت في Chromium بجسر وهمي بالعربي والإنجليزي. وجرّب كوديكس على ويندوز بـ Electron وMPV فعليين ومصادر محلية: شريط الصوت والنقرة والضغط المستمر، والقائمة، والتنزيل والتشغيل بدون المصدر، والإغلاق أثناء المشاهدة. ما جُرّب HDR حقيقي ولا سرب تورنت عام. نجحت الاختبارات الآلية (782)، ومنها إن أجهزة المالك ما تتفعّل إلا برمز حساب المالك، وإن الرمز المحفوظ مشفّر وما يطلع للواجهة ولا النسخ الاحتياطية، وإن حذفه من GitHub يشيل الجهاز، وإن النشر يحتاج معاينة وتأكيد. وجُرّبت أدوات المالك في Chromium بجسر وهمي بالعربي والإنجليزي. ما جُرّبت على ويندوز ولا برمز GitHub حقيقي. نجحت الاختبارات الآلية (775). ومن قبل الدمج جُرّب على ويندوز بـ Electron وMPV فعليين: الأدوات داخل رِواق وفوق نافذة MPV، وقوائم الترجمة والصوت، وإعادة تحميل الأدوات أثناء التوقف المؤقت، وتعليقها عمداً ثم رجوعها، وأمر F8. وجُرّب صندوق الإشعارات بالعربي والإنجليزي بملف إشعارات تجريبي. ما جُرّب على شاشة HDR حقيقية، ولا نُشر إشعار حقيقي. نجحت الاختبارات الآلية (746)، ومنها قواعد وضع أدوات رِواق فوق نافذة MPV وحسابها، وإن أدوات MPV احتياط لين تغطيها أدوات رِواق، وإن ملء الشاشة هناك لنافذة MPV. ما جُرّب على ويندوز بشاشة HDR بعد: البحث عن نافذة MPV من ويندوز، وبقاء أدوات رِواق فوقها، وإن HDR يبقى سليم تحتها. نجحت الاختبارات الآلية (743)، ومنها سرب تورنت محلي حقيقي بدون إنترنت: المحرك يجيب الملف بنطاقات البايت، ويرفض الطلبات الغريبة، ويحذف الأجزاء بعد المشاهدة، وعمليته تعود لو توقفت. وفي Electron على Linux: المحرك اشتغل في عمليته المستقلة وسلّم أول ميجا خلال 1.2 ثانية. وفي Chromium: الدليل بخياريه وصفحة الإعدادات بالعربي والإنجليزي. ما جُرّب المحرك على ويندوز حقيقي، ولا على سرب عام من الإنترنت، ولا مثبّت ويندوز فيه المكتبات الأصلية الجديدة. نجحت الاختبارات الآلية (731)، ومنها اختبار يمنع أي نص عربي في الواجهة أو رسائلها بدون ترجمة، ويمنع الجمل اللي تترجم نصها بس. في Chromium: الشاشات الإنجليزية بالتخطيطين وبمقاسين بدون أخطاء ولا تمرير أفقي، والشاشات العربية متطابقة بكسل ببكسل مع ما قبل التغيير، وتبديل اللغة في نسخة الويب الحقيقية ويبقى بعد إعادة التحميل، وسيناريوهات «نكمل الحكاية» الأربعة وإيقاف أغنية العمل بجسر وهمي. ما جُرّبت الواجهة الإنجليزية على ويندوز حقيقي، ولا نوافذ الحفظ ولا Discord بالإنجليزي على جهاز. نجحت الاختبارات الآلية (658)، ومنها قراءة معلومات كل صيغة من ملفات تُبنى داخل الاختبار، ومكتبة الأغاني بملفات حقيقية مؤقتة، وفحص غرفة الموسيقى في متصفح بجسر وهمي. لم تُجرَّب الأغلفة بمكتبة نظام ويندوز ولا مجموعة أغانٍ حقيقية من هذه البيئة. نجحت الاختبارات الآلية (642)، ومنها خدمة الحسابات الحقيقية على SQLite مع أكثر من جهاز (تعديلات متزامنة، استرداد، حذف، وإن الخادم ما يحفظ شي مقروء)، وفي Chromium حقيقي: حساب ينسوّى من الواجهة على جهاز وجهاز ثاني يدخل ويستلم مكتبته وإعداداته. والخدمة نفسها منشورة على Cloudflare ومجرّبة: انسوّى عليها حساب تجريبي، وانرفضت كلمة مرور غلط، ودخل جهاز ثاني واستلم البيانات، واندمجت التعديلات بالاتجاهين، وبعدها انحذف الحساب وانتهت جلساته. هالتجربة تتكرر تلقائياً بعد كل نشر للخدمة. تسجيل الدخول من البرنامج على جهاز ويندوز حقيقي ومن الموقع المنشور ما جُرّب هنا. ومن قبل: تطابق جسر الويب مع البرنامج، وتشفير متوافق بين الإصدارين، واختبار للموقع في Chromium حقيقي: تثبيت إضافة، تخزين مشفّر، تشغيل فيديو وترجمة، حفظ التقدم، ونسخة احتياطية تفتحها نسخة البرنامج. تسجيل الدخول بحسابات Stremio وSpotify الحقيقية من الموقع، وتحويل Stremio Service، وSafari وFirefox ما جُرّبت هنا. استدعاءات ويندوز نفسها ما جُرّبت هنا. مراجعة #56 شغّلت MPV v0.41.0 على ويندوز بفيديو تجريبي ومرحلتي التوافق. لم يُعَد إنتاج الشاشة الرصاصية بملف المستخدم، ولم يُجرَّب Dolby Vision أو HDR أو RTX على عتاد حقيقي.

التوقيع الخاص بحزم التحديث منفصل عن شهادة ناشر ويندوز؛ الملف غير موقّع بشهادة Authenticode، وقد يظهر SmartScreen. التورنت يحتاج المحرك المدمج (اختياري) أو Stremio Service منفصلة. رِواق لا يوفّر محتوى أو قنوات أو اشتراكات. نتائج الاختبارات وحدودها في VERIFICATION.md.

## In English

Riwaq 0.46.1 makes the player buttons respond to clicks, from the owner's report after 0.46.0 that tooltips appeared but every click was ignored. The controls window could not take focus, and for such a window Chromium answers Windows' mouse activation with "do not activate, and discard the press" (`MA_NOACTIVATEANDEAT`), so the button-down was thrown away and only the button-up arrived: no click, while hover and tooltips still worked. The controls window now takes focus and gets the whole click; Riwaq gives it focus only from its own window or its MPV window, never from another program. All your shortcuts, including changed ones, work from the controls and reach MPV as one key, never a command; Esc closes the panel or menu first, and F8 recovers the controls even when their page froze. After the volume slider, its arrows stay its own and every other key reaches the player, and a button clicked with the mouse is no longer pressed again by Space. Tab now moves between the player's buttons, so skip with its button or a key you choose. 844 automated tests pass, and the controls page was checked in a real Chromium, failing before the keyboard fix and passing after it. Before that fix, Codex ran real Windows clicks and keys on the controls with Electron and MPV, inside Riwaq and over MPV's window, including F8 with the controls deliberately frozen. The cause was read in Chromium's own source and has not been reproduced on the owner's machine; the test video is SDR.

Riwaq 0.46.0 fixes the player controls freezing, helps torrents find peers and adds TorrServer as a fallback. With MPV's default window dragging, a press on the picture that moved 3 px started Windows' move loop on MPV's window, which is a child of Riwaq's and shares its input, so every click in Riwaq went to that loop until the button was released, or until another click when the loop began after the release. MPV now gets `--window-dragging=no`, and Riwaq does less on every player update: cache reports are coalesced with the position, the controls window moves only when its rectangle changes and receives only the settings and progress it reads, Discord hears only changes, and the position is written every 20 s and at once when a viewing ends. The built-in engine now also announces to public trackers (HTTPS ones included, for networks that block UDP), starts the DHT from six routers and the nodes it knew last time, and asks again every 30 seconds while a torrent has fewer than 40 peers, as Harbor and Nuvio HTPC do. "Let peers connect to you" (on by default) asks the router to open the engine's peer port through UPnP/NAT-PMP; the streaming server stays on 127.0.0.1. "Check the network" reports DHT nodes and whether UDP and HTTPS trackers are reachable, and a season pack plays the file the addon names. TorrServer (GPL-3.0, YouROK/TorrServer) is never shipped: the viewer downloads the pinned MatriX.145.1 release from the P2P engine page, checked by size and SHA-256 before it is kept and before it first runs. When the built-in engine gets no data within 40 seconds, Riwaq tries the same torrent in TorrServer before the next source. It runs on 127.0.0.1 with a random password and never announces itself on the LAN; on its own it looks up the public IP (icanhazip.com) and fetches tracker lists from GitHub. The installer offers "Anyone who uses this computer" again, with administrator approval (#86). 839 automated tests pass. On Windows, Codex pressed and moved on MPV's window with the controls off and the controls, menu, downloads and closing still responded; the real Windows TorrServer played from a local swarm; and the installer's all-users choice is enabled (the check cancels before installing). The real TorrServer's Linux build also played the right episode from a local swarm by index and by name. A real router, a public swarm and an actual all-users install have not been tried.

Riwaq 0.45.1 fixes the player controls freezing. In 0.45.0 a right click in the player opened a Windows menu owned by the non-focusable controls window (or under MPV's always-on-top True HDR window). Such a menu can open out of sight and hold every click, so no button responded. The menu is now part of Riwaq's own controls, as in Harbor and Nuvio HTPC. The click that closes it does not pause, Esc closes it without stopping the viewing, and a right click on MPV's own picture opens the same menu. 806 automated tests pass; the cause was not reproduced on Windows here.

Riwaq 0.45.0 adds offline downloads, a player menu and simpler settings, and fixes what a user reported on 0.44.1 (#82), with Codex's review (#84). Complete video files and torrents download from the player's right-click menu and play from the Downloads button without the source, labelled with their season, episode and title; they stay on this device, outside backups and accounts. The menu also pauses, opens subtitles and audio, takes a screenshot, copies a torrent's magnet (never a direct address, which may carry your keys) and stops. Settings open on one basic page with the rest under "Advanced settings", and "Quiet interface" hides the account and profile buttons. Closing Riwaq during a viewing no longer raises "Object has been destroyed", and Stop while a source is being prepared now really stops it. Built-in torrents show peers and speed while they start, and one that sends nothing within 40 seconds moves on to the next source. The volume slider follows the pointer at once and reads full at 100%; a click on MPV's own picture pauses. Titles can be removed from "Continue watching" (progress kept), the Stremio linking suggestion can be hidden, row arrows sit beside "See all", and the English interface shows the title gallery and the credits' names in English. 805 automated tests pass; Codex ran the player, menu, downloads and closing on Windows with real Electron and MPV against local sources.

Riwaq 0.44.1 lets Riwaq's owner publish notices from the public app itself on chosen devices. A device becomes an owner device only when a GitHub token is entered there that GitHub confirms belongs to the owner's account with write access; the token is sealed with Windows encryption on that device only, and deleting it on GitHub removes the device. Nothing changes for viewers, whose copies never contact GitHub for this. 782 automated tests pass; owner devices have not been run on Windows or with a real token yet.

Riwaq 0.44.0 adds a notification bell with Riwaq news and team notices (Arabic, optional English), read from a public GitHub file at launch and every 15 minutes with nothing about the viewer sent, and switchable off. The player controls recover after a reload or freeze, with MPV's controls standing in meanwhile; F8 reloads them inside Riwaq, or continues a True HDR viewing inside Riwaq in SDR. Esc always closes the True HDR window, torrent shutdown no longer hangs, and the full diagnostic checks the controls. 775 automated tests pass.

Riwaq 0.43.1: with "True HDR" (Settings → Video quality), HDR and Dolby Vision sources open in MPV's own window so Windows shows them in real HDR. MPV's controller used to replace Riwaq's there; Riwaq now finds that window through Win32 by MPV's process, lays its own controls over it (always on top) and follows it, with MPV's controller as a fallback until it does. 746 automated tests pass; this has not been run on a Windows HDR display yet.

Riwaq 0.43.0 plays torrents without Stremio Service. An optional built-in engine (WebTorrent, MIT) runs in its own process and serves MPV from 127.0.0.1 only. It fetches only the pieces you watch and deletes them afterwards (or keeps a 2/5/10 GB cache), and never opens router ports. Turn it on in Settings → Sources & library → P2P engine, or from the guide that opens the first time a torrent needs an engine. The guide also walks you through the official Stremio Service and resumes as soon as it answers. Stremio's own server.js is not bundled: Stremio says it contains proprietary code not meant for distribution outside its apps (stremio-shell#435). 743 automated tests pass, including a real offline local swarm; the engine has not been run on a real Windows machine or a public swarm yet.

Riwaq 0.42.0 adds a full English interface: Settings → Language & subtitles → Interface language. Menus, settings, error messages, save dialogs, Discord presence and the player switch at once, and the layout turns left-to-right; each profile keeps its own language. The Arabic interface is unchanged: 34 Arabic screens were compared pixel by pixel before and after. "Continue watching" now resumes on the source you were watching (or the closest one from the same addon) without the sources list, and the title's theme song stops as soon as the sources open (issue #74). 731 automated tests pass; the English interface has not been run on a real Windows machine yet.
