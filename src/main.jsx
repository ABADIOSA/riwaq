import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import Hud from "./components/Hud.jsx";
import "./styles.css";
import "./studio.css";
import "./library.css";
import "./appearance.css";
import "./hud.css";
import "./player-bar.css";
import "./title.css";
import "./identity.css";
import "./collections.css";
import "./window.css";
import "./hero.css";
import "./smart.css";
import "./session.css";
import "./taste.css";
import "./music.css";
import "./local-music.css";
import "./ltr.css";
import "./notifications.css";
import "./review083.css";
import "./first-run.css";
// Rebuilt surfaces: semantic tokens, then See all (after the shared sheets).
import "./tokens.css";
import "./browse.css";
import "./scheme-light.css";
// The wheel and the glass controls (November 2026): after the light
// scheme, so their palette-based surfaces win in both schemes.
import "./glass.css";
import "./wheel.css";
import { watchErrors } from "./lib/diagnostics.js";
import { savedScheme } from "./lib/scheme.js";

// Recent interface errors for the diagnostic report (Settings → النظام).
watchErrors();
// The scheme this device drew last, until the app state arrives (#126).
// The HUD's window is transparent over the picture and stays as it is.
if (location.hash !== "#hud")
  document.documentElement.dataset.scheme = savedScheme();
// The same page runs the player HUD in its transparent window (#hud).
createRoot(document.getElementById("root")).render(
  location.hash === "#hud" ? <Hud /> : <App />,
);
