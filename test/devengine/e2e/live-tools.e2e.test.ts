// E2E LIVE — Matriz de TOOLS: modelo DevEngine con razonamiento contra TODAS
// las herramientas de frida code.
//
//   npx vitest run test/devengine/e2e/live-tools.e2e.test.ts
//   Modelo: DEVENGINE_MODEL (default gpt-5.4-mini)
//
// NIVEL A — ciclo REAL completo (7 tools core del SDK, con execute() real en
//   un sandbox tmp): modelo decide → function_call → args válidos → execute
//   → function_call_output → respuesta final que USA el resultado.
// NIVEL B — generación correcta (tools del host que dependen del webview:
//   ask_user_question, todo, context, read_skills, agent_browser, workflow,
//   get_subagent_result, steer_subagent): el modelo debe emitir function_call
//   con arguments JSON válidos según el schema (la ejecución es UI-bound y
//   queda fuera del E2E CLI).
//
// Al final escribe reporte-tools-devengine.md junto a este archivo.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	DEVENGINE_BASE_URL,
	DEVENGINE_MODEL,
	DEVENGINE_TIMEOUT,
	readCredential,
	makeSandbox,
	createCoreTools,
	makeEngine,
} from "./harness";

const THINKING = "medium";

// ─── Resultado por caso ───────────────────────────────────────────────────────

type Phase =
	| "tool_call"
	| "args"
	| "execute"
	| "round_trip"
	| "final_answer"
	| "generation";
type CaseResult = {
	level: "A" | "B";
	tool: string;
	prompt: string;
	ok: boolean;
	phase?: Phase;
	detail?: string;
	ms?: number;
};

// ─── Matrices ────────────────────────────────────────────────────────────────

interface CaseA {
	tool: string;
	prompt: string;
	/** Verificación del contenido esperado tras el round-trip. */
	verify: (
		args: any,
		toolOutput: string,
		finalText: string,
		sandbox: string,
	) => string | null;
	/** Chequeo extra del efecto en disco. */
	diskCheck?: (sandbox: string) => string | null;
}

// NOTA DE DISEÑO: los prompts NO mencionan nombres de tools literalmente.
// El gateway DevEngine parsea el texto del mensaje buscando referencias a tools
// y las valida contra las "tools activas" del proyecto → 400 "No existe una tool
// activa con nombre 'X'" (que en streaming se manifiesta como 500 opaco —
// hallazgo D-1 de HALLAZGOS-GATEWAY.md). El host real nunca lo dispara: los
// usuarios no nombran tools en sus prompts. Además, sin nombrar la tool se
// prueba lo que importa: que el MODELO ELIGE la tool correcta.

const CASES_A: CaseA[] = [
	{
		tool: "read",
		prompt:
			"Lee el archivo poema.txt y dime el número de 4 dígitos que aparece en él.",
		verify: (_a, _o, final) =>
			/7731/.test(final)
				? null
				: "la respuesta final no contiene el PIN 7731",
	},
	{
		tool: "write",
		prompt:
			"Crea el archivo resumen.txt con el contenido exacto: HOLA-DEVENGINE-E2E",
		verify: (args) =>
			/resumen\.txt/i.test(String(args.path ?? ""))
				? null
				: `path raro: ${args.path}`,
		diskCheck: (sb) => {
			try {
				return readFileSync(join(sb, "resumen.txt"), "utf8").includes(
					"HOLA-DEVENGINE-E2E",
				)
					? null
					: "contenido en disco no coincide";
			} catch {
				return "resumen.txt no fue creado";
			}
		},
	},
	{
		tool: "edit",
		prompt:
			"En config.txt cambia la línea color=rojo para que diga color=azul (con búsqueda y reemplazo exacto).",
		verify: (args) => (Array.isArray(args.edits) ? null : "edits no es array"),
		diskCheck: (sb) => {
			const c = readFileSync(join(sb, "config.txt"), "utf8");
			return /color=azul/.test(c) && /size=10/.test(c)
				? null
				: `config.txt quedó: ${JSON.stringify(c)}`;
		},
	},
	{
		tool: "bash",
		prompt:
			"Ejecuta el comando echo $((6*7)) y dime el resultado numérico.",
		verify: (args, output) =>
			/echo/.test(String(args.command ?? "")) && /42/.test(output)
				? null
				: `command=${args.command} output=${output.slice(0, 80)}`,
	},
	{
		tool: "grep",
		prompt:
			"Busca el patrón 'aguacate' en este directorio y dime en QUÉ archivo aparece.",
		verify: (_a, output, final) =>
			/alpha\.md/.test(output) || /alpha\.md/.test(final)
				? null
				: "no identificó alpha.md",
	},
	{
		tool: "find",
		prompt:
			"Localiza el archivo que se llama tesoro.txt (está en un subdirectorio) y dime su ruta.",
		verify: (_a, output, final) =>
			/tesoro\.txt/.test(output) || /tesoro\.txt/.test(final)
				? null
				: "no reportó tesoro.txt",
	},
	{
		tool: "ls",
		prompt:
			"Lista el contenido del directorio actual y dime los nombres de los archivos .md que ves.",
		verify: (_a, output, final) =>
			(/alpha\.md/.test(output) || /alpha\.md/.test(final)) &&
			(/beta\.md/.test(output) || /beta\.md/.test(final))
				? null
				: "no listó alpha.md y beta.md",
	},
];

