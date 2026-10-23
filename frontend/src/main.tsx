import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { PRODUCT_NAME, TAGLINE } from "./brand";

// Dynamically set document title from brand configuration
document.title = `${PRODUCT_NAME} · ${TAGLINE}`;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
