## رِواق 0.53.0 · تجريبي / Beta

- «عرض الكل» صار صفحة داخل التطبيق بشبكة واسعة تملأ المساحة، مع تبويب لكل كتالوج وفلاتره، وتحميل تلقائي كلما نزلت، والرجوع يعيدك لنفس الصف.
- الرئيسية تبدأ بما تشاهده: «نكمل الحكاية» أولًا، وجلسة اليوم شريط مختصر يتوسع بزر «عرض أوسع»، وبوصلة الذوق مطوية حتى تحتاجها.
- قائمة الفيديو توضح أن مصدر التورنت بلا ملف تورنت منفصل، فرابط المغناطيس هو ما يُنسخ.
- الصور داخل الصفوف لا تتحول إلى سحب صورة عندما تسحب الصف بالفأرة.

### English

- See all is a page inside the app again: a wide grid that fills the space, a tab and filters per catalog, more titles as you scroll, and Back returns you to the same row.
- Home starts with something to watch: Continue watching first, Today's session as a compact band that Show full widens, and the Taste compass folded until you need it.
- The video menu explains that a torrent source has no separate torrent file, so the magnet link is what gets copied.
- Pictures in rows no longer turn into image drags when you drag a row with the mouse.

«نسخ رابط التورنت» المطلوب في #113 غير موجود عن قصد: المصادر لا تحمل ملف ‎.torrent‎ منفصلًا، والزر القديم كان ينسخ نفس رابط المغناطيس. لم نستطع إعادة إنتاج #111 على هذه النسخة أو السابقة؛ منع سحب الصور حماية إضافية فقط. جلسة اليوم وبوصلة الذوق باقيتان بكل إعداداتهما. التطبيق مجاني بالكامل، ولا تغيير للتشفير أو موافقة مشاركة الاستخدام. يتضمن #120 للبلاغين #112 و#113؛ البحث والتصميم والتحقق في docs/UI-RESEARCH-2026-10-28.md وdocs/UI-DESIGN-2026-10-28.md وdocs/UI-VERIFICATION-2026-10-28.md.

The "Copy torrent link" asked for in #113 is left out on purpose: sources carry no separate .torrent file, and the old item copied the same magnet link. #111 could not be reproduced on this or the previous version; the image-drag guard is hardening only. Today's session and the Taste compass keep every setting. The app remains free, with encryption and usage-sharing consent unchanged. Includes #120 for issues #112 and #113; research, design and verification are in docs/UI-RESEARCH-2026-10-28.md, docs/UI-DESIGN-2026-10-28.md and docs/UI-VERIFICATION-2026-10-28.md.

تحقق المصدر: 932 اختبارًا، التنسيق، بناء سطح المكتب والويب، واختبار Chromium الكامل مع 22 فحص جودة، و39 فحصًا لرحلة التصفح، و64 فحص مكونات، ولوحة مفاتيح المشغّل. لم تُشغَّل فحوص MPV الفعلية على ويندوز لهذا التغيير؛ مسار الإصدار يشغّل الاختبارات على ويندوز ويبني الحزم ويوقّعها. لا اعتماد HDR حقيقي أو حسابات مزودين خارجية. ليس إصدار Stable.

Source validation: 932 tests, formatting, desktop/web builds, the full Chromium smoke with 22 quality checks, 39 browsing-journey checks, 64 component checks and the player keyboard. Real Windows MPV checks were not run for this change; the release workflow runs the tests on Windows and builds and signs the packages. This does not certify real HDR or external provider accounts. This is not a Stable release.
