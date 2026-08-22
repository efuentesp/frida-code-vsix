// Test foco (#66 → ajuste UI/UX del botón resincronizar): el panel de tareas
// debe pintar el botón de re-sincronización en el slot `actions` del
// CollapsiblePanel (justificado a la derecha, FUERA de la zona clicable del
// header) con icono `sync` y variante ghost — no incrustado tras el título.
//
// Estrategia: montar el elemento de Remote React en el host renderer
// (createWebRenderer) y serializar a WebNode (sin DOM), inspeccionando la
// estructura: el CollapsiblePanel coloca `actions` como último hijo del fbox
// header-row con justifyContent space-between.

import { describe, it, expect } from "vitest";
import React from "react";
import { createWebRenderer, type WebRenderer } from "../../src/web-renderer";
import type { WebNode } from "../../src/web-protocol";
import { createTodoWebPanelElement } from "../../src/tools/todo-web/todo-web";
import { resetTodoState, setTodoState } from "../../src/tools/todo-web/store";
import type { TaskState } from "../../src/tools/todo/state-reducer";

const stateOf = (
	...tasks: Partial<TaskState["tasks"][number]>[]
): TaskState => ({
	tasks: tasks.map((t, i) => ({
		id: t.id ?? i + 1,
		subject: t.subject ?? `tarea ${t.id ?? i + 1}`,
		status: t.status ?? "pending",
	})),
	nextId: (tasks.length ?? 0) + 1,
});

function mountPanelTree(onRefresh: () => void): {
	renderer: WebRenderer;
	tree: WebNode | null;
} {
	let tree: WebNode | null = null;
	const renderer = createWebRenderer(
		React.createElement(() => createTodoWebPanelElement({ onRefresh })),
		(t) => {
			tree = t;
		},
	);
	renderer.mount();
	return { renderer, tree: tree as WebNode | null };
}

function findNodes(
	node: WebNode | string | null,
	pred: (n: WebNode) => boolean,
	out: WebNode[] = [],
): WebNode[] {
	if (node === null || typeof node === "string") return out;
	if (pred(node)) out.push(node);
	for (const c of node.children) findNodes(c, pred, out);
	return out;
}

describe("todo-web · botón resincronizar en slot actions (#66 UI/UX)", () => {
	it("el WebNode del botón usa variante ghost + icono sync y está tras el header (justificado a la derecha por space-between)", () => {
		resetTodoState();
		setTodoState(
			stateOf(
				{ id: 1, subject: "Documentar ADR", status: "in_progress" },
				{ id: 2, subject: "Pruebas del resolver", status: "pending" },
			),
		);
		const { renderer, tree } = mountPanelTree(() => undefined);
		try {
			expect(tree).not.toBeNull();
			const buttons = findNodes(tree, (n) => n.type === "fbutton");
			expect(buttons.length).toBe(1);

			const btn = buttons[0]!;
			expect(btn.props.variant).toBe("ghost");
			expect(btn.props.title).toContain("Resincronizar");

			// El icono interno es `sync`.
			const icons = findNodes(btn, (n) => n.type === "ficon");
			expect(icons.length).toBe(1);
			expect(icons[0]!.props.name).toBe("sync");

			// El botón NO pertenece al fbox clicable del header (.panel-header).
			const header = findNodes(tree, (n) => n.props.cls === "panel-header");
			expect(header.length).toBe(1);
			const btnInsideHeader = findNodes(
				header[0]!,
				(n) => n.type === "fbutton",
			);
			expect(btnInsideHeader.length).toBe(0);

			// El padre del botón es el fbox con justifyContent space-between
			// (la fila header-row del CollapsiblePanel).
			const row = findNodes(
				tree,
				(n) =>
					n.type === "fbox" && n.props.justifyContent === "space-between",
			);
			expect(row.length).toBe(1);
			const btnInRow = findNodes(row[0]!, (n) => n.type === "fbutton");
			expect(btnInRow.length).toBe(1);
		} finally {
			renderer.unmount();
			resetTodoState();
		}
	});

	it("sin onRefresh no se renderiza ningún botón (slot actions vacío)", () => {
		resetTodoState();
		setTodoState(stateOf({ id: 1, subject: "única", status: "pending" }));
		const { renderer, tree } = mountPanelTree(() => undefined);
		try {
			// Sin onRefresh la factory no recibe callback → sin botón.
			let t: WebNode | null = null;
			const r = createWebRenderer(
				React.createElement(() => createTodoWebPanelElement()),
				(x) => {
					t = x;
				},
			);
			r.mount();
			const buttons = findNodes(t, (n) => n.type === "fbutton");
			expect(buttons.length).toBe(0);
			r.unmount();
			expect(tree).not.toBeNull();
		} finally {
			renderer.unmount();
			resetTodoState();
		}
	});
});
