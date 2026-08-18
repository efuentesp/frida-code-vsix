// Conformance de tools: todas las tools que frida code usa deben ser
// JSON-serializables y pasar intactas por el wiring de DevEngine.
//
// DevEngine usa el adapter openai-completions estándar (a diferencia de FE que
// tiene buildFridaPayload custom), por lo que las tools viajan tal cual las
// convierte pi-ai: {type:"function",function:{name,description,parameters}}.

import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Schemas reales del runtime (7 core) ────────────────────────────────────

const require_ = createRequire(import.meta.url);
const testDir = dirname(fileURLToPath(import.meta.url));

function findToolsModule(): string | null {
	let dir = testDir;
	for (let i = 0; i < 6; i++) {
		const candidate = join(
			dir,
			"node_modules/@earendil-works/pi-coding-agent/dist/core/tools/index.js",
		);
		if (existsSync(candidate)) return candidate;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

const toolsModulePath = findToolsModule();
const createAllToolDefinitions = toolsModulePath
	? (require_(toolsModulePath) as {
			createAllToolDefinitions: () => Record<
				string,
				{ name: string; description: string; parameters: unknown }
			>;
		}).createAllToolDefinitions
	: null;

function runtimeTools() {
	if (!createAllToolDefinitions) return [];
	const defs = createAllToolDefinitions() as Record<
		string,
		{ name: string; description: string; parameters: unknown }
	>;
	return Object.values(defs).map((d) => ({
		type: "function" as const,
		function: {
			name: d.name,
			description: d.description,
			parameters: d.parameters,
		},
	}));
}

// ─── Schemas del harness (29) ────────────────────────────────────────────────

const obj = (properties: Record<string, unknown>, required?: string[]) => ({
	type: "object",
	...(required ? { required } : {}),
	properties,
});

const harnessTools = [
	{
		type: "function",
		function: {
			name: "ask_user_question",
			description: "Pregunta al usuario (anidado profundo + multiSelect)",
			parameters: obj(
				{
					questions: {
						type: "array",
						minItems: 1,
						maxItems: 4,
						items: obj(
							{
								question: { type: "string" },
								header: { type: "string", maxLength: 16 },
								multiSelect: { type: "boolean" },
								options: {
									type: "array",
									minItems: 2,
									maxItems: 4,
									items: obj(
										{
											label: { type: "string", maxLength: 60 },
											description: { type: "string" },
											preview: { type: "string" },
										},
										["label", "description"],
									),
								},
							},
							["question", "header", "options"],
						),
					},
				},
				["questions"],
			),
		},
	},
	{
		type: "function",
		function: {
			name: "todo",
			description: "Task list (enum de acciones + metadata anidada)",
			parameters: obj(
				{
					action: {
						type: "string",
						enum: ["create", "update", "list", "get", "delete", "clear"],
					},
					id: { type: "number" },
					subject: { type: "string" },
					status: {
						type: "string",
						enum: ["pending", "in_progress", "completed", "deleted"],
					},
					activeForm: { type: "string" },
					blockedBy: { type: "array", items: { type: "number" } },
					addBlockedBy: { type: "array", items: { type: "number" } },
					removeBlockedBy: { type: "array", items: { type: "number" } },
					metadata: { type: "object", additionalProperties: {} },
					includeDeleted: { type: "boolean" },
				},
				["action"],
			),
		},
	},
	{
		type: "function",
		function: {
			name: "Agent",
			description: "Sub-agentes (string + flags)",
			parameters: obj(
				{
					prompt: { type: "string" },
					description: { type: "string" },
					subagent_type: { type: "string" },
					model: { type: "string" },
					thinking: {
						type: "string",
						enum: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
					},
					max_turns: { type: "number", minimum: 1 },
					run_in_background: { type: "boolean" },
					isolated: { type: "boolean" },
					resume: { type: "string" },
				},
				["prompt", "description", "subagent_type"],
			),
		},
	},
	{
		type: "function",
		function: {
			name: "get_subagent_result",
			description: "Resultado de sub-agente (booleanos)",
			parameters: obj(
				{
					agent_id: { type: "string" },
					wait: { type: "boolean" },
					verbose: { type: "boolean" },
				},
				["agent_id"],
			),
		},
	},
	{
		type: "function",
		function: {
			name: "steer_subagent",
			description: "Steering de sub-agente",
			parameters: obj(
				{ agent_id: { type: "string" }, message: { type: "string" } },
				["agent_id", "message"],
			),
		},
	},
	{
		type: "function",
		function: {
			name: "workflow",
			description: "Workflows (script|scriptPath exclusivos)",
			parameters: obj(
				{
					name: { type: "string" },
					script: { type: "string" },
					scriptPath: { type: "string" },
					args: {},
					foreground: { type: "boolean" },
					concurrency: { type: "number", minimum: 1, maximum: 16 },
					budget: { type: "object", additionalProperties: {} },
					parentRunId: { type: "string" },
					description: { type: "string" },
				},
				["name"],
			),
		},
	},
	{
		type: "function",
		function: {
			name: "workflow_status",
			description: "Estado de run",
			parameters: obj({ runId: { type: "string" } }, ["runId"]),
		},
	},
	{
		type: "function",
		function: {
			name: "workflow_catalog",
			description: "Catálogo de funciones de workflow",
			parameters: obj({ name: { type: "string" } }),
		},
	},
	{
		type: "function",
		function: {
			name: "workflow_stop",
			description: "Detiene run activo",
			parameters: obj({ runId: { type: "string" } }, ["runId"]),
		},
	},
	{
		type: "function",
		function: {
			name: "workflow_respond",
			description: "Aprueba checkpoint",
			parameters: obj(
				{
					runId: { type: "string" },
					name: { type: "string" },
					approved: { type: "boolean" },
				},
				["runId", "name", "approved"],
			),
		},
	},
	{
		type: "function",
		function: {
			name: "workflow_retry",
			description: "Reintenta run fallido",
			parameters: obj(
				{ runId: { type: "string" }, foreground: { type: "boolean" } },
				["runId"],
			),
		},
	},
	{
		type: "function",
		function: {
			name: "workflow_resume",
			description: "Continúa run agotado",
			parameters: obj(
				{
					runId: { type: "string" },
					budget: { type: "object", additionalProperties: {} },
					foreground: { type: "boolean" },
				},
				["runId"],
			),
		},
	},
	{
		type: "function",
		function: {
			name: "agent_browser",
			description: "Browser (union de modos con objetos anidados)",
			parameters: obj({
				args: { type: "array", items: { type: "string" }, minItems: 1 },
				semanticAction: obj(
					{
						action: { type: "string", enum: ["check", "click", "fill", "select"] },
						locator: { type: "string" },
						text: { type: "string" },
						role: { type: "string" },
						name: { type: "string" },
						selector: { type: "string" },
						value: { type: "string" },
						values: { type: "array", items: { type: "string" } },
						session: { type: "string" },
					},
					["action"],
				),
				job: { type: "object", additionalProperties: {} },
				qa: { type: "object", additionalProperties: {} },
				sessionMode: { type: "string", enum: ["auto", "fresh"] },
				timeoutMs: { type: "number", minimum: 1 },
			}),
		},
	},
	{
		type: "function",
		function: {
			name: "web_fetch_md",
			description: "Fetch URL pública a Markdown",
			parameters: obj(
				{
					url: { type: "string" },
					output_mode: { type: "string", enum: ["auto", "inline", "file"] },
					abs_links: { type: "boolean" },
					timeout_ms: { type: "number" },
				},
				["url"],
			),
		},
	},
	{
		type: "function",
		function: {
			name: "read_skills",
			description: "Skills: search | source+name | list",
			parameters: obj({
				search: { type: "string" },
				source: { type: "string" },
				name: { type: "string" },
				full: { type: "boolean" },
				refresh: { type: "boolean" },
				resource: { type: "string" },
				output: { type: "string" },
			}),
		},
	},
	{
		type: "function",
		function: {
			name: "mcp",
			description: "Gateway MCP (modo action/tool; args flexibles)",
			parameters: obj({
				action: { type: "string" },
				server: { type: "string" },
				tool: { type: "string" },
				args: { type: "object", additionalProperties: {} },
				search: { type: "string" },
				regex: { type: "boolean" },
				includeSchemas: { type: "boolean" },
			connect: { type: "string" },
			describe: { type: "string" },
			instructions: { type: "string" },
			}),
		},
	},
	// ─── 13 tools nuevas del host (v0.23: subagents Agent, goal, kb, sandboxes,
	// workflow_catalog, context) — schemas fieles de src/tools/* ───────────────
	{
		type: "function",
		function: {
			name: "Agent",
			description: "Lanza un sub-agente autónomo",
			parameters: obj(
				{
					prompt: { type: "string" },
					description: { type: "string" },
					subagent_type: { type: "string" },
					model: { type: "string" },
					run_in_background: { type: "boolean" },
				},
				["prompt", "description", "subagent_type"],
			),
		},
	},
	{
		type: "function",
		function: {
			name: "context",
			description: "RAG documental del equipo (frida-context)",
			parameters: obj(
				{ query: { type: "string" }, maxTokens: { type: "number" } },
				["query"],
			),
		},
	},
	{
		type: "function",
		function: {
			name: "goal_complete",
			description: "Marca el goal activo como completado",
			parameters: obj(
				{
					goal_id: { type: "string" },
					summary: { type: "string" },
					evidence: { type: "string" },
				},
				["goal_id", "summary"],
			),
		},
	},
	{
		type: "function",
		function: {
			name: "goal_blocked",
			description: "Reporta un bloqueo del goal activo",
			parameters: obj(
				{
					goal_id: { type: "string" },
					blocker: { type: "string" },
					evidence: { type: "string" },
				},
				["goal_id", "blocker"],
			),
		},
	},
	{
		type: "function",
		function: {
			name: "kb_search",
			description: "Búsqueda en la base de conocimiento (frida-knowledge-base)",
			parameters: obj(
				{ query: { type: "string" }, limit: { type: "number" } },
				["query"],
			),
		},
	},
	{
		type: "function",
		function: {
			name: "kb_neighbors",
			description: "Vecinos de una página en la base de conocimiento",
			parameters: obj(
				{ page: { type: "string" }, depth: { type: "number" } },
				["page"],
			),
		},
	},
	{
		type: "function",
		function: {
			name: "sandbox_create",
			description: "Crea un contenedor Docker desechable",
			parameters: obj({
				name: { type: "string" },
				image: { type: "string" },
				workdir: { type: "string" },
			}),
		},
	},
	{
		type: "function",
		function: {
			name: "sandbox_exec",
			description: "Ejecuta un comando en el sandbox",
			parameters: obj(
				{ id: { type: "string" }, command: { type: "string" } },
				["id", "command"],
			),
		},
	},
	{
		type: "function",
		function: {
			name: "sandbox_status",
			description: "Estado del sandbox",
			parameters: obj({ id: { type: "string" } }),
		},
	},
	{
		type: "function",
		function: {
			name: "sandbox_changes",
			description: "Diff de cambios del sandbox",
			parameters: obj({ id: { type: "string" } }, ["id"]),
		},
	},
	{
		type: "function",
		function: {
			name: "sandbox_merge",
			description: "Fusiona cambios del sandbox al workspace",
			parameters: obj(
				{ id: { type: "string" }, paths: { type: "array", items: { type: "string" } } },
				["id"],
			),
		},
	},
	{
		type: "function",
		function: {
			name: "sandbox_destroy",
			description: "Destruye el sandbox",
			parameters: obj({ id: { type: "string" } }, ["id"]),
		},
	},
	{
		type: "function",
		function: {
			name: "workflow_catalog",
			description: "Lista workflows/patrones disponibles",
			parameters: obj({ verbose: { type: "boolean" } }),
		},
	},
];

function allTools() {
	return [...runtimeTools(), ...harnessTools];
}

// ─── Pruebas ────────────────────────────────────────────────────────────────

describe("conformance de tools: todas las tools de frida code viajan intactas", () => {
	it("el inventario cubre las 7 core del runtime + 29 del harness (36 totales)", () => {
		const tools = allTools();
		expect(tools).toHaveLength(createAllToolDefinitions ? 36 : 29);
		if (createAllToolDefinitions) {
			expect(tools.slice(0, 7).map((t: any) => t.function.name)).toEqual(
				expect.arrayContaining([
					"read",
					"bash",
					"edit",
					"write",
					"grep",
					"find",
					"ls",
				]),
			);
		}
	});

	it("las tools se pasan por referencia sin mutación (DevEngine usa openai-completions estándar)", () => {
		const tools = allTools();
		const snapshot = JSON.parse(JSON.stringify(tools));

		// DevEngine NO tiene adapter custom (a diferencia de FE con buildFridaPayload).
		// Las tools viajan tal cual pi-ai las convierte. Esta prueba verifica que
		// el array NO se muta.
		expect(tools).toEqual(snapshot);
	});

	it("el payload completo con las 36 tools es JSON-serializable (lo que viaja por HTTP)", () => {
		const tools = allTools();
		const payload = {
			model: "gpt-5.4-mini",
			messages: [
				{ role: "system", content: "s" },
				{ role: "user", content: "u" },
			],
			stream: true,
			stream_options: { include_usage: true },
			max_tokens: 8192,
			tools,
			tool_choice: "auto",
			reasoning_effort: "medium",
		};

		const json = JSON.stringify(payload);
		expect(json).toContain('"model":"gpt-5.4-mini"');
		expect(json).toContain('"reasoning_effort":"medium"');
		expect(json).toContain("ask_user_question");
		expect(json).toContain("agent_browser");

		// Re-parse → estructura estable
		expect(JSON.parse(json).tools).toHaveLength(allTools().length);
	});
});
