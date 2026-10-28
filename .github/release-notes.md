## رِواق 0.53.1 · تجريبي / Beta

- قائمة الفيديو صارت بالضبط كما طُلب في #113: لقطة شاشة، ونسخ رابط التورنت، ونسخ رابط المغناطيس، وتنزيل الفيديو.
- «نسخ رابط التورنت» ينسخ رابط التشغيل على جهازك، فتفتح نفس الحلقة في VLC أو أي مشغّل ثاني ما دام التورنت شغّال في رِواق. و«نسخ رابط المغناطيس» هو اللي تشاركه.
- روابط debrid وJellyfin/Emby ما تُنسخ أبدًا: الرابط يُنسخ فقط من محرك التورنت على جهازك.

### English

- The video menu is exactly what #113 asked for: Take a screenshot, Copy torrent link, Copy magnet link, Download video.
- Copy torrent link copies the address the torrent plays from on your computer, so you can open the same episode in VLC or another player while it plays in Riwaq. Copy magnet link is the one to share.
- Debrid and Jellyfin/Emby addresses are never copied: only the torrent engine's own address on your computer is.

«نسخ رابط التورنت» ينسخ عنوان التشغيل على هذا الجهاز (خدمة Stremio أو المحرك المدمج أو TorrServer)، ويعمل في مشغّل آخر على نفس الجهاز ما دام التورنت شغّالًا في رِواق؛ ما يصلح للمشاركة، وللمشاركة رابط المغناطيس. أي عنوان آخر ما يُنسخ، والزر يتعطل مع سبب إذا ما فيه عنوان من محرك على الجهاز. رِواق ما يخترع ملف ‎.torrent‎. يكمل #113. التطبيق مجاني بالكامل، ولا تغيير للتشفير أو موافقة مشاركة الاستخدام.

"Copy torrent link" copies the address the torrent plays from on this computer (Stremio Service, the built-in engine or TorrServer). It works in another player on the same computer while the torrent plays in Riwaq; it is not for sharing, which is what the magnet link is for. No other address is ever copied, and the item is disabled with a reason when there is no engine address on this computer. Riwaq does not invent a .torrent file. Completes #113. The app remains free, with encryption and usage-sharing consent unchanged.

تحقق المصدر: 934 اختبارًا، والتنسيق، وبناء سطح المكتب والويب، و30 فحصًا في Chromium لقائمة المشغّل والتنزيلات بالعربية والإنجليزية، واختبار الموقع الكامل في CI. لم يُجرَّب تورنت حقيقي على ويندوز مع فتح الرابط المنسوخ في VLC؛ مسار الإصدار يشغّل الاختبارات على ويندوز ويبني الحزم ويوقّعها. ليس إصدار Stable.

Source validation: 934 tests, formatting, desktop/web builds, 30 Chromium checks of the player menu and downloads in Arabic and English, and the full site smoke in CI. A real torrent on Windows with the copied address opened in VLC was not tried; the release workflow runs the tests on Windows and builds and signs the packages. This is not a Stable release.

إذا أعجبك رِواق، ضع له نجمة ⭐ على GitHub ليصل إلى ناس أكثر. If you like Riwaq, give it a ⭐ on GitHub so it reaches more people.
