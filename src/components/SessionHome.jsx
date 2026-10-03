import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Clock3,
  LoaderCircle,
  Plus,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import {
  SESSION_MOODS,
  sessionSeeds,
  prepareSession,
  planSession,
} from "../../core/session.mjs";
import { call } from "../lib/api.js";
import { imgUrl } from "../lib/helpers.js";
import { arabicCount, MINUTES, WORKS } from "../../core/arabic.mjs";

// The unit after a bare number: "5 دقائق", "45 دقيقة".
const minuteUnit = (n) => (n >= 3 && n <= 10 ? "دقائق" : "دقيقة");

const endTime = (minutes, started) =>
  new Intl.DateTimeFormat("ar-SA", {
    hour: "numeric",
    minute: "2-digit",
    numberingSystem: "latn",
  }).format(new Date(started + minutes * 60000));
export default function SessionHome({ state, rows, onOpen, update, notice }) {
  const [budget, setBudget] = useState(state.settings.sessionBudget || 90);
  const [mood, setMood] = useState(state.settings.sessionMood || "any");
  const [result, setResult] = useState(null),
    [busy, setBusy] = useState(false);
  const [excluded, setExcluded] = useState([]),
    [adding, setAdding] = useState(false);
  const [started, setStarted] = useState(Date.now());
  const generation = useRef(0),
    alive = useRef(true);
  const seedPool = useMemo(
    () =>
      sessionSeeds(
        { favorites: state.favorites, progress: state.progress, rows },
        mood,
      ),
    [state.favorites, state.progress, rows, mood],
  );
  const peek = seedPool.filter((s) => imgUrl(s.meta.poster)).slice(0, 3);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, []);
  const change = (field, value) => {
    generation.current++;
    setBusy(false);
    setResult(null);
    setExcluded([]);
    if (field === "sessionBudget") setBudget(value);
    else setMood(value);
    update("settings", { [field]: value });
  };
  const build = async () => {
    const request = ++generation.current;
    setBusy(true);
    setResult(null);
    setExcluded([]);
    setStarted(Date.now());
    const next = await prepareSession(
      seedPool,
      (meta) => call("metadata", { type: meta.type, id: meta.id }),
      {
        progress: state.progress,
        current: () => alive.current && generation.current === request,
      },
    );
    if (alive.current && generation.current === request) {
      setResult(next);
      setBusy(false);
    }
  };
  const plan =
    result && planSession(result.candidates, { budget, mood, excluded });
  useEffect(() => {
    if (!result) return;
    setStarted(Date.now());
    const timer = setInterval(() => setStarted(Date.now()), 60000);
    return () => clearInterval(timer);
  }, [result]);
  const addPlan = async () => {
    setAdding(true);
    const owner = state.profiles?.active;
    let count = 0;
    for (const item of plan.items) {
      if (!alive.current) break;
      const saved = await update("queueEdit", {
        action: "add",
        meta: item.meta,
        videoId: item.videoId,
        label: "جلسة رِواق",
        profileId: owner,
      });
      if (!saved) break;
      count++;
    }
    if (alive.current) {
      setAdding(false);
      notice(
        count === plan.items.length
          ? "أضفنا جلستك إلى طابور المشاهدة"
          : "لم تكتمل إضافة الجلسة؛ راجع الطابور",
      );
    }
  };
  return (
    <section className="session-home" aria-label="جلسة رِواق">
      <div className="session-heading">
        <div>
          <span className="session-kicker">RIWAQ / YOUR TIME, YOUR STORY</span>
          <h1>وقتك له حكاية.</h1>
          <p>جلسة على مقاسك، من الأشياء التي تحبها.</p>
        </div>
        <span className="session-edition">
          <i />
          جلسة رِواق<span>اختيار أقل. مشاهدة أكثر.</span>
        </span>
      </div>
      <div className="session-workspace">
        <div className="session-builder">
          <div className="session-step">
            <span>01</span>
            <div>
              <h2>كم عندك من وقت؟</h2>
              <p>نحسب المتبقي من أعمالك، ونترك فسحة بين كل حكايتين.</p>
            </div>
            <Clock3 size={24} />
          </div>
          <div className="session-budgets" role="group" aria-label="مدة الجلسة">
            {[30, 60, 90, 120, 180].map((n) => (
              <button
                key={n}
                aria-pressed={budget === n}
                className={budget === n ? "chosen" : ""}
                onClick={() => change("sessionBudget", n)}
              >
                <b>{n}</b>
                <span>دقيقة</span>
              </button>
            ))}
          </div>
          <div className="session-step mood-step">
            <span>02</span>
            <div>
              <h2>على أي مزاج؟</h2>
            </div>
          </div>
          <div className="session-moods" role="group" aria-label="مزاج الجلسة">
            {SESSION_MOODS.map((m) => (
              <button
                key={m.id}
                aria-pressed={mood === m.id}
                className={mood === m.id ? "chosen" : ""}
                onClick={() => change("sessionMood", m.id)}
              >
                {mood === m.id && <Check size={14} />}
                {m.label}
              </button>
            ))}
          </div>
          <div className="session-build-row">
            <button
              className="session-build"
              disabled={busy || !seedPool.length}
              onClick={build}
            >
              {busy ? (
                <LoaderCircle className="session-spin" size={19} />
              ) : (
                <Sparkles size={19} />
              )}
              {busy ? "نبحث عن حكاية تناسب وقتك…" : "كوّن جلستي"}
              {!busy && <ArrowLeft size={18} />}
            </button>
            <span>
              بدون مفتاح ذكاء اصطناعي
              <br />
              من مكتبتك وفهارسك المحمّلة
            </span>
          </div>
        </div>
        <div className="session-preview">
          <div className="session-preview-top">
            <span>مساحتك الشخصية</span>
            <span>RIWAQ SELECTS ↙</span>
          </div>
          <div className="session-poster-stack" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className={`session-stack-${i}`}>
                {peek[i] && (
                  <img
                    src={imgUrl(peek[i].meta.poster)}
                    alt=""
                    onError={(e) => {
                      e.currentTarget.style.visibility = "hidden";
                    }}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="session-preview-caption">
            <span>أنت تختار الإيقاع.</span>
            <h2>ونرتّب الحكاية.</h2>
            <p>
              {seedPool.length
                ? "نكمل عملاً بدأته، أو نفتح باباً لاكتشاف جديد. وستعرف لماذا اخترنا كل عمل."
                : "احفظ بعض الأعمال أو انتظر تحميل فهارسك، ثم نرتّب لك أول جلسة."}
            </p>
          </div>
          <span className="session-preview-orbit" aria-hidden="true">
            ر
          </span>
        </div>
      </div>
      {busy && (
        <p className="session-status" role="status">
          نتحقق من مدد الأعمال من إضافاتك. يمكنك تغيير الوقت أو المزاج لإلغاء
          هذه المحاولة.
        </p>
      )}
      {plan && (
        <section className="session-result" aria-live="polite">
          <header>
            <div>
              <span className="session-kicker">YOUR SESSION / 03</span>
              <h2>
                {plan.items.length ? "هذه ليلتك." : "نحتاج مساحة أخرى للحكاية."}
              </h2>
            </div>
            {plan.items.length > 0 && (
              <div className="session-total">
                <b>{arabicCount(plan.minutes, MINUTES)} تقريباً</b>
                <span>
                  تنتهي قرابة {endTime(plan.minutes, started)} ·{" "}
                  {plan.remaining > 0
                    ? `فسحة ${arabicCount(plan.remaining, MINUTES)}`
                    : "بلا فسحة"}
                </span>
              </div>
            )}
          </header>
          {!plan.items.length ? (
            <p>
              لم نجد عملاً بمدة معروفة يناسب اختياراتك. جرّب وقتاً أطول أو
              «فاجئني»، أو حمّل مزيداً من الأعمال.
              {excluded.length > 0 && (
                <button className="text-button" onClick={() => setExcluded([])}>
                  استعادة الاختيارات المستبعدة
                </button>
              )}
            </p>
          ) : (
            <>
              <div className="session-timeline">
                {plan.items.map((item, i) => (
                  <React.Fragment key={item.key}>
                    {i > 0 && (
                      <div className="session-intermission">
                        <Clock3 size={13} /> استراحة · 5 دقائق
                      </div>
                    )}
                    <article className="session-pick">
                      <span className="session-pick-number">0{i + 1}</span>
                      <button
                        className="session-pick-art"
                        onClick={() => onOpen(item.meta, item.videoId)}
                        aria-label={`فتح ${item.meta.name}`}
                      >
                        {/* A title without a poster shows its initial. */}
                        {imgUrl(item.meta.poster) ? (
                          <img
                            src={imgUrl(item.meta.poster)}
                            alt=""
                            onError={(e) => {
                              e.currentTarget.style.visibility = "hidden";
                            }}
                          />
                        ) : (
                          <span
                            className="session-pick-initial"
                            aria-hidden="true"
                          >
                            {[...String(item.meta.name || "؟")][0]}
                          </span>
                        )}
                      </button>
                      <div className="session-pick-copy">
                        <span>
                          {item.origin === "continue"
                            ? "نكمل الحكاية"
                            : item.meta.type === "series"
                              ? "حلقة جديدة"
                              : "فيلم لجلستك"}
                          {item.episode && (
                            <>
                              {" "}
                              · <bdi>{item.episode}</bdi>
                            </>
                          )}
                        </span>
                        <button
                          onClick={() => onOpen(item.meta, item.videoId)}
                          dir="auto"
                        >
                          {item.meta.name}
                        </button>
                        <p>
                          {item.reason}
                          {mood !== "any" ? "، ونوعه يناسب مزاجك" : ""}.
                        </p>
                      </div>
                      <div className="session-pick-time">
                        <b>{item.minutes}</b>
                        <span>
                          {minuteUnit(item.minutes)}
                          {item.estimated
                            ? " تقديرية"
                            : item.origin === "continue"
                              ? " متبقية"
                              : ""}
                        </span>
                      </div>
                      <button
                        className="session-replace"
                        title={`اقتراح بديل عن ${item.meta.name}`}
                        onClick={() => setExcluded((old) => [...old, item.key])}
                      >
                        <RefreshCw size={17} />
                        <span>بديل</span>
                      </button>
                    </article>
                  </React.Fragment>
                ))}
              </div>
              <footer>
                <button
                  className="session-build"
                  onClick={() =>
                    onOpen(plan.items[0].meta, plan.items[0].videoId)
                  }
                >
                  ابدأ بالحكاية الأولى <ArrowLeft size={18} />
                </button>
                <button
                  className="secondary"
                  disabled={adding}
                  onClick={() =>
                    addPlan().catch(() => {
                      setAdding(false);
                      notice("تعذّر إضافة الجلسة إلى الطابور");
                    })
                  }
                >
                  <Plus size={17} />
                  {adding ? "نضيف الجلسة…" : "أضف الجلسة إلى الطابور"}
                </button>
                <small>
                  المدد تقريبية، وتشمل استراحة 5 دقائق بين الأعمال. اختر مصدر
                  المشاهدة عند البدء.
                </small>
              </footer>
            </>
          )}
          {result.skipped > 0 && (
            <p className="session-footnote">
              خارج الحساب: {arabicCount(result.skipped, WORKS)} بلا مدة معروفة
              أو حلقة مناسبة
              {result.failures ? "؛ تعذّر أيضاً جلب بعض البيانات" : ""}.
            </p>
          )}
        </section>
      )}
    </section>
  );
}
