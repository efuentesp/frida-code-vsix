import type {
	CcPanelRowWs,
	CompactionReason,
	InMessage,
	Segment,
	State,
	SubagentProgressDetails,
	ToolState,
	Turn,
	Usage,
	WorkspaceInfo,
} from "./types";

export const initialState: State = {
	keyNeeded: false,
	busy: false,
	mode: "manual",
	turns: [],
	approvals: [],
	modelChanges: [],
	uiRequests: [],
	queued: [],
	isCompacting: false,
	compactions: [],
	branchSummaries: [],
	usage: {
		inputTotal: 0,
		outputTotal: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
		contextTokens: 0,
		contextWindow: 0,
		contextPercent: 0,
	},
	nextId: 1,
	lens: null,
	retry: null,
};

function withLast(turns: Turn[], fn: (t: Turn) => Turn): Turn[] {
	if (turns.length === 0) return turns;
	const last = turns[turns.length - 1];
	return [...turns.slice(0, -1), fn(last)];
}

// Helpers de segmentos (extraídos de los cases delta/thinking_delta/tool_end para
// evitar declaraciones léxicas dentro de `case`, que disparan no-case-declarations).
function appendSegment(t: Turn, text: string, kind: "text" | "thinking"): Turn {
	const segs = [...t.segments];
	const last = segs[segs.length - 1];
	if (last && last.kind === kind) {
		segs[segs.length - 1] = { ...last, text: last.text + text } as Segment;
	} else {
		// Cambio de tipo: si el último era un razonamiento abierto, cerrarlo
		// (llegó texto → el bloque de razonamiento terminó). El paso a tool lo
		// cierra closeOpenThinking en el case tool_start; el fin del agente, en
		// agent_busy.
		if (last && last.kind === "thinking" && last.endedAt === undefined) {
			segs[segs.length - 1] = { ...last, endedAt: Date.now() };
		}
		segs.push(
			kind === "thinking"
				? { kind: "thinking", text, startedAt: Date.now() }
				: { kind: "text", text },
		);
	}
	return { ...t, segments: segs };
}

/** Cierra el último segmento si es un razonamiento aún abierto (sin endedAt):
 *  marca endedAt=now. Lo llaman tool_start (el modelo dejó de razonar para
 *  ejecutar un tool) y agent_busy busy=false (fin del agente). Así el
 *  cronómetro del thinking congela su tiempo final al terminar. */
function closeOpenThinking(t: Turn): Turn {
	const segs = t.segments;
	const last = segs[segs.length - 1];
	if (last && last.kind === "thinking" && last.endedAt === undefined) {
		const next = [...segs];
		next[next.length - 1] = { ...last, endedAt: Date.now() };
		return { ...t, segments: next };
	}
	return t;
}

/** Añade un segmento de tool: primero cierra cualquier razonamiento abierto
 *  (congela su cronómetro) y luego appendinge el tool como running. Extraído del
 *  case tool_start para evitar declaraciones léxicas dentro del switch. */
function appendToolSegment(
	t: Turn,
	msg: { tool: string; args?: unknown; toolCallId?: string },
): Turn {
	const closed = closeOpenThinking(t);
	return {
		...closed,
		status: "executing",
		executingTool: msg.tool,
		segments: [
			...closed.segments,
			{
				kind: "tool",
				tool: msg.tool,
				args: msg.args ?? {},
				state: "running",
				startedAt: Date.now(),
				toolCallId: msg.toolCallId,
			},
		],
	};
}

function markToolResult(
	t: Turn,
	tool: string,
	isError: boolean | undefined,
	result: string | undefined,
	diff: string | undefined,
	toolCallId: string | undefined,
): Turn {
	let done = false;
	const segments = t.segments.map((s) => {
		// Match por toolCallId si ambos lo tienen (updates de tools largos); si no,
		// por nombre (compat con historial reconstruido, que no lleva toolCallId).
		const match =
			s.kind === "tool" &&
			s.state === "running" &&
			(toolCallId && s.toolCallId ? s.toolCallId === toolCallId : s.tool === tool);
		if (!done && match) {
			done = true;
			return {
				...s,
				state: (isError ? "error" : "ok") as ToolState,
				endedAt: Date.now(),
				result,
				diff,
			};
		}
		return s;
	});
	// Tras un tool, el modelo vuelve a razonar sobre el resultado antes del siguiente
	// paso → el indicador del footer refleja "Pensando…".
	return { ...t, segments, status: "thinking", executingTool: undefined };
}

