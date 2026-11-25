## رِواق 0.57.0 · تجريبي / Beta — زجاج أوضح، وشعار رِواق، وترجمة واحدة · Clearer Glass, Riwaq's Own Mark, and One Subtitle at a Time

### الجديد

- **زجاج بثلاث طبقات** (#158): الأزرار والاختيارات يضيئها الضوء من الأعلى، بقبة انعكاس تنتهي فوق النص وحافة علوية لامعة وضوء يتجمع عند قاعدتها وظل من جزأين (حيث يلمس الصفحة وحوله). القوائم العائمة (قائمة إجراءات العمل وأوقات الصلاة والتنبيهات وتلميحات العجلة) بزجاج أكثف وضبابية خلفها. والنوافذ بانعكاس عريض فوق رأسها وحبيبات خفيفة كالزجاج المصنفر وأعمق ظل. لكل حالة شكلها: عادي، ومرور، وضغط، ومختار (يضيئه لون التمييز)، وتركيز. النص بنفس وضوحه.
- **الزجاج المصمت وتقليل الشفافية والألوان الإجبارية** تبقي كل الطبقات معتمة بلا انعكاس ولا حبيبات ولا ضبابية، و«تقليل الحركة» كما كان.
- **شعار رِواق الرسمي** (#159): الأقواس الثلاثة من أيقونة التطبيق أعلى الشاشة بدل الأعمدة المائلة. يظهر الشعار وحده حين تكون العجلة مصغّرة أو القائمة الجانبية مطوية أو النافذة ضيقة، ومعه اسم «رِواق» حين تتّسع العجلة أو القائمة، ورأس درج التنقل في الشاشات الضيقة يحمل الشعار والاسم. يقف الشعار على محور أيقونات التنقل، والنقر عليه يفتح الرئيسية من أولها كما كان.
- **صفحة «الشعار والأيقونة»:** لون الشعار (لون التمييز أو ذهبي رِواق) مع معاينة الحالتين، وأيقونة شريط المهام كما هي. أُزيلت «الشعار والاسم» و«الشعار فقط» و«الاسم فقط» و«صورتي» وحقل رابط الصورة. ذهبي رِواق صار أعمق على الصفحات الفاتحة ليبقى واضحًا.
- **«Download subtitle»** (#157): في الواجهة الإنجليزية صار الخيار ورسائله بالمفرد لأنه يحفظ ملف ترجمة واحدًا بلغة واحدة. وإذا تشابه اسما ترجمتين في قائمة الاختيار تُرقَّمان. العربية «تنزيل الترجمة» كما هي.

### تحت الغطاء

- قائمة إجراءات العمل (الزر الأيمن على البطاقة) لم تأخذ زجاجها في 0.56.0 لأن القاعدة كانت تستهدف اسمًا غير موجود؛ صارت زجاجية الآن.
- أسهم الصفوف كانت تضبّب ما خلفها (زران في كل صف) فتُعاد رسمها مع كل تمرير؛ صارت بتعبئة أكثف بلا ضبابية.
- الإعدادات القديمة للشعار (`logoStyle` و`logoImage`) تبقى محفوظة كما هي ولا تُقرأ: جهاز ما زال على 0.56.0 في نفس الحساب، والنسخ الاحتياطية، والسمات المشاركة تحتفظ بقيمها، ولا يُطلب أي رابط صورة شعار. لا تغيير في خدمة الحسابات أو المزامنة أو التخزين المشفّر أو التشغيل أو التحديثات.
- Flutter قُيّم مجددًا مع مرجع VyseTV (تطبيق Flutter بترخيص GPL-3.0): لم يُعتمد، ولم يُنسخ منه أي كود أو صورة؛ دُرست لقطاته العامة كمرجع بصري فقط (docs/ISSUE-158-GLASS-FLUTTER.md، docs/GLASS-MATERIAL-0.57.md).

### English

- **Glass in three levels** (#158): buttons and choices are lit from above, with a dome of reflection that ends above the text, a bright top edge, light gathered at the foot and a shadow in two parts (where it touches the page, and around it). Floating menus (a title's actions, prayer times, notices, the wheel's tooltips) use a denser glass that blurs what is behind them. Dialogs carry a broad reflection over their head, a faint frosted grain and the deepest shadow. Each state has its own look: rest, hover, pressed, chosen (lit by the accent) and focus. Text reads as clearly as before.
- **Solid glass, reduced transparency and forced colours** keep every level opaque, with no reflection, grain or blur; reduced motion is unchanged.
- **Riwaq's official mark** (#159): the three arches of the app icon in the top bar, replacing the slanted bars. The mark shows on its own when the wheel is compact, the sidebar collapsed or the window narrow, and with the name "Riwaq" when the wheel or sidebar is expanded; the narrow navigation drawer is headed by the mark and the name. The mark stands on the axis of the navigation's icons, and clicking it still opens Home at its start.
- **The "Logo & icon" page:** the logo's colour (accent or Riwaq gold) with a preview of both states, and the taskbar icon as before. "Logo and name", "Logo only", "Name only", "My image" and the picture link are gone. Riwaq gold is deeper on light pages so it stays visible.
- **"Download subtitle"** (#157): the item and its messages are singular in English, since it saves one subtitle file in one language, and two subtitles with the same name in the choice list are numbered. The Arabic «تنزيل الترجمة» is unchanged.

Under the hood: a title's actions menu (right click on a card) never got its glass in 0.56.0, because the rule named a class nothing has; it is glass now. Row arrows blurred what was behind them (two per row, repainted on every scroll); they now use a denser fill with no blur. The retired logo settings (`logoStyle`, `logoImage`) stay saved as they are and are never read: a device still on 0.56.0 in the same account, backups and shared themes keep their values, and no logo picture is ever requested. Nothing changed in the account service, sync, encrypted storage, playback or updates. Flutter was assessed again with the VyseTV reference (a GPL-3.0 Flutter app) and not adopted; none of its code or artwork was copied, and its public screenshots were studied for visual direction only.

### حدود معروفة · Known limits

- إصدار تجريبي. لم يُقَس أداء الزجاج على بطاقة رسومات ويندوز حقيقية: القياسات من Chromium دون واجهة على لينكس.
- جهاز ما زال على 0.56.0 يعرض الشعار بالنمط أو الصورة التي اختارها عليه حتى يُحدَّث.
- لم يُعتمد على HDR أو Dolby Vision أو RTX حقيقي، ولا على شاشات متعددة بدقة مختلفة أو شاشات لمس فعلية أو قارئات الشاشة، ولا بحسابات خدمات حقيقية.
- الترجمة المدمجة داخل ملف الفيديو لا تُحفظ منفصلة.
- الملفات موقّعة لتحديثات رِواق (Ed25519) لكنها غير موقّعة بشهادة ناشر ويندوز، فقد يظهر تنبيه SmartScreen.

- Beta. The glass has not been measured on a real Windows GPU: the measurements come from headless Chromium on Linux.
- A device still on 0.56.0 shows the logo style or picture chosen on it until it updates.
- Real HDR, Dolby Vision and RTX output, mixed-DPI multi-monitor setups, physical touchscreens, screen readers and real provider accounts are not certified.
- Subtitles embedded inside a video file are not saved separately.
- Updates are authenticated with Riwaq's Ed25519 signature; the files carry no Windows Authenticode publisher signature, so SmartScreen may warn.

### التحقق · Verification

التفاصيل وحدودها في [VERIFICATION.md](https://github.com/ABADIOSA/riwaq/blob/main/VERIFICATION.md) و[docs/GLASS-MATERIAL-0.57.md](https://github.com/ABADIOSA/riwaq/blob/main/docs/GLASS-MATERIAL-0.57.md). ليس إصدار Stable.

Details and their limits are in [VERIFICATION.md](https://github.com/ABADIOSA/riwaq/blob/main/VERIFICATION.md) and [docs/GLASS-MATERIAL-0.57.md](https://github.com/ABADIOSA/riwaq/blob/main/docs/GLASS-MATERIAL-0.57.md). This is not a Stable release.

التطبيق مجاني ومفتوح المصدر بترخيص MIT. Riwaq remains free and open source under the MIT license.
