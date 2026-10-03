import React, { useState, useEffect, useRef } from "react";
import {
  CloudDownload,
  RefreshCw,
  Plus,
  Upload,
  Download,
  Puzzle,
  ArrowUp,
  ArrowDown,
  Settings,
  X,
  LoaderCircle,
  Link2,
  Stethoscope,
} from "lucide-react";
import { typeName, clock, imgUrl, episodeList } from "../lib/helpers.js";
import { IconButton, Busy, Empty, Modal } from "./UI.jsx";
import { call } from "../lib/api.js";
import { arabicCount } from "../../core/arabic.mjs";
import { HEALTH_LABELS, healthSummary } from "../../core/addon-health.mjs";

const ADDONS_FORMS = {
  one: "إضافة واحدة",
  two: "إضافتين",
  few: "{n} إضافات",
  many: "{n} إضافة",
  other: "{n} إضافة",
};
export default function Addons({
  state,
  update,
  act,
  notice,
  setState,
  onAccount,
  onNuvio,
}) {
  const [url, setUrl] = useState(""),
    [busy, setBusy] = useState(false),
    [operation, setOperation] = useState("");
  // Addon health (core/addon-health.mjs): by key and name, from main.
  const [health, setHealth] = useState(null),
    [checking, setChecking] = useState(false),
    [confirmGone, setConfirmGone] = useState(false);
  const checkHealth = async () => {
    setChecking(true);
    setConfirmGone(false);
    try {
      setHealth(await call("addonsHealth"));
    } catch (e) {
      notice(e.message);
    } finally {
      setChecking(false);
    }
  };
  const byKey = new Map((health?.results || []).map((r) => [r.key, r]));
  const dupes = new Set((health?.duplicates || []).map((d) => d.key));
  const installed = new Set(state.addons.map((a) => a.key));
  const gone = (health?.results || []).filter(
    (r) => r.state === "gone" && installed.has(r.key),
  );
  const down = (health?.results || []).filter(
    (r) =>
      r.state === "down" &&
      installed.has(r.key) &&
      state.addons.find((a) => a.key === r.key)?.enabled,
  );
  const counts = healthSummary(health?.results || []);
  const sync = async () => {
    setOperation("sync");
    const r = await act("sync");
    if (r) {
      setState(r.state);
      notice(
        `تم استيراد ${r.imported} إضافة${r.skipped.length ? " · بعض الإضافات القديمة غير مدعومة" : ""}${r.libraryWarning ? " · تعذّر استيراد المكتبة" : ""}`,
      );
    }
    setOperation("");
  };
  return (
    <div className="page-body">
      <div className="page-heading">
        <div>
          <span className="eyebrow">العالم الذي تختاره</span>
          <h1>إضافاتك تصنع التجربة.</h1>
          <p>كتالوجات ومصادر وترجمات، مرتبطة بحسابك.</p>
        </div>
        <span className="count-badge">{state.addons.length} إضافات</span>
      </div>
      <div className="addon-sync">
        <div className="sync-art">
          <CloudDownload size={33} />
        </div>
        <div>
          <h2>
            {state.user ? "حساب ستريميو متصل" : "انقل إضافاتك من ستريميو"}
          </h2>
          <p>
            {state.lastSync
              ? `آخر استيراد: ${new Date(state.lastSync).toLocaleString("ar-SA", { calendar: "gregory" })}`
              : "نفس الإضافات، بنفس الإعدادات، في تجربة جديدة."}
          </p>
        </div>
        <button
          className="primary"
          disabled={!!operation}
          onClick={state.user ? sync : onAccount}
        >
          {operation === "sync" ? (
            <LoaderCircle className="spin" size={18} />
          ) : (
            <RefreshCw size={18} />
          )}{" "}
          {state.user ? "استيراد التغييرات" : "ربط حساب ستريميو"}
        </button>
      </div>
      <form
        className="addon-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!url.trim()) return;
          setBusy(true);
          const r = await update("install", { url });
          if (r) {
            setUrl("");
            notice("تمت إضافة المصدر بنجاح");
          }
          setBusy(false);
        }}
      >
        <div>
          <label htmlFor="addon-url">تثبيت إضافة بالرابط</label>
          <p>الصق رابط manifest.json أو stremio:// المهيأ من موقع الإضافة.</p>
        </div>
        <div className="input-action">
          <input
            id="addon-url"
            dir="ltr"
            placeholder="https://addon.example/manifest.json"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
          <button className="primary" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <Plus size={18} />
            )}
            تثبيت
          </button>
        </div>
      </form>
      <div className="section-heading">
        <h2>الإضافات المثبتة</h2>
        <div className="button-row">
          <button
            className="text-button"
            disabled={checking || !state.addons.length}
            onClick={checkHealth}
          >
            {checking ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Stethoscope size={16} />
            )}
            {checking ? "نفحص…" : "افحص الإضافات"}
          </button>
          <button
            className="text-button"
            disabled={!!operation}
            onClick={async () => {
              setOperation("import");
              const r = await act("importAddons");
              if (r) {
                setState(r.state);
                notice(`تم استيراد ${r.count} · تعذّر ${r.failed}`);
              }
              setOperation("");
            }}
          >
            <Upload size={16} />
            استيراد ملف
          </button>
          <button
            className="text-button"
            onClick={async () => {
              const r = await act("exportAddons");
              if (r)
                notice(
                  "تم حفظ الملف. احتفظ به بشكل خاص؛ قد تتضمن الروابط مفاتيح إعداد إضافاتك.",
                );
            }}
          >
            <Download size={16} />
            تصدير
          </button>
        </div>
      </div>
      {health && (
        <div className="addon-health-summary">
          <p className="addon-health-line">
            {/* Each part in its own isolate, so "Stremio Service" cannot
                reorder its neighbours. */}
            {[
              `${counts.ok + counts.slow} تعمل${counts.slow ? ` (منها ${counts.slow} بطيئة)` : ""}`,
              counts.gone && `${counts.gone} توقفت نهائياً`,
              counts.down && `${counts.down} لا تستجيب الآن`,
              counts["needs-server"] &&
                `${counts["needs-server"]} تحتاج Stremio Service`,
              dupes.size && `${dupes.size} مكررة`,
            ]
              .filter(Boolean)
              .map((part, i) => (
                <React.Fragment key={i}>
                  {i > 0 && " · "}
                  {i === 0 ? (
                    <b>
                      <bdi>{part}</bdi>
                    </b>
                  ) : (
                    <bdi>{part}</bdi>
                  )}
                </React.Fragment>
              ))}
          </p>
          <div className="button-row">
            {gone.length > 0 && (
              <button
                className={confirmGone ? "primary small" : "secondary small"}
                onClick={async () => {
                  if (!confirmGone) return setConfirmGone(true);
                  const r = await update("removeAddons", {
                    keys: gone.map((g) => g.key),
                  });
                  if (r)
                    notice(
                      `حذفنا ${arabicCount(gone.length, ADDONS_FORMS)} توقفت نهائياً`,
                    );
                  setConfirmGone(false);
                }}
              >
                <X size={15} />
                {confirmGone
                  ? "اضغط مرة ثانية للتأكيد"
                  : `احذف المتوقفة (${gone.length})`}
              </button>
            )}
            {down.length > 0 && (
              <button
                className="secondary small"
                onClick={async () => {
                  for (const d of down)
                    await update("updateAddon", {
                      key: d.key,
                      action: "toggle",
                    });
                  notice(
                    `عطّلنا ${arabicCount(down.length, ADDONS_FORMS)} لا تستجيب؛ فعّلها متى رجعت`,
                  );
                }}
              >
                عطّل اللي ما تستجيب ({down.length})
              </button>
            )}
          </div>
          <p className="subtle">
            «توقفت نهائياً» يعني رابط الإضافة لم يعد موجوداً (404). «لا تستجيب
            الآن» قد تكون مؤقتة. الإضافات المحلية تحتاج تشغيل Stremio Service.
          </p>
        </div>
      )}
      <div className="addon-list">
        {state.addons.map((a, i) => (
          <article
            className={`addon-card ${a.enabled ? "" : "disabled"}`}
            key={a.key}
          >
            <span className="addon-logo">
              {imgUrl(a.logo) ? (
                <img
                  src={imgUrl(a.logo)}
                  alt=""
                  onError={(e) => (e.currentTarget.style.display = "none")}
                />
              ) : (
                <Puzzle size={28} />
              )}
            </span>
            <div className="addon-info">
              <h3 dir="auto">
                {a.name} <small>{a.version}</small>
              </h3>
              <p dir="auto">{a.description || a.host}</p>
              <div className="tags">
                {a.resources.map((r) => (
                  <span key={r}>
                    {{
                      catalog: "كتالوج",
                      meta: "معلومات",
                      stream: "مصادر تشغيل",
                      subtitles: "ترجمة",
                      addon_catalog: "متجر",
                    }[r] || r}
                  </span>
                ))}
                <span className="host">{a.host}</span>
                {byKey.get(a.key) && (
                  <span
                    className={`addon-health health-${byKey.get(a.key).state}`}
                    title={`${byKey.get(a.key).status}${byKey.get(a.key).ms ? ` · ${byKey.get(a.key).ms} ms` : ""}`}
                  >
                    {HEALTH_LABELS[byKey.get(a.key).state]}
                  </span>
                )}
                {dupes.has(a.key) && (
                  <span className="addon-health health-dupe">مكررة</span>
                )}
              </div>
            </div>
            <div className="addon-actions">
              <button
                className={`toggle ${a.enabled ? "on" : ""}`}
                aria-label={`${a.enabled ? "تعطيل" : "تفعيل"} ${a.name}`}
                aria-pressed={a.enabled}
                onClick={() =>
                  update("updateAddon", { key: a.key, action: "toggle" })
                }
              >
                <span />
              </button>
              <div className="button-row">
                <IconButton
                  title="نقل لأعلى"
                  disabled={i === 0}
                  onClick={() =>
                    update("updateAddon", { key: a.key, action: "up" })
                  }
                >
                  <ArrowUp size={16} />
                </IconButton>
                <IconButton
                  title="نقل لأسفل"
                  disabled={i === state.addons.length - 1}
                  onClick={() =>
                    update("updateAddon", { key: a.key, action: "down" })
                  }
                >
                  <ArrowDown size={16} />
                </IconButton>
                {a.configurable && (
                  <IconButton
                    title="إعداد الإضافة في المتصفح"
                    onClick={() => act("configure", { key: a.key })}
                  >
                    <Settings size={16} />
                  </IconButton>
                )}
                <IconButton
                  title="حذف من رِواق"
                  onClick={() =>
                    update("updateAddon", { key: a.key, action: "remove" })
                  }
                >
                  <X size={16} />
                </IconButton>
              </div>
            </div>
          </article>
        ))}
      </div>
      <p className="subtle">
        الترتيب والتعطيل والحذف تخص رِواق. استخدم «استيراد التغييرات» بعد تعديل
        إضافاتك في ستريميو.
      </p>
      <div className="addon-sync nuvio-sync">
        <div className="sync-art">
          <Link2 size={30} />
        </div>
        <div>
          <h2>تستخدم نوفيو؟</h2>
          <p>انقل إضافاتك ومجموعاتك ومكتبتك ومستودعات أدواتك إلى رِواق.</p>
        </div>
        <button className="secondary" onClick={onNuvio}>
          <Link2 size={18} /> الربط مع نوفيو
        </button>
      </div>
      {state.nuvioPlugins?.length > 0 && (
        <section className="nuvio-plugins">
          <div className="section-heading">
            <h2>مستودعات أدوات نوفيو (Plugins)</h2>
          </div>
          <ul>
            {state.nuvioPlugins.map((p) => (
              <li key={p.key}>
                <span>
                  <b dir="auto">{p.name}</b>
                  <small>
                    <span dir="ltr">{p.host}</span> ·{" "}
                    {arabicCount(p.scrapers, {
                      zero: "بلا أدوات",
                      one: "أداة واحدة",
                      two: "أداتان",
                      few: "{n} أدوات",
                      many: "{n} أداة",
                      other: "{n} أداة",
                    })}
                  </small>
                </span>
                <IconButton
                  title="إزالة من القائمة"
                  onClick={() => update("removeNuvioPlugin", { key: p.key })}
                >
                  <X size={16} />
                </IconButton>
              </li>
            ))}
          </ul>
          <p className="subtle">
            هذه أدوات بحث مكتوبة بـ JavaScript من أطراف أخرى. رِواق يحفظ قائمتها
            فقط ولا يشغّل شيفرتها، لأن تشغيل شيفرة غريبة داخل التطبيق خطر على
            جهازك. مصادر التشغيل في رِواق تأتي من إضافات ستريميو.
          </p>
        </section>
      )}
    </div>
  );
}
