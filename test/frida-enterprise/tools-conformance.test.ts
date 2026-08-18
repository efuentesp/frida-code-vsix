// ADR-1002 — TDD: TODAS las tools que frida code usa deben sobrevivir intactas
// a la traducción Pi→Frida (buildFridaPayload) y ser JSON-serializables tal
// como las convierte pi-ai (convertTools: {type:"function",function:{...}}).
//
// Fuentes de las schemas:
//  • 7 tools core: createAllToolDefinitions() del propio runtime pi-coding-agent
//    (read, bash, edit, write, grep, find, ls) — las schemas EXACTAS que viajan.
//  • 16 tools de extensión del harness: replicadas fielmente de sus contratos
//    (anidados, enums, arrays, opcionales/obligatorios, oneOf/anyOf de mcp).

import { describe, expect, it } from "vitest";
import { buildFridaPayload } from "../../src/providers/frida-enterprise/adapter";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// El entry del paquete (única vía del exports map) arrastra undici y rompe
// bajo vitest. El submódulo de tools es CJS puro: lo cargamos por ruta
// absoluta buscando node_modules hacia arriba desde el test (require de ruta
// absoluta no pasa por el exports map). Si el paquete no está instalado
// (p. ej. esta carpeta copiada fuera del repo), las schemas core se omiten
// con skip explícito y las del harness siguen corriendo.
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

// ─── Schemas reales del runtime (7 core) ────────────────────────────────────

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

// ─── Schemas replicadas del harness (16) ────────────────────────────────────

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
					status: { type: "string", enum: ["pending", "in_progress", "completed", "deleted"] },
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
					thinking: { type: "string", enum: ["off", "minimal", "low", "medium", "high", "xhigh", "max"] },
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
			description: "Workflows (script|scriptPath exclusivos por descripción)",
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
				{ runId: { type: "string" }, name: { type: "string" }, approved: { type: "boolean" } },
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
			parameters: obj(
				{
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
				},
			),
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
			parameters: obj(
				{
					search: { type: "string" },
					source: { type: "string" },
					name: { type: "string" },
					full: { type: "boolean" },
					refresh: { type: "boolean" },
					resource: { type: "string" },
					output: { type: "string" },
				},
			),
		},
	},
	{
		type: "function",
		function: {
			name: "mcp",
			description: "Gateway MCP (modo action/tool por descripción; args flexibles)",
			parameters: obj(
				{
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
				},
			),
		},
	},
];

function allTools() {
	return [...runtimeTools(), ...harnessTools];
}

// ─── Pruebas ────────────────────────────────────────────────────────────────

describe("conformance de tools: todas las tools de frida code viajan intactas", () => {
	const identity = { user_id: "uid-1", email: "u@softtek.com" };

	it("el inventario cubre las 7 core del runtime + 16 del harness (23 en repo)", () => {
		const tools = allTools();
		expect(tools).toHaveLength(createAllToolDefinitions ? 23 : 16);
		if (createAllToolDefinitions) {
			expect(tools.slice(0, 7).map((t: any) => t.function.name)).toEqual(
				expect.arrayContaining(["read", "bash", "edit", "write", "grep", "find", "ls"]),
			);
		}
	});

	it("buildFridaPayload pasa el array completo de tools POR REFERENCIA (sin copia ni mutación)", () => {
		const tools = allTools();
		const snapshot = JSON.parse(JSON.stringify(tools));
		const out = buildFridaPayload(
			{ model: "M", messages: [], stream: true, tools },
			identity,
		);
		expect(out.tools).toBe(tools); // passthrough exacto
		expect(tools).toEqual(snapshot); // sin mutación
		expect(out.user_id).toBe("uid-1");
		expect(out.auto_log).toBe(true);
	});

	it("el payload completo con las 23 tools es JSON-serializable (lo que viaja por HTTP)", () => {
		const payload = buildFridaPayload(
			{
				model: "NIKE-VICTORY",
				messages: [{ role: "system", content: "s" }, { role: "user", content: "u" }],
				stream: true,
				stream_options: { include_usage: true },
				max_tokens: 8192,
				tools: allTools(),
				tool_choice: "auto",
				reasoning_effort: "medium",
			},
			identity,
		);
		const json = JSON.stringify(payload);
		expect(json).toContain('"auto_log":true');
		expect(json).toContain('"reasoning":{"effort":"medium"}');
		expect(json).not.toContain("reasoning_effort");
		expect(json).toContain("ask_user_question");
		expect(json).toContain("agent_browser");
		// re-parse → estructura estable
		expect(JSON.parse(json).tools).toHaveLength(allTools().length);
	});

	it("cada schema core del runtime es JSON-Schema válida (sólo dentro del repo)", () => {
		if (!createAllToolDefinitions) return; // fuera del repo: sin node_modules
		for (const t of runtimeTools() as any[]) {
			expect(t.function.parameters).toMatchObject({ type: "object" });
			expect(typeof t.function.name).toBe("string");
			expect(t.function.description.length).toBeGreaterThan(0);
		}
	});
});
