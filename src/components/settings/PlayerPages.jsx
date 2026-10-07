import React, { useState } from "react";
import {
  ExternalLink,
  Eye,
  EyeOff,
  Gauge,
  Feather,
  Trash2,
  Loader2,
  RefreshCw,
  Sparkles,
  Wifi,
} from "lucide-react";
import {
  AUDIO_PROFILES,
  AUDIO_PROFILE_IDS,
  EQ_BANDS,
  HDR_MODES,
  VOLUME_MAX,
} from "../../../core/player-tuning.mjs";
import { BANDWIDTH_CAPS } from "../../../core/stream-engine.mjs";
import { arabicCount, SERIES } from "../../../core/arabic.mjs";

function Toggle({ on, title, text, onChange, tag }) {
  return (
    <div className="setting-row">
      <div>
        <b>
          {title}
          {tag && <em className="setting-tag">{tag}</em>}
        </b>
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
function Field({ title, text, children }) {
  return (
    <div className="studio-field player-field">
      <b>{title}</b>
      {text && <p>{text}</p>}
      {children}
    </div>
  );
}

const QUALITY = [
  [
    "smooth",
    Feather,
    "سلس على الأجهزة الضعيفة",
    "ملف MPV السريع: معالجة أخف لأجهزة قديمة وطاقة أقل.",
  ],
  ["balanced", Gauge, "متوازن", "إعدادات MPV الافتراضية، تناسب أغلب الأجهزة."],
  [
    "high",
    Sparkles,
    "أعلى جودة",
    "ملف MPV عالي الجودة: تكبير أوضح وتدرجات أنعم لكرت شاشة قوي.",
  ],
];

// Harbor's three HDR choices; its own support thread showed why true HDR
// gets a separate window (core/player-tuning.mjs HDR_MODES).
const HDR_CHOICES = [
  [
    "tonemap",
    "تحويل إلى SDR",
    "يحوّل HDR إلى صورة عادية دقيقة. يعمل على أي شاشة وكل أدوات التحكم.",
    "موصى به",
  ],
  [
    "window",
    "HDR حقيقي · نافذة منفصلة",
    "لمصادر HDR فقط: MPV يفتح بملء الشاشة في نافذته فيعرفها ويندوز كنافذة HDR. أدوات التحكم من MPV نفسه (حرّك الفأرة)، وEsc يرجعك لرِواق.",
  ],
  [
    "embedded",
    "HDR حقيقي · مضمّن",
    "داخل نافذة رِواق مع كل أدوات التحكم، لكن قد لا يعاملها ويندوز كـ HDR، وعلى بعض الأجهزة تختفي الصورة.",
    "تجريبي",
  ],
];

/** Harbor's Video quality page: MPV's profiles, decoder, renderer and HDR. */
export function VideoPage({ state, update, act, notice }) {
  const s = state.settings;
  const mode = HDR_MODES.includes(s.hdrMode)
    ? s.hdrMode
    : s.hdr
      ? "embedded"
      : "tonemap";
  const set = (patch) => update("settings", patch);
  const hwdec = s.hardwareDecoding === false ? "off" : s.hwdec || "auto";
  return (
    <>
      <section className="settings-card">
        <h2>جودة الصورة</h2>
        <p>
          وازن بين جودة الصورة والأداء. تسري التغييرات على المشاهدة التالية.
        </p>
        <div
          className="quality-cards"
          role="radiogroup"
          aria-label="جودة الصورة"
        >
          {QUALITY.map(([id, Icon, title, text]) => (
            <button
              key={id}
              role="radio"
              aria-checked={(s.videoQuality || "balanced") === id}
              className={
                (s.videoQuality || "balanced") === id ? "selected" : ""
              }
              onClick={() => set({ videoQuality: id })}
            >
              <Icon size={20} />
              <b>{title}</b>
              <small>{text}</small>
            </button>
          ))}
        </div>
        <Field
          title="تسريع العتاد"
          text="فك الترميز بكرت الشاشة. «فرض التشغيل» يستعمل مفكّك D3D11 دائماً؛ ارجع إلى «تلقائي» إذا تعذّر تشغيل فيديو."
        >
          <Choices
            label="تسريع العتاد"
            value={hwdec}
            options={[
              ["auto", "تلقائي"],
              ["on", "فرض التشغيل"],
              ["off", "إيقاف (المعالج)"],
            ]}
            onPick={(id) => set({ hwdec: id, hardwareDecoding: id !== "off" })}
          />
        </Field>
      </section>
      <section className="settings-card">
        <h2>التوافق</h2>
        <p>
          جرّبها إذا ظهر الفيديو بشاشة سوداء أو بألوان غريبة أو بخط عند الحافة.
        </p>
        <Field
          title="العارض"
          text="gpu-next هو الأحدث والأدق. «التوافق» يستعمل العارض القديم لكروت لا يعمل معها."
        >
          <Choices
            label="العارض"
            value={s.renderer || "gpu-next"}
            options={[
              ["gpu-next", "GPU next"],
              ["gpu", "GPU (التوافق)"],
            ]}
            onPick={(renderer) => set({ renderer })}
          />
        </Field>
        <Toggle
          on={s.simpleColor}
          title="وضع الألوان البسيط"
          text="يخرج الصورة بألوان 8 بت لكروت الشاشة القديمة، ويطفئ HDR."
          onChange={(simpleColor) => set({ simpleColor })}
        />
        <Toggle
          on={s.linelessVideo}
          title="فيديو بلا خطوط"
          text="يزيل خطاً رفيعاً لامعاً تظهره بعض الشاشات عند الحافة. قد يخفت HDR ويقل سلاسة 4K. اتركه مطفأ إلا إذا رأيت الخط."
          onChange={(linelessVideo) => set({ linelessVideo })}
        />
      </section>
      <section className="settings-card">
        <h2>HDR</h2>
        <div
          className="quality-cards hdr-modes"
          role="radiogroup"
          aria-label="طريقة HDR"
        >
          {HDR_CHOICES.map(([id, title, text, tag]) => (
            <button
              key={id}
              role="radio"
              aria-checked={mode === id}
              className={mode === id ? "selected" : ""}
              onClick={() => set({ hdrMode: id, hdr: id !== "tonemap" })}
            >
              <b>
                {title}
                {tag && <em className="setting-tag">{tag}</em>}
              </b>
              <small>{text}</small>
            </button>
          ))}
        </div>
        {mode !== "tonemap" && (
          <p className="subtle">
            يحتاج تشغيل HDR في إعدادات ويندوز (العرض ← HDR) وشاشة تدعمه. إذا
            اختفت الصورة أو صارت باهتة، ارجع إلى «تحويل إلى SDR».
          </p>
        )}
        <Field
          title="لوحة العرض"
          text="OLED يحافظ على السواد التام ويُظهر تفاصيل الظل؛ LCD يضبط التباين لشاشات الإضاءة الخلفية."
        >
          <Choices
            label="لوحة العرض"
            value={s.displayPanel || "auto"}
            options={[
              ["auto", "تلقائي"],
              ["oled", "OLED"],
              ["lcd", "LCD"],
            ]}
            onPick={(displayPanel) => set({ displayPanel })}
          />
          <div
            className={`panel-preview panel-${s.displayPanel || "auto"}`}
            aria-hidden="true"
          >
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <i key={i} />
            ))}
          </div>
        </Field>
        <Field
          title="تحويل HDR إلى SDR"
          text="لشاشة بدون HDR: كيف تُضغط الإضاءة العالية. bt.2446a الأدق."
        >
          <Choices
            label="تحويل HDR إلى SDR"
            value={s.toneMapping || "auto"}
            options={[
              ["auto", "تلقائي"],
              ["bt.2446a", "bt.2446a"],
              ["hable", "hable"],
              ["mobius", "mobius"],
              ["reinhard", "reinhard"],
              ["off", "بدون"],
            ]}
            onPick={(toneMapping) => set({ toneMapping })}
          />
        </Field>
      </section>
      <section className="settings-card">
        <h2>NVIDIA RTX Video</h2>
        <p>
          لكروت RTX فقط، عبر معالج الفيديو في ويندوز. فعّل الميزة في تطبيق
          NVIDIA أيضاً. إذا لم يدعمها كرتك تبقى الصورة كما هي، وتظهر شارة RTX في
          المشغل متى اشتغلت.
        </p>
        <Toggle
          on={s.rtxUpscale}
          tag="تجريبي"
          title="RTX Video Super Resolution"
          text="يكبّر فيديو أقل من دقة شاشتك بالذكاء الاصطناعي على كرت الشاشة. يفرض فك الترميز بكرت الشاشة."
          onChange={(rtxUpscale) => set({ rtxUpscale })}
        />
        <Toggle
          on={s.rtxHdr}
          tag="تجريبي"
          title="RTX Video HDR"
          text="يحوّل فيديو SDR إلى HDR على كرت الشاشة. يحتاج «HDR حقيقي · مضمّن» وشاشة HDR."
          onChange={(rtxHdr) => set({ rtxHdr })}
        />
      </section>
      <section className="settings-card">
        <h2>مرشّح الصورة</h2>
        <p>
          مرشّحات مبنية على محرّك MPV نفسه. رِواق لا يرفق ملفات شيدر من طرف
          ثالث؛ إن كان لديك سلسلة GLSL خاصة بك فاخترها من الملف المخصص.
        </p>
        <Choices
          label="مرشّح الصورة"
          value={s.shader || "none"}
          options={[
            ["none", "بدون"],
            ["sharp", "حِدّة"],
            ["anime", "رسوم متحركة"],
            ["film", "سينمائي"],
            ["custom", "ملف GLSL"],
          ]}
          onPick={(shader) => set({ shader })}
        />
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
                if (await act("chooseShader")) notice("تم اختيار ملف الشيدر");
              }}
            >
              اختيار…
            </button>
          </div>
        )}
      </section>
    </>
  );
}

