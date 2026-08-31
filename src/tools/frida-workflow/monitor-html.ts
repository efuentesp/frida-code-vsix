// monitor-html.ts — páginas self-contained del monitor HTML (FR#7/FR#16).
//
// D7: la landing (/) es un HUB DE MÉTODOS propio de este módulo — espejo de
// la sección «De cero» de la Welcome (webview/components/Welcome.tsx:29-77,
// label real en :33): SDD ● activo → /sdd; AiDD/TEA «próximamente». No
// comparte CATEGORIES con la webview (bifurcación consciente, D7): el HTML
// define su lista de métodos.
//
// /sdd (FR#7): N1 y N2 JUNTOS —
//  · N1: columnas del spec del snapshot (snapshot.specs["sdd"], FR#9), tarjetas
//    con mini-timeline (FR#11), ámbar «desinc» (FR#12), badge n/m post-ship
//    (FR#6) y botones ▶/Ship/⏸ → POST /api/* del Slice 6 (FR#4/FR#5/FR#8).
//  · N2: espejo READ-ONLY del board (columnas + unidades + splits + ciclos
//    validate; SIN ▶ de fase — ese gesto vive en el overlay /board).
//  · Detalle por feature (FR#16): <details> en la tarjeta — timeline completo
//    de etapas, artefactos por etapa con estado individual (enlazado con ruta
//    / «pendiente») e historial de movimientos; el estado abierto sobrevive
//    los re-renders por SSE.
//
// Contrato con el servidor (Slice 6, locked): MonitorSnapshot por GET
// /api/state y evento SSE "snapshot" en /events; POST /api/advance|pause|ship
// con token embebido por el servidor al servir la página (renderSddPage). El
// JS del cliente es vanilla sin dependencias (misma línea que la página
// mínima que este slice reemplaza) y usa function()/concatenación ES5 — sin
// template literals cliente, para no pelear con el template literal TS.
//
// Estética (NFR): paleta espejo de --vscode-* (pl-*/kb-* del webview) con
// claro/oscuro por prefers-color-scheme; escala 10/11/12 (guía /board #169);
// tooltips en todo lo clicable.

/** CSS compartido por el hub y /sdd: variables espejo de --vscode-* con
 *  claro/oscuro (el navegador NO tiene las vars del webview — se definen
 *  aquí con los valores de cada esquema para conservar el lenguaje visual). */
