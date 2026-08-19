// Issue #19 Lote 2 — salida estructurada (G1) y tier (G2).
//
// Cubre:
//  1. parseJsonLoose: JSON limpio, fences ```json, JSON embebido en prosa.
//  2. validateJsonSchemaValue: type/required/properties/items/enum con rutas.
//  3. withStructuredOutput: passthrough sin schema; parse+valida con schema;
//     reparación con 1 retry (incluye re-prompt con errores); falla tras
//     agotar intentos; suma accounting de todos los intentos (#18).
//  4. resolveRoleOverrides: tier resuelve vía aliases; model gana a tier; sin
//     alias cae al padre (sin model en el resultado).
//  5. adversarial-review y code-review ejecutan en el sandbox real (los
//     bridges devuelven lo que el spawner ve POST-wrapper: objetos parseados
//     para agentes con outputSchema, texto para el resto).
import { describe, it, expect } from "vitest";
import {
	parseJsonLoose,
	structuredPrompt,
	validateJsonSchemaValue,
	withStructuredOutput,
} from "../../src/tools/frida-extensible-workflows/structured-output";
import {
	resolveRoleOverrides,
	spawnResult,
	type SpawnAgentFn,
} from "../../src/tools/frida-extensible-workflows/frida-agent-execution";
import { runWorkflow } from "../../src/tools/frida-extensible-workflows/core/execution";
import {
	generateAdversarialReviewWorkflow,
	generateCodeReviewWorkflow,
} from "../../src/tools/frida-extensible-workflows/builtin-patterns";
import type {
	JsonSchema,
	JsonValue,
	WorkflowBridge,
} from "../../src/tools/frida-extensible-workflows/core/types";

describe("structured-output · parseJsonLoose (#19 G1)", () => {
	it("parsea JSON limpio", () => {
		expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
		expect(parseJsonLoose("  [1,2] ")).toEqual([1, 2]);
	});
	it("quita fences ```json", () => {
		expect(parseJsonLoose('```json\n{"a":true}\n```')).toEqual({ a: true });
		expect(parseJsonLoose('```\n[1]\n```')).toEqual([1]);
	});
	it("recorta prosa alrededor del JSON embebido", () => {
		expect(
			parseJsonLoose('Sure! Here it is:\n{"candidates":[]}\nHope it helps.'),
		).toEqual({ candidates: [] });
	});
	it("lanza con mensaje descriptivo en JSON inválido", () => {
		expect(() => parseJsonLoose("nada de json aqui")).toThrow(/JSON inválido/);
	});
});

describe("structured-output · validateJsonSchemaValue (#19 G1)", () => {
	const schema: JsonSchema = {
		type: "object",
		properties: {
			candidates: {
				type: "array",
				items: {
					type: "object",
					properties: {
						file: { type: "string" },
						line: { type: "number" },
					},
					required: ["file", "line"],
				},
			},
			verdict: { type: "string", enum: ["CONFIRMED", "PLAUSIBLE", "REFUTED"] },
		},
		required: ["candidates"],
	};

	it("valor conforme → sin errores", () => {
		expect(
			validateJsonSchemaValue(
				{ candidates: [{ file: "a.ts", line: 1 }], verdict: "CONFIRMED" },
				schema,
			),
		).toEqual([]);
	});
	it("missing required con ruta raíz", () => {
		const errors = validateJsonSchemaValue({}, schema);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain('missing required property "candidates"');
	});
	it("item inválido con ruta anidada", () => {
		const errors = validateJsonSchemaValue(
			{ candidates: [{ file: "a.ts" }] },
			schema,
		);
		// missing required se reporta a nivel del ÍTEM ($.candidates[0]), no
		// de la propiedad ausente.
		expect(
			errors.some(
				(e) => e.includes("$.candidates[0]") && e.includes('"line"'),
			),
		).toBe(true);
	});
	it("enum rechaza valores fuera de la lista", () => {
		const errors = validateJsonSchemaValue(
			{ candidates: [], verdict: "MAYBE" },
			schema,
		);
		expect(errors.some((e) => e.includes("not in enum"))).toBe(true);
	});
	it("type mismatch corta la validación interna", () => {
		const errors = validateJsonSchemaValue("string", schema);
		expect(errors).toEqual(["$: expected object, got string"]);
	});
});

