// Lógica PURA de generación del HTML del webview (sin dependencia de vscode ni fs).
// Tomada del index.html que produce Vite: inyecta CSP + nonce, reescribe URIs de
// assets, quita crossorigin. Separada de webview-html.ts para ser testable en Node.

export function buildWebviewHtml(opts: {
  indexHtml: string;
  asWebviewUri: (assetFile: string) => string;
  cspSource: string;
}): string {
  const nonce = getNonce();
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' ${opts.cspSource}`,
    `style-src 'unsafe-inline' ${opts.cspSource}`,
    `img-src ${opts.cspSource} data:`,
    `font-src ${opts.cspSource}`,
  ].join("; ") + ";";

  let html = opts.indexHtml;

  // Inyectar CSP en <head>.
  if (/<head>/i.test(html)) {
    html = html.replace(/<head>/i, `<head>\n<meta http-equiv="Content-Security-Policy" content="${csp}" />`);
  }

  // Reescribir URIs de assets: src="./assets/x" o href="./assets/x" → asWebviewUri(x).
  html = html.replace(
    /(src|href)\s*=\s*"(\.\/|\/)?assets\/([^"]+)"/g,
    (_m, attr: string, _prefix: string, file: string) => `${attr}="${opts.asWebviewUri(file)}"`
  );

  // Quitar crossorigin (puede interferir con recursos vscode-webview).
  html = html.replace(/\s+crossorigin(="[^"]*")?/g, "");

  // Añadir nonce a cada <script>.
  html = html.replace(/<script\b/g, `<script nonce="${nonce}"`);

  return html;
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}
