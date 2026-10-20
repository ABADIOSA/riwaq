import React, { useEffect, useState } from "react";
import { call } from "../lib/api.js";
export default function UsageSettings({ notice, compact = false }) {
  const [enabled, setEnabled] = useState(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    call("usageState")
      .then((s) => {
        if (live) setEnabled(s.enabled);
      })
      .catch((e) => {
        if (live) notice(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  const change = async () => {
    setBusy(true);
    try {
      const s = await call("usageEdit", { enabled: !enabled });
      setEnabled(s.enabled);
    } catch (e) {
      notice(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="settings-card">
      <h2>إحصاءات الاستخدام الاختيارية</h2>
      {compact ? (
        <p>
          نرسل معرّفاً عشوائياً لهذا التثبيت، وإصدار التطبيق ونوعه فقط. لا اسم
          ولا حساب ولا سجل مشاهدة. الموافقة تخص هذا الجهاز وحده.
        </p>
      ) : (
        <p>
          ساعدنا في معرفة عدد الأجهزة النشطة. نرسل معرّفاً عشوائياً لهذا الجهاز،
          إصدار التطبيق ونوعه فقط؛ لا نرسل اسمك أو حسابك أو سجل المشاهدة أو
          روابط المصادر. تبقى المشاركة معطلة حتى تختارها، ولا تنتقل الموافقة مع
          النسخ الاحتياطية أو حساب رِواق.
        </p>
      )}
      {!compact && (
        <p>
          يرسل التطبيق نبضة كل دقيقتين أثناء الاستخدام. تُحذف البيانات القديمة
          خلال 32 يوماً؛ إيقاف المشاركة يطلب حذف بيانات الجهاز، وإذا تعذر
          الاتصال تنتهي تلقائياً. قد يعالج مزوّد الاستضافة عنوان الشبكة لتقديم
          الخدمة والحماية.
        </p>
      )}
      {compact && (
        <p className="first-run-consent-state" role="status">
          {enabled === null
            ? "جاري تحميل الاختيار…"
            : enabled
              ? "المشاركة مفعّلة باختيارك"
              : "المشاركة معطّلة"}
        </p>
      )}
      <button
        className="secondary"
        role="switch"
        aria-checked={enabled === true}
        disabled={enabled === null || busy}
        onClick={change}
      >
        {enabled === null
          ? "جاري تحميل الاختيار…"
          : enabled
            ? "إيقاف المشاركة وحذف بيانات الجهاز"
            : "المشاركة بإحصاءات الاستخدام"}
      </button>
      {compact && (
        <details className="first-run-more">
          <summary>التكرار والاحتفاظ والحذف</summary>
          <p>
            يرسل التطبيق نبضة كل دقيقتين أثناء الاستخدام. تُحذف البيانات القديمة
            خلال 32 يوماً؛ إيقاف المشاركة يطلب حذف بيانات الجهاز، وإذا تعذر
            الاتصال تنتهي تلقائياً. قد يعالج مزوّد الاستضافة عنوان الشبكة لتقديم
            الخدمة والحماية.
          </p>
          <p>
            يمكنك إيقاف المشاركة من الإعدادات الأساسية أو المظهر ← الواجهة. لا
            تنتقل الموافقة مع حساب رِواق أو النسخ الاحتياطية.
          </p>
        </details>
      )}
    </section>
  );
}
