import React, { useEffect, useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Server,
  Trash2,
} from "lucide-react";
import { CACHE_SIZES } from "../../../core/streaming-server.mjs";
import { SERVICE_LIMIT, cleanServices } from "../../../core/services.mjs";
import { HOME_SERVER_LIMIT } from "../../../core/home-servers.mjs";
import { arabicCount } from "../../../core/arabic.mjs";
import { call } from "../../lib/api.js";

const DEBRID_STATUS = {
  off: ["غير مربوط", ""],
  untested: ["محفوظ، لم يُفحص", ""],
  ok: ["الاشتراك فعّال", "ok"],
  soon: ["ينتهي قريباً", "warn"],
  expired: ["الاشتراك منتهٍ", "bad"],
  rejected: ["رفضت الخدمة المفتاح", "bad"],
  error: ["تعذّر الوصول للخدمة", "warn"],
};
const SERVER_STATUS = {
  untested: ["لم يُفحص", ""],
  ok: ["متصل", "ok"],
  rejected: ["انتهت الجلسة، أعد الربط", "bad"],
  error: ["تعذّر الوصول للخادم", "warn"],
};
const DAYS = {
  zero: "0 يوم",
  one: "يوم واحد",
  two: "يومان",
  few: "{n} أيام",
  many: "{n} يوماً",
  other: "{n} يوم",
};
const SERVICES = {
  zero: "لا خدمات",
  one: "خدمة واحدة",
  two: "خدمتين",
  few: "{n} خدمات",
  many: "{n} خدمة",
  other: "{n} خدمة",
};
const TITLES = {
  zero: "لا عناوين",
  one: "عنوان واحد",
  two: "عنوانان",
  few: "{n} عناوين",
  many: "{n} عنواناً",
  other: "{n} عنوان",
};
const date = (ms) =>
  ms
    ? new Date(ms).toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", {
        day: "numeric",
        month: "short",
      })
    : "";

function Status({ map, status }) {
  const [label, tone] = map[status] || map.untested || ["", ""];
  return <span className={`service-status ${tone}`}>{label}</span>;
}

function DebridRow({ service, update }) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    await update("debridCheck", { id: service.id });
    setBusy(false);
  };
  return (
    <div className="service-row">
      <div className="service-row-head">
        <b>{service.name}</b>
        <Status map={DEBRID_STATUS} status={service.status} />
        {service.days !== null && service.configured && (
          <small>
            {service.days
              ? `متبقٍّ ${arabicCount(service.days, DAYS)}`
              : "ينتهي اليوم"}
          </small>
        )}
        {service.account && service.configured && (
          <small dir="auto" className="subtle">
            {service.account}
          </small>
        )}
      </div>
      {service.configured ? (
        <div className="button-row">
          <button className="secondary small" disabled={busy} onClick={check}>
            {busy ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <RefreshCw size={15} />
            )}{" "}
            فحص الاشتراك
          </button>
          <button
            className="ghost small"
            onClick={() =>
              update("debridSave", { id: service.id, clear: true })
            }
          >
            <Trash2 size={15} /> إزالة المفتاح
          </button>
          {service.checkedAt && (
            <small className="subtle">آخر فحص {date(service.checkedAt)}</small>
          )}
        </div>
      ) : (
        <form
          className="input-action"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            const saved = await update("debridSave", {
              id: service.id,
              key: draft,
            });
            if (saved) {
              setDraft("");
              check();
            }
          }}
        >
          <input
            type="password"
            dir="ltr"
            autoComplete="off"
            aria-label={`${service.field} لـ ${service.name}`}
            placeholder={service.field}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button className="secondary">حفظ</button>
          <button
            type="button"
            className="ghost icon"
            title="صفحة المفتاح"
            aria-label={`صفحة مفتاح ${service.name}`}
            onClick={() => call("openService", { id: service.id })}
          >
            <ExternalLink size={15} />
          </button>
        </form>
      )}
    </div>
  );
}

