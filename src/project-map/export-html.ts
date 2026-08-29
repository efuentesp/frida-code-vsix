// M2 (#143) — Mapa del proyecto: export HTML autónomo (FR-9).
//
// Approach híbrido (decisión de design): la WEBVIEW serializa el layout de la
// vista activa (qué journeys abiertos, columnas/aristas del grafo, shots ya
// cacheados en el store); el HOST ensambla el documento e inlina los PNGs que
// falten resolviendo screenId → screenshot desde su inventory M8 cargado
// (cero confianza en paths del cliente — molde del shot on-demand de la Fase 2).
//
// Molde del documento: el index.html autónomo de M8
// (src/tools/frida-app-walkthrough/workflow.ts:576-615) — CSS inline con
// paleta FIJA (se abre fuera de VS Code: nada de --vscode-*), datos como JSON
// embebido con escape de "</" para no romper el <script>, render vanilla con
// createElement/textContent (nunca innerHTML con datos). La geometría del
// grafo replica la del GraphCanvas de la webview (columnas ~140 px, nodos
// apilados, aristas bezier con flecha, previews de screenshot) para que el
// export se vea como lo que el usuario ve.
//
// Semántica del shot en el payload: undefined = pedir al host que resuelva
// (nodo con screenId y sin respuesta cacheada); "" = SIN captura definitiva
// (placeholder textual); data-URI = imagen inlinada.

/** Nodo del grafo serializado (espejo UI en webview/types.ts — builds separados). */
export interface PmExportNode {
	id: string;
	title: string;
	/** Vista funcional: pantalla M8 — el host resuelve el PNG faltante. */
	screenId?: string;
	/** data-URI cacheada por la webview; "" = sin captura; undefined = resolver. */
	shot?: string;
	/** true = borde rojo (overlay de riesgo de la vista Técnica). */
	danger?: boolean;
}

export interface PmExportEdge {
	from: string;
	to: string;
	label?: string;
}

export interface PmExportColumn {
	id: string;
	title?: string;
	nodes: PmExportNode[];
}

/** Sección exportable: un journey (Funcional) o un bloque (Técnica). */
export interface PmExportSection {
	id: string;
	title: string;
	open: boolean;
	columns: PmExportColumn[];
	edges: PmExportEdge[];
	notes: string[];
}

export interface PmExportPayload {
	view: "functional" | "technical";
	generatedAt: string;
	title: string;
	meta: string[];
	sections: PmExportSection[];
	notes: string[];
}

export interface ExportHtmlOpts {
	/** Resuelve PNGs no cacheados (data-URI; ""/undefined = sin captura).
	 *  Inyectado por extension.ts desde pmState — la lib no lee estado host. */
	resolveShot?: (screenId: string) => string | undefined;
}

/** Escape HTML para los pocos valores que viajan como texto del documento
 *  (title/h1) — molde M8. Los datos viajan por JSON + textContent. */
