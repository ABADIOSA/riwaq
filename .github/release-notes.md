## رِواق 0.54.0 · تجريبي / Beta — رِواق أوضح، وأقرب لذوقك · A More Personal, Polished and Reliable Riwaq

### الجديد

- **الإعدادات في ست غرف واضحة:** المظهر والواجهة، المشغل والتشغيل، المصادر والمكتبة، التنزيلات والملفات، الحسابات والربط، النظام والتشخيص. ما فيه «أساسية» و«متقدمة»، وكل خيار له مكان واحد، ومعها صفحات جديدة للملفات الشخصية والتنزيلات والخصوصية (#127).
- **وضع فاتح «أبيض نقي»** مع داكن وحسب النظام، من المظهر والواجهة ← السمة. يتبع ويندوز مباشرة، ولون ثيمك يتعمّق ليُقرأ على الأبيض، وشريط عنوان النافذة يتبع الملف الشخصي والوضع (#126).
- **العرض الرئيسي** بنفس المسافة من الأعلى والجانبين (#125).
- **أسهم التنقل** زوج متجاور جنب عنوان كل صف: طاقم التمثيل والسلسلة والعد التنازلي والحلقات والتبويبات (#122).
- **السحب بالفأرة** لأعلى ولأسفل فوق شبكات البوسترات وصفوفها، والضغطة القصيرة تفتح العمل كالعادة (#111).
- **أزرار الربط بالإنجليزية** صارت «Link Trakt» و«Link Simkl» و«Link AniList» (#124).
- **سياسة خصوصية** بالعربية والإنجليزية في النظام والتشخيص ← الخصوصية، تشرح ما يبقى على جهازك وما يُرسل ولمن.

### تحت الغطاء

- ذاكرة التورنت أكثر أمانًا: بقايا الإغلاق المفاجئ تُحذف عند التشغيل التالي، والتنظيف ما يتبع أي رابط أو اختصار مجلد ولا يلمس تنزيلاتك (#123).
- Electron 44.9.3 وVite 8.3.5 مع إصلاحات أمنية، وتثبيت نسخ أدوات البناء.
- إصلاح خيارات المظهر اللي كانت تختار الخيار الأول عند الضغط على عنوانها.

### English

- **Settings in six clear rooms:** Appearance & interface, Player & playback, Sources & library, Downloads & files, Accounts & linking, System & diagnostics. No Basic or Advanced split, every option has one place, with new Profiles, Downloads and Privacy pages (#127).
- **A Pure White light mode** alongside dark and System, in Appearance & interface → Theme. It follows Windows live, your theme's accent deepens to read on white, and the window's title bar follows the profile and mode (#126).
- **The showcase** sits the same distance from the top and both sides (#125).
- **Row arrows** are one adjacent pair beside each row's title: cast, series, countdowns, episodes and tabs (#122).
- **Mouse dragging** up and down over poster grids and rows; a short click still opens the title (#111).
- **Link buttons in English** read "Link Trakt", "Link Simkl" and "Link AniList" (#124).
- **A privacy policy** in Arabic and English under System & diagnostics → Privacy, explaining what stays on your device, what is sent and to whom.

Under the hood: safer torrent-cache cleanup (pieces left by a crash are removed at the next start; cleanup never follows a link or junction and never touches your downloads, #123); Electron 44.9.3 and Vite 8.3.5 with security fixes, and pinned build tools; appearance options no longer pick their first choice when you click their caption.

### حدود معروفة · Known limits

- إصدار تجريبي. لم يُعتمد على HDR أو Dolby Vision أو RTX حقيقي، ولا على شاشات متعددة بدقة مختلفة أو شاشات لمس أو قارئات الشاشة، ولا بحسابات خدمات حقيقية.
- إلغاء التشغيل فور بدئه قد يعرض رسالة اتصال، مع أن الإيقاف يتم بأمان ولا يبقى مشغّل يعمل. موجود قبل هذا الإصدار، وإصلاحه منفصل.
- الملفات موقّعة لتحديثات رِواق (Ed25519) لكنها غير موقّعة بشهادة ناشر ويندوز، فقد يظهر تنبيه SmartScreen.

- Beta. Real HDR, Dolby Vision and RTX output, mixed-DPI multi-monitor setups, touchscreens, screen readers and real provider accounts are not certified.
- Cancelling a start immediately can show a connection message even though playback stops safely and no player is left running. This predates the release and is tracked separately.
- Updates are authenticated with Riwaq's Ed25519 signature; the files carry no Windows Authenticode publisher signature, so SmartScreen may warn.

### التحقق · Verification

962 اختبارًا، والتنسيق، وبناء سطح المكتب والويب، وفحوص Chromium للواجهة والموقع كامل. مراجعة مستقلة على ويندوز شغّلت Electron وMPV فعليًا (الحلقة المدمجة والنافذة المنفصلة، الاستعادة بـ F8، التنزيلات، الملفات الشخصية، الحزمة المحمولة والمثبّت وترقية معزولة) مع حدودها المذكورة في [docs/REVIEW-PR-128.md](https://github.com/ABADIOSA/riwaq/blob/main/docs/REVIEW-PR-128.md). مسار الإصدار يشغّل الاختبارات على ويندوز ويبني الحزم ويوقّع ملف التحديث. ليس إصدار Stable.

962 tests, formatting, desktop and web builds, Chromium interface checks and the full site smoke. An independent Windows review ran the real Electron and MPV (embedded and separate window, F8 recovery, downloads, profiles, the portable build, the installer and an isolated upgrade), with the limits recorded in [docs/REVIEW-PR-128.md](https://github.com/ABADIOSA/riwaq/blob/main/docs/REVIEW-PR-128.md). The release workflow runs the tests on Windows, builds the packages and signs the update manifest. This is not a Stable release.

التطبيق مجاني ومفتوح المصدر بترخيص MIT. Riwaq remains free and open source under the MIT license.