/** Streaming services on the home page, and debrid accounts. */
export function ServicesPage({ state, update, onSettings }) {
  const s = state.settings;
  const chosen = cleanServices(s.streamingServices);
  const tmdbReady = state.providers?.find?.((p) => p.id === "tmdb")?.configured;
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!tmdbReady) return;
    let live = true;
    setError("");
    call("watchProviders")
      .then((l) => live && setList(l))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [tmdbReady, s.region]);
  const toggleService = (service) => {
    const on = chosen.some((c) => c.id === service.id);
    const next = on
      ? chosen.filter((c) => c.id !== service.id)
      : [...chosen, service].slice(0, SERVICE_LIMIT);
    const patch = { streamingServices: next };
    // The first service chosen brings its home section with it.
    const sections = s.homeSections || [];
    if (!on && !sections.includes("services")) {
      const at = sections.indexOf("catalogs");
      patch.homeSections =
        at < 0
          ? [...sections, "services"]
          : [...sections.slice(0, at), "services", ...sections.slice(at)];
    }
    update("settings", patch);
  };
  const shown = list
    ? [...list, ...chosen.filter((c) => !list.some((l) => l.id === c.id))]
    : chosen;
  return (
    <>
      <section className="settings-card">
        <h2>خدمات البث التي تشترك فيها</h2>
        <p>
          اختر المنصات التي تدفع لها، ويضيف رِواق للرئيسية صفاً لكل منها بأشهر
          ما يعرض عليها في منطقتك ({s.region || "SA"}). القوائم من TMDB بمفتاحك
          أنت، ولا يتصل رِواق بحسابك في أي منصة.
        </p>
        {!tmdbReady ? (
          <div className="folder-needs service-needs">
            <p>هذه القائمة تحتاج مفتاح TMDB مجانياً.</p>
            <button
              className="primary small"
              onClick={() => onSettings("data")}
            >
              أضف مفتاح TMDB
            </button>
          </div>
        ) : error ? (
          <p className="subtle">تعذّر جلب قائمة الخدمات: {error}</p>
        ) : !list ? (
          <p className="subtle">
            <Loader2 size={15} className="spin" /> نجلب خدمات منطقتك…
          </p>
        ) : null}
        {shown.length > 0 && (
          <div className="service-grid">
            {shown.map((service) => {
              const on = chosen.some((c) => c.id === service.id);
              return (
                <button
                  key={service.id}
                  className={`service-chip ${on ? "selected" : ""}`}
                  aria-pressed={on}
                  disabled={!on && chosen.length >= SERVICE_LIMIT}
                  onClick={() => toggleService(service)}
                >
                  {service.logo ? (
                    <img src={service.logo} alt="" />
                  ) : (
                    <span className="service-logo-blank" />
                  )}
                  <span>{service.name}</span>
                  {on && <CheckCircle2 size={15} />}
                </button>
              );
            })}
          </div>
        )}
        {chosen.length > 0 && (
          <p className="subtle">
            اخترت {arabicCount(chosen.length, SERVICES)} من {SERVICE_LIMIT}.
            رتّب مكان صفوفها من صفحة «الرئيسية».
          </p>
        )}
      </section>
      <section className="settings-card">
        <h2>خدمات Debrid</h2>
        <p>
          احفظ مفتاح حسابك ليعرف رِواق حالة اشتراكك وكم يوماً بقي عليه، فلا
          يفاجئك انتهاؤه وسط مشاهدة. المفتاح يحفظ مشفراً بتشفير ويندوز ولا يصل
          للواجهة، ولا يمرر رِواق التشغيل عبره: الإضافات التي تستخدم Debrid تبقى
          تستخدم إعداداتها.
        </p>
        <div className="service-rows">
          {(state.services?.debrid || []).map((service) => (
            <DebridRow key={service.id} service={service} update={update} />
          ))}
        </div>
      </section>
    </>
  );
}

