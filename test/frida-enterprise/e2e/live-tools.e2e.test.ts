// E2E LIVE (opt-in) — Matriz de TOOLS: NIKE-VICTORY con razonamiento ALTO por
// /v1/responses (ADR-1003) contra TODAS las herramientas de frida code.
//
//   FRIDA_ENTERPRISE_LIVE=1 npx vitest run test/frida-enterprise/e2e/live-tools.e2e.test.ts
//   Modelo: FRIDA_ENTERPRISE_TOOLS_MODEL (default NIKE-VICTORY)
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
// Al final (afterAll) escribe reporte-tools-enterprise.md con sección por
// modelo (multi-modelo, issue #60) junto a este archivo. NOTA: build/polish/vet (lanes internos de workflow) no se exponen
// al modelo conversacional — fuera de la matriz por diseño.

import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	collectStream,
	createCoreTools,
	loadOpenAIResponses,
	makeRunner,
} from "./harness";
import {
	createFridaEnterpriseHooks,
	createFridaEnterpriseRuntime,
	FRIDA_ENTERPRISE_PROVIDER,
	VERIFIED_MODEL_IDS,
} from "../../../src/providers/frida-enterprise";

const live = process.env.FRIDA_ENTERPRISE_LIVE === "1";
// Multi-modelo (issue #60): default los 4 SELECTED del catálogo (DEMETER-BLOOM,
// TITAN-CROWN, MIDAS-GOLD, model-router — ADR catálogo curado). Override:
//   FRIDA_ENTERPRISE_MODELS="DEMETER-BLOOM,model-router"   (lista csv)
//   FRIDA_ENTERPRISE_TOOLS_MODEL=NIKE-VICTORY               (singular, retro)
const MODELS = (
	process.env.FRIDA_ENTERPRISE_TOOLS_MODEL ??
	process.env.FRIDA_ENTERPRISE_MODELS ??
	"DEMETER-BLOOM,TITAN-CROWN,MIDAS-GOLD,model-router"
)
	.split(",")
	.map((s) => s.trim())
	.filter(Boolean);
const THINKING = "high";

type Credential = {
	access?: string;
	refresh?: string;
	expires?: number;
	compatibleApiUrl?: string;
	envVars?: { COMPATIBLE_API_URL?: string };
};
const FIREBASE_KEY = "AIzaSyAdz0OylajBmWqUyl5mIJ46AT2CSCwV54w";

async function readCredential(): Promise<Credential> {
	const fs = await import("node:fs/promises");
	const auth = JSON.parse(
		await fs.readFile(`${process.env.HOME}/.frida/auth.json`, "utf8"),
	);
	return auth["frida-enterprise"] ?? {};
}

async function ensureFreshToken(cred: Credential): Promise<string> {
	if (!cred.access) throw new Error("sin credential frida-enterprise (¿/login?)");
	if ((cred.expires ?? 0) - Date.now() > 3 * 60 * 1000) return cred.access;
	if (!cred.refresh) throw new Error("idToken expirado y sin refreshToken");
	const res = await fetch(
		`https://securetoken.googleapis.com/v1/token?key=${FIREBASE_KEY}`,
		{
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: cred.refresh,
			}),
		},
	);
	if (!res.ok) throw new Error(`refresh → HTTP ${res.status}`);
	const json: any = await res.json();
	cred.access = json.id_token;
	cred.refresh = json.refresh_token;
	cred.expires = Date.now() + Number(json.expires_in ?? 3600) * 1000 - 120_000;
	return cred.access!;
}

// ─── Resultado por caso ───────────────────────────────────────────────────────

type Phase = "tool_call" | "args" | "execute" | "round_trip" | "final_answer" | "generation";
type CaseResult = {
	level: "A" | "B";
	tool: string;
	prompt: string;
	ok: boolean;
	phase?: Phase;
	detail?: string;
	ms?: number;
};

