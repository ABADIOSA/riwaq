import React, { useState, useEffect } from "react";
import {
  Palette,
  Database,
  Link2,
  MonitorPlay,
  Subtitles,
  SlidersHorizontal,
  Search,
  Check,
  ArrowUpRight,
  ShieldCheck,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Download,
  Filter,
  Bell,
  Keyboard,
  Sparkles,
  Archive,
  Upload,
  LockKeyhole,
} from "lucide-react";
import { call } from "../lib/api.js";

const NAMED_KEYS = {
  " ": "SPACE",
  Escape: "ESC",
  Enter: "ENTER",
  Tab: "TAB",
  Backspace: "BS",
  Delete: "DEL",
  Insert: "INS",
  Home: "HOME",
  End: "END",
  PageUp: "PGUP",
  PageDown: "PGDWN",
  ArrowUp: "UP",
  ArrowDown: "DOWN",
  ArrowLeft: "LEFT",
  ArrowRight: "RIGHT",
};
/** Turns a browser key event into the binding syntax MPV's input.conf uses. */
function mpvKey(event) {
  if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return "";
  const named =
    NAMED_KEYS[event.key] || (/^F\d{1,2}$/.test(event.key) ? event.key : "");
  const parts = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  // A shifted printable key already reports its shifted character, so adding
  // the modifier would give MPV a binding it can never match.
  if (event.shiftKey && named) parts.push("Shift");
  const key = named || event.key;
  if (!named && key.length !== 1) return "";
  return [...parts, key].join("+");
}

