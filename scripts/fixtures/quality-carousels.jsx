import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import HomeHero from "../../src/components/HomeHero.jsx";
import TasteDiscovery from "../../src/components/TasteDiscovery.jsx";
import { Rail, useScrollRow } from "../../src/components/UI.jsx";
import { setLanguage } from "../../core/i18n.mjs";
import { resolveAppearance, themeVariables } from "../../core/appearance.mjs";
import { PosterActionsContext } from "../../src/lib/poster-actions.js";
import "../../src/styles.css";
import "../../src/appearance.css";
import "../../src/identity.css";
import "../../src/hero.css";
import "../../src/taste.css";
import "../../src/studio.css";
import "../../src/ltr.css";

const listeners = new Map();
for (const method of ["addEventListener", "removeEventListener"]) {
  const native = window[method].bind(window);
  window[method] = (type, listener, ...rest) => {
    if (["pointermove", "pointerup", "pointercancel", "blur"].includes(type)) {
      const set = listeners.get(type) || new Set();
      set[method === "addEventListener" ? "add" : "delete"](listener);
      listeners.set(type, set);
    }
    return native(type, listener, ...rest);
  };
}
window.listenerCount = () =>
  [...listeners.values()].reduce((sum, set) => sum + set.size, 0);

const lang = new URLSearchParams(location.search).get("lang") || "ar";
setLanguage(lang);
document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
const metas = Array.from({ length: 24 }, (_, i) => ({
  id: `carousel:${i}`,
  type: "movie",
  name: `Fixture title ${i + 1}`,
  genres: ["Drama"],
  runtime: "90 min",
  releaseInfo: "2026",
  description: "A controlled local title for carousel interaction checks.",
}));
const state = {
  settings: { taste: { genres: ["Drama"], exploration: "balanced" } },
  profiles: { active: "fixture" },
};
window.actions = { open: 0, favorite: 0, clicks: 0, menu: 0, remove: 0 };
function App() {
  const [index, setIndex] = useState(0);
  const [late, setLate] = useState(false);
  const [revision, setRevision] = useState(0);
  const [itemCount, setItemCount] = useState(3);
  const [running, setRunning] = useState(true);
  const [heroSettings, settings] = useState({
    titleLogos: "text",
    heroAutoplay: true,
  });
  const row = useScrollRow();
  window.fixture = { setLate, setRevision, settings, setItemCount, setRunning };
  return (
    <PosterActionsContext.Provider
      value={(e) => {
        e.preventDefault();
        window.actions.menu++;
      }}
    >
      <main
        style={themeVariables(resolveAppearance({}))}
        className={`app identity-riwaq rowarrows-header ${heroSettings.reduceMotion ? "reduced-motion" : ""}`}
        lang={lang}
      >
        <HomeHero
          items={metas.slice(0, itemCount)}
          index={index}
          setIndex={setIndex}
          settings={heroSettings}
          favorites={[]}
          running={running}
          onOpen={() => window.actions.open++}
          onFavorite={() => window.actions.favorite++}
        />
        <TasteDiscovery
          rows={[{ key: "fixture", metas }]}
          state={state}
          update={async () => true}
          onOpen={() => window.actions.open++}
          collapsed
        />
        <Rail
          title="Portrait fixture"
          metas={metas}
          onOpen={() => window.actions.open++}
          onRemove={() => window.actions.remove++}
        />
        <div id="late-fixture">
          {late && (
            <div
              key={revision}
              data-revision={revision}
              ref={row.ref}
              className="scroll-row"
              style={{
                display: "flex",
                width: 350,
                overflowX: "auto",
                gap: 10,
              }}
            >
              {metas.map((m) => (
                <button
                  key={m.id}
                  style={{ minWidth: 160, height: 80 }}
                  onClick={() => window.actions.clicks++}
                >
                  {m.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="poster-grid" style={{ marginTop: 30 }}>
          {metas.map((m) => (
            <button key={m.id} className="poster-card" style={{ height: 100 }}>
              {m.name}
            </button>
          ))}
        </div>
      </main>
    </PosterActionsContext.Provider>
  );
}
createRoot(document.getElementById("root")).render(<App />);
