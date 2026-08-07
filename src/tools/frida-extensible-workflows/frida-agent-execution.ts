// frida-extensible-workflows — ejecutor de agentes adaptado a Frida (Fase 2).
//
// runWorkflow (Fase 1) consume un `WorkflowBridge` cuyas funciones agent/shell
// ejecutan el trabajo real. Aquí construimos ese bridge para el extension host
// de VS Code:
//   - agent(): spawner real que crea una sesión hija vía createAgentSession
//     (ADR-0002 SDK en-proceso), propaga el ModelRuntime del padre (ADR-0010/
//     0022 — auth en SecretStorage), corre el prompt y devuelve el resultado
//     como JsonValue. Foreground (awaited).
//   - shell(): delega al executeShellCommand vendorizado (Fase 1).
//
// D6 (import.meta.resolve) queda EVITADO por diseño: el ModelRuntime proviene
// del ctx del tool, no de resolver el binario `pi`. El handoff en vivo a
// terminal (herdr) no aplica a Frida. El spawner es inyectable para que los
// tests de vitest pasen un mock (sin modelo real).
//
// Fase 2 es foreground-only: cada agent() hereda el modelo del padre y se
// ejecuta await-ed. La concurrencia de parallel() corre sin límite (el
// FairAgentScheduler con tope por concurrency llega en fases posteriores).

import {
	createAgentSession,
	DefaultResourceLoader,
	type ModelRuntime,
	SessionManager,
	SettingsManager,
	type AgentSession,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { executeShellCommand } from "./core/execution";
import { loadAgentDefinitions } from "./core/validation";
import type {
	AgentDefinition,
	AgentIdentity,
	JsonValue,
	ShellIdentity,
	ShellOptions,
	ShellResult,
	WorkflowBridge,
} from "./core/types";
import { fridaDefaultAgentDir } from "./frida-paths";

// Herramientas excluidas en las sesiones hijas del workflow para evitar
// recursión infinita (un sub-agente no debe lanzar workflows ni sub-agentes).
// Equivalente al excludeTools de frida-subagents (ADR-0022).
const WORKFLOW_EXCLUDED_TOOLS = [
	"workflow",
	"workflow_status",
	"workflow_respond",
	"workflow_stop",
	"workflow_retry",
	"workflow_resume",
	"workflow_catalog",
	"Agent",
	"get_subagent_result",
	"steer_subagent",
];

export type SpawnAgentFn = (
	prompt: string,
	options: Readonly<Record<string, JsonValue>>,
	signal: AbortSignal,
	identity: AgentIdentity,
) => Promise<JsonValue>;

/**
 * Resuelve los overrides de modelo/thinking/tools para una llamada agent(),
 * considerando `options.role` (string | {name, ...overrides}) y las definiciones
 * de rol cargadas. Función pura (testeable sin SDK). Sin rol, usa options directas.
 */
export function resolveRoleOverrides(
	options: Readonly<Record<string, JsonValue>>,
	roles: Readonly<Record<string, AgentDefinition>>,
): { model?: string; thinking?: string; tools?: readonly string[] } {
	const roleOption = options.role as
		| string
		| { name?: string; model?: string; thinking?: string; tools?: string[] }
		| undefined;
	const roleName =
		typeof roleOption === "string" ? roleOption : roleOption?.name;
	if (!roleName) {
		return {
			...(typeof options.model === "string" ? { model: options.model } : {}),
			...(typeof options.thinking === "string"
				? { thinking: options.thinking }
				: {}),
			...(Array.isArray(options.tools)
				? { tools: options.tools as string[] }
				: {}),
		};
	}
	const def = roles[roleName];
	const obj = typeof roleOption === "object" && roleOption ? roleOption : {};
	const model = obj.model ?? def?.model;
	const thinking = obj.thinking ?? def?.thinking;
	const tools = obj.tools ?? def?.tools;
	return {
		...(model ? { model } : {}),
		...(thinking ? { thinking } : {}),
		...(tools ? { tools } : {}),
	};
}

export interface WorkflowBridgeOptions {
	cwd: string;
	/** Spawner de agentes. El real (createFridaAgentSpawner) en el host; mock en tests. */
	agent: SpawnAgentFn;
}

/**
 * Construye el `WorkflowBridge` que runWorkflow consume. `agent` se inyecta.
 */
export function createWorkflowBridge(
	opts: WorkflowBridgeOptions,
): WorkflowBridge {
	return {
		agent: opts.agent as NonNullable<WorkflowBridge["agent"]>,
		shell: (
			command: string,
			options: ShellOptions,
			signal: AbortSignal,
			_identity: ShellIdentity,
		): Promise<ShellResult> =>
			executeShellCommand(command, options, signal, opts.cwd),
	};
}

/** Extrae el valor (texto) del último mensaje asistente de la sesión. */
function lastAssistantValue(session: AgentSession): JsonValue {
	const messages = (
		session as unknown as {
			state?: { messages?: Array<{ role?: string; content?: unknown }> };
		}
	).state?.messages;
	if (!messages) return null;
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg?.role === "assistant") return contentToValue(msg.content);
	}
	return null;
}

