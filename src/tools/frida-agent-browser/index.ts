/**
 * frida-agent-browser — extensión nativa para Frida (porte de pi-agent-browser-native).
 *
 * Propósito: exponer el binario upstream `agent-browser` (Vercel Labs) como un tool
 * nativo `agent_browser` que el agente puede invocar para automatizar el navegador
 * real (leer docs vivos, abrir páginas, snapshots, clicks/fills, screenshots, flujos
 * autenticados). Réplica "Esencial" del diseño del referencia: schema de input-modes
 * (args/semanticAction/job/qa) + inyección de system-prompt (la receta) + sesión
 * implícita reutilizada + bash-guard + parseo de snapshots a @refs.
 *
 * Alcance: NO incluye electron/web-search/branch-restore/lookups (avanzado).
 * El binario upstream se resuelve desde PATH; si falta, el tool reporta
 * "missing-binary" graceful (no crashea) y guía al usuario a instalarlo.
 */

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import * as os from "node:os";
import * as path from "node:path";
import { LAUNCH_SCOPED_FLAG_LABEL } from "./constants";
import { loadConfigSync, type ConfigState } from "./config/load";
import {
	buildDefaultProfileGuideline,
	buildExecutablePathGuideline,
} from "./config/policy";
import { canRegisterWebSearch } from "./web-search/credentials";
import { createWebSearchTool } from "./web-search/tool";
import { resolveAgentBrowserInput } from "./compile";
import { checkBinaryBaseline } from "./baseline";
import { ElectronLaunchRegistry } from "./electron/registry";
import { runElectronAction } from "./electron/host";
import {
	getAllowedDomainsViolation,
	parseAllowedDomainsPolicyFromArgs,
} from "./navigation-policy";
import {
	AGENT_BROWSER_DESCRIPTION,
	AGENT_BROWSER_PROMPT_SNIPPET,
	buildPromptGuidelines,
	MISSING_BINARY_MESSAGE,
	PROJECT_RULE_PROMPT,
} from "./prompt";
import {
	applyOutputPath,
	isHarmlessAgentBrowserInspection,
	isMissingBinary,
	looksLikeAgentBrowserBash,
	missingBinaryResult,
	parseAgentBrowserOutput,
	runAgentBrowser,
	type BrowserToolResult,
} from "./run";
import { AGENT_BROWSER_PARAMS } from "./schema";
import {
	hasExplicitSession,
	hasLaunchScopedFlag,
	ManagedSession,
} from "./session";
import { isPlainTextInspection, isSessionlessCommand } from "./command-policy";
import {
	createScriptCloseArgs,
	createScriptSessionName,
	runAgentBrowserScript,
	SCRIPT_NAMESPACE,
} from "./script/mode";
import { CLOSE_COMMANDS, isRefMutation, NAVIGATE_COMMANDS } from "./ref-guard";
import { buildNextActions } from "./results/next-actions";
import { commandOf } from "./results/presentation";
import {
	ensureArtifactParentDirs,
	extractRequestedPaths,
	isArtifactCommand,
} from "./results/artifacts";

/** Factory de la extensión. Replica el `export default function(pi)` del referencia.
 *  `runFn` es un seam de inyección para tests (defaults a runAgentBrowser real).
 *  `agentDir` base para la config global (default ~/.frida). */
