import React, { useEffect, useRef, useState } from "react";
import {
  Home,
  Compass,
  Folders,
  Library,
  Settings,
  Tv,
  Puzzle,
  Users,
  LogIn,
  Lock,
  Music2,
  Download,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  X,
} from "lucide-react";
import { lockScroll } from "../lib/scroll-lock.js";
import RiwaqWheel from "./RiwaqWheel.jsx";
import { language } from "../../core/i18n.mjs";
export default function RiwaqNav({
  view,
  folderFrom,
  navigate,
  appearance,
  profile,
  user,
  onProfiles,
  quiet = false,
  onAccount,
  isLocked,
  updateAvailable,
  search,
  actions,
  collapsed,
  onCollapse,
  onDownloads,
  // The wheel (the default navigation): open shows the names.
  wheelOpen = false,
  onWheelToggle,
}) {
  const [narrow, setNarrow] = useState(
    () => matchMedia("(max-width: 760px)").matches,
  );
  const [open, setOpen] = useState(false);
  const dialog = useRef(null),
    trigger = useRef(null);
  useEffect(() => {
    const media = matchMedia("(max-width: 760px)");
    const change = () => {
      setNarrow(media.matches);
      setOpen(false);
    };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (!(open && narrow)) return void dialog.current?.close();
    dialog.current?.showModal();
    // The page behind the drawer stays still (issue #135).
    return lockScroll();
  }, [open, narrow]);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const go = (id) => {
    close();
    navigate(id);
  };
  const action = (fn) => {
    close();
    fn();
  };
  const item = (Icon, id, label, fn = () => go(id)) => {
    const current = view === id || (view === "folder" && folderFrom === id);
    const gate = ["collections", "music"].includes(id) ? "library" : id;
    return (
      <button
        key={id}
        className={`riwaq-destination ${current ? "selected" : ""}`}
        aria-current={current ? "page" : undefined}
        aria-label={label}
        title={label}
        onClick={fn}
      >
        <Icon size={20} aria-hidden="true" />
        <span>{label}</span>
        {isLocked(gate) && (
          <Lock size={12} className="nav-lock" aria-hidden="true" />
        )}
      </button>
    );
  };
  const wheel = appearance.navStyle !== "rail";
  const sidebar = wheel ? wheelSidebar() : railSidebar();
  function wheelSidebar() {
    const open = narrow || wheelOpen;
    // The interface language is set during render (useInterfaceLanguage);
    // the document's dir follows in an effect, a frame later.
    const rtl = language() !== "en";
    const destinations = [
      [Home, "home", "الرئيسية"],
      [Compass, "discover", "اكتشف"],
      [Library, "library", "مكتبتي"],
      [Folders, "collections", "المجموعات"],
      [Download, "downloads", "التنزيلات"],
      [Puzzle, "addons", "الإضافات"],
      [Music2, "music", "موسيقى"],
      [Tv, "live", "بث مباشر"],
      [Settings, "settings", "الإعدادات"],
    ]
      .filter(
        ([, id]) =>
          !appearance.navHidden.includes(id) ||
          id === view ||
          ["downloads", "settings"].includes(id),
      )
      .map(([Icon, id, label]) => {
        const gate = ["collections", "music"].includes(id) ? "library" : id;
        return {
          id,
          label,
          Icon,
          current: view === id || (view === "folder" && folderFrom === id),
          locked: isLocked(gate),
          onClick:
            id === "downloads" ? () => action(onDownloads) : () => go(id),
        };
      });
    const now = destinations.find((d) => d.current);
    const toggleLabel = narrow
      ? "إغلاق التنقل"
      : open
        ? "تصغير العجلة"
        : "إظهار الأسماء";
    return (
      <aside
        className={`riwaq-sidebar riwaq-wheel ${open ? "is-open" : "is-compact"}`}
        aria-label="مساحات رِواق"
      >
        {!open && (
          <span className="wheel-now" aria-hidden="true">
            {now?.label || ""}
          </span>
        )}
        <RiwaqWheel
          items={destinations}
          open={open}
          rtl={rtl}
          navId={narrow ? "riwaq-drawer-nav" : "riwaq-sidebar-nav"}
        />
        <div className="riwaq-sidebar-bottom wheel-hub">
          {!quiet && (
            <>
              {item(Users, "profiles", profile?.name || "المشاهد", () =>
                action(onProfiles),
              )}
              {item(
                LogIn,
                "account",
                user ? "حساب ستريميو" : "ربط ستريميو",
                () => action(onAccount),
              )}
            </>
          )}
          <button
            className="riwaq-destination riwaq-collapse"
            aria-label={toggleLabel}
            title={toggleLabel}
            aria-expanded={narrow ? true : open}
            aria-controls={narrow ? "riwaq-drawer-nav" : "riwaq-sidebar-nav"}
            onClick={narrow ? close : onWheelToggle}
          >
            {narrow ? (
              <X size={20} />
            ) : open ? (
              <PanelLeftClose size={20} />
            ) : (
              <PanelLeftOpen size={20} />
            )}
            <span>{toggleLabel}</span>
          </button>
          {updateAvailable && (
            <span className="riwaq-sidebar-update" role="status">
              يتوفر إصدار جديد
            </span>
          )}
        </div>
      </aside>
    );
  }
  function railSidebar() {
    return (
      <aside
        className={`riwaq-sidebar ${collapsed && !narrow ? "is-collapsed" : ""}`}
        aria-label="مساحات رِواق"
      >
        <nav
          className="riwaq-destinations"
          id={narrow ? "riwaq-drawer-nav" : "riwaq-sidebar-nav"}
          aria-label="التنقل الرئيسي"
        >
          {[
            [Home, "home", "الرئيسية"],
            [Compass, "discover", "اكتشف"],
            [Library, "library", "مكتبتي"],
            [Folders, "collections", "المجموعات"],
            [Download, "downloads", "التنزيلات"],
            [Puzzle, "addons", "الإضافات"],
          ]
            .filter(
              ([, id]) =>
                !appearance.navHidden.includes(id) ||
                id === view ||
                id === "downloads",
            )
            .map(([Icon, id, label]) =>
              item(
                Icon,
                id,
                label,
                id === "downloads" ? () => action(onDownloads) : undefined,
              ),
            )}
          <div className="riwaq-nav-extra">
            {[
              [Music2, "music", "موسيقى"],
              [Tv, "live", "بث مباشر"],
            ]
              .filter(
                ([, id]) => !appearance.navHidden.includes(id) || view === id,
              )
              .map(([Icon, id, label]) => item(Icon, id, label))}
          </div>
        </nav>
        <div className="riwaq-sidebar-bottom">
          {!quiet && (
            <>
              {item(Users, "profiles", profile?.name || "المشاهد", () =>
                action(onProfiles),
              )}
              {item(
                LogIn,
                "account",
                user ? "حساب ستريميو" : "ربط ستريميو",
                () => action(onAccount),
              )}
            </>
          )}
          <button
            className="riwaq-destination riwaq-collapse"
            aria-label={
              narrow
                ? "إغلاق التنقل"
                : collapsed
                  ? "توسيع القائمة"
                  : "طي القائمة"
            }
            title={
              narrow
                ? "إغلاق التنقل"
                : collapsed
                  ? "توسيع القائمة"
                  : "طي القائمة"
            }
            aria-expanded={narrow ? open : !collapsed}
            aria-controls={narrow ? "riwaq-drawer-nav" : "riwaq-sidebar-nav"}
            onClick={narrow ? close : onCollapse}
          >
            {narrow ? (
              <X size={20} />
            ) : collapsed ? (
              <PanelLeftOpen size={20} />
            ) : (
              <PanelLeftClose size={20} />
            )}
            <span>
              {narrow
                ? "إغلاق التنقل"
                : collapsed
                  ? "توسيع القائمة"
                  : "طي القائمة"}
            </span>
          </button>
          {item(Settings, "settings", "الإعدادات")}
          {updateAvailable && (
            <span className="riwaq-sidebar-update" role="status">
              يتوفر إصدار جديد
            </span>
          )}
        </div>
      </aside>
    );
  }
  return (
    <>
      <header className="riwaq-masthead">
        <button
          ref={trigger}
          className="riwaq-drawer-trigger"
          aria-label="فتح التنقل"
          title="فتح التنقل"
          aria-expanded={open}
          aria-controls="riwaq-mobile-nav"
          onClick={() => setOpen(true)}
        >
          <Menu size={22} />
        </button>
        <button
          className="riwaq-wordmark"
          onClick={() => go("home")}
          aria-label="رِواق — الرئيسية"
        >
          {appearance.logoStyle === "image" ? (
            <img
              className="riwaq-custom-logo"
              src={appearance.logoImage}
              alt="رِواق"
            />
          ) : (
            <>
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
        {search}
        <div className="riwaq-utilities">{actions}</div>
      </header>
      {narrow ? (
        <dialog
          ref={dialog}
          className="riwaq-nav-dialog"
          id="riwaq-mobile-nav"
          aria-label="التنقل الرئيسي"
          onCancel={close}
          onClose={close}
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          {sidebar}
        </dialog>
      ) : (
        sidebar
      )}
    </>
  );
}
