// #91 (2ª parte): el agente del workflow respondió NULL — lastAssistantValue
// no encontró texto en los mensajes del hijo (evidencia E1: «expected object,
// got null / respuesta: null»). El extractor actual es frágil:
//   • sólo acepta bloques type:"text" (el gateway responses usa "output_text"
//     — Errata-13);
//   • mira SOLO el último mensaje assistant (un trailing vacío por auto-retry
//     o thinking-only esconde la respuesta real de un mensaje previo);
//   • cuando devuelve null, NADIE sabe por qué (ni el repair ni el throw).
// Contratos puros aquí; el spawner los usa.

import { describe, expect, it } from "vitest";
import {
	lastAssistantText,
	summarizeLastAssistant,
} from "../../src/tools/frida-extensible-workflows/frida-agent-execution";

const msgs = (arr: Array<Record<string, unknown>>) => arr;

describe("lastAssistantText (#91: texto resiliente del hijo)", () => {
	it("texto normal en el último assistant → se devuelve", () => {
		const m = msgs([
			{ role: "user", content: "q" },
			{ role: "assistant", content: [{ type: "text", text: '{"stories":[]}' }] },
		]);
		expect(lastAssistantText(m)).toBe('{"stories":[]}');
	});

	it("bloques output_text (gateway responses, Errata-13) TAMBIÉN cuentan como texto", () => {
		const m = msgs([
			{ role: "assistant", content: [{ type: "output_text", text: '{"stories":[]}' }] },
		]);
		expect(lastAssistantText(m)).toBe('{"stories":[]}');
	});

	it("último assistant thinking-only → retrocede al assistant ANTERIOR con texto (trailing por retry)", () => {
		const m = msgs([
			{ role: "user", content: "q" },
			{ role: "assistant", content: [{ type: "text", text: "resp real" }] },
			{ role: "assistant", stopReason: "error", content: [{ type: "thinking", thinking: "…" }] },
		]);
		expect(lastAssistantText(m)).toBe("resp real");
	});

	it("content string directo del assistant → se devuelve", () => {
		const m = msgs([{ role: "assistant", content: "texto plano" }]);
		expect(lastAssistantText(m)).toBe("texto plano");
	});

	it("sin NINGÚN texto (todo thinking-only) → null (el diagnóstico entra aparte)", () => {
		const m = msgs([
			{ role: "user", content: "q" },
			{ role: "assistant", stopReason: "stop", content: [{ type: "thinking", thinking: "razoné mucho" }] },
		]);
		expect(lastAssistantText(m)).toBeNull();
	});

	it("mensajes vacíos / sin assistant → null sin lanzar", () => {
		expect(lastAssistantText([])).toBeNull();
		expect(lastAssistantText(msgs([{ role: "user", content: "q" }]))).toBeNull();
		expect(lastAssistantText(undefined as unknown as [])).toBeNull();
	});
});

describe("summarizeLastAssistant (#91: diagnóstico del null)", () => {
	it("describe stopReason + tipos de bloque del último assistant", () => {
		const m = msgs([
			{ role: "assistant", stopReason: "stop", content: [{ type: "thinking", thinking: "x" }, { type: "text", text: "" }] },
		]);
		const d = summarizeLastAssistant(m);
		expect(d).toContain("stopReason=stop");
		expect(d).toContain("thinking");
	});
	it("sin assistant alguno → lo dice explícito", () => {
		expect(summarizeLastAssistant(msgs([{ role: "user", content: "q" }]))).toMatch(
			/sin mensajes assistant/,
		);
	});
	it("incluye un slice del thinking (pista de lo que el modelo razonó)", () => {
		const m = msgs([
			{ role: "assistant", stopReason: "stop", content: [{ type: "thinking", thinking: "las historias son E1-S1…" }] },
		]);
		expect(summarizeLastAssistant(m)).toContain("E1-S1");
	});
});
