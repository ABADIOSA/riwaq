import React from "react";
import { LanguageCard } from "./settings/LanguageCard.jsx";
import { isWeb } from "../lib/api.js";
export default function QuickSettings({
  state,
  update,
  onAdvanced,
  onProfiles,
}) {
  const s = state.settings,
    save = (key, value) => update("settings", { [key]: value });
  return (
    <section className="quick-settings">
      <h2>الأساسيات أولًا</h2>
      <p>
        أهم اختيارات المشاهدة في مكان واحد. التفاصيل الإضافية متاحة عند الحاجة.
      </p>
      <LanguageCard state={state} update={update} />
      <section className="settings-card">
        <h3>اختيارات المشاهدة</h3>
        <label className="setting-row">
          <b>لغة الترجمة المفضلة</b>
          <select
            value={s.subtitleLanguage || "ara,ar,eng,en"}
            onChange={(e) => save("subtitleLanguage", e.target.value)}
          >
            <option value="ara,ar,eng,en">العربية أولًا</option>
            <option value="eng,en,ara,ar">الإنجليزية أولًا</option>
            {!["ara,ar,eng,en", "eng,en,ara,ar"].includes(
              s.subtitleLanguage,
            ) && (
              <option value={s.subtitleLanguage}>
                ترتيب مخصص من الإعدادات المتقدمة
              </option>
            )}
          </select>
        </label>
        <label className="setting-row">
          <b>جودة المصادر</b>
          <select
            value={s.quality}
            onChange={(e) => save("quality", e.target.value)}
          >
            <option value="2160">4K</option>
            <option value="1080">1080p</option>
            <option value="720">720p</option>
          </select>
        </label>
        {!isWeb && (
          <label className="setting-row">
            <b>طريقة تشغيل التورنت</b>
            <select
              value={s.torrentEngine}
              onChange={(e) => save("torrentEngine", e.target.value)}
            >
              <option value="ask">اختيار المحرك عند الحاجة</option>
              <option value="auto">تلقائي، مع محرك مدمج احتياطي</option>
              <option value="builtin">المحرك المدمج فقط</option>
            </select>
          </label>
        )}
        {isWeb ? (
          <p>
            نسخة الويب تستخدم Stremio Service للتورنت؛ المحرك المدمج متاح على
            ويندوز.
          </p>
        ) : (
          <p>
            المحرك المدمج لا يحتاج تثبيت Stremio. يعتمد توفر الفيديو وسرعته على
            المصدر والمشاركين.
          </p>
        )}
        <div className="setting-row">
          <div>
            <b>واجهة هادئة</b>
            <p>
              إخفاء دعوات الربط وزر الحساب والملفات من التنقل. يمكنك فتح ملفاتك
              من هنا.
            </p>
          </div>
          {/* The same switch as every other settings page. */}
          <button
            className={`toggle ${s.quietInterface ? "on" : ""}`}
            aria-label="واجهة هادئة"
            aria-pressed={!!s.quietInterface}
            onClick={() => save("quietInterface", !s.quietInterface)}
          >
            <span />
          </button>
        </div>
        <div className="button-row">
          <button className="secondary" onClick={onProfiles}>
            عرض الملفات الشخصية
          </button>
          <button className="secondary" onClick={() => onAdvanced("audio")}>
            إعدادات الصوت
          </button>
          <button className="secondary" onClick={() => onAdvanced("video")}>
            جودة الفيديو
          </button>
          <button className="secondary" onClick={() => onAdvanced("updates")}>
            التحديثات
          </button>
          <button className="secondary" onClick={() => onAdvanced("system")}>
            التشخيص
          </button>
        </div>
      </section>
    </section>
  );
}
