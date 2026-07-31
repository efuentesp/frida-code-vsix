// frida-pipeline — tests del pipeline pointer (índice de skills).
//
// Verifica el gate de Fase 4 (ADR-0021):
//   - PIPELINE_POINTER contiene el índice de stages en español.
//   - injectPipelinePointer envía el mensaje con customType correcto.
//   - display respeta --frida-debug.
//   - El contenido incluye las stages en orden y la advertencia de no-task.

import { describe, it, expect } from "vitest";
import {
	PIPELINE_POINTER,
	injectPipelinePointer,
} from "../../src/tools/frida-pipeline/pipeline-pointer";
import {
	MSG_TYPE_PIPELINE_INDEX,
	FLAG_DEBUG,
} from "../../src/tools/frida-pipeline/constants";

/** Mock de ExtensionAPI que captura sendMessage y getFlag. */
function mockPi(debug: boolean): {
	pi: {
		sendMessage: (m: unknown) => void;
		getFlag: (n: string) => boolean | string | undefined;
	};
	calls: Array<{ customType: string; content: string; display: boolean }>;
} {
	const calls: Array<{
		customType: string;
		content: string;
		display: boolean;
	}> = [];
	return {
		pi: {
			sendMessage: (m: unknown): void => {
				const msg = m as {
					customType: string;
					content: string;
					display: boolean;
				};
				calls.push(msg);
			},
			getFlag: (name: string) => (name === FLAG_DEBUG ? debug : undefined),
		},
		calls,
	};
}

describe("frida-pipeline / pipeline-pointer / PIPELINE_POINTER", () => {
	it("declara que es material de referencia, NO una tarea", () => {
		expect(PIPELINE_POINTER).toContain("material de referencia, NO una tarea");
	});

	it("usa namespace frida (no rpiv)", () => {
		expect(PIPELINE_POINTER).toContain("frida pipeline index");
		expect(PIPELINE_POINTER).not.toContain("rpiv pipeline index");
	});

	it("lista las stages del pipeline en orden", () => {
		const stageOrder = [
			"/skill:discover",
			"/skill:research",
			"/skill:design",
			"/skill:plan",
			"/skill:implement",
			"/skill:validate",
		];
		// Verificar que aparecen en orden (cada uno después del anterior).
		let lastIdx = -1;
		for (const stage of stageOrder) {
			const idx = PIPELINE_POINTER.indexOf(stage);
			expect(idx).toBeGreaterThan(-1);
			expect(idx).toBeGreaterThan(lastIdx);
			lastIdx = idx;
		}
	});

	it("menciona /skill:explore como alternativa a design", () => {
		expect(PIPELINE_POINTER).toContain("/skill:explore");
	});

	it("menciona /skill:blueprint como alternativa a plan", () => {
		expect(PIPELINE_POINTER).toContain("/skill:blueprint");
	});

	it("lista los comandos explícitos adicionales", () => {
		expect(PIPELINE_POINTER).toContain("/skill:slice");
		expect(PIPELINE_POINTER).toContain("/skill:revise");
		expect(PIPELINE_POINTER).toContain("/skill:elaborate");
		expect(PIPELINE_POINTER).toContain("/skill:architecture-review");
		expect(PIPELINE_POINTER).toContain("/skill:frontend-design");
	});

	it("lista las unidades internas de workflow (never suggest)", () => {
		expect(PIPELINE_POINTER).toContain("amend");
		expect(PIPELINE_POINTER).toContain("design-slice");
		expect(PIPELINE_POINTER).toContain("design-review");
		expect(PIPELINE_POINTER).toContain("synthesize");
		expect(PIPELINE_POINTER).toContain("grade");
	});

	it("está en español de México", () => {
		expect(PIPELINE_POINTER).toContain("Stages del pipeline (en orden)");
		expect(PIPELINE_POINTER).toContain("nunca sugerir");
	});
});

describe("frida-pipeline / pipeline-pointer / injectPipelinePointer", () => {
	it("envía el mensaje con customType frida-pipeline-index", () => {
		const { pi, calls } = mockPi(false);
		injectPipelinePointer(pi as never);
		expect(calls).toHaveLength(1);
		expect(calls[0].customType).toBe(MSG_TYPE_PIPELINE_INDEX);
		expect(calls[0].customType).toBe("frida-pipeline-index");
	});

	it("display=false cuando --frida-debug está inactivo", () => {
		const { pi, calls } = mockPi(false);
		injectPipelinePointer(pi as never);
		expect(calls[0].display).toBe(false);
	});

	it("display=true cuando --frida-debug está activo", () => {
		const { pi, calls } = mockPi(true);
		injectPipelinePointer(pi as never);
		expect(calls[0].display).toBe(true);
	});

	it("el contenido del mensaje es PIPELINE_POINTER", () => {
		const { pi, calls } = mockPi(false);
		injectPipelinePointer(pi as never);
		expect(calls[0].content).toBe(PIPELINE_POINTER);
	});

	it("es idempotente: dos llamadas envían dos mensajes (stateless)", () => {
		// A diferencia de guidance (que dedup), el pointer es stateless: se
		// inyecta en cada session_start/session_compact sin tracking.
		const { pi, calls } = mockPi(false);
		injectPipelinePointer(pi as never);
		injectPipelinePointer(pi as never);
		expect(calls).toHaveLength(2);
	});
});
