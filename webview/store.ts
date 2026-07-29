import type {
	CompactionReason,
	InMessage,
	Segment,
	State,
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
		segs.push({ kind, text } as Segment);
	}
	return { ...t, segments: segs };
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
			(toolCallId && s.toolCallId
				? s.toolCallId === toolCallId
				: s.tool === tool);
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
	partial: string,
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
			return { ...s, partial } as Segment;
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
					return { kind: "thinking", text: s.text ?? "" };
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
			};
			return {
				...state,
				turns: [...state.turns, turn],
				nextId: state.nextId + 1,
				info: undefined,
				providerError: undefined,
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
		case "agent_busy":
			return {
				...state,
				busy: msg.busy,
				// Al terminar el agente (busy=false) cerramos el status del último turn:
				// turn_active/appendSegment lo dejan en "thinking"/"executing" y ningún
				// evento lo limpiaba → el turn quedaba "pensando" para siempre.
				turns: msg.busy
					? state.turns
					: withLast(state.turns, (t) => ({ ...t, status: null })),
			};
		case "turn_active":
			return {
				...state,
				turns: withLast(state.turns, (t) => ({ ...t, status: "thinking" })),
				providerError: undefined,
			};

		case "delta":
			// El modelo está respondiendo → limpiar el error efímero del provider.
			return {
				...state,
				turns: withLast(state.turns, (t) => appendSegment(t, msg.text, "text")),
				providerError: undefined,
			};

		case "thinking_delta":
			return {
				...state,
				turns: withLast(state.turns, (t) =>
					appendSegment(t, msg.text, "thinking"),
				),
			};

		case "tool_start":
			return {
				...state,
				turns: withLast(state.turns, (t) => ({
					...t,
					status: "executing",
					executingTool: msg.tool,
					segments: [
						...t.segments,
						{
							kind: "tool",
							tool: msg.tool,
							args: msg.args ?? {},
							state: "running",
							startedAt: Date.now(),
							toolCallId: msg.toolCallId,
						},
					],
				})),
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
					applyToolUpdate(t, msg.toolCallId, msg.partial),
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

		case "ui_requests":
			return { ...state, uiRequests: msg.items };

		case "ui_notify":
			// MVP: mapear notify al banner info existente. Un toast dedicado es mejora futura.
			return { ...state, info: msg.message };

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
			return { ...state, info: msg.text };

		case "cleared":
			return {
				...state,
				turns: [],
				approvals: [],
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
				lens: null,
				retry: null,
			};

		case "usage": {
			const { type: _t, ...rest } = msg;
			return { ...state, usage: rest as Usage };
		}

		case "files":
			return { ...state, files: { query: msg.query, items: msg.items } };

		case "sessions":
			return {
				...state,
				sessions: { items: msg.items, currentPath: msg.currentPath },
			};

		case "resources":
			return { ...state, resources: msg.data };

		case "queued":
			return { ...state, queued: msg.items };

		case "workspace": {
			const { type: _t, ...rest } = msg;
			return { ...state, workspace: rest as WorkspaceInfo };
		}

		case "models":
			return {
				...state,
				models: { providers: msg.providers, active: msg.active },
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

		case "mode":
			return { ...state, mode: msg.mode };

		case "model_info":
			return {
				...state,
				model: msg.model,
				provider: msg.provider,
				thinking: msg.thinking,
			};

		case "tool_toggles":
			return {
				...state,
				toolToggles: { askUserQuestion: msg.askUserQuestion, todo: msg.todo },
			};

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

		case "history": {
			const { turns, nextId } = buildHistoryTurns(msg.items);
			return {
				...state,
				turns,
				approvals: [],
				uiRequests: [],
				busy: false,
				isCompacting: false,
				compactions: [],
				branchSummaries: msg.branchSummaries ?? [],
				info: msg.name ? `Sesión: ${msg.name}` : state.info,
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
				? "Compactación cancelada"
				: msg.errorMessage
					? "Error al compactar: " + msg.errorMessage
					: msg.tokensBefore != null && msg.summary
						? `Contexto compactado desde ${msg.tokensBefore.toLocaleString()} tokens`
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
			// Error efímero del provider (401/500/sin respuesta): banner en el footer, no
			// en la conversación. Se limpia al recibir respuesta (delta/turn_active) o
			// un nuevo mensaje (user). Ver ADR-0009 (401 invisible).
			return { ...state, providerError: msg.text };

		default:
			return state;
	}
}
