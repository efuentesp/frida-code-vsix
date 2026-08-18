// frida-extensible-workflows — punto de entrada.
//
// Porte de pi-extensible-workflows (by vekexasia, MIT, v5.1.1). Ver ADR-0028.
// Fase 1: núcleo vendorizado headless (core/) + API pública de authoring.
// Fase 2: registra el tool `workflow` FOREGROUND-only con el ejecutor de agentes
//         adaptado a Frida (frida-agent-execution.ts). Sin background/checkpoints/
//         retry/resume aún (fases 3+).

import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";

import { encoded } from "./core/execution";
import { workflowCatalogIndex, workflowCatalogDetail } from "./core/registry";
import { validateBudget } from "./core/budget";
import {
	builtinPatternsCatalog,
	findBuiltinPattern,
} from "./builtin-patterns";
import { withStructuredOutput } from "./structured-output";
import {
	runWorkflowInStore,
	retryWorkflow,
	resumeWorkflow,
	type CheckpointNotifier,
} from "./frida-host";
import {
	upsertWorkflowRun,
	applyWorkflowProgress,
	getWorkflowRuns,
} from "./store";
import { wfLog } from "./telemetry";
import { RunStore } from "./core/persistence";
import { fridaHome } from "./frida-paths";
import {
	deliverFollowUp,
	emitWorkflowEvent,
	registerBackgroundRun,
	getBackgroundRun,
	unregisterBackgroundRun,
	resolveCheckpoint,
} from "./frida-delivery";
import type { JsonValue } from "./core/types";

// --- API pública de authoring (extensions.html) ---
export {
	registerWorkflowExtension,
	workflowCatalog,
	workflowCatalogIndex,
	workflowCatalogDetail,
	registeredWorkflowFunctions,
	registeredWorkflowRoleDirectories,
	registeredWorkflowRoleDirectoryRegistrations,
	loadingRegistry,
	resetWorkflowRegistry,
	beginWorkflowExtensionLoading,
	WorkflowRegistry,
} from "./core/registry";
export type {
	WorkflowExtension,
	WorkflowFunction,
	WorkflowFunctionContext,
	WorkflowModelAlias,
	WorkflowModelAliasResolverContext,
	WorkflowCatalog,
	WorkflowCatalogContext,
	WorkflowCatalogFunction,
	WorkflowCatalogIndex,
	WorkflowCatalogModelAlias,
	AgentSetupHook,
	RegisteredAgentSetupHook,
	AgentAttemptAction,
} from "./core/types";

// --- Ejecución del DSL (sandbox node:vm en proceso hijo forkeado) ---
export {
	runWorkflow,
	encoded,
	agentIdentityPath,
	shellIdentityPath,
	readShellResult,
	executeShellCommand,
	RPC_LIMIT_BYTES,
	HEARTBEAT_TIMEOUT_MS,
} from "./core/execution";
export type {
	WorkflowBridge,
	WorkflowExecution,
	AgentIdentity,
	ShellIdentity,
} from "./core/execution";

// --- Ejecutor de agentes adaptado a Frida (Fase 2) ---
import {
	createWorkflowBridge,
	createFridaAgentSpawner,
} from "./frida-agent-execution";
export { createWorkflowBridge, createFridaAgentSpawner };
export type {
	SpawnAgentFn,
	WorkflowBridgeOptions,
} from "./frida-agent-execution";

// --- Persistencia (RunStore, journal, snapshots) ---
export {
	RunStore,
	structuralPath,
	runsDirectory,
	projectStorageKey,
	projectSessionsDirectory,
	SessionLease,
	atomicWriteFile,
} from "./core/persistence";
export type {
	PersistedRun,
	RunSummary,
	RunSummaryArtifacts,
	RunSummaryAgent,
	CompletedOperation,
	AwaitingCheckpoint,
	PendingWorkflowDecision,
	WorktreeReference,
} from "./core/persistence";

