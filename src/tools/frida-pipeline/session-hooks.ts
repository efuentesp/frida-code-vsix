// frida-pipeline — cableado de hooks de sesión (Fases 2–3).
//
// Porte de `rpiv-core/session-hooks.ts` (ADR-0021 Fase 2). Cada cuerpo de
// handler es una función nombrada; las líneas `pi.on(...)` son puro cableado.
// El orden y los invariantes se preservan del original.
//
// Fase 2: guidance + git-context. Fase 3: session-capture (modelo baseline)
// + skill-bracket (override de modelo por skill). Las Fases 4
// (pipeline-pointer) y 5 (agents-sync) añadirán sus handlers aquí.

import {
	type BeforeAgentStartEvent,
	type BeforeAgentStartEventResult,
	type ExtensionAPI,
	type ExtensionContext,
	isToolCallEventType,
	type SessionCompactEvent,
	type SessionStartEvent,
	type ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { FLAG_DEBUG, MSG_TYPE_GIT_CONTEXT } from "./constants";
import {
	clearGitContextCache,
	isGitMutatingCommand,
	resetInjectedMarker,
	takeGitContextIfChanged,
} from "./git-context";
import {
	clearInjectionState,
	handleToolCallGuidance,
	injectRootGuidance,
} from "./guidance";
import { injectPipelinePointer } from "./pipeline-pointer";
import { registerSessionCapture } from "./session-capture";
import { registerSkillBracket } from "./skill-bracket";
import { syncBundledAgents, formatSyncReport } from "./agents-sync";
import { syncBundledSkills } from "./skills-sync";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Registro (puro cableado)
// ---------------------------------------------------------------------------

/**
 * Registra todos los hooks de sesión de frida-pipeline en la instancia de Pi.
 *
 * Orden de registro (load-bearing):
 *   0. session-capture + skill-bracket (Fase 3) — capturan modelo baseline y
 *      arman overrides de skill. Deben registrarse ANTES para que su hook
 *      input/session_start estén en la cadena.
 *   1. session_start    → guidance raíz + git-context (antes del primer turno)
 *   2. session_compact  → reset de estado + reinyectar (transcript limpiado)
 *   3. session_shutdown → reset de estado
 *   4. tool_call        → guidance por archivo tocado + invalidar cache de git
 *   5. before_agent_start → git-context si cambió desde la última inyección
 *
 * Idempotente: Pi deduplica handlers con la misma referencia de función.
 */
export function registerSessionHooks(pi: ExtensionAPI): void {
	// Fase 3: captura de modelo baseline + override por skill.
	registerSessionCapture(pi);
	registerSkillBracket(pi);

	// Fase 2: guidance recursiva + git-context.
	pi.on("session_start", (event, ctx) => onSessionStart(event, ctx, pi));
	pi.on("session_compact", (event, ctx) => onSessionCompact(event, ctx, pi));
	pi.on("session_shutdown", () => onSessionShutdown());
	pi.on("tool_call", (event, ctx) => onToolCall(event, ctx, pi));
	pi.on("before_agent_start", (event, ctx) =>
		onBeforeAgentStart(event, ctx, pi),
	);
}

/**
 * Latch para el maintenance de inicio (sync de agentes). Pi dispara
 * `session_start` por cada sesión, incluidas las programáticas (stages de
 * workflow), pero el sync debe correr UNA vez por carga de proceso: el
 * banner reimprimiría en cada stage, y syncBundledAgents recalcula hashes
 * idénticos. `/frida-update-agents` y `/reload` siguen siendo los caminos
 * explícitos de re-sync.
 */
let startupMaintenanceDone = false;

/** Test reset. */
export function __resetStartupMaintenance(): void {
	startupMaintenanceDone = false;
}

/** Directorio agentDir de Frida (~/.frida). */
function fridaAgentDir(): string {
	return join(homedir(), ".frida");
}

// ---------------------------------------------------------------------------
// Handlers nombrados
// ---------------------------------------------------------------------------

/**
 * session_start: reinicia el estado de dedup, inyecta la guidance raíz
 * (architecture.md) y el git-context. Corre en CADA fire (cada stage de
 * workflow necesita su propio guidance + git-context).
 */
async function onSessionStart(
	_event: SessionStartEvent,
	ctx: ExtensionContext,
	pi: ExtensionAPI,
): Promise<void> {
	clearInjectionState();
	injectRootGuidance(ctx.cwd, pi);
	injectPipelinePointer(pi);
	await injectGitContext(pi, (msg) => sendGitContextMessage(pi, msg));

	// Fase 5: sync de agentes + skills una vez por proceso.
	if (startupMaintenanceDone) return;
	startupMaintenanceDone = true;
	const agentDir = fridaAgentDir();
	syncBundledSkills(agentDir);
	const result = syncBundledAgents(false, agentDir);
	if (
		ctx.hasUI &&
		(result.pendingUpdate.length > 0 || result.pendingRemove.length > 0)
	) {
		ctx.ui.notify(formatSyncReport(result), "info");
	}
}

/**
 * session_compact: el transcript se limpió → resetear TODO el estado de dedup
 * (guidance y git-context) y reinyectar. La auto-compaction corre en paralelo
 * al dispose de la sesión; si el ctx está muerto, los sendMessage fallarían —
 * pero la sesión compactada se descarta de todas formas y la sesión de
 * reemplazo re-corre session_start.
 */
async function onSessionCompact(
	_event: SessionCompactEvent,
	ctx: ExtensionContext,
	pi: ExtensionAPI,
): Promise<void> {
	clearInjectionState();
	clearGitContextCache();
	resetInjectedMarker();
	injectRootGuidance(ctx.cwd, pi);
	injectPipelinePointer(pi);
	await injectGitContext(pi, (msg) => sendGitContextMessage(pi, msg));
}

/** session_shutdown: libera el estado de dedup y caches. */
function onSessionShutdown(): void {
	clearInjectionState();
	clearGitContextCache();
	resetInjectedMarker();
}

/**
 * tool_call: inyección de guidance por archivo tocado (read/edit/write) +
 * invalidación del cache de git si el comando bash muta el estado de git.
 *
 * Corre incondicionalmente — la inyección de guidance por tool_call y la
 * invalidación del cache de git son preocupaciones por-evento, no
 * anuncios al usuario.
 */
function onToolCall(
	event: ToolCallEvent,
	ctx: ExtensionContext,
	pi: ExtensionAPI,
): void {
	handleToolCallGuidance(event, ctx, pi);
	// Un comando git mutante (checkout, commit, merge…) cambia branch/commit.
	// Invalidar el cache para que el próximo before_agent_start vea el nuevo.
	if (
		isToolCallEventType("bash", event) &&
		isGitMutatingCommand(event.input.command)
	) {
		clearGitContextCache();
	}
}

/**
 * before_agent_start: si el git-context cambió desde la última inyección
 * (branch swap, nuevo commit), inyectar el bloque actualizado. La dedup la
 * maneja `takeGitContextIfChanged` internamente.
 *
 * Devuelve un `{ message }` para que Pi lo inserte antes del turno del agente.
 */
async function onBeforeAgentStart(
	_event: BeforeAgentStartEvent,
	_ctx: ExtensionContext,
	pi: ExtensionAPI,
): Promise<
	| { message: { customType: string; content: string; display: boolean } }
	| undefined
> {
	const content = await takeGitContextIfChanged(pi);
	if (!content) return undefined;
	return {
		message: {
			customType: MSG_TYPE_GIT_CONTEXT,
			content,
			display: !!pi.getFlag(FLAG_DEBUG),
		},
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Inyecta el git-context si `takeGitContextIfChanged` detectó un cambio. */
async function injectGitContext(
	pi: ExtensionAPI,
	send: (msg: string) => void,
): Promise<void> {
	const msg = await takeGitContextIfChanged(pi);
	if (msg) send(msg);
}

/** Envía un mensaje de git-context al transcript (display sólo si --frida-debug). */
function sendGitContextMessage(pi: ExtensionAPI, content: string): void {
	pi.sendMessage({
		customType: MSG_TYPE_GIT_CONTEXT,
		content,
		display: !!pi.getFlag(FLAG_DEBUG),
	});
}

/** Tipo de retorno inferido para before_agent_start (compatibilidad con Pi). */
export type BeforeAgentStartReturn = BeforeAgentStartEventResult | undefined;
