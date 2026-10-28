import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import OfflineLibrary from "../../src/components/OfflineLibrary.jsx";
import PlayerMenu from "../../src/components/PlayerMenu.jsx";
import { setLanguage } from "../../core/i18n.mjs";
import { resolveAppearance, themeVariables } from "../../core/appearance.mjs";
import "../../src/styles.css";
import "../../src/appearance.css";
import "../../src/identity.css";
import "../../src/ltr.css";
import "../../src/review083.css";
const lang = new URLSearchParams(location.search).get("lang") || "ar";
setLanguage(lang);
document.documentElement.lang = lang;
document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
const entries = [
  {
    id: "a".repeat(32),
    meta: {
      id: "film",
      type: "movie",
      name: "A long title · رحلة عبر الليالي والنجوم إلى المدينة البعيدة",
    },
    videoId: "film",
    status: "ready",
    bytes: 1234 * 1024 ** 2,
    total: 1234 * 1024 ** 2,
  },
  {
    id: "b".repeat(32),
    meta: { id: "series", type: "series", name: "The Night Journey" },
    videoId: "series:2:4",
    episode: { season: 2, episode: 4, title: "A New Beginning" },
    status: "downloading",
    bytes: 210 * 1024 ** 2,
    total: 740 * 1024 ** 2,
  },
  {
    id: "c".repeat(32),
    meta: { id: "paused", type: "movie", name: "A paused download" },
    videoId: "paused",
    status: "paused",
    bytes: 52 * 1024 ** 2,
    total: 510 * 1024 ** 2,
  },
  {
    id: "d".repeat(32),
    meta: { id: "error", type: "movie", name: "A source that needs retry" },
    videoId: "error",
    status: "error",
    bytes: 0,
    total: 0,
  },
];
let items = structuredClone(entries);
window.__calls = [];
window.__menu = {
  videoId: "film",
  profileId: "p",
  sessionId: 4,
  paused: false,
  torrent: true,
  torrentLink: true,
  download: true,
};
window.__request = async (method, args) => {
  window.__calls.push({ method, args });
  if (method === "offlineList") return { items };
  if (method === "offlineArtwork")
    return {
      image:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/F1sAAAAASUVORK5CYII=",
    };
  if (method === "offlineRemove") {
    if (window.__removeError) throw Error("Could not delete");
    items = items.filter((x) => x.id !== args.id);
    return { items };
  }
  if (method === "offlinePlay") return { cancelled: !!window.__cancelPlay };
  if (method === "offlineReveal") return { revealed: true };
  if (method === "offlinePause" || method === "offlineResume") {
    items = items.map((x) =>
      x.id === args.id
        ? { ...x, status: method === "offlinePause" ? "paused" : "downloading" }
        : x,
    );
    return { items };
  }
  if (method === "playbackMenu") return window.__menu;
  return true;
};
function Fixture() {
  const [, setTick] = useState(0);
  window.__tick = () => setTick((n) => n + 1);
  const [downloads, showDownloads] = useState(true),
    [menu, showMenu] = useState(false),
    [notice, setNotice] = useState("");
  window.__showMenu = showMenu;
  window.__showDownloads = showDownloads;
  return (
    <div
      className="app experience-riwaq identity-riwaq"
      style={{
        ...themeVariables(resolveAppearance({})),
        minHeight: "100vh",
        padding: 24,
      }}
    >
      <button id="open-downloads" onClick={() => showDownloads(true)}>
        Downloads
      </button>
      <button id="open-menu" onClick={() => showMenu(true)}>
        Menu
      </button>
      <p role="status">{notice}</p>
      {downloads && (
        <OfflineLibrary
          state={{ profiles: { active: "p" } }}
          onClose={() => showDownloads(false)}
          notice={setNotice}
          onLocalVideo={() => window.__calls.push({ method: "localVideo" })}
        />
      )}
      {menu && (
        <PlayerMenu
          request={(method, args) => window.__request(method, args)}
          at={{ x: 60, y: 60 }}
          onClose={() => showMenu(false)}
          onPause={() => window.__calls.push({ method: "pause" })}
          onPanel={() => window.__calls.push({ method: "panel" })}
          onStop={() => window.__calls.push({ method: "stop" })}
          onError={setNotice}
        />
      )}
    </div>
  );
}
createRoot(document.getElementById("root")).render(<Fixture />);