/** Schemas fieles de las tools del host (src/tools/*). Nivel B: sólo generación. */
function hostToolSchemas(): Array<{
	name: string;
	description: string;
	parameters: any;
	prompt: string;
	requiredFields: string[];
}> {
	return [
		{
			name: "ask_user_question",
			description:
				"Pregunta al usuario hasta 4 preguntas con opciones concretas (label+descripción) en vez de adivinar.",
			parameters: {
				type: "object",
				required: ["questions"],
				properties: {
					questions: {
						type: "array",
						items: {
							type: "object",
							required: ["question", "header", "options"],
							properties: {
								question: { type: "string" },
								header: { type: "string" },
								options: {
									type: "array",
									items: {
										type: "object",
										required: ["label", "description"],
										properties: {
											label: { type: "string" },
											description: { type: "string" },
										},
									},
								},
								multiSelect: { type: "boolean" },
							},
						},
					},
				},
			},
			prompt:
				"Quiero añadir tests a este proyecto. Antes de empezar, formulame una pregunta con opciones concretas sobre qué framework prefiero (vitest o jest).",
			requiredFields: ["questions"],
		},
		{
			name: "todo",
			description:
				"Manage a task list for tracking multi-step progress (create/update/list tasks).",
			parameters: {
				type: "object",
				required: ["action"],
				properties: {
					action: {
						type: "string",
						enum: ["create", "update", "list", "get", "delete", "clear"],
					},
					subject: { type: "string" },
					description: { type: "string" },
					activeForm: { type: "string" },
					id: { type: "number" },
					status: {
						type: "string",
						enum: ["pending", "in_progress", "completed", "deleted"],
					},
				},
			},
			prompt:
				"Registra en la lista de tareas una nueva tarea: 'Investigar el bug del login' con estado pending.",
			requiredFields: ["action"],
		},
		{
			name: "context",
			description:
				"Fetches Frida Context (RAG) for the user's team libraries given a query.",
			parameters: {
				type: "object",
				required: ["query"],
				properties: {
					query: { type: "string" },
					maxTokens: { type: "number" },
				},
			},
			prompt:
				"Consulta el contexto documental del equipo sobre 'componentes de tabla React' para este proyecto.",
			requiredFields: ["query"],
		},
		{
			name: "read_skills",
			description:
				"Browse local skills and load skills from skills.sh (search, or load with source+name+full).",
			parameters: {
				type: "object",
				properties: {
					search: { type: "string" },
					source: { type: "string" },
					name: { type: "string" },
					full: { type: "boolean" },
				},
			},
			prompt:
				"Busca skills remotas sobre 'commit messages'.",
			requiredFields: [],
		},
		{
			name: "agent_browser",
			description:
				"Browse websites, read live docs, click and fill pages, extract browser content and automate real web workflows.",
			parameters: {
				type: "object",
				properties: {
					args: { type: "array", items: { type: "string" } },
					semanticAction: { type: "object" },
					job: { type: "object" },
					qa: { type: "object" },
					url: { type: "string" },
				},
			},
			prompt:
				"Navega a https://example.com y dime el título de la página.",
			requiredFields: [],
		},
		{
			name: "workflow",
			description:
				"Run a deterministic JavaScript workflow with named inline script and parallel agents.",
			parameters: {
				type: "object",
				required: ["name"],
				properties: {
					name: { type: "string" },
					script: { type: "string" },
					scriptPath: { type: "string" },
					description: { type: "string" },
				},
			},
			prompt:
				"Lanza un flujo de trabajo llamado 'probe' con un script inline que retorne 42.",
			requiredFields: ["name"],
		},
		{
			name: "get_subagent_result",
			description:
				"Check the status and retrieve results from a background sub-agent.",
			parameters: {
				type: "object",
				required: ["agent_id"],
				properties: {
					agent_id: { type: "string" },
					wait: { type: "boolean" },
				},
			},
			prompt:
				"Consulta el resultado del sub-agente agent-123 (sin esperar).",
			requiredFields: ["agent_id"],
		},
		{
			name: "steer_subagent",
			description: "Send a steering message to a running sub-agent.",
			parameters: {
				type: "object",
				required: ["agent_id", "message"],
				properties: {
					agent_id: { type: "string" },
					message: { type: "string" },
				},
			},
			prompt:
				"Envía el mensaje 'prioriza los tests' al sub-agente agent-123.",
			requiredFields: ["agent_id", "message"],
		},
	];
}

