import React, { useState, useEffect } from "react";
import { Bell, RefreshCw, CheckCheck, Check } from "lucide-react";
import { Modal } from "./UI.jsx";
import { call } from "../lib/api.js";
import { language, locale as loc } from "../../core/i18n.mjs";
import { POLL_INTERVAL } from "../../core/announcements.mjs";

export default function NotificationCenter() {
  const [inbox, setInbox] = useState({ enabled: true, items: [], unread: 0 }),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = () =>
      call("announcementRefresh")
        .then((value) => {
          if (active) {
            setInbox(value);
            setError(value.error);
          }
        })
        .catch(() => {
          if (active) setError(true);
        });
    call("announcementState")
      .then((value) => {
        if (active) setInbox(value);
      })
      .catch(() => {});
    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const act = async (method, args) => {
    setBusy(true);
    setError(false);
    try {
      const value = await call(method, args);
      if (value) {
        setInbox(value);
        setError(value.error);
      }
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        className="icon-button notification-trigger"
        title="إشعارات رِواق"
        aria-label="إشعارات رِواق"
        onClick={() => setOpen(true)}
      >
        <Bell size={20} />
        {inbox.unread > 0 && (
          <span className="notification-count">{inbox.unread}</span>
        )}
      </button>
      {open && (
        <Modal className="notification-center" onClose={() => setOpen(false)}>
          <span className="eyebrow">من فريق رِواق</span>
          <h2>إشعارات رِواق</h2>
          <p>أخبار التطبيق وتنبيهات الفريق، دون مقاطعة مشاهدتك.</p>
          <div className="notification-toolbar">
            <button
              className="secondary"
              disabled={busy || !inbox.enabled}
              onClick={() => act("announcementRefresh")}
            >
              <RefreshCw size={16} /> تحديث الإشعارات
            </button>
            <button
              className="secondary"
              disabled={busy || !inbox.unread}
              onClick={() => act("announcementEdit", { action: "read" })}
            >
              <CheckCheck size={16} /> قراءة الكل
            </button>
          </div>
          <label className="notification-opt">
            <input
              type="checkbox"
              checked={inbox.enabled}
              disabled={busy}
              onChange={(e) =>
                act("announcementEdit", {
                  action: "enabled",
                  enabled: e.target.checked,
                })
              }
            />{" "}
            استقبال أخبار رِواق
          </label>
          {error && (
            <p role="alert">
              تعذر تحديث الإشعارات. الرسائل المحفوظة ما زالت متاحة.
            </p>
          )}
          {!inbox.enabled && <p>الاستقبال متوقف على هذا الجهاز.</p>}
          <div className="notification-list">
            {!inbox.items.length && <p>لا توجد إشعارات حاليًا.</p>}
            {inbox.items.map((item) => {
              const message =
                language() === "en" && item.en ? item.en : item.ar;
              return (
                <article
                  key={item.id}
                  className={item.read ? "read" : "unread"}
                >
                  <header>
                    <h3 dir="auto" translate="no">
                      {message.title}
                    </h3>
                    <time>{new Date(item.at).toLocaleDateString(loc())}</time>
                  </header>
                  <p dir="auto" translate="no">
                    {message.body}
                  </p>
                  <div className="notification-toolbar">
                    {item.link && (
                      <button
                        className="secondary"
                        onClick={() => act("announcementOpen", { id: item.id })}
                      >
                        عرض التفاصيل
                      </button>
                    )}
                    {!item.read && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          act("announcementEdit", {
                            action: "read",
                            id: item.id,
                          })
                        }
                      >
                        <Check size={16} /> تمت القراءة
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          {inbox.checked && (
            <small>
              آخر تحقق: {new Date(inbox.checked).toLocaleString(loc())}
            </small>
          )}
        </Modal>
      )}
    </>
  );
}
