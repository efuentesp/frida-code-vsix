import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
// Iconografía objetivo (DESIGN-SYSTEM-WEBVIEW.md §4): fuente de íconos del
// workbench. Vite emite codicon.ttf a dist-webview/assets/; el CSP del host ya
// permite font-src (verificado 2026-08-19).
import "@vscode/codicons/dist/codicon.css";

const el = document.getElementById("root");
if (el) {
  createRoot(el).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
