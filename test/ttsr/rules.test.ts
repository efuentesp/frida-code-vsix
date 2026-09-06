// TTSR (#201): contrato de las reglas — modelo puro + builtins + matching.
import { describe, expect, it } from "vitest";
import {
	BUILTIN_TTSR_RULES,
	extractScopes,
	matchRule,
	type TtsrRule,
} from "../../src/ttsr/rules";

const byId = (id: string): TtsrRule => {
	const r = BUILTIN_TTSR_RULES.find((x) => x.id === id);
	if (!r) throw new Error(`regla builtin no encontrada: ${id}`);
	return r;
};

describe("TTSR rules: builtin es-mx", () => {
	const rule = byId("es-mx");
	it("matchea conjugaciones de España en texto", () => {
		expect(matchRule(rule, "text", "Como vosotros veis, el ordenador"))?.not
			.toBe(null);
		expect(matchRule(rule, "text", "si tenéis dudas"))?.not.toBe(null);
		expect(matchRule(rule, "text", "el vídeo está listo"))?.not.toBe(null);
	});
	it("NO matchea español de México", () => {
		expect(matchRule(rule, "text", "si tienes dudas, tú puedes preguntar")).toBe(
			null,
		);
		expect(matchRule(rule, "text", "el video está listo")).toBe(null);
		expect(matchRule(rule, "text", "la computadora")).toBe(null);
	});
	it("sólo inspecciona scope text (thinking/toolargs fuera)", () => {
		expect(matchRule(rule, "thinking", "vosotros")).toBe(null);
	});
});

describe("TTSR rules: builtin refs-not-closes", () => {
	const rule = byId("refs-not-closes");
	it("matchea cierres automáticos en texto y toolargs", () => {
		expect(matchRule(rule, "text", "feat: algo\n\nCloses #123"))?.not.toBe(
			null,
		);
		expect(matchRule(rule, "text", "fixes: #45"))?.not.toBe(null);
		expect(matchRule(rule, "text", "Resolves #9"))?.not.toBe(null);
		expect(matchRule(rule, "toolargs", "commit({message: 'fix x Fixes #7'})"))?.not
			.toBe(null);
	});
	it("NO matchea Refs #N (la política del repo)", () => {
		expect(matchRule(rule, "text", "feat: algo\n\nRefs #123")).toBe(null);
	});
});

describe("TTSR rules: builtin vscode-tokens-ui", () => {
	const rule = byId("vscode-tokens-ui");
	it("matchea color hardcodeado CON path de webview (allOf)", () => {
		expect(
			matchRule(
				rule,
				"toolargs",
				'write({path: "webview/src/x.css", content: ".btn { color: #f85149; }"})',
			),
		)?.not.toBe(null);
	});
	it("NO matchea color sin path de UI (un .ts normal puede llevar hashes)", () => {
		expect(matchRule(rule, "toolargs", 'write({path: "src/hash.ts", content: "#f85149"}))')).toBe(
			null,
		);
	});
	it("NO matchea path de UI sin color", () => {
		expect(matchRule(rule, "toolargs", 'write({path: "webview/x.css", content: ".btn {}"})')).toBe(
			null,
		);
	});
	it("sólo inspecciona toolargs", () => {
		expect(matchRule(rule, "text", "webview con #f85149")).toBe(null);
	});
});

describe("TTSR rules: los reminders NO se auto-matchean", () => {
	it("ningún reminder de builtin dispara su propia regla (anti eco)", () => {
		for (const rule of BUILTIN_TTSR_RULES) {
			for (const scope of rule.scopes) {
				expect(
					matchRule(rule, scope, rule.reminder),
					`reminder de ${rule.id} auto-matchea en ${scope}`,
				).toBe(null);
			}
		}
	});
});

describe("matchRule: robustez", () => {
	it("fuente regex inválida se salta (fail-open), no lanza", () => {
		const broken: TtsrRule = {
			...byId("es-mx"),
			id: "broken",
			anyOf: ["{regex-rota(", "vosotros"],
		};
		expect(matchRule(broken, "text", "vosotros"))?.not.toBe(null);
	});
	it("ventana de escaneo: contenido enorme sólo revisa el final", () => {
		const rule = byId("es-mx");
		const huge = "x".repeat(50_000) + " al final vosotros";
		expect(matchRule(rule, "text", huge, 1_000))?.not.toBe(null);
	});
	it("contenido vacío → null barato", () => {
		expect(matchRule(byId("es-mx"), "text", "")).toBe(null);
	});
});

describe("extractScopes", () => {
	it("acumula text/thinking/toolargs del partial", () => {
		const out = extractScopes({
			content: [
				{ type: "thinking", thinking: "pienso" },
				{ type: "text", text: "hola " },
				{ type: "text", text: "mundo" },
				{ type: "toolCall", name: "commit", arguments: '{"message":"x"}' },
			],
		});
		expect(out.text).toBe("hola mundo");
		expect(out.thinking).toBe("pienso");
		expect(out.toolargs).toContain("commit");
		expect(out.toolargs).toContain('"message":"x"');
	});
	it("partial sin content → vacío, sin lanzar", () => {
		const out = extractScopes({});
		expect(out).toEqual({ text: "", thinking: "", toolargs: "" });
	});
});
