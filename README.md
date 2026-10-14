<p align="center">
  <img src="assets/icon.png" width="128" height="128" alt="شعار رِواق — Riwaq logo">
</p>

<h1 align="center">رِواق · Riwaq</h1>

<p align="center">
  <b>مساحة للحكاية</b> — عميل عربي لإضافات Stremio على ويندوز والويب<br>
  <b>A space for stories</b> — an Arabic-first Stremio addon client for Windows and the web
</p>

<p align="center">
  <a href="https://github.com/ABADIOSA/riwaq/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/ABADIOSA/riwaq?include_prereleases&label=release&color=e7b66e"></a>
  <img alt="Windows x64" src="https://img.shields.io/badge/Windows-x64-15191e">
  <a href="https://abadiosa.github.io/riwaq/"><img alt="Web" src="https://img.shields.io/badge/web-abadiosa.github.io%2Friwaq-15191e"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-15191e"></a>
</p>

<p align="center"><a href="#العربية">العربية</a> · <a href="#english">English</a></p>

---

<div dir="rtl">

## العربية

رِواق يجمع إضافات Stremio في واجهة عربية من اليمين لليسار، مع مشغّل MPV داخل نافذة التطبيق، ومحرّك مصادر يشرح ليش رتّب المصادر كذا، وبث مباشر بدليل برامج، وملفات شخصية بحماية أبوية. رِواق ما يوفّر أي محتوى: كل شي يجي من إضافاتك واشتراكاتك.

### التنزيل