// Acumula el progreso parcial de un tool largo (tool_execution_update) en su
// segmento running, identificado por toolCallId.
function applyToolUpdate(
	t: Turn,
	toolCallId: string | undefined,
	partial: string | undefined,
	details: SubagentProgressDetails | undefined,
): Turn {
	let done = false;
	const segments = t.segments.map((s) => {
		if (
			!done &&
			s.kind === "tool" &&
			s.state === "running" &&
			toolCallId &&
			s.toolCallId === toolCallId
		) {
			done = true;
			return {
				...s,
				partial: partial ?? s.partial,
				partialDetails: details,
			} as Segment;
		}
		return s;
	});
	return { ...t, segments };
}

// Reconstruye la lista de turnos desde el historial (postHistory). Extraído del
// case "history" por la misma razón (declaraciones léxicas en sub-bloques).
function buildHistoryTurns(
	items: { role: "user" | "assistant"; text?: string; segments?: unknown }[],
): { turns: Turn[]; nextId: number } {
	const turns: Turn[] = [];
	let id = 1;
	for (const it of items) {
		if (it.role === "user") {
			turns.push({ id: id++, user: it.text ?? "", segments: [], status: null });
		} else if (it.role === "assistant") {
			const raw = (it.segments ?? []) as Array<{
				kind: "text" | "thinking" | "tool";
				text?: string;
				tool?: string;
				args?: unknown;
				state?: ToolState;
				result?: string;
				diff?: string;
			}>;
			const segs: Segment[] = raw.map((s): Segment => {
				if (s.kind === "text") return { kind: "text", text: s.text ?? "" };
				if (s.kind === "thinking")
					return { kind: "thinking", text: s.text ?? "", startedAt: 0 };
				return {
					kind: "tool",
					tool: s.tool ?? "",
					args: s.args ?? {},
					state: s.state ?? "ok",
					startedAt: 0,
					endedAt: 0,
					result: s.result,
					diff: s.diff,
				};
			});
			const last = turns[turns.length - 1];
			if (last) {
				last.segments = [...last.segments, ...segs];
			} else {
				turns.push({ id: id++, user: "", segments: segs, status: null });
			}
		}
	}
	return { turns, nextId: id };
}

