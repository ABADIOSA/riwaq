import React, { useEffect, useRef, useState } from "react";
import {
  ArrowUpLeft,
  Compass,
  Folders,
  Library,
  MoreHorizontal,
  Settings,
  Tv,
  Puzzle,
  Users,
  LogIn,
  Lock,
  Music2,
} from "lucide-react";

export default function RiwaqNav({
  view,
  navigate,
  appearance,
  profile,
  user,
  onProfiles,
  onAccount,
  isLocked,
  updateAvailable,
}) {
  const [more, setMore] = useState(false);
  const menu = useRef(null),
    trigger = useRef(null);
  const go = (id) => {
    setMore(false);
    navigate(id);
  };
  useEffect(() => {
    if (!more) return;
    const click = (event) => {
      if (!menu.current?.contains(event.target)) setMore(false);
    };
    const key = (event) => {
      if (event.key === "Escape") {
        setMore(false);
        trigger.current?.focus();
      }
    };
    window.addEventListener("pointerdown", click);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", click);
      window.removeEventListener("keydown", key);
    };
  }, [more]);
  return (
    <header className="riwaq-masthead">
      <button
        className="riwaq-wordmark"
        onClick={() => go("home")}
        aria-label="رِواق — جلسة اليوم"
      >
        {appearance.logoStyle === "image" ? (
          <img
            className="riwaq-custom-logo"
            src={appearance.logoImage}
            alt="رِواق"
          />
        ) : (
          <>
            {/* Logo style: the full mark and name, the mark or the name. */}
            {appearance.logoStyle !== "name" && (
              <span className="riwaq-monogram" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            )}
            {appearance.logoStyle !== "mark" && (
              <b>
                رِواق<span>مساحة للحكاية</span>
              </b>
            )}
          </>
        )}
      </button>
      <nav className="riwaq-destinations" aria-label="التنقل الرئيسي">
        {[
          [ArrowUpLeft, "home", "جلسة اليوم"],
          [Compass, "discover", "اكتشف"],
          [Library, "library", "مكتبتي"],
          [Folders, "collections", "مجموعاتي"],
        ]
          .filter(([, id]) => !appearance.navHidden.includes(id) || id === view)
          .map(([Icon, id, label]) => (
            <button
              key={id}
              className={`riwaq-destination ${view === id ? "selected" : ""}`}
              aria-current={view === id ? "page" : undefined}
              onClick={() => go(id)}
            >
              <Icon size={17} />
              <span>{label}</span>
              {isLocked(id === "collections" ? "library" : id) && (
                <Lock size={12} />
              )}
            </button>
          ))}
      </nav>
      <div className="riwaq-utilities">
        <button
          className="riwaq-tool profile-button"
          onClick={onProfiles}
          title="تبديل الملف الشخصي"
        >
          <Users size={17} />
          <span>{profile?.name || "المشاهد"}</span>
        </button>
        <button
          className="riwaq-tool"
          onClick={() => go("settings")}
          title="الإعدادات"
          aria-label="الإعدادات"
        >
          <Settings size={19} />
          {updateAvailable && <i className="riwaq-update-dot" />}
        </button>
        <div className="riwaq-more" ref={menu}>
          <button
            ref={trigger}
            className={`riwaq-tool ${more ? "selected" : ""}`}
            onClick={() => setMore(!more)}
            aria-label="مساحات وأدوات أخرى"
            aria-expanded={more}
            aria-controls="riwaq-tools"
          >
            <MoreHorizontal size={22} />
          </button>
          {more && (
            <div className="riwaq-tools-panel" id="riwaq-tools">
              <p>بقية مساحتك</p>
              <div>
                {(!appearance.navHidden.includes("music") ||
                  view === "music") && (
                  <button onClick={() => go("music")}>
                    <Music2 />
                    <b>موسيقى</b>
                    <small>منصاتك وقوائمك</small>
                  </button>
                )}
                {(!appearance.navHidden.includes("live") ||
                  view === "live") && (
                  <button onClick={() => go("live")}>
                    <Tv />
                    <b>البث المباشر</b>
                    <small>قنواتك في مكان واحد</small>
                  </button>
                )}
                {(!appearance.navHidden.includes("addons") ||
                  view === "addons") && (
                  <button onClick={() => go("addons")}>
                    <Puzzle />
                    <b>الإضافات</b>
                    <small>مصادر المشاهدة</small>
                  </button>
                )}
                <button
                  onClick={() => {
                    setMore(false);
                    onAccount();
                  }}
                >
                  <LogIn />
                  <b>{user ? "حساب ستريميو" : "ربط ستريميو"}</b>
                  <small>
                    {user ? "إدارة الاتصال" : "استورد إضافاتك ومكتبتك"}
                  </small>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