function monitorCss(): string {
 return `:root{color-scheme:light dark;
--vscode-editor-background:#ffffff;--vscode-sideBar-background:#f8f8f8;
--vscode-foreground:#3b3b3b;--vscode-descriptionForeground:#616161;
--vscode-widget-border:rgba(0,0,0,.16);--vscode-list-hoverBackground:rgba(0,0,0,.05);
--vscode-focusBorder:#005fb8;--vscode-textLink-foreground:#005fb8;
--vscode-charts-blue:#005fb8;--vscode-charts-purple:#843da0;
--vscode-charts-yellow:#b98500;--vscode-charts-orange:#d18616;
--vscode-charts-green:#107c10;--vscode-list-warningForeground:#8a6100;
--vscode-inputValidation-warningBackground:rgba(170,127,0,.12);
--vscode-button-background:#0078d4;--vscode-button-foreground:#ffffff}
@media (prefers-color-scheme: dark){:root{
--vscode-editor-background:#1e1e1e;--vscode-sideBar-background:#252526;
--vscode-foreground:#cccccc;--vscode-descriptionForeground:#9d9d9d;
--vscode-widget-border:rgba(128,128,128,.25);--vscode-list-hoverBackground:rgba(128,128,128,.12);
--vscode-focusBorder:#58a6ff;--vscode-textLink-foreground:#4daafc;
--vscode-charts-blue:#58a6ff;--vscode-charts-purple:#c586c0;
--vscode-charts-yellow:#dcdcaa;--vscode-charts-orange:#d18616;
--vscode-charts-green:#4ec9b0;--vscode-list-warningForeground:#cca700;
--vscode-inputValidation-warningBackground:rgba(204,167,0,.1);
--vscode-button-background:#0e639c;--vscode-button-foreground:#ffffff}}
*{box-sizing:border-box}
body{margin:24px;font-family:system-ui,-apple-system,sans-serif;font-size:12px;
background:var(--vscode-editor-background);color:var(--vscode-foreground)}
a{color:var(--vscode-textLink-foreground)}
h1{font-size:16px;margin:0}
h2{font-size:12px;margin:0 0 8px}
code,.cmd{font-family:var(--vscode-editor-font-family,ui-monospace,monospace)}
.metric{font-variant-numeric:tabular-nums;color:var(--vscode-descriptionForeground);font-size:10px}
.metric.ok{color:var(--vscode-charts-green)}
/* Header de página + indicador de conexión (NFR degradación). */
.page-h{display:flex;align-items:center;gap:10px;margin-bottom:16px}
.page-h .sub{color:var(--vscode-descriptionForeground)}
.back{text-decoration:none;font-size:11px}
.conn{margin-left:auto;font-size:10px;color:var(--vscode-descriptionForeground)}
.conn.live{color:var(--vscode-charts-green)}
.conn.retry{color:var(--vscode-list-warningForeground)}
/* Banners ámbar (FR#14 — espejo pl-warn) y toast. */
.warns{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}
.warn-banner{display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:4px;
border:1px solid var(--vscode-list-warningForeground);
background:var(--vscode-inputValidation-warningBackground);
color:var(--vscode-list-warningForeground)}
.wtext{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:11px}
.wx{background:none;border:none;color:inherit;cursor:pointer;font-size:10px;padding:2px 4px;opacity:.7}
.wx:hover{opacity:1}
.toast{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);
background:var(--vscode-button-background);color:var(--vscode-button-foreground);
padding:6px 14px;border-radius:6px;font-size:11px;opacity:0;pointer-events:none;
transition:opacity .2s ease;max-width:80vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.toast.show{opacity:1}
.toast.warn{background:var(--vscode-list-warningForeground)}
/* Secciones N1/N2. */
.sec{display:flex;align-items:center;gap:8px;margin:18px 0 8px}
/* Hub (/): tarjetas de método (espejo starter-card de la Welcome). */
.methods{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;max-width:920px}
.method{display:block;border:1px solid var(--vscode-widget-border);border-radius:8px;
padding:14px;text-decoration:none;color:inherit;background:var(--vscode-sideBar-background)}
.method:hover{border-color:var(--vscode-focusBorder)}
.method.soon{opacity:.55}
.m-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}
.m-title{font-weight:600;font-size:12px}
.m-desc{margin:0 0 8px;color:var(--vscode-descriptionForeground);font-size:11px;line-height:1.4}
.m-go{font-size:11px;color:var(--vscode-textLink-foreground)}
/* Columnas (espejo pl-col/kb-col). */
.cols{display:flex;gap:8px;overflow-x:auto;scrollbar-width:thin;padding-bottom:4px}
.col,.bcol{min-width:210px;max-width:280px;flex:1 1 210px}
.col-h{display:flex;align-items:center;gap:5px;margin-bottom:6px;font-size:11px;font-weight:600;
color:var(--vscode-descriptionForeground)}
.cdot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
/* Tarjeta de feature (espejo pl-card). */
.card{padding:6px 8px;border-radius:6px;border:1px solid var(--vscode-widget-border);
background:var(--vscode-sideBar-background);display:flex;flex-direction:column;gap:4px;margin-bottom:6px}
.card:hover{border-color:var(--vscode-focusBorder)}
.card.desync{border-color:var(--vscode-list-warningForeground);
box-shadow:0 0 0 1px var(--vscode-list-warningForeground) inset}
.card-head{display:flex;align-items:center;gap:6px;min-width:0}
.bar{width:3px;align-self:stretch;border-radius:2px;flex-shrink:0}
.title{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
font-weight:600;font-size:11px}
.badges{display:flex;flex-wrap:wrap;align-items:center;gap:6px;row-gap:2px}
.badges>*{flex-shrink:0}
.dots{display:inline-flex;gap:2px;align-items:center}
.dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;
background:var(--vscode-widget-border);transition:background-color .2s ease}
.dot.done{background:var(--vscode-charts-green)}
.dot.current{background:var(--vscode-focusBorder);
box-shadow:0 0 0 1px var(--vscode-focusBorder) inset}
.dot.paused{background:var(--vscode-list-warningForeground);
box-shadow:0 0 0 1px var(--vscode-list-warningForeground) inset}
.dot.next{background:var(--vscode-widget-border)}
.badge{font-size:10px;white-space:nowrap}
.badge.warn{color:var(--vscode-list-warningForeground)}
.badge.ok{color:var(--vscode-charts-green)}
.actions{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
/* Botones (espejo fbutton: primary/secondary del VS Code). */
.btn{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:4px;
font-size:11px;cursor:pointer;background:transparent;color:var(--vscode-foreground);
border:1px solid var(--vscode-widget-border)}
.btn:hover{border-color:var(--vscode-focusBorder)}
.btn.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground);
border-color:var(--vscode-button-background);font-weight:600}
.btn.sm{padding:2px 8px;font-size:10px}
/* Detalle FR#16. */
.detail{font-size:10px}
.detail summary{cursor:pointer;color:var(--vscode-descriptionForeground);
user-select:none;margin-top:2px}
.detail summary:hover{color:var(--vscode-foreground)}
.dt-body{padding:6px 0 2px 2px;display:flex;flex-direction:column;gap:3px}
.dt-row{display:grid;grid-template-columns:10px 84px 130px 1fr;gap:6px;align-items:center}
.dt-row .dot{width:7px;height:7px}
.dt-stage{font-weight:600}
.dt-state{color:var(--vscode-descriptionForeground)}
.dt-art{min-width:0;word-break:break-word}
.dt-path{font-family:ui-monospace,monospace;font-size:9px;
color:var(--vscode-descriptionForeground)}
.dt-hist-t{margin-top:4px;color:var(--vscode-descriptionForeground);font-weight:600}
.dt-hist{color:var(--vscode-descriptionForeground)}
/* Estados vacíos (FR#15). */
.empty{padding:8px;border:1px dashed var(--vscode-widget-border);border-radius:6px;
color:var(--vscode-descriptionForeground);font-size:11px;max-width:640px}
.cmdrow{display:flex;align-items:center;gap:8px;margin-top:6px}
.cmd{font-size:10px;color:var(--vscode-descriptionForeground);opacity:.9}
/* Board N2 (espejo kb-*). */
.board{margin-bottom:14px}
.board-h{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.btitle{font-weight:600;font-size:11px}
.ucard{padding:5px 8px;border-radius:6px;border:1px solid var(--vscode-widget-border);
background:var(--vscode-sideBar-background);display:flex;flex-direction:column;gap:3px;margin-bottom:5px}
.uhead{display:flex;align-items:center;gap:6px;min-width:0}
.uid{font-size:11px}
.utitle{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
color:var(--vscode-descriptionForeground);font-size:10px}
.ucard.done .uid{color:var(--vscode-charts-green)}
.bsub{font-size:10px;color:var(--vscode-descriptionForeground);padding-left:9px}
.bsub.done{color:var(--vscode-charts-green)}
.bsub b{font-weight:600}`;
}

