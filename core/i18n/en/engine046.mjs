// 0.46: the built-in engine reaches more peers, TorrServer as a fallback,
// and the all-users installer (issue #86).
export default {
  "مثل أي برنامج تورنت، المحرك المدمج يشارك الأجزاء اللي نزلت مع غيرك أثناء المشاهدة، فعنوان IP حقك يظهر للمشاركين، ويوقف المشاركة بعد نهاية المشاهدة بدقائق. ويسأل متتبعات عامة إضافية وشبكة DHT عن مشاركين، ويعيد السؤال كل 30 ثانية لما يكونون قليلين.":
    "Like any torrent app, the built-in engine shares the pieces it has with others while you watch, so your IP address is visible to peers, and it stops sharing a few minutes after the viewing ends. It also asks extra public trackers and the DHT for peers, and asks again every 30 seconds while there are few.",
  "اسمح للمشاركين يتصلون فيك": "Let peers connect to you",
  "يطلب من الراوتر (UPnP وNAT-PMP) يفتح منفذ المحرك، فيوصلك مشاركين أكثر، خصوصاً في التورنتات القليلة. خادم المشاهدة نفسه يبقى على جهازك بس. قد يسألك جدار حماية ويندوز أول مرة. التغيير يسري من المشاهدة الجاية.":
    "Asks your router (UPnP and NAT-PMP) to open the engine's port, so more peers reach you, especially on sparse torrents. The streaming server itself stays on your PC only. Windows Firewall may ask the first time. The change applies from the next viewing.",
  "جاري فحص الشبكة…": "Checking the network…",
  "افحص الشبكة": "Check the network",
  "{n} عقدة في شبكة DHT": "{n} DHT nodes",
  "شبكة DHT ما ردّت؛ غالباً شبكتك تحجب UDP":
    "The DHT did not answer; your network probably blocks UDP",
  "المتتبعات عبر UDP توصل": "UDP trackers are reachable",
  "المتتبعات عبر UDP ما توصل": "UDP trackers are not reachable",
  "المتتبعات عبر HTTPS توصل": "HTTPS trackers are reachable",
  "المتتبعات عبر HTTPS ما توصل؛ تحقق من الإنترنت أو الجدار الناري":
    "HTTPS trackers are not reachable; check the internet connection or the firewall",
  "طلبنا من الراوتر يفتح منفذ للمشاركين":
    "Asked the router to open a port for peers",
  "استقبال المشاركين مطفأ": "Incoming peers are off",
  "التغيير يسري من المشاهدة الجاية": "The change applies from the next viewing",
  "TorrServer احتياطياً": "TorrServer as a fallback",
  "لما المحرك المدمج ما يلقى بيانات للتورنت خلال 40 ثانية، يجرّب رِواق نفس التورنت في TorrServer قبل ما ينتقل للمصدر التالي. TorrServer برنامج تورنت مفتوح المصدر (GPL‑3.0) من مطوّر مستقل، ويوصل لمشاركين عبر uTP ما يوصلهم المحرك المدمج.":
    "When the built-in engine gets no data for a torrent within 40 seconds, Riwaq tries the same torrent in TorrServer before moving to the next source. TorrServer is an open-source torrent program (GPL‑3.0) by an independent developer, and it reaches peers over uTP that the built-in engine does not.",
  "رِواق ما يحمله معه: ينزل من صفحة إصداراته على GitHub لما تضغط الزر، ويتأكد رِواق من بصمته قبل ما يحفظه وقبل أول تشغيل. يشتغل على جهازك بس بكلمة سر عشوائية، وبدون إعلان في الشبكة المحلية. وهو بنفسه يسأل icanhazip.com عن عنوانك العام ويجلب قوائم متتبعات من GitHub، وقد يسألك جدار حماية ويندوز أول مرة.":
    "Riwaq does not ship it: it is downloaded from its GitHub releases page when you press the button, and Riwaq checks its fingerprint before saving it and before it first runs. It runs on your PC only, with a random password, and never announces itself on the local network. On its own it asks icanhazip.com for your public address and fetches tracker lists from GitHub, and Windows Firewall may ask the first time.",
  "جرّبه لما المحرك المدمج ما يلقى بيانات":
    "Try it when the built-in engine gets no data",
  مثبّت: "Installed",
  "يعمل الآن": "Running now",
  "يبدأ عند الحاجة": "Starts when needed",
  "حُذف TorrServer": "TorrServer removed",
  "احذف TorrServer": "Remove TorrServer",
  "نزل TorrServer وتحقق رِواق منه": "TorrServer downloaded and checked",
  "جاري التنزيل… {n}%": "Downloading… {n}%",
  "نزّل TorrServer": "Download TorrServer",
  "مجلد TorrServer غير محدد": "TorrServer's folder is not set",
  "نزّل TorrServer أولاً": "Download TorrServer first",
  "ملف TorrServer تغيّر بعد تنزيله، فحُذف. نزّله من جديد.":
    "TorrServer's file changed after it was downloaded, so it was deleted. Download it again.",
  "TorrServer متوقف": "TorrServer is stopped",
  "ويندوز منع تشغيل TorrServer؛ تحقق من برنامج الحماية":
    "Windows blocked TorrServer; check your security software",
  "تعذّر تشغيل TorrServer": "Could not start TorrServer",
  "TorrServer ما اشتغل": "TorrServer did not start",
  "TorrServer ما أخذ إعدادات رِواق": "TorrServer did not take Riwaq's settings",
  "ما وصلت بيانات التورنت إلى TorrServer":
    "The torrent's metadata did not reach TorrServer",
  "ما عرفنا أي ملف في التورنت يشغّله TorrServer":
    "Could not tell which file in the torrent TorrServer should play",
  "المحرك المدمج ما لقى بيانات؛ نجرّب TorrServer…":
    "The built-in engine got no data; trying TorrServer…",
  "أوقف المشاهدة أولاً": "Stop the viewing first",
  "فحص شبكة المحرك المدمج في نسخة رِواق لسطح المكتب فقط؛ الموقع يستخدم Stremio Service.":
    "The built-in engine's network check is in Riwaq for desktop only; the site uses Stremio Service.",
  "TorrServer يعمل مع نسخة رِواق لسطح المكتب فقط؛ الموقع يستخدم Stremio Service.":
    "TorrServer works with Riwaq for desktop only; the site uses Stremio Service.",
};
