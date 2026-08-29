import { Fragment, useRef } from "react";

// M2 (#143) — renderer SVG compartido de las vistas del tab Mapa: columnas
// fijas (~140 px) + nodos apilados + aristas bezier + scroll bidireccional en
// un contenedor overflow:auto. Presentacional y determinista, sin deps de
// grafo (decisión de design; precedentes SVG manuales DonutChart.tsx:22-53 /
// FridaRobotIcon.tsx:21). Colapso: las columnas cerradas NO llegan aquí (render
// condicional del consumidor, molde TreePanel.visibleIds) — nunca CSS hide.
// La Fase 3 (vista Técnica) reutiliza este canvas: columnas = subsystems con
// title, nodos apilados por fila, tone:"danger" en riskHotspots.
// Nota del slice-verifier: Fragment importado NOMBRADO (jsx: "react-jsx",
// molde App.tsx:2,561) — nunca React.Fragment sin import (TS2686).

export interface GraphNode {
	id: string;
	title: string;
	/** data-URI del screenshot (preview bajo el nodo). "" = respondido sin captura. */
	preview?: string;
	/** Preview pedido y aún sin respuesta (placeholder punteado). */
	previewPending?: boolean;
	/** danger = borde rojo (overlay de riesgo de la Fase 3). */
	tone?: "default" | "danger";
}

export interface GraphEdge {
	from: string;
	to: string;
	/** Tooltip del path (hover nativo SVG <title>). */
	label?: string;
}

export interface GraphColumn {
	id: string;
	/** Título sobre la columna (se omite si vacío — vista Funcional). */
	title?: string;
	nodes: GraphNode[];
}

const COL_W = 140;
const GAP_X = 26;
const NODE_H = 36;
const PREVIEW_H = 66;
const GAP_Y = 26;
const PAD = 10;