/** Spawn mock con respuestas programadas por llamada (envelope spawnResult). */
function scriptedSpawn(responses: string[]): SpawnAgentFn {
	let i = 0;
	return async () => {
		const r = responses[Math.min(i, responses.length - 1)]!;
		i++;
		return spawnResult(r as JsonValue);
	};
}

/** Identidad mínima para las llamadas de los tests. */
function ident() {
	return { structuralPath: [], callSite: "a", occurrence: 1 };
}

describe("structured-output · withStructuredOutput (#19 G1)", () => {
	const schema: JsonSchema = {
		type: "object",
		properties: { ok: { type: "boolean" } },
		required: ["ok"],
	};

	it("sin outputSchema es passthrough exacto", async () => {
		const calls: string[] = [];
		const inner: SpawnAgentFn = async (p) => {
			calls.push(p);
			return spawnResult("texto plano");
		};
		const wrapped = withStructuredOutput(inner);
		const out = (await wrapped("haz algo", {}, new AbortController().signal, ident())) as {
			value: JsonValue;
		};
		// Passthrough: devuelve el envelope spawnResult del inner TAL CUAL.
		expect(out.value).toBe("texto plano");
		expect(calls).toEqual(["haz algo"]); // sin append del contrato
	});

	it("con schema parsea el JSON del texto y valida", async () => {
		const wrapped = withStructuredOutput(scriptedSpawn(['{"ok":true}']));
		const out = (await wrapped("decide", { outputSchema: schema }, new AbortController().signal, ident())) as {
			value: JsonValue;
		};
		expect(out.value).toEqual({ ok: true });
	});

	it("repara: el segundo intento recibe los errores del primero", async () => {
		const prompts: string[] = [];
		const inner: SpawnAgentFn = async (p) => {
			prompts.push(p);
			return spawnResult(
				prompts.length === 1 ? '{"ok":"no-boolean"}' : '{"ok":true}',
			);
		};
		const wrapped = withStructuredOutput(inner);
		const out = (await wrapped("decide", { outputSchema: schema }, new AbortController().signal, ident())) as {
			value: JsonValue;
		};
		expect(prompts).toHaveLength(2);
		expect(prompts[0]).toContain("OUTPUT FORMAT");
		expect(prompts[1]).toContain("rejected");
		expect(prompts[1]).toContain("$.ok");
		expect(out.value).toEqual({ ok: true });
	});

	it("falla tras agotar los intentos con error accionable", async () => {
		const wrapped = withStructuredOutput(scriptedSpawn(["basura sin json"]), {
			maxRepairAttempts: 0,
		});
		await expect(
			wrapped("decide", { outputSchema: schema }, new AbortController().signal, ident()),
		).rejects.toThrow(/outputSchema no satisfecho/);
	});

	it("suma el accounting de todos los intentos (#18)", async () => {
		const prompts: string[] = [];
		const inner: SpawnAgentFn = async () => {
			const attempt = prompts.push("x");
			return spawnResult(attempt === 1 ? "no json" : '{"ok":true}', {
				accounting: {
					input: 100,
					output: 10,
					cacheRead: 0,
					cacheWrite: 0,
					cost: 0.01,
				},
				durationMs: 50,
			});
		};
		const wrapped = withStructuredOutput(inner);
		const raw = (await wrapped("decide", { outputSchema: schema }, new AbortController().signal, ident())) as {
			value: JsonValue;
			accounting?: { input: number; cost: number };
			durationMs?: number;
		};
		expect(raw.value).toEqual({ ok: true });
		expect(raw.accounting?.input).toBe(200); // 2 intentos × 100
		expect(raw.accounting?.cost).toBeCloseTo(0.02);
		expect(raw.durationMs).toBeGreaterThanOrEqual(100);
	});

	it("structuredPrompt incluye el schema y el contrato estricto", () => {
		const p = structuredPrompt("tarea", schema);
		expect(p).toContain("tarea");
		expect(p).toContain("OUTPUT FORMAT (strict)");
		expect(p).toContain('"ok"');
	});
});