// Resultados acumulados por modelo (el reporte consolidado se escribe en
// afterAll — patrón multi-modelo de test/devengine/e2e).
const allResults: Array<{ model: string; r: CaseResult }> = [];

// ─── Fixtures del sandbox (Nivel A) ──────────────────────────────────────────

function makeSandbox(): string {
	const dir = mkdtempSync(join(tmpdir(), "frida-tools-e2e-"));
	writeFileSync(
		join(dir, "poema.txt"),
		"Rosa rosae.\nEl PIN secreto es 7731.\nFin.\n",
	);
	writeFileSync(join(dir, "config.txt"), "color=rojo\nsize=10\n");
	writeFileSync(join(dir, "alpha.md"), "fruta: aguacate\n");
	writeFileSync(join(dir, "beta.md"), "fruta: sandia\n");
	writeFileSync(join(dir, "gamma.txt"), "sin fruta\n");
	mkdirSync(join(dir, "deep", "nested"), { recursive: true });
	writeFileSync(join(dir, "deep", "nested", "tesoro.txt"), "aquí estoy\n");
	return dir;
}

// ─── Motor de llamada responses con tools + identidad (cadena real) ─────────

interface FnCall {
	name: string;
	arguments: string;
	call_id: string;
}

async function makeEngine(cred: Credential, root: string, modelId: string) {
	const { stream } = await loadOpenAIResponses();
	const runtime = createFridaEnterpriseRuntime(VERIFIED_MODEL_IDS);
	const hooks = await makeRunner();
	hooks.register(
		createFridaEnterpriseHooks({ onUnauthorized: () => {}, runtime }),
	);
	const model = {
		id: modelId,
		provider: FRIDA_ENTERPRISE_PROVIDER,
		api: "openai-responses",
		baseUrl: `${root}/v1`,
		contextWindow: 1_000_000,
		maxTokens: 128_000,
		reasoning: true,
		input: ["text", "image"] as ("text" | "image")[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};
	const identity = () => {
		const claims = JSON.parse(
			Buffer.from(String(cred.access).split(".")[1], "base64url").toString(
				"utf8",
			),
		);
		return {
			user_id: claims.user_id ?? claims.sub,
			email: claims.email,
		};
	};
	/** Una vuelta del modelo. Recibe messages formato pi (el adapter los
	 *  convierte a input responses — camino real del host). */
	async function turn(
		messages: unknown[],
		tools: Array<{ type: "function"; name: string; description: string; parameters: any }>,
		opts: { maxTokens?: number } = {},
	) {
		await ensureFreshToken(cred);
		const { user_id, email } = identity();
		runtime.rememberToken(cred.access!);
		let finalText = "";
		let thinkingChars = 0;
		const fnCalls: FnCall[] = [];
		const result = await collectStream(
			stream(model as any, { messages: messages as any, tools } as any, {
				apiKey: cred.access,
				headers: { Authorization: `Bearer ${cred.access}` },
				maxTokens: opts.maxTokens ?? 4000,
				reasoningEffort: THINKING,
				onPayload: (p: any) => {
					// buildFridaPayload equivalente al hook real (por retorno)
					const out = { ...p };
					if (Array.isArray(out.input))
						out.input = out.input.map((m: any) =>
							m?.role === "developer" ? { ...m, role: "system" } : m,
						);
					out.user_id = user_id;
					out.email = email;
					out.auto_log = true;
					return out;
				},
			}),
		);
		for (const block of (result?.content ?? []) as any[]) {
			if (block.type === "text") finalText += block.text ?? "";
			if (block.type === "thinking") thinkingChars += (block.thinking ?? "").length;
			if (block.type === "toolCall") {
				fnCalls.push({
					name: block.name,
					arguments:
						typeof block.arguments === "string"
							? block.arguments
							: JSON.stringify(block.arguments ?? {}),
					call_id: block.id ?? `call_${fnCalls.length}`,
				});
			}
		}
		return { fnCalls, text: finalText, thinkingChars, stopReason: result?.stopReason };
	}
	return { turn, hooks };
}

// ─── Matrices ────────────────────────────────────────────────────────────────

interface CaseA {
	tool: string;
	prompt: string;
	/** Verificación del contenido esperado tras el round-trip. */
	verify: (args: any, toolOutput: string, finalText: string, sandbox: string) => string | null;
	/** Chequeo extra del efecto en disco. */
	diskCheck?: (sandbox: string) => string | null;
}

const CASES_A: CaseA[] = [
	{
		tool: "read",
		prompt:
			"Lee el archivo poema.txt (usa la herramienta read) y dime EXACTAMENTE cuál es el PIN secreto que aparece en él.",
		verify: (_a, _o, final) =>
			/7731/.test(final) ? null : "la respuesta final no contiene el PIN 7731",
	},
	{
		tool: "write",
		prompt:
			"Crea el archivo resumen.txt (usa la herramienta write) con el contenido exacto: HOLA-FRIDA-E2E",
		verify: (args) =>
			/resumen\.txt/i.test(String(args.path ?? "")) ? null : `path raro: ${args.path}`,
		diskCheck: (sb) => {
			try {
				return readFileSync(join(sb, "resumen.txt"), "utf8").includes(
					"HOLA-FRIDA-E2E",
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
			"En config.txt cambia la línea color=rojo para que diga color=azul (usa la herramienta edit con SEARCH/REPLACE en edits).",
		verify: (args) =>
			Array.isArray(args.edits) ? null : "edits no es array",
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
			"Ejecuta con la herramienta bash el comando: echo $((6*7)) y dime el resultado numérico.",
		verify: (args, output) =>
			/echo/.test(String(args.command ?? "")) && /42/.test(output)
				? null
				: `command=${args.command} output=${output.slice(0, 80)}`,
	},
	{
		tool: "grep",
		prompt:
			"Con la herramienta grep busca el patrón 'aguacate' en este directorio y dime en QUÉ archivo aparece.",
		verify: (_a, output, final) =>
			/alpha\.md/.test(output) || /alpha\.md/.test(final)
				? null
				: "no identificó alpha.md",
	},
	{
		tool: "find",
		prompt:
			"Con la herramienta find localiza el archivo que se llama tesoro.txt (está en un subdirectorio) y dime su ruta.",
		verify: (_a, output, final) =>
			/tesoro\.txt/.test(output) || /tesoro\.txt/.test(final)
				? null
				: "no reportó tesoro.txt",
	},
	{
		tool: "ls",
		prompt:
			"Con la herramienta ls lista el contenido del directorio actual y dime los nombres de los archivos .md que ves.",
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
				"Quiero añadir tests a este proyecto. Antes de empezar, PREGÚNTAME con la herramienta ask_user_question qué framework prefiero (vitest o jest) y si quiero cobertura de errores.",
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
					status: { type: "string", enum: ["pending", "in_progress", "completed", "deleted"] },
				},
			},
			prompt:
				"Registra en la lista de tareas (herramienta todo) una tarea nueva: 'Investigar el bug del login' con estado pending.",
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
				"Consulta el contexto Frida (herramienta context) sobre 'componentes de tabla React' para este proyecto.",
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
				"Busca con la herramienta read_skills skills remotas sobre 'commit messages'.",
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
				"Con la herramienta agent_browser abre https://example.com y dime el título de la página.",
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
				"Lanza un workflow (herramienta workflow) llamado 'probe' con script inline que retorne 42.",
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
				"Consulta con get_subagent_result el resultado del agente agent-123 (sin esperar).",
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
				"Envía con steer_subagent el mensaje 'prioriza los tests' al agente agent-123.",
			requiredFields: ["agent_id", "message"],
		},
		// ─── 6 tools nuevas del host (v0.23; prompts naturales, sin nombrar la
		// tool — el modelo debe ELEGIR cuál emitir) ───────────────────────
		{
			name: "Agent",
			description:
				"Launch a new agent to handle complex, multi-step tasks autonomously.",
			parameters: {
				type: "object",
				required: ["prompt", "description", "subagent_type"],
				properties: {
					prompt: { type: "string" },
					description: { type: "string" },
					subagent_type: { type: "string" },
					model: { type: "string" },
					run_in_background: { type: "boolean" },
				},
			},
			prompt:
				"Delega a un sub-agente especializado la tarea de averiguar qué versión de TypeScript usa este repo.",
			requiredFields: ["prompt", "subagent_type"],
		},
		{
			name: "kb_search",
			description: "Search the team knowledge base (OKF/Obsidian) by query.",
			parameters: {
				type: "object",
				required: ["query"],
				properties: { query: { type: "string" }, limit: { type: "number" } },
			},
			prompt:
				"Busca en la base de conocimiento del equipo notas sobre 'pipeline de release'.",
			requiredFields: ["query"],
		},
		{
			name: "sandbox_create",
			description: "Create a disposable Docker sandbox for isolated bash work.",
			parameters: {
				type: "object",
				properties: {
					name: { type: "string" },
					image: { type: "string" },
					workdir: { type: "string" },
				},
			},
			prompt:
				"Necesito un entorno desechable y aislado con la imagen python:3.12-slim para probar un script sin tocar mi máquina.",
			requiredFields: [],
		},
		{
			name: "sandbox_exec",
			description: "Run a shell command inside a sandbox.",
			parameters: {
				type: "object",
				required: ["id", "command"],
				properties: { id: { type: "string" }, command: { type: "string" } },
			},
			prompt:
				"En el sandbox sbx-1 corre el comando 'python --version' y dime la salida.",
			requiredFields: ["id", "command"],
		},
		{
			name: "workflow_catalog",
			description: "List available workflows/builtin patterns.",
			parameters: {
				type: "object",
				properties: { verbose: { type: "boolean" } },
			},
			prompt:
				"Muéstrame el catálogo de flujos de trabajo predefinidos que puedo correr en este proyecto.",
			requiredFields: [],
		},
		{
			name: "goal_complete",
			description: "Mark the active goal as completed with a summary.",
			parameters: {
				type: "object",
				required: ["goal_id", "summary"],
				properties: {
					goal_id: { type: "string" },
					summary: { type: "string" },
					evidence: { type: "string" },
				},
			},
			prompt:
				"El objetivo goal-42 ya quedó logrado: registra el resumen 'migración completada sin regresiones'.",
			requiredFields: ["goal_id", "summary"],
		},
	];
}

// ─── El test ─────────────────────────────────────────────────────────────────

describe.skipIf(!live)("E2E live TOOLS: razonamiento alto × todas las tools de frida code (multi-modelo)", () => {
	it(
		`matriz A (ciclo real 7 core) + B (generación 14 host) × ${MODELS.length} modelo(s) → reporte MD`,
		async () => {
			const cred = await readCredential();
			const root = (
				cred.compatibleApiUrl ??
				cred.envVars?.COMPATIBLE_API_URL ??
				""
			).replace(/\/$/, "");
			expect(root).toMatch(/^https:\/\//);

			for (const modelId of MODELS) {
			const sandbox = makeSandbox(); // fixtures frescos por modelo
			const coreTools = createCoreTools(sandbox);
			const coreSchemas = Object.values(coreTools).map((t) => ({
				type: "function" as const,
				name: t.name,
				description: t.description,
				parameters: t.parameters,
			}));
			const { turn } = await makeEngine(cred, root, modelId);
			const results: CaseResult[] = [];

			// ── NIVEL A: ciclo real con MINI-LOOP agentic (hasta 3 tool-calls
			//    encadenadas: el modelo puede leer antes de editar, etc.).
			for (const c of CASES_A) {
				const t0 = Date.now();
				const trace: string[] = [];
				try {
					const userMsg = { role: "user", content: [{ type: "text", text: c.prompt }] };
					const history: any[] = [userMsg];
					let calledTarget: { args: any; output: string } | null = null;
					let finalText = "";
					let thinking = 0;

					for (let hop = 0; hop < 3; hop++) {
						const r = await turn(history, coreSchemas);
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
							trace.push(`hop${hop}: args no parsean (${fc.arguments.slice(0, 60)})`);
							results.push({
								level: "A", tool: c.tool, prompt: c.prompt, ok: false,
								phase: "args", detail: trace.join(" · "),
								ms: Date.now() - t0,
							});
							calledTarget = null;
							break;
						}
						// execute REAL de la tool que pidió (cualquiera de las 7)
						let toolOutput = "";
						try {
							const out = await coreTools[fc.name].execute("e2e", args, undefined, undefined, undefined);
							toolOutput = typeof out === "string" ? out : JSON.stringify(out?.content ?? out ?? "");
						} catch (e: any) {
							trace.push(`hop${hop}: ${fc.name} execute ERROR ${String(e?.message ?? e).slice(0, 90)}`);
							// La ejecución falla → igual devolvemos el error como
							// toolResult (como haría el host) para que el modelo
							// pueda recuperarse en el siguiente hop.
							toolOutput = `ERROR: ${String(e?.message ?? e).slice(0, 200)}`;
						}
						trace.push(`hop${hop}: ${fc.name}(${JSON.stringify(args).slice(0, 50)}) → ${toolOutput.slice(0, 40).replace(/\n/g, " ")}`);
						if (fc.name === c.tool && !toolOutput.startsWith("ERROR")) {
							calledTarget = { args, output: toolOutput };
						}
						history.push(
							{ role: "assistant", content: [{ type: "toolCall", id: fc.call_id, name: fc.name, arguments: args }] },
							{ role: "toolResult", toolCallId: fc.call_id, content: [{ type: "text", text: toolOutput.slice(0, 4000) || "(vacío)" }] },
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
							level: "A", tool: c.tool, prompt: c.prompt, ok: false,
							phase: "tool_call", detail: trace.join(" · ").slice(0, 200),
							ms: Date.now() - t0,
						});
						continue;
					}
					const verifyErr =
						c.verify(calledTarget.args, calledTarget.output, finalText, sandbox) ??
						c.diskCheck?.(sandbox) ??
						null;
					results.push({
						level: "A", tool: c.tool, prompt: c.prompt, ok: !verifyErr,
						phase: verifyErr ? "final_answer" : undefined,
						detail: verifyErr ?? `thinking=${thinking}chr · ${trace.length} hops · ok`,
						ms: Date.now() - t0,
					});
				} catch (e: any) {
					results.push({
						level: "A", tool: c.tool, prompt: c.prompt, ok: false,
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
						[{ role: "user", content: [{ type: "text", text: spec.prompt }] }] as any,
						[{ type: "function", name: spec.name, description: spec.description, parameters: spec.parameters }],
					);
					const fc = r.fnCalls[0];
					if (!fc || fc.name !== spec.name) {
						results.push({
							level: "B", tool: spec.name, prompt: spec.prompt, ok: false,
							phase: "generation",
							detail: fc ? `llamó '${fc.name}'` : `sin function_call (stop=${r.stopReason}, text=${r.text.slice(0, 80)})`,
							ms: Date.now() - t0,
						});
						continue;
					}
					let args: any;
					try {
						args = JSON.parse(fc.arguments);
					} catch (e: any) {
						results.push({
							level: "B", tool: spec.name, prompt: spec.prompt, ok: false,
							phase: "args", detail: `arguments no parsean: ${fc.arguments.slice(0, 100)}`,
							ms: Date.now() - t0,
						});
						continue;
					}
					const missing = spec.requiredFields.filter((f) => args?.[f] === undefined);
					results.push({
						level: "B", tool: spec.name, prompt: spec.prompt, ok: missing.length === 0,
						phase: missing.length ? "args" : undefined,
						detail: missing.length
							? `faltan campos requeridos: ${missing.join(", ")} :: ${JSON.stringify(args).slice(0, 120)}`
							: `args ok: ${JSON.stringify(args).slice(0, 100)}`,
						ms: Date.now() - t0,
					});
				} catch (e: any) {
					results.push({
						level: "B", tool: spec.name, prompt: spec.prompt, ok: false,
						detail: `excepción: ${String(e?.message ?? e).slice(0, 140)}`,
						ms: Date.now() - t0,
					});
				}
			}

			// ── Acumular por modelo (reporte consolidado en afterAll) ──
			const okA = results.filter((r) => r.level === "A" && r.ok).length;
			const okB = results.filter((r) => r.level === "B" && r.ok).length;
			console.log(
				`── ${modelId}: A ${okA}/${CASES_A.length} · B ${okB}/${hostToolSchemas().length} ──`,
			);
			allResults.push(...results.map((r) => ({ model: modelId, r })));

			// El test NO falla por tools rotas (el reporte ES el entregable),
			// pero sí exige que el ciclo básico funcionó: si un modelo no
			// puede NINGUNA tool, algo estructural rompió.
			expect(results.filter((r) => r.level === "A" && r.ok).length).toBeGreaterThan(0);
			}
		},
		900_000 * MODELS.length,
	);
});

// ─── Reporte consolidado multi-modelo (issue #60) ───────────────────────────

afterAll(async () => {
	if (!live || allResults.length === 0) return;
	const lines: string[] = [];
	lines.push(`# Reporte E2E tools × ${MODELS.length} modelo(s) (reasoning: ${THINKING})`);
	lines.push("");
	lines.push(`Modelos: ${MODELS.join(", ")}`);
	lines.push(`Fecha: ${new Date().toISOString()} · endpoint: /v1/responses · adapter openai-responses`);
	lines.push("");
	lines.push(`## Resumen`);
	lines.push("");
	for (const modelId of MODELS) {
		const rs = allResults.filter((x) => x.model === modelId).map((x) => x.r);
		if (!rs.length) continue;
		const okA = rs.filter((r) => r.level === "A" && r.ok).length;
		const okB = rs.filter((r) => r.level === "B" && r.ok).length;
		lines.push(
			`- **${modelId}**: Nivel A **${okA}/${rs.filter((r) => r.level === "A").length}** · Nivel B **${okB}/${rs.filter((r) => r.level === "B").length}**`,
		);
	}
	for (const modelId of MODELS) {
		const rs = allResults.filter((x) => x.model === modelId).map((x) => x.r);
		if (!rs.length) continue;
		lines.push("");
		lines.push(`## ${modelId}`);
		lines.push("");
		lines.push(`| Nivel | Tool | Resultado | Fase | Detalle | ms |`);
		lines.push(`|---|---|---|---|---|---|`);
		for (const r of rs) {
			lines.push(
				`| ${r.level} | ${r.tool} | ${r.ok ? "✅" : "❌"} | ${r.phase ?? "—"} | ${(r.detail ?? "").replace(/\|/g, "\\|").slice(0, 160)} | ${r.ms ?? ""} |`,
			);
		}
	}
	lines.push("");
	lines.push(`## Prompts usados (idénticos para cada modelo)`);
	lines.push("");
	const seen = new Set<string>();
	for (const { r } of allResults) {
		if (seen.has(r.tool)) continue;
		seen.add(r.tool);
		lines.push(`- **${r.tool}**: ${r.prompt}`);
	}
	const report = lines.join("\n");
	const reportPath = join(__dirname, "reporte-tools-enterprise.md");
	const fs = await import("node:fs/promises");
	await fs.writeFile(reportPath, report, "utf8");
	console.log(`\n=== REPORTE: ${reportPath} ===\n${report}\n`);
});