// ─── El test ─────────────────────────────────────────────────────────────────

describe("E2E live TOOLS: DevEngine × todas las tools de frida code", () => {
	it(
		`matriz A (ciclo real 7 core) + B (generación 8 host) → reporte MD`,
		async () => {
			const cred = await readCredential();
			if (!cred?.access) {
				console.warn("SKIP: sin credencial DevEngine (configura DEVENGINE_API_KEY o ~/.frida/auth.json)");
				return;
			}

			const sandbox = makeSandbox();
			const coreTools = createCoreTools(sandbox);
			const coreSchemas = Object.values(coreTools).map((t) => ({
				type: "function" as const,
				name: t.name,
				description: t.description,
				parameters: t.parameters,
			}));

			const { turn } = await makeEngine({
				baseUrl: DEVENGINE_BASE_URL,
				key: cred.access,
				model: DEVENGINE_MODEL,
			});

			const results: CaseResult[] = [];

			// ── NIVEL A: ciclo real con MINI-LOOP agentic (hasta 3 tool-calls
			//    encadenadas: el modelo puede leer antes de editar, etc.).
			for (const c of CASES_A) {
				const t0 = Date.now();
				const trace: string[] = [];
				try {
					const userMsg = {
						role: "user",
						content: [{ type: "text", text: c.prompt }],
					};
					const history: any[] = [userMsg];
					let calledTarget: { args: any; output: string } | null = null;
					let finalText = "";
					let thinking = 0;

					for (let hop = 0; hop < 3; hop++) {
						const r = await turn(history, coreSchemas, {
							reasoningEffort: THINKING,
						});
						thinking += r.thinkingChars;
						const fc = r.fnCalls[0];
						if (!fc) {
							finalText = r.text;
							trace.push(`hop${hop}: sin tool_call (stop=${r.stopReason})`);
							break;
						}
						let args: any;
						try {
							args = JSON.parse(fc.arguments);
						} catch (e: any) {
							trace.push(
								`hop${hop}: args no parsean (${fc.arguments.slice(0, 60)})`,
							);
							results.push({
								level: "A",
								tool: c.tool,
								prompt: c.prompt,
								ok: false,
								phase: "args",
								detail: trace.join(" · "),
								ms: Date.now() - t0,
							});
							calledTarget = null;
							break;
						}
						// execute REAL de la tool que pidió (cualquiera de las 7)
						let toolOutput = "";
						try {
							const out = await coreTools[fc.name].execute(
								"e2e",
								args,
								undefined,
								undefined,
								undefined,
							);
							toolOutput =
								typeof out === "string"
									? out
									: JSON.stringify(out?.content ?? out ?? "");
						} catch (e: any) {
							trace.push(
								`hop${hop}: ${fc.name} execute ERROR ${String(e?.message ?? e).slice(0, 90)}`,
							);
							// La ejecución falla → igual devolvemos el error como
							// toolResult (como haría el host) para que el modelo
							// pueda recuperarse en el siguiente hop.
							toolOutput = `ERROR: ${String(e?.message ?? e).slice(0, 200)}`;
						}
						trace.push(
							`hop${hop}: ${fc.name}(${JSON.stringify(args).slice(0, 50)}) → ${toolOutput.slice(0, 40).replace(/\n/g, " ")}`,
						);
						if (fc.name === c.tool && !toolOutput.startsWith("ERROR")) {
							calledTarget = { args, output: toolOutput };
						}
						history.push(
							{
								role: "assistant",
								content: [
									{
										type: "toolCall",
										id: fc.call_id,
										name: fc.name,
										arguments: args,
									},
								],
							},
							{
								role: "toolResult",
								toolCallId: fc.call_id,
								content: [
									{ type: "text", text: toolOutput.slice(0, 4000) || "(vacío)" },
								],
							},
						);
					}
					if (finalText === "") {
						// agotó hops sin texto final: un turno más SIN tools para cerrar
						const r = await turn(history, []);
						finalText = r.text;
						thinking += r.thinkingChars;
					}

					if (!calledTarget) {
						results.push({
							level: "A",
							tool: c.tool,
							prompt: c.prompt,
							ok: false,
							phase: "tool_call",
							detail: trace.join(" · ").slice(0, 200),
							ms: Date.now() - t0,
						});
						continue;
					}
					const verifyErr =
						c.verify(
							calledTarget.args,
							calledTarget.output,
							finalText,
							sandbox,
						) ??
						c.diskCheck?.(sandbox) ??
						null;
					results.push({
						level: "A",
						tool: c.tool,
						prompt: c.prompt,
						ok: !verifyErr,
						phase: verifyErr ? "final_answer" : undefined,
						detail:
							verifyErr ?? `thinking=${thinking}chr · ${trace.length} hops · ok`,
						ms: Date.now() - t0,
					});
				} catch (e: any) {
					results.push({
						level: "A",
						tool: c.tool,
						prompt: c.prompt,
						ok: false,
						detail: `excepción: ${String(e?.message ?? e).slice(0, 140)}`,
						ms: Date.now() - t0,
					});
				}
			}

			// ── NIVEL B: generación con schema del host ──
			for (const spec of hostToolSchemas()) {
				const t0 = Date.now();
				try {
					const r = await turn(
						[
							{
								role: "user",
								content: [{ type: "text", text: spec.prompt }],
							},
						] as any,
						[
							{
								type: "function",
								name: spec.name,
								description: spec.description,
								parameters: spec.parameters,
							},
						],
						{ reasoningEffort: THINKING },
					);
					const fc = r.fnCalls[0];
					if (!fc || fc.name !== spec.name) {
						results.push({
							level: "B",
							tool: spec.name,
							prompt: spec.prompt,
							ok: false,
							phase: "generation",
							detail: fc
								? `llamó '${fc.name}'`
								: `sin function_call (stop=${r.stopReason}, text=${r.text.slice(0, 80)})`,
							ms: Date.now() - t0,
						});
						continue;
					}
					let args: any;
					try {
						args = JSON.parse(fc.arguments);
					} catch (e: any) {
						results.push({
							level: "B",
							tool: spec.name,
							prompt: spec.prompt,
							ok: false,
							phase: "args",
							detail: `arguments no parsean: ${fc.arguments.slice(0, 100)}`,
							ms: Date.now() - t0,
						});
						continue;
					}
					const missing = spec.requiredFields.filter(
						(f) => args?.[f] === undefined,
					);
					results.push({
						level: "B",
						tool: spec.name,
						prompt: spec.prompt,
						ok: missing.length === 0,
						phase: missing.length ? "args" : undefined,
						detail: missing.length
							? `faltan campos requeridos: ${missing.join(", ")} :: ${JSON.stringify(args).slice(0, 120)}`
							: `args ok: ${JSON.stringify(args).slice(0, 100)}`,
						ms: Date.now() - t0,
					});
				} catch (e: any) {
					results.push({
						level: "B",
						tool: spec.name,
						prompt: spec.prompt,
						ok: false,
						detail: `excepción: ${String(e?.message ?? e).slice(0, 140)}`,
						ms: Date.now() - t0,
					});
				}
			}

			// ── Reporte MD ──
			const okA = results.filter((r) => r.level === "A" && r.ok).length;
			const okB = results.filter((r) => r.level === "B" && r.ok).length;
			const lines: string[] = [];
			lines.push(`# Reporte E2E tools — ${DEVENGINE_MODEL} (reasoning: ${THINKING})`);
			lines.push("");
			lines.push(
				`Fecha: ${new Date().toISOString()} · endpoint: ${DEVENGINE_BASE_URL}/v1/chat/completions · adapter openai-completions`,
			);
			lines.push("");
			lines.push(`## Resumen`);
			lines.push("");
			lines.push(
				`- Nivel A (ciclo real, tools core): **${okA}/${CASES_A.length}**`,
			);
			lines.push(
				`- Nivel B (generación, tools host): **${okB}/${hostToolSchemas().length}**`,
			);
			lines.push("");
			lines.push(`| Nivel | Tool | Resultado | Fase | Detalle | ms |`);
			lines.push(`|---|---|---|---|---|---|`);
			for (const r of results) {
				lines.push(
					`| ${r.level} | ${r.tool} | ${r.ok ? "✅" : "❌"} | ${r.phase ?? "—"} | ${(r.detail ?? "").replace(/\|/g, "\\|").slice(0, 160)} | ${r.ms ?? ""} |`,
				);
			}
			lines.push("");
			lines.push(`## Prompts usados`);
			lines.push("");
			for (const r of results)
				lines.push(`- **${r.tool}**: ${r.prompt}`);
			const report = lines.join("\n");
			const reportPath = join(__dirname, "reporte-tools-devengine.md");
			const fs = await import("node:fs/promises");
			await fs.writeFile(reportPath, report, "utf8");
			console.log(`\n=== REPORTE: ${reportPath} ===\n${report}\n`);

			// El test NO falla por tools rotas (el reporte ES el entregable),
			// pero sí exige que el ciclo básico (read) funcionó: si DevEngine no
			// puede NINGUNA tool, algo estructural rompió.
			expect(results.filter((r) => r.level === "A" && r.ok).length).toBeGreaterThan(
				0,
			);
		},
		{ timeout: DEVENGINE_TIMEOUT },
	);
});
