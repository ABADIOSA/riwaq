import React, { useEffect, useState } from "react";
import {
  Check,
  Crown,
  ExternalLink,
  LoaderCircle,
  LogOut,
  Send,
} from "lucide-react";
import { Modal } from "./UI.jsx";
import { call } from "../lib/api.js";

/**
 * Owner tools (electron/owner.mjs): on a device the owner chose, the public
 * app writes and publishes Riwaq's notices. A device joins with a GitHub
 * token GitHub confirms belongs to the owner; the token is never shown again
 * or sent back to this page. The draft stays on this device only.
 */
const DRAFT_KEY = "riwaq-owner-draft";
const EMPTY = {
  arTitle: "",
  arBody: "",
  enTitle: "",
  enBody: "",
  platform: "all",
  days: "14",
  minVersion: "",
  maxVersion: "",
  link: "",
};
const PLATFORMS = [
  ["all", "الجميع"],
  ["desktop", "تطبيق ويندوز"],
  ["web", "الموقع"],
];

function savedDraft() {
  try {
    return { ...EMPTY, ...JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}") };
  } catch {
    return EMPTY;
  }
}

export default function OwnerTools({ onClose, onChange }) {
  const [state, setState] = useState(null);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState("");
  const [remember, setRemember] = useState(true);
  const [draft, setDraft] = useState(savedDraft);
  const [preview, setPreview] = useState(null);
  const [done, setDone] = useState("");

  const apply = (next) => {
    setState(next);
    setProblem(next?.problem || "");
    onChange?.(next);
  };
  useEffect(() => {
    call("ownerOpen")
      .then(apply)
      .catch((e) => {
        setState({ owner: false, remembered: false });
        setProblem(e.message);
      });
  }, []);
  const run = async (work) => {
    setBusy(true);
    setProblem("");
    try {
      await work();
    } catch (e) {
      setProblem(e.message);
    } finally {
      setBusy(false);
    }
  };
  const activate = () =>
    run(async () => {
      const next = await call("ownerActivate", { token, remember });
      // The token leaves this page as soon as GitHub has answered.
      setToken("");
      apply(next);
    });
  const forget = () =>
    run(async () => {
      apply(await call("ownerForget"));
      setPreview(null);
    });
  const edit = (key) => (e) => {
    const next = { ...draft, [key]: e.target.value };
    setDraft(next);
    setPreview(null);
    setDone("");
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
    } catch {
      // A blocked store only loses the draft on close.
    }
  };
  const showPreview = () =>
    run(async () => {
      const days = Math.min(90, Math.max(1, Number(draft.days) || 14));
      const result = await call("ownerPreview", {
        draft: {
          ar: { title: draft.arTitle, body: draft.arBody },
          ...(draft.enTitle || draft.enBody
            ? { en: { title: draft.enTitle, body: draft.enBody } }
            : {}),
          platform: draft.platform,
          expires: Date.now() + days * 86400000,
          minVersion: draft.minVersion.trim(),
          maxVersion: draft.maxVersion.trim(),
          link: draft.link.trim(),
        },
      });
      setPreview(result);
    });
  const publish = () =>
    run(async () => {
      const result = await call("ownerPublish", { nonce: preview.nonce });
      setPreview(null);
      if (!result?.published) return;
      setDone("انتشر الإشعار. يوصل للمشاهدين عند فتح رِواق أو خلال ربع ساعة.");
      setDraft(EMPTY);
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {}
    });

  return (
    <Modal onClose={onClose} className="owner-tools">
      <span className="eyebrow">
        <Crown size={14} /> أدوات المالك
      </span>
      {!state ? (
        <p className="subtle">
          <LoaderCircle size={16} className="spin" /> نتحقق من هذا الجهاز…
        </p>
      ) : !state.owner ? (
        <>
          <h2>اجعل هذا الجهاز جهاز مالك</h2>
          <p>
            الجهاز يصير جهاز مالك لما تدخل فيه رمز GitHub لحسابك. رِواق يتأكد من
            GitHub إن الرمز لحساب مالك رِواق وله صلاحية الكتابة، وغير كذا يرفضه.
          </p>
          <ol className="owner-steps">
            <li>
              أنشئ رمزاً جديداً لهذا الجهاز بالذات، وسمّه باسمه (مثلاً «جهاز
              البيت»).
            </li>
            <li>
              اختر المستودع ABADIOSA/riwaq فقط، وصلاحية Contents للقراءة
              والكتابة، وحدد له تاريخ انتهاء.
            </li>
            <li>انسخ الرمز والصقه هنا.</li>
          </ol>
          <button
            className="secondary small"
            onClick={() => call("ownerTokenPage").catch(() => {})}
          >
            <ExternalLink size={15} /> صفحة إنشاء الرمز في GitHub
          </button>
          <label className="owner-field">
            <span>رمز GitHub</span>
            <input
              type="password"
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </label>
          <label className="owner-check">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            تذكّر هذا الجهاز كجهاز مالك (الرمز ينحفظ مشفّراً بتشفير ويندوز على
            هذا الجهاز بس)
          </label>
          <div className="button-row">
            <button
              className="primary"
              disabled={busy || token.trim().length < 30}
              onClick={activate}
            >
              {busy ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Check size={16} />
              )}{" "}
              تحقق وفعّل
            </button>
          </div>
          <p className="subtle">
            تقدر تشيل أي جهاز متى ما بغيت: احذف رمزه من GitHub، أو اضغط «إلغاء
            هذا الجهاز» منه.
          </p>
        </>
      ) : (
        <>
          <h2>هذا الجهاز جهاز مالك</h2>
          <p className="subtle">
            {state.remembered
              ? `متصل بحساب ${state.login} · محفوظ على هذا الجهاز`
              : `متصل بحساب ${state.login} · لهذه الجلسة فقط`}
          </p>
          <div className="owner-form">
            <label className="owner-field">
              <span>العنوان بالعربي</span>
              <input
                dir="rtl"
                value={draft.arTitle}
                onChange={edit("arTitle")}
                maxLength={160}
              />
            </label>
            <label className="owner-field">
              <span>النص بالعربي</span>
              <textarea
                dir="rtl"
                rows={4}
                value={draft.arBody}
                onChange={edit("arBody")}
                maxLength={3000}
              />
            </label>
            <label className="owner-field">
              <span>العنوان بالإنجليزي (اختياري)</span>
              <input
                dir="ltr"
                value={draft.enTitle}
                onChange={edit("enTitle")}
                maxLength={160}
              />
            </label>
            <label className="owner-field">
              <span>النص بالإنجليزي (اختياري)</span>
              <textarea
                dir="ltr"
                rows={3}
                value={draft.enBody}
                onChange={edit("enBody")}
                maxLength={3000}
              />
            </label>
            <div className="owner-row">
              <label className="owner-field">
                <span>الجمهور</span>
                <select value={draft.platform} onChange={edit("platform")}>
                  {PLATFORMS.map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="owner-field">
                <span>يبقى (أيام)</span>
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={draft.days}
                  onChange={edit("days")}
                />
              </label>
              <label className="owner-field">
                <span>من إصدار</span>
                <input
                  dir="ltr"
                  placeholder="0.44.0"
                  value={draft.minVersion}
                  onChange={edit("minVersion")}
                />
              </label>
              <label className="owner-field">
                <span>إلى إصدار</span>
                <input
                  dir="ltr"
                  placeholder="0.50.0"
                  value={draft.maxVersion}
                  onChange={edit("maxVersion")}
                />
              </label>
            </div>
            <label className="owner-field">
              <span>رابط داخل مستودع رِواق (اختياري)</span>
              <input
                dir="ltr"
                placeholder="https://github.com/ABADIOSA/riwaq/releases"
                value={draft.link}
                onChange={edit("link")}
              />
            </label>
          </div>
          {preview && (
            <section className="owner-preview" role="status">
              <span className="eyebrow">معاينة</span>
              <h3 dir="auto">{preview.item.ar.title}</h3>
              <p dir="auto">{preview.item.ar.body}</p>
              {preview.item.en && (
                <p dir="ltr" className="subtle">
                  {preview.item.en.title} — {preview.item.en.body}
                </p>
              )}
              <p className="subtle">
                {`بعد النشر يصير في ملف الإشعارات ${preview.count} إشعار.`}
              </p>
            </section>
          )}
          {done && (
            <p className="owner-done" role="status">
              {done}
            </p>
          )}
          <div className="button-row">
            {preview ? (
              <button className="primary" disabled={busy} onClick={publish}>
                {busy ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <Send size={16} />
                )}{" "}
                نشر الإشعار
              </button>
            ) : (
              <button
                className="primary"
                disabled={busy || !draft.arTitle.trim() || !draft.arBody.trim()}
                onClick={showPreview}
              >
                {busy ? <LoaderCircle size={16} className="spin" /> : null}{" "}
                معاينة قبل النشر
              </button>
            )}
            <button className="text-button" disabled={busy} onClick={forget}>
              <LogOut size={16} /> إلغاء هذا الجهاز
            </button>
          </div>
        </>
      )}
      {problem && (
        <p className="owner-problem" role="alert">
          {problem}
        </p>
      )}
    </Modal>
  );
}
