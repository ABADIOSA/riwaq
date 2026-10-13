import React, { useEffect, useRef, useState } from "react";
import {
  Cpu,
  Download,
  LoaderCircle,
  MonitorDown,
  RefreshCw,
  Settings,
} from "lucide-react";
import { Modal } from "./UI.jsx";
import { call } from "../lib/api.js";

/**
 * Torrent sources need an engine (core/torrent-engine.mjs, issue #74). When
 * a torrent plays with neither Stremio Service answering nor the built-in
 * engine chosen, this guide offers both and plays the same source again as
 * soon as one is ready: the built-in engine at a click, or the viewer's own
 * Stremio Service, checked every few seconds while the guide is open.
 */
export default function TorrentSetup({ update, onRetry, onClose, onSettings }) {
  const [builtin, setBuiltin] = useState(null);
  const [service, setService] = useState("idle");
  const [busy, setBusy] = useState(false);
  const done = useRef(false);
  const retry = async () => {
    if (done.current) return;
    done.current = true;
    onClose();
    await onRetry();
  };
  useEffect(() => {
    call("torrentEngineStats")
      .then((stats) => setBuiltin(stats?.available !== false))
      .catch(() => setBuiltin(false));
  }, []);
  // Stremio Service is looked for while the guide is open, and the source
  // plays the moment it answers.
  useEffect(() => {
    let live = true;
    const check = async () => {
      const info = await call("streamServerInfo").catch(() => null);
      if (!live) return;
      if (info?.reachable) retry();
      else setService((s) => (s === "checking" ? "missing" : s));
    };
    const timer = setInterval(check, 3000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  const checkNow = async () => {
    setService("checking");
    const info = await call("streamServerInfo").catch(() => null);
    if (info?.reachable) retry();
    else setService("missing");
  };
  const useBuiltin = async () => {
    setBusy(true);
    const ok = await update("settings", { torrentEngine: "auto" });
    setBusy(false);
    if (ok) retry();
  };
  return (
    <Modal onClose={onClose} className="torrent-setup">
      <span className="eyebrow">مصادر التورنت</span>
      <h2>هذا المصدر تورنت ويحتاج محركاً</h2>
      <p>
        مصادر التورنت تتجمع من أجهزة مشاركين حول العالم. اختر طريقة، ونكمل
        التشغيل على نفس المصدر أول ما تجهز.
      </p>
      <div className="torrent-setup-options">
        <section className="torrent-setup-option">
          <h3>
            <Cpu size={18} /> المحرك المدمج في رِواق
          </h3>
          {builtin === false ? (
            <p className="subtle">
              يحتاج نسخة رِواق لسطح المكتب؛ المتصفح ما يقدر يتصل بالمشاركين.
            </p>
          ) : (
            <>
              <ul>
                <li>يشتغل من داخل رِواق، بدون تثبيت أي برنامج.</li>
                <li>
                  مثل أي برنامج تورنت: يشارك الأجزاء اللي نزلت مع غيرك أثناء
                  المشاهدة، فعنوان IP حقك يظهر للمشاركين.
                </li>
                <li>
                  تنحذف الأجزاء من جهازك لما تخلص المشاهدة، وتقدر تغيّر هذا من
                  الإعدادات.
                </li>
              </ul>
              <button
                className="primary"
                disabled={busy || builtin === null}
                onClick={useBuiltin}
              >
                {busy ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <Cpu size={16} />
                )}{" "}
                استخدم المحرك المدمج
              </button>
            </>
          )}
        </section>
        <section className="torrent-setup-option">
          <h3>
            <MonitorDown size={18} /> Stremio Service الرسمي
          </h3>
          <ol>
            <li>نزّل Stremio Service من صفحة إصداراته الرسمية وثبّته.</li>
            <li>شغّله؛ يظهر رمزه جنب الساعة في شريط المهام.</li>
            <li>نتحقق كل ثلاث ثوانٍ، ونكمل التشغيل أول ما يرد.</li>
          </ol>
          <div className="button-row">
            <button
              className="secondary"
              onClick={() => call("openServiceDownload").catch(() => {})}
            >
              <Download size={16} /> صفحة التنزيل الرسمية
            </button>
            <button className="secondary" onClick={checkNow}>
              {service === "checking" ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <RefreshCw size={16} />
              )}{" "}
              تحقق الآن
            </button>
          </div>
          {service === "missing" && (
            <p className="subtle" role="status">
              Stremio Service ما يرد للحين. إذا ثبّته وشغّلته وما زال ما يرد،
              تأكد من عنوانه في الإعدادات ← خادم البث.
            </p>
          )}
        </section>
      </div>
      <div className="button-row torrent-setup-foot">
        <button className="text-button" onClick={onSettings}>
          <Settings size={16} /> إعدادات محرك P2P
        </button>
        <button className="text-button" onClick={onClose}>
          أختار مصدراً مباشراً
        </button>
      </div>
    </Modal>
  );
}
