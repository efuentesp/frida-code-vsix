import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Build del webview (React). root=webview ⇒ el index de entrada es plano;
// outDir absoluto al raíz del proyecto ⇒ dist-webview/index.html + dist-webview/assets/.
// El host lee index.html y reescribe los URIs de assets a vscode-webview:// con nonce + CSP.
export default defineConfig({
  plugins: [react()],
  root: "webview",
  base: "./",
  build: {
    outDir: path.resolve(process.cwd(), "dist-webview"),
    emptyOutDir: true,
    rollupOptions: { input: path.resolve(process.cwd(), "webview", "index.html") },
    target: "es2022",
  },
});
