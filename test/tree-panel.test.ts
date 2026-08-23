import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TreePanel } from "../webview/components/TreePanel";
import type { TreeData, TreeEntryNode } from "../webview/types";

// /tree (#126): render del overlay del árbol de sesión. La interacción de
// teclado se prueba a nivel de lógica (filtros/plegado) en los specs de
// utilidades; aquí validamos el markup estático que produce el panel.

function node(partial: Partial<TreeEntryNode>): TreeEntryNode {
	return {
		id: "n0",
		parentId: null,
		timestamp: "2026-02-10T12:04:00.000Z",
		kind: "user",
		text: "entrada",
		children: [],
		...partial,
	};
}

const data: TreeData = {
	sessionName: "Refactor SQL",
	leafId: "leaf",
	nodes: [
		node({
			id: "root",
			kind: "user",
			text: "¿Cómo optimizo esta consulta SQL?",
			children: [
				node({
					id: "wiki1",
					parentId: "root",
					kind: "customMessage",
					text: "⟨wiki-recall-context⟩ ## Relevant Wiki",
					display: false,
					children: [],
				}),
				node({
					id: "a1",
					parentId: "root",
					kind: "assistant",
					text: "Utiliza índices…",
					hasText: true,
					children: [
						node({
							id: "a2",
							parentId: "a1",
							kind: "user",
							text: "Probemos el enfoque A",
							label: "refactor",
							children: [
								node({
									id: "leaf",
									parentId: "a2",
									kind: "assistant",
									text: "Listo",
									hasText: true,
								}),
							],
						}),
						node({
							id: "b2",
							parentId: "a1",
							kind: "user",
							text: "Mejor el enfoque B",
							children: [],
						}),
					],
				}),
			],
		}),
	],
};

function render(props?: Partial<Parameters<typeof TreePanel>[0]>) {
	const onClose = vi.fn();
	const onNavigate = vi.fn();
	const onLabel = vi.fn();
	const html = renderToStaticMarkup(
		React.createElement(TreePanel, {
			data,
			onClose,
			onNavigate,
			onLabel,
			...props,
		}),
	);
	return { html, onClose, onNavigate, onLabel };
}

describe("TreePanel (/tree, #126)", () => {
	it("renderiza título, subtítulo de disambiguación y hint de /fork", () => {
		const { html } = render();
		expect(html).toContain("Árbol de sesión");
		expect(html).toContain("Refactor SQL");
		expect(html).toContain("las ramas");
		expect(html).toContain("/fork");
	});

	it("renderiza las filas del árbol con iconos de tipo y badge de etiqueta", () => {
		const { html } = render();
		expect(html).toContain("¿Cómo optimizo esta consulta SQL?");
		expect(html).toContain("Utiliza índices…");
		expect(html).toContain("Mejor el enfoque B");
		expect(html).toContain("codicon-account");
		// Asistente = robot oficial de Frida (paridad Turn.tsx), no copilot.
		expect(html).toContain("frida-robot-icon");
		expect(html).not.toContain("codicon-copilot");
		expect(html).toContain("refactor");
	});

	it("marca la hoja activa y aplica atenuación a ramas fuera de la ruta", () => {
		const { html } = render();
		expect(html).toContain("is-leaf");
		expect(html).toContain("tree-leaf-dot");
		// La rama hermana (enfoque B) queda fuera de la ruta activa.
		const idxB = html.indexOf("Mejor el enfoque B");
		const rowStart = html.lastIndexOf('class="tree-row', idxB);
		expect(html.slice(rowStart, rowStart + 80)).toContain("off-path");
	});

	it("muestra chips de filtro y el buscador", () => {
		const { html } = render();
		expect(html).toContain("Conversación");
		expect(html).toContain("Sólo etiquetadas");
		expect(html).toContain("Buscar en el árbol");
	});
});

