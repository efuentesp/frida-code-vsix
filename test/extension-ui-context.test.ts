/**
 * Contrato del ExtensionUIContext de Frida (ADR-0058): frida NO renderiza
 * TUI, por lo que `custom` NO debe definirse.
 *
 * Contexto (hallazgo e2e #21): pi-hermes-memory protege su modal TUI con
 * `if (!ctx.hasUI || typeof ctx.ui.custom !== "function")` → fallback a
 * lista de texto por notify. Un no-op `custom: async () => undefined`
 * (histórico "backstop de rpiv") se saltaba la guarda: la extensión no
 * mostraba texto NI modal — comando mudo. rpiv ya no lo necesita: enruta por
 * `ctx.mode === "rpc"` + hasDialogUI (dialog walker), camino que frida sí
 * provee.
 *
 * Este test evita regresiones: si alguien re-añade custom como no-op sin
 * implementarlo de verdad, falla aquí.
 */
import { describe, it, expect } from "vitest";
import { createFridaUiContext } from "../src/extension-ui-context";
import type {
	QuestionnaireBridge,
	WebQuestionnaireResult,
} from "../src/questionnaire-bridge";
import type { UiBridge } from "../src/ui-bridge";
import type { WebBridge } from "../src/web-bridge";

const fakeBridge = {
	request: async () => ({ cancelled: true, value: undefined }),
} as unknown as UiBridge;
const fakeWebBridge = {
	render: async () => undefined,
	mountPersistent: () => ({ unmount: () => {} }),
} as unknown as WebBridge;
const fakeQuestionnaire = {
	request: async (): Promise<WebQuestionnaireResult> => ({
		answers: [],
		cancelled: true,
	}),
} as unknown as QuestionnaireBridge;

describe("ExtensionUIContext de Frida — contrato sin TUI (ADR-0058)", () => {
	it("NO define ui.custom: las guardas upstream degradan a texto", () => {
		const ui = createFridaUiContext(
			fakeBridge,
			() => {},
			fakeWebBridge,
			fakeQuestionnaire,
		);
		// La guarda canónica de los upstreams (pi-hermes-memory skills-command):
		expect(typeof (ui as { custom?: unknown }).custom).not.toBe("function");
		expect((ui as { custom?: unknown }).custom).toBeUndefined();
	});

	it("implementa el sub-protocolo de diálogos (hasDialogUI de rpiv)", () => {
		const ui = createFridaUiContext(
			fakeBridge,
			() => {},
			fakeWebBridge,
			fakeQuestionnaire,
		);
		// rpiv-ask-user-question (issue #78) enruta por mode==='rpc' +
		// hasDialogUI: select e input presentes → dialog walker, sin custom.
		expect(typeof ui.select).toBe("function");
		expect(typeof ui.input).toBe("function");
	});

	it("fridaWeb sigue disponible: UI rica de extensión por Remote React", () => {
		const ui = createFridaUiContext(
			fakeBridge,
			() => {},
			fakeWebBridge,
			fakeQuestionnaire,
		) as unknown as { fridaWeb?: unknown; fridaWebMount?: unknown };
		expect(typeof ui.fridaWeb).toBe("function");
		expect(typeof ui.fridaWebMount).toBe("function");
	});
});
