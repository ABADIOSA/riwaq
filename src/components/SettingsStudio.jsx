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
} from "lucide-react";
import { call } from "../lib/api.js";

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
  ["subtitles", "الصوت والترجمة", "عربي لغة حجم توقيت مسارات", Subtitles],
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
        <span className="version-badge">BETA 0.2</span>
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
                      "تشغيل الحلقة التالية",
                      "اختيار أول مصدر متوافق حسب ترتيبك عند نهاية الحلقة.",
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
                  </section>
                  <section className="settings-card">
                    <h2>اختصارات المشاهدة</h2>
                    <div className="shortcut-list">
                      <span>
                        <kbd>Space</kbd> تشغيل وإيقاف مؤقت
                      </span>
                      <span>
                        <kbd>F</kbd> ملء الشاشة
                      </span>
                      <span>
                        <kbd>← →</kbd> رجوع وتقديم
                      </span>
                      <span>
                        <kbd>Ctrl K</kbd> البحث
                      </span>
                    </div>
                    <p className="subtle">
                      حجم وتوقيت الترجمة والمسارات وضبط الصورة متاحة أيضًا أثناء
                      التشغيل.
                    </p>
                  </section>
                </>
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
    </section>
  );
}