// Regresión #126 ("los tabs de filtro no hacen diferencia"): en una sesión
// lineal, forzar la visibilidad de ancestros re-mostraba TODO bajo cualquier
// filtro. passesFilter debe ocultar custom_message internas (display:false)
// en Conversación, y "Sólo usuario" debe dejar únicamente mensajes de usuario.
import { passesFilter } from "../webview/components/TreePanel";

describe("passesFilter — paridad applyFilter de Pi (#126)", () => {
	it("Conversación (default) oculta custom_message internas y bookkeeping", () => {
		const wiki = node({
			id: "w1",
			kind: "customMessage",
			text: "⟨wiki-recall-context⟩ …",
			display: false,
		});
		const model = node({ id: "m1", kind: "modelChange", text: "p/m" });
		const user = node({ id: "u1", kind: "user", text: "hola" });
		expect(passesFilter(wiki, "default", false)).toBe(false);
		expect(passesFilter(model, "default", false)).toBe(false);
		expect(passesFilter(user, "default", false)).toBe(true);
	});

	it("custom_message con display:true también se oculta en Conversación (es material interno)", () => {
		const notice = node({
			id: "w2",
			kind: "customMessage",
			text: "⟨wiki-session-notice⟩ 🧠 …",
			display: true,
		});
		expect(passesFilter(notice, "default", false)).toBe(false);
		expect(passesFilter(notice, "all", false)).toBe(true);
	});

	it("Sólo usuario deja únicamente kind=user", () => {
		expect(
			passesFilter(node({ id: "a", kind: "user" }), "user-only", false),
		).toBe(true);
		expect(
			passesFilter(
				node({ id: "b", kind: "assistant", hasText: true }),
				"user-only",
				false,
			),
		).toBe(false);
		expect(
			passesFilter(
				node({ id: "c", kind: "customMessage", display: true }),
				"user-only",
				false,
			),
		).toBe(false);
	});

	it("asistente sin texto se oculta en default (errores incluidos, van en Todo); hoja efectiva visible", () => {
		const mudo = node({ id: "s1", kind: "assistant", text: "", hasText: false });
		const error = node({
			id: "s2",
			kind: "assistant",
			text: "",
			hasText: false,
			stopReason: "error",
		});
		expect(passesFilter(mudo, "default", false)).toBe(false);
		expect(passesFilter(error, "default", false)).toBe(false);
		expect(passesFilter(error, "all", false)).toBe(true);
		expect(passesFilter(mudo, "default", true)).toBe(true); // hoja siempre visible
	});

	it("Todo muestra todo", () => {
		expect(
			passesFilter(
				node({ id: "x", kind: "customMessage", display: false }),
				"all",
				false,
			),
		).toBe(true);
		expect(
			passesFilter(node({ id: "y", kind: "modelChange" }), "all", false),
		).toBe(true);
	});
});

