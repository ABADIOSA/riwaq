import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import Hud from "./components/Hud.jsx";
import "./styles.css";
import "./studio.css";
import "./library.css";
import "./appearance.css";
import "./hud.css";
import "./title.css";
import "./identity.css";
import "./collections.css";
import "./window.css";
import "./hero.css";
import "./smart.css";
import "./session.css";
// The same page runs the player HUD in its transparent window (#hud).
createRoot(document.getElementById("root")).render(
  location.hash === "#hud" ? <Hud /> : <App />,
);
