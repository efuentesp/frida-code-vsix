// frida-subagents — punto de entrada + factory + 3 tools.
//
// Porte de pi-subagents/src/index.ts (ADR-0022 Fase 1).
// Registra 3 tools del modelo: Agent, get_subagent_result, steer_subagent.
// El tool Agent despacha sub-agentes en sesiones hijas via createAgentSession.
//
// Fase 1: general-purpose funcional (foreground + background).
// Custom agents discovery de .frida/agents/ + ~/.frida/global/agents/.

import { Type } from "typebox";
import {
	defineTool,
	type AgentToolUpdateCallback,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DetachedRunMeta } from "./detached-registry";
import {
	bootDetached,
	detachedSnapshot,
	spawnDetachedAgent,
	stopDetachedRun,
} from "./detached-runner";
import { buildDetachedPanel, type DetachedPanelData } from "./detached-panel";
import {
	resolveAgentConfig,
	runAgent,
	subscribeAgentProgress,
	getAvailableTypes,
	steerAgent,
} from "./agent-runner";
import {
	getAgent,
	acquireSlot,
	releaseSlot,
	queuedCount,
} from "./agent-manager";
import {
	registerBackgroundAgent,
	agentCompleted,
	startTurn,
	getDefaultJoinMode,
	type GroupedNotification,
} from "./group-join";
import { GENERAL_PURPOSE_AGENT } from "./default-agents";
import type { SpawnOptions } from "./types";

// ---------------------------------------------------------------------------
// Helper: estandariza el return del tool (AgentToolResult requiere details)
// ---------------------------------------------------------------------------

function toolResult(text: string): {
	content: Array<{ type: "text"; text: string }>;
	details: unknown;
} {
	return { content: [{ type: "text", text }], details: undefined };
}

// ---------------------------------------------------------------------------
// Descripción del tool Agent (lo que ve el LLM)
// ---------------------------------------------------------------------------

