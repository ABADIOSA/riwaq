import React, { useEffect, useRef, useState } from "react";
import { BellRing, Hourglass, MoonStar } from "lucide-react";
import {
  PRAYERS,
  PRAYER_CITIES,
  PRAYER_METHODS,
  clockAt,
  nextPrayer,
  prayerPlace,
  prayerTimes,
  prayersBetween,
} from "../../core/prayer.mjs";

const optionsOf = (s) => ({ method: s.prayerMethod, asr: s.prayerAsr });
const minutesLeft = (at, now) => Math.max(0, Math.ceil((at - now) / 60000));
const inWords = (minutes) =>
  minutes >= 60
    ? `${Math.floor(minutes / 60)} س ${minutes % 60 ? `${minutes % 60} د` : ""}`.trim()
    : `${minutes} د`;

/** The time now, refreshed every 30 seconds. */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * The next prayer in the top bar; it opens today's times. Everything is
 * computed here from the chosen city: no location service, no network.
 */
export function PrayerChip({ settings, onSettings }) {
  const now = useNow();
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => !box.current?.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  if (!settings.prayerOn) return null;
  const place = prayerPlace(settings);
  const next = nextPrayer(now, place, optionsOf(settings));
  if (!next) return null;
  const today = prayerTimes(now, { ...place, ...optionsOf(settings) });
  const left = minutesLeft(next.at, now);
  return (
    <div className="prayer-chip-box" ref={box}>
      <button
        className={`prayer-chip ${left <= 10 ? "soon" : ""}`}
        aria-expanded={open}
        title={`أوقات الصلاة في ${place.name}`}
        onClick={() => setOpen(!open)}
      >
        <MoonStar size={15} />
        <b>{next.name}</b>
        <span dir="ltr">{clockAt(next.at, place.tz)}</span>
        <small>بعد {inWords(left)}</small>
      </button>
      {open && (
        <div className="prayer-pop" role="dialog" aria-label="أوقات الصلاة">
          <div className="prayer-pop-head">
            <b>{place.name}</b>
            <small>{PRAYER_METHODS[settings.prayerMethod]?.name}</small>
          </div>
          <ul>
            {PRAYERS.map(([key, name]) =>
              today[key] ? (
                <li
                  key={key}
                  className={`${key === next.key ? "next" : ""} ${today[key] < now ? "past" : ""} ${key === "sunrise" ? "sunrise" : ""}`}
                >
                  <span>{name}</span>
                  <b dir="ltr">{clockAt(today[key], place.tz)}</b>
                </li>
              ) : null,
            )}
          </ul>
          <button
            className="text-button"
            onClick={() => {
              setOpen(false);
              onSettings?.("prayer");
            }}
          >
            إعدادات أوقات الصلاة
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * On a title page: when the viewing would end if started now, and the
 * prayers that fall inside it.
 */
export function EndsAt({ minutes, settings }) {
  const now = useNow();
  if (!minutes || minutes < 1) return null;
  const end = new Date(now.getTime() + minutes * 60000);
  const place = prayerPlace(settings);
  const tz = settings.prayerOn ? place.tz : -now.getTimezoneOffset() / 60;
  const crossing =
    settings.prayerOn && settings.prayerWarn !== false
      ? prayersBetween(now, end, place, optionsOf(settings))
      : [];
  return (
    <p className={`ends-at ${crossing.length ? "crosses" : ""}`}>
      <Hourglass size={15} />
      <span>
        لو بدأت الحين يخلص <b dir="ltr">{clockAt(end, tz)}</b>
        {crossing.length > 0 && (
          <>
            {" · "}
            <BellRing size={14} /> يمر فيه أذان{" "}
            {crossing
              .map((p) => `${p.name} (${clockAt(p.at, place.tz)})`)
              .join(" و")}
          </>
        )}
      </span>
    </p>
  );
}

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

/** Settings → Watching → Prayer times. */
export function PrayerPage({ state, update }) {
  const s = state.settings;
  const now = useNow();
  const [custom, setCustom] = useState(
    s.prayerCustom || { lat: "", lng: "", tz: 3 },
  );
  const place = prayerPlace(s);
  const today = prayerTimes(now, { ...place, ...optionsOf(s) });
  const save = (patch) => update("settings", patch);
  return (
    <>
      <section className="settings-card">
        <h2>أوقات الصلاة</h2>
        <p>
          يحسب رِواق المواقيت على جهازك من موقع الشمس، بلا إنترنت ولا تحديد
          موقع. يظهر الأذان القادم في الشريط العلوي، وتعرف في صفحة كل عمل إن كان
          يمر فيه أذان، ويمكنه أن ينبّهك أو يوقف المشاهدة عند الأذان.
        </p>
        <Toggle
          on={s.prayerOn}
          title="إظهار أوقات الصلاة"
          text="الأذان القادم في الشريط العلوي، والمواقيت عند الضغط عليه."
          onChange={(prayerOn) => save({ prayerOn })}
        />
        {s.prayerOn && (
          <ul className="prayer-today">
            {PRAYERS.map(([key, name]) =>
              today[key] ? (
                <li key={key}>
                  <span>{name}</span>
                  <b dir="ltr">{clockAt(today[key], place.tz)}</b>
                </li>
              ) : null,
            )}
          </ul>
        )}
      </section>
      {s.prayerOn && (
        <>
          <section className="settings-card">
            <h2>المدينة وطريقة الحساب</h2>
            <label className="studio-field">
              المدينة
              <select
                aria-label="المدينة"
                value={s.prayerCity}
                onChange={(e) =>
                  e.target.value === "custom"
                    ? custom.lat !== "" &&
                      save({ prayerCity: "custom", prayerCustom: custom })
                    : save({ prayerCity: e.target.value })
                }
              >
                {PRAYER_CITIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                <option value="custom" disabled={custom.lat === ""}>
                  إحداثيات أكتبها بنفسي
                </option>
              </select>
            </label>
            <form
              className="prayer-custom"
              onSubmit={(e) => {
                e.preventDefault();
                save({ prayerCity: "custom", prayerCustom: custom });
              }}
            >
              <label>
                خط العرض
                <input
                  dir="ltr"
                  inputMode="decimal"
                  value={custom.lat}
                  onChange={(e) =>
                    setCustom({ ...custom, lat: e.target.value })
                  }
                />
              </label>
              <label>
                خط الطول
                <input
                  dir="ltr"
                  inputMode="decimal"
                  value={custom.lng}
                  onChange={(e) =>
                    setCustom({ ...custom, lng: e.target.value })
                  }
                />
              </label>
              <label>
                فرق التوقيت (UTC+)
                <input
                  dir="ltr"
                  inputMode="decimal"
                  value={custom.tz}
                  onChange={(e) => setCustom({ ...custom, tz: e.target.value })}
                />
              </label>
              <button className="secondary">استخدم هذه الإحداثيات</button>
            </form>
            <label className="studio-field">
              طريقة الحساب
              <select
                aria-label="طريقة الحساب"
                value={s.prayerMethod}
                onChange={(e) => save({ prayerMethod: e.target.value })}
              >
                {Object.entries(PRAYER_METHODS).map(([id, m]) => (
                  <option key={id} value={id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="studio-field">
              العصر
              <select
                aria-label="حساب العصر"
                value={s.prayerAsr}
                onChange={(e) => save({ prayerAsr: e.target.value })}
              >
                <option value="standard">الجمهور (ظل الشيء مثله)</option>
                <option value="hanafi">الحنفي (ظل الشيء مثليه)</option>
              </select>
            </label>
            <p className="subtle">
              في أم القرى تكون العشاء بعد المغرب بتسعين دقيقة، وبمئة وعشرين في
              رمضان. المدن المعروضة لا تغيّر ساعتها صيفاً؛ لغيرها اكتب إحداثياتك
              وفرق توقيتك.
            </p>
          </section>
          <section className="settings-card">
            <h2>أثناء المشاهدة</h2>
            <Toggle
              on={s.prayerWarn !== false}
              title="نبّهني في صفحة العمل"
              text="يكتب رِواق متى ينتهي العمل لو بدأته الآن، وأي أذان يمر في أثنائه."
              onChange={(prayerWarn) => save({ prayerWarn })}
            />
            <Toggle
              on={s.prayerHeadsUp !== false}
              title="تنبيه قبل الأذان بخمس دقائق"
              text="رسالة صغيرة فوق المشهد، والمشاهدة مستمرة."
              onChange={(prayerHeadsUp) => save({ prayerHeadsUp })}
            />
            <Toggle
              on={s.prayerPause}
              title="أوقف المشاهدة عند الأذان"
              text="يتوقف المشغل مؤقتاً عند دخول الوقت، وتكمل من نفس اللحظة متى ما رجعت."
              onChange={(prayerPause) => save({ prayerPause })}
            />
          </section>
        </>
      )}
    </>
  );
}
