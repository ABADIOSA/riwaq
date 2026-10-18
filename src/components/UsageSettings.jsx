import React, { useEffect, useState } from "react";
import { call } from "../lib/api.js";
export default function UsageSettings({ notice }) {
  const [enabled, setEnabled] = useState(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    call("usageState")
      .then((s) => {
        if (live) setEnabled(s.enabled);
      })
      .catch(() => {});
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
      <p>
        ساعدنا في معرفة عدد الأجهزة النشطة. نرسل معرّفاً عشوائياً لهذا الجهاز،
        إصدار التطبيق ونوعه فقط؛ لا نرسل اسمك أو حسابك أو سجل المشاهدة أو روابط
        المصادر. تبقى المشاركة معطلة حتى تختارها، ولا تنتقل الموافقة مع النسخ
        الاحتياطية أو حساب رِواق.
      </p>
      <p>
        يرسل التطبيق نبضة كل دقيقتين أثناء الاستخدام. تُحذف البيانات القديمة
        خلال 32 يوماً؛ إيقاف المشاركة يطلب حذف بيانات الجهاز، وإذا تعذر الاتصال
        تنتهي تلقائياً. قد يعالج مزوّد الاستضافة عنوان الشبكة لتقديم الخدمة
        والحماية.
      </p>
      <button
        className="secondary"
        role="switch"
        aria-checked={enabled === true}
        disabled={enabled === null || busy}
        onClick={change}
      >
        {enabled
          ? "إيقاف المشاركة وحذف بيانات الجهاز"
          : "المشاركة بإحصاءات الاستخدام"}
      </button>
    </section>
  );
}
