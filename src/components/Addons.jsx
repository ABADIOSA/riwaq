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
} from "lucide-react";
import { typeName, clock, imgUrl, episodeList } from "../lib/helpers.js";
import { IconButton, Busy, Empty, Modal } from "./UI.jsx";
import { call } from "../lib/api.js";
import { arabicCount } from "../../core/arabic.mjs";
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