function clip(t: string, max: number): string {
	return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

interface Placed {
	x: number;
	y: number;
	h: number;
}

/** Layout determinista: x por columna, y acumulado por nodo (el preview
 *  alarga el nodo; el título de columna baja el arranque). Los ids de nodo
 *  deben ser ÚNICOS en el canvas. */
function layout(columns: GraphColumn[]): {
	placed: Map<string, Placed>;
	w: number;
	h: number;
} {
	const placed = new Map<string, Placed>();
	let maxY = PAD;
	columns.forEach((col, ci) => {
		let y = PAD + (col.title ? 26 : 14);
		col.nodes.forEach((n) => {
			const h =
				NODE_H + (n.preview !== undefined || n.previewPending ? PREVIEW_H : 0);
			placed.set(n.id, { x: PAD + ci * (COL_W + GAP_X), y, h });
			y += h + GAP_Y;
		});
		maxY = Math.max(maxY, y - GAP_Y);
	});
	const w = Math.max(PAD * 2 + columns.length * (COL_W + GAP_X) - GAP_X, 160);
	return { placed, w, h: Math.max(maxY + PAD, 110) };
}

/** Navegación por teclado (NFR a11y): ↑↓ mueve el foco entre nodos en orden
 *  DOM (columnas de izquierda a derecha, nodos de arriba abajo); Tab lo da el
 *  navegador vía tabIndex; Enter/Espacio activa el nodo enfocado. */
export function GraphCanvas({
	columns,
	edges,
	onNodeClick,
	ariaLabel = "Grafo del mapa",
}: {
	columns: GraphColumn[];
	/** Aristas globales del canvas (from/to = node ids únicos). */
	edges: GraphEdge[];
	onNodeClick?: (nodeId: string) => void;
	ariaLabel?: string;
}) {
	const wrapRef = useRef<HTMLDivElement>(null);
	const { placed, w, h } = layout(columns);

	const focusSibling = (id: string, delta: number): void => {
		const root = wrapRef.current;
		if (!root) return;
		const nodes = Array.from(root.querySelectorAll<SVGGElement>(".pm-node"));
		const idx = nodes.findIndex((n) => n.dataset.nodeId === id);
		nodes[idx + delta]?.focus();
	};

	return (
		<div className="pm-canvas" ref={wrapRef}>
			<svg
				className="pm-graph"
				width={w}
				height={h}
				viewBox={`0 0 ${w} ${h}`}
				role="group"
				aria-label={ariaLabel}
			>
				<defs>
					<marker
						id="pm-arrow"
						viewBox="0 0 8 8"
						refX={7}
						refY={4}
						markerWidth={6}
						markerHeight={6}
						orient="auto-start-reverse"
					>
						<path d="M 0 0 L 8 4 L 0 8 z" className="pm-arrow" />
					</marker>
				</defs>
				{edges.map((e, ei) => {
					const a = placed.get(e.from);
					const b = placed.get(e.to);
					if (!a || !b) return null;
					const lane = ((ei % 4) - 1.5) * 7; // separa aristas paralelas
					const sameCol = a.x === b.x;
					const x1 = sameCol ? a.x + COL_W / 2 : a.x + COL_W;
					const y1 = sameCol ? a.y + a.h : a.y + NODE_H / 2 + lane;
					const x2 = sameCol ? b.x + COL_W / 2 : b.x;
					const y2 = sameCol ? b.y : b.y + NODE_H / 2 + lane;
					const sag = sameCol
						? Math.max((y2 - y1) / 2, 14)
						: Math.max(Math.abs(x2 - x1) * 0.45, 18);
					const c1x = sameCol ? x1 : x1 + sag;
					const c1y = sameCol ? y1 + sag : y1;
					const c2x = sameCol ? x2 : x2 - sag;
					const c2y = sameCol ? y2 - sag : y2;
					return (
						<path
							key={ei}
							className="pm-edge"
							d={`M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`}
							markerEnd="url(#pm-arrow)"
						>
							<title>{e.label ?? `${e.from} → ${e.to}`}</title>
						</path>
					);
				})}
				{columns.map((col, ci) => (
					<Fragment key={col.id}>
						{col.title && (
							<text
								x={PAD + ci * (COL_W + GAP_X)}
								y={PAD + 12}
								className="pm-col-title"
							>
								{clip(col.title, 18)}
							</text>
						)}
						{col.nodes.map((n) => {
							const p = placed.get(n.id);
							if (!p) return null;
							const clickable = !!onNodeClick;
							return (
								<g
									key={n.id}
									className={"pm-node" + (clickable ? " is-clickable" : "")}
									data-node-id={n.id}
									tabIndex={clickable ? 0 : -1}
									role={clickable ? "button" : undefined}
									aria-label={`${n.id} ${n.title}`}
									onClick={clickable ? () => onNodeClick!(n.id) : undefined}
									onKeyDown={
										clickable
											? (ev) => {
													if (ev.key === "Enter" || ev.key === " ") {
														ev.preventDefault();
														onNodeClick!(n.id);
													} else if (ev.key === "ArrowDown") {
														ev.preventDefault();
														focusSibling(n.id, 1);
													} else if (ev.key === "ArrowUp") {
														ev.preventDefault();
														focusSibling(n.id, -1);
													}
												}
											: undefined
									}
								>
									<rect
										x={p.x}
										y={p.y}
										width={COL_W}
										height={NODE_H}
										rx={6}
										className={"pm-node-box" + (n.tone === "danger" ? " is-danger" : "")}
									/>
									<text x={p.x + 6} y={p.y + 13} className="pm-node-id">
										{n.id}
									</text>
									<text x={p.x + 6} y={p.y + 26} className="pm-node-title">
										{clip(n.title, 20)}
									</text>
									{n.previewPending && (
										<g>
											<rect
												x={p.x + 4}
												y={p.y + NODE_H + 4}
												width={COL_W - 8}
												height={PREVIEW_H - 10}
												rx={4}
												className="pm-shot-pending"
											/>
											<text
												x={p.x + COL_W / 2}
												y={p.y + NODE_H + PREVIEW_H / 2}
												className="pm-shot-label"
												textAnchor="middle"
											>
												capturando…
											</text>
										</g>
									)}
									{!n.previewPending && n.preview === "" && (
										<g>
											<rect
												x={p.x + 4}
												y={p.y + NODE_H + 4}
												width={COL_W - 8}
												height={PREVIEW_H - 10}
												rx={4}
												className="pm-shot-missing"
											/>
											<text
												x={p.x + COL_W / 2}
												y={p.y + NODE_H + PREVIEW_H / 2}
												className="pm-shot-label"
												textAnchor="middle"
											>
												sin captura
											</text>
										</g>
									)}
									{!n.previewPending && n.preview && (
										<image
											x={p.x + 4}
											y={p.y + NODE_H + 4}
											width={COL_W - 8}
											height={PREVIEW_H - 10}
											preserveAspectRatio="xMidYMin meet"
											href={n.preview}
											className="pm-shot"
										/>
									)}
								</g>
							);
						})}
					</Fragment>
				))}
			</svg>
		</div>
	);
}
