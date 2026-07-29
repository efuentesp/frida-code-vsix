// frida-permission-system — gate de permisos declarativo (ADR-0016, Fase 1).
//
// Reemplaza a src/gates/approval-gates.ts. La lógica de política (deny por
// sensitive-path/dangerous-command, force-ask, superficie tool declarativa) vive
// en policy.ts:evaluate(). Aquí queda el override del modo (manual/auto-edit/auto)
// + el toggle acceptAllEdits + el diálogo + el logging.
//
// Invariantes preservados del diseño original:
//  - FAIL-CLOSED: el handler entero va en try/catch. Ante error, bloquea.
//  - deny SIEMPRE gana (incluso en auto), como yoloMode de gotgenes.
//  - force-ask sobrevive al modo auto (bash compuesto / path externo).
//  - FREE_TOOLS (policy.tool=allow) que pasan no se loguean; los allow por modo
//    sí (source "mode"); deny siempre se loguea.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ApprovalBridge, ApprovalRequest } from "../../approval-bridge";
import type {
	ApprovalLogger,
	ApprovalLogEntry,
} from "../../gates/approval-logger";
import type { GatePatterns } from "../../settings";
import { evaluate, classifyKind, computeDeniedTools } from "./policy";
import { getPermissionPolicy } from "./config-store";
import { type SessionApprovals, suggestPattern } from "./session-approvals";
import type { PermissionMode, ToolKind } from "./types";
import type { GateStatsStore } from "./session-store";

export type { GateStats, PermissionMode, ToolKind } from "./types";
export { classifyKind } from "./policy";

export function createPermissionSystem(
	bridge: ApprovalBridge,
	getMode: () => PermissionMode,
	logger: ApprovalLogger,
	getCwd: () => string,
	getPatterns: () => GatePatterns,
	stats?: GateStatsStore,
	sessionApprovals?: SessionApprovals,
) {
	let acceptAllEdits = false; // per-session; solo edit/write; bash NUNCA

	// Política declarativa: se lee del config-store (config-store.ts) en cada
	// tool_call, así los cambios del ConfigPanel (/gates-config) aplican al instante
	// tras Guardar (sin recargar la sesión). El store cachea; no lee el archivo acá.
	// Loguea en auditoría (JSONL persistente) Y cuenta en los stats de la sesión
	// (✓N/✗M/⚡Z del footer). Un solo punto para que logger y stats no se desincronicen.
	const record = (entry: ApprovalLogEntry): void => {
		logger.log(entry);
		stats?.record(entry.source);
	};

	return (pi: ExtensionAPI) => {
		pi.on("tool_call", async (event: any, ctx: any) => {
			const sessionId = bestEffortSessionId(ctx);
			const kind = safeKind(event);
			try {
				return await evaluateGate(event, ctx?.signal, sessionId, kind);
			} catch (error) {
				const detail = error instanceof Error ? error.message : String(error);
				const reason = `El gate de permisos falló y se bloqueó la acción (fail-closed): ${detail}`;
				record(
					makeEntry(event, sessionId, "block", "gate_error", { kind, reason }),
				);
				return { block: true as const, reason };
			}
		});

		// Fase 7 — hide-tools deny: oculta del catálogo del LLM los tools con `deny`
		// explícito en la política. Doble defensa: si el agente alucina un tool oculto,
		// el gate `tool_call` lo bloquea igual. Se re-aplica cada turno
		// (before_agent_start) así los cambios del ConfigPanel aplican al instante.
		pi.on("before_agent_start", () => {
			try {
				const denied = computeDeniedTools(getPermissionPolicy());
				if (denied.size === 0) return;
				const active = pi.getActiveTools();
				const allowed = active.filter((t) => !denied.has(t));
				if (allowed.length !== active.length) {
					pi.setActiveTools(allowed);
				}
			} catch {
				// Best-effort: si falla, el gate tool_call sigue protegiendo.
			}
		});
	};

	async function evaluateGate(
		event: any,
		signal: AbortSignal | undefined,
		sessionId: string | undefined,
		kind: ToolKind,
	) {
		const mode = getMode();
		const tool = String(event.toolName);
		const patterns = getPatterns();
		const policy = getPermissionPolicy();

		const decision = evaluate({
			tool,
			inputPath: event.input?.path,
			command: event.input?.command,
			cwd: getCwd(),
			policy,
			patterns,
		});

		// deny → bloquear (siempre, incluso en auto — como yoloMode de gotgenes).
		if (decision.state === "deny") {
			record(
				makeEntry(event, sessionId, "block", decision.source ?? "gate_error", {
					kind,
					reason: decision.reason,
				}),
			);
			return { block: true as const, reason: decision.reason };
		}

		// allow sin force-ask → pasa silencioso (policy.tool=allow; = FREE_TOOLS en
		// default). No se loguea, igual que el FREE_TOOLS que pasa hoy.
		if (decision.state === "allow" && !decision.forceAsk) return;

		// De aquí en más: state es "ask", o "allow" promovido a "ask" por force-ask.
		const isDiff = kind === "diff";
		const forceAsk = decision.forceAsk;

		// Override del modo: auto suelta todo ask (salvo force-ask).
		if (mode === "auto" && !forceAsk) {
			record(makeEntry(event, sessionId, "allow", "mode", { kind }));
			return;
		}
		// auto-edit: edit/write con ask → allow (salvo force-ask).
		if (isDiff && mode === "auto-edit" && !forceAsk) {
			record(makeEntry(event, sessionId, "allow", "mode", { kind }));
			return;
		}
		// manual + acceptAllEdits: edit/write → allow (salvo force-ask).
		if (isDiff && acceptAllEdits && !forceAsk) {
			record(makeEntry(event, sessionId, "allow", "mode", { kind }));
			return;
		}

		// Session approvals por patrón (Fase 4): si el input matchea un patrón
		// aprobado esta sesión, pasa sin diálogo. No aplica con force-ask (un bash
		// compuesto o path externo siempre pide, aunque el prefijo esté aprobado).
		if (!forceAsk && sessionApprovals) {
			const matchValue =
				kind === "bash"
					? (event.input?.command as string | undefined)
					: isDiff
						? (event.input?.path as string | undefined)
						: undefined;
			if (matchValue && sessionApprovals.matches(kind, matchValue)) {
				record(
					makeEntry(event, sessionId, "allow", "session_pattern", { kind }),
				);
				return;
			}
		}

		// Diálogo de aprobación.
		const isBash = kind === "bash";
		const req: ApprovalRequest = {
			id: event.toolCallId,
			toolName: tool,
			kind,
			path: event.input?.path,
			command: isBash ? event.input?.command : undefined,
			diff: isDiff ? renderDiff(event.input) : undefined,
			warning: decision.reason,
			suggestedPattern: suggestPattern(kind, {
				command: event.input?.command,
				path: event.input?.path,
			}),
		};

		const resp = await bridge.request(req, signal);
		if (resp.decision === "reject") {
			record(
				makeEntry(event, sessionId, "block", "user_rejected", {
					kind,
					flags: decision.flags,
				}),
			);
			return { block: true as const, reason: "El usuario rechazó la acción." };
		}
		if (isDiff && resp.acceptAll) acceptAllEdits = true;
		// Fase 4: si el usuario aprobó un patrón, registrarlo para la sesión.
		if (resp.pattern) sessionApprovals?.add(kind, resp.pattern);
		record(
			makeEntry(event, sessionId, "allow", "user_approved", {
				kind,
				flags: decision.flags,
			}),
		);
		// accept → dejar ejecutar (no retornar nada).
	}
}