/** Hub de métodos (/) — landing estática (D7): SDD ● activo → /sdd;
 *  AiDD/TEA «próximamente». Sin JS: no hay estado vivo aquí. */
export function renderMonitorHubPage(): string {
 return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Frida Monitor</title>
<style>${monitorCss()}</style>
</head>
<body>
<header class="page-h">
 <h1>Frida Monitor</h1>
 <span class="sub">Espejo del ecosistema · loopback 127.0.0.1</span>
</header>
<main class="methods">
 <a class="method" href="/sdd" title="Abrir el pipeline SDD con N1 y N2 juntos">
  <div class="m-head">
   <span class="m-title">Desarrollo Autónomo (SDD)</span>
   <span class="badge ok">● activo</span>
  </div>
  <p class="m-desc">La fábrica: features avanzando discover → research → design → plan → 🚀 ready-to-ship, con su board de ejecución.</p>
  <span class="m-go">Abrir /sdd →</span>
 </a>
 <div class="method soon" title="Entrará por configuración del motor PanelSpec (FR#9) cuando el método exista">
  <div class="m-head">
   <span class="m-title">Planificar con AiDD</span>
   <span class="badge warn">próximamente</span>
  </div>
  <p class="m-desc">Brief, PRD, arquitectura y specs para una idea nueva.</p>
 </div>
 <div class="method soon" title="Entrará por configuración del motor PanelSpec (FR#9) cuando el método exista">
  <div class="m-head">
   <span class="m-title">Diseñar Pruebas (TEA)</span>
   <span class="badge warn">próximamente</span>
  </div>
  <p class="m-desc">Matriz de pruebas por escenarios y criterios de aceptación BDD.</p>
 </div>
</main>
</body>
</html>`;
}

/** Página /sdd (FR#7): N1 + N2 juntos, vivos por SSE, con control POST.
 *  El servidor embebe el token para los POST autenticados (FR#8). */
export function renderSddPage(token: string): string {
 return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pipeline SDD · Frida Monitor</title>
<style>${monitorCss()}</style>
</head>
<body>
<header class="page-h">
 <a class="back" href="/" title="Volver al hub de métodos">← Monitor</a>
 <h1>Pipeline SDD</h1>
 <span class="sub">N1 planeación + N2 ejecución</span>
 <span class="conn" id="conn" title="">conectando…</span>
</header>
<div class="warns" id="warns"></div>
<main id="root"><p class="empty">cargando estado…</p></main>
<div class="toast" id="toast"></div>
<script>
(function () {
"use strict";
var TOKEN = ${JSON.stringify(token)};

/* Fallback del spec SDD (espejo de SDD_PANEL_SPEC, panel-spec.ts): la página
 * renderiza algo razonable ANTES del primer snapshot (degradación NFR). */
var FALLBACK_SPEC = {
 id: "sdd", title: "Pipeline SDD",
 columns: [
  { id: "discover", label: "discover", advanceLabel: "Continuar a research →", artifactLabel: "FRD" },
  { id: "research", label: "research", advanceLabel: "Continuar a design →", artifactLabel: "Research" },
  { id: "design", label: "design", advanceLabel: "Continuar a plan →", artifactLabel: "Design" },
  { id: "plan", label: "plan", advanceKind: "ship", advanceLabel: "Ship → fases a ejecución", artifactLabel: "Plan" },
  { id: "ready-to-ship", label: "🚀 ready-to-ship", terminal: true }
 ],
 emptyState: {
  command: "/skill:discover <idea>",
  hint: "Genera el FRD de una feature para abrirle camino en el pipeline."
 }
};

/* Acentos — espejo de STAGE_ACCENT (features-ui.tsx) y COL_ACCENT (board-ui.tsx). */
var STAGE_ACCENT = {
 discover: "var(--vscode-charts-blue)",
 research: "var(--vscode-charts-purple)",
 design: "var(--vscode-charts-yellow)",
 plan: "var(--vscode-charts-orange)",
 "ready-to-ship": "var(--vscode-charts-green)"
};
var COL_ACCENT = {
 backlog: "var(--vscode-descriptionForeground)",
 elaborate: "var(--vscode-charts-blue)",
 implement: "var(--vscode-charts-purple)",
 validate: "var(--vscode-charts-yellow)",
 commit: "var(--vscode-charts-green)",
 elaborada: "var(--vscode-charts-blue)",
 implementada: "var(--vscode-charts-purple)",
 validada: "var(--vscode-charts-yellow)",
 commiteada: "var(--vscode-charts-green)"
};

var snapshot = null;
var conn = "connecting";
var warnings = {}; /* key → texto (memoria de sesión en JS, FR#14) */
var openDetails = {}; /* fid → true: <details> abiertos que sobreviven SSE */
var toast = null;
var toastTimer = null;

function esc(s) {
 return String(s).replace(/[&<>"']/g, function (c) {
  return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
 });
}
function spec() {
 if (snapshot && snapshot.specs) {
  for (var i = 0; i < snapshot.specs.length; i++)
   if (snapshot.specs[i].id === "sdd") return snapshot.specs[i];
 }
 return FALLBACK_SPEC;
}
function colIdx(sp, stage) {
 for (var i = 0; i < sp.columns.length; i++)
  if (sp.columns[i].id === stage) return i;
 return -1;
}
function colById(sp, stage) {
 var i = colIdx(sp, stage);
 return i >= 0 ? sp.columns[i] : null;
}
function accentOf(stage) {
 return STAGE_ACCENT[stage] || "var(--vscode-descriptionForeground)";
}
function colAccent(c) {
 return COL_ACCENT[c] || "var(--vscode-descriptionForeground)";
}
function fmtTs(ts) {
 if (!ts) return "";
 try { return new Date(ts).toLocaleString(); } catch (e) { return String(ts); }
}
function featureById(id) {
 var fs = (snapshot && snapshot.features) || [];
 for (var i = 0; i < fs.length; i++) if (fs[i].id === id) return fs[i];
 return null;
}
/* Artefacto enlazado por etapa: el FRD ES la feature (discover); el resto
 * vive en f.artifacts (features.ts — sin discover en el mapa). */
function artifactOf(f, stageId) {
 if (stageId === "discover") return f.id;
 if (f.artifacts) return f.artifacts[stageId] || null;
 return null;
}

/* ── Render ─────────────────────────────────────────────────────────── */

function connLabel() {
 if (conn === "live") return "● en vivo";
 if (conn === "retry") return "● reconectando…";
 return "● conectando…";
}
function warningsHtml() {
 var keys = Object.keys(warnings);
 if (!keys.length) return "";
 var out = "";
 for (var i = 0; i < keys.length; i++) {
  out += '<div class="warn-banner" title="' + esc(warnings[keys[i]]) + '">' +
   '<span class="wtext">' + esc(warnings[keys[i]]) + '</span>' +
   '<button class="wx" data-action="dismiss" data-id="' + esc(keys[i]) +
   '" title="Descartar por esta sesión">✕</button></div>';
 }
 return out;
}
function timelineDots(sp, idx, paused) {
 var out = '<span class="dots" title="mini-timeline de etapas">';
 for (var i = 0; i < sp.columns.length; i++) {
  var st = i < idx ? "done" : i === idx ? (paused ? "paused" : "current") : "next";
  out += '<span class="dot ' + st + '" title="' + esc(sp.columns[i].label) + '"></span>';
 }
 return out + "</span>";
}
function detailHtml(f, sp) {
 var idx = colIdx(sp, f.stage);
 var rows = "";
 for (var i = 0; i < sp.columns.length; i++) {
  var c = sp.columns[i];
  var st, label;
  if (i < idx) { st = "done"; label = "completada"; }
  else if (i === idx) { st = f.paused ? "paused" : "current"; label = f.paused ? "pausada (no bloquea)" : "actual"; }
  else { st = "next"; label = "próxima"; }
  var artHtml;
  if (c.id === "ready-to-ship") {
   /* Terminal (FR#6): ship + plan + badge, no artefacto de etapa. */
   artHtml = f.shippedAt ? "✓ ship " + fmtTs(f.shippedAt) : "— pendiente de ship";
   if (f.planPath) artHtml += ' <span class="dt-path">' + esc(f.planPath) + "</span>";
   if (f.badge) artHtml += ' <span class="badge ok">' + f.badge.done + "/" + f.badge.total + " fases</span>";
  } else {
   var art = artifactOf(f, c.id);
   artHtml = art ? '✓ <span class="dt-path">' + esc(art) + "</span>" : "— pendiente";
  }
  rows += '<div class="dt-row"><span class="dot ' + st + '"></span>' +
   '<span class="dt-stage">' + esc(c.artifactLabel || c.label) + "</span>" +
   '<span class="dt-state">' + label + "</span>" +
   '<span class="dt-art">' + artHtml + "</span></div>";
 }
 var hist = "";
 if (f.history && f.history.length) {
  hist = '<div class="dt-hist-t">Historial</div>';
  for (var h = f.history.length - 1; h >= 0; h--) {
   var e = f.history[h];
   hist += '<div class="dt-hist">→ ' + esc(e.to || "") + " · " + fmtTs(e.ts) +
    (e.source ? " · " + esc(e.source) : "") + "</div>";
  }
 }
 return '<details class="detail" data-fid="' + esc(f.id) + '">' +
  "<summary>timeline y artefactos</summary>" +
  '<div class="dt-body">' + rows + hist + "</div></details>";
}
function cardHtml(f, sp) {
 var col = colById(sp, f.stage);
 var idx = colIdx(sp, f.stage);
 var badges = timelineDots(sp, idx, f.paused);
 if (f.desync) badges += ' <span class="badge warn" title="el FS tiene artefactos más avanzados que la tarjeta — usa ▶ para alcanzarla">desinc</span>';
 if (f.badge) badges += ' <span class="badge ok" title="fases raíz commiteadas en el board N2">' + f.badge.done + "/" + f.badge.total + " fases</span>";
 var actions = "";
 if (col && !col.terminal) {
  var isShip = col.advanceKind === "ship";
  actions += '<button class="btn' + (isShip ? " primary" : "") + '" data-action="' +
   (isShip ? "ship" : "advance") + '" data-id="' + esc(f.id) + '" title="' +
   (isShip
    ? "Crear las fases del plan como unidades backlog del board N2 (sin ejecutar nada)"
    : "Inyectar el comando de la skill al chat del host y mover la tarjeta") +
   '">' + (isShip ? "🚀 " : "▶ ") + esc(col.advanceLabel || "Avanzar") + "</button>";
 }
 actions += '<button class="btn sm" data-action="pause" data-id="' + esc(f.id) + '" title="' +
  (f.paused ? "Reanudar la feature" : "Pausar — señal visual, NO bloquea el avance (FR#14)") +
  '">' + (f.paused ? "▶ Reanudar" : "⏸ Pausar") + "</button>";
 return '<div class="card' + (f.desync ? " desync" : "") + '">' +
  '<div class="card-head"><span class="bar" style="background:' + accentOf(f.stage) + '"></span>' +
  '<span class="title" title="' + esc(f.id) + '">' + esc(f.title || f.id) + "</span>" +
  (f.paused ? '<span class="badge warn" title="Pausada — el avance NO está bloqueado">⏸</span>' : "") +
  "</div>" +
  '<div class="badges">' + badges + "</div>" +
  '<div class="actions">' + actions + "</div>" +
  detailHtml(f, sp) +
  "</div>";
}
function n1Html() {
 if (!snapshot) return '<p class="empty">cargando estado…</p>';
 var sp = spec();
 var feats = snapshot.features || [];
 var desyncCount = 0;
 for (var i = 0; i < feats.length; i++) if (feats[i].desync) desyncCount++;
 var head = '<h2 class="sec">N1 · Planeación <span class="metric">(' + feats.length + ")</span>" +
  (desyncCount ? ' <span class="badge warn" title="el FS va por delante de la tarjeta — usa ▶ para alcanzarla">desinc ' + desyncCount + "</span>" : "") +
  "</h2>";
 if (!feats.length) {
  /* FR#15: el comando que llena el vacío, con botón accionable (copiar). */
  return head + '<div class="empty"><p>' + esc(sp.emptyState.hint || "") + "</p>" +
   '<div class="cmdrow"><code class="cmd">' + esc(sp.emptyState.command) + "</code>" +
   '<button class="btn sm" data-action="copy" data-copy="' + esc(sp.emptyState.command) +
   '" title="Copiar el comando al portapapeles y pegarlo en el chat de Frida">Copiar</button></div></div>';
 }
 var cols = "";
 for (var c = 0; c < sp.columns.length; c++) {
  var col = sp.columns[c];
  var inCol = [];
  for (var j = 0; j < feats.length; j++) if (feats[j].stage === col.id) inCol.push(feats[j]);
  var cards = "";
  for (var k = 0; k < inCol.length; k++) cards += cardHtml(inCol[k], sp);
  cols += '<div class="col"><div class="col-h"><span class="cdot" style="background:' +
   accentOf(col.id) + '"></span>' + esc(col.label) + ' <span class="metric">(' + inCol.length +
   ")</span></div>" + cards + "</div>";
 }
 return head + '<div class="cols">' + cols + "</div>";
}
function unitHtml(u, kidsBy) {
 var kids = kidsBy[u.id] || [];
 var badges = "";
 if (kids.length) {
  var kd = 0;
  for (var i = 0; i < kids.length; i++) if (kids[i].done) kd++;
  badges += '<span class="metric" title="splits done">' + kd + "/" + kids.length + "</span>";
 }
 if (u.validateFails > 0) badges += '<span class="badge warn" title="' + u.validateFails +
  ' ciclo(s) de reintento (validate FAIL)">↻ ' + u.validateFails + "</span>";
 var subs = "";
 for (var s = 0; s < kids.length; s++) {
  subs += '<div class="bsub' + (kids[s].done ? " done" : "") + '" title="' +
   esc(kids[s].title || kids[s].id) + '">' + (kids[s].done ? "✓" : "·") + " <b>" +
   esc(kids[s].id) + "</b>" + (kids[s].title ? " " + esc(kids[s].title) : "") + "</div>";
 }
 return '<div class="ucard' + (u.done ? " done" : "") + '" title="' + esc(u.title || u.id) +
  " · " + (u.transitions || 0) + ' transiciones">' +
  '<div class="uhead"><span class="bar" style="background:' +
  (u.done ? "var(--vscode-charts-green)" : colAccent(u.status)) + '"></span>' +
  '<b class="uid">' + esc(u.id) + '</b><span class="utitle">' + esc(u.title || "") + "</span></div>" +
  (badges ? '<div class="badges">' + badges + "</div>" : "") + subs + "</div>";
}
function boardHtml(b) {
 var units = b.units || [];
 var roots = [], kidsBy = {};
 for (var i = 0; i < units.length; i++) {
  if (units[i].parentId) {
   (kidsBy[units[i].parentId] = kidsBy[units[i].parentId] || []).push(units[i]);
  } else roots.push(units[i]);
 }
 var done = 0;
 for (var r = 0; r < roots.length; r++) if (roots[r].done) done++;
 var base = (b.path || "").split("/").pop() || b.path || "";
 var cols = "";
 var colsArr = b.columns || [];
 for (var c = 0; c < colsArr.length; c++) {
  var inCol = [];
  for (var j = 0; j < roots.length; j++)
   if (roots[j].status === colsArr[c]) inCol.push(roots[j]);
  var cards = "";
  for (var k = 0; k < inCol.length; k++) cards += unitHtml(inCol[k], kidsBy);
  cols += '<div class="bcol"><div class="col-h"><span class="cdot" style="background:' +
   colAccent(colsArr[c]) + '"></span>' + esc(colsArr[c]) + ' <span class="metric">(' +
   inCol.length + ")</span></div>" + cards + "</div>";
 }
 return '<div class="board" title="plan: ' + esc(b.path || "") + '">' +
  '<div class="board-h"><span class="btitle">' + esc(base) + "</span>" +
  '<span class="metric ok" title="fases raíz commiteadas">' + done + "/" + roots.length + "</span></div>" +
  '<div class="cols">' + cols + "</div></div>";
}
function n2Html() {
 if (!snapshot) return "";
 var boards = snapshot.boards || [];
 var head = '<h2 class="sec">N2 · Ejecución <span class="metric">(' + boards.length +
  (boards.length === 1 ? " board" : " boards") + ")</span></h2>";
 if (!boards.length) {
  return head + '<div class="empty"><p>Sin boards todavía — un ▶ «Ship → fases a ejecución» desde N1 crea las fases del plan como backlog.</p></div>';
 }
 var out = "";
 for (var i = 0; i < boards.length; i++) out += boardHtml(boards[i]);
 return head + out;
}

/* <details> abiertos sobreviven el re-render por SSE (FR#16). */
function syncOpen() {
 var els = document.querySelectorAll("details[data-fid]");
 var fresh = {};
 for (var i = 0; i < els.length; i++)
  if (els[i].open) fresh[els[i].getAttribute("data-fid")] = true;
 openDetails = fresh;
}
function reopenDetails() {
 var els = document.querySelectorAll("details[data-fid]");
 for (var i = 0; i < els.length; i++)
  if (openDetails[els[i].getAttribute("data-fid")]) els[i].open = true;
}

function render() {
 syncOpen();
 var connEl = document.getElementById("conn");
 connEl.className = "conn " + conn;
 connEl.textContent = connLabel();
 connEl.title = snapshot && snapshot.generatedAt
  ? "último snapshot: " + snapshot.generatedAt : "";
 document.getElementById("warns").innerHTML = warningsHtml();
 document.getElementById("root").innerHTML = n1Html() + n2Html();
 reopenDetails();
 var toastEl = document.getElementById("toast");
 toastEl.className = "toast" + (toast ? " show" + (toast.kind ? " " + toast.kind : "") : "");
 toastEl.textContent = toast ? toast.text : "";
}

/* ── Datos: GET /api/state + SSE /events (contrato Slice 6) ─────────── */

function refresh() {
 fetch("/api/state")
  .then(function (r) { return r.json(); })
  .then(function (s) { snapshot = s; render(); })
  .catch(function () { render(); });
}
function post(path, body) {
 return fetch(path, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-frida-monitor-token": TOKEN },
  body: JSON.stringify(body)
 }).then(function (r) { return r.json(); });
}
function setToast(text, kind) {
 toast = { text: text, kind: kind || "" };
 render();
 if (toastTimer) clearTimeout(toastTimer);
 toastTimer = setTimeout(function () { toast = null; render(); }, 4000);
}

/* ── Acciones (delegación por data-action) ──────────────────────────── */

function doAdvance(id) {
 post("/api/advance", { id: id }).then(function (res) {
  if (res.warning) warnings["adv:" + id] = res.warning;
  else delete warnings["adv:" + id];
  if (res.moved && res.command) setToast("Comando enviado al chat de Frida: " + res.command);
  refresh();
 }).catch(function () { setToast("POST /api/advance falló — ¿host vivo?", "warn"); });
}
function doShip(id) {
 post("/api/ship", { id: id }).then(function (res) {
  if (res.failure === "no-plan") warnings["ship:" + id] = res.warning ||
   "No hay plan enlazado — completa /skill:plan antes de shipear.";
  else delete warnings["ship:" + id];
  if (res.moved) setToast("🚀 Ship listo: " + res.phaseCount + " fase(s) en backlog del board");
  refresh();
 }).catch(function () { setToast("POST /api/ship falló — ¿host vivo?", "warn"); });
}
function doPause(id) {
 var f = featureById(id);
 post("/api/pause", { id: id, paused: f ? !f.paused : true }).then(function (res) {
  if (res && res.ok === false) setToast("Feature no encontrada", "warn");
  refresh();
 }).catch(function () { setToast("POST /api/pause falló — ¿host vivo?", "warn"); });
}
function legacyCopy(text, done) {
 try {
  var ta = document.createElement("textarea");
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
  done();
 } catch (e) {
  setToast("No se pudo copiar — cópialo a mano", "warn");
 }
}
function doCopy(text) {
 function done() { setToast("Copiado: " + text); }
 if (navigator.clipboard && navigator.clipboard.writeText) {
  navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text, done); });
 } else legacyCopy(text, done);
}

document.addEventListener("click", function (ev) {
 var el = ev.target.closest("[data-action]");
 if (!el) return;
 var a = el.getAttribute("data-action");
 var id = el.getAttribute("data-id");
 if (a === "advance") doAdvance(id);
 else if (a === "ship") doShip(id);
 else if (a === "pause") doPause(id);
 else if (a === "copy") doCopy(el.getAttribute("data-copy"));
 else if (a === "dismiss") { delete warnings[id]; render(); }
});

var es = new EventSource("/events");
es.onopen = function () { conn = "live"; render(); };
es.onerror = function () { conn = "retry"; render(); };
es.addEventListener("snapshot", function (e) {
 try { snapshot = JSON.parse(e.data); } catch (err) { return; }
 render();
});

refresh();
})();
</script>
</body>
</html>`;
}
