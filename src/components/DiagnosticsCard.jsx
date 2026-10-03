import React, { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Download,
  LoaderCircle,
  MinusCircle,
  Stethoscope,
  XCircle,
} from "lucide-react";
import { call } from "../lib/api.js";
import { recentErrors } from "../lib/diagnostics.js";
import { STATUS_LABEL, summarize } from "../../core/diagnose.mjs";

const ICONS = {
  ok: CheckCircle2,
  warn: AlertCircle,
  fail: XCircle,
  skip: MinusCircle,
};

/**
 * Settings → النظام: one button runs every check on this machine and shows
 * the result; the sanitized report can be copied or saved and sent.
 */
export default function DiagnosticsCard({ notice }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const run = async () => {
    setBusy(true);
    try {
      setResult(await call("diagnoseRun", { rendererErrors: recentErrors() }));
    } catch (e) {
      notice?.(e.message);
    } finally {
      setBusy(false);
    }
  };
  const summary = result ? summarize(result.report.checks) : null;
  return (
    <section className="settings-card diagnose-card">
      <div className="section-heading">
        <div>
          <h2>
            <Stethoscope size={18} /> تشخيص كامل
          </h2>
          <span>
            يفحص التشفير والتخزين وMPV وسطح الفيديو والشبكة والإضافات
            والتحديثات، ويجمع آخر الأخطاء.
          </span>
        </div>
        <button className="primary" disabled={busy} onClick={run}>
          {busy ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <Stethoscope size={16} />
          )}
          {busy
            ? "نفحص… قد يأخذ دقيقة"
            : result
              ? "أعد التشخيص"
              : "شغّل التشخيص"}
        </button>
      </div>
      {result && (
        <>
          <p className={`diagnose-summary is-${summary.status}`}>
            الحالة العامة: <b>{STATUS_LABEL[summary.status]}</b> ·{" "}
            {summary.counts.ok} سليم، {summary.counts.warn} تنبيه،{" "}
            {summary.counts.fail} مشكلة
          </p>
          <ul className="diagnose-checks">
            {result.report.checks.map((c) => {
              const Icon = ICONS[c.status] || MinusCircle;
              return (
                <li key={c.id} className={`is-${c.status}`}>
                  <Icon size={16} />
                  <b>{c.label}</b>
                  {c.detail && <span dir="auto">{c.detail}</span>}
                </li>
              );
            })}
          </ul>
          <div className="button-row">
            <button
              className="secondary"
              onClick={() =>
                call("diagnoseCopy")
                  .then(() => notice?.("نسخنا التقرير؛ الصقه وأرسله"))
                  .catch((e) => notice?.(e.message))
              }
            >
              <Copy size={15} /> انسخ التقرير
            </button>
            <button
              className="secondary"
              onClick={() =>
                call("diagnoseSave")
                  .then((saved) => saved && notice?.("حفظنا التقرير"))
                  .catch((e) => notice?.(e.message))
              }
            >
              <Download size={15} /> احفظه كملف
            </button>
          </div>
          <details className="diagnose-preview">
            <summary>اعرض نص التقرير</summary>
            {/* Each line takes its own direction, so Arabic and English
                lines both read in order. */}
            <div className="diagnose-text">
              {result.text.split("\n").map((line, i) => (
                <div key={i} dir="auto">
                  {line || "\u00a0"}
                </div>
              ))}
            </div>
          </details>
          <p className="subtle">
            التقرير لا يحتوي مفاتيح ولا روابط إضافات ولا كلمات مرور، واسم مستخدم
            ويندوز مخفي. يبقى على جهازك حتى تنسخه أو تحفظه بنفسك.
          </p>
        </>
      )}
    </section>
  );
}