const sections = [
  [
    "appearance",
    "المظهر والتخصيص",
    "الثيم الألوان التخطيط الرئيسية البطاقات الحركة",
    Palette,
  ],
  [
    "data",
    "مكتبة البيانات",
    "API TMDB OMDb MDBList Fanart تقييمات صور لغة",
    Database,
  ],
  [
    "connections",
    "الحسابات والربط",
    "Trakt Letterboxd Simkl مزامنة قوائم",
    Link2,
  ],
  [
    "playback",
    "المشغل والمصادر",
    "HDR الجودة تسريع العتاد متابعة إيقاف",
    MonitorPlay,
  ],
  [
    "sources",
    "محرّك المصادر",
    "ترتيب جودة أمان تخزين debrid حجم استبعاد CAM",
    Filter,
  ],
  ["subtitles", "الصوت والترجمة", "عربي لغة حجم توقيت مسارات", Subtitles],
  ["hotkeys", "اختصارات لوحة المفاتيح", "مفاتيح تخصيص تعارض MPV", Keyboard],
  [
    "presence",
    "الحضور والإشعارات",
    "Discord Telegram webhook حالة إشعار",
    Bell,
  ],
  [
    "backup",
    "النسخ الاحتياطي",
    "نسخة احتياطية استعادة نقل جهاز جديد تصدير تشفير",
    Archive,
  ],
  [
    "system",
    "الاتصال والتطبيق",
    "Stremio خدمة تشخيص MPV إصدار",
    SlidersHorizontal,
  ],
];
export default function SettingsStudio({ state, update, act, notice }) {
  const [tab, setTab] = useState("appearance"),
    [search, setSearch] = useState(""),
    [draft, setDraft] = useState(state.settings),
    [diag, setDiag] = useState(null);
  const s = state.settings;
  useEffect(() => {
    setDraft(s);
  }, [s]);
  const visible = sections.filter(([id, title, keywords]) =>
    search
      ? `${title} ${keywords}`.toLowerCase().includes(search.toLowerCase())
      : id === tab,
  );
  const save = (key, value) => update("settings", { [key]: value });
  const toggle = (key, title, description) => (
    <div className="setting-row" key={key}>
      <div>
        <b>{title}</b>
        <p>{description}</p>
      </div>
      <button
        className={`toggle ${s[key] ? "on" : ""}`}
        aria-label={title}
        aria-pressed={!!s[key]}
        onClick={() => save(key, !s[key])}
      >
        <span />
      </button>
    </div>
  );
  const select = (key, title, options) => (
    <label className="setting-row">
      <b>{title}</b>
      <select
        aria-label={title}
        value={s[key]}
        onChange={(e) =>
          save(
            key,
            typeof options[0][0] === "number"
              ? Number(e.target.value)
              : e.target.value,
          )
        }
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="page-body studio-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR RIWAQ, YOUR WAY</span>
          <h1>تفاصيل تصنع تجربتك.</h1>
          <p>من أول بوستر… إلى آخر مشهد.</p>
        </div>
        <span className="version-badge">BETA 0.3</span>
      </div>
      <div className="studio-layout">
        <aside className="studio-nav">
          <label className="settings-search">
            <Search size={17} />
            <input
              aria-label="البحث في الإعدادات"
              placeholder="ابحث في الإعدادات…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          {sections.map(([id, title, , Icon]) => (
            <button
              key={id}
              className={id === tab && !search ? "selected" : ""}
              onClick={() => {
                setTab(id);
                setSearch("");
              }}
            >
              <Icon size={18} />
              {title}
            </button>
          ))}
          <div className="privacy-note">
            <ShieldCheck size={20} />
            <b>مفاتيحك تبقى لك</b>
            <p>يحفظ ويندوز مفاتيح الخدمات والجلسات مشفرة على جهازك.</p>
          </div>
        </aside>
        <div className="studio-content">
          {visible.length === 0 && (
            <div className="settings-card">لا توجد إعدادات بهذا الاسم.</div>
          )}
          {visible.map(([id]) => (
            <React.Fragment key={id}>
              {id === "appearance" && (
                <>
                  <section className="settings-card">
                    <div className="section-heading">
                      <div>
                        <h2>استوديو المظهر</h2>
                        <p>لوحة ألوان لكل مزاج. التغيير يظهر مباشرة.</p>
                      </div>
                      <Palette size={22} />
                    </div>
                    <div className="theme-gallery">
                      {[
                        ["noir", "Noir", "أسود سينمائي"],
                        ["amber", "Riwaq", "دفء ذهبي"],
                        ["teal", "Harbor", "هدوء البحر"],
                        ["violet", "Aurora", "ليل بنفسجي"],
                        ["nord", "Nord", "شمال هادئ"],
                        ["rose", "Velvet", "ورد مخملي"],
                        ["forest", "Forest", "أخضر عميق"],
                      ].map(([value, name, caption]) => (
                        <button
                          key={value}
                          className={`theme-tile theme-${value} ${s.accent === value ? "selected" : ""}`}
                          onClick={() => save("accent", value)}
                        >
                          <div className="theme-miniature">
                            <i />
                            <div>
                              <span />
                              <b />
                              <em />
                              <div>
                                <i />
                                <i />
                                <i />
                              </div>
                            </div>
                          </div>
                          <div>
                            <b>{name}</b>
                            <small>{caption}</small>
                            {s.accent === value && <Check size={16} />}
                          </div>
                        </button>
                      ))}
                    </div>
                  </section>
                  <section className="settings-card">
                    <h2>مساحتك، بطريقتك</h2>
                    <div className="layout-choices">
                      {[
                        ["cinematic", "سينمائي", "عرض واسع وبداية غامرة"],
                        ["sidebar", "كلاسيكي", "قائمة جانبية وبطاقة رئيسية"],
                        ["topbar", "شريط علوي", "مساحة أكبر للحكايات"],
                      ].map(([value, title, caption]) => (
                        <button
                          className={s.layout === value ? "selected" : ""}
                          key={value}
                          onClick={() => save("layout", value)}
                        >
                          <span className={`layout-symbol ${value}`}>
                            <i />
                            <i />
                            <i />
                          </span>
                          <b>{title}</b>
                          <small>{caption}</small>
                        </button>
                      ))}
                    </div>
                    {select("cardStyle", "أسلوب البطاقات", [
                      ["glass", "زجاجي"],
                      ["flat", "بسيط"],
                    ])}
                    {select("cardSize", "حجم البطاقات", [
                      ["compact", "صغير"],
                      ["comfortable", "متوازن"],
                      ["large", "كبير"],
                    ])}
                    {toggle(
                      "showHero",
                      "العرض السينمائي الرئيسي",
                      "إظهار العمل المميز أعلى الصفحة الرئيسية.",
                    )}
                    {toggle(
                      "showRatings",
                      "التقييمات على البطاقات",
                      "إظهار تقييمات العناوين أثناء التصفح.",
                    )}
                    {toggle(
                      "hideWatched",
                      "إخفاء المكتمل من صفوف الاكتشاف",
                      "وفق تقدم المشاهدة المحفوظ في رِواق.",
                    )}
                    {toggle(
                      "reduceMotion",
                      "تقليل الحركة",
                      "تخفيف الانتقالات وتأثيرات التكبير.",
                    )}
                  </section>
                </>
              )}
              {id === "data" && (
                <>
                  <div className="feature-banner">
                    <Database size={34} />
                    <div>
                      <h2>مصادر متعددة. حكاية أغنى.</h2>
                      <p>
                        أضف مفاتيحك لتحصل على تفاصيل عربية، صور أفضل وتقييمات من
                        عدة منصات. تعمل إضافات ستريميو أيضًا عند غياب هذه
                        الخدمات.
                      </p>
                    </div>
                  </div>
                  <div className="provider-grid">
                    {(state.providers || []).map((p) => (
                      <ProviderCard
                        key={p.id}
                        provider={p}
                        update={update}
                        act={act}
                      />
                    ))}
                  </div>
                  <section className="settings-card">
                    {select("metadataLanguage", "لغة بيانات TMDB", [
                      ["ar-SA", "العربية"],
                      ["en-US", "English"],
                      ["ja-JP", "日本語"],
                      ["fr-FR", "Français"],
                    ])}
                    {select("region", "منطقة توفر خدمات المشاهدة", [
                      ["SA", "السعودية"],
                      ["AE", "الإمارات"],
                      ["EG", "مصر"],
                      ["US", "الولايات المتحدة"],
                      ["GB", "المملكة المتحدة"],
                    ])}
                    <p className="subtle">
                      تختلف تغطية البيانات وحدود الاستخدام حسب مزوّد الخدمة.
                      اختبر المفتاح بعد حفظه. تستخدم مفاتيح الخدمات عند فتح صفحة
                      التفاصيل.
                    </p>
                  </section>
                </>
              )}
              {id === "connections" && (
                <>
                  <div className="feature-banner">
                    <Link2 size={34} />
                    <div>
                      <h2>مكتبتك، عبر المنصات.</h2>
                      <p>
                        استورد قوائمك إلى مكان واحد. ربط ستريميو وإضافاته متاح
                        من بطاقة الحساب في القائمة الرئيسية.
                      </p>
                    </div>
                  </div>
                  {(state.integrations || []).map((integration) => (
                    <IntegrationCard
                      key={integration.id}
                      integration={integration}
                      update={update}
                      act={act}
                      notice={notice}
                    />
                  ))}
                </>
              )}
              {id === "playback" && (
                <>
                  <section className="settings-card">
                    <h2>سينما مدمجة</h2>
                    <p>
                      MPV داخل نافذة رِواق، مع ملء الشاشة ومشغل مصغّر أثناء
                      التصفح.
                    </p>
                    {select("quality", "الجودة المفضلة", [
                      ["2160", "4K · أعلى جودة"],
                      ["1080", "1080p · متوازنة"],
                      ["720", "720p · بيانات أقل"],
                    ])}
                    {toggle(
                      "hideCam",
                      "إخفاء تصوير السينما",
                      "استبعاد المصادر التي تحمل CAM أو Telesync.",
                    )}
                    {toggle(
                      "hardwareDecoding",
                      "تسريع العتاد",
                      "فك الترميز باستخدام كرت الشاشة عند توفره.",
                    )}
                    {toggle(
                      "hdr",
                      "إشارة HDR للشاشة",
                      "تحتاج شاشة ومصدرًا وإعدادات ويندوز متوافقة.",
                    )}
                    {toggle(
                      "autoplay",
                      "متابعة المشاهدة تلقائياً",
                      "تشغيل التالي في الطابور، ثم الحلقة التالية إذا كان الطابور فارغاً، بأول مصدر متوافق. مغلق افتراضياً.",
                    )}
                    {toggle(
                      "pauseOnMinimize",
                      "إيقاف مؤقت عند تصغير التطبيق",
                      "تتوقف المشاهدة عندما تصغر نافذة رِواق.",
                    )}
                    {select("seekStep", "خطوة التقديم والرجوع", [
                      [5, "5 ثوانٍ"],
                      [10, "10 ثوانٍ"],
                      [30, "30 ثانية"],
                    ])}
                    {select("liveBufferSeconds", "مخزون البث المباشر", [
                      [2, "ثانيتان · أقل تأخير"],
                      [4, "4 ثوانٍ"],
                      [8, "8 ثوانٍ · أثبت"],
                      [15, "15 ثانية"],
                    ])}
                  </section>
                  <section className="settings-card">
                    <h2>
                      <Sparkles size={17} /> معالجة الصورة
                    </h2>
                    <p>
                      مرشّحات مبنية على محرّك MPV نفسه. رِواق لا يرفق ملفات شيدر
                      من طرف ثالث؛ إن كان لديك سلسلة GLSL خاصة بك فاخترها من
                      الملف المخصص.
                    </p>
                    {select("shader", "مرشّح الصورة", [
                      ["none", "بدون · أسرع"],
                      ["sharp", "حِدّة · تحسين الحواف"],
                      ["anime", "رسوم متحركة · حِدّة مع تنعيم التدرّج"],
                      ["film", "سينمائي · تدرّج ناعم"],
                      ["custom", "ملف GLSL خاص بي"],
                    ])}
                    {s.shader === "custom" && (
                      <div className="setting-row">
                        <div>
                          <b>ملف الشيدر</b>
                          <p className="path" dir="ltr">
                            {s.shaderPath || "لم يُختر ملف"}
                          </p>
                        </div>
                        <button
                          className="secondary small"
                          onClick={async () => {
                            const result = await act("chooseShader");
                            if (result) notice("تم اختيار ملف الشيدر");
                          }}
                        >
                          اختيار…
                        </button>
                      </div>
                    )}
                    {select("toneMapping", "تحويل HDR إلى SDR", [
                      ["auto", "تلقائي"],
                      ["bt.2446a", "bt.2446a · الأدق"],
                      ["hable", "hable"],
                      ["mobius", "mobius"],
                      ["reinhard", "reinhard"],
                      ["off", "بدون تحويل"],
                    ])}
                  </section>
                  <section className="settings-card">
                    <h2>تخطي المقدمة والخاتمة</h2>
                    <p>
                      يعتمد التخطي على فصول الملف. عند غيابها يُعرض الزر فقط ضمن
                      النافذة التي تقع فيها المقدمة فعلياً، فلا يبتلع الزر جزءاً
                      من الحلقة.
                    </p>
                    {select("skipIntro", "المقدمة والملخص", [
                      ["button", "إظهار زر تخطي"],
                      ["auto", "تخطٍ تلقائي"],
                      ["off", "بدون"],
                    ])}
                    {select("skipOutro", "الخاتمة والإعلان", [
                      ["off", "بدون"],
                      ["button", "إظهار زر تخطي"],
                      ["auto", "تخطٍ تلقائي"],
                    ])}
                  </section>
                  <section className="settings-card">
                    <h2>لقطات الشاشة</h2>
                    <p>
                      تُحفظ اللقطات بصيغة PNG داخل مجلد بيانات رِواق، ويفتح الزر
                      المجلد مباشرة.
                    </p>
                    <button
                      className="secondary small"
                      onClick={() => act("openScreenshots")}
                    >
                      فتح مجلد اللقطات
                    </button>
                  </section>
                </>
              )}
              {id === "sources" && (
                <>
                  <section className="settings-card">
                    <h2>كيف يختار رِواق المصدر</h2>
                    <p>
                      يقرأ المحرّك وصف كل مصدر، يستبعد ما لا يطابق العمل، ثم
                      يرتّب الباقي ويشرح سبب الترتيب داخل صفحة العنوان.
                    </p>
                    {select("streamSafety", "مستوى الاستبعاد", [
                      ["strict", "صارم · يستبعد النسخ الأولية والمشبوهة"],
                      ["balanced", "متوازن · يبقي النسخ الأولية عند الحاجة"],
                      ["off", "مطفأ · لا يستبعد إلا الدعاية والعيّنات"],
                    ])}
                    {select("quality", "سقف الجودة", [
                      ["2160", "4K · أعلى جودة"],
                      ["1080", "1080p · متوازنة"],
                      ["720", "720p · بيانات أقل"],
                    ])}
                    {toggle(
                      "hideCam",
                      "إخفاء تصوير السينما",
                      "استبعاد المصادر التي تحمل CAM أو Telesync أو Telecine.",
                    )}
                    {toggle(
                      "preferCached",
                      "تفضيل المصادر المخزّنة",
                      "تقديم المصادر الجاهزة على debrid لأنها تبدأ فوراً.",
                    )}
                    {select("streamSizeLimit", "حدّ حجم الملف", [
                      [0, "بلا حدّ"],
                      [5, "5 جيجابايت"],
                      [10, "10 جيجابايت"],
                      [20, "20 جيجابايت"],
                      [50, "50 جيجابايت"],
                    ])}
                  </section>
                  <section className="settings-card">
                    <h2>الأولوية العربية</h2>
                    <p>
                      يميّز المحرّك بين «مترجم» و«مدبلج»: الترجمة العربية
                      تُقدَّم عندما تضع
                      <code> ara </code> في لغات الترجمة، والدبلجة تُقدَّم فقط
                      عندما تضعها في لغات الصوت. اضبطهما من قسم الصوت والترجمة.
                    </p>
                  </section>
                </>
              )}
              {id === "hotkeys" && (
                <HotkeyEditor state={state} update={update} notice={notice} />
              )}
              {id === "backup" && (
                <BackupRoom update={update} act={act} notice={notice} />
              )}
              {id === "presence" && (
                <PresenceAndAlerts
                  state={state}
                  update={update}
                  act={act}
                  notice={notice}
                />
              )}
              {id === "subtitles" && (
                <form
                  className="settings-card"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const result = await update("settings", {
                      subtitleLanguage: draft.subtitleLanguage,
                      audioLanguage: draft.audioLanguage,
                      subtitleSize: Number(draft.subtitleSize),
                      subtitleDelay: Number(draft.subtitleDelay),
                    });
                    if (result) notice("تم حفظ تفضيلات الصوت والترجمة");
                  }}
                >
                  <h2>اسمعها كما تحب. اقرأها بوضوح.</h2>
                  <p>
                    ترتيب اللغات يحدد أولوية المسارات المضمنة عند بدء التشغيل.
                  </p>
                  <div className="settings-fields">
                    {[
                      ["subtitleLanguage", "أولوية لغات الترجمة"],
                      ["audioLanguage", "أولوية لغات الصوت"],
                    ].map(([key, label]) => (
                      <label key={key}>
                        {label}
                        <input
                          dir="ltr"
                          value={draft[key]}
                          onChange={(e) =>
                            setDraft({ ...draft, [key]: e.target.value })
                          }
                        />
                        <small>مثال: ara,ar,eng,en</small>
                      </label>
                    ))}
                    <label>
                      حجم الترجمة
                      <input
                        type="number"
                        min="18"
                        max="80"
                        value={draft.subtitleSize}
                        onChange={(e) =>
                          setDraft({ ...draft, subtitleSize: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      تأخير الترجمة (ثانية)
                      <input
                        type="number"
                        min="-60"
                        max="60"
                        step="0.1"
                        value={draft.subtitleDelay}
                        onChange={(e) =>
                          setDraft({ ...draft, subtitleDelay: e.target.value })
                        }
                      />
                    </label>
                  </div>
                  <div
                    className="subtitle-preview"
                    style={{
                      fontSize: `${Math.min(36, Number(draft.subtitleSize) * 0.65)}px`,
                    }}
                  >
                    كل حكاية تستحق أن تُروى.
                  </div>
                  <button className="primary">حفظ تفضيلات الترجمة</button>
                  <p className="subtle">
                    تُطبّق على المشاهدة التالية. يمكنك تعديل الترجمة الحالية من
                    المشغل.
                  </p>
                </form>
              )}
              {id === "system" && (
                <>
                  <section className="settings-card">
                    <div className="section-heading">
                      <h2>الاتصال والتشخيص</h2>
                      <button
                        className="secondary"
                        onClick={async () => setDiag(await act("diagnostics"))}
                      >
                        <RefreshCw size={16} />
                        فحص
                      </button>
                    </div>
                    <div className="diagnostics">
                      {[
                        ["MPV", diag?.mpv],
                        ["المشغل المدمج", diag?.video?.embedded],
                        ["Stremio Service", diag?.server],
                        ["تشفير ويندوز", diag?.encryption],
                      ].map(([name, ok]) => (
                        <span key={name} className={ok ? "ok" : ""}>
                          {ok ? (
                            <CheckCircle2 size={16} />
                          ) : (
                            <AlertCircle size={16} />
                          )}{" "}
                          {name} ·{" "}
                          {diag ? (ok ? "جاهز" : "غير متاح") : "لم يُفحص"}
                        </span>
                      ))}
                    </div>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        save("serverUrl", draft.serverUrl);
                      }}
                    >
                      <label>عنوان Stremio Service</label>
                      <div className="input-action">
                        <input
                          aria-label="عنوان Stremio Service"
                          dir="ltr"
                          value={draft.serverUrl}
                          onChange={(e) =>
                            setDraft({ ...draft, serverUrl: e.target.value })
                          }
                        />
                        <button className="secondary">حفظ</button>
                      </div>
                      <p className="subtle">
                        مطلوب لمصادر التورنت. الروابط المباشرة تعمل بالمشغل
                        المرفق دون خدمة إضافية.
                      </p>
                    </form>
                    <button
                      className="secondary"
                      onClick={() => update("choosePlayer")}
                    >
                      اختيار نسخة MPV مخصصة
                    </button>
                  </section>
                  <section className="settings-card">
                    <h2>رِواق 0.2.0</h2>
                    <p>
                      عميل مستقل لإضافات Stremio، بتصميم مستلهم من Harbor وتجربة
                      تشغيل تستفيد من Nuvio ونسخة المجتمع.
                    </p>
                    <p className="subtle">
                      This product uses the TMDB API but is not endorsed or
                      certified by TMDB. بيانات توفر المشاهدة: TMDB / JustWatch.
                      التقييمات والصور ملك لمزوّديها.
                    </p>
                  </section>
                </>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
function ProviderCard({ provider: p, update, act }) {
  const [key, setKey] = useState(""),
    [busy, setBusy] = useState(false);
  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="provider-card"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const r = await update("providerSave", {
            id: p.id,
            key,
            enabled: true,
          });
          if (r) setKey("");
        });
      }}
    >
      <div className="provider-title">
        <span className={`service-mark ${p.id}`}>{p.name[0]}</span>
        <div>
          <h3>{p.name}</h3>
          <small className={p.status === "ok" ? "success-text" : ""}>
            {p.status === "ok"
              ? "تم التحقق"
              : p.status === "error"
                ? "فشل التحقق؛ راجع المفتاح"
                : p.configured
                  ? "محفوظ · لم يُختبر"
                  : "اختياري · غير مضاف"}
          </small>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label={`موقع ${p.name}`}
          onClick={() => act("openService", { id: p.id })}
        >
          <ArrowUpRight size={17} />
        </button>
      </div>
      <p>{p.description}</p>
      <input
        type="password"
        autoComplete="off"
        spellCheck="false"
        aria-label={`مفتاح ${p.name}`}
        dir="ltr"
        placeholder={
          p.configured
            ? "•••••••• محفوظ — أدخل قيمة لاستبداله"
            : p.id === "tmdb"
              ? "API key or Read Access Token"
              : "API key"
        }
        value={key}
        onChange={(e) => setKey(e.target.value)}
      />
      <div className="provider-actions">
        <button disabled={busy || !key.trim()} className="primary small">
          حفظ
        </button>
        <button
          disabled={busy || !p.configured}
          type="button"
          className="secondary small"
          onClick={() => run(() => update("providerTest", { id: p.id }))}
        >
          {busy ? "جاري…" : "اختبار الاتصال"}
        </button>
        {p.configured && (
          <>
            <button
              type="button"
              className="text-button"
              onClick={() =>
                update("providerSave", { id: p.id, enabled: !p.enabled })
              }
            >
              {p.enabled ? "تعطيل" : "تفعيل"}
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={`حذف مفتاح ${p.name}`}
              onClick={() => update("providerSave", { id: p.id, clear: true })}
            >
              <Trash2 size={16} />
            </button>
          </>
        )}
      </div>
    </form>
  );
}
function IntegrationCard({ integration: s, update, act, notice }) {
  const [clientId, setClientId] = useState(""),
    [secret, setSecret] = useState(""),
    [username, setUsername] = useState(s.username),
    [busy, setBusy] = useState(false),
    [device, setDevice] = useState(null);
  const id = s.id,
    name = { trakt: "Trakt", letterboxd: "Letterboxd", simkl: "Simkl" }[id];
  useEffect(() => {
    if (!device) return;
    let cancelled = false,
      timer;
    const poll = async () => {
      try {
        const r = await call("traktPoll", { id });
        if (cancelled) return;
        if (r.connected) {
          setDevice(null);
          await update("integrationSync", { id });
          notice(`تم ربط ${name}`);
        } else if (r.cancelled) setDevice(null);
        else timer = setTimeout(poll, (r.interval || device.interval) * 1000);
      } catch (e) {
        if (!cancelled) {
          setDevice(null);
          notice(e.message);
        }
      }
    };
    timer = setTimeout(poll, device.interval * 1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [device]);
  const save = () =>
    update("integrationSave", {
      id,
      ...(clientId ? { clientId } : {}),
      ...(secret ? { clientSecret: secret } : {}),
      ...(id === "letterboxd" ? { username } : {}),
    });
  const connect = async () => {
    setBusy(true);
    try {
      if (!(await save())) return;
      setClientId("");
      setSecret("");
      if (id === "letterboxd") {
        await update("integrationSync", { id });
      } else {
        const d = await act("traktLogin", { id });
        if (d) {
          setDevice(d);
          await act("openService", { id: id + "Activate" });
        }
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={`settings-card integration-card integration-${id}`}>
      <div className="section-heading">
        <div className="provider-title">
          <span className={`service-mark ${id}`}>{name[0]}</span>
          <div>
            <h2>{name}</h2>
            <small>
              {s.connected
                ? `متصل${s.username ? " · " + s.username : ""}`
                : "غير متصل"}
            </small>
          </div>
        </div>
        <button
          className="text-button"
          onClick={() => act("openService", { id })}
        >
          إعدادات الخدمة <ArrowUpRight size={15} />
        </button>
      </div>
      <p>
        {id === "trakt"
          ? "قوائم الأفلام والمسلسلات، مع تسجيل المشاهدة اختياريًا عند إكمال 90% من العمل."
          : id === "letterboxd"
            ? "قوائم المشاهدة والإعجابات العامة عبر إضافة Stremboxd، أو استيراد ملفات CSV الرسمية."
            : "استيراد قائمة «أريد المشاهدة» للأفلام والمسلسلات والأنمي المتطابق مع IMDb."}
      </p>
      {!s.connected && (
        <>
          <div className="settings-fields">
            {id === "letterboxd" ? (
              <label>
                اسم مستخدم Letterboxd
                <input
                  dir="ltr"
                  value={username || ""}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="username"
                />
              </label>
            ) : (
              <>
                <label>
                  Client ID
                  <input
                    type="password"
                    autoComplete="off"
                    dir="ltr"
                    placeholder={
                      s.configured
                        ? "محفوظ — اتركه فارغًا للاحتفاظ به"
                        : "Client ID من تطبيقك"
                    }
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                  />
                </label>
                {id === "trakt" && (
                  <label>
                    Client Secret
                    <input
                      type="password"
                      autoComplete="off"
                      dir="ltr"
                      placeholder={s.hasSecret ? "محفوظ" : "Client Secret"}
                      value={secret}
                      onChange={(e) => setSecret(e.target.value)}
                    />
                  </label>
                )}
              </>
            )}
          </div>
          {id === "letterboxd" && (
            <p className="subtle">
              عند الربط يُرسل اسم المستخدم العام إلى api.stremboxd.com لجلب
              القوائم. لا نطلب كلمة مرور Letterboxd.
            </p>
          )}
        </>
      )}
      {device && (
        <div className="device-code">
          <span>أدخل هذا الرمز في موقع {name}</span>
          <strong dir="ltr">{device.code}</strong>
          <small>بانتظار إكمال الربط…</small>
          <button
            className="text-button"
            onClick={() => act("openService", { id: id + "Activate" })}
          >
            فتح صفحة الربط
          </button>
        </div>
      )}
      <div className="button-row">
        {!s.connected ? (
          <button
            disabled={busy || !!device}
            className="primary"
            onClick={connect}
          >
            {busy ? "جاري الربط…" : "ربط " + name}
          </button>
        ) : (
          <>
            <button
              className="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await update("integrationSync", { id });
                } finally {
                  setBusy(false);
                }
              }}
            >
              <RefreshCw size={16} />
              {busy ? "جاري المزامنة…" : "مزامنة القوائم"}
            </button>
            <button
              className="text-button"
              onClick={() => update("integrationDisconnect", { id })}
            >
              فصل الحساب
            </button>
          </>
        )}
        {id === "letterboxd" && (
          <button
            disabled={busy}
            className="secondary"
            onClick={async () => {
              setBusy(true);
              try {
                const r = await act("letterboxdImport");
                if (r) {
                  await update("init");
                  notice(
                    `استُورد ${r.count} عنوان · لم تتم مطابقة ${r.unmatched}${r.remaining ? " · تجاوز الحد " + r.remaining : ""}`,
                  );
                }
              } finally {
                setBusy(false);
              }
            }}
          >
            <Download size={16} />
            استيراد CSV
          </button>
        )}
      </div>
      {s.lastSync && (
        <p className="subtle">
          آخر مزامنة: {new Date(s.lastSync).toLocaleString("ar-SA")}
        </p>
      )}
      {id === "trakt" && s.connected && (
        <div className="setting-row">
          <div>
            <b>تسجيل المشاهدة في Trakt</b>
            <p>
              يرسل الأعمال والحلقات المكتملة لحسابك. الطلبات المتعثرة تُحفظ
              لإعادة المحاولة مع المزامنة التالية.{" "}
              {s.pending > 0 && `بانتظار الإرسال: ${s.pending}`}
            </p>
          </div>
          <button
            className={`toggle ${s.trackHistory ? "on" : ""}`}
            aria-label="تسجيل المشاهدة في Trakt"
            aria-pressed={s.trackHistory}
            onClick={() =>
              update("integrationSave", { id, trackHistory: !s.trackHistory })
            }
          >
            <span />
          </button>
        </div>
      )}
      {id === "trakt" && s.connected && s.trackHistory && (
        <div className="setting-row">
          <div>
            <b>تسجيل لحظي (Scrobble)</b>
            <p>
              يُظهر في Trakt ما تشاهده الآن، ويسجّله عند الإيقاف إذا تجاوزت 80%،
              ويحفظ موضعك إن توقفت قبل ذلك. بدونه يُرسل العمل فقط بعد اكتماله.
              لا يُحسب العمل مرتين أبداً.
            </p>
          </div>
          <button
            className={`toggle ${s.scrobble ? "on" : ""}`}
            aria-label="تسجيل لحظي في Trakt"
            aria-pressed={!!s.scrobble}
            onClick={() =>
              update("integrationSave", { id, scrobble: !s.scrobble })
            }
          >
            <span />
          </button>
        </div>
      )}
    </section>
  );
}

function HotkeyEditor({ state, update, notice }) {
  const [capturing, setCapturing] = useState("");
  const hotkeys = state.hotkeys || [];
  return (
    <section className="settings-card">
      <h2>اختصارات المشغّل</h2>
      <p>
        رِواق يشغّل MPV بلا إعدادات خارجية، فهذه القائمة هي لوحة المفاتيح كاملة.
        اضغط على الاختصار ثم اضغط المفتاح الجديد.
      </p>
      <div className="hotkey-list">
        {hotkeys.map((action) => (
          <div
            key={action.id}
            className={action.conflict ? "hotkey-row clash" : "hotkey-row"}
          >
            <span>{action.label}</span>
            <button
              className={
                capturing === action.id ? "hotkey-key capturing" : "hotkey-key"
              }
              onClick={() =>
                setCapturing(capturing === action.id ? "" : action.id)
              }
              onKeyDown={async (event) => {
                if (capturing !== action.id) return;
                event.preventDefault();
                const binding = mpvKey(event.nativeEvent);
                if (!binding) return;
                setCapturing("");
                await update("setHotkey", { id: action.id, binding });
              }}
            >
              <kbd dir="ltr">
                {capturing === action.id ? "اضغط مفتاحاً…" : action.binding}
              </kbd>
            </button>
            {!action.isDefault && (
              <button
                className="text-button"
                onClick={() =>
                  update("setHotkey", { id: action.id, binding: null })
                }
              >
                إرجاع
              </button>
            )}
          </div>
        ))}
      </div>
      {hotkeys.some((action) => action.conflict) && (
        <p className="inline-warning">
          <AlertCircle size={15} /> بعض الاختصارات مكرّرة. سيعمل آخر إجراء في
          القائمة.
        </p>
      )}
      <button
        className="secondary small"
        onClick={async () => {
          const result = await update("resetHotkeys");
          if (result) notice("تمت إعادة الاختصارات الافتراضية");
        }}
      >
        إعادة كل الاختصارات
      </button>
    </section>
  );
}

function PresenceAndAlerts({ state, update, act, notice }) {
  const s = state.settings;
  const [appId, setAppId] = useState("");
  const [webhook, setWebhook] = useState("");
  const [bot, setBot] = useState({ token: "", chatId: "" });
  const targets = state.notify || [];
  return (
    <>
      <section className="settings-card">
        <h2>حضور Discord</h2>
        <p>
          مطفأ افتراضياً. يحتاج تطبيق Discord يعمل على جهازك ومعرّف تطبيق خاص بك
          من بوابة مطوّري Discord. لا يُرسل رِواق شيئاً إلى خوادمنا.
        </p>
        <div className="setting-row">
          <div>
            <b>تفعيل الحضور</b>
            <p>إظهار ما تشاهده في ملفك على Discord.</p>
          </div>
          <button
            className={`toggle ${s.discordPresence ? "on" : ""}`}
            aria-label="تفعيل حضور Discord"
            aria-pressed={!!s.discordPresence}
            onClick={() =>
              update("settings", { discordPresence: !s.discordPresence })
            }
          >
            <span />
          </button>
        </div>
        <label className="setting-row">
          <b>مستوى التفصيل</b>
          <select
            aria-label="مستوى تفصيل الحضور"
            value={s.presenceDetail}
            onChange={(event) =>
              update("settings", { presenceDetail: event.target.value })
            }
          >
            <option value="title">اسم العمل</option>
            <option value="generic">«يشاهد شيئاً» فقط</option>
            <option value="off">لا شيء</option>
          </select>
        </label>
        <form
          className="stacked-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const result = await update("presenceSave", { appId });
            if (result) notice("تم حفظ معرّف التطبيق");
          }}
        >
          <label>
            معرّف تطبيق Discord
            <input
              value={appId}
              onChange={(event) => setAppId(event.target.value.trim())}
              inputMode="numeric"
              dir="ltr"
              placeholder="000000000000000000"
            />
          </label>
          <button className="secondary small" type="submit">
            حفظ وتفعيل
          </button>
        </form>
      </section>
      <section className="settings-card">
        <h2>إشعارات خارجية</h2>
        <p>اختياري بالكامل، ويستخدم Webhook أو بوتاً تملكه أنت.</p>
        <div className="setting-row">
          <div>
            <b>إشعار عند إنهاء المشاهدة</b>
            <p>يُرسل عنوان العمل إلى الوجهات المفعّلة.</p>
          </div>
          <button
            className={`toggle ${s.notifyOnFinish ? "on" : ""}`}
            aria-label="إشعار عند إنهاء المشاهدة"
            aria-pressed={!!s.notifyOnFinish}
            onClick={() =>
              update("settings", { notifyOnFinish: !s.notifyOnFinish })
            }
          >
            <span />
          </button>
        </div>
        {targets.map((target) => (
          <div key={target.id} className="provider-card">
            <div className="provider-head">
              <b>{target.name}</b>
              <span className={`status ${target.status}`}>
                {target.status === "ok" ? (
                  <CheckCircle2 size={15} />
                ) : target.status === "error" ? (
                  <AlertCircle size={15} />
                ) : null}
                {target.configured
                  ? target.status === "ok"
                    ? "يعمل"
                    : "محفوظ"
                  : "غير مهيأ"}
              </span>
            </div>
            <p>{target.description}</p>
            {target.id === "discord" ? (
              <form
                className="stacked-form"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const result = await update("notifySave", {
                    id: "discord",
                    webhook,
                  });
                  if (result) {
                    setWebhook("");
                    notice("تم حفظ رابط Webhook");
                  }
                }}
              >
                <input
                  value={webhook}
                  onChange={(event) => setWebhook(event.target.value)}
                  dir="ltr"
                  type="url"
                  placeholder="https://discord.com/api/webhooks/…"
                  aria-label="رابط Webhook"
                />
                <div className="button-row">
                  <button className="secondary small" type="submit">
                    حفظ
                  </button>
                  <button
                    className="secondary small"
                    type="button"
                    disabled={!target.configured}
                    onClick={() => update("notifyTest", { id: "discord" })}
                  >
                    <RefreshCw size={14} /> اختبار
                  </button>
                  <button
                    className="secondary small"
                    type="button"
                    onClick={() =>
                      update("notifySave", { id: "discord", clear: true })
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </form>
            ) : (
              <form
                className="stacked-form"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const result = await update("notifySave", {
                    id: "telegram",
                    token: bot.token,
                    chatId: bot.chatId,
                  });
                  if (result) {
                    setBot({ token: "", chatId: "" });
                    notice("تم حفظ بيانات البوت");
                  }
                }}
              >
                <input
                  value={bot.token}
                  onChange={(event) =>
                    setBot({ ...bot, token: event.target.value })
                  }
                  dir="ltr"
                  placeholder="رمز البوت"
                  aria-label="رمز بوت Telegram"
                />
                <input
                  value={bot.chatId}
                  onChange={(event) =>
                    setBot({ ...bot, chatId: event.target.value })
                  }
                  dir="ltr"
                  placeholder="معرّف المحادثة"
                  aria-label="معرّف محادثة Telegram"
                />
                <div className="button-row">
                  <button className="secondary small" type="submit">
                    حفظ
                  </button>
                  <button
                    className="secondary small"
                    type="button"
                    disabled={!target.configured}
                    onClick={() => update("notifyTest", { id: "telegram" })}
                  >
                    <RefreshCw size={14} /> اختبار
                  </button>
                  <button
                    className="secondary small"
                    type="button"
                    onClick={() =>
                      update("notifySave", { id: "telegram", clear: true })
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </form>
            )}
            <button
              className="text-button"
              onClick={() => act("openService", { id: target.id })}
            >
              كيف أحصل عليه <ArrowUpRight size={14} />
            </button>
          </div>
        ))}
      </section>
    </>
  );
}

