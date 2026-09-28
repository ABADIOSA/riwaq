import React, { useState } from "react";
import {
  RefreshCw,
  Download,
  ShieldCheck,
  CheckCircle2,
  ArrowUpRight,
  X,
  RotateCw,
  Radio,
} from "lucide-react";

const labels = {
  idle: "رِواق يتجدد معك",
  checking: "نبحث عن الجديد…",
  current: "أنت على أحدث إصدار في قناتك",
  available: "تحديث جديد بانتظارك",
  downloading: "نجهز لك التحديث…",
  verifying: "نتحقق من سلامة التحديث…",
  ready: "تحديثك جاهز",
  installing: "جاري تثبيت التحديث…",
  error: "لم يكتمل التحديث",
  manual: "يتوفر إصدار على GitHub",
};
const bytes = (value) => `${(Number(value || 0) / 1024 ** 2).toFixed(1)} MB`;

export default function UpdatesCard({ state, update, act }) {
  const info = state.update || {};
  const [busy, setBusy] = useState(false);
  const status = info.status || "idle";
  const working =
    busy ||
    ["checking", "downloading", "verifying", "installing"].includes(status);
  const run = async (method, args) => {
    setBusy(true);
    try {
      await update(method, args);
    } finally {
      setBusy(false);
    }
  };
  const toggle = (key, title, description) => (
    <div className="setting-row" key={key}>
      <div>
        <b>{title}</b>
        <p>{description}</p>
      </div>
      <button
        className={`toggle ${info[key] !== false ? "on" : ""}`}
        aria-label={title}
        aria-pressed={info[key] !== false}
        disabled={busy || status === "installing"}
        onClick={() => run("updatesConfigure", { [key]: info[key] === false })}
      >
        <span />
      </button>
    </div>
  );
  return (
    <section
      className="settings-card updates-studio"
      aria-label="تحديثات رِواق"
    >
      <div className="update-hero">
        <span className="update-emblem">
          {status === "ready" ? (
            <CheckCircle2 size={32} />
          ) : (
            <RefreshCw
              size={32}
              className={status === "checking" ? "spin" : ""}
            />
          )}
        </span>
        <div>
          <span className="eyebrow">RIWAQ · ALWAYS EVOLVING</span>
          <h2 aria-live="polite">{labels[status]}</h2>
          <p>
            إصدارك <b dir="ltr">{info.current || "—"}</b>
            {info.latest && (
              <>
                {" "}
                · المتاح <b dir="ltr">{info.latest.version}</b>
              </>
            )}
          </p>
        </div>
        <button
          className="secondary"
          disabled={working || status === "ready"}
          onClick={() => run("updatesCheck")}
        >
          <RefreshCw size={16} /> تحقق الآن
        </button>
      </div>
      {!info.installed && (
        <p className="inline-warning">
          التحديث الداخلي متاح في النسخة المثبّتة. استخدم ملف Riwaq-Setup مرة
          واحدة، ثم ستصل التحديثات من هنا مع الاحتفاظ بمكتبتك وإعداداتك.
        </p>
      )}
      {info.error && (
        <p role="alert" className="inline-warning">
          {info.error}
        </p>
      )}
      {["downloading", "verifying", "ready"].includes(status) && (
        <div className="update-progress-area">
          <div className="update-progress-label">
            <b>
              {status === "verifying"
                ? "فحص الملف"
                : `${Math.floor(info.percent || 0)}%`}
            </b>
            <span dir="ltr">
              {bytes(info.transferred)} / {bytes(info.total)}
            </span>
          </div>
          <progress
            aria-label="تقدم تنزيل التحديث"
            max="100"
            value={info.percent || 0}
          />
        </div>
      )}
      <div className="update-actions">
        {info.canDownload && (
          <button
            className="primary"
            disabled={busy}
            onClick={() => run("updatesDownload")}
          >
            <Download size={17} /> تنزيل التحديث ·{" "}
            <span dir="ltr">{bytes(info.total)}</span>
          </button>
        )}
        {status === "downloading" && (
          <button className="secondary" onClick={() => act("updatesCancel")}>
            <X size={16} /> إلغاء التنزيل
          </button>
        )}
        {status === "ready" && (
          <>
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await act("updatesInstall");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <RotateCw size={17} /> تثبيت وإعادة التشغيل
            </button>
            <span className="subtle">
              {info.installOnExit !== false && info.enabled !== false
                ? "أو واصل المشاهدة؛ نثبّته عند إغلاق رِواق."
                : "يمكنك التثبيت في الوقت الذي يناسبك."}
            </span>
          </>
        )}
        {(info.available || !info.installed) && (
          <button className="text-button" onClick={() => act("openUpdate")}>
            <ArrowUpRight size={16} /> صفحة الإصدار
          </button>
        )}
      </div>
      {info.verified && (
        <p className="update-trust">
          <ShieldCheck size={16} /> توقيع التحديث موثّق، وتُفحص سلامة الملف قبل
          التثبيت.
        </p>
      )}
      {status === "manual" && (
        <p className="subtle">
          هذا الإصدار لا يتضمن حزمة موقعة للتحديث الداخلي. افتح صفحة الإصدار
          للاطلاع على تفاصيله.
        </p>
      )}
      {info.notes && (
        <details className="update-notes">
          <summary>ما الجديد في {info.packageVersion}؟</summary>
          <pre>{info.notes}</pre>
        </details>
      )}
      <div className="setting-row">
        <div>
          <b>
            <Radio size={15} /> قناة التحديثات
          </b>
          <p>
            المستقرة للإصدارات المستقرة، والتجريبية لتجربة الميزات الجديدة
            مبكراً.
          </p>
        </div>
        <select
          aria-label="قناة التحديثات"
          value={info.channel || "beta"}
          disabled={working}
          onChange={(e) => run("updatesConfigure", { channel: e.target.value })}
        >
          <option value="stable">المستقرة</option>
          <option value="beta">المستقرة والتجريبية</option>
        </select>
      </div>
      {toggle(
        "enabled",
        "التحقق تلقائياً",
        "عند تشغيل رِواق ثم كل أربع ساعات؛ يمكنك التحقق يدوياً في أي وقت.",
      )}
      {toggle(
        "autoDownload",
        "تنزيل التحديث في الخلفية",
        "ينزّل الحزمة الموقعة عند توفرها، مع استمرار المشاهدة. عطّله إذا أردت التنزيل يدوياً.",
      )}
      {toggle(
        "installOnExit",
        "التثبيت عند إغلاق رِواق",
        "يثبّت التحديث الجاهز بعد حفظ تقدمك، ولا يغلق التطبيق أثناء المشاهدة. يُؤجَّل عند إيقاف تشغيل ويندوز.",
      )}
      {info.checkedAt && (
        <p className="subtle">
          آخر تحقق:{" "}
          {new Date(info.checkedAt).toLocaleString(
            "ar-SA-u-ca-gregory-nu-latn",
          )}
        </p>
      )}
    </section>
  );
}