export function createFridaAgentBrowser(
	opts: { runFn?: typeof runAgentBrowser; agentDir?: string } = {},
) {
	return (pi: ExtensionAPI) => {
		const runFn = opts.runFn ?? runAgentBrowser;
		const agentDir = opts.agentDir ?? path.join(os.homedir(), ".frida");
		// Fase 7: registry de lanzamientos Electron wrapper-owned (status/cleanup/probe).
		const electronRegistry = new ElectronLaunchRegistry();
		// Sesión implícita reutilizada (se inicializa con el primer ctx.cwd).
		let session: ManagedSession | undefined;

		function ensureSession(ctx: ExtensionContext): ManagedSession {
			if (!session || session.cwd !== ctx.cwd) {
				session = new ManagedSession(ctx.cwd);
			}
			return session;
		}

		// Fase 3: config advisory — browser defaults → guidance en el system prompt;
		// webSearch queda cargado para Fase 5 (resolución lazy de credenciales).
		let configState: ConfigState | undefined;
		function browserGuidance(cwd: string): string | undefined {
			configState = loadConfigSync({ cwd, agentDir });
			const lines = [
				buildExecutablePathGuideline(configState.executablePath),
				buildDefaultProfileGuideline(configState.defaultProfile),
			].filter((l): l is string => typeof l === "string" && l.length > 0);
			return lines.length > 0
				? `Project agent_browser config guidance:\n${lines.map((l) => `- ${l}`).join("\n")}`
				: undefined;
		}

		// Fase 5: registro condicional del tool companion agent_browser_web_search
		// (sólo si hay credencial Exa/Brave disponible). Recarga config por llamada.
		let webSearchRegistered = false;
		function maybeRegisterWebSearch(cwd: string): void {
			if (webSearchRegistered) return;
			const st = configState ?? loadConfigSync({ cwd, agentDir });
			if (canRegisterWebSearch(st, process.env)) {
				pi.registerTool(
					createWebSearchTool({
						configState: st,
						loadConfigState: (c) => loadConfigSync({ cwd: c, agentDir }),
						fetchFn: globalThis.fetch as never,
					}) as never,
				);
				webSearchRegistered = true;
			}
		}
		maybeRegisterWebSearch(process.cwd());

		// 1) Regla de proyecto + guidance advisory de config (Fase 3).
		pi.on("before_agent_start", async (event, ctx) => {
			const base = event.systemPrompt ?? "";
			const parts = [PROJECT_RULE_PROMPT];
			const guidance = browserGuidance(ctx?.cwd ?? process.cwd());
			if (guidance) parts.push(guidance);
			maybeRegisterWebSearch(ctx?.cwd ?? process.cwd());
			return { systemPrompt: `${base}\n\n${parts.join("\n")}` };
		});

		// 2) bash-guard: bloquea invocar agent-browser por bash (fuerza el tool nativo),
		//    salvo inspecciones inofensivas (--help/--version) para debugging.
		pi.on("tool_call", async (event) => {
			if (
				event.toolName === "bash" &&
				typeof (event.input as { command?: unknown })?.command === "string" &&
				looksLikeAgentBrowserBash((event.input as { command: string }).command) &&
				!isHarmlessAgentBrowserInspection(
					(event.input as { command: string }).command,
				)
			) {
				return {
					block: true,
					reason:
						"Use the native agent_browser tool instead of bash for agent-browser in this environment.",
				};
			}
			return undefined;
		});

		// 3) Cierre best-effort de la sesión upstream + lanzamientos Electron al apagar.
		pi.on("session_shutdown", async () => {
			await electronRegistry.cleanupAll();
			await session?.close();
		});

		// 4) El tool nativo.
		pi.registerTool({
			name: "agent_browser",
			label: "Agent Browser",
			description: AGENT_BROWSER_DESCRIPTION,
			promptSnippet: AGENT_BROWSER_PROMPT_SNIPPET,
			promptGuidelines: [
				...buildPromptGuidelines(),
				`For launch-scoped flags (${LAUNCH_SCOPED_FLAG_LABEL}), use sessionMode:fresh; never put --session-mode in args.`,
			],
			parameters: AGENT_BROWSER_PARAMS,
			async execute(
				_toolCallId,
				params,
				signal,
				_onUpdate,
				ctx,
			): Promise<BrowserToolResult> {
				const resolved = resolveAgentBrowserInput(
					params as Record<string, unknown>,
				);
				if ("error" in resolved) {
					return {
						content: [{ type: "text", text: `Validation error: ${resolved.error}` }],
						details: { failureCategory: "validation", error: resolved.error },
						isError: true,
					};
				}

				// Fase 7: input-mode electron → dispatch al host (list/launch/status/cleanup/probe).
				// No pasa por runAgentBrowser/sesión (es lifecycle desktop wrapper-owned).
				if (resolved.mode === "electron" && resolved.electron) {
					return await runElectronAction(resolved.electron, {
						registry: electronRegistry,
						cwd: ctx.cwd,
						connectFn: async (port: number) => {
							try {
								await runFn({
									args: ["connect", String(port)],
									cwd: ctx.cwd,
									timeoutMs: 10_000,
								});
							} catch {
								/* best-effort: el agente puede conectar manualmente */
							}
						},
					});
				}

				// Fase 9: input-mode script → orquestador sandbox (upstream 0.4.0).
				// No usa la sesión implícita: cada corrida tiene su sesión aislada
				// `piab-script-<uuid>` (namespace vacío), cerrada en el cleanup.
				if (resolved.mode === "script" && resolved.script) {
					const scriptSession = createScriptSessionName();
				const run = await runAgentBrowserScript({
						code: resolved.script.code,
						timeoutMs: (params as { timeoutMs?: number }).timeoutMs,
						signal: signal ?? undefined,
						dispatch: async (p, callSignal) => {
							const callRun = await runFn({
								args: [
									"--namespace",
									SCRIPT_NAMESPACE,
									"--session",
									scriptSession,
									...p.args,
									"--json",
								],
								stdin: p.stdin,
								cwd: ctx.cwd,
								timeoutMs: p.timeoutMs,
								signal: callSignal,
							});
							if (isMissingBinary(callRun)) {
								return {
									ok: false,
									text: MISSING_BINARY_MESSAGE,
									summary: "missing-binary",
									resultCategory: "failure" as const,
									failureCategory: "missing-binary",
									error: MISSING_BINARY_MESSAGE,
								};
							}
							const parsed = parseAgentBrowserOutput({
								stdout: callRun.stdout,
								stderr: callRun.stderr,
								exitCode: callRun.exitCode,
								mode: "script",
								args: p.args,
								sessionName: scriptSession,
								cwd: ctx.cwd,
							});
							const d = parsed.details as {
								resultCategory?: string;
								successCategory?: string;
								failureCategory?: string;
								result?: unknown;
								error?: string;
							};
							return {
								ok: !parsed.isError,
								text:
									parsed.content[0]?.type === "text"
										? parsed.content[0].text
										: "",
								summary: parsed.isError ? "failed" : "ok",
								resultCategory:
									d.resultCategory === "failure" ? "failure" : "success",
								successCategory: d.successCategory,
								failureCategory: d.failureCategory,
								data: d.result,
								error: d.error,
							};
						},
						cleanup: async () => {
							try {
								await runFn({
									args: createScriptCloseArgs(scriptSession),
									cwd: ctx.cwd,
									timeoutMs: 10_000,
								});
							} catch {
								/* best-effort */
							}
						},
					});
					const outputText =
						run.data === undefined
							? "(script completed with no output)"
							: JSON.stringify(run.data, null, 2);
					const summaryLine = `Script run: ${run.callCount} browser call(s), ${run.rejectedCallCount} rejected, ${run.emitCount} emit(s).`;
					return {
						content: [
							{
								type: "text",
								text: run.ok
									? `${outputText}\n\n${summaryLine}`
									: `Script failed (${run.failureCategory}): ${run.error}\n\n${summaryLine}`,
							},
						],
						details: {
							mode: "script",
							command: "script",
							session: scriptSession,
							resultCategory: run.ok ? "success" : "failure",
							...(run.ok ? {} : { failureCategory: run.failureCategory }),
							script: {
								callCount: run.callCount,
								emitCount: run.emitCount,
								rejectedCallCount: run.rejectedCallCount,
								timedOut: run.timedOut ?? undefined,
								aborted: run.aborted ?? undefined,
							},
							steps: run.steps,
							...(run.data !== undefined ? { data: run.data } : {}),
							...(run.ok ? {} : { error: run.error }),
						},
						isError: !run.ok,
					};
				}

				const ms = ensureSession(ctx);
				const requestedFresh =
					(params as { sessionMode?: string }).sessionMode === "fresh";
				const cmd = commandOf(resolved.args);
				const plainText = isPlainTextInspection(resolved.args);
				const sessionless = isSessionlessCommand(cmd, resolved.args) || plainText;

				// Fase 6: flag launch-scoped sobre sesión implícita ACTIVA sin fresh → fail
				// claro (upstream ignoraría el flag; evitamos comportamiento silencioso).
				if (
					!sessionless &&
					hasLaunchScopedFlag(resolved.args) &&
					ms.active &&
					!requestedFresh &&
					!hasExplicitSession(resolved.args)
				) {
					return {
						content: [
							{
								type: "text",
								text: `Blocked (policy): launch-scoped flags (${LAUNCH_SCOPED_FLAG_LABEL}) would be ignored by the already-running managed session. Retry with sessionMode:"fresh" (or an explicit --session) so the flags apply to a new launch.`,
							},
						],
						details: {
							mode: resolved.mode,
							command: cmd,
							session: ms.name,
							resultCategory: "failure",
							failureCategory: "policy-blocked",
							nextActions: [
								{
									id: "retry-with-fresh-session",
									params: { args: resolved.args, sessionMode: "fresh" },
									reason: "Launch-scoped flags require a fresh session.",
									tool: "agent_browser",
								},
							],
						},
						isError: true,
					};
				}

				// Fase 6: sessionless (locales/inspección) → no vincula sesión; texto plano
				// (--help/--version global) → no --json.
				const prefix = sessionless
					? []
					: ms.prefixFor(resolved.args, requestedFresh);
				const finalArgs = [
					...prefix,
					...resolved.args,
					...(plainText ? [] : ["--json"]),
				];

				// Fase 4: pre-spawn — crea dirs padre para paths de artefacto solicitados
				// (screenshot/pdf/download/…) antes de lanzar el binario.
				if (isArtifactCommand(commandOf(resolved.args), resolved.args)) {
					ensureArtifactParentDirs(ctx.cwd, extractRequestedPaths(resolved.args));
				}

				// Fase 2: stale-ref guard — rehúsa @ref de mutación si la página navegó o el
				// ref no estaba en el último snapshot (anti-misclick), SIN lanzar el binario.
				if (isRefMutation(resolved.args)) {
					const g = ms.guardRefMutation(resolved.args);
					if (!g.ok) {
						return {
							content: [{ type: "text", text: `Blocked (stale-ref): ${g.reason}` }],
							details: {
								mode: resolved.mode,
								command: commandOf(resolved.args),
								session: ms.name,
								resultCategory: "failure",
								failureCategory: "stale-ref",
								ref: g.ref,
								nextActions: buildNextActions({
									succeeded: false,
									failureCategory: "stale-ref",
								}),
							},
							isError: true,
						};
					}
				}

				// Endurecimiento: baseline del binario — si el binario global diverge
				// (minor+) del contrato portado, el notice se agrega al content. Se
				// evalúa una vez por proceso (cache en baseline.ts) y no bloquea.
				const baseline = await checkBinaryBaseline({ runFn });

				const run = await runFn({
					args: finalArgs,
					stdin: resolved.stdin,
					cwd: ctx.cwd,
					timeoutMs: (params as { timeoutMs?: number }).timeoutMs,
					signal: signal ?? undefined,
				});

				if (isMissingBinary(run)) {
					return missingBinaryResult();
				}

				const result = parseAgentBrowserOutput({
					stdout: run.stdout,
					stderr: run.stderr,
					exitCode: run.exitCode,
					mode: resolved.mode,
					args: resolved.args,
					sessionName: ms.name,
					cwd: ctx.cwd,
				});
				ms.markUsed();

				if (run.timedOut) {
					result.details = {
						...(result.details as object),
						timedOut: true,
						failureCategory: "timeout",
					};
					result.isError = true;
				}

				// outputPath: vuelca el resultado parsed a archivo durable.
				const outputPath = (params as { outputPath?: string }).outputPath;
				if (outputPath) {
					try {
						const details = result.details as { result?: unknown } | undefined;
						const abs = applyOutputPath(
							ctx.cwd,
							outputPath,
							details?.result ?? run.stdout,
						);
						result.details = { ...(result.details as object), savedFile: abs };
					} catch (e) {
						result.details = {
							...(result.details as object),
							outputPathError: (e as Error).message,
						};
					}
				}

				// Fase 2: tracking de refSnapshot — snapshot puebla refs; navegación/drift
				// los invalida (para que el próximo @ref de mutación dispare el guard).
				if (!result.isError) {
					const d = result.details as {
						command?: string;
						origin?: string;
						refs?: Record<string, unknown>;
					};
					if (d.command && CLOSE_COMMANDS.has(d.command)) ms.clearRefs();
					else if (d.command === "snapshot" && d.refs) {
						ms.updateRefsFromSnapshot(d.origin ?? "", Object.keys(d.refs));
					} else if (d.command && NAVIGATE_COMMANDS.has(d.command)) {
						ms.invalidateRefs();
					} else ms.invalidateIfOriginChanged(d.origin);
				}

				// Fase 8: allowed-domains defense-in-depth — si la navegación aterrizó fuera
				// del allowlist, marcar como violación de política (el containment fuerte
				// de red lo hace el binario upstream).
				const navPolicy = parseAllowedDomainsPolicyFromArgs(resolved.args);
				if (navPolicy && !result.isError) {
					const origin = (result.details as { origin?: string }).origin;
					const violation = getAllowedDomainsViolation({
						policy: navPolicy,
						url: origin,
					});
					if (violation) {
						result.isError = true;
						result.content = [{ type: "text", text: violation.summary }];
						result.details = {
							...(result.details as object),
							allowedDomainsViolation: violation,
							failureCategory: "policy-blocked",
							resultCategory: "failure",
						};
					}
				}

				result.details = {
					args: finalArgs.filter((a) => a !== "--json"),
					session: ms.name,
					// Drift del binario vs contrato portado (undefined si no se pudo determinar).
					binaryBaseline:
						baseline.drift === "unknown"
							? undefined
							: {
									version: baseline.version,
									contract: baseline.contract,
									drift: baseline.drift,
								},
					...(result.details as object),
				};

				// Notice visible al final del content cuando hay drift minor/major.
				if (baseline.notice && result.content[0]?.type === "text") {
					result.content = [
						{
							type: "text",
							text: `${result.content[0].text}\n\n${baseline.notice}`,
						},
						...result.content.slice(1),
					];
				}
				return result;
			},
		});
	};
}