const bandLabel = (hz) => (hz >= 1000 ? `${hz / 1000}k` : String(hz));

/** Harbor's Audio page: profile, normalising, downmix, ceiling and output. */
export function AudioPage({ state, update, act }) {
  const s = state.settings;
  const set = (patch) => update("settings", patch);
  const [devices, setDevices] = useState(null);
  const [listing, setListing] = useState(false);
  const profile = AUDIO_PROFILES[s.audioProfile] || AUDIO_PROFILES.flat;
  const ceiling = VOLUME_MAX.includes(s.volumeMax) ? s.volumeMax : 150;
  const listDevices = async () => {
    setListing(true);
    const list = await act("audioDevices");
    setListing(false);
    setDevices(Array.isArray(list) ? list : []);
  };
  const device = s.audioDevice && s.audioDevice !== "auto" ? s.audioDevice : "";
  return (
    <>
      <section className="settings-card">
        <h2>الصوت</h2>
        <p>
          يتغير الصوت فوراً أثناء المشاهدة، بفلاتر FFmpeg المدمجة في MPV نفسه.
        </p>
        <Toggle
          on={s.audioNormalize}
          title="تطبيع مستوى الصوت"
          text="يوازن بين الحوار الهادئ ومشاهد الحركة الصاخبة، فما تحتاج تلعب بالصوت كل شوي."
          onChange={(audioNormalize) => set({ audioNormalize })}
        />
        <Toggle
          on={s.audioDownmix}
          title="دمج الصوت المحيطي إلى ستيريو"
          text="لسماعات الرأس واللابتوب: صوت 5.1 أو 7.1 يصير ستيريو مع إبقاء قناة الحوار بكامل قوتها. اتركه مطفأ إذا عندك نظام صوت محيطي."
          onChange={(audioDownmix) => set({ audioDownmix })}
        />
      </section>
      <section className="settings-card">
        <h2>ملف الصوت</h2>
        <p>{profile.text}</p>
        <Choices
          label="ملف الصوت"
          value={s.audioProfile || "flat"}
          options={AUDIO_PROFILE_IDS.map((id) => [
            id,
            AUDIO_PROFILES[id].label,
          ])}
          onPick={(audioProfile) => set({ audioProfile })}
        />
        <div className="eq-preview" aria-hidden="true" dir="ltr">
          {profile.gains.map((gain, index) => (
            <span key={EQ_BANDS[index]}>
              <i
                className={gain < 0 ? "cut" : gain > 0 ? "boost" : ""}
                style={{ height: `${50 + gain * 6}%` }}
              />
              <small>{bandLabel(EQ_BANDS[index])}</small>
            </span>
          ))}
        </div>
        {profile.compress && (
          <p className="subtle">
            ويضغط اللحظات الصاخبة فيقرّبها من مستوى الحوار.
          </p>
        )}
      </section>
      <section className="settings-card">
        <h2>الحد الأقصى لتعزيز الصوت</h2>
        <p>
          إلى أي مدى يرتفع الصوت فوق 100% في شريط الصوت. القيم العالية قد تشوّه
          الصوت.
        </p>
        <Choices
          label="الحد الأقصى لتعزيز الصوت"
          value={ceiling}
          options={VOLUME_MAX.map((v) => [v, `${v}%`])}
          onPick={(volumeMax) => set({ volumeMax })}
        />
        <div className="boost-preview" aria-hidden="true">
          <i style={{ width: `${(100 / ceiling) * 100}%` }} />
          <b style={{ width: `${100 - (100 / ceiling) * 100}%` }} />
        </div>
        <p className="subtle">
          الشريط يصل إلى {ceiling}٪، وكل ما بعد العلامة تعزيز.
        </p>
      </section>
      <section className="settings-card">
        <h2>جهاز الإخراج</h2>
        <p>
          أرسل الصوت إلى سماعات أو سماعة رأس أو جهاز استقبال محدد. «افتراضي
          النظام» يتبع إعداد ويندوز.
        </p>
        <div className="setting-row">
          <div>
            <b>الجهاز</b>
            <p dir="auto">
              {device
                ? devices?.find((d) => d.id === device)?.name || device
                : "افتراضي النظام"}
            </p>
          </div>
          <button
            className="secondary small"
            onClick={listDevices}
            disabled={listing}
          >
            {listing ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <RefreshCw size={15} />
            )}{" "}
            {devices ? "حدّث القائمة" : "اعرض الأجهزة"}
          </button>
        </div>
        {devices && (
          <select
            className="device-select"
            value={device}
            aria-label="جهاز الإخراج"
            onChange={(e) => set({ audioDevice: e.target.value || "auto" })}
          >
            <option value="">افتراضي النظام</option>
            {devices
              .filter((d) => d.id !== "auto")
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </select>
        )}
        {devices && devices.length === 0 && (
          <p className="subtle">
            ما قدر MPV يعرض الأجهزة. تأكد من مسار MPV في «خادم البث».
          </p>
        )}
      </section>
    </>
  );
}

