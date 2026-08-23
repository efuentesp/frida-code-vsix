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
								node({ id: "leaf", parentId: "a2", kind: "assistant", text: "Listo", hasText: true }),
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
		expect(html).toContain("codicon-copilot");
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
