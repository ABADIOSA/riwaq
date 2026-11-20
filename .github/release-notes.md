## رِواق 0.56.0 · تجريبي / Beta — فلاتر المصادر، ومجموعات تتحرك، وترجمة تحفظها · Source Filters, Moving Collections, and Subtitles to Keep

### الجديد

- **«تنزيل الترجمة»** في قائمة المشغل مباشرة تحت «تنزيل الفيديو» (#157): تحفظ الترجمة المختارة، واسمها ولغتها ظاهران تحت الخيار، في المكان الذي تختاره من نافذة الحفظ في ويندوز. إذا كانت هناك أكثر من ترجمة ولا واحدة مختارة تظهر قائمة صغيرة لتختار. تُحفظ ترجمات الإضافات والملفات التي فتحتها بنفسك (SRT وWebVTT وASS/SSA) كما وصلت؛ أما الترجمة المدمجة داخل ملف الفيديو فلا تُحفظ منفصلة، ويقول الخيار ذلك.
- **فلاتر متقدمة في نافذة المصادر** (#154): الدقة، نوع الإصدار (REMUX منفصل عن الدقة)، النطاق الديناميكي، الترميز، صيغ الصوت والقنوات، نوع المصدر، خدمة Debrid، الترجمة واللغة، والإضافة. «و» بين المجموعات و«أو» داخلها، مع العدد بجانب كل خيار، وتتذكرها لكل ملف شخصي إن طلبت.
- **مظهر شارات المصادر** (#152): شارات رِواق، أو زجاج سائل، أو أنماط FR Glass وFR Frost وMinimal من FR-Badges (MIT، صورها تُجلب من GitHub إن اخترتها). أُزيلت حزم Harbor، وحذف المرشح صار بلا تأكيد مع «تراجع» (#153).
- **المجموعات:** غلاف GIF يتحرك فقط عند المرور أو التركيز، وصور من جهازك لا تغادره، واستيراد نوفيو وتصديره بكل حقول العرض مع تقرير ودمج أو إضافة أو استبدال، وقوالب رِواق الجاهزة.
- **شريط المشغل:** كل الأزرار في مربعات زجاجية ثابتة و«ينتهي» على خطها (#144، #151)، ودائرة صغيرة لمستوى الصوت بالمفاتيح والعجلة دون إظهار الأدوات (#147، #145)، وقائمة السياق بعرض أطول عنصر (#150).
- **التنقل:** الرئيسية واكتشف والشعار تفتح صفحتها من أولها، والرجوع يعيدك إلى موضعك (#156)؛ العجلة بلا خطوط خارجية (#146)؛ خيار لإخفاء «بوصلة ذوقك» وتصنيفات «اكتشف» تحت خط واحد (#148)؛ وبلا فراغ بجانب شريط التمرير (#149).

### تحت الغطاء

- **حساب رِواق مع أجهزة على إصدار أقدم:** حذف آخر مصدر قنوات مباشرة، والخروج من Stremio، وحذف إضافة مُعدّة، ومسح معرّف Discord تبقى كما هي على الأجهزة المحدّثة حتى لو زامن جهاز ما زال على 0.55، بعد إعادة التشغيل وانضمام جهاز جديد والتعارض. الجهاز على 0.55 يحذف مصدره الأخير أيضًا. وإعدادات هذا الإصدار الجديدة لم تعد ترجع إلى الافتراضي حين يزامن جهاز أقدم. لا تغيير في الخادم.
- كل ما يُكتب يُحفظ قبل أن يُرسل أو يُزامن، والحذف المرفوض يُعاد كما كان؛ التنزيلات لا تُحذف قبل أن يُكتب حذف ملفها الشخصي؛ والموافقة على الإحصاءات أو تتبع المشاهدة لا تفتح أي اتصال قبل أن تُحفظ.
- استيراد Stremio يكتب فقط في الملف الشخصي والجلسة اللذين طُلب فيهما، وتجديد رمز Simkl أثناء فصل الحساب لا يضيع ولا يعود بعد الفصل.
- خدمة الحسابات في نسختها التالية تربط الجلسات والبيانات بنسخة الحساب نفسها، وتُنشر إلى الإنتاج يدويًا وبشكل منفصل عن هذا الإصدار؛ التطبيق يعمل مع الخدمة الحالية والتالية.

### English

- **"Download subtitles"** in the player menu, right under "Download video" (#157): saves the selected subtitles, with their name and language shown under the item, wherever you choose in Windows' Save dialog. With several and none selected, a short list lets you pick. Subtitles from addons and files you opened yourself (SRT, WebVTT, ASS/SSA) are saved as they came; subtitles embedded inside the video file are not saved separately, and the item says so.
- **Advanced filters in the sources window** (#154): resolution, release type (REMUX apart from resolution), dynamic range, codec, audio formats and channels, source type, debrid service, subtitles and language, and addon. AND across groups and OR within them, with a count beside each choice, remembered per profile if you ask.
- **Stream badge appearance** (#152): Riwaq's badges, Liquid Glass, or FR-Badges' FR Glass, FR Frost and Minimal styles (MIT; their pictures load from GitHub if you choose one). Harbor packs are gone, and deleting a filter no longer asks first and offers Undo (#153).
- **Collections:** GIF covers that move only under the pointer or focus, pictures from your computer that never leave it, Nuvio import and export with every display field plus a report and merge/add/replace, and Riwaq's ready templates.
- **Player bar:** every control in a steady glass chip with Ends on its line (#144, #151), a small round volume level for keys and the wheel without waking the controls (#147, #145), and a context menu as wide as its longest item (#150).
- **Navigation:** Home, Discover and the logo open their page at its start, and Back returns you to where you were (#156); a wheel without outer lines (#146); a switch for the taste compass and Discover's tabs under one line (#148); no band beside the scrollbar (#149).

Under the hood: with a Riwaq account and a device still on 0.55, removing the last Live TV source, signing out of Stremio, removing a configured addon and clearing the Discord app ID now stay that way on updated devices through restarts, a new device joining and conflicts, and the 0.55 device drops its last source too; this version's new settings no longer fall back to their defaults when an older device syncs; no server change. Every change is written before it is sent or synced, and a refused write is undone; downloads are deleted only after their profile's removal is written; opting in to statistics or tracking opens no connection until the choice is saved. A Stremio import writes only into the profile and session it was asked under, and a Simkl refresh during a disconnect is neither lost nor brought back. The account service's next version binds sessions and data to the account instance; it is deployed to production by hand, separately from this release, and the app works with the current service and the next one.

### حدود معروفة · Known limits

- إصدار تجريبي. لم يُعتمد على HDR أو Dolby Vision أو RTX حقيقي، ولا على شاشات متعددة بدقة مختلفة أو شاشات لمس فعلية أو قارئات الشاشة، ولا بحسابات خدمات حقيقية.
- الجهاز الذي ما زال على 0.55 يحتفظ على نفسه بمفتاح Stremio والإضافة المُعدّة ومعرّف Discord التي حُذفت من جهاز آخر حتى يُحدَّث أو تحذفها منه؛ الأجهزة المحدّثة لا تأخذها. والخروج من Stremio في رِواق لا ينهي الجلسة عند Stremio نفسه.
- جهاز ينضم إلى الحساب بينما آخر نسخة رفعها جهاز على 0.55 يرى إعدادات هذا الإصدار الجديدة بقيمها الافتراضية حتى يرفع جهاز محدّث.
- الترجمة المدمجة داخل ملف الفيديو لا تُحفظ منفصلة.
- الملفات موقّعة لتحديثات رِواق (Ed25519) لكنها غير موقّعة بشهادة ناشر ويندوز، فقد يظهر تنبيه SmartScreen.

- Beta. Real HDR, Dolby Vision and RTX output, mixed-DPI multi-monitor setups, physical touchscreens, screen readers and real provider accounts are not certified.
- A device still on 0.55 keeps its own Stremio key, configured addon and Discord app ID that another device removed until it updates or you remove them there; updated devices do not take them back. Signing out of Stremio in Riwaq does not end the session at Stremio itself.
- A device joining the account while the newest copy came from a 0.55 device sees this version's new settings at their defaults until an updated device uploads.
- Subtitles embedded inside a video file are not saved separately.
- Updates are authenticated with Riwaq's Ed25519 signature; the files carry no Windows Authenticode publisher signature, so SmartScreen may warn.

### التحقق · Verification

التفاصيل وحدودها في [VERIFICATION.md](https://github.com/ABADIOSA/riwaq/blob/main/VERIFICATION.md) ومراجعة PR #155 ([docs/REVIEW-PR-155.md](https://github.com/ABADIOSA/riwaq/blob/main/docs/REVIEW-PR-155.md)). ليس إصدار Stable.

Details and their limits are in [VERIFICATION.md](https://github.com/ABADIOSA/riwaq/blob/main/VERIFICATION.md) and the PR #155 review ([docs/REVIEW-PR-155.md](https://github.com/ABADIOSA/riwaq/blob/main/docs/REVIEW-PR-155.md)). This is not a Stable release.

التطبيق مجاني ومفتوح المصدر بترخيص MIT. Riwaq remains free and open source under the MIT license.
