/**
 * The web edition's start: the same interface as the desktop (src/main.jsx)
 * after the bridge that stands in for Electron's main process is in place.
 * See docs/WEB.md.
 */
import "./globals.js";
import "./web.css";
import { deliverCallback, readCallback } from "./callback.js";
import { cleanLanguage, direction, translate } from "../core/i18n.mjs";

const VERSION = import.meta.env.RIWAQ_VERSION;

// Before the interface loads, its language is the one this device last
// used (src/lib/language.js keeps it).
function deviceLanguage() {
  try {
    return cleanLanguage(localStorage.getItem("riwaq.language"));
  } catch {
    return "ar";
  }
}

function message(text, { retry = false } = {}) {
  const lang = deviceLanguage();
  document.documentElement.lang = lang;
  document.documentElement.dir = direction(lang);
  const root = document.getElementById("root");
  root.innerHTML = "";
  const box = document.createElement("div");
  box.className = "web-boot";
  box.setAttribute("role", "alert");
  box.textContent = translate(text, lang);
  if (retry) {
    const button = document.createElement("button");
    button.className = "primary";
    button.textContent = translate("أعد المحاولة", lang);
    button.onclick = () => location.reload();
    box.append(document.createElement("br"), button);
  }
  root.append(box);
}

/**
 * One tab at a time owns the store, as the desktop allows one instance:
 * two tabs saving the same profile would overwrite each other.
 */
function claimTab() {
  if (!navigator.locks?.request) return Promise.resolve(true);
  return new Promise((resolve) => {
    navigator.locks
      .request("riwaq-web-owner", { ifAvailable: true }, (lock) => {
        resolve(!!lock);
        // Held for as long as this tab lives.
        return lock ? new Promise(() => {}) : undefined;
      })
      .catch(() => resolve(true));
  });
}

/**
 * The interface is laid out for 980×680 and larger, like the desktop
 * window. A narrower screen shows it zoomed out instead of broken.
 */
function fitViewport() {
  if (Math.min(screen.width, window.innerWidth) >= 980) return;
  document
    .querySelector('meta[name="viewport"]')
    ?.setAttribute("content", "width=1024");
}

async function boot() {
  fitViewport();
  if (!(await claimTab())) {
    message(
      "رِواق مفتوح في تبويب آخر في هذا المتصفح. استخدمه هناك، أو أغلقه ثم أعد المحاولة هنا.",
      { retry: true },
    );
    return;
  }
  let store;
  try {
    const { openStore } = await import("./store.js");
    store = await openStore();
  } catch (error) {
    message(error.message, { retry: true });
    return;
  }
  const { startBridge } = await import("./bridge.js");
  await startBridge({ version: VERSION, store });
  document.documentElement.classList.add("web-edition");
  // window.riwaq exists now; the interface reads it as it loads.
  await import("../src/main.jsx");
  const { mountWebPill } = await import("./pill.jsx");
  mountWebPill(VERSION);
}

const callback = readCallback(location.href);
if (callback) deliverCallback(callback);
else
  boot().catch(() =>
    message("تعذّر بدء رِواق في هذا المتصفح. حدّث المتصفح ثم أعد المحاولة.", {
      retry: true,
    }),
  );