/** Igual que deriveKind pero no lanza: para el catch del fail-closed. */
function safeKind(event: any): ToolKind {
	try {
		return classifyKind(String(event?.toolName ?? ""));
	} catch {
		return "tool";
	}
}

/** Construye una entrada de log a partir del evento + campos variables. */
function makeEntry(
	event: any,
	sessionId: string | undefined,
	decision: "allow" | "block",
	source: ApprovalLogEntry["source"],
	opts: {
		kind: ToolKind;
		reason?: string;
		flags?: string[];
	},
): ApprovalLogEntry {
	return {
		ts: new Date().toISOString(),
		sessionId,
		tool: String(event?.toolName ?? "<unknown>"),
		kind: opts.kind,
		decision,
		source,
		path: typeof event?.input?.path === "string" ? event.input.path : undefined,
		command:
			typeof event?.input?.command === "string"
				? event.input.command
				: undefined,
		reason: opts.reason,
		flags: opts.flags,
	};
}

/** Id de sesión best-effort; el shape de ctx no es estable, leemos defensivamente. */
function bestEffortSessionId(ctx: any): string | undefined {
	const id = ctx?.session?.id ?? ctx?.sessionId ?? ctx?.sessionFile;
	return typeof id === "string" ? id : undefined;
}

function renderDiff(input: any): string {
	if (!input) return "(sin input)";
	if (Array.isArray(input.edits)) {
		return input.edits
			.map((e: any, i: number) =>
				[
					`--- edit #${i + 1}${input.path ? `  (${input.path})` : ""}`,
					"- " + indent(String(e.oldText ?? ""), "- "),
					"+ " + indent(String(e.newText ?? ""), "+ "),
				].join("\n"),
			)
			.join("\n\n");
	}
	if (typeof input.content === "string") {
		return (
			`write ${input.path ?? ""}:\n+ ` +
			indent(input.content, "+ ").slice(0, 2000)
		);
	}
	return JSON.stringify(input, null, 2).slice(0, 2000);
}

function indent(text: string, prefix: string): string {
	return text
		.split("\n")
		.slice(0, 40)
		.map((l) => prefix + l)
		.join("\n");
}
