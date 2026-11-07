## رِواق 0.55.0 · تجريبي / Beta — عجلة رِواق، وتحكم أوضح · Riwaq's Wheel, and Clearer Controls

### الجديد

- **العجلة** صارت التنقل الافتراضي: الوجهات على حافة عجلة تدور إلى ما تختاره وتثبت عند المؤشر، بالنقر أو Enter أو Space، والعجلة والسحب والأسهم تحرّك التركيز فقط. الشريط الجانبي باقٍ خيارًا في المظهر والواجهة ← الواجهة ← شكل التنقل.
- **أزرار ونوافذ «زجاجية»** بلون ثيمك وحافة مضيئة، أو «مصمتة» بلا شفافية. تصير معتمة تلقائيًا مع تقليل الشفافية أو الألوان الإجبارية، وكل الحركات تتوقف مع «تقليل الحركة».
- **شريط المشغل:** تشغيل وإيقاف، رجوع وتقديم، الصوت، الوقت المنقضي أو المتبقي مع المدة، شريط فصول بأسمائها يقفز عند النقر، ووقت الانتهاء بنظام 12 ساعة (#140).
- **↑ و↓** تغيّران الصوت بمؤشر صغير بدل الشريط الأبيض الكبير من MPV (#139).
- **النوافذ** ما تحرّك الصفحة خلفها، والموضع يرجع بعد إغلاق آخر نافذة (#135). زر الإغلاق بعيد عن شريط التمرير، وفي نافذة المصادر تتمرر القائمة فقط (#134).
- **صور التنزيلات** تُحفظ من بداية التنزيل، وتظهر بعد إعادة التشغيل وبلا إنترنت، مع محاولات محدودة عند الفشل المؤقت (#136).
- **مساحة التورنت** مع «احذف بعد المشاهدة» تُحرَّر بعد إغلاق آخر قارئ، وملفات القطع على ويندوز تُعلَّم sparse قبل أول كتابة (#138).
- قص ونسخ ولصق وحذف وتحديد الكل في حقول الكتابة (#131)، والبحث في منتصف مكانه، وهامش واحد للصفوف والعرض الرئيسي (#130)، وصفحة الإضافات تبدأ بالتثبيت ثم Stremio فوق Nuvio (#132)، والإعدادات تبدأ بلغة الواجهة (#133)، والوضع بالترتيب: حسب النظام، فاتح، داكن (#141)، وما فيه يد سحب فوق الفراغ بين البطاقات (#137).

### تحت الغطاء

- جلب صور التنزيل يقبل وجهات HTTPS عامة فقط، ويفحص كل تحويل والعنوان الذي سيُتصل به فعلًا، فلا يصل إلى شبكتك المحلية أو جهازك.
- ذاكرة التورنت ترفض أي رابط أو junction أو ملف مرتبط داخلها، والتنظيف محصور في مجلد العنوان نفسه.
- إيقاف التشغيل فور بدئه يُعامل إلغاءً لا خطأ اتصال، ويبقى فشل MPV الحقيقي خطأ.
- تباين أوضح لنصوص البطاقات والتذييل وأزرار الزجاج في الوضع الفاتح.

### English

- **The wheel** is the default navigation: destinations sit on the rim of a wheel that turns to what you choose and settles at the pointer. Click, Enter or Space opens one; the mouse wheel, dragging and the arrows only move focus. The sidebar stays a choice in Appearance & interface → Interface → Navigation.
- **Glass buttons and dialogs** in your theme's colours with a luminous edge, or **Solid** with no transparency. They turn opaque with reduced transparency or forced colours, and every movement stops with Reduce motion.
- **The player's bar:** play and pause, back and forward, volume, elapsed or remaining time with the length, a chapter strip with names that seeks on click, and the end time in 12-hour form (#140).
- **↑ and ↓** change the volume with a small indicator instead of MPV's large white bar (#139).
- **Dialogs** never move the page behind them, and the position returns when the last one closes (#135). The close button sits clear of the scrollbar, and only the list scrolls in the sources window (#134).
- **Download posters** are saved when a download starts and show after a restart and offline, with bounded retries after a passing failure (#136).
- **Torrent space** with "Delete after viewing" is freed once the last reader closes, and piece files on Windows are marked sparse before the first write (#138).
- Cut, Copy, Paste, Delete and Select all in text fields (#131); a centred search; one gutter for rows and the showcase (#130); the addons page starts with installing, then Stremio right above Nuvio (#132); Settings opens on the interface language (#133); Mode reads System, Light, Dark (#141); no grab hand over the gaps between cards (#137).

Under the hood: download artwork reaches only public HTTPS destinations, checking every redirect and the address actually connected, so it cannot reach your local network or this computer; the torrent cache refuses any link, junction or linked file inside it and cleans only the title's own folder; stopping a start at once is a cancellation, not a connection error, while a real MPV failure stays an error; clearer contrast for card text, footers and glass buttons in light mode.

### حدود معروفة · Known limits

- إصدار تجريبي. لم يُعتمد على HDR أو Dolby Vision أو RTX حقيقي، ولا على شاشات متعددة بدقة مختلفة أو شاشات لمس فعلية أو قارئات الشاشة، ولا بحسابات خدمات حقيقية.
- جهاز بإصدار 0.54 يزامن عبر حساب رِواق قد يعيد اختيار «الشريط الجانبي» إلى العجلة الافتراضية.
- الملفات موقّعة لتحديثات رِواق (Ed25519) لكنها غير موقّعة بشهادة ناشر ويندوز، فقد يظهر تنبيه SmartScreen.

- Beta. Real HDR, Dolby Vision and RTX output, mixed-DPI multi-monitor setups, physical touchscreens, screen readers and real provider accounts are not certified.
- A 0.54 device syncing through a Riwaq account can turn a "Sidebar" choice back into the default wheel.
- Updates are authenticated with Riwaq's Ed25519 signature; the files carry no Windows Authenticode publisher signature, so SmartScreen may warn.

### التحقق · Verification

التفاصيل وحدودها في [VERIFICATION.md](https://github.com/ABADIOSA/riwaq/blob/main/VERIFICATION.md) ومراجعة PR #142. ليس إصدار Stable.

Details and their limits are in [VERIFICATION.md](https://github.com/ABADIOSA/riwaq/blob/main/VERIFICATION.md) and the PR #142 review. This is not a Stable release.

التطبيق مجاني ومفتوح المصدر بترخيص MIT. Riwaq remains free and open source under the MIT license.
