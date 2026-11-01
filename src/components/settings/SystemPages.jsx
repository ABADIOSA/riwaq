import React, { useEffect, useState } from "react";
import {
  Download,
  ExternalLink,
  FolderOpen,
  HardDrive,
  Play,
  Trash2,
} from "lucide-react";
import UsageSettings from "../UsageSettings.jsx";
import { call } from "../../lib/api.js";
import { arabicCount } from "../../../core/arabic.mjs";
import { language } from "../../../core/i18n.mjs";
import {
  POLICY_DATE,
  POLICY_VERSION,
  privacyLink,
} from "../../../core/privacy.mjs";
import { size } from "./ServicePages.jsx";
import { loc } from "../../lib/format.js";

const DOWNLOADS = {
  zero: "لا تنزيلات",
  one: "تنزيل واحد",
  two: "تنزيلان",
  few: "{n} تنزيلات",
  other: "{n} تنزيلاً",
};

/**
 * Downloads & files (issue #127): what Riwaq keeps on this computer and
 * where to manage it. Every control here opens something that exists; the
 * storage place itself is fixed (CLAUDE.md, OfflineLibrary: private storage
 * owned per profile, so deleting a profile or a download never touches a
 * file Riwaq does not own).
 */
export function DownloadsPage({ state, act, onDownloads, onSettings }) {
  const profileId = state.profiles?.active;
  const [list, setList] = useState(null);
  useEffect(() => {
    let live = true;
    call("offlineList", { profileId })
      .then((value) => live && setList(value))
      .catch(() => live && setList({ items: [], failed: true }));
    return () => {
      live = false;
    };
  }, [profileId]);
  const items = list?.items || [];
  const ready = items.filter((x) => x.status === "ready");
  const waiting = items.filter((x) => x.status !== "ready");
  const used = ready.reduce((sum, x) => sum + (x.total || x.bytes || 0), 0);
  const cache = state.settings.torrentCache || "viewing";
  return (
    <>
      <section className="settings-card">
        <h2>التنزيل للمشاهدة دون إنترنت</h2>
        <p>
          تُحفظ التنزيلات في مساحة رِواق الخاصة على هذا الجهاز، لكل ملف شخصي
          وحده. لا تدخل النسخ الاحتياطية ولا حساب رِواق، وحذف الملف الشخصي يحذف
          تنزيلاته معه. تنزيل واحد في كل مرة، وإغلاق التطبيق يوقفه مؤقتاً حتى
          تستأنفه.
        </p>
        <div className="setting-row">
          <div>
            <b>على هذا الجهاز</b>
            <p role="status">
              {list === null
                ? "جاري القراءة…"
                : list.failed
                  ? "تعذرت قراءة التنزيلات الآن."
                  : ready.length
                    ? `${arabicCount(ready.length, DOWNLOADS)} · ${size(used)}`
                    : arabicCount(0, DOWNLOADS)}
              {waiting.length > 0 &&
                ` · ${waiting.length} قيد التنزيل أو متوقف مؤقتاً`}
            </p>
          </div>
          <button className="primary" onClick={onDownloads}>
            <Download size={16} /> افتح التنزيلات
          </button>
        </div>
        <ul className="settings-facts">
          <li>
            <Play size={15} /> تشغيل: يبدأ التنزيل المكتمل فوراً بلا إنترنت.
          </li>
          <li>
            <FolderOpen size={15} /> إظهار في المجلد: يفتح مستكشف الملفات على
            الملف ويحدده دون تشغيله.
          </li>
          <li>
            <Trash2 size={15} /> حذف: يزيل الملف وصورته ومساحته من جهازك.
          </li>
        </ul>
      </section>
      <section className="settings-card">
        <h2>أجزاء التورنت المؤقتة</h2>
        <p>
          {cache === "viewing"
            ? "يحذف المحرك المدمج أجزاء التورنت بعد انتهاء المشاهدة، ولا يحتفظ بها بين الجلسات."
            : `يحتفظ المحرك المدمج بأجزاء حتى ${cache} غيغابايت، ويحذف الأقدم أولاً.`}{" "}
          هذه الأجزاء منفصلة عن التنزيلات ولا تمسها.
        </p>
        <button className="secondary small" onClick={() => onSettings("p2p")}>
          <HardDrive size={15} /> إعدادات محرك P2P
        </button>
      </section>
      <section className="settings-card">
        <h2>لقطات الشاشة</h2>
        <p>
          تُحفظ اللقطات بصيغة PNG داخل مجلد بيانات رِواق، ويفتح الزر المجلد
          مباشرة.
        </p>
        <button
          className="secondary small"
          onClick={() => act("openScreenshots")}
        >
          <FolderOpen size={15} /> فتح مجلد اللقطات
        </button>
      </section>
    </>
  );
}

/**
 * Privacy (Settings → System): a summary that matches PRIVACY.md, the
 * links to the full policy, and the one switch that sends anything to
 * Riwaq's own service on its own (usage counts, off until chosen).
 */
export function PrivacyPage({ act, notice }) {
  // act() reports a failure as a notice itself.
  const open = (id) => act("openService", { id });
  return (
    <>
      <section className="settings-card privacy-card">
        <h2>خصوصيتك في رِواق</h2>
        <p>
          رِواق يعمل على جهازك. مكتبتك وتقدّمك وإعداداتك ومفاتيحك تبقى هنا
          مشفّرة، ولا يصل إلى رِواق شيء عنك إلا ما تختاره بنفسك.
        </p>
        <ul className="settings-facts">
          <li>
            حساب رِواق اختياري ومشفّر من طرف إلى طرف: يخزّن الخادم بياناتك
            مشفّرة ولا يستطيع قراءتها.
          </li>
          <li>
            الإضافات والخدمات التي تربطها (Trakt وSimkl وAniList وTMDB وغيرها)
            تتصل بها مباشرة، وتخضع لسياساتها.
          </li>
          <li>
            تصفّح الأعمال يطلب صورها وبياناتها من الإضافات وخدمات عامة مثل ويكي
            بيانات، وأغانيها من iTunes وDeezer، والتحديثات من GitHub. يمكنك
            إيقاف أغاني الأعمال والتحديثات التلقائية.
          </li>
          <li>
            مصادر التورنت تكشف عنوان شبكتك للمشاركين في السرب أثناء التشغيل.
          </li>
          <li>
            لا إعلانات ولا تتبع ولا تقارير أعطال تلقائية. تقرير التشخيص لا يغادر
            جهازك إلا إذا نسخته أو حفظته.
          </li>
        </ul>
        <div className="button-row">
          <button
            className="primary"
            onClick={() => open(privacyLink(language()))}
          >
            <ExternalLink size={16} /> اقرأ سياسة الخصوصية
          </button>
          <button
            className="secondary"
            onClick={() => open(privacyLink(language() === "en" ? "ar" : "en"))}
          >
            {language() === "en" ? (
              <span translate="no">النسخة العربية</span>
            ) : (
              <span translate="no">English version</span>
            )}
          </button>
        </div>
        <p className="subtle">
          {`إصدار السياسة ${POLICY_VERSION} · سارية من ${new Date(
            POLICY_DATE + "T12:00:00",
          ).toLocaleDateString(loc(), { dateStyle: "long" })}`}
        </p>
      </section>
      <UsageSettings notice={notice} />
    </>
  );
}