const SAMPLE_CHIPS = ["4K", "HDR10", "HEVC", "E-AC3 5.1"];

/** Harbor's On-screen controls page, for Riwaq's HUD. */
export function OnScreenPage({ state, update }) {
  const s = state.settings;
  const set = (patch) => update("settings", patch);
  return (
    <>
      {s.playerOverlay === false && (
        <p className="settings-note">
          هذه الإعدادات لأدوات التحكم فوق الصورة، وهي مطفأة الآن من صفحة
          «المشغل».
        </p>
      )}
      <section className="settings-card">
        <h2>جودة البث في المشغل</h2>
        <Toggle
          on={s.hudQuality !== false}
          title="جودة البث تحت العنوان"
          text="الدقة وHDR والترميز والصوت كما يقرؤها MPV من الملف نفسه أثناء المشاهدة."
          onChange={(hudQuality) => set({ hudQuality })}
        />
        <Field title="نمط شارة الجودة">
          <Choices
            label="نمط شارة الجودة"
            value={s.hudQualityStyle || "chips"}
            options={[
              ["chips", "شرائح"],
              ["bar", "سطر"],
            ]}
            onPick={(hudQualityStyle) => set({ hudQualityStyle })}
          />
          <div className="hud-sample" dir="ltr" aria-hidden="true">
            <b>The Toll of the Sea</b>
            {s.hudQualityStyle === "bar" ? (
              <small>{SAMPLE_CHIPS.join(" · ")}</small>
            ) : (
              <span>
                {SAMPLE_CHIPS.map((chip) => (
                  <i key={chip}>{chip}</i>
                ))}
              </span>
            )}
          </div>
        </Field>
      </section>
      <section className="settings-card">
        <h2>عناصر التحكم بالتشغيل</h2>
        <Toggle
          on={s.hudShowOnPause !== false}
          title="إظهار عناصر التحكم عند الإيقاف المؤقت"
          text="أطفئه لتبقى الصورة نظيفة عند الإيقاف أو الاستئناف من لوحة المفاتيح؛ تحريك المؤشر يظهرها دائماً."
          onChange={(hudShowOnPause) => set({ hudShowOnPause })}
        />
        <Toggle
          on={s.hudSleep !== false}
          title="مؤقت النوم في الشريط العلوي"
          text="يوقف المشاهدة بعد مدة تختارها، أو بعد هذه الحلقة أو حلقتين أو ثلاث فلا يبدأ التشغيل التلقائي غيرها."
          onChange={(hudSleep) => set({ hudSleep })}
        />
      </section>
      <section className="settings-card">
        <h2>ملء الشاشة</h2>
        <Toggle
          on={s.autoFullscreen !== false}
          title="ملء الشاشة عند التشغيل"
          text="تبدأ المشاهدة بملء الشاشة. Esc أو النقر المزدوج للخروج."
          onChange={(autoFullscreen) => set({ autoFullscreen })}
        />
        <Toggle
          on={s.keepFullscreen}
          title="البقاء في ملء الشاشة بعد إغلاق المشغل"
          text="تبقى نافذة رِواق بملء الشاشة لما تنتهي المشاهدة أو توقفها، لمن يتصفح من الكنبة."
          onChange={(keepFullscreen) => set({ keepFullscreen })}
        />
      </section>
      <section className="settings-card">
        <h2>نافذة مستوى الصوت</h2>
        <Toggle
          on={s.volumeOsd !== false}
          title="نافذة مستوى الصوت أثناء المشاهدة"
          text="تظهر لحظة تغيّر الصوت من لوحة المفاتيح أو العجلة وأدوات التحكم مخفية."
          onChange={(volumeOsd) => set({ volumeOsd })}
        />
        <Field title="موضع النافذة">
          <Choices
            label="موضع النافذة"
            value={s.volumeOsdPosition || "center"}
            options={[
              ["center", "وسط"],
              ["top", "أعلى"],
              ["top-left", "أعلى اليسار"],
              ["top-right", "أعلى اليمين"],
            ]}
            onPick={(volumeOsdPosition) => set({ volumeOsdPosition })}
          />
        </Field>
      </section>
    </>
  );
}