// Regresión #126 ("escalera + | previos al filtrar"): la profundidad de cada
// fila debe renormalizarse sobre los ancestros VISIBLES, no conservar la
// profundidad estructural cuando el filtro oculta intermedios (wiki/etc.).
// Verificamos que el paddingLeft de cada fila visible en "Conversación" es
// exactamente 6 + (posición en la lista visible) × 2 — escalera lineal limpia,
// sin saltos por nodos ocultos — y que no hay contenedores tree-children vacíos.
describe("TreePanel · profundidad visual renormalizada al filtrar (#126)", () => {
	it("cada fila visible incrementa su indent en 1 nivel (sin huecos de ocultos)", () => {
		// Cadena real con intermedios ocultos: user → wiki → asst → wiki → user.
		const chained: TreeData = {
			leafId: "u2",
			nodes: [
				node({
					id: "u1",
					kind: "user",
					text: "pregunta 1",
					children: [
						node({
							id: "w1",
							parentId: "u1",
							kind: "customMessage",
							text: "⟨wiki⟩",
							display: false,
							children: [
								node({
									id: "a1",
									parentId: "w1",
									kind: "assistant",
									text: "respuesta 1",
									hasText: true,
									children: [
										node({
											id: "w2",
											parentId: "a1",
											kind: "customMessage",
											text: "⟨wiki⟩",
											display: false,
											children: [
												node({
													id: "u2",
													parentId: "w2",
													kind: "user",
													text: "pregunta 2",
													children: [],
												}),
											],
										}),
									],
								}),
							],
						}),
					],
				}),
			],
		};
		const { html } = renderTree(chained);
		// u1=depth0(6px), a1=depth1(8px), u2=depth2(10px) — los wiki ocultos NO
		// suman niveles. Antes: a1 quedaba en depth2(10px) y u2 en depth4(14px).
		// React serializa paddingLeft numérico sin espacio: "padding-left:6px".
		// u1=6px → a1=8px → u2=10px: escalera lineal; los wiki ocultos NO suman.
		expect(html).toContain('style="padding-left:6px"');
		expect(html).toContain('style="padding-left:8px"');
		expect(html).toContain('style="padding-left:10px"');
		expect(html).not.toContain("padding-left:12px");
		expect(html).not.toContain("padding-left:14px");
	});
});

function renderTree(d: TreeData) {
	const html = renderToStaticMarkup(
		React.createElement(TreePanel, {
			data: d,
			onClose: vi.fn(),
			onNavigate: vi.fn(),
			onLabel: vi.fn(),
		}),
	);
	return { html };
}

// Regresión #126 ("ya no muestra nada en Conversación, solo en Todo"): la raíz
// ESTRUCTURAL del árbol real suele ser bookkeeping (model_change → thinking →
// custom_message de arranque). Si el filtro la oculta, el primer mensaje de
// usuario queda sin ancestro visible → debe emerger como RAÍZ VISUAL (depth 0),
// no desaparecer. El fixture replica la sesión real reportada.
describe("TreePanel · raíz estructural oculta (emergencia a raíz visual)", () => {
	it("Conversación renderiza el primer mensaje aunque toda su cadena de ancestros esté oculta", () => {
		const session: TreeData = {
			leafId: "a1",
			nodes: [
				node({
					id: "mc",
					kind: "modelChange",
					text: "github-copilot/kimi-k3",
					children: [
						node({
							id: "th",
							parentId: "mc",
							kind: "thinking",
							text: "medium",
							children: [
								node({
									id: "pi",
									parentId: "th",
									kind: "customMessage",
									text: "⟨frida-pipeline-index⟩ …",
									display: false,
									children: [
										node({
											id: "u1",
											parentId: "pi",
											kind: "user",
											text: "Explícame en una frase qué es un índice compuesto en SQL",
											children: [
												node({
													id: "w1",
													parentId: "u1",
													kind: "customMessage",
													text: "⟨wiki-recall-context⟩ …",
													display: false,
													children: [
														node({
															id: "a1",
															parentId: "w1",
															kind: "assistant",
															text: "Un índice compuesto…",
															hasText: true,
														}),
													],
												}),
											],
										}),
									],
								}),
							],
						}),
					],
				}),
			],
		};
		const { html } = renderTree(session);
		// El mensaje de usuario emerge a raíz visual (6px) y la respuesta queda
		// a un nivel (8px): nada de la cadena oculta previa aparece ni desplaza.
		expect(html).toContain("Explícame en una frase qué es un índice compuesto");
		expect(html).toContain("Un índice compuesto…");
		expect(html).toContain('style="padding-left:6px"');
		expect(html).toContain('style="padding-left:8px"');
		expect(html).not.toContain("padding-left:10px");
		expect(html).not.toContain("padding-left:12px");
		expect(html).not.toContain("kimi-k3"); // bookkeeping oculto en Conversación
		expect(html).not.toContain("⟨wiki-recall-context⟩");
	});
});
