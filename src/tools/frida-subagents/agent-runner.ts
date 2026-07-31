// frida-subagents — motor de ejecución de agentes.
//
// Porte simplificado de pi-subagents/src/agent-runner.ts (ADR-0022 Fase 1).
// Crea sesiones hijas via createAgentSession del SDK de Pi, las ejecuta,
// y extrae el resultado. Fase 1: sin tool scoping, sin model fuzzy, sin
// worktree. Usa el modelo del padre directamente.

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	createAgentSession,
	type AgentSession,
	SessionManager,
	SettingsManager,
	DefaultResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { homedir } from "node:os";
import type { AgentConfig, SpawnOptions } from "./types";
import {
	getAgentConfig as registryGetConfig,
	getAvailableTypes as registryGetTypes,
	getToolNamesForType,
	reloadCustomAgents,
} from "./agent-types";
import { createWorktree, cleanupWorktree, type WorktreeInfo } from "./worktree";
import {
	resolveMemoryDir,
	ensureMemoryDir,
	buildMemoryForAgent,
	hasWriteTools,
} from "./memory";
import { preloadSkills } from "./skill-loader";
import {
	generateAgentId,
	registerAgent,
	updateAgentStatus,
} from "./agent-manager";

/** agentDir de Frida (~/.frida). */
const FRIDA_AGENT_DIR = join(homedir(), ".frida");

/**
 * Resuelve la configuración de un agente por tipo.
 * Recarga custom agents desde disco antes de buscar.
 */
export function resolveAgentConfig(
	type: string,
	cwd: string,
): AgentConfig | undefined {
	reloadCustomAgents(cwd);
	return registryGetConfig(type, cwd);
}

/** Lista los tipos de agente disponibles (para la descripción del tool). */
export function getAvailableTypes(cwd: string): string[] {
	reloadCustomAgents(cwd);
	return registryGetTypes(cwd);
}

/**
 * Ejecuta un subagente: crea sesión hija, corre el prompt, devuelve resultado.
 *
 * Para background: no awaited — devuelve el ID inmediatamente y notifica al
 * completar via options.onComplete.
 *
 * Para foreground: awaited — devuelve el texto del resultado.
 */
