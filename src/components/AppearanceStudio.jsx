import React, { useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  Palette,
  RotateCcw,
  Undo2,
  Download,
  AlertCircle,
} from "lucide-react";
import {
  COLOR_KEYS,
  COLOR_LABELS,
  DEFAULT_APPEARANCE,
  FONTS,
  HIDEABLE_NAV,
  PRESETS,
  applyPreset,
  contrast,
  decodeTheme,
  encodeTheme,
  resolveAppearance,
} from "../../core/appearance.mjs";
import { call } from "../lib/api.js";

/**
 * The appearance studio: presets, the viewer's own palette, type and scale,
 * cards, pages and navigation, and a code to share a design. Every change is
 * live, because the whole app is the preview.
 */
export default function AppearanceStudio({ state, update, part = "" }) {
  // Each settings page shows one part of the studio; no part shows it all.
  const show = (name) => !part || part === name;
  const s = state.settings;
  const saved = resolveAppearance(s);
  const [draft, setDraft] = useState(saved);
  const [history, setHistory] = useState([]);
  const [imported, setImported] = useState("");
  const [importError, setImportError] = useState("");
  const [copied, setCopied] = useState(false);
  const timer = useRef();
  useEffect(() => setDraft(resolveAppearance(s)), [s.appearance, s.accent]);

  const commit = (next, { remember = true, delay = 0 } = {}) => {
    if (remember) setHistory((h) => [...h.slice(-19), draft]);
    setDraft(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(
      () => update("settings", { appearance: next }),
      delay,
    );
  };
  const change = (patch, options) => commit({ ...draft, ...patch }, options);
  const color = (key, value) =>
    commit(
      { ...draft, preset: "custom", colors: { ...draft.colors, [key]: value } },
      { delay: 180 },
    );
  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setHistory((h) => h.slice(0, -1));
    commit(previous, { remember: false });
  };
  const code = encodeTheme(draft);
  const readable = contrast(draft.colors.text, draft.colors.bg);
  const mutedReadable = contrast(draft.colors.muted, draft.colors.panel);
  const pick = (key, options, value, onPick) => (
    <div className="choice-row" role="radiogroup">
      {options.map(([id, label]) => (
        <button
          key={id}
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

  return (
    <>
      {show("theme") && (
        <section className="settings-card">
          <div className="section-heading">
            <div>
              <h2>استوديو المظهر</h2>
              <p>
                صمّم رِواق على ذوقك: ابدأ بثيم جاهز ثم غيّر ما تشاء. كل تغيير
                يظهر فوراً في التطبيق كله.
              </p>
            </div>
            <div className="button-row">
              <button
                className="secondary"
                disabled={!history.length}
                onClick={undo}
              >
                <Undo2 size={15} /> تراجع
              </button>
              <button
                className="secondary"
                onClick={() => commit({ ...DEFAULT_APPEARANCE })}
              >
                <RotateCcw size={15} /> الافتراضي
              </button>
            </div>
          </div>
          <div className="theme-gallery">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                className={`theme-tile ${draft.preset === p.id ? "selected" : ""}`}
                style={{ background: p.colors.bg }}
                onClick={() => commit(applyPreset(draft, p.id))}
              >
                <div
                  className="theme-miniature"
                  style={{ background: p.colors.bg }}
                >
                  <i style={{ background: p.colors.panel }} />
                  <div>
                    <span style={{ background: p.colors.raised }} />
                    <b
                      style={{
                        background: p.gradient
                          ? `linear-gradient(90deg, ${p.colors.accent}, ${p.colors.accentEnd})`
                          : p.colors.accent,
                      }}
                    />
                    <em style={{ background: p.colors.muted }} />
                    <div>
                      <i style={{ background: p.colors.raised }} />
                      <i style={{ background: p.colors.raised }} />
                      <i style={{ background: p.colors.raised }} />
                    </div>
                  </div>
                </div>
                <div style={{ color: p.colors.text }}>
                  <b>{p.name}</b>
                  <small style={{ color: p.colors.muted }}>{p.caption}</small>
                  {draft.preset === p.id && <Check size={16} />}
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {show("theme") && (
        <section className="settings-card">
          <h2>
            <Palette size={17} /> ألوانك
          </h2>
          <p>
            غيّر أي لون فيصبح التصميم «مخصصاً». لون التمييز يظهر في الأزرار
            والعناصر المختارة وشريط التقدم.
          </p>
          <div className="color-grid">
            {COLOR_KEYS.map((key) => (
              <label key={key} className="color-field">
                <input
                  type="color"
                  value={draft.colors[key].toLowerCase()}
                  onChange={(e) => color(key, e.target.value.toUpperCase())}
                />
                <span>
                  <b>{COLOR_LABELS[key]}</b>
                  <code dir="ltr">{draft.colors[key]}</code>
                </span>
              </label>
            ))}
          </div>
          {(readable < 4.5 || mutedReadable < 3) && (
            <p className="inline-warning">
              <AlertCircle size={15} /> تباين النص مع الخلفية منخفض، وقد تصعب
              القراءة. جرّب نصاً أفتح أو خلفية أغمق.
            </p>
          )}
          <label className="studio-field">
            تدرّج لون التمييز
            {pick(
              "gradient",
              [
                ["off", "بدون"],
                ["horizontal", "أفقي"],
                ["vertical", "عمودي"],
                ["diagonal", "مائل"],
              ],
              draft.gradient,
              (gradient) => change({ gradient }),
            )}
          </label>
          <div
            className="accent-sample"
            style={{
              background:
                draft.gradient === "off"
                  ? draft.colors.accent
                  : `linear-gradient(${{ horizontal: "90deg", vertical: "180deg", diagonal: "135deg" }[draft.gradient]}, ${draft.colors.accent}, ${draft.colors.accentEnd})`,
            }}
          >
            زر بلون التمييز
          </div>
        </section>
      )}

      {show("type") && (
        <section className="settings-card">
          <h2>الخط</h2>
          <label className="studio-field">
            خط التطبيق
            <select
              value={draft.font}
              onChange={(e) => change({ font: e.target.value })}
            >
              {FONTS.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {draft.font === "custom" && (
            <label className="studio-field">
              اسم الخط كما يظهر في ويندوز
              <input
                dir="auto"
                placeholder="مثال: Dubai"
                defaultValue={draft.customFont}
                onBlur={(e) => change({ customFont: e.target.value })}
              />
              <small>
                إن لم يكن الخط مثبتاً يعود رِواق إلى Segoe UI تلقائياً.
              </small>
            </label>
          )}
          <p
            className="type-sample"
            style={{
              fontFamily:
                draft.font === "custom"
                  ? draft.customFont || "Segoe UI"
                  : draft.font,
            }}
          >
            رِواق — مساحتك السينمائية · Riwaq 0123
          </p>
        </section>
      )}

      {show("interface") && (
        <section className="settings-card">
          <h2>الحجم والشكل</h2>
          <label className="studio-field">
            <span>
              حجم الواجهة <b>{draft.uiScale}%</b>
            </span>
            <input
              type="range"
              min="80"
              max="125"
              step="5"
              value={draft.uiScale}
              onChange={(e) =>
                change({ uiScale: Number(e.target.value) }, { delay: 250 })
              }
            />
            <small>
              التكبير لا يُطبَّق إلا إذا اتسعت النافذة له، حتى تبقى كل الصفحات
              مقروءة.
            </small>
          </label>
          <label className="studio-field">
            انحناء الزوايا
            {pick(
              "radius",
              [
                ["sharp", "حادة"],
                ["rounded", "مستديرة"],
                ["soft", "ناعمة"],
              ],
              draft.radius,
              (radius) => change({ radius }),
            )}
          </label>
          <label className="studio-field">
            كثافة العرض
            {pick(
              "density",
              [
                ["compact", "مضغوطة"],
                ["comfortable", "متوازنة"],
                ["spacious", "واسعة"],
              ],
              draft.density,
              (density) => change({ density }),
            )}
          </label>
        </section>
      )}

      {show("cards") && (
        <section className="settings-card">
          <h2>البطاقات</h2>
          <label className="studio-field">
            أسلوب البطاقة
            {pick(
              "cardStyle",
              [
                ["glass", "زجاجي"],
                ["flat", "بسيط"],
                ["outline", "بإطار"],
              ],
              s.cardStyle || "glass",
              (cardStyle) => update("settings", { cardStyle }),
            )}
          </label>
          <label className="studio-field">
            حجم البطاقة
            {pick(
              "cardSize",
              [
                ["compact", "صغير"],
                ["comfortable", "متوازن"],
                ["large", "كبير"],
              ],
              s.cardSize || "comfortable",
              (cardSize) => update("settings", { cardSize }),
            )}
          </label>
          <label className="studio-field">
            <span>
              انحناء البطاقة <b>{draft.posterRadius}</b>
            </span>
            <input
              type="range"
              min="0"
              max="28"
              value={draft.posterRadius}
              onChange={(e) =>
                change({ posterRadius: Number(e.target.value) }, { delay: 180 })
              }
            />
          </label>
          <label className="studio-field">
            عند المرور بالفأرة
            {pick(
              "posterHover",
              [
                ["off", "بلا تأثير"],
                ["lift", "ارتفاع"],
                ["glow", "توهّج"],
                ["shine", "لمعة"],
              ],
              draft.posterHover,
              (posterHover) => change({ posterHover }),
            )}
          </label>
          <label className="studio-toggle">
            <input
              type="checkbox"
              checked={draft.posterTitles}
              onChange={(e) => change({ posterTitles: e.target.checked })}
            />
            إظهار العنوان تحت البطاقة
          </label>
          <label className="studio-toggle">
            <input
              type="checkbox"
              checked={draft.posterWatched !== false}
              onChange={(e) => change({ posterWatched: e.target.checked })}
            />
            علامة «شاهدته» على الأفلام التي أكملتها
          </label>
          <label className="studio-toggle">
            <input
              type="checkbox"
              checked={s.showRatings !== false}
              onChange={(e) =>
                update("settings", { showRatings: e.target.checked })
              }
            />
            إظهار التقييمات على البطاقات
          </label>
        </section>
      )}

      {show("interface") && (
        <section className="settings-card">
          <h2>الصفحات والتنقل</h2>
          <div className="layout-choices">
            {[
              ["cinematic", "سينمائي", "عرض واسع وبداية غامرة"],
              ["sidebar", "كلاسيكي", "قائمة جانبية وبطاقة رئيسية"],
              ["topbar", "شريط علوي", "مساحة أكبر للحكايات"],
            ].map(([value, title, caption]) => (
              <button
                className={s.layout === value ? "selected" : ""}
                key={value}
                onClick={() => update("settings", { layout: value })}
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
          <label className="studio-field">
            العرض الرئيسي في الصفحة الرئيسية
            {pick(
              "hero",
              [
                ["full", "كامل"],
                ["compact", "مختصر"],
                ["off", "مخفي"],
              ],
              s.showHero === false ? "off" : draft.heroStyle,
              (id) => {
                if (id === "off") update("settings", { showHero: false });
                else {
                  if (s.showHero === false)
                    update("settings", { showHero: true });
                  change({ heroStyle: id });
                }
              },
            )}
          </label>

          <div className="studio-field">
            عناصر القائمة
            <div className="choice-row">
              {HIDEABLE_NAV.map(([id, label]) => {
                const shown = !draft.navHidden.includes(id);
                return (
                  <button
                    key={id}
                    className={shown ? "selected" : ""}
                    aria-pressed={shown}
                    onClick={() =>
                      change({
                        navHidden: shown
                          ? [...draft.navHidden, id]
                          : draft.navHidden.filter((n) => n !== id),
                      })
                    }
                  >
                    {shown && <Check size={13} />} {label}
                  </button>
                );
              })}
            </div>
            <small>الرئيسية والإعدادات تبقى دائماً.</small>
          </div>
        </section>
      )}

      {show("themes") && (
        <section className="settings-card">
          <h2>شارك تصميمك</h2>
          <p>
            انسخ رمز تصميمك وأرسله لأصدقائك، أو الصق رمزاً وصلك. الرمز يحمل
            المظهر فقط، ولا شيء من حساباتك أو مكتبتك.
          </p>
          <label className="studio-field">
            رمز تصميمك
            <textarea
              dir="ltr"
              readOnly
              rows={3}
              value={code}
              onFocus={(e) => e.target.select()}
            />
          </label>
          <button
            className="secondary"
            onClick={async () => {
              try {
                await call("copyThemeCode", { code });
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                setCopied(false);
              }
            }}
          >
            <Copy size={15} /> {copied ? "نُسخ" : "نسخ الرمز"}
          </button>
          <label className="studio-field">
            تطبيق رمز وصلك
            <textarea
              dir="ltr"
              rows={3}
              placeholder="RIWAQ-THEME-1:…"
              value={imported}
              onChange={(e) => {
                setImported(e.target.value);
                setImportError("");
              }}
            />
          </label>
          {importError && <p className="inline-warning">{importError}</p>}
          <button
            className="primary"
            disabled={!imported.trim()}
            onClick={() => {
              try {
                commit(decodeTheme(imported));
                setImported("");
              } catch (e) {
                setImportError(e.message);
              }
            }}
          >
            <Download size={15} /> تطبيق التصميم
          </button>
        </section>
      )}
    </>
  );
}