const SKIP_OPTIONS = [
  ["button", "زر تخطي"],
  ["auto", "تلقائي"],
  ["off", "بدون"],
];

/** Harbor's Intros page: what is skipped, how, and from where. */
export function SkipPage({ state, update, act }) {
  const s = state.settings;
  const set = (patch) => update("settings", patch);
  return (
    <>
      <section className="settings-card">
        <h2>تخطي المقدمات والشارات</h2>
        <p>
          يعتمد رِواق على فصول الملف نفسه أولاً. عند غيابها يُعرض الزر فقط ضمن
          النافذة التي تقع فيها المقدمة فعلياً، فلا يبتلع الزر جزءاً من الحلقة.
        </p>
        <Field title="المقدمة">
          <Choices
            label="المقدمة"
            value={s.skipIntro || "button"}
            options={SKIP_OPTIONS}
            onPick={(skipIntro) => set({ skipIntro })}
          />
        </Field>
        <Field title="ملخص الحلقات السابقة">
          <Choices
            label="ملخص الحلقات السابقة"
            value={s.skipRecap || "button"}
            options={SKIP_OPTIONS}
            onPick={(skipRecap) => set({ skipRecap })}
          />
        </Field>
        <Field
          title="شارة النهاية والإعلان"
          text="مع التخطي التلقائي والتشغيل التلقائي تبدأ الحلقة التالية مباشرة."
        >
          <Choices
            label="شارة النهاية"
            value={s.skipOutro || "off"}
            options={SKIP_OPTIONS}
            onPick={(skipOutro) => set({ skipOutro })}
          />
        </Field>
        <Field
          title="إخفاء زر التخطي بعد"
          text="يختفي الزر بعد ثوانٍ فلا يبقى فوق الصورة طوال المقدمة. اختصار التخطي يبقى يعمل."
        >
          <Choices
            label="إخفاء زر التخطي بعد"
            value={Number(s.skipHideAfter) || 0}
            options={[
              [0, "لا يختفي"],
              [5, "5 ث"],
              [10, "10 ث"],
              [15, "15 ث"],
              [30, "30 ثانية"],
            ]}
            onPick={(skipHideAfter) => set({ skipHideAfter })}
          />
        </Field>
      </section>
      <section className="settings-card">
        <h2>توقيتات من قواعد المجتمع</h2>
        <Toggle
          on={s.skipOnline}
          title="جلب توقيت المقدمة والملخص وشارة النهاية"
          text="للأفلام والمسلسلات بمعرّف IMDb يسأل رِواق TheIntroDB، ولحلقات الأنمي بمعرّف MyAnimeList أو Kitsu يسأل AniSkip. يُرسل رقم العمل والموسم والحلقة ومدة الملف فقط. فصول الملف تبقى أولاً. مطفأ افتراضياً."
          onChange={(skipOnline) => set({ skipOnline })}
        />
        <IntroDbKey state={state} update={update} act={act} />
      </section>
      {(s.skipExcept || []).length > 0 && (
        <section className="settings-card">
          <div className="setting-row">
            <div>
              <b>مسلسلات بلا تخطٍّ تلقائي</b>
              <p>
                يظهر فيها زر التخطي فقط:{" "}
                {arabicCount(s.skipExcept.length, SERIES)}. غيّرها من صفحة كل
                مسلسل.
              </p>
            </div>
            <button
              className="secondary small"
              onClick={() => set({ skipExcept: [] })}
            >
              أعد التخطي للكل
            </button>
          </div>
        </section>
      )}
    </>
  );
}