export async function runAgent(
	config: AgentConfig,
	options: SpawnOptions,
	ctx: ExtensionContext,
): Promise<{ agentId: string; result?: string }> {
	const agentId = options.resume ?? generateAgentId();
	let cwd = ctx.cwd;
	const description = options.description || config.name;

	// --- Worktree isolation (Fase 5) ---
	let worktreeInfo: WorktreeInfo | undefined;
	if (config.isolation === "worktree" || options.isolation === "worktree") {
		worktreeInfo = createWorktree(cwd, agentId);
		if (worktreeInfo) {
			cwd = worktreeInfo.workPath;
		}
	}

	// --- Memory block (Fase 5) ---
	let memoryBlock = "";
	if (config.memory) {
		const memDir = resolveMemoryDir(config.memory, config.name, ctx.cwd);
		const canWrite = hasWriteTools(config.builtinToolNames);
		if (canWrite) ensureMemoryDir(memDir);
		memoryBlock = buildMemoryForAgent(memDir, canWrite);
	}

	// --- Skill preloading (Fase 5) ---
	let skillsBlock = "";
	if (Array.isArray(config.skills) || typeof config.skills === "string") {
		// config.skills puede ser true | string[] | false; aquí sólo nos interesa
		// cuando es un array o string de nombres específicos.
		const skillNames = config.skills;
		if (typeof skillNames === "string" || Array.isArray(skillNames)) {
			skillsBlock = preloadSkills(skillNames as string | string[], ctx.cwd);
		}
	}

	// --- Construir system prompt compuesto ---
	const extraBlocks = [memoryBlock, skillsBlock].filter(Boolean).join("\n\n");
	const basePrompt =
		config.promptMode === "replace" && config.systemPrompt
			? config.systemPrompt
			: undefined;
	const systemPromptOverride = basePrompt
		? extraBlocks
			? `${basePrompt}\n\n${extraBlocks}`
			: basePrompt
		: extraBlocks || undefined;

	// --- Crear sesión hija ---
	const sessionManager = SessionManager.inMemory(cwd);
	const settingsManager = SettingsManager.create(cwd, FRIDA_AGENT_DIR);
	const toolNames = getToolNamesForType(config);

	const loader = new DefaultResourceLoader({
		cwd,
		agentDir: FRIDA_AGENT_DIR,
		settingsManager,
		...(systemPromptOverride && { systemPrompt: systemPromptOverride }),
	});

	// Modelo: usar el del padre por ahora (Fase 1 sin fuzzy resolution).
	const model = ctx.model ?? undefined;

	const { session } = await createAgentSession({
		cwd,
		agentDir: FRIDA_AGENT_DIR,
		sessionManager,
		settingsManager,
		resourceLoader: loader,
		model,
		// Excluir nuestros propios tools para evitar recursión infinita.
		excludeTools: ["Agent", "get_subagent_result", "steer_subagent"],
		// Aplicar restricción de tools del agente (si la hay).
		...(toolNames && { allowedToolNames: toolNames }),
	});

	session.setSessionName(`${config.name}#${agentId.slice(0, 8)}`);

	// Bind extensions para que los hooks disparen.
	await session.bindExtensions({});

	// Registrar en el manager.
	registerAgent({
		id: agentId,
		type: config.name,
		description,
		status: "running",
		toolUses: 0,
		startedAt: Date.now(),
		session,
	});

	// Trackear turnos + graceful max_turns.
	let turnCount = 0;
	const maxTurns = options.maxTurns ?? config.maxTurns;
	const graceTurns = 5; // Default; configurable via settings en Fase 4+
	let softLimitReached = false;
	let aborted = false;
	(session as AgentSession).subscribe((event: { type: string }) => {
		if (event.type === "turn_end") {
			turnCount++;
			options.onTurnEnd?.(turnCount);

			// Graceful max_turns: aviso "wrap up" al llegar al límite.
			if (
				maxTurns &&
				maxTurns > 0 &&
				turnCount >= maxTurns &&
				!softLimitReached
			) {
				softLimitReached = true;
				// Enviar steering "wrap up".
				void (session as AgentSession).steer(
					"Wrap up immediately — provide your final answer now.",
				);
			}

			// Hard abort tras grace period.
			if (
				maxTurns &&
				maxTurns > 0 &&
				turnCount >= maxTurns + graceTurns &&
				!aborted
			) {
				aborted = true;
				updateAgentStatus(agentId, "aborted");
			}
		}
	});

	// Si es background, no esperar — arrancar en fondo.
	if (options.runInBackground) {
		const promise = runSessionPrompt(
			session as AgentSession,
			options.prompt,
			agentId,
			config,
			options,
		);
		// Guardar el promise para get_subagent_result(wait: true).
		const record = {
			id: agentId,
			type: config.name,
			description,
			status: "running" as const,
			toolUses: 0,
			startedAt: Date.now(),
			session,
			promise,
		};
		registerAgent(record);

		return { agentId };
	}

	// Foreground: esperar el resultado.
	try {
		const result = await runSessionPrompt(
			session as AgentSession,
			options.prompt,
			agentId,
			config,
			options,
		);
		// Worktree cleanup tras completar.
		if (worktreeInfo) {
			cleanupWorktree(worktreeInfo);
		}
		return { agentId, result };
	} catch (e) {
		updateAgentStatus(
			agentId,
			"error",
			undefined,
			e instanceof Error ? e.message : String(e),
		);
		throw e;
	}
}

/**
 * Ejecuta el prompt en la sesión y extrae el resultado.
 * Devuelve el texto del último mensaje del asistente.
 */
async function runSessionPrompt(
	session: AgentSession,
	prompt: string,
	agentId: string,
	config: AgentConfig,
	options: SpawnOptions,
): Promise<string> {
	await session.prompt(prompt);

	// Extraer el último mensaje del asistente.
	const messages = (
		session as unknown as {
			state: { messages: Array<{ role: string; content?: unknown }> };
		}
	).state?.messages;

	let resultText = "";
	if (messages && messages.length > 0) {
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			if (msg.role === "assistant") {
				resultText = extractText(msg);
				break;
			}
		}
	}

	updateAgentStatus(agentId, "completed", resultText);
	options.onComplete?.(resultText, {
		id: agentId,
		type: config.name,
		description: options.description,
		status: "completed",
		toolUses: 0,
		startedAt: Date.now(),
		completedAt: Date.now(),
		result: resultText,
	});

	return resultText;
}

/** Extrae texto plano de un mensaje (maneja content string o array). */
function extractText(msg: { content?: unknown }): string {
	const content = msg.content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter(
				(c) =>
					typeof c === "object" &&
					c !== null &&
					(c as { type?: string }).type === "text" &&
					typeof (c as { text?: unknown }).text === "string",
			)
			.map((c) => (c as { text: string }).text)
			.join("\n");
	}
	return "";
}

/**
 * Inyecta un mensaje steering en una sesión en ejecución.
 */
export async function steerAgent(
	agentId: string,
	message: string,
): Promise<boolean> {
	// Buscar el agente en el manager.
	const record = getAgentRecord(agentId);
	if (!record?.session) return false;

	const session = record.session as AgentSession;
	await session.steer(message);
	return true;
}

/** Helper: obtener un registro sin importar el módulo (evita circular). */
function getAgentRecord(id: string): { session?: unknown } | undefined {
	// Import dinámico para evitar circularidad con agent-manager.
	const { getAgent } = require("./agent-manager");
	return getAgent(id);
}
