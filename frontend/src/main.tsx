import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { PRODUCT_NAME, TAGLINE } from "./brand";
import { initializeTheme } from "./contexts/ThemeContext";

// Dynamically set document title and apply persisted theme before first paint
document.title = `${PRODUCT_NAME} · ${TAGLINE}`;
initializeTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
