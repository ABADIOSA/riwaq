import React, { useState, useEffect, useRef } from "react";
import {
  Puzzle,
  ExternalLink,
  CheckCircle2,
  ShieldCheck,
  RefreshCw,
  LogOut,
  LoaderCircle,
} from "lucide-react";
import { typeName, clock, imgUrl, episodeList } from "../lib/helpers.js";
import { IconButton, Busy, Empty, Modal } from "./UI.jsx";
import { call } from "../lib/api.js";
export default function Account({
  state,
  onClose,
  act,
  update,
  setState,
  notice,
}) {
  const [waiting, setWaiting] = useState(false),
    [syncing, setSyncing] = useState(false);
  const sync = async () => {
    setSyncing(true);
    const r = await act("sync");
    if (r) {
      setState(r.state);
      notice(
        `تم استيراد ${r.imported} إضافة${r.skipped.length ? ` · غير مدعومة: ${r.skipped.join("، ")}` : ""}${r.libraryWarning ? " · تعذّر استيراد المكتبة" : ""}`,
      );
    }
    setSyncing(false);
  };
  return (
    <Modal onClose={onClose} className="account-modal">
      <div className="account-visual">
        <span className="brand-mark large">
          <span />
          <span />
          <span />
        </span>
        <div className="connection-line" />
        <Puzzle size={36} />
      </div>
      <span className="eyebrow">رِواق × STREMIO</span>
      <h1>{state.user ? "كل شيء يبدأ من حسابك." : "إضافاتك تنتقل معك."}</h1>
      <p className="muted">
        {state.user
          ? state.user.email
          : "سجّل الدخول في موقع ستريميو الرسمي، ثم ارجع هنا. نستورد روابط إضافاتك المهيأة ومكتبتك إلى رِواق."}
      </p>
      <div className="account-benefits">
        <p>
          <CheckCircle2 size={18} /> الاحتفاظ بإعدادات إضافاتك
        </p>
        <p>
          <CheckCircle2 size={18} /> استيراد المكتبة ومواضع المشاهدة
        </p>
        <p>
          <ShieldCheck size={18} /> حفظ الجلسة بتشفير ويندوز
        </p>
      </div>
      <p className="subtle">
        الاستيراد من ستريميو إلى رِواق. تعديلاتك هنا لا تغيّر حساب ستريميو.
      </p>
      {state.user ? (
        <div className="button-row">
          <button className="primary" onClick={sync} disabled={syncing}>
            <RefreshCw size={18} className={syncing ? "spin" : ""} />
            {syncing ? "جاري الاستيراد…" : "استيراد الآن"}
          </button>
          <button className="secondary" onClick={() => update("logout")}>
            <LogOut size={17} />
            خروج
          </button>
        </div>
      ) : (
        <>
          <button
            className="primary full"
            onClick={async () => {
              const r = await act("login");
              if (r) setWaiting(true);
            }}
            disabled={waiting}
          >
            {waiting ? (
              <LoaderCircle size={18} className="spin" />
            ) : (
              <ExternalLink size={18} />
            )}{" "}
            {waiting
              ? "بانتظار تسجيل الدخول في المتصفح…"
              : "تسجيل الدخول عبر ستريميو"}
          </button>
          {waiting && (
            <button
              className="text-button center"
              onClick={async () => {
                await act("cancelLogin");
                setWaiting(false);
              }}
            >
              إلغاء المحاولة
            </button>
          )}
        </>
      )}
    </Modal>
  );
}