/** The viewer's own Jellyfin and Emby servers. */
export function HomeServersPage({ state, update }) {
  const servers = state.services?.homeServers || [];
  const [form, setForm] = useState({ url: "", username: "", password: "" });
  const [busy, setBusy] = useState("");
  const add = async (e) => {
    e.preventDefault();
    setBusy("add");
    const result = await update("homeServerAdd", form);
    setBusy("");
    // The password is dropped from the form as soon as it has been sent.
    setForm(
      result
        ? { url: "", username: "", password: "" }
        : { ...form, password: "" },
    );
  };
  const check = async (id) => {
    setBusy(id);
    await update("homeServerCheck", { id });
    setBusy("");
  };
  return (
    <>
      <section className="settings-card">
        <h2>خوادمك المنزلية</h2>
        <p>
          اربط خادم Jellyfin أو Emby الخاص بك. حين تفتح فيلماً أو حلقة موجودة
          عندك، تظهر نسختك أعلى المصادر باسم «نسختك» وتعمل مباشرة من خادمك.
        </p>
        <p className="subtle">
          كلمة المرور ترسل مرة واحدة للخادم نفسه ولا تحفظ؛ يبقى رمز الجلسة الذي
          يصدره الخادم مشفراً في جهازك. المطابقة بمعرّف IMDb، فالعناوين التي لا
          يعرف خادمك معرّفها لن تظهر. Plex غير مدعوم بعد.
        </p>
        {servers.length === 0 && (
          <div className="empty-inline">
            <Server size={20} /> لم تربط خادماً بعد.
          </div>
        )}
        <div className="service-rows">
          {servers.map((server) => (
            <div key={server.id} className="service-row">
              <div className="service-row-head">
                <b>{server.name}</b>
                <small className="subtle">
                  {server.kind === "emby" ? "Emby" : "Jellyfin"} ·{" "}
                  <span dir="ltr">{server.host}</span>
                  {server.userName && ` · ${server.userName}`}
                </small>
                <Status map={SERVER_STATUS} status={server.status} />
                {server.status === "ok" && (
                  <small>{arabicCount(server.items, TITLES)}</small>
                )}
              </div>
              <div className="button-row">
                <button
                  className={`toggle ${server.enabled ? "on" : ""}`}
                  aria-label={`تفعيل ${server.name}`}
                  aria-pressed={server.enabled}
                  onClick={() =>
                    update("homeServerToggle", {
                      id: server.id,
                      enabled: !server.enabled,
                    })
                  }
                >
                  <span />
                </button>
                <button
                  className="secondary small"
                  disabled={busy === server.id}
                  onClick={() => check(server.id)}
                >
                  {busy === server.id ? (
                    <Loader2 size={15} className="spin" />
                  ) : (
                    <RefreshCw size={15} />
                  )}{" "}
                  فحص وتحديث الفهرس
                </button>
                <button
                  className="ghost small"
                  onClick={() => update("homeServerRemove", { id: server.id })}
                >
                  <Trash2 size={15} /> إزالة
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
      {servers.length < HOME_SERVER_LIMIT && (
        <section className="settings-card">
          <h2>ربط خادم</h2>
          <form className="home-server-form" onSubmit={add}>
            <label>
              عنوان الخادم
              <input
                dir="ltr"
                required
                placeholder="http://192.168.1.10:8096"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
              />
            </label>
            <label>
              اسم المستخدم
              <input
                dir="auto"
                required
                autoComplete="off"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </label>
            <label>
              كلمة المرور
              <input
                type="password"
                dir="ltr"
                autoComplete="off"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </label>
            <button className="primary" disabled={busy === "add"}>
              {busy === "add" ? (
                <Loader2 size={16} className="spin" />
              ) : (
                <Plus size={16} />
              )}{" "}
              ربط
            </button>
          </form>
        </section>
      )}
    </>
  );
}

const PROFILES = [
  ["gentle", "هادئ", "اتصالات قليلة وسرعة محدودة، يترك الشبكة لغيرك في البيت."],
  ["balanced", "متوازن", "الافتراضي المناسب لأغلب الاتصالات."],
  ["fast", "سريع", "اتصالات كثيرة وحد سرعة عالٍ لبدء أسرع على الشبكات القوية."],
];
const cacheLabel = (size) =>
  size === null
    ? "بلا حد"
    : size === 0
      ? "بلا تخزين"
      : `${Math.round(size / 1024 ** 3)} غيغابايت`;

function useServerInfo() {
  const [info, setInfo] = useState(null);
  const refresh = () => {
    setInfo(null);
    return call("streamServerInfo")
      .then(setInfo)
      .catch(() => setInfo({ reachable: false }));
  };
  useEffect(() => {
    refresh();
  }, []);
  return [info, setInfo, refresh];
}

/** The torrent engine of the streaming server: profile and cache. */
export function P2PPage({ notice }) {
  const [info, setInfo, refresh] = useServerInfo();
  const [busy, setBusy] = useState(false);
  const save = async (patch) => {
    setBusy(true);
    try {
      setInfo(await call("streamServerSave", patch));
      notice?.("حفظ خادم البث الإعداد");
    } catch (e) {
      notice?.(e.message);
    }
    setBusy(false);
  };
  return (
    <section className="settings-card">
      <h2>محرك P2P</h2>
      <p>
        يشغّل خادم البث (Stremio Service) مصادر التورنت. هذه الإعدادات تحفظ في
        الخادم نفسه، فتسري على كل تطبيق يستخدمه.
      </p>
      {!info ? (
        <p className="subtle">
          <Loader2 size={15} className="spin" /> نسأل خادم البث…
        </p>
      ) : !info.reachable ? (
        <div className="folder-needs">
          <p>خادم البث لا يرد. شغّله أو صحّح عنوانه من صفحة «خادم البث».</p>
          <button className="secondary small" onClick={refresh}>
            <RefreshCw size={15} /> إعادة المحاولة
          </button>
        </div>
      ) : !info.editable ? (
        <p className="subtle">هذا الخادم لا يتيح تعديل إعداداته.</p>
      ) : (
        <>
          <h3>أسلوب التنزيل</h3>
          <div className="frame-options p2p-options" role="radiogroup">
            {PROFILES.map(([id, title, text]) => (
              <button
                key={id}
                role="radio"
                aria-checked={info.profile === id}
                className={`p2p-option ${info.profile === id ? "selected" : ""}`}
                disabled={busy}
                onClick={() => save({ profile: id })}
              >
                <b>{title}</b>
                <p>{text}</p>
              </button>
            ))}
          </div>
          {info.profile === "custom" && (
            <p className="subtle">
              الخادم على إعداد مخصص لم يضعه رِواق؛ اختيار أسلوب يستبدله.
            </p>
          )}
          <h3>ذاكرة التخزين المؤقت</h3>
          <div className="choice-row" role="radiogroup">
            {CACHE_SIZES.map((size) => (
              <button
                key={String(size)}
                role="radio"
                aria-checked={info.cacheSize === size}
                className={info.cacheSize === size ? "selected" : ""}
                disabled={busy}
                onClick={() => save({ cacheSize: size })}
              >
                {cacheLabel(size)}
              </button>
            ))}
          </div>
          <p className="subtle">
            التخزين يسرّع إعادة المشاهدة والتقديم، ويشغل مساحة على قرصك.
          </p>
        </>
      )}
    </section>
  );
}

/** Where the streaming server is, and whether it answers. */
export function ServerPage({ state, update }) {
  const [url, setUrl] = useState(state.settings.serverUrl || "");
  const [info, , refresh] = useServerInfo();
  return (
    <section className="settings-card">
      <h2>خادم البث</h2>
      <p>
        خدمة Stremio المحلية مطلوبة لمصادر التورنت. الروابط المباشرة ونسخ خوادمك
        المنزلية تعمل بالمشغل المرفق دونها.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (await update("settings", { serverUrl: url })) refresh();
        }}
      >
        <label>عنوان Stremio Service</label>
        <div className="input-action">
          <input
            aria-label="عنوان Stremio Service"
            dir="ltr"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button className="secondary">حفظ</button>
        </div>
      </form>
      <div className="server-probe">
        {!info ? (
          <span>
            <Loader2 size={15} className="spin" /> نفحص الاتصال…
          </span>
        ) : info.reachable ? (
          <span className="service-status ok">
            متصل{info.version ? ` · الإصدار ${info.version}` : ""}
          </span>
        ) : (
          <span className="service-status bad">لا يرد</span>
        )}
        <button className="ghost small" onClick={refresh}>
          <RefreshCw size={15} /> فحص الاتصال
        </button>
      </div>
      <button className="secondary" onClick={() => update("choosePlayer")}>
        اختيار نسخة MPV مخصصة
      </button>
    </section>
  );
}
