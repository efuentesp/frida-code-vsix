// TTSR (#201): guards anti-bucle del manager — estado puro con clock inyectable.
import { describe, expect, it } from "vitest";
import { BUILTIN_TTSR_RULES } from "../../src/ttsr/rules";
import { createTtsrManager } from "../../src/ttsr/manager";
import type { TtsrRule } from "../../src/ttsr/rules";

const esMx = BUILTIN_TTSR_RULES.find((r) => r.id === "es-mx") as TtsrRule;
const refs = BUILTIN_TTSR_RULES.find(
	(r) => r.id === "refs-not-closes",
) as TtsrRule;
const ui = BUILTIN_TTSR_RULES.find(
	(r) => r.id === "vscode-tokens-ui",
) as TtsrRule;

const violation = (ruleId: string) => ({
	ruleId,
	scope: "text" as const,
	pattern: "test",
	fragment: "test",
});

describe("TTSR manager: guards anti-bucle", () => {
	it("sin intervención previa, una violación pasa", () => {
		const m = createTtsrManager({ now: () => 1_000 });
		expect(m.shouldIntervene(esMx, violation("es-mx"))).toBe(true);
	});

	it("intervening: tras disparar, TODO se ignora hasta el agent_start siguiente", () => {
		const m = createTtsrManager({ now: () => 1_000 });
		m.onIntervention(esMx);
		expect(m.isIntervening()).toBe(true);
		// Deltas del stream moribundo (u otra regla): bloqueados.
		expect(m.shouldIntervene(refs, violation("refs-not-closes"))).toBe(false);
		m.onAgentStart(); // el reintento (steer→continue) arrancó
		expect(m.isIntervening()).toBe(false);
		expect(m.shouldIntervene(refs, violation("refs-not-closes"))).toBe(true);
	});

	it("maxPerChain por defecto: 2 para cooldown, 1 para once", () => {
		const m = createTtsrManager({ now: () => 1_000 });
		m.onIntervention(esMx); // 1
		m.onAgentStart();
		expect(m.shouldIntervene(esMx, violation("es-mx"))).toBe(false); // cooldown 30s
		const m2 = createTtsrManager({ now: (t = 0) => t });
		// es-mx es cooldown: tras cooldown puede una 2ª, jamás una 3ª.
		let t = 1_000;
		const clock = () => t;
		const m3 = createTtsrManager({ now: clock });
		m3.onIntervention(esMx);
		m3.onAgentStart();
		t += 31_000; // cooldown vencido
		expect(m3.shouldIntervene(esMx, violation("es-mx"))).toBe(true);
		m3.onIntervention(esMx); // 2
		m3.onAgentStart();
		t += 31_000;
		expect(m3.shouldIntervene(esMx, violation("es-mx"))).toBe(false); // tope 2
		// once (vscode-tokens-ui): sólo 1 por cadena.
		const m4 = createTtsrManager({ now: clock });
		m4.onIntervention(ui);
		m4.onAgentStart();
		t += 60_000;
		expect(m4.shouldIntervene(ui, violation("vscode-tokens-ui"))).toBe(false);
		void m2;
	});

	it("cooldown: antes del cooldownMs NO re-interviene", () => {
		let t = 1_000;
		const m = createTtsrManager({ now: () => t });
		m.onIntervention(esMx);
		m.onAgentStart();
		t += 5_000; // < 30s
		expect(m.shouldIntervene(esMx, violation("es-mx"))).toBe(false);
	});

	it("tope duro por cadena: corta cascadas de varias reglas (max 4)", () => {
		let t = 1_000;
		const m = createTtsrManager({ now: () => t });
		m.onIntervention(esMx); // 1
		m.onAgentStart();
		t += 31_000;
		m.onIntervention(esMx); // 2
		m.onAgentStart();
		t += 31_000;
		m.onIntervention(refs); // 3
		m.onAgentStart();
		t += 31_000;
		m.onIntervention(ui); // 4 — tope total
		m.onAgentStart();
		t += 31_000;
		expect(m.shouldIntervene(esMx, violation("es-mx"))).toBe(false); // total=4
		expect(m.shouldIntervene(ui, violation("vscode-tokens-ui"))).toBe(false);
	});

	it("prompt nuevo del usuario resetea la cadena completa", () => {
		const t = 1_000;
		const m = createTtsrManager({ now: () => t });
		m.onIntervention(esMx);
		m.onIntervention(esMx); // tope de la regla
		m.onUserPrompt(); // nueva cadena
		expect(m.shouldIntervene(esMx, violation("es-mx"))).toBe(true);
		expect(m.snapshot().total).toBe(0);
	});

	it("snapshot: contadores por regla para diagnóstico", () => {
		const m = createTtsrManager({ now: () => 1_000 });
		m.onIntervention(esMx);
		m.onIntervention(refs);
		expect(m.snapshot().byRule).toEqual({ "es-mx": 1, "refs-not-closes": 1 });
		expect(m.snapshot().total).toBe(2);
	});
});
