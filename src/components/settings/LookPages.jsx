import React, { useState } from "react";
import {
  Check,
  Copy,
  Download,
  ImageOff,
  Minus,
  RotateCcw,
  Save,
  Square,
  Trash2,
  X,
} from "lucide-react";
import {
  THEME_LIMIT,
  decodeTheme,
  encodeTheme,
  imageUrl,
  resolveAppearance,
} from "../../../core/appearance.mjs";
import { call } from "../../lib/api.js";

const newId = () =>
  (crypto.randomUUID?.() || String(Date.now()))
    .replace(/[^\w-]/g, "")
    .slice(0, 20);

/** Radio chips, as the studio uses them. */
function Choices({ options, value, onPick }) {
  return (
    <div className="choice-row" role="radiogroup">
      {options.map(([id, label]) => (
        <button
          key={String(id)}
          role="radio"
          aria-checked={value === id}
          className={value === id ? "selected" : ""}
          onClick={() => onPick(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
function Toggle({ on, title, text, onChange }) {
  return (
    <div className="setting-row">
      <div>
        <b>{title}</b>
        <p>{text}</p>
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
const appearanceOf = (state) => resolveAppearance(state.settings);
const patchAppearance = (state, update, patch) =>
  update("settings", { appearance: { ...appearanceOf(state), ...patch } });

/** "Your themes": designs the viewer saved, to switch between in a click. */
export function ThemesLibrary({ state, update, notice }) {
  const themes = state.settings.savedThemes || [];
  const current = appearanceOf(state);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const save = (list) => update("settings", { savedThemes: list });
  const add = async (appearance, title) => {
    if (themes.length >= THEME_LIMIT)
      return notice(`وصلت إلى ${THEME_LIMIT} سمة محفوظة. احذف واحدة أولاً.`);
    if (
      await save([
        ...themes,
        { id: newId(), name: title.trim() || "سمتي", appearance },
      ])
    )
      notice("حُفظت السمة");
  };
  const same = (a) => encodeTheme(a) === encodeTheme(current);
  return (
    <section className="settings-card">
      <h2>سماتك</h2>
      <p>
        احفظ تصميمك الحالي باسم، وبدّل بين سماتك بضغطة. تُحفظ مع ملفك الشخصي
        وتنتقل مع النسخة الاحتياطية.
      </p>
      <form
        className="theme-save"
        onSubmit={(e) => {
          e.preventDefault();
          add(current, name).then(() => setName(""));
        }}
      >
        <input
          aria-label="اسم السمة"
          placeholder="اسم السمة، مثل: ليالي جدة"
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="primary">
          <Save size={15} /> احفظ التصميم الحالي
        </button>
      </form>
      {themes.length ? (
        <div className="saved-themes">
          {themes.map((t) => {
            const c = t.appearance.colors;
            const active = same(t.appearance);
            return (
              <div
                key={t.id}
                className={`saved-theme ${active ? "selected" : ""}`}
              >
                <button
                  className="saved-theme-face"
                  style={{ background: c.bg, color: c.text }}
                  onClick={() =>
                    update("settings", { appearance: t.appearance })
                  }
                  title="طبّق هذه السمة"
                >
                  <span style={{ background: c.panel }} />
                  <i
                    style={{
                      background: `linear-gradient(90deg, ${c.accent}, ${c.accentEnd})`,
                    }}
                  />
                  <b dir="auto">{t.name}</b>
                  {active && <Check size={15} />}
                </button>
                <div className="saved-theme-tools">
                  <button
                    title="نسخ الرمز"
                    onClick={async () =>
                      (await call("copyThemeCode", {
                        code: encodeTheme(t.appearance),
                      }).catch(() => false)) && notice("نُسخ رمز السمة")
                    }
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    title="حذف"
                    onClick={() => save(themes.filter((x) => x.id !== t.id))}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="subtle">لم تحفظ أي سمة بعد.</p>
      )}
      <label className="studio-field">
        أضف سمة من رمز وصلك
        <textarea
          dir="ltr"
          rows={2}
          placeholder="RIWAQ-THEME-1:…"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setError("");
          }}
        />
      </label>
      {error && <p className="inline-warning">{error}</p>}
      <button
        className="secondary"
        disabled={!code.trim()}
        onClick={() => {
          try {
            add(decodeTheme(code), "سمة من صديق").then(() => setCode(""));
          } catch (e) {
            setError(e.message);
          }
        }}
      >
        <Download size={15} /> أضفها إلى سماتك
      </button>
    </section>
  );
}

/** Logo & icon: the sidebar logo and the taskbar icon. */
export function LogoPage({ state, update }) {
  const a = appearanceOf(state);
  const [url, setUrl] = useState(a.logoImage);
  const set = (patch) => patchAppearance(state, update, patch);
  return (
    <>
      <section className="settings-card">
        <h2>الشعار</h2>
        <p>كيف يظهر شعار رِواق في القائمة.</p>
        <div className="logo-choices">
          {[
            ["full", "الشعار والاسم"],
            ["mark", "الشعار فقط"],
            ["name", "الاسم فقط"],
            ["image", "صورتي"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={a.logoStyle === id ? "selected" : ""}
              disabled={id === "image" && !a.logoImage}
              onClick={() => set({ logoStyle: id })}
            >
              <span className={`logo-sample logo-${id}`}>
                {id !== "name" && id !== "image" && (
                  <span className="brand-mark">
                    <span />
                    <span />
                    <span />
                  </span>
                )}
                {id !== "mark" && id !== "image" && <b>رِواق</b>}
                {id === "image" &&
                  (a.logoImage ? (
                    <img src={a.logoImage} alt="" />
                  ) : (
                    <ImageOff size={22} />
                  ))}
              </span>
              <small>{label}</small>
            </button>
          ))}
        </div>
        <label className="studio-field">
          صورة شعارك (رابط https لصورة PNG أو SVG)
          <input
            dir="ltr"
            placeholder="https://…/logo.png"
            maxLength={2000}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => {
              const clean = imageUrl(url);
              setUrl(clean);
              set({
                logoImage: clean,
                ...(clean ? { logoStyle: "image" } : {}),
              });
            }}
          />
          <small>تُعرض الصورة كما هي؛ رِواق لا يرفعها إلى أي مكان.</small>
        </label>
        <label className="studio-field">
          لون الشعار
          <Choices
            options={[
              ["accent", "لون التمييز"],
              ["gold", "ذهبي رِواق"],
            ]}
            value={a.logoTint}
            onPick={(logoTint) => set({ logoTint })}
          />
        </label>
      </section>
      <section className="settings-card">
        <h2>أيقونة التطبيق</h2>
        <p>أيقونة رِواق في شريط المهام أثناء تشغيله.</p>
        <Choices
          options={[
            ["classic", "أيقونة رِواق"],
            ["accent", "بلون التمييز"],
          ]}
          value={a.appIcon}
          onPick={(appIcon) => set({ appIcon })}
        />
      </section>
    </>
  );
}

/** Ambience: a wallpaper behind the app, or the glow of the artwork. */
export function AmbiencePage({ state, update }) {
  const a = appearanceOf(state);
  const [url, setUrl] = useState(a.wallpaper);
  const set = (patch) => patchAppearance(state, update, patch);
  return (
    <>
      <section className="settings-card">
        <h2>خلفية التطبيق</h2>
        <p>ضع صورتك خلف رِواق. شريط التعتيم يبقي النص مقروءاً فوقها.</p>
        <label className="studio-field">
          رابط الصورة (https)
          <input
            dir="ltr"
            placeholder="https://…/wallpaper.jpg"
            maxLength={2000}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => {
              const clean = imageUrl(url);
              setUrl(clean);
              set({ wallpaper: clean });
            }}
          />
        </label>
        {a.wallpaper && (
          <>
            <div
              className="wallpaper-preview"
              style={{
                backgroundImage: `url("${a.wallpaper}")`,
                filter: `blur(${a.wallpaperBlur / 3}px)`,
              }}
            >
              <i style={{ opacity: a.wallpaperDim / 100 }} />
            </div>
            <label className="studio-field">
              <span>
                التعتيم <b>{a.wallpaperDim}%</b>
              </span>
              <input
                type="range"
                min="0"
                max="95"
                step="5"
                value={a.wallpaperDim}
                onChange={(e) => set({ wallpaperDim: Number(e.target.value) })}
              />
            </label>
            <label className="studio-field">
              <span>
                الضبابية <b>{a.wallpaperBlur}</b>
              </span>
              <input
                type="range"
                min="0"
                max="24"
                step="2"
                value={a.wallpaperBlur}
                onChange={(e) => set({ wallpaperBlur: Number(e.target.value) })}
              />
            </label>
            <button
              className="secondary small"
              onClick={() => {
                setUrl("");
                set({ wallpaper: "" });
              }}
            >
              <X size={14} /> إزالة الخلفية
            </button>
          </>
        )}
      </section>
      <section className="settings-card">
        <h2>ثيم العمل</h2>
        <p>
          لما تفتح صفحة فيلم أو مسلسل، تاخذ ألوانها من العمل نفسه: من صورته،
          وإذا ما انقرأت الصورة فمن نوعه (الرعب أحمر، الخيال العلمي أزرق،
          الكوميديا ذهبي…). يتغير لون صفحة العمل بس، وترجع ألوانك برا الصفحة.
        </p>
        <Choices
          options={[
            ["artwork", "من صورة العمل"],
            ["genre", "من نوع العمل"],
            ["off", "بدون (ألواني دائماً)"],
          ]}
          value={state.settings.titleTheme || "artwork"}
          onPick={(titleTheme) => update("settings", { titleTheme })}
        />
      </section>
      <section className="settings-card">
        <h2>أغنية العمل</h2>
        <p>
          لما تفتح صفحة فيلم أو مسلسل، رِواق يشغّل أغنيته إذا لقاها بثقة: كاملة
          على Spotify إذا ربطته (Premium)، وإلا مقطع 30 ثانية من Apple Music أو
          Deezer. إذا ما تأكد يسكت ويقول لك. ما تقاطع موسيقاك ولا تشتغل أثناء
          المشاهدة، وتوقف لما تطلع من الصفحة. «مو هذي» تمنعها لذاك العمل.
        </p>
        <Choices
          options={[
            ["auto", "تشتغل تلقائياً"],
            ["button", "زر أشغّلها أنا"],
            ["off", "بدون"],
          ]}
          value={state.settings.themeSong || "auto"}
          onPick={(themeSong) => update("settings", { themeSong })}
        />
        {(state.settings.themeSong || "auto") !== "off" && (
          <div className="studio-field">
            المصدر
            <Choices
              options={[
                ["auto", "Spotify كاملة إذا مربوط (Premium)، وإلا مقطع"],
                ["previews", "مقطع 30 ثانية دائماً"],
              ]}
              value={state.settings.themeSongSource || "auto"}
              onPick={(themeSongSource) =>
                update("settings", { themeSongSource })
              }
            />
          </div>
        )}
        {(state.settings.themeSong || "auto") !== "off" && (
          <div className="studio-field">
            مستوى الصوت
            <Choices
              options={[10, 20, 35, 50, 70, 100].map((v) => [v, `${v}٪`])}
              value={state.settings.themeSongVolume || 35}
              onPick={(themeSongVolume) =>
                update("settings", { themeSongVolume })
              }
            />
          </div>
        )}
        {(state.settings.themeSongSkip || []).length > 0 && (
          <button
            className="text-button"
            onClick={() => update("settings", { themeSongSkip: [] })}
          >
            رجّع الأغاني اللي قلت عنها «مو هذي» (
            {(state.settings.themeSongSkip || []).length})
          </button>
        )}
      </section>
      <section className="settings-card">
        <h2>أجواء العمل المعروض</h2>
        <p>
          توهّج خافت بألوان العمل خلف رِواق. يتبع العمل اللي تحت مؤشر الفأرة، أو
          الواجهة الرئيسية وصفحة العمل المفتوحة.
        </p>
        <Choices
          options={[
            ["off", "بدون"],
            ["artwork", "توهّج من صورة العمل"],
          ]}
          value={a.ambient}
          onPick={(ambient) => set({ ambient })}
        />
      </section>
      {a.ambient === "artwork" && (
        <section className="settings-card">
          <h2>تفاعل التوهّج</h2>
          <div className="studio-field">
            يتبع
            <Choices
              options={[
                ["hover", "العمل تحت المؤشر"],
                [
                  "hero",
                  // Riwaq's interface has no hero; only the title page glows.
                  state.settings.interfaceStyle === "classic"
                    ? "الواجهة وصفحة العمل فقط"
                    : "صفحة العمل فقط",
                ],
              ]}
              value={a.ambientFollow}
              onPick={(ambientFollow) => set({ ambientFollow })}
            />
          </div>
          {a.ambientFollow === "hover" && (
            <>
              <label className="studio-field">
                <span>
                  مدة التوقف قبل التغيير <b>{a.ambientDelay} ملّي ثانية</b>
                </span>
                <input
                  type="range"
                  min="0"
                  max="1500"
                  step="50"
                  value={a.ambientDelay}
                  onChange={(e) =>
                    set({ ambientDelay: Number(e.target.value) })
                  }
                />
                <small>
                  أقصر يعني أسرع، وأطول يمنع الوميض وأنت تمر على صف كامل.
                </small>
              </label>
              <div className="studio-field">
                لما يطلع المؤشر من البطاقات
                <Choices
                  options={[
                    ["return", "يرجع لعمل الواجهة"],
                    ["stay", "يبقى على آخر عمل"],
                  ]}
                  value={a.ambientLeave}
                  onPick={(ambientLeave) => set({ ambientLeave })}
                />
              </div>
            </>
          )}
          <div className="studio-field">
            الصورة
            <Choices
              options={[
                ["backdrop", "خلفية العمل"],
                ["poster", "البوستر"],
              ]}
              value={a.ambientImage}
              onPick={(ambientImage) => set({ ambientImage })}
            />
          </div>
          <div className="studio-field">
            النعومة
            <Choices
              options={[
                ["soft", "خفيفة"],
                ["medium", "متوسطة"],
                ["strong", "قوية"],
              ]}
              value={a.ambientBlur}
              onPick={(ambientBlur) => set({ ambientBlur })}
            />
          </div>
          <label className="studio-field">
            <span>
              القوة <b>{a.ambientStrength}%</b>
            </span>
            <input
              type="range"
              min="5"
              max="60"
              step="1"
              value={a.ambientStrength}
              onChange={(e) => set({ ambientStrength: Number(e.target.value) })}
            />
          </label>
          <label className="studio-field">
            <span>
              سرعة الانتقال <b>{a.ambientFade} ملّي ثانية</b>
            </span>
            <input
              type="range"
              min="0"
              max="2000"
              step="100"
              value={a.ambientFade}
              onChange={(e) => set({ ambientFade: Number(e.target.value) })}
            />
            <small>مع «تقليل الحركة» يتغيّر التوهّج فوراً بلا انتقال.</small>
          </label>
        </section>
      )}
    </>
  );
}

/** Window: the title bar, its buttons, the frosted top bar and dragging. */
export function WindowPage({ state, update, win }) {
  const s = state.settings;
  const save = (patch) => update("settings", patch);
  const pending = win && win.frame !== (s.windowFrame || "native");
  return (
    <>
      <section className="settings-card">
        <h2>شريط عنوان النافذة</h2>
        <p>من يرسم شريط العنوان: ويندوز نفسه، أو رِواق.</p>
        <div className="frame-options" role="radiogroup">
          {[
            [
              "native",
              "استخدام شريط عنوان النافذة الأصلي",
              "شريط ويندوز بأزرار التصغير والتكبير والإغلاق، ظاهر في كل مكان حتى أثناء المشاهدة.",
            ],
            [
              "hybrid",
              "شريط هجين بأسلوب أصلي",
              "أزرار ويندوز الأصلية فوق شريط بلون تصميمك، فيبدو رِواق كأنه شريط نظامك.",
            ],
            [
              "riwaq",
              "شريط رِواق وأزراره",
              "رِواق يرسم الشريط والأزرار بنفسه، على اليسار كما في ويندوز العربي، وبالأسلوب الذي تختاره تحت.",
            ],
          ].map(([id, title, text]) => (
            <button
              key={id}
              role="radio"
              aria-checked={(s.windowFrame || "native") === id}
              className={(s.windowFrame || "native") === id ? "selected" : ""}
              onClick={() => save({ windowFrame: id })}
            >
              <span className={`frame-art frame-${id}`}>
                <i />
                <em />
              </span>
              <span>
                <b>{title}</b>
                <small>{text}</small>
              </span>
              {(s.windowFrame || "native") === id && <Check size={16} />}
            </button>
          ))}
        </div>
        {pending && (
          <div className="restart-note">
            <span>يُطبّق شكل الشريط الجديد عند تشغيل رِواق من جديد.</span>
            <button
              className="primary small"
              onClick={() => call("relaunch").catch(() => {})}
            >
              <RotateCcw size={14} /> أعد التشغيل الآن
            </button>
          </div>
        )}
      </section>
      <section className="settings-card">
        <h2>أزرار النافذة</h2>
        <p>كيف تُرسم أزرار التصغير والتكبير والإغلاق في شريط رِواق.</p>
        <Choices
          options={[
            ["filled", "ممتلئ"],
            ["glass", "الزجاج السائل"],
            ["clean", "شفاف ونظيف"],
          ]}
          value={s.windowControls || "filled"}
          onPick={(windowControls) => save({ windowControls })}
        />
        <div
          className={`window-buttons-preview style-${s.windowControls || "filled"}`}
        >
          <span className="window-close">
            <X size={14} />
          </span>
          <span>
            <Square size={12} />
          </span>
          <span>
            <Minus size={14} />
          </span>
        </div>
        {s.windowFrame !== "riwaq" && (
          <small className="subtle">
            يظهر هذا الأسلوب مع «شريط رِواق وأزراره». في الوضعين الآخرين يرسم
            ويندوز أزراره بنفسه.
          </small>
        )}
      </section>
      <section className="settings-card">
        <Toggle
          on={!!s.frostTopBar}
          title="تمويه الشريط العلوي عند التمرير"
          text="أثناء التمرير يبقى الشريط العلوي ظاهراً ويصبح ضبابياً فوق المحتوى تحته. مطفأ افتراضياً لأنه يستخدم التمويه؛ اتركه مطفأ على الأجهزة الأضعف."
          onChange={(frostTopBar) => save({ frostTopBar })}
        />
      </section>
      <section className="settings-card">
        <h2>تحريك النافذة</h2>
        <Toggle
          on={!!s.dragAnywhere}
          title="سحب النافذة من أي مكان"
          text="حرّك رِواق بسحب أي مساحة فارغة في الصفحة، لا شريط العنوان فقط. اتركه مطفأ حتى لا تتحرك النافذة بنقرة غير مقصودة."
          onChange={(dragAnywhere) => save({ dragAnywhere })}
        />
      </section>
    </>
  );
}

/** Interface extras: the ambient screensaver. */
export function ScreensaverCard({ state, update }) {
  const s = state.settings;
  return (
    <section className="settings-card">
      <h2>شاشة التوقف</h2>
      <p>
        تنساب صور الأعمال على الشاشة حين يبقى رِواق بلا استخدام، ولا تظهر أبداً
        أثناء المشاهدة.
      </p>
      <label className="studio-field">
        تبدأ بعد
        <Choices
          options={[
            [0, "أبداً"],
            [1, "دقيقة"],
            [3, "3 دقائق"],
            [5, "5 دقائق"],
            [10, "10 دقائق"],
            [15, "15 دقيقة"],
          ]}
          value={s.screensaver || 0}
          onPick={(screensaver) => update("settings", { screensaver })}
        />
      </label>
      <Toggle
        on={s.screensaverClock !== false}
        title="الساعة على شاشة التوقف"
        text="تعرض الوقت بخط كبير في الزاوية."
        onChange={(screensaverClock) =>
          update("settings", { screensaverClock })
        }
      />
    </section>
  );
}