describe("tier routing (#19 G2)", () => {
	it("tier resuelve vía modelAliases cuando no hay model explícito", () => {
		const out = resolveRoleOverrides(
			{ tier: "small" },
			{},
			{ small: "anthropic/claude-haiku", medium: "zai/glm-4.6" },
		);
		expect(out.model).toBe("anthropic/claude-haiku");
	});
	it("model explícito gana sobre tier", () => {
		const out = resolveRoleOverrides(
			{ tier: "small", model: "openai/gpt-5" },
			{},
			{ small: "anthropic/claude-haiku" },
		);
		expect(out.model).toBe("openai/gpt-5");
	});
	it("tier sin alias configurado degrada al padre (sin model)", () => {
		const out = resolveRoleOverrides({ tier: "big" }, {}, {});
		expect(out.model).toBeUndefined();
	});
	it("sin tier ni model no toca el modelo", () => {
		const out = resolveRoleOverrides({ label: "x" }, {}, {});
		expect(out.model).toBeUndefined();
	});
});

describe("patrones Lote 2 · ejecución en sandbox real", () => {
	/** Bridge que responde según el prompt: objetos para agentes con
	 * outputSchema (lo que ven post-wrapper), texto para el resto. */
	function jsonBridge(): WorkflowBridge {
		return {
			agent: async (prompt: string): Promise<JsonValue> => {
				if (prompt.startsWith("Investigate")) {
					return { findings: ["finding uno", "finding dos"] };
				}
				if (prompt.includes("REFUTE")) {
					return { real: false, reason: "no sostiene" };
				}
				if (prompt.includes("scanner") || prompt.includes("finder")) {
					return { candidates: [] };
				}
				if (prompt.includes("verifier")) {
					return { verdict: "CONFIRMED", reason: "trazado" };
				}
				// síntesis / consenso / finders sin schema → texto
				return "informe final";
			},
		};
	}

	it("adversarial-review: 2 hallazgos → 2×N refutadores (todos false) → 0 sobrevivientes", async () => {
		const prompts: string[] = [];
		const bridge: WorkflowBridge = {
			agent: async (p): Promise<JsonValue> => {
				prompts.push(p);
				// El bridge ve lo que ve el spawner POST-withStructuredOutput en
				// producción: los agentes con outputSchema devuelven el objeto
				// PARSEADO (el wrapper corre en index.ts, no en el sandbox).
				if (p.startsWith("Investigate")) return { findings: ["f1", "f2"] };
				if (p.includes("REFUTE")) return { real: false };
				return "reporte";
			},
		};
		const exec = runWorkflow(
			generateAdversarialReviewWorkflow(),
			{ task: "revisar el gate", reviewers: 2, threshold: 0.5 },
			bridge,
		);
		const result: any = await exec.result;
		// 1 investigate + 4 refutaciones (2 hallazgos × 2 revisores) + 1 consenso.
		expect(prompts).toHaveLength(6);
		expect(result.total).toBe(2);
		expect(result.survivors).toEqual([]); // todos los votos real=false
		expect(result.report).toBe("reporte");
	}, 20000);

	it("adversarial-review: votos mixtos respetan el threshold", async () => {
		const bridge: WorkflowBridge = {
			agent: async (p, options): Promise<JsonValue> => {
				if (p.startsWith("Investigate")) return { findings: ["único"] };
				if (p.includes("REFUTE")) {
					// El revisor 1 dice real, el 2 dice falso → 1/2 = 0.5.
					const label = String((options as Record<string, unknown>).label ?? "");
					return { real: label.endsWith("1") };
				}
				return "reporte";
			},
		};
		const exec = runWorkflow(
			generateAdversarialReviewWorkflow(),
			{ task: "T", reviewers: 2, threshold: 0.5 },
			bridge,
		);
		const result: any = await exec.result;
		// ratio 1/2 = 0.5 >= threshold 0.5 → sobrevive.
		expect(result.survivors).toHaveLength(1);
		expect(result.survivors[0].realVotes).toBe(1);
	}, 20000);

	it("code-review: 7 finders con tier + verify por candidato → ranking", async () => {
		const prompts: string[] = [];
		const bridge: WorkflowBridge = {
			agent: async (p): Promise<JsonValue> => {
				prompts.push(p);
				// Ojo con el orden: el prompt de síntesis EMBEDE el JSON de
				// hallazgos (con "verdict" dentro) → se distingue por su intro antes
				// de matchear "verdict"/"candidates".
				if (p.includes("senior code reviewer")) return "reporte markdown";
				// Objetos parseados (post-wrapper): el bridge recibe el prompt SIN
				// el append "OUTPUT FORMAT". Sólo el finder A produce un candidato.
				if (p.includes("correctness scanner"))
					return {
						candidates: [
							{
								file: "a.ts",
								line: 1,
								summary: "null deref",
								failure_scenario: "NPE",
							},
						],
					};
				if (p.includes("verifier")) return { verdict: "CONFIRMED" };
				if (p.includes("You are a")) return { candidates: [] }; // finders B-G
				return "reporte markdown";
			},
		};
		const exec = runWorkflow(
			generateCodeReviewWorkflow(),
			{ diff: "+ const x = null; x.y", diffSource: "test" },
			bridge,
		);
		const result: any = await exec.result;
		// 7 finders + 1 verify (1 candidato, dedup) + 1 síntesis.
		expect(prompts).toHaveLength(9);
		expect(result.total).toBe(1);
		expect(result.surviving).toBe(1);
		expect(result.findings[0].angle).toBe("A"); // correctness primero
		expect(result.report).toBe("reporte markdown");
		expect(result.diffTruncated).toBe(false);
	}, 20000);

	it("code-review: diff vacío → 0 candidatos, verify skipped, sin crash", async () => {
		const exec = runWorkflow(
			generateCodeReviewWorkflow(),
			{ diff: "" },
			jsonBridge(),
		);
		const result: any = await exec.result;
		expect(result.total).toBe(0);
		expect(result.findings).toEqual([]);
	}, 20000);

	it("code-review: REFUTED se filtra del reporte final", async () => {
		const bridge: WorkflowBridge = {
			agent: async (p): Promise<JsonValue> => {
				if (p.includes("senior code reviewer")) return "reporte";
				if (p.includes("correctness scanner"))
					return {
						candidates: [
							{
								file: "a.ts",
								line: 1,
								summary: "falso positivo",
								failure_scenario: "no aplica",
							},
						],
					};
				if (p.includes("verifier")) return { verdict: "REFUTED" };
				if (p.includes("You are a")) return { candidates: [] };
				return "reporte";
			},
		};
		const exec = runWorkflow(
			generateCodeReviewWorkflow(),
			{ diff: "+ algo" },
			bridge,
		);
		const result: any = await exec.result;
		expect(result.total).toBe(1);
		expect(result.surviving).toBe(0);
		expect(result.findings).toEqual([]);
	}, 20000);
});

