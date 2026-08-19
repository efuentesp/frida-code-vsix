import React from "react";
import { createRoot } from "react-dom/client";
import "@vscode/codicons/dist/codicon.css";
import { App } from "./App";
import "./styles.css";

const el = document.getElementById("root");
if (el) {
  createRoot(el).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
