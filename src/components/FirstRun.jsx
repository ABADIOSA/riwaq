import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronLeft,
  Database,
  ExternalLink,
  Film,
  HeartHandshake,
  MonitorPlay,
  Music2,
  Puzzle,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Modal } from "./UI.jsx";
import UsageSettings from "./UsageSettings.jsx";
import { call, isWeb } from "../lib/api.js";
import { cleanLanguage } from "../../core/i18n.mjs";

const STEPS = [
  "أهلاً بك",
  "مصادرك وبياناتك",
  "اختيارك للخصوصية",
  "جاهز للبداية",
];
const TITLES = [
  "كل حكاياتك، في مساحة تشبهك.",
  "صورة أوضح. مصادر من اختيارك.",
  "ساعد رِواق يكبر، على راحتك.",
  "مساحتك جاهزة. اختر أول خطوة.",
];
const PROVIDER_TIPS = [
  ["omdb", "OMDb", "لتقييمات IMDb وRotten Tomatoes وMetacritic."],
  ["mdblist", "MDBList", "لتجميع تقييمات من عدة مواقع في مكان واحد."],
  ["fanart", "Fanart.tv", "لشعارات الأعمال وخلفيات إضافية."],
];

/** A skippable, device-local guide; all optional writes use existing guarded APIs. */
export default function FirstRun({ state, onState, onDone }) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [key, setKey] = useState("");
  const [keyNote, setKeyNote] = useState("");
  const [start, setStart] = useState("home");
  const heading = useRef();
  const provider = (state.providers || []).find((p) => p.id === "tmdb");
  const lang = cleanLanguage(state.settings.uiLanguage);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [step]);
  const move = (next) => {
    setError("");
    setStep(next);
  };
  const run = async (task) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const finish = (destination = "home") =>
    run(async () => {
      onState(await call("onboardingComplete"));
      onDone(destination);
    });
  const saveKey = () =>
    run(async () => {
      if (key.trim()) {
        onState(
          await call("providerSave", {
            id: "tmdb",
            key: key.trim(),
            enabled: true,
          }),
        );
        setKey("");
        setKeyNote("حُفظ المفتاح مشفراً. نختبر الاتصال…");
      }
      const next = await call("providerTest", { id: "tmdb" });
      onState(next);
      setKeyNote(
        next.providers.find((p) => p.id === "tmdb")?.status === "ok"
          ? "تم الاتصال بـ TMDB. بيانات أغنى بانتظارك."
          : "المفتاح محفوظ، لكن تعذّر التحقق. يمكنك المتابعة وفحصه لاحقاً من الإعدادات.",
      );
    });
  const streamAddons = (state.addons || []).filter(
    (a) => a.enabled && a.resources?.includes("stream"),
  );
  return (
    <Modal
      className="first-run"
      labelledBy="first-run-heading"
      onClose={() => !busy && finish()}
    >
      <header className="first-run-header">
        <div className="first-run-brand">
          <BookOpen size={25} aria-hidden="true" />
          <span>رِواق</span>
          <span className="first-run-edition">دليل البداية</span>
        </div>
        <div
          className="first-run-languages"
          role="group"
          aria-label="لغة الواجهة"
        >
          {[
            ["ar", "العربية"],
            ["en", "English"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              translate="no"
              lang={id}
              aria-pressed={lang === id}
              disabled={busy}
              onClick={() =>
                id !== lang &&
                run(async () =>
                  onState(await call("settings", { uiLanguage: id })),
                )
              }
            >
              {label}
            </button>
          ))}
        </div>
      </header>
      <ol className="first-run-steps" aria-label="خطوات البداية">
        {STEPS.map((label, index) => (
          <li key={label} aria-current={step === index ? "step" : undefined}>
            <button
              type="button"
              disabled={busy || index > step}
              onClick={() => move(index)}
            >
              <span>{index < step ? <Check size={14} /> : index + 1}</span>
              {label}
            </button>
          </li>
        ))}
      </ol>
      <div className="first-run-stage">
        <section className="first-run-body">
          <h2 id="first-run-heading" ref={heading} tabIndex={-1}>
            {TITLES[step]}
          </h2>
          {step === 0 && (
            <>
              <p className="first-run-lead">
                رِواق يجمع أفلامك ومسلسلاتك وموسيقاك في تجربة عربية، بمصادر
                تضيفها أنت. هذه جولة قصيرة، وكل إعداد فيها اختياري.
              </p>
              <div className="first-run-features">
                <div>
                  <Film />
                  <b>شاهد بطريقتك</b>
                  <p>إضافات Stremio، مشغل مدمج وترجمة قابلة للتخصيص.</p>
                </div>
                <div>
                  <Music2 />
                  <b>أكثر من شاشة</b>
                  <p>موسيقاك وملفاتك المحلية، وبث تضيف مصادره بنفسك.</p>
                </div>
                <div>
                  <HeartHandshake />
                  <b>مساحة لك</b>
                  <p>مكتبتك وتقدمك وملفات المشاهدين، وحساب رِواق اختياري.</p>
                </div>
              </div>
              <p className="first-run-footnote">
                رِواق مجاني حالياً. لا تحتاج اشتراكاً أو مفتاح API لتبدأ.
              </p>
            </>
          )}
          {step === 1 && (
            <>
              <p className="first-run-lead">
                الإضافات تجلب الكتالوجات ومصادر التشغيل. مفاتيح البيانات تحسّن
                المعلومات والصور؛ لا تفتح محتوى المنصات المدفوعة.
              </p>
              <div className="first-run-provider">
                <div className="first-run-provider-title">
                  <Database size={20} />
                  <b>TMDB</b>
                  <span>اختياري · بداية جيدة</span>
                </div>
                <p>
                  للعناوين والأوصاف العربية، الصور، طاقم العمل واقتراحات
                  الاكتشاف. يعرض رِواق قوائم Cinemeta بدونه أيضاً.
                </p>
                <button
                  className="text-button"
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => call("openService", { id: "tmdb" }))}
                >
                  الحصول على مفتاح من TMDB <ExternalLink size={14} />
                </button>
                <label htmlFor="first-run-tmdb">
                  مفتاح TMDB أو API Read Access Token
                </label>
                <div className="first-run-key-row">
                  <input
                    id="first-run-tmdb"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    dir="ltr"
                    maxLength={4096}
                    value={key}
                    onChange={(e) => {
                      setKey(e.target.value);
                      setKeyNote("");
                    }}
                    placeholder={
                      provider?.configured
                        ? "يوجد مفتاح محفوظ؛ اتركه فارغاً للاحتفاظ به"
                        : "الصق مفتاحك هنا، أو تابع بدونه"
                    }
                    disabled={busy}
                  />
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || (!key.trim() && !provider?.configured)}
                    onClick={saveKey}
                  >
                    {busy ? "جاري التحقق…" : "حفظ واختبار"}
                  </button>
                </div>
                <small>
                  لا تضع كلمة مرور حسابك. يحفظ رِواق المفتاح في مخزنه المشفر،
                  ولا يرسله مع إحصاءات الاستخدام. يخضع استخدام الخدمة لشروطها.
                </small>
                {keyNote && (
                  <p className="first-run-key-note" role="status">
                    {keyNote}
                  </p>
                )}
              </div>
              <details className="first-run-more">
                <summary>ماذا عن المفاتيح الأخرى؟</summary>
                {PROVIDER_TIPS.map(([id, name, tip]) => (
                  <div key={id}>
                    <b>{name}</b>
                    <p>{tip}</p>
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={() => run(() => call("openService", { id }))}
                    >
                      صفحة الخدمة <ExternalLink size={13} />
                    </button>
                  </div>
                ))}
                <p>
                  أضف ما تحتاجه لاحقاً من الإعدادات ← مكتبة البيانات. المفاتيح
                  ليست مطلوبة كلها، وقد تختلف حدود الخدمات وشروطها.
                </p>
              </details>
            </>
          )}
          {step === 2 && (
            <>
              <p className="first-run-lead">
                معرفة الأجهزة النشطة والإصدارات المستخدمة تساعد المطوّر في تحسين
                رِواق. القرار لك؛ المتابعة لا تعني الموافقة.
              </p>
              <UsageSettings notice={setError} compact />
              <div className="first-run-privacy-note">
                <ShieldCheck size={18} />
                <span>
                  لا نجمع محتوى ما تشاهده، ولا مفاتيح الخدمات، ولا معرّفاً من
                  عتاد جهازك. يمكنك تغيير قرارك لاحقاً من الإعدادات.
                </span>
              </div>
            </>
          )}
          {step === 3 && (
            <>
              <p className="first-run-lead">
                ستجد دليل البداية هنا دائماً: الإعدادات ← دليل البداية. أكمل
                الآن، وخصص الباقي على مهل.
              </p>
              <div className="first-run-readiness">
                <span>
                  <Database size={17} />
                  {provider?.configured
                    ? "مفتاح TMDB محفوظ"
                    : "يمكنك البدء بدون TMDB"}
                </span>
                <span>
                  <Puzzle size={17} />
                  {streamAddons.length
                    ? "توجد إضافات تعلن مصادر تشغيل"
                    : "أضف مصدر تشغيلك أو استورد إضافات Stremio"}
                </span>
              </div>
              <fieldset className="first-run-start">
                <legend>من أين تحب تبدأ؟</legend>
                {[
                  ["home", "استكشف الرئيسية"],
                  ["addons", "أضف مصادر المشاهدة"],
                  ["stremio", "استورد إضافات Stremio"],
                ].map(([id, label]) => (
                  <label key={id}>
                    <input
                      type="radio"
                      name="first-run-start"
                      value={id}
                      checked={start === id}
                      onChange={() => setStart(id)}
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
              <details className="first-run-more">
                <summary>ثلاث نصائح توفر عليك وقتاً</summary>
                <ul>
                  <li>
                    البحث بـ Ctrl + K، ودليل الاختصارات بعلامة ؟ خارج حقول
                    الكتابة.
                  </li>
                  <li>
                    {isWeb
                      ? "بعض صيغ الفيديو تحتاج نسخة ويندوز ومشغلها المدمج."
                      : "إذا علقت أدوات المشغل، يعيد F8 أدوات التحكم دون فقدان موضع المشاهدة."}
                  </li>
                  <li>
                    الكتالوج ليس مصدر تشغيل. عدم وجود مصادر يعني مراجعة إضافاتك،
                    وليس إضافة مفتاح TMDB آخر.
                  </li>
                </ul>
              </details>
            </>
          )}
        </section>
        <aside className="first-run-art" aria-hidden="true">
          <div className="first-run-arch">
            <div />
            <div />
            <div />
            <span>
              {step === 2 ? (
                <ShieldCheck size={46} />
              ) : (
                <MonitorPlay size={46} />
              )}
            </span>
          </div>
          <span className="first-run-art-kicker">RIWAQ / YOUR SPACE</span>
          <h3>
            {step === 2 ? "الاختيار لك. دائماً." : "للصورة، والصوت، ولك."}
          </h3>
          <p>
            {step === 2
              ? "نطوّر التجربة معك، دون معرفة حكاياتك."
              : "إعدادات أقل في البداية. مساحة أكبر للاستمتاع."}
          </p>
          <div className="first-run-art-tags">
            <span>
              <Film size={13} /> سينما
            </span>
            <span>
              <Music2 size={13} /> موسيقى
            </span>
            <span>
              <Sparkles size={13} /> اكتشاف
            </span>
          </div>
        </aside>
      </div>
      <footer className="first-run-footer">
        <div className="first-run-footer-actions">
          {step > 0 && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => move(step - 1)}
            >
              <ArrowRight size={16} className="first-run-direction" />
              السابق
            </button>
          )}
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => (step === 3 ? finish(start) : move(step + 1))}
          >
            {busy
              ? "لحظة…"
              : step === 3
                ? "ابدأ رِواق"
                : step === 0
                  ? "خلّنا نجهّز رِواق"
                  : step === 2
                    ? "متابعة باختياري الحالي"
                    : "متابعة"}
            <ArrowLeft size={17} className="first-run-direction" />
          </button>
        </div>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => finish()}
        >
          الدخول مباشرة، أكمل لاحقاً{" "}
          <ChevronLeft size={14} className="first-run-direction" />
        </button>
        {error && (
          <p className="first-run-error" role="alert">
            {error}
          </p>
        )}
      </footer>
    </Modal>
  );
}