export function escHtml(v: unknown): string {
	return String(v === null || v === undefined ? "" : v)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

const JS_RENDERER = [
	"var SVGNS = 'http://www.w3.org/2000/svg';",
	"function el(t, p) { var n = document.createElement(t); if (p) p.appendChild(n); return n; }",
	"function sel(t, p) { var n = document.createElementNS(SVGNS, t); if (p) p.appendChild(n); return n; }",
	"function txt(n, s) { n.textContent = s; return n; }",
	"function clip(t, m) { t = String(t); return t.length > m ? t.slice(0, m - 1) + '\\u2026' : t; }",
	"function graph(sec) {",
	" var COL_W = 140, GAP_X = 26, NODE_H = 36, PREVIEW_H = 66, GAP_Y = 26, PAD = 10;",
	" var placed = {}, maxY = PAD;",
	" sec.columns.forEach(function (col, ci) {",
	"  var y = PAD + (col.title ? 26 : 14);",
	"  col.nodes.forEach(function (n) {",
	"   var h = NODE_H + (n.shot !== undefined ? PREVIEW_H : 0);",
	"   placed[n.id] = { x: PAD + ci * (COL_W + GAP_X), y: y, h: h };",
	"   y += h + GAP_Y;",
	"  });",
	"  maxY = Math.max(maxY, y - GAP_Y);",
	" });",
	" var w = Math.max(PAD * 2 + sec.columns.length * (COL_W + GAP_X) - GAP_X, 160);",
	" var h = Math.max(maxY + PAD, 110);",
	" var svg = sel('svg'); svg.setAttribute('width', w); svg.setAttribute('height', h);",
	" var defs = sel('defs', svg);",
	" var mk = sel('marker', defs);",
	" mk.setAttribute('id', 'pm-arrow'); mk.setAttribute('viewBox', '0 0 8 8');",
	" mk.setAttribute('refX', 7); mk.setAttribute('refY', 4);",
	" mk.setAttribute('markerWidth', 6); mk.setAttribute('markerHeight', 6);",
	" mk.setAttribute('orient', 'auto-start-reverse');",
	" var mp = sel('path', mk); mp.setAttribute('d', 'M 0 0 L 8 4 L 0 8 z'); mp.setAttribute('class', 'arrow');",
	" (sec.edges || []).forEach(function (e, ei) {",
	"  var a = placed[e.from], b = placed[e.to]; if (!a || !b) return;",
	"  var lane = ((ei % 4) - 1.5) * 7;",
	"  var sameCol = a.x === b.x;",
	"  var x1 = sameCol ? a.x + COL_W / 2 : a.x + COL_W;",
	"  var y1 = sameCol ? a.y + a.h : a.y + NODE_H / 2 + lane;",
	"  var x2 = sameCol ? b.x + COL_W / 2 : b.x;",
	"  var y2 = sameCol ? b.y : b.y + NODE_H / 2 + lane;",
	"  var sag = sameCol ? Math.max((y2 - y1) / 2, 14) : Math.max(Math.abs(x2 - x1) * 0.45, 18);",
	"  var c1x = sameCol ? x1 : x1 + sag, c1y = sameCol ? y1 + sag : y1;",
	"  var c2x = sameCol ? x2 : x2 - sag, c2y = sameCol ? y2 - sag : y2;",
	"  var pe = sel('path', svg); pe.setAttribute('class', 'edge');",
	"  pe.setAttribute('d', 'M ' + x1 + ' ' + y1 + ' C ' + c1x + ' ' + c1y + ', ' + c2x + ' ' + c2y + ', ' + x2 + ' ' + y2);",
	"  pe.setAttribute('marker-end', 'url(#pm-arrow)');",
	"  if (e.label) txt(sel('title', pe), e.label);",
	" });",
	" sec.columns.forEach(function (col, ci) {",
	"  if (col.title) {",
	"   var ct = sel('text', svg);",
	"   ct.setAttribute('x', PAD + ci * (COL_W + GAP_X)); ct.setAttribute('y', PAD + 12);",
	"   ct.setAttribute('class', 'col-title'); txt(ct, clip(col.title, 18));",
	"  }",
	"  col.nodes.forEach(function (n) {",
	"   var p = placed[n.id]; if (!p) return;",
	"   var g = sel('g', svg);",
	"   var r = sel('rect', g);",
	"   r.setAttribute('x', p.x); r.setAttribute('y', p.y);",
	"   r.setAttribute('width', COL_W); r.setAttribute('height', NODE_H); r.setAttribute('rx', 6);",
	"   r.setAttribute('class', 'node-box' + (n.danger ? ' danger' : ''));",
	"   var ti = sel('text', g); ti.setAttribute('x', p.x + 6); ti.setAttribute('y', p.y + 13);",
	"   ti.setAttribute('class', 'node-id'); txt(ti, n.id);",
	"   var tt = sel('text', g); tt.setAttribute('x', p.x + 6); tt.setAttribute('y', p.y + 26);",
	"   tt.setAttribute('class', 'node-title'); txt(tt, clip(n.title, 20));",
	"   if (n.shot === '') {",
	"    var rm = sel('rect', g);",
	"    rm.setAttribute('x', p.x + 4); rm.setAttribute('y', p.y + NODE_H + 4);",
	"    rm.setAttribute('width', COL_W - 8); rm.setAttribute('height', PREVIEW_H - 10); rm.setAttribute('rx', 4);",
	"    rm.setAttribute('class', 'shot-missing');",
	"    var lm = sel('text', g); lm.setAttribute('x', p.x + COL_W / 2); lm.setAttribute('y', p.y + NODE_H + PREVIEW_H / 2);",
	"    lm.setAttribute('text-anchor', 'middle'); lm.setAttribute('class', 'shot-label');",
	"    txt(lm, 'sin captura');",
	"   } else if (n.shot) {",
	"    var im = sel('image', g);",
	"    im.setAttribute('x', p.x + 4); im.setAttribute('y', p.y + NODE_H + 4);",
	"    im.setAttribute('width', COL_W - 8); im.setAttribute('height', PREVIEW_H - 10);",
	"    im.setAttribute('preserveAspectRatio', 'xMidYMin meet');",
	"    im.setAttribute('href', n.shot);",
	"   }",
	"  });",
	" });",
	" return svg;",
	"}",
	"document.getElementById('meta').textContent = DATA.meta.join(' · ');",
	"var app = document.getElementById('app');",
	"DATA.sections.forEach(function (sec) {",
	" var d = el('details', app);",
	" if (sec.open) d.setAttribute('open', '');",
	" var s = el('summary', d);",
	" txt(s, sec.title + (sec.columns.length ? ' · ' + sec.columns.length + ' columnas' : ''));",
	" if (sec.columns.length) {",
	"  var wrap = el('div', d); wrap.className = 'graph-wrap'; wrap.appendChild(graph(sec));",
	" }",
	" (sec.notes || []).forEach(function (nt) { txt(el('div', d), nt).className = 'note'; });",
	"});",
	"var foot = document.getElementById('foot');",
	"(DATA.notes || []).forEach(function (nt) { var f = el('div', foot); f.className = 'note'; txt(f, nt); });",
].join("\n");

/** Ensambla el HTML autónomo. Resuelve los shots faltantes vía opts (los
 *  cacheados viajan tal cual); nunca muta el payload recibido. */
export function buildExportHtml(
	payload: PmExportPayload,
	opts: ExportHtmlOpts = {},
): string {
	const sections: PmExportSection[] = payload.sections.map((sec) => ({
		...sec,
		columns: sec.columns.map((col) => ({
			...col,
			nodes: col.nodes.map((n) => ({
				...n,
				shot:
					n.shot === undefined
						? n.screenId === undefined
							? undefined
							: (opts.resolveShot?.(n.screenId) ?? "")
						: n.shot,
			})),
		})),
	}));
	const resolved: PmExportPayload = { ...payload, sections };
	const dataJson = JSON.stringify(resolved).split("</").join("<\\/");
	const html: string[] = [];
	html.push("<!DOCTYPE html>");
	html.push('<html lang="es"><head><meta charset="utf-8">');
	html.push(
		"<title>" + escHtml(payload.title) + " · Frida — Mapa del proyecto</title>",
	);
	html.push("<style>");
	html.push(
		"body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#0f1117;color:#e6e8ee}",
	);
	html.push(
		"header{padding:24px 32px;background:linear-gradient(135deg,#1b2340,#0f1117)}",
	);
	html.push(
		"h1{margin:0 0 4px;font-size:22px}header p{margin:0;color:#9aa3b5;font-size:13px}",
	);
	html.push("main{padding:8px 32px 24px}footer{padding:0 32px 32px}");
	html.push(
		"details{background:#161a26;border:1px solid #232a3d;border-radius:10px;margin:10px 0;overflow:hidden}",
	);
	html.push(
		"summary{padding:10px 14px;cursor:pointer;font-weight:600;font-size:14px;color:#e6e8ee}",
	);
	html.push(".graph-wrap{overflow:auto;border-top:1px solid #232a3d}");
	html.push("svg{display:block;min-width:100%}");
	html.push(".edge{fill:none;stroke:#4daafc;stroke-width:1.4}");
	html.push(".arrow{fill:#4daafc}");
	html.push(".node-box{fill:#161a26;stroke:#3a4260}");
	html.push(".node-box.danger{stroke:#f85149}");
	html.push(
		".node-id{font-size:9px;font-weight:700;fill:#9aa3b5;font-family:ui-monospace,monospace}",
	);
	html.push(".node-title{font-size:10.5px;fill:#e6e8ee}");
	html.push(".col-title{font-size:10px;font-weight:600;fill:#9aa3b5}");
	html.push(".shot-missing{fill:rgba(127,127,127,0.06);stroke:#3a4260}");
	html.push(".shot-label{font-size:9px;fill:#9aa3b5}");
	html.push(
		".note{color:#9aa3b5;font-size:12px;padding:2px 14px;overflow-wrap:anywhere}",
	);
	html.push("footer .note{padding:2px 0}");
	html.push("</style></head><body>");
	html.push(
		"<header><h1>" + escHtml(payload.title) + '</h1><p id="meta"></p></header>',
	);
	html.push('<main id="app"></main>');
	html.push('<footer id="foot"><div class="note" id="gen"></div></footer>');
	html.push("<script>var DATA = " + dataJson + ";");
	html.push(JS_RENDERER);
	html.push(
		"document.getElementById('gen').textContent = 'generado ' + DATA.generatedAt + ' · Frida';",
	);
	html.push("</script></body></html>");
	return html.join("\n");
}
