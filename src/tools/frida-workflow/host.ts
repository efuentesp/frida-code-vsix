// frida-workflow — host: adapta una FridaSession (con createChildSession) al
// port WorkflowHost que consume el runner. El SDK de Pi nunca aparece en el
// runner — sólo aquí, detrás del port.
//
// spawnChild: crea la sesión hija (loader curado: provider hooks + gates, ver
// FridaSession.createChildSession en pi-session.ts), le envía el prompt, espera
// a que termine el turno y entrega el ctx al collector. Luego dispone la hija.

import type {
	SpawnChildOptions,
	WorkflowHost,
	WorkflowSessionContext,
} from "./types";
import {
	appendTranscriptText,
	appendTranscriptTool,
	updateTranscriptTool,
} from "./store";

/** Lo que la FridaSession expone para crear hijas (método aditivo de Fase 1). */
export interface ChildSessionHost {
	createChildSession(opts: {
		prompt: string;
		sessionDir: string;
		signal?: AbortSignal;
	}): Promise<{ session: ChildSession; sessionManager: ChildSessionManager }>;
}

export interface ChildSession {
	prompt(text: string, options?: Record<string, unknown>): Promise<void>;
	dispose?(): void;
	agent?: { state?: { messages?: unknown[] } };
	id?: string;
	sessionFile?: string;
}

export interface ChildSessionManager {
	getBranch?(): unknown[];
	getSessionId?(): string;
}

export interface FridaWorkflowHostDeps {
	frida: ChildSessionHost;
	cwd: string;
	notify: (message: string, level?: "info" | "warning" | "error") => void;
}

export function createFridaWorkflowHost(
	deps: FridaWorkflowHostDeps,
): WorkflowHost {
	return {
		cwd: deps.cwd,
		notify: deps.notify,
		async spawnChild(opts: SpawnChildOptions): Promise<void> {
			const { session, sessionManager } = await deps.frida.createChildSession({
				prompt: opts.prompt,
				sessionDir: opts.sessionDir,
				signal: opts.signal,
			});
			// Transcript en vivo: nos suscribimos a los eventos de la hija y volcamos
			// tools + texto del sub-agente al store reactivo que pinta el WorkflowPanel.
			const stopCapture = opts.transcriptTarget
				? captureTranscript(session, opts.transcriptTarget)
				: undefined;
			try {
				// prompt() resuelve al terminar el turno (incl. tools/gates). El auth se
				// valida aquí (la hija se creó sin llamar al modelo).
				await session.prompt(opts.prompt);
				const child: WorkflowSessionContext = {
					getMessages: () =>
						sessionManager.getBranch?.() ??
						session.agent?.state?.messages ??
						[],
					getSessionId: () =>
						sessionManager.getSessionId?.() ?? session.id ?? "",
					getSessionFile: () => session.sessionFile,
				};
				await opts.withSession(child);
			} finally {
				stopCapture?.();
				session.dispose?.();
			}
		},
	};
}

// ---------------------------------------------------------------------------
// Captura del transcript en vivo (patrón de frida-subagents/forwardLiveProgress,
// pero volcando al store reactivo del WorkflowPanel en vez de a tool_update).
// ---------------------------------------------------------------------------

/** Suscribe a los eventos del SDK de la sesión hija y vuelca un transcript vivo
 *  (tools + texto) al store. Devuelve un unsub que además hace flush del texto
 *  pendiente. Silenciosamente no-op si el stage no está registrado (judges):
 *  patchStage descarta la mutación. */
function captureTranscript(
	session: ChildSession,
	target: { runId: string; stage: string },
): () => void {
	let textBuf = "";
	let textTimer: ReturnType<typeof setTimeout> | undefined;
	const flushText = (): void => {
		if (textTimer) {
			clearTimeout(textTimer);
			textTimer = undefined;
		}
		if (textBuf.trim()) {
			appendTranscriptText(target.runId, target.stage, textBuf);
			textBuf = "";
		}
	};
	const scheduleFlush = (): void => {
		if (textTimer) return;
		textTimer = setTimeout(flushText, 150);
	};
	const unsub = (
		session as {
			subscribe?: (cb: (e: unknown) => void) => () => void;
		}
	).subscribe?.((event) => {
		const e = event as {
			type: string;
			toolCallId?: unknown;
			toolName?: unknown;
			args?: unknown;
			result?: unknown;
			isError?: unknown;
			assistantMessageEvent?: { type?: string; delta?: unknown };
		};
		if (e.type === "tool_execution_start") {
			flushText();
			appendTranscriptTool(target.runId, target.stage, {
				id: String(e.toolCallId ?? ""),
				kind: "tool",
				toolName: String(e.toolName ?? "tool"),
				status: "running",
				...summarizeToolArgs(String(e.toolName ?? ""), e.args),
			});
		} else if (e.type === "tool_execution_end") {
			flushText();
			updateTranscriptTool(
				target.runId,
				target.stage,
				String(e.toolCallId ?? ""),
				{
					status: e.isError ? "failed" : "completed",
					...summarizeToolResult(String(e.toolName ?? ""), e.result),
				},
			);
		} else if (e.type === "message_update") {
			const ae = e.assistantMessageEvent;
			if (ae?.type === "text_delta" && typeof ae.delta === "string") {
				textBuf += ae.delta;
				scheduleFlush();
			}
		}
	});
	return () => {
		flushText();
		if (typeof unsub === "function") unsub();
	};
}

/** Extrae un resumen legible de los ARGS de un tool (path / command) para el
 *  transcript. Defensivo: args puede tener cualquier forma. */
function summarizeToolArgs(
	name: string,
	args: unknown,
): { path?: string; command?: string } {
	if (!args || typeof args !== "object") return {};
	const a = args as Record<string, unknown>;
	if (name === "bash") {
		const c = typeof a.command === "string" ? a.command : undefined;
		return c ? { command: c } : {};
	}
	const p = a.path ?? a.file_path ?? a.filePath;
	if (typeof p === "string" && p) return { path: p };
	return {};
}

/** Extrae diffStat «+X -Y» del RESULT de edit/write si lo expone. Defensivo:
 *  el shape del result varía; si no se puede, se omite (path/status bastan). */
function summarizeToolResult(
	name: string,
	result: unknown,
): { diffStat?: string } {
	if (name !== "edit" && name !== "write") return {};
	const r = result as Record<string, unknown> | undefined;
	if (!r) return {};
	const added = toNum(r.added ?? r.additions ?? r.linesAdded);
	const removed = toNum(r.removed ?? r.deletions ?? r.linesRemoved);
	if (added !== undefined || removed !== undefined)
		return { diffStat: `+${added ?? 0} -${removed ?? 0}` };
	return {};
}

function toNum(v: unknown): number | undefined {
	const n = Number(v);
	return Number.isFinite(n) ? n : undefined;
}
