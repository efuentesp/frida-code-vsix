// Smoke del rewriting del HTML del webview (pure, sin vscode).
import fs from "node:fs";
import { buildWebviewHtml } from "../src/webview-html-core";

const indexHtml = fs.readFileSync("dist-webview/index.html", "utf8");
const out = buildWebviewHtml({
  indexHtml,
  asWebviewUri: (file) => `vscode-webview://fake/assets/${file}`,
  cspSource: "https://vscode-cdn.net",
});

const checks = {
  hasCsp: /http-equiv="Content-Security-Policy"/.test(out),
  hasNonceOnScript: /<script nonce="[^"]+"/.test(out),
  noCrossorigin: !/crossorigin/.test(out),
  rewrittenJs: /src="vscode-webview:\/\/fake\/assets\/index-[A-Za-z0-9]+\.js"/.test(out),
  rewrittenCss: /href="vscode-webview:\/\/fake\/assets\/index-[A-Za-z0-9]+\.css"/.test(out),
};

console.log("--- <head> resultante ---");
console.log(out.split("</head>")[0].split("<head>")[1]);
console.log("--- CHECKS ---");
console.log(JSON.stringify(checks, null, 2));
const allOk = Object.values(checks).every(Boolean);
console.log(allOk ? "✅ webview HTML rewriting OK" : "❌ algún chequeo falló");
process.exitCode = allOk ? 0 : 1;