const AGENT_TOOL_DESCRIPTION = `Launch a new sub-agent that runs in an isolated session with its own context window. Each agent type has specialized tools, system prompts, and optional model selection. Foreground agents block until complete and return results inline. Background agents return an agent ID immediately and notify on completion. Detached agents (detached:true) run in a SEPARATE OS process that survives this session — use them for long tasks the user can leave running (closes VS Code, /reload) and collect later via get_subagent_result.

When you delegate work to a sub-agent, do not duplicate that work yourself — wait for the result or continue with other tasks.`;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Opts del host para el modo detached (#26): agentDir, auth del provider
 * activo y sink del panel /detached.
 */
export interface FridaSubagentsOpts {
	/** agentDir de Frida (~/.frida) — el child detached lo hereda via env. */
	agentDir: string;
	/** API key del provider del modelo activo (SecretStorage del host). */
	apiKey?: string;
	/** Provider del modelo activo ("devengine", "zai", …). */
	provider?: string;
	/** Sink del panel /detached: postea el snapshot al webview. */
	onDetachedPanel?: (panel: DetachedPanelData) => void;
	/** Notificación al host cuando un run detached settlea (toast). */
	onDetachedSettled?: (meta: DetachedRunMeta) => void;
}

/**
 * Factory de la extensión frida-subagents para el loader de Pi.
 * Registra los 3 tools del modelo + el comando /detached.
 */
export function createFridaSubagents(opts?: Partial<FridaSubagentsOpts>) {
	const agentDir = opts?.agentDir ?? join(homedir(), ".frida");
	return (pi: ExtensionAPI): void => {
		const cwd = process.cwd();

		// --- #26 detached: reconciliar runs huérfanos del disco al arrancar ---
		bootDetached((meta) => opts?.onDetachedSettled?.(meta));

		// --- Tool: Agent ---
		pi.registerTool(
			defineTool({
				name: "Agent",
				label: "Agent",
				description: AGENT_TOOL_DESCRIPTION,
				promptSnippet:
					"Launch autonomous sub-agents for complex multi-step tasks",
				promptGuidelines: [
					"Use Agent with specialized agents when the task matches an agent type's description. Subagents are valuable for parallelizing independent queries or for protecting the main context window from excessive results, but should not be used excessively when not needed.",
					"When an agent runs in the background, you will be notified on completion — do not poll or sleep waiting for it. Continue with other work instead.",
					"Trust but verify: an agent's summary describes intent, not outcome. When an agent writes or edits code, check the actual changes before reporting work as done.",
				],
				parameters: Type.Object({
					prompt: Type.String({
						description: "The task for the agent to perform.",
					}),
					description: Type.String({
						description:
							"A short (3-5 word) description of the task (shown in UI).",
					}),
					subagent_type: Type.String({
						description: `The type of specialized agent to use. Available types: ${getAvailableTypes(cwd).join(", ")}. Custom agents from .frida/agents/*.md (project) or ~/.frida/global/agents/*.md (global) are also available.`,
					}),
					model: Type.Optional(
						Type.String({
							description:
								'Optional model override. Accepts "provider/modelId" or fuzzy name. Omit to inherit.',
						}),
					),
					thinking: Type.Optional(
						Type.String({
							description:
								"Thinking level: off, minimal, low, medium, high, xhigh, max.",
						}),
					),
					max_turns: Type.Optional(
						Type.Number({
							description:
								"Maximum agentic turns before stopping. Omit for unlimited.",
							minimum: 1,
						}),
					),
					run_in_background: Type.Optional(
						Type.Boolean({
							description:
								"Set to true to run in background. Returns agent ID immediately.",
						}),
					),
					resume: Type.Optional(
						Type.String({
							description:
								"Optional agent ID to resume from a previous session.",
						}),
					),
					isolated: Type.Optional(
						Type.Boolean({
							description:
								"If true, agent gets no extension tools — only built-in tools.",
						}),
					),
					detached: Type.Optional(
						Type.Boolean({
							description:
								"Run in a SEPARATE OS process that survives this session (even a VS Code restart). Returns a run id (det-N) immediately; poll with get_subagent_result. Cannot be steered. Use for long tasks.",
						}),
					),
				}),
				execute: async (
					_toolCallId: string,
					params: {
						prompt: string;
						description: string;
						subagent_type: string;
						run_in_background?: boolean;
						model?: string;
						thinking?: string;
						max_turns?: number;
						resume?: string;
						isolated?: boolean;
						detached?: boolean;
					},
					signal: AbortSignal | undefined,
					onUpdate: AgentToolUpdateCallback | undefined,
					ctx: ExtensionContext,
				) => {
					// Resolver el tipo de agente.
					const config =
						resolveAgentConfig(params.subagent_type, ctx.cwd) ??
						GENERAL_PURPOSE_AGENT;

					// --- #26 detached: proceso separado, handle inmediato ---
					if (params.detached) {
						// Modelo: pattern del agente > pattern pedido > modelo activo del padre.
						const parentModel =
							(ctx.model as { provider?: string; id?: string } | undefined) ??
							undefined;
						const parentPattern =
							parentModel?.provider && parentModel?.id
								? `${parentModel.provider}/${parentModel.id}`
								: undefined;
						const notify = (msg: string): void => {
							try {
								ctx.ui.notify(msg, "info");
							} catch {
								/* headless */
							}
						};
						const handle = spawnDetachedAgent({
							prompt: params.prompt,
							description: params.description,
							config,
							model: params.model ?? parentPattern,
							thinking: params.thinking,
							apiKey: opts?.apiKey,
							provider: opts?.provider,
							agentDir,
							cwd: ctx.cwd,
							onSettled: (meta) => {
								// Notificación honesta al terminar (resultado + tokens #18).
								const icon =
									meta.status === "completed" ? "✓" : meta.status === "killed" ? "⏹" : "✗";
								const tokens =
									meta.tokensIn || meta.tokensOut
										? ` · ${(meta.tokensIn ?? 0) + (meta.tokensOut ?? 0)} tok`
										: "";
								const res = meta.result ? `\n  ⎿  ${meta.result.slice(0, 200)}` : "";
								notify(
									`${icon} Detached ${meta.id} (${meta.name ?? meta.agentType}) ${meta.status === "completed" ? "completó" : meta.status === "killed" ? "detenido" : `falló: ${meta.failureReason ?? meta.status}`}${tokens}${res}`,
								);
								opts?.onDetachedSettled?.(meta);
							},
						});
						return toolResult(
							`🛰 Detached ${handle.id} spawnado (PID ${handle.pid}, proceso propio — sobrevive a esta sesión y a un reinicio de VS Code). Tipo: ${config.name}. Consulta el resultado con get_subagent_result("${handle.id}") o el panel /detached; te notificaré al completar.`,
						);
					}

					const options: SpawnOptions = {
						prompt: params.prompt,
						description: params.description,
						model: params.model,
						thinking: params.thinking,
						maxTurns: params.max_turns,
						runInBackground: params.run_in_background,
						resume: params.resume,
						isolated: params.isolated,
						onUpdate,
						signal,
					};

					if (params.run_in_background) {
						// Background: devolver ID inmediatamente + concurrency queue + group join.
						startTurn();
						const joinMode = getDefaultJoinMode();
						const notify = (msg: string) => {
							try {
								ctx.ui.notify(msg, "info");
							} catch {
								/* headless */
							}
						};

						// Spawn con concurrency queue.
						const { agentId } = await runAgent(config, options, ctx);

						// Registrar en group join para notificaciones agrupadas.
						registerBackgroundAgent(
							agentId,
							joinMode,
							(notifications: GroupedNotification[]) => {
								if (notifications.length === 1) {
									const n = notifications[0]!;
									notify(
										`✓ ${n.description} completó\n  Estado: ${n.status}${n.result ? `\n  ⎿  ${n.result.slice(0, 200)}` : ""}`,
									);
								} else {
									const lines = notifications.map(
										(n) => `  ✓ ${n.description}: ${n.status}`,
									);
									notify(
										`${notifications.length} agentes completaron:\n${lines.join("\n")}`,
									);
								}
							},
						);

						// Configurar onComplete para notificar al grupo.
						options.onComplete = (result, record) => {
							agentCompleted({
								agentId,
								type: config.name,
								description: options.description,
								status: record.status,
								result,
								durationMs: Date.now() - record.startedAt,
							});
							releaseSlot();
						};

						const queueInfo =
							queuedCount() > 0 ? ` (${queuedCount()} en cola)` : "";
						return toolResult(
							`Agente spawnado en background (ID: ${agentId}). Te notificaré al completar. Tipo: ${config.name}.${queueInfo}`,
						);
					}

					// Foreground: esperar el resultado.
					const { agentId, result } = await runAgent(config, options, ctx);

					return toolResult(result || `(agente ${agentId} completó sin texto)`);
				},
			}),
		);

		// --- Tool: get_subagent_result ---
		pi.registerTool(
			defineTool({
				name: "get_subagent_result",
				label: "Get Subagent Result",
				description:
					"Check the status and retrieve results from a background sub-agent. Use wait:true to block until completion.",
				parameters: Type.Object({
					agent_id: Type.String({
						description: "The agent ID to check.",
					}),
					wait: Type.Optional(
						Type.Boolean({
							description:
								"If true, wait for the agent to complete before returning.",
						}),
					),
					verbose: Type.Optional(
						Type.Boolean({
							description: "Include full conversation log in the result.",
						}),
					),
				}),
				execute: async (
					_toolCallId: string,
					params: {
						agent_id: string;
						wait?: boolean;
						verbose?: boolean;
					},
					signal: AbortSignal | undefined,
					onUpdate: AgentToolUpdateCallback | undefined,
					_ctx: ExtensionContext,
				) => {
					// --- #26 detached: el registry durable responde primero ---
					const snap = detachedSnapshot(params.agent_id);
					if (snap) {
						const lines: string[] = [
							`Detached: ${snap.meta.name ?? snap.meta.agentType} (${snap.meta.id} · PID ${snap.meta.pid})`,
							`Estado: ${snap.meta.status}${snap.alive ? " · proceso vivo" : ""}`,
						];
						if (snap.turnCount || snap.toolUses) {
							lines.push(
								`Progreso: turn ${snap.turnCount} · ${snap.toolUses} tools · ${snap.tokensIn + snap.tokensOut} tok · ${snap.activity}`,
							);
						}
						if (snap.meta.result) lines.push(`Resultado: ${snap.meta.result}`);
						if (snap.meta.failureReason)
							lines.push(`Error: ${snap.meta.failureReason}`);
						if (snap.meta.status === "running" || snap.meta.status === "orphaned") {
							lines.push(
								"Sigue corriendo en su propio proceso — consulta de nuevo más tarde (wait no aplica a detached: el proceso no es de esta sesión).",
							);
						}
						return toolResult(lines.join("\n"));
					}

					const agent = getAgent(params.agent_id);
					if (!agent) {
						return toolResult(`Agente ${params.agent_id} no encontrado.`);
					}

					// Si wait:true, esperar el promise.
					if (params.wait && agent.promise) {
						// Vistazo en vivo: mientras espera, reenvía texto/tools del sub-agente
						// al webview como "partial" de esta tarjeta (el progreso del widget
						// footer ya lo alimenta el tracker de runAgent).
						let stopLive: (() => void) | undefined;
						if (onUpdate && agent.session) {
							stopLive = subscribeAgentProgress(
								agent.session,
								agent.id,
								onUpdate,
							);
						}
						try {
							// Si el padre aborta (Detener), dejamos de esperar y devolvemos el
							// estado actual; el sub-agente background sigue su curso independiente.
							if (signal && !signal.aborted) {
								await Promise.race([
									agent.promise,
									new Promise<void>((resolve) =>
										signal.addEventListener("abort", () => resolve(), {
											once: true,
										}),
									),
								]);
							} else if (!signal?.aborted) {
								await agent.promise;
							}
						} catch {
							// El error ya está en agent.error
						} finally {
							stopLive?.();
						}
					}

					agent.resultConsumed = true;

					const lines: string[] = [
						`Agente: ${agent.type} (${agent.id})`,
						`Estado: ${agent.status}`,
					];
					if (agent.result) lines.push(`Resultado: ${agent.result}`);
					if (agent.error) lines.push(`Error: ${agent.error}`);

					return toolResult(lines.join("\n"));
				},
			}),
		);

		// --- Tool: steer_subagent ---
		pi.registerTool(
			defineTool({
				name: "steer_subagent",
				label: "Steer Subagent",
				description:
					"Send a steering message to a running sub-agent. The message is delivered after the current tool execution.",
				parameters: Type.Object({
					agent_id: Type.String({
						description: "The agent ID to steer.",
					}),
					message: Type.String({
						description: "Message to inject into the agent's conversation.",
					}),
				}),
				execute: async (
					_toolCallId: string,
					params: {
						agent_id: string;
						message: string;
					},
					_signal: AbortSignal | undefined,
					_onUpdate: unknown,
					_ctx: ExtensionContext,
				) => {
					// #26: detached corre en otro proceso — steer necesita modo rpc (MVP no).
					const det = detachedSnapshot(params.agent_id);
					if (det) {
						return toolResult(
							`El detached ${params.agent_id} corre en su propio proceso y no acepta steering en este MVP. Si ya no sirve, el usuario puede detenerlo desde el panel /detached (SIGTERM limpio).`,
						);
					}
					const ok = await steerAgent(params.agent_id, params.message);
					return toolResult(
						ok
							? `Mensaje enviado al agente ${params.agent_id}.`
							: `Agente ${params.agent_id} no encontrado o no está corriendo.`,
					);
				},
			}),
		);

		// --- Comando /detached (#26): panel de runs en el webview ---
		pi.registerCommand("detached", {
			description:
				"Subagentes detached: panel de runs activos e históricos (/detached · /detached stop <id>)",
			handler: async (args: string, cmdCtx: any) => {
				const [sub, idArg] = (args ?? "").trim().split(/\s+/);
				const notify = (m: string, kind: "info" | "error" = "info") => {
					try {
						cmdCtx?.ui?.notify?.(m, kind);
					} catch {
						/* headless */
					}
				};
				if (sub === "stop") {
					if (!idArg) {
						notify("Uso: /detached stop <id>", "error");
						return;
					}
					const ok = stopDetachedRun(idArg);
					notify(
						ok
							? `⏹ Detached ${idArg} detenido (SIGTERM al grupo)`
							: `Detached ${idArg} no existe o ya terminó`,
					);
					return;
				}
				// Default (y "list"): abrir/refresh del panel.
				opts?.onDetachedPanel?.(buildDetachedPanel());
			},
		});
	};
}

// ---------------------------------------------------------------------------
// Re-exports públicos
// ---------------------------------------------------------------------------

export { resolveAgentConfig, getAvailableTypes } from "./agent-runner";
export {
	resolveType,
	getAgentConfig,
	getDisplayName,
	getToolNamesForType,
	reloadCustomAgents,
	BUILTIN_TOOL_NAMES,
} from "./agent-types";
export { loadCustomAgents } from "./custom-agents";
export { DEFAULT_AGENTS, DEFAULT_AGENT_NAMES } from "./default-agents";
export {
	registerAgent,
	getAgent,
	listAgents,
	generateAgentId,
	acquireSlot,
	releaseSlot,
	setMaxConcurrent,
	getMaxConcurrent,
	queuedCount,
	runningCountValue,
	registerWorktreeRepo,
	pruneAllWorktrees,
	_resetAgentManager,
} from "./agent-manager";
export {
	registerBackgroundAgent,
	agentCompleted,
	startTurn,
	getDefaultJoinMode,
	_resetGroupJoin,
} from "./group-join";
export type { JoinMode, GroupedNotification } from "./group-join";
export {
	loadSettings,
	saveProjectSettings,
	formatSettings,
} from "./settings";
export type { SubagentsSettings } from "./settings";
export {
	createWorktree,
	cleanupWorktree,
	removeWorktree,
	pruneWorktrees,
} from "./worktree";
export type { WorktreeInfo, WorktreeResult } from "./worktree";
export {
	resolveMemoryDir,
	ensureMemoryDir,
	buildMemoryBlock,
	buildReadOnlyMemoryBlock,
	buildMemoryForAgent,
	hasWriteTools,
} from "./memory";
export {
	resolveSkill,
	preloadSkills,
} from "./skill-loader";
export { wireAgentWidget, unmountAgentWidget } from "./panel";
export {
	agentWidgetStore,
	setAgentWidgetListener,
	startAutoPrune,
	stopAutoPrune,
} from "./store";
export type { AgentDisplay } from "./store";
export type {
	AgentConfig,
	AgentRecord,
	SpawnOptions,
	AgentStatus,
	SubagentType,
	PromptMode,
} from "./types";
