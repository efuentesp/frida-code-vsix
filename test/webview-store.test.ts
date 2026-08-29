// Contrato del provider error en el webview (petición del usuario):
// los errores NO desaparecen solos — el usuario debe cerrarlos para
// alcanzar a leerlos/copiarlos. Antes, el banner del footer se auto-limpiaba
// con el primer delta del reintento (o el siguiente mensaje) y el mensaje
// desaparecía antes de poder copiarlo.
//
//   • provider_error → providerError persiste.
//   • delta / turn_active / user NO limpian providerError (antes sí).
//   • clear_provider_error (botón X del banner) → limpia.
//   • cleared (reset de conversación) → limpia (acción explícita).
//   • info con level "error" → toast level error (InfoToast NO se
//     auto-cierra para error — contrato types.ts ToastLevel).

import { describe, expect, it } from "vitest";
import { initialState, reduce } from "../webview/store";
import type { InMessage } from "../webview/types";

const asUser = (text: string): InMessage => ({ type: "user", text });

describe("webview store · providerError persistente (cierre manual)", () => {
	it("provider_error setea providerError", () => {
		const s = reduce(initialState, {
			type: "provider_error",
			text: "DevEngine rechazó el mensaje…",
		});
		expect(s.providerError).toContain("DevEngine");
	});

	it("delta (llega la respuesta del reintento) NO limpia el error", () => {
		let s = reduce(initialState, { type: "provider_error", text: "E1" });
		s = reduce(s, { type: "delta", text: "respuesta tardía" });
		expect(s.providerError).toBe("E1");
	});

	it("turn_active NO limpia el error", () => {
		let s = reduce(initialState, { type: "provider_error", text: "E1" });
		s = reduce(s, { type: "turn_active" });
		expect(s.providerError).toBe("E1");
	});

	it("user (siguiente mensaje) NO limpia el error", () => {
		let s = reduce(initialState, { type: "provider_error", text: "E1" });
		s = reduce(s, asUser("siguiente mensaje"));
		expect(s.providerError).toBe("E1");
	});

	it("clear_provider_error (botón X) limpia el error", () => {
		let s = reduce(initialState, { type: "provider_error", text: "E1" });
		s = reduce(s, { type: "clear_provider_error" });
		expect(s.providerError).toBeUndefined();
	});

	it("cleared (reset de conversación) también limpia", () => {
		let s = reduce(initialState, { type: "provider_error", text: "E1" });
		s = reduce(s, { type: "cleared" });
		expect(s.providerError).toBeUndefined();
	});
});

describe("webview store · toast info conserva el level", () => {
	it("info sin level → default info (toast efímero 4.5s)", () => {
		const s = reduce(initialState, { type: "info", text: "listo" });
		expect(s.info?.level).toBe("info");
	});

	it("info con level error → level error (InfoToast NO se auto-cierra)", () => {
		const s = reduce(initialState, {
			type: "info",
			text: "goal falló",
			level: "error",
		});
		expect(s.info?.level).toBe("error");
	});
});

// /tree (#126) + /fork: regresión del dispatch — App.tsx despacha estos
// mensajes al reducer (además de abrir el flag local). Si el handler vuelve
// a hacer `return` antes de dispatch(msg), state.treeData/forkPoints queda
// undefined y el panel nunca renderiza (bug reportado: "/tree no aparece").
describe("webview store · tree_data y fork_points llegan al reducer", () => {
	it("tree_data llena state.treeData (condición de render del TreePanel)", () => {
		const s = reduce(initialState, {
			type: "tree_data",
			nodes: [
				{
					id: "n1",
					parentId: null,
					timestamp: "t",
					kind: "user",
					text: "hola",
					children: [],
				},
			],
			leafId: "n1",
			sessionName: "S",
		});
		expect(s.treeData?.nodes).toHaveLength(1);
		expect(s.treeData?.leafId).toBe("n1");
		expect(s.treeData?.sessionName).toBe("S");
	});

	it("fork_points llena state.forkPoints (condición de render del ForkPanel)", () => {
		const s = reduce(initialState, {
			type: "fork_points",
			points: [{ entryId: "e1", text: "mensaje" }],
		});
		expect(s.forkPoints).toHaveLength(1);
	});
});

// M2 (#143): project_map_state llena state.projectMap (condición de render
// del ProjectMapTab) — el mensaje DEBE caer al dispatch general (#126).
describe("webview store · project_map_state/project_map_shot llegan al reducer", () => {
	it("project_map_state llena state.projectMap", () => {
		const s = reduce(initialState, {
			type: "project_map_state",
			state: {
				functional: {
					status: "empty",
					reason: "missing",
					hint: "sin docs/funcional",
				},
				busy: null,
			},
		});
		expect(s.projectMap?.functional?.status).toBe("empty");
		expect(s.projectMap?.functional).toMatchObject({
			reason: "missing",
		});
	});
});