| النسخة                         | الملف                                                         |
| ------------------------------ | ------------------------------------------------------------- |
| المثبّت (يتحدّث من داخل رِواق) | `Riwaq-Setup-0.45.0-win-x64.exe`                              |
| النسخة المحمولة                | `Riwaq-0.45.0-win-x64.exe`                                    |
| من المتصفح بدون تحميل          | [abadiosa.github.io/riwaq](https://abadiosa.github.io/riwaq/) |

الملفات في [صفحة الإصدارات](https://github.com/ABADIOSA/riwaq/releases/latest)، ومعها `SHA256SUMS.txt` للتحقق من البصمة. الملف غير موقّع بشهادة ناشر ويندوز، فقد يظهر تنبيه SmartScreen.

### الجديد في 0.45.0

إصلاحات واقتراحات من ملاحظات مستخدم على 0.44.1 ([#82](https://github.com/ABADIOSA/riwaq/issues/82)):

- **إغلاق رِواق أثناء المشاهدة** صار يقفل التطبيق صح، بدون رسالة «Object has been destroyed» وبدون ما تبقى نافذة MPV سودا.
- **التورنت بالمحرك المدمج:** عدد المشاركين والسرعة تحت «جاري تجهيز المشاهدة»، والتورنت اللي ما يوصل منه شي خلال 40 ثانية ينتقل للمصدر التالي بدل الشاشة السودا.
- **شريط الصوت** يتحرك مع الفأرة فوراً، ويمتلي عند 100%، والتعزيز فوقها جزء ثاني بلون مختلف. ونقرة على صورة MPV توقفها مؤقتاً.
- **«نكمل الحكاية»:** زر لإزالة عمل وتقدّمك يبقى. وزر لإخفاء اقتراح ربط ستريميو.
- **أسهم الصفوف** بجانب «عرض الكل» بدل ما تكون فوق البوسترات. ترجع للطريقة القديمة من **الإعدادات ← المصادر والمكتبة ← بطاقات الملصقات**.
- **لغة الواجهة** صارت في **الإعدادات ← المظهر ← لغة الواجهة**، والواجهة الإنجليزية تعرض المعرض وأسماء فريق العمل بالإنجليزي.

الإصدارات السابقة كلها في [سجل الإصدارات](docs/CHANGELOG.md).

### أبرز ما فيه

- **مشغّل داخل النافذة:**
  - الترجمة والصوت في لوحة جنب الصورة.
  - تخطي المقدمة، ومعاينة على شريط التقديم.
  - RTX وHDR والشيدرات، ومؤقت نوم.
- **محرّك مصادر يشرح قراراته:** كل استبعاد وكل نقطة لها سبب ظاهر، والترجمة العربية والدبلجة كلٌّ في مكانه.
- **رئيسية واكتشف بتصنيف رِواق:** مجموعات ومجلدات مثل نوفيو، و«جلسة اليوم» على قد وقتك.
- **بث مباشر:** قوائم M3U واشتراكات Xtream تملكها، مع دليل البرامج.
- **ربط ومزامنة:**
  - Trakt وSimkl وAniList وLetterboxd.
  - حساب رِواق اختياري مشفّر بين أجهزتك والموقع.
  - نسخ احتياطي مشفّر بعبارة مرور.
- **ملفات شخصية:** حتى ستة، مع رمز حماية وأقسام تنقفل.
- **موسيقى:** أغانيك المحلية، والتحكم بـ Spotify، وأغنية كل عمل.
- **أوقات الصلاة:** تنحسب على جهازك، بدون إنترنت.
- **بالعربي أو بالإنجليزي:** واجهة عربية من اليمين لليسار، أو إنجليزية من اليسار لليمين.

### البدء

1. افتح **حساب ستريميو** وسجّل دخولك من صفحة ستريميو الرسمية، فيستورد رِواق إضافاتك ومكتبتك ومواضع مشاهدتك. أو أضف روابط `manifest.json` بنفسك.
2. اختر عملاً، ثم الحلقة والمصدر. الفيديو يشتغل داخل رِواق.
3. من **الإعدادات ← مزوّدو البيانات الوصفية** أضف مفاتيحك (TMDB وغيره) لو تبغى أوصافاً عربية وصوراً أكثر.
4. من **الإعدادات ← الحسابات والربط** اربط Trakt أو Simkl أو AniList، أو أنشئ حساب رِواق.
5. مصادر التورنت تحتاج محركاً: **المحرك المدمج** من **الإعدادات ← محرك P2P**، أو **Stremio Service** شغّال على جهازك. الروابط المباشرة ما تحتاج شي.

### الخصوصية والحدود

- مفاتيحك وحساباتك تنحفظ مشفّرة على جهازك. رِواق ما يطلب كلمات مرور المنصات، وما يرسل سجل مشاهدتك إلا للمنصات اللي تفعّل التسجيل فيها.
- صندوق الإشعارات يقرأ ملف الإشعارات العام من GitHub عند فتح رِواق وكل 15 دقيقة، بدون أي بيانات عنك. تقدر توقفه من نافذة الإشعارات.
- استيراد Stremio باتجاه واحد إلى رِواق.
- اختبارات المنصات استخدمت المحاكاة، ولم تُجرَّب الشيدرات على كرت شاشة حقيقي ولا الواجهة الإنجليزية ولا محرك التورنت المدمج على ويندوز حقيقي بعد. [ما اختُبر فعلاً وما لم يُختبر](VERIFICATION.md).

### البناء من المصدر

ابنِ على ويندوز x64 مع Node.js 24. البناء من Linux أو macOS ينتج نسخة ما يشتغل فيها سطح الفيديو.

```powershell
npm ci
node scripts/fetch-mpv.mjs
npm test
npm run build
npm start
npm run package   # المثبّت والنسخة المحمولة في release/
```

نسخة الويب: `npm run build:web` ثم `node scripts/test-web.mjs`. التفاصيل في [CLAUDE.md](CLAUDE.md) و[البنية](docs/ARCHITECTURE.md) و[الويب](docs/WEB.md) و[الحسابات](docs/ACCOUNTS.md) و[التحديثات](docs/UPDATES.md).

رِواق مستقل وغير تابع لـ Stremio أو Harbor أو Nuvio. الرخصة MIT، وتراخيص الأطراف الأخرى في [THIRD-PARTY.md](THIRD-PARTY.md).

</div>

---

## English

Riwaq brings Stremio addons into a right-to-left Arabic interface, also available in English. It has an MPV player embedded in its own window and a source engine that explains how it ranks streams. It also offers live TV with a programme guide and profiles with parental locks. Riwaq supplies no content: everything comes from your own addons and subscriptions.

### Download

| Edition                               | File                                                          |
| ------------------------------------- | ------------------------------------------------------------- |
| Installer (updates itself from Riwaq) | `Riwaq-Setup-0.45.0-win-x64.exe`                              |
| Portable                              | `Riwaq-0.45.0-win-x64.exe`                                    |
| In the browser, nothing to install    | [abadiosa.github.io/riwaq](https://abadiosa.github.io/riwaq/) |

Get them from the [releases page](https://github.com/ABADIOSA/riwaq/releases/latest), with `SHA256SUMS.txt` to check them. The files carry no Windows publisher signature, so SmartScreen may warn.

### What's new in 0.45.0

Fixes and suggestions from a user's report on 0.44.1 ([#82](https://github.com/ABADIOSA/riwaq/issues/82)):

- **Closing Riwaq during a viewing** now closes the app properly, with no "Object has been destroyed" message and no black MPV window left behind.
- **Torrents on the built-in engine:** peers and speed under "Getting the viewing ready", and a torrent that sends nothing within 40 seconds moves on to the next source instead of a black screen.
- **The volume slider** follows the mouse at once and is full at 100%, with any boost after it in another colour. A click on MPV's own picture pauses.
- **"Continue watching":** a button removes a title and keeps your progress. Another hides the Stremio linking suggestion.
- **Row arrows** sit beside "See all" instead of over the posters. The old style is in **Settings → Sources & library → Poster cards**.
- **The interface language** is now in **Settings → Appearance → Interface language**, and the English interface shows the title gallery and the names in the credits in English.

Every earlier release is in the [changelog](docs/CHANGELOG.md) (Arabic).

### Highlights

- **A player inside the window:**
  - Subtitles and audio in a side panel.
  - Intro skipping and seek previews.
  - RTX, HDR, shaders and a sleep timer.
- **An explainable source engine:** every rejection and score has a visible reason, and Arabic subtitles and Arabic dubs are kept apart.
- **Home and Discover arranged by Riwaq:** Nuvio-style collections and folders, and "Today's session" sized to your time.
- **Live TV:** your own M3U playlists and Xtream subscriptions, with a programme guide.
- **Accounts and sync:**
  - Trakt, Simkl, AniList and Letterboxd.
  - An optional end-to-end encrypted Riwaq account across your devices and the web.
  - Passphrase-encrypted backups.
- **Profiles:** up to six, with a PIN and lockable rooms.
- **Music:** your local songs, Spotify control, and each title's theme song.
- **Prayer times:** computed on your machine, offline.
- **Arabic or English:** a right-to-left Arabic interface, or a left-to-right English one.

### Getting started

1. For English, open **Settings → Appearance → Interface language** and choose English.
2. Open **Stremio account** and sign in on Stremio's own page. Riwaq imports your addons, library and progress, or you can add `manifest.json` links yourself.
3. Pick a title, then an episode and a source. The video plays inside Riwaq.
4. In **Settings → Metadata providers**, add keys such as TMDB for Arabic descriptions and more artwork.
5. In **Settings → Accounts & linking**, connect Trakt, Simkl or AniList, or create a Riwaq account.
6. Torrent sources need an engine: the **built-in engine** in **Settings → P2P engine**, or **Stremio Service** running on your PC. Direct links need neither.

### Privacy and limits

- Keys and accounts are stored encrypted on your machine. Riwaq never asks for platform passwords. It sends your viewing history only to platforms where you turn tracking on.
- The notification inbox reads Riwaq's public notice file from GitHub when Riwaq opens and every 15 minutes, sending nothing about you. You can turn it off in the notifications window.
- Stremio import is one-way, into Riwaq.
- Platform tests used mocks; shaders have not yet been tried on a real GPU, nor the English interface or the built-in torrent engine on a real Windows machine. See [what was and was not tested](VERIFICATION.md).

### Building from source

Build on Windows x64 with Node.js 24. A build made on Linux or macOS produces a copy whose video surface does not work.

```powershell
npm ci
node scripts/fetch-mpv.mjs
npm test
npm run build
npm start
npm run package   # installer and portable copy in release/
```

Web edition: `npm run build:web`, then `node scripts/test-web.mjs`. More in [CLAUDE.md](CLAUDE.md), [architecture](docs/ARCHITECTURE.md), [web](docs/WEB.md), [accounts](docs/ACCOUNTS.md) and [updates](docs/UPDATES.md).

Riwaq is independent and not affiliated with Stremio, Harbor or Nuvio. MIT licensed; third-party licences are in [THIRD-PARTY.md](THIRD-PARTY.md).
