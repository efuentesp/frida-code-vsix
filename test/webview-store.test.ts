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