// --- Validación / preflight ---
export {
	instrumentWorkflow,
	validateSchema,
	validateAgentOptions,
	workflowSettingsPath,
	workflowProjectSettingsPath,
	loadSettings,
	resolveWorkflowSettings,
	loadAgentDefinitions,
} from "./core/validation";

// --- Rutas de Frida (ADR-0010) ---
export { fridaDefaultAgentDir, fridaHome } from "./frida-paths";

// ---------------------------------------------------------------------------
// Tool `workflow` (Fase 2: foreground-only)
// ---------------------------------------------------------------------------

const WORKFLOW_TOOL_LABEL = "Workflow";
const WORKFLOW_TOOL_DESCRIPTION =
	"Run a deterministic JavaScript workflow with a named inline or file-backed parallel-to-summary path by default, or launch a curated builtin pattern (multi-perspective, codebase-audit) by name alone with args";
const WORKFLOW_TOOL_PROMPT_SNIPPET =
	"Run a deterministic JavaScript workflow. Prefer a named inline script that fans out independent work with parallel(...), awaits the keyed results before interpolating them into one summarizing agent(...), and returns. Provide exactly one of script or scriptPath and a non-empty name, or launch a curated builtin pattern by name alone with args (see workflow_catalog builtinPatterns; e.g. workflow({ name: 'multi-perspective', args: { topic } }) or workflow({ name: 'codebase-audit', args: { scope, checks } })). Set foreground: true to wait for the final value.";

const WORKFLOW_TOOL_PARAMETERS = Type.Object({
	name: Type.String({ description: "Required non-empty workflow name" }),
	description: Type.Optional(
		Type.String({
			description: "Optional human-readable workflow description",
		}),
	),
	script: Type.Optional(
		Type.String({
			description:
				"Immutable inline workflow source; provide exactly one of script or scriptPath",
		}),
	),
	scriptPath: Type.Optional(
		Type.String({
			description:
				"Path to a JavaScript workflow file, read once at launch and persisted as the inline source; provide exactly one of script or scriptPath",
		}),
	),
	args: Type.Optional(
		Type.Unknown({
			description:
				"JSON-compatible values available inside the workflow script as args",
		}),
	),
	foreground: Type.Optional(
		Type.Boolean({
			description:
				"Wait for completion instead of the default background launch",
		}),
	),
	concurrency: Type.Optional(
		Type.Integer({
			minimum: 1,
			maximum: 16,
			description: "Advanced: optional per-run active-agent limit",
		}),
	),
	budget: Type.Optional(
		Type.Unknown({
			description: "Advanced: optional aggregate soft and hard run budgets",
		}),
	),
	parentRunId: Type.Optional(
		Type.String({
			description: "Advanced: terminal run whose named worktrees may be reused",
		}),
	),
});

/** Lee y valida el script de lanzamiento (exactamente uno de script/scriptPath). */
function readLaunchScript(params: {
	script?: unknown;
	scriptPath?: unknown;
}): string {
	const script =
		typeof params.script === "string" && params.script.trim()
			? params.script
			: undefined;
	const scriptPath =
		typeof params.scriptPath === "string" && params.scriptPath.trim()
			? params.scriptPath
			: undefined;
	if (script && scriptPath) {
		throw new Error(
			"workflow: provide exactly one of script or scriptPath (got both)",
		);
	}
	if (!script && !scriptPath) {
		throw new Error(
			"workflow: provide exactly one of script or scriptPath (got neither)",
		);
	}
	if (script) return script;
	// scriptPath: leer una sola vez y persistir como inline.
	const abs = isAbsolute(scriptPath!)
		? scriptPath!
		: resolve(process.cwd(), scriptPath!);
	return readFileSync(abs, "utf8");
}

