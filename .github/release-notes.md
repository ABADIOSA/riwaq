## رِواق 0.48.0 · تجريبي / Beta

- إطار معاينة ثابت ومؤشر تحميل على خط التقديم، مع تجاهل صور المواضع القديمة عند تحريك المؤشر.
- الترجمة والصوت والحلقات والمصادر بأزرار مستقلة، وزر للصورة يبدّل بين ملاءمة الشاشة وقص الأطراف والتمديد.
- نزّل مباشرة من قائمة المصادر دون تشغيل الفيديو، وأوقف التنزيل مؤقتاً واستأنفه بأمان عندما يدعم المصدر ذلك.
- خيار إخفاء «جلسة اليوم» والبدء مباشرة بصفوف الأفلام والمسلسلات، من الإعدادات الأساسية أو المظهر.
- إحصاءات استخدام اختيارية ومعطلة افتراضياً، دون إرسال اسمك أو حسابك أو سجل مشاهدتك؛ يمكنك إيقافها وطلب حذف الجهاز.
- تحديث خدمة تخطي المقدمات TheIntroDB إلى v4، مع الحفاظ على إصلاحات MPV ومزامنة Simkl وAniList.

### التنزيلات والخصوصية

التنزيل يستمر بعد إيقاف المشغل. إغلاق التطبيق يوقفه ويحفظ الجزء للاستئناف اليدوي؛ إذا لم يدعم المصدر الاستئناف الآمن يعاد من البداية. روابط انتهت صلاحيتها قد تحتاج مصدراً جديداً. لا يشمل HLS/DASH أو البث المباشر.

لوحة تنزيلات وإحصاءات خاصة داخل رِواق أدمن، ولا يوزّع أدمن ضمن التطبيق أو الموقع. الاستخدام يقيس الأجهزة المشاركة فقط، لا جميع الأشخاص، ويحتاج موافقة كل جهاز. [الخصوصية ومعنى الأرقام وإعداد الأدمن](https://github.com/ABADIOSA/riwaq/blob/main/docs/ADMIN.md#usage-dashboard).

### English

- A fixed seek-preview frame and loading indicator, with obsolete replies ignored when the pointer moves.
- Independent subtitle, audio, episode and source buttons, plus a one-click Fit/Crop/Stretch cycle.
- Download directly from the source list without playing. Pause and safely resume downloads when the source supports it.
- Hide Today's session and open Home's movie and series rows directly, from basic or appearance settings.
- Optional usage statistics are off by default, with no name, account or viewing history sent. Turn them off and request device deletion at any time.
- TheIntroDB intro skipping now uses v4, preserving the MPV, Simkl and AniList fixes.

Downloads continue after stopping the player; exiting the app pauses them for explicit resume. Unsafe or unsupported resume restarts from the beginning, and expired URLs may need a new source. HLS/DASH and live downloads are unsupported. The separate private Admin dashboard counts download events and consenting devices, not all unique people, and is not shipped publicly.

### التحقق / Verification

882 اختباراً ناجحاً، وبناء ويندوز والويب، واختبارات Chromium والحسابات المشفرة، واختبارات Windows/MPV الفعلية وأدوات المشغل والتنزيل دون إنترنت. ملف التحديث موقّع Ed25519 للتحقق داخل رِواق؛ هذا مختلف عن شهادة ناشر Windows (Authenticode غير مهيأة). لا تُدّعى مصادقة عتاد HDR أو كل حساب خارجي أو مصدر عام. التطبيق مجاني، دون اشتراك أو DRM أو قيود مدفوعة.

[تفاصيل الاختبار وحدوده](https://github.com/ABADIOSA/riwaq/blob/main/docs/USER-FIXES-2026-10-18.md).