const when = (iso) =>
  iso
    ? new Date(iso).toLocaleString("ar-SA", {
        dateStyle: "medium",
        timeStyle: "short",
        numberingSystem: "latn",
      })
    : "";

/**
 * Backup and restore. The profile file is sealed to this Windows account, so
 * this room is how a viewer carries their library to a reinstall or a new PC.
 */
function BackupRoom({ update, act, notice }) {
  const [pass, setPass] = useState({ one: "", two: "" });
  const [secrets, setSecrets] = useState(false);
  const [left, setLeft] = useState(null);
  const [picked, setPicked] = useState(null);
  const [openPass, setOpenPass] = useState("");
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);
  const mismatch = pass.two && pass.one !== pass.two;
  const leftCount = left
    ? left.configuredAddons +
      left.liveSources +
      left.providers +
      left.integrations +
      left.notify +
      (left.stremio ? 1 : 0)
    : 0;
  return (
    <>
      <section className="settings-card">
        <h2>
          <Archive size={17} /> حفظ نسخة احتياطية
        </h2>
        <p>
          بيانات رِواق مشفّرة بحساب ويندوز الحالي، فإعادة تثبيت ويندوز أو
          الانتقال لجهاز جديد تفقدك مكتبتك ومتابعتك وطابورك وملفاتك الشخصية.
          النسخة الاحتياطية ملف واحد تحمله معك، مشفّر بعبارة مرور لا يعرفها غيرك
          — لا نستطيع استعادتها إن نسيتها.
        </p>
        <form
          className="stacked-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (pass.one !== pass.two) return;
            setBusy(true);
            const result = await act("backupExport", {
              passphrase: pass.one,
              includeSecrets: secrets,
            });
            setBusy(false);
            if (result?.saved) {
              setLeft(result.left);
              setPass({ one: "", two: "" });
              notice("تم حفظ النسخة الاحتياطية");
            }
          }}
        >
          <label>
            عبارة المرور (8 أحرف على الأقل)
            <input
              type="password"
              autoComplete="new-password"
              value={pass.one}
              onChange={(event) =>
                setPass({ ...pass, one: event.target.value })
              }
            />
          </label>
          <label>
            أعد كتابتها
            <input
              type="password"
              autoComplete="new-password"
              value={pass.two}
              onChange={(event) =>
                setPass({ ...pass, two: event.target.value })
              }
            />
          </label>
          {mismatch && (
            <p className="inline-warning">العبارتان غير متطابقتين</p>
          )}
          <label className="switch-row">
            <input
              type="checkbox"
              checked={secrets}
              onChange={(event) => setSecrets(event.target.checked)}
            />
            تضمين مفاتيحي وحساباتي
          </label>
          {secrets && (
            <p className="inline-warning">
              <LockKeyhole size={15} /> ستحمل النسخة مفاتيح الخدمات وجلسات Trakt
              وSimkl وستريميو وبيانات اشتراكات القنوات وروابط الإضافات المهيأة.
              أمانها بقدر عبارة المرور فقط؛ لا تشاركها ولا تحفظها في مكان عام.
            </p>
          )}
          <button
            className="primary"
            type="submit"
            disabled={busy || mismatch || [...pass.one].length < 8}
          >
            <Download size={16} />{" "}
            {busy ? "جاري التشفير…" : "حفظ نسخة احتياطية"}
          </button>
        </form>
        {left && leftCount > 0 && (
          <p className="subtle">
            لم تُضمَّن عمداً:{" "}
            {[
              left.configuredAddons && `${left.configuredAddons} إضافة مهيأة`,
              left.liveSources && `${left.liveSources} مصدر قنوات`,
              left.providers && `${left.providers} مفتاح خدمة`,
              left.integrations && `${left.integrations} ربط منصة`,
              left.notify && "وجهات الإشعارات",
              left.stremio && "تسجيل دخول ستريميو",
            ]
              .filter(Boolean)
              .join("، ")}
            . أعد إضافتها على الجهاز الجديد، أو احفظ نسخة تتضمن المفاتيح.
          </p>
        )}
      </section>
      <section className="settings-card">
        <h2>
          <Upload size={17} /> استعادة نسخة احتياطية
        </h2>
        <p>
          تستبدل الاستعادة الملفات الشخصية ومكتباتها وإعداداتها بما في النسخة.
          المفاتيح التي لا تحملها النسخة تبقى كما هي على هذا الجهاز، وتُحفظ
          نسختك الحالية بجانبها ليمكن التراجع على هذا الجهاز.
        </p>
        {!picked ? (
          <button
            className="secondary"
            onClick={async () => {
              const result = await act("backupPick");
              if (result) {
                setPicked(result);
                setSummary(null);
                setOpenPass("");
              }
            }}
          >
            اختيار ملف .riwaq
          </button>
        ) : (
          <form
            className="stacked-form"
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              if (!summary) {
                const result = await act("backupPreview", {
                  token: picked.token,
                  passphrase: openPass,
                });
                if (result) setSummary(result);
              } else {
                const result = await update("backupRestore", {
                  token: picked.token,
                  passphrase: openPass,
                });
                if (result) {
                  notice("تمت استعادة النسخة الاحتياطية");
                  setPicked(null);
                  setSummary(null);
                  setOpenPass("");
                }
              }
              setBusy(false);
            }}
          >
            <p className="backup-file">
              <b dir="ltr">{picked.name}</b>
              <span>
                {when(picked.createdAt)}
                {picked.app ? ` · رِواق ${picked.app}` : ""}
                {picked.includesSecrets
                  ? " · تتضمن المفاتيح"
                  : " · بدون مفاتيح"}
              </span>
            </p>
            <label>
              عبارة المرور
              <input
                type="password"
                autoComplete="current-password"
                autoFocus
                value={openPass}
                onChange={(event) => {
                  setOpenPass(event.target.value);
                  setSummary(null);
                }}
              />
            </label>
            {summary && (
              <dl className="backup-summary">
                <div>
                  <dt>الملفات الشخصية</dt>
                  <dd>{summary.profiles.join("، ")}</dd>
                </div>
                <div>
                  <dt>في المكتبات</dt>
                  <dd>{summary.titles}</dd>
                </div>
                <div>
                  <dt>سجل المشاهدة</dt>
                  <dd>{summary.progress}</dd>
                </div>
                <div>
                  <dt>في الطوابير</dt>
                  <dd>{summary.queue}</dd>
                </div>
                <div>
                  <dt>إضافات</dt>
                  <dd>{summary.addons}</dd>
                </div>
                {summary.liveSources > 0 && (
                  <div>
                    <dt>مصادر قنوات</dt>
                    <dd>{summary.liveSources}</dd>
                  </div>
                )}
              </dl>
            )}
            <div className="button-row">
              <button
                className="primary"
                type="submit"
                disabled={busy || !openPass}
              >
                {summary ? "استعادة الآن" : "فتح ومعاينة"}
              </button>
              <button
                className="secondary"
                type="button"
                onClick={() => {
                  act("backupCancel");
                  setPicked(null);
                  setSummary(null);
                  setOpenPass("");
                }}
              >
                إلغاء
              </button>
            </div>
          </form>
        )}
      </section>
    </>
  );
}