describe("structured-output · tolerancia outputSchema (#82: double-encoding GLM)", () => {
	const TARGETS_SCHEMA: JsonSchema = {
		type: "object",
		properties: {
			targets: {
				type: "array",
				items: {
					type: "object",
					properties: {
						id: { type: "string" },
						risk: { type: "string" },
					},
					required: ["id", "risk"],
				},
			},
		},
		required: ["targets"],
	};
	const spawnReturning = (value: JsonValue): SpawnAgentFn =>
		(async () => spawnResult(value)) as unknown as SpawnAgentFn;

	it("array hijo serializado como string JSON pasa en el PRIMER intento", async () => {
		// GLM-5.3: objetos anidados como string JSON (incidente #82/#76).
		const spawn = spawnReturning({
			targets: '[{"id":"T1","risk":"P0"},{"id":"T2","risk":"P1"}]',
		});
		const out = (await withStructuredOutput(spawn)({}, { outputSchema: TARGETS_SCHEMA } as never, {} as never, {} as never)) as {
			value: unknown;
		};
		expect(out.value).toEqual({
			targets: [
				{ id: "T1", risk: "P0" },
				{ id: "T2", risk: "P1" },
			],
		});
	});

	it("string-encoded anidado dentro de string-encoded (recursión + fences)", async () => {
		const spawn = spawnReturning(
			'{"targets": "[{\\"id\\":\\"T1\\",\\"risk\\":\\"P0\\"}]"}',
		);
		const out = (await withStructuredOutput(spawn)({}, { outputSchema: TARGETS_SCHEMA } as never, {} as never, {} as never)) as {
			value: unknown;
		};
		expect(out.value).toEqual({
			targets: [{ id: "T1", risk: "P0" }],
		});
	});

	it("string que el schema espera como string NO se toca", async () => {
		const SCHEMA: JsonSchema = {
			type: "object",
			properties: { summary: { type: "string" } },
			required: ["summary"],
		};
		const spawn = spawnReturning({ summary: '{"parece":"json"}' });
		const out = (await withStructuredOutput(spawn)({}, { outputSchema: SCHEMA } as never, {} as never, {} as never)) as {
			value: unknown;
		};
		// El schema pide string → el contenido json-looking se conserva tal cual.
		expect(out.value).toEqual({ summary: '{"parece":"json"}' });
	});
});
