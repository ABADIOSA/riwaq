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
| المثبّت (يتحدّث من داخل رِواق) | `Riwaq-Setup-0.41.0-win-x64.exe`                              |
| النسخة المحمولة                | `Riwaq-0.41.0-win-x64.exe`                                    |
| من المتصفح بدون تحميل          | [abadiosa.github.io/riwaq](https://abadiosa.github.io/riwaq/) |

الملفات في [صفحة الإصدارات](https://github.com/ABADIOSA/riwaq/releases/latest)، ومعها `SHA256SUMS.txt` للتحقق من البصمة. الملف غير موقّع بشهادة ناشر ويندوز، فقد يظهر تنبيه SmartScreen.

### الجديد في 0.41.0

- **شيدرات GLSL مثل Harbor:**
  - أوضاع Anime4K الاثنا عشر، وFSRCNNX للأفلام.
  - رِواق ما يرفق أي شيدر: زر «تنزيل» يجيب الإصدار الرسمي من GitHub ويتحقق من بصمته قبل حفظه، أو تختار مجلدك وترتّب سلسلتك.
  - زر «الشيدر» في المشغّل يبدّل الوضع فوراً.
- **تتبّع الأنمي في AniList:**
  - تربط حسابك برمز من صفحة AniList، بدون كلمة مرور.
  - إذا فعّلت التسجيل، كل حلقة تكملها ترفع تقدّمك في قائمتك، والتقدّم ما ينقص أبداً.
  - قائمتا «أشاهده» و«أريد مشاهدته» تنضم لرِواق.
- **إصلاح Simkl:** تطبيقات Simkl الجديدة (AUTH V2) كانت ترجع خطأ 400، وصارت تنربط برمز تدخله في موقع Simkl. التطبيقات القديمة تكمل بنفس الطريقة.
- **حالة Discord:** «يشاهد» مع البوستر والحلقة وشريط التقدم وزر لصفحة العمل على IMDb.
- **أغانيك بأسمائها وأغلفتها:** العنوان والفنان والألبوم والغلاف من الملف نفسه، مع تبويبي «الألبومات» و«الفنانون».
- **مزامنة الحساب أثناء المشاهدة:**
  - تسجيل الخروج يسري فوراً.
  - تغييرات جهازك الثاني تنتظر نهاية الفيديو بدل ما تقطع المشاهدة، وبدون تنزيل متكرر وهي تنتظر.

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

### البدء

1. افتح **حساب ستريميو** وسجّل دخولك من صفحة ستريميو الرسمية، فيستورد رِواق إضافاتك ومكتبتك ومواضع مشاهدتك. أو أضف روابط `manifest.json` بنفسك.
2. اختر عملاً، ثم الحلقة والمصدر. الفيديو يشتغل داخل رِواق.
3. من **الإعدادات ← مزوّدو البيانات الوصفية** أضف مفاتيحك (TMDB وغيره) لو تبغى أوصافاً عربية وصوراً أكثر.
4. من **الإعدادات ← الحسابات والربط** اربط Trakt أو Simkl أو AniList، أو أنشئ حساب رِواق.
5. مصادر التورنت تحتاج **Stremio Service** شغّال على جهازك. الروابط المباشرة ما تحتاجه.

### الخصوصية والحدود

- مفاتيحك وحساباتك تنحفظ مشفّرة على جهازك. رِواق ما يطلب كلمات مرور المنصات، وما يرسل سجل مشاهدتك إلا للمنصات اللي تفعّل التسجيل فيها.
- استيراد Stremio باتجاه واحد إلى رِواق.
- اختبارات المنصات استخدمت المحاكاة، ولم تُجرَّب الشيدرات على كرت شاشة حقيقي بعد. [ما اختُبر فعلاً وما لم يُختبر](VERIFICATION.md).

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

Riwaq brings Stremio addons into a right-to-left Arabic interface. It has an MPV player embedded in its own window and a source engine that explains how it ranks streams. It also offers live TV with a programme guide and profiles with parental locks. Riwaq supplies no content: everything comes from your own addons and subscriptions.

### Download

| Edition                               | File                                                          |
| ------------------------------------- | ------------------------------------------------------------- |
| Installer (updates itself from Riwaq) | `Riwaq-Setup-0.41.0-win-x64.exe`                              |
| Portable                              | `Riwaq-0.41.0-win-x64.exe`                                    |
| In the browser, nothing to install    | [abadiosa.github.io/riwaq](https://abadiosa.github.io/riwaq/) |

Get them from the [releases page](https://github.com/ABADIOSA/riwaq/releases/latest), with `SHA256SUMS.txt` to check them. The files carry no Windows publisher signature, so SmartScreen may warn.

### What's new in 0.41.0

- **GLSL shaders, as in Harbor:**
  - Anime4K's twelve modes, and FSRCNNX for films.
  - Riwaq bundles none. Download fetches the official GitHub release and checks its SHA-256 before saving it, or you pick your own folder and order your own chain.
  - The Shader button in the player switches modes instantly.
- **AniList anime tracking:**
  - Sign in with a token from AniList's page; no password is involved.
  - With tracking on, each finished episode raises your list progress, which never goes down.
  - Watching and Planning join Riwaq as rows.
- **Simkl fixed:** new Simkl apps (AUTH V2) returned error 400; they now link with a code entered on Simkl. Older apps keep working as before.
- **Discord presence:** Watching, with the poster, episode, a progress bar and an IMDb button.
- **Songs with their names and covers:** title, artist, album and cover read from the file itself, with Albums and Artists views.
- **Account sync during playback:**
  - Signing out applies at once.
  - Changes from your other device wait until the video ends instead of interrupting it, with no repeated downloads while they wait.

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

### Getting started

1. Open **Stremio account** and sign in on Stremio's own page. Riwaq imports your addons, library and progress, or you can add `manifest.json` links yourself.
2. Pick a title, then an episode and a source. The video plays inside Riwaq.
3. In **Settings → Metadata providers**, add keys such as TMDB for Arabic descriptions and more artwork.
4. In **Settings → Accounts & linking**, connect Trakt, Simkl or AniList, or create a Riwaq account.
5. Torrent sources need **Stremio Service** running on your PC; direct links do not.

### Privacy and limits

- Keys and accounts are stored encrypted on your machine. Riwaq never asks for platform passwords. It sends your viewing history only to platforms where you turn tracking on.
- Stremio import is one-way, into Riwaq.
- Platform tests used mocks, and shaders have not yet been tried on a real GPU. See [what was and was not tested](VERIFICATION.md).

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