/** Formatea el resultado final de la run para el modelo. */
function renderWorkflowResult(value: JsonValue): string {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function toolResult(text: string): {
	content: Array<{ type: "text"; text: string }>;
	details: unknown;
} {
	return { content: [{ type: "text", text }], details: undefined };
}

// ---------------------------------------------------------------------------
// Factory de la extensión (Pi extension factory pattern).
// ---------------------------------------------------------------------------

export function createFridaExtensibleWorkflows() {
	return (pi: ExtensionAPI): void => {
		// --- Tool: workflow (Fase 2: foreground-only) ---
		pi.registerTool(
			defineTool({
				name: "workflow",
				label: WORKFLOW_TOOL_LABEL,
				description: WORKFLOW_TOOL_DESCRIPTION,
				promptSnippet: WORKFLOW_TOOL_PROMPT_SNIPPET,
				parameters: WORKFLOW_TOOL_PARAMETERS,
				async execute(_toolCallId, params, signal, _onUpdate, ctx) {
					const p = params as {
						name?: unknown;
						script?: unknown;
						scriptPath?: unknown;
						args?: unknown;
						foreground?: unknown;
					};
					const name =
						typeof p.name === "string" && p.name.trim() ? p.name : undefined;
					if (!name)
						throw new Error("workflow: name is required and must be non-empty");

					const args = (p.args ?? null) as JsonValue;
					encoded(args); // valida frontera JSON (≤10 MB)
					// Patrones curados (#19 Lote 1): name de un patrón builtin sin
					// script/scriptPath resuelve al script generado (valida args eager).
					// Un script explícito siempre gana sobre el patrón del mismo nombre.
					const hasExplicit =
						(typeof p.script === "string" && p.script.trim()) ||
						(typeof p.scriptPath === "string" && p.scriptPath.trim());
					const builtin = name ? findBuiltinPattern(name) : undefined;
					const script =
						!hasExplicit && builtin
							? builtin.resolve(args, { cwd: ctx.cwd })
							: readLaunchScript(p);
					const budget = validateBudget((p as { budget?: unknown }).budget);

					const sessionId = ctx.sessionManager.getSessionId();
				const spawnAgent = withStructuredOutput(createFridaAgentSpawner(ctx));
				// Fase 6: permite que los agentes de un withWorktree corran en el path del worktree.
				const createSpawnerForCwd = (worktreeCwd: string) =>
					withStructuredOutput(
						createFridaAgentSpawner({ ...ctx, cwd: worktreeCwd }),
					);

					// Fase 5: notificador de checkpoints (entrega follow-up pidiendo aprobación).
					const onCheckpoint: CheckpointNotifier = (cp) => {
						emitWorkflowEvent(pi, "workflow:checkpoint-state-changed", {
							runId: cp.runId,
							name: cp.name,
							state: "awaiting",
						} as JsonValue);
						deliverFollowUp(
							pi,
							`Workflow ${name} (runId: ${cp.runId}) checkpoint ${cp.name}: ${cp.prompt}\n` +
								`Context: ${JSON.stringify(cp.context)}\n` +
								`Responde con workflow_respond({ runId: "${cp.runId}", name: "${cp.name}", approved: <true|false> }).`,
						);
					};

					// --- Foreground (Fase 3): await + resultado inline ---
					if (p.foreground) {
						const { runId, result } = await runWorkflowInStore({
							name,
							script,
							args,
							cwd: ctx.cwd,
							sessionId,
							spawnAgent,
							signal: signal ?? undefined,
							foreground: true,
							createSpawnerForCwd,
							...(budget ? { budget } : {}),
							onCheckpoint,
						});
						return toolResult(
							`Workflow ${name} completado (runId: ${runId}).\n\n${renderWorkflowResult(result)}`,
						);
					}

					// --- Background (Fase 4): lanzar sin esperar, devolver runId,
					// entregar resultado como follow-up al completar ---
					const runId = randomUUID();
					const controller = new AbortController();
					registerBackgroundRun(runId, {
						controller,
						workflowName: name,
						sessionId,
						cwd: ctx.cwd,
					});
					emitWorkflowEvent(pi, "workflow:run-started", {
						runId,
						workflowName: name,
					} as JsonValue);
					upsertWorkflowRun({ runId, workflowName: name, state: "running" });
					wfLog("launch", { runId, workflowName: name, foreground: false });

					void runWorkflowInStore({
						name,
						script,
						args,
						cwd: ctx.cwd,
						sessionId,
						runId,
						spawnAgent,
						signal: controller.signal,
						foreground: false,
						createSpawnerForCwd,
						...(budget ? { budget } : {}),
						onCheckpoint,
						onProgress: (event) =>
							applyWorkflowProgress({ runId, progress: event }),
					})
						.then(({ result }) => {
							emitWorkflowEvent(pi, "workflow:run-completed", {
								runId,
								workflowName: name,
							} as JsonValue);
							upsertWorkflowRun({
								runId,
								workflowName: name,
								state: "completed",
							});
							wfLog("complete", { runId, workflowName: name });
							deliverFollowUp(
								pi,
								`Workflow ${name} (runId: ${runId}) completado.\n\n${renderWorkflowResult(result)}`,
							);
						})
						.catch((error: unknown) => {
							const message =
								error instanceof Error ? error.message : String(error);
							const cancelled = /CANCEL/i.test(message);
							const budgetExhausted = /BUDGET/i.test(message);
							emitWorkflowEvent(pi, "workflow:run-failed", {
								runId,
								workflowName: name,
								error: message,
							} as JsonValue);
							upsertWorkflowRun({
								runId,
								workflowName: name,
								state: cancelled
									? "stopped"
									: budgetExhausted
										? "budget_exhausted"
										: "failed",
								...(cancelled || budgetExhausted ? {} : { error: message }),
							});
							wfLog("fail", { runId, workflowName: name, message });
							// CANCELLED (workflow_stop) → cancelación explícita, sin follow-up.
							if (!cancelled) {
								deliverFollowUp(
									pi,
									`Workflow ${name} (runId: ${runId}) falló: ${message}`,
								);
							}
						})
						.finally(() => unregisterBackgroundRun(runId));

					return toolResult(
						`Workflow ${name} lanzado en background (runId: ${runId}). Te notificaré al completar. Usa workflow_status({ runId: "${runId}" }) para inspeccionar.`,
					);
				},
			}),
		);

		// --- Tool: workflow_status (Fase 3) ---
		pi.registerTool(
			defineTool({
				name: "workflow_status",
				label: "Workflow Status",
				description:
					"Read a compact authoritative summary for a workflow run in the current project: state, agents, and error info. Call it before recovery to confirm persisted state.",
				parameters: Type.Object(
					{ runId: Type.String({ description: "Workflow run ID" }) },
					{ additionalProperties: false },
				),
				async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
					const runId = (params as { runId?: unknown }).runId;
					if (typeof runId !== "string" || !runId.trim())
						throw new Error("workflow_status: runId is required");
					const sessionId = ctx.sessionManager.getSessionId();
					const store = new RunStore(ctx.cwd, sessionId, runId, fridaHome());
					let run;
					try {
						run = await store.loadStatus();
					} catch {
						return toolResult(`Run ${runId} no encontrada.`);
					}
					return toolResult(
						`Run ${runId}: ${run.workflowName}\n` +
							`  state: ${run.state}\n` +
							`  agents: ${run.agents.length}\n` +
							`${run.error ? `  error: ${run.error.code} — ${run.error.message}\n` : ""}` +
							`${run.failedAt ? `  failedAt: ${run.failedAt}\n` : ""}`,
					);
				},
			}),
		);

		// --- Tool: workflow_catalog (Fase 3) ---
		pi.registerTool(
			defineTool({
				name: "workflow_catalog",
				label: "Workflow Catalog",
				description:
					"Inspect registered workflow functions, dynamic model aliases, and effective settings available as globals inside workflow scripts.",
				parameters: Type.Object(
					{
						name: Type.Optional(
							Type.String({
								description: "Optional function/alias name for full detail",
							}),
						),
					},
					{ additionalProperties: false },
				),
				async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
					const catalogCtx = { cwd: ctx.cwd, projectTrusted: true };
					const requested = (params as { name?: unknown }).name;
					if (typeof requested === "string" && requested.trim()) {
						// Patrones curados (#19): detalle del patrón antes que el catálogo de
						// funciones registradas (namespace distinto, misma puerta de consulta).
						const pattern = findBuiltinPattern(requested.trim());
						if (pattern) {
							return toolResult(
								JSON.stringify(
									{
										kind: "builtinPattern",
										name: pattern.name,
										description: pattern.description,
										args: pattern.args,
										...(pattern.meta ? { meta: pattern.meta } : {}),
										launch:
											`workflow({ name: "${pattern.name}", args: { ... } }) — sin script; se resuelve al patrón.`,
									},
									null,
									2,
								),
							);
						}
						return toolResult(
							JSON.stringify(
								workflowCatalogDetail(requested, catalogCtx),
								null,
								2,
							),
						);
					}
					return toolResult(
						JSON.stringify(
							{
								...workflowCatalogIndex(catalogCtx),
								builtinPatterns: builtinPatternsCatalog(),
							},
							null,
							2,
						),
					);
				},
			}),
		);

		// --- Tool: workflow_stop (Fase 4) ---
		pi.registerTool(
			defineTool({
				name: "workflow_stop",
				label: "Workflow Stop",
				description:
					"Stop an active background workflow run by its exact run ID. Requires the run to still be in progress.",
				parameters: Type.Object(
					{ runId: Type.String({ description: "The exact run ID to stop" }) },
					{ additionalProperties: false },
				),
				async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
					const runId = (params as { runId?: unknown }).runId;
					if (typeof runId !== "string" || !runId.trim())
						throw new Error("workflow_stop: runId is required");
					const run = getBackgroundRun(runId);
					if (!run) {
						return toolResult(
							`Run ${runId} no está activa (no es background, ya terminó, o el ID es inválido).`,
						);
					}
					run.controller.abort();
					return toolResult(`Run ${runId} (${run.workflowName}) cancelada.`);
				},
			}),
		);

		// --- Tool: workflow_respond (Fase 5) ---
		pi.registerTool(
			defineTool({
				name: "workflow_respond",
				label: "Workflow Respond",
				description:
					"Approve or reject a pending workflow checkpoint, or answer a pending budget approval. Provide the runId, the checkpoint name, and approved.",
				parameters: Type.Object(
					{
						runId: Type.String({ description: "Workflow run ID" }),
						name: Type.String({
							description: "Checkpoint name to resolve",
						}),
						approved: Type.Boolean({
							description: "true to approve, false to reject",
						}),
					},
					{ additionalProperties: false },
				),
				async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
					const runId = (params as { runId?: unknown }).runId;
					const cpName = (params as { name?: unknown }).name;
					const approved = (params as { approved?: unknown }).approved;
					if (typeof runId !== "string" || !runId.trim())
						throw new Error("workflow_respond: runId is required");
					if (typeof cpName !== "string" || !cpName.trim())
						throw new Error("workflow_respond: name is required");
					if (typeof approved !== "boolean")
						throw new Error("workflow_respond: approved must be boolean");
					// 1) ¿Checkpoint en vivo? → resolverlo.
					const resolved = resolveCheckpoint(runId, cpName, approved);
					if (resolved) {
						return toolResult(
							`Checkpoint ${cpName} de la run ${runId} ${approved ? "aprobado" : "rechazado"}.`,
						);
					}
					// 2) No está en vivo: persistir la decisión para que al reanudar (Fase 6)
					//    el checkpoint replaye este veredicto.
					const sessionId = ctx.sessionManager.getSessionId();
					const store = new RunStore(ctx.cwd, sessionId, runId, fridaHome());
					try {
						const answered = await store.answerCheckpoint(cpName, approved);
						if (!answered) {
							return toolResult(
								`No hay un checkpoint '${cpName}' pendiente en la run ${runId}.`,
							);
						}
						return toolResult(
							`Checkpoint ${cpName} de la run ${runId} decidido (${approved}) y persistido.`,
						);
					} catch {
						return toolResult(`Run ${runId} no encontrada.`);
					}
				},
			}),
		);

		// --- Tool: workflow_retry (Fase 6) ---
		pi.registerTool(
			defineTool({
				name: "workflow_retry",
				label: "Workflow Retry",
				description:
					"Retry a failed workflow run by replaying its completed structural operations into a child run. Only for terminal failed/stopped runs.",
				parameters: Type.Object(
					{
						runId: Type.String({
							description: "Explicit failed workflow run ID",
						}),
						foreground: Type.Optional(
							Type.Boolean({
								description: "Wait for completion (default true for retry)",
							}),
						),
					},
					{ additionalProperties: false },
				),
				async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
					const runId = (params as { runId?: unknown }).runId;
					if (typeof runId !== "string" || !runId.trim())
						throw new Error("workflow_retry: runId is required");
					const sessionId = ctx.sessionManager.getSessionId();
					const { runId: childRunId, result } = await retryWorkflow(runId, {
						cwd: ctx.cwd,
						sessionId,
					spawnAgent: withStructuredOutput(createFridaAgentSpawner(ctx)),
				});
					return toolResult(
						`Workflow retry: run hija ${childRunId} (source ${runId}) completada.\n\n${renderWorkflowResult(result)}`,
					);
				},
			}),
		);

		// --- Tool: workflow_resume (Fase 6) ---
		pi.registerTool(
			defineTool({
				name: "workflow_resume",
				label: "Workflow Resume",
				description:
					"Continue a budget_exhausted workflow run. Optionally pass a budget patch to relax limits. Replays completed operations and runs incomplete ones.",
				parameters: Type.Object(
					{
						runId: Type.String({ description: "Workflow run ID to resume" }),
						budget: Type.Optional(
							Type.Unknown({
								description: "Optional budget patch to relax limits",
							}),
						),
						foreground: Type.Optional(Type.Boolean()),
					},
					{ additionalProperties: false },
				),
				async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
					const runId = (params as { runId?: unknown }).runId;
					if (typeof runId !== "string" || !runId.trim())
						throw new Error("workflow_resume: runId is required");
					const budgetPatch = (params as { budget?: unknown }).budget;
					const sessionId = ctx.sessionManager.getSessionId();
					// Issue #7: registrar el run reanudado en el panel de progreso antes de
					// ejecutar (resumeWorkflow no expone onProgress, así que sólo
					// running→completed/failed; el contador del workflow sí se ve).
					const existing = getWorkflowRuns().find((r) => r.runId === runId);
					const workflowName = existing?.workflowName ?? runId.slice(0, 8);
					upsertWorkflowRun({ runId, workflowName, state: "running" });
					wfLog("resume", { runId, workflowName });
					try {
						const { result } = await resumeWorkflow(runId, {
							cwd: ctx.cwd,
							sessionId,
							spawnAgent: withStructuredOutput(createFridaAgentSpawner(ctx)),
							...(budgetPatch === undefined ? {} : { budgetPatch }),
							onProgress: (event) =>
								applyWorkflowProgress({ runId, progress: event }),
						});
						upsertWorkflowRun({ runId, workflowName, state: "completed" });
						return toolResult(
							`Workflow ${runId} reanudada y completada.\n\n${renderWorkflowResult(result)}`,
						);
					} catch (err) {
						upsertWorkflowRun({
							runId,
							workflowName,
							state: "failed",
							error: err instanceof Error ? err.message : String(err),
						});
						throw err;
					}
				},
			}),
		);

		// Fase 7: UI (WorkflowPanel.tsx), docs, decisión coexistencia. Roles .md y
		// budget de tokens/cost se integran con la UI.
	};
}
