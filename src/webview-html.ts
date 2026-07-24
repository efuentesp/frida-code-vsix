import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildWebviewHtml } from "./webview-html-core";

// Wrapper vscode-dependiente: lee dist-webview/index.html y delega en buildWebviewHtml.
export function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const indexPath = path.join(extensionUri.fsPath, "dist-webview", "index.html");
  const indexHtml = fs.readFileSync(indexPath, "utf8");
  const faviconUri = webview
    .asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "favicon.svg"))
    .toString();
  return buildWebviewHtml({
    indexHtml,
    asWebviewUri: (file) =>
      webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist-webview", "assets", file)).toString(),
    cspSource: webview.cspSource,
    faviconUri,
    faviconType: "image/svg+xml",
  });
}