/**
 * TheIntroDB's optional key (Harbor's field on its Intros page). It is kept
 * in the encrypted provider store like the metadata keys, and only whether
 * one is saved comes back.
 */
function IntroDbKey({ state, update, act }) {
  const provider = (state.providers || []).find((p) => p.id === "theintrodb");
  const [key, setKey] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!provider) return null;
  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  const status =
    provider.status === "ok"
      ? "تم التحقق"
      : provider.status === "error"
        ? "رفضت الخدمة المفتاح"
        : provider.configured
          ? "محفوظ"
          : "اختياري";
  return (
    <form
      className="introdb-key"
      onSubmit={(e) => {
        e.preventDefault();
        if (!key.trim()) return;
        run(async () => {
          const r = await update("providerSave", {
            id: "theintrodb",
            key,
            enabled: true,
          });
          if (r) setKey("");
        });
      }}
    >
      <div className="introdb-head">
        <b>TheIntroDB · توقيت المقدمة وأسماء الطاقم</b>
        <small className={provider.configured ? "on" : ""}>
          <i /> {status}
        </small>
      </div>
      <div className="introdb-field">
        <input
          type={shown ? "text" : "password"}
          autoComplete="off"
          spellCheck="false"
          dir="ltr"
          aria-label="مفتاح TheIntroDB"
          placeholder={
            provider.configured
              ? "•••••••• محفوظ — أدخل مفتاحاً لاستبداله"
              : "API key (اختياري)"
          }
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <button
          type="button"
          className="icon-button"
          aria-label={shown ? "أخفِ المفتاح" : "أظهر المفتاح"}
          onClick={() => setShown((v) => !v)}
        >
          {shown ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      <p className="subtle">
        اختياري. يستجيب TheIntroDB بدون مفتاح، لكن المفتاح يرفع حد الطلبات
        ليستمر وصول التوقيتات أثناء المشاهدة المتواصلة. احصل على مفتاح من{" "}
        <button
          type="button"
          className="text-button"
          onClick={() => act("openService", { id: "theintrodb" })}
        >
          theintrodb.org <ExternalLink size={13} />
        </button>
      </p>
      <div className="provider-actions">
        <button disabled={busy || !key.trim()} className="primary small">
          حفظ
        </button>
        <button
          type="button"
          className="secondary small"
          disabled={busy || !provider.configured}
          onClick={() =>
            run(() => update("providerTest", { id: "theintrodb" }))
          }
        >
          {busy ? "جاري…" : "اختبار المفتاح"}
        </button>
        {provider.configured && (
          <button
            type="button"
            className="icon-button"
            aria-label="احذف مفتاح TheIntroDB"
            onClick={() =>
              update("providerSave", { id: "theintrodb", clear: true })
            }
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </form>
  );
}

/**
 * Harbor's Internet speed: a cap streams are ranked against, and a short
 * measurement to choose it. Lives on the sources page, since it changes
 * which source comes first.
 */
export function SpeedCard({ state, update, act }) {
  const s = state.settings;
  const [test, setTest] = useState(null);
  const cap = Number(s.bandwidthCap) || 0;
  const measure = async () => {
    setTest({ running: true });
    const result = await act("speedTest");
    setTest(result ? { ...result } : null);
  };
  return (
    <section className="settings-card speed-card">
      <h2>
        <Wifi size={17} /> سرعة الإنترنت
      </h2>
      <p>
        اختر السرعة التي يتحملها اتصالك. المصادر التي تحتاج أكثر تنزل في الترتيب
        مع سبب واضح، فلا يقترح رِواق ملفاً سيتوقف للتحميل.
      </p>
      <Choices
        label="سرعة الإنترنت"
        value={cap}
        options={BANDWIDTH_CAPS.map((v) => [
          v,
          v === 0 ? "بلا حد" : v >= 1000 ? "1 Gbps" : `${v} Mbps`,
        ])}
        onPick={(bandwidthCap) => update("settings", { bandwidthCap })}
      />
      <p className="speed-status">
        <i className={cap ? "on" : ""} />
        {cap
          ? `المصادر التي تحتاج أكثر من ${cap} ميغابت/ث تنزل في الترتيب.`
          : "بلا تصفية؛ كل المصادر بنفس المعاملة."}
      </p>
      <div className="setting-row">
        <div>
          <b>قِس هذا الاتصال</b>
          <p>
            تنزيل قصير من Cloudflare يقيس سرعتك الفعلية، فتختار حداً يطابق خطك.
            لا يُرسل شيء عنك.
          </p>
        </div>
        <button
          className="secondary small"
          onClick={measure}
          disabled={test?.running}
        >
          {test?.running ? <Loader2 size={15} className="spin" /> : null}
          {test?.running ? "يقيس…" : "شغّل اختبار السرعة"}
        </button>
      </div>
      {test?.mbps > 0 && (
        <div className="setting-row speed-result">
          <div>
            <b>سرعتك نحو {test.mbps} ميغابت/ث</b>
            <p>نقترح حد {test.suggest} Mbps ليبقى هامش للذروات.</p>
          </div>
          {test.suggest !== cap && (
            <button
              className="primary small"
              onClick={() => update("settings", { bandwidthCap: test.suggest })}
            >
              اعتمد {test.suggest} Mbps
            </button>
          )}
        </div>
      )}
    </section>
  );
}
