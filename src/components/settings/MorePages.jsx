import React, { useState } from "react";
import { Check, ExternalLink, Loader2, Trash2, Trophy } from "lucide-react";
import { resolveAppearance } from "../../../core/appearance.mjs";
import { HUD_CONTROLS, HUD_PRESETS } from "../../../core/hud-layout.mjs";
import { AWARD_FAMILIES } from "../../../core/awards.mjs";
import { call } from "../../lib/api.js";

function Toggle({ on, title, text, onChange }) {
  return (
    <div className="setting-row">
      <div>
        <b>{title}</b>
        {text && <p>{text}</p>}
      </div>
      <button
        className={`toggle ${on ? "on" : ""}`}
        aria-label={title}
        aria-pressed={!!on}
        onClick={() => onChange(!on)}
      >
        <span />
      </button>
    </div>
  );
}
function Choices({ options, value, onPick, label }) {
  return (
    <div className="choice-row" role="radiogroup" aria-label={label}>
      {options.map(([id, text]) => (
        <button
          key={id}
          role="radio"
          aria-checked={value === id}
          className={value === id ? "selected" : ""}
          onClick={() => onPick(id)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** What the library and listings leave out for this profile. */
export function LibraryPage({ state, update }) {
  const s = state.settings;
  const profile = state.profiles?.list?.find(
    (p) => p.id === state.profiles.active,
  );
  return (
    <section className="settings-card">
      <h2>المكتبة</h2>
      <Toggle
        on={s.hideWatched}
        title="إخفاء الأفلام التي شاهدتها"
        text="تختفي الأفلام التي أكملتها أو علّمتها مشاهدة من الرئيسية والاكتشاف والمجموعات فور انتهائك. البحث والمكتبة ومتابعة المشاهدة واختياراتك في المجلدات تبقى كما هي."
        onChange={(hideWatched) => update("settings", { hideWatched })}
      />
      {profile && (
        <Toggle
          on={profile.hideAdult}
          title="إخفاء محتوى البالغين"
          text={`لملف «${profile.name}»: تختفي كتالوجات الإضافات التي تعلن أنها للبالغين، والعناوين الموسومة كذلك في الكتالوجات والمجموعات والبحث الذكي. إظهارها من جديد يحتاج رمز قسم الإعدادات إن كان محمياً.`}
          onChange={(hideAdult) =>
            update("profileUpdate", { id: profile.id, hideAdult })
          }
        />
      )}
    </section>
  );
}

/** The details page: its background and spoiler protection. */
export function DetailsPage({ state, update }) {
  const s = state.settings;
  const look = resolveAppearance(s);
  return (
    <section className="settings-card">
      <h2>صفحات التفاصيل</h2>
      <label className="studio-field">
        الخلفية
        <Choices
          label="خلفية صفحة التفاصيل"
          options={[
            ["backdrop", "صورة العمل"],
            ["blur", "صورة ضبابية"],
            ["solid", "لون ثابت"],
          ]}
          value={look.detailBackground}
          onPick={(detailBackground) =>
            update("settings", { appearance: { ...look, detailBackground } })
          }
        />
      </label>
      <Toggle
        on={s.spoilerGuard === "titles"}
        title="الحماية من الحرق"
        text="تبقى أسماء الحلقات التي لم تصلها ضبابية، فلا يكشف اسم حلقة ما يحدث فيها. الحلقة التي أنت فيها والتالية لها وما أكملته يبقى واضحاً، ومرور المؤشر يُظهر الاسم متى أردت."
        onChange={(on) =>
          update("settings", { spoilerGuard: on ? "titles" : "off" })
        }
      />
      <Toggle
        on={s.awardIcons !== false}
        title="أيقونات الجوائز"
        text="كأس لكل عائلة جوائز (الأوسكار، غولدن غلوب، إيمي…) تحت وصف العمل، من بيانات ويكي بيانات."
        onChange={(awardIcons) => update("settings", { awardIcons })}
      />
    </section>
  );
}

const AI_STATUS = {
  off: "غير مفعّل",
  untested: "محفوظ، لم يُجرَّب",
  ok: "يعمل",
  error: "تعذّر الوصول للمزوّد",
  rejected: "رفض المزوّد المفتاح",
};

/** AI search with the viewer's own Groq or OpenRouter key. */
export function AiPage({ state, update }) {
  const ai = state.aiSearch || { providers: [], configured: false };
  const [provider, setProvider] = useState(
    ai.provider || ai.providers[0]?.id || "groq",
  );
  const [key, setKey] = useState("");
  const [model, setModel] = useState(ai.model || "");
  const [busy, setBusy] = useState(false);
  const chosen = ai.providers.find((p) => p.id === provider);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const saved = await update("aiSave", { provider, key, model });
    if (saved) {
      setKey("");
      await update("aiTest");
    }
    setBusy(false);
  };
  return (
    <>
      <section className="settings-card">
        <h2>البحث بالذكاء الاصطناعي</h2>
        <p>
          صف ما تريد مشاهدته بكلماتك، مثل «فيلم خيال علمي هادئ عن الفضاء مثل
          Interstellar»، فيقترح النموذج عناوين يبحث عنها رِواق في TMDB أو في
          إضافاتك. يظهر زر السؤال في صفحة نتائج البحث.
        </p>
        <p className="subtle">
          الخصوصية: يُرسل فقط ما تكتبه في البحث حين تضغط الزر، إلى المزوّد الذي
          تختاره وبمفتاحك أنت. لا يُرسل سجل مشاهدتك ولا مكتبتك. المفتاح يحفظ
          مشفراً بتشفير ويندوز ولا يعود للواجهة.
        </p>
        {ai.configured && (
          <div className="service-row">
            <div className="service-row-head">
              <b>
                {ai.providers.find((p) => p.id === ai.provider)?.name} ·{" "}
                <span dir="ltr">{ai.model}</span>
              </b>
              <span
                className={`service-status ${ai.status === "ok" ? "ok" : ["error", "rejected"].includes(ai.status) ? "bad" : ""}`}
              >
                {AI_STATUS[ai.status] || ai.status}
              </span>
            </div>
            <div className="button-row">
              <button
                className="secondary small"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await update("aiTest");
                  setBusy(false);
                }}
              >
                {busy && <Loader2 size={15} className="spin" />} تجربة
              </button>
              <button
                className="ghost small"
                onClick={() => update("aiSave", { clear: true })}
              >
                <Trash2 size={15} /> إزالة المفتاح
              </button>
            </div>
          </div>
        )}
      </section>
      <section className="settings-card">
        <h2>{ai.configured ? "تغيير المزوّد أو المفتاح" : "ربط مزوّد"}</h2>
        <form className="home-server-form" onSubmit={save}>
          <label>
            المزوّد
            <Choices
              label="المزوّد"
              options={ai.providers.map((p) => [p.id, p.name])}
              value={provider}
              onPick={setProvider}
            />
          </label>
          <label>
            المفتاح
            <span className="input-action">
              <input
                type="password"
                dir="ltr"
                autoComplete="off"
                aria-label="مفتاح المزوّد"
                placeholder={
                  ai.configured && ai.provider === provider
                    ? "اتركه فارغاً لإبقاء المفتاح الحالي"
                    : "API key"
                }
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
              <button
                type="button"
                className="ghost icon"
                title="صفحة المفاتيح"
                aria-label="صفحة المفاتيح"
                onClick={() => call("openService", { id: provider })}
              >
                <ExternalLink size={15} />
              </button>
            </span>
          </label>
          <label>
            النموذج
            <input
              dir="ltr"
              aria-label="النموذج"
              placeholder={chosen?.model}
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <Check size={16} />
            )}{" "}
            حفظ وتجربة
          </button>
        </form>
        <p className="subtle">
          لكل من Groq وOpenRouter خطة مجانية محدودة. اترك النموذج فارغاً
          لاستخدام الافتراضي.
        </p>
      </section>
    </>
  );
}

const PRESET_NAMES = [
  ["full", "كامل", "كل أزرار التحكم."],
  ["minimal", "بسيط", "بلا تقديم ورجوع وصوت ووقت انتهاء."],
  ["cinema", "سينمائي", "التشغيل والشريط والترجمة وملء الشاشة فقط."],
  ["custom", "مخصص", "اختر الأزرار بنفسك."],
];

/** Which HUD controls the player shows. */
export function PlayerLayoutPage({ state, update }) {
  const s = state.settings;
  const layout = s.hudLayout || "full";
  const hidden = new Set(
    layout === "custom" ? s.hudHidden || [] : HUD_PRESETS[layout] || [],
  );
  return (
    <section className="settings-card">
      <h2>تخطيط المشغل</h2>
      <p>
        يحدد ما يظهر في شريط تحكم المشغل. التشغيل والإيقاف والشريط الزمني وزر
        الإيقاف تبقى دائماً، والاختصارات تعمل مهما أخفيت.
      </p>
      <div className="frame-options p2p-options" role="radiogroup">
        {PRESET_NAMES.map(([id, title, text]) => (
          <button
            key={id}
            role="radio"
            aria-checked={layout === id}
            className={layout === id ? "selected" : ""}
            onClick={() =>
              update("settings", {
                hudLayout: id,
                ...(id === "custom" && layout !== "custom"
                  ? { hudHidden: [...hidden] }
                  : {}),
              })
            }
          >
            <b>{title}</b>
            <p>{text}</p>
          </button>
        ))}
      </div>
      <h3>الأزرار</h3>
      <div className="choice-row">
        {HUD_CONTROLS.map(([id, label]) => {
          const shown = !hidden.has(id);
          return (
            <button
              key={id}
              className={shown ? "selected" : ""}
              aria-pressed={shown}
              disabled={layout !== "custom"}
              onClick={() =>
                update("settings", {
                  hudHidden: shown
                    ? [...hidden, id]
                    : [...hidden].filter((h) => h !== id),
                })
              }
            >
              {shown && <Check size={13} />} {label}
            </button>
          );
        })}
      </div>
      {layout !== "custom" && (
        <p className="subtle">اختر «مخصص» لتعديل الأزرار واحداً واحداً.</p>
      )}
    </section>
  );
}

/** Award icons on details pages, and the families they cover. */
export function AwardsPage({ state, update }) {
  const on = state.settings.awardIcons !== false;
  return (
    <section className="settings-card">
      <h2>أيقونات الجوائز</h2>
      <Toggle
        on={on}
        title="إظهار كؤوس الجوائز"
        text="تحت وصف العمل في صفحة التفاصيل: كأس لكل عائلة جوائز فاز بها العمل، مع عددها. البيانات من ويكي بيانات دون مفتاح."
        onChange={(awardIcons) => update("settings", { awardIcons })}
      />
      <div className={`award-trophies ${on ? "" : "dimmed"}`}>
        {AWARD_FAMILIES.map(([id, label, , color]) => (
          <span key={id} className="award-trophy" style={{ "--trophy": color }}>
            <Trophy size={16} /> {label}
          </span>
        ))}
      </div>
      <p className="subtle">
        الجوائز خارج هذه العائلات تُعدّ ضمن «أخرى» وتبقى مذكورة في قسم فريق
        العمل.
      </p>
    </section>
  );
}