export function reduce(state: State, msg: InMessage): State {
	switch (msg.type) {
		case "need_key":
			return { ...state, keyNeeded: true };
		case "ccplugins_panel":
			return { ...state, ccPanel: msg.panel ?? null };
		case "sandbox_panel":
			return { ...state, sbxPanel: msg.panel ?? null };
		case "detached_panel":
			return { ...state, dtPanel: msg.panel ?? null };
		case "ccplugins_row_meta": {
			// Patch async del panel abierto: fusiona lastUpdated en la fila
			// (discover E instalados) conservando tab/filtro del componente.
			const p = state.ccPanel;
			if (!p || p.id !== msg.id) return state;
			const patch = (rows: CcPanelRowWs[]): CcPanelRowWs[] =>
				rows.map((r) =>
					r.ref === msg.ref ? { ...r, lastUpdated: msg.lastUpdated } : r,
				);
			return {
				...state,
				ccPanel: {
					...p,
					_patch: true,
					rows: patch(p.rows),
					installed: patch(p.installed),
				},
			};
		}
		case "key_set":
		case "session_ready":
			return { ...state, keyNeeded: false };

		case "user": {
			const turn: Turn = {
				id: state.nextId,
				user: msg.text,
				images: msg.images,
				segments: [],
				status: null,
				startedAt: Date.now(), // #107 — apertura del turno (timer en vivo)
			};
			return {
				...state,
				turns: [...state.turns, turn],
				nextId: state.nextId + 1,
				info: undefined,
			};
		}
		case "notice": {
			// Mensaje del sistema (ej. /todos) como turn en el flujo: bloque multiline
			// sin avatares. Persiste en el historial (paridad con rpiv-todo /todos).
			const noticeTurn: Turn = {
				id: state.nextId,
				user: "",
				segments: [],
				status: null,
				notice: msg.text,
			};
			return {
				...state,
				turns: [...state.turns, noticeTurn],
				nextId: state.nextId + 1,
				info: undefined,
			};
		}
		case "agents_running":
			// Conteo de subagentes en background (lo posta el host al cambiar el
			// agentWidgetStore). Alimenta el indicador "N en curso" del procLabel
			// cuando el agente principal ya está idle pero quedan subagentes.
			return { ...state, backgroundRunning: msg.count };
		case "agent_busy":
			return {
				...state,
				busy: msg.busy,
				// Al terminar el agente (busy=false) cerramos el status del último turn
				// y cualquier razonamiento abierto (congela su cronómetro):
				// turn_active/appendSegment lo dejan en "thinking"/"executing" y ningún
				// evento lo limpiaba → el turn quedaba "pensando" para siempre.
				turns: msg.busy
					? state.turns
					: withLast(state.turns, (t) => closeOpenThinking({ ...t, status: null })),
			};
		case "turn_active":
			return {
				...state,
				turns: withLast(state.turns, (t) => ({ ...t, status: "thinking" })),
			};

		case "delta":
			// El modelo está respondiendo. providerError YA NO se limpia aquí: el error
			// debe persistir hasta cierre manual (antes desaparecía con el primer delta
			// del reintento antes de que el usuario pudiera leerlo/copiarlo).
			return {
				...state,
				turns: withLast(state.turns, (t) => appendSegment(t, msg.text, "text")),
			};

		case "thinking_delta":
			return {
				...state,
				turns: withLast(state.turns, (t) => appendSegment(t, msg.text, "thinking")),
			};

		case "tool_start":
			return {
				...state,
				turns: withLast(state.turns, (t) => appendToolSegment(t, msg)),
			};

		case "tool_end":
			return {
				...state,
				turns: withLast(state.turns, (t) =>
					markToolResult(
						t,
						msg.tool,
						msg.isError,
						msg.result,
						msg.diff,
						msg.toolCallId,
					),
				),
			};

		case "tool_update":
			// Progreso parcial de un tool largo (tool_execution_update): acumula en el
			// segmento running por toolCallId. No cambia el estado del tool (sigue running).
			return {
				...state,
				turns: withLast(state.turns, (t) =>
					applyToolUpdate(t, msg.toolCallId, msg.partial, msg.details),
				),
			};

		// Atajo de bash del usuario (!command / !!command). Se adjunta al turno
		// creado por el mensaje "user" previo y se actualiza con chunks/end.
		case "bash_start":
			return {
				...state,
				busy: true,
				turns: withLast(state.turns, (t) => ({
					...t,
					bash: {
						command: msg.command,
						excludeFromContext: msg.excludeFromContext,
						output: "",
						status: "running",
					},
				})),
			};

		case "bash_chunk":
			return {
				...state,
				turns: withLast(state.turns, (t) =>
					t.bash
						? { ...t, bash: { ...t.bash, output: t.bash.output + msg.text } }
						: t,
				),
			};

		case "bash_end": {
			const status = msg.cancelled
				? "cancelled"
				: msg.exitCode !== undefined && msg.exitCode !== 0
					? "error"
					: "ok";
			return {
				...state,
				busy: false,
				turns: withLast(state.turns, (t) =>
					t.bash
						? {
								...t,
								bash: {
									...t.bash,
									status,
									exitCode: msg.exitCode,
									truncated: msg.truncated,
									fullOutputPath: msg.fullOutputPath,
								},
							}
						: t,
				),
			};
		}

		case "approvals":
			return { ...state, approvals: msg.approvals };
		case "model_changes":
			return { ...state, modelChanges: msg.items };

		case "ui_requests":
			return { ...state, uiRequests: msg.items };

		case "questionnaire":
			// ask_user_question nativo (ADR-0027): el host publica el cuestionario
			// pendiente (o null al cerrar). QuestionsPanel lo renderiza en el composer.
			return { ...state, questionnaire: msg.req };

		case "ui_notify":
			// MVP: mapear notify al banner info existente. Un toast dedicado es mejora futura.
			return { ...state, info: { text: msg.message, level: msg.level } };

		case "web_commit": {
			const webRoots = { ...(state.webRoots ?? {}) };
			if (msg.tree === null) delete webRoots[msg.rootId];
			else
				webRoots[msg.rootId] = {
					tree: msg.tree,
					placement: msg.placement ?? "overlay",
				};
			return { ...state, webRoots };
		}

		case "info":
			return { ...state, info: { text: msg.text, level: msg.level ?? "info" } };

		case "cleared":
			return {
				...state,
				turns: [],
				approvals: [],
				modelChanges: [],
				uiRequests: [],
				webRoots: {},
				queued: [],
				busy: false,
				isCompacting: false,
				compactReason: undefined,
				compactions: [],
				branchSummaries: [],
				info: undefined,
				providerError: undefined,
				usage: {
					inputTotal: 0,
					outputTotal: 0,
					cacheRead: 0,
					cacheWrite: 0,
					cost: 0,
					contextTokens: 0,
					contextWindow: 0,
					contextPercent: 0,
				},
				resources: undefined,
				usageReport: undefined,
				lens: null,
				retry: null,
			};

		case "usage": {
			const { type: _t, turnInput, turnOutput, ...rest } = msg;
			const base = { ...state, usage: rest as Usage };
			// Repartir el delta de usage del turno entre las tarjetas (tool+thinking)
			// del último turno como ~llm (atribución burda ÷ N). Se recalcula en
			// cada usage y se estabiliza al cerrar el turno.
			if (
				typeof turnInput === "number" &&
				typeof turnOutput === "number" &&
				state.turns.length > 0
			) {
				const perTurn = turnInput + turnOutput;
				const last = state.turns[state.turns.length - 1];
				const n = last.segments.filter(
					(s) => s.kind === "tool" || s.kind === "thinking",
				).length;
				if (n > 0) {
					const perCard = Math.round(perTurn / n);
					const segments = last.segments.map((s) =>
						s.kind === "tool" || s.kind === "thinking"
							? { ...s, tokensLLM: perCard }
							: s,
					);
					return {
						...base,
						turns: [...state.turns.slice(0, -1), { ...last, segments }],
					};
				}
			}
			return base;
		}

		case "files":
			return { ...state, files: { query: msg.query, items: msg.items } };

		case "sessions":
			return {
				...state,
				sessions: { items: msg.items, currentPath: msg.currentPath },
			};

		case "usage_report":
			return {
				...state,
				usageReport: {
					report: msg.report,
					period: msg.period,
					scope: msg.scope,
					periodFrom: msg.periodFrom,
					periodTo: msg.periodTo,
				},
			};
		case "resources":
			return { ...state, resources: msg.data };

		case "permissions_config":
			return {
				...state,
				permissions: msg.config,
				sessionPatterns: msg.sessionPatterns,
			};

		case "queued":
			return { ...state, queued: msg.items };

		case "workspace": {
			const { type: _t, ...rest } = msg;
			return { ...state, workspace: rest as WorkspaceInfo };
		}

		case "ui_prefs":
			return { ...state, ui: { ...state.ui, hideThinking: msg.hideThinking } };
		case "models":
			return {
				...state,
				models: {
					providers: msg.providers,
					active: msg.active,
					refreshing: msg.refreshing,
					refreshErrors: msg.refreshErrors,
					roles: msg.roles,
				},
			};

		case "oauth_device_code":
			return {
				...state,
				oauthDeviceCode: {
					userCode: msg.userCode,
					verificationUri: msg.verificationUri,
				},
			};

		case "oauth_clear":
			return { ...state, oauthDeviceCode: undefined };

		case "fork_points":
			return { ...state, forkPoints: msg.points };

		// /tree (#126): el host publicó el árbol de la sesión activa. El panel
		// se abre desde App al ver el mensaje (mismo patrón que fork_points).
		case "tree_data":
			return {
				...state,
				treeData: {
					nodes: msg.nodes,
					leafId: msg.leafId,
					sessionName: msg.sessionName,
				},
			};

		case "mode":
			return { ...state, mode: msg.mode };

		case "gate_stats":
			return { ...state, gateStats: msg.stats };

		case "model_info":
			return {
				...state,
				model: msg.model,
				provider: msg.provider,
				thinking: msg.thinking,
			};

		case "version":
			return { ...state, version: msg.version };

		case "tool_toggles":
			return {
				...state,
				toolToggles: msg.values,
				toolToggleDefs: msg.defs,
			};

		// Estado del índice de código (frida-codebase-index) para el tab Index
		// del SettingsHub: instalado/versión/tools/busy/última línea de progreso.
		case "codebase_index_state":
			return { ...state, codebaseIndex: msg.state };

		// #112 — lista de archivos presentes en el índice (consulta read-only).
		case "codebase_index_files":
			return {
				...state,
				codebaseIndexFiles: {
					available: msg.available,
					files: msg.files,
					failed: msg.failed,
				},
			};

		// #116 (Fase A) — resultado del Ping de conectividad del proveedor.
		case "codebase_index_ping_result":
			return {
				...state,
				codebaseIndexPing: {
					provider: msg.provider,
					ok: msg.ok,
					latencyMs: msg.latencyMs,
					dimensions: msg.dimensions,
					error: msg.error,
					at: Date.now(),
				},
			};

		// Reporte de diagnóstico del entorno y dependencias del sistema (#99).
		case "environment_status":
			return { ...state, environment: msg.status, environmentChecking: false };
		case "environment_checking":
			return { ...state, environmentChecking: msg.checking };

		// D16 — resumen de diagnósticos de pi-lens del turno (null → oculta el panel).
		case "lens_diagnostics":
			return { ...state, lens: msg.summary };

		// Reintento automático del provider (auto_retry_start/end del SDK).
		case "retry_start":
			return {
				...state,
				retry: {
					attempt: msg.attempt,
					maxAttempts: msg.maxAttempts,
					delayMs: msg.delayMs,
				},
			};
		case "retry_end":
			return { ...state, retry: null };

		// Badge de pi-lens: cargado (extensión presente) + activo (emitió diagnósticos).
		case "lens_status":
			return {
				...state,
				lensStatus: { loaded: msg.loaded, active: msg.active },
			};

		// #20 — chip 🎯 del footer: null limpia el goal.
		case "goal_state":
			return { ...state, goal: msg.goal ?? undefined };

		case "history": {
			const { turns, nextId } = buildHistoryTurns(msg.items);
			return {
				...state,
				turns,
				approvals: [],
				modelChanges: [],
				uiRequests: [],
				busy: false,
				isCompacting: false,
				compactions: [],
				branchSummaries: msg.branchSummaries ?? [],
				info: msg.name
					? { text: `Sesión: ${msg.name}`, level: "info" as const }
					: state.info,
				nextId,
			};
		}

		case "compact_start":
			return {
				...state,
				isCompacting: true,
				compactReason: msg.reason as CompactionReason,
			};

		case "compact_end": {
			const afterTurnId = state.turns.length
				? state.turns[state.turns.length - 1].id
				: null;
			let compactions = state.compactions;
			if (!msg.aborted && msg.tokensBefore != null && msg.summary) {
				compactions = [
					...compactions,
					{
						id: state.nextId,
						afterTurnId,
						tokensBefore: msg.tokensBefore,
						summary: msg.summary,
						reason: msg.reason as CompactionReason,
					},
				];
			}
			const info = msg.aborted
				? { text: "Compactación cancelada", level: "info" as const }
				: msg.errorMessage
					? {
							text: "Error al compactar: " + msg.errorMessage,
							level: "error" as const,
						}
					: msg.tokensBefore != null && msg.summary
						? {
								text: `Contexto compactado desde ${msg.tokensBefore.toLocaleString()} tokens`,
								level: "success" as const,
							}
						: state.info;
			return {
				...state,
				isCompacting: false,
				compactReason: undefined,
				compactions,
				info,
				nextId: state.nextId + 1,
			};
		}

		case "error":
			return {
				...state,
				turns: withLast(state.turns, (t) => ({ ...t, error: msg.text })),
			};
		case "provider_error":
			// Error del provider (401/500/H-2…): persiste hasta cierre MANUAL (botón X
			// del banner → clear_provider_error) o reset de la conversación (cleared).
			// Ya no se limpia con delta/turn_active/user — desaparecía antes de que el
			// usuario pudiera leer/copiar el mensaje. Ver ADR-0009 (401 invisible).
			return { ...state, providerError: msg.text };

		case "clear_provider_error":
			return { ...state, providerError: undefined };

		case "composer_insert":
			// Un overlay (SkillsPanel) pidió insertar texto en el composer. El nonce `n`
			// fuerza al useEffect del Composer a disparar incluso si el texto es igual
			// al de la inserción anterior.
			return {
				...state,
				composerInsert: {
					text: msg.text,
					n: (state.composerInsert?.n ?? 0) + 1,
				},
			};

		default:
			return state;
	}
}