function contentToValue(content: unknown): JsonValue {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		const texts = content
			.filter(
				(c): c is { type: "text"; text: string } =>
					typeof c === "object" &&
					c !== null &&
					(c as { type?: string }).type === "text" &&
					typeof (c as { text?: unknown }).text === "string",
			)
			.map((c) => c.text);
		return texts.length ? texts.join("\n") : null;
	}
	return null;
}

/**
 * Spawner REAL de agentes del workflow (extension host). Crea una sesión hija
 * aislada por llamada a agent(), propaga el ModelRuntime del padre, corre el
 * prompt y devuelve el resultado como JsonValue. Foreground (awaited).
 */
export function createFridaAgentSpawner(
	ctx: ExtensionContext,
	opts?: { roles?: Readonly<Record<string, AgentDefinition>> },
): SpawnAgentFn {
	const roles =
		opts?.roles ?? loadAgentDefinitions(ctx.cwd, fridaDefaultAgentDir(), true);
	return async (prompt, options, signal) => {
		const agentDir = fridaDefaultAgentDir();
		const sessionManager = SessionManager.inMemory(ctx.cwd);
		const settingsManager = SettingsManager.create(ctx.cwd, agentDir);
		const resourceLoader = new DefaultResourceLoader({
			cwd: ctx.cwd,
			agentDir,
			settingsManager,
		});
		// ADR-0010/0022: las API keys de providers con SecretStorage viven en el
		// runtime del padre; sin propagar modelRuntime, la hija falla con
		// "No API key found".
		const parentModelRuntime = (
			ctx.modelRegistry as unknown as { runtime?: ModelRuntime }
		).runtime;
		const overrides = resolveRoleOverrides(options, roles);
		const sessionModel = overrides.model ?? ctx.model;

		const { session } = await createAgentSession({
			cwd: ctx.cwd,
			agentDir,
			sessionManager,
			settingsManager,
			resourceLoader,
			...(parentModelRuntime ? { modelRuntime: parentModelRuntime } : {}),
			...(sessionModel ? { model: sessionModel } : {}),
			...(overrides.thinking
				? { thinkingLevel: overrides.thinking as never }
				: {}),
			...(overrides.tools ? { allowedToolNames: [...overrides.tools] } : {}),
			excludeTools: WORKFLOW_EXCLUDED_TOOLS,
		});

		// Abort del workflow (señal del tool padre) → abort de la sesión hija.
		const sessionAbort = session as unknown as {
			abort(): Promise<void> | void;
			dispose?(): Promise<void> | void;
		};
		const onAbort = () => {
			void sessionAbort.abort();
		};
		if (signal.aborted) void sessionAbort.abort();
		else signal.addEventListener("abort", onAbort, { once: true });

		try {
			await session.prompt(prompt);
			return lastAssistantValue(session);
		} finally {
			signal.removeEventListener("abort", onAbort);
			await sessionAbort.dispose?.();
		}
	};
}
