// frida-goal — modelo de estado + guards puros (sin efectos).
//
// Porte del MVP de @narumitw/pi-goal (issue #20, ADR-0031 D3 fase 1).
// Estados básicos: active / paused / blocked / complete (sin wait ni queue
// — quedaron en fase 2). Los guards replican la semántica del upstream:
// cap de continuaciones automáticas (25), detector de no-progreso por
// fingerprint del output sin tools (3 repeticiones) y budget de tokens.

import { createHash } from "node:crypto";

/** Estados del goal (MVP). `complete` es terminal: el runtime lo limpia. */
export type GoalStatus = "active" | "paused" | "blocked" | "complete";

/** Por qué un guard detuvo el goal (visible para el usuario). */
export type SafetyPauseCause =
	| "continuation_limit"
	| "no_progress"
	| "budget_limited"
	| "interruption"
	| "usage_limited"
	| "agent_error";

/** Cap de continuaciones automáticas (guard del upstream: 25). */
export const MAX_AUTOMATIC_MODEL_TURNS = 25;

/** Repeticiones de output idéntico sin tools antes de declarar no-progreso. */
export const MAX_TOOL_FREE_REPEATS = 3;

/** Turnos consecutivos con el mismo blocker antes de aceptar goal_blocked. */
export const MIN_BLOCKED_TURNS = 3;

/** Snapshot publicado al host → webview (chip 🎯 del footer). */
export interface GoalStateSnapshot {
	id: string;
	text: string;
	status: GoalStatus;
	iteration: number;
	automaticTurns: number;
	tokensUsed: number;
	tokenBudget?: number;
	pausedReason?: string;
	blockedReason?: string;
	completionSummary?: string;
	updatedAt: number;
}

export interface ActiveGoal {
	id: string;
	text: string;
	status: GoalStatus;
	startedAt: number;
	updatedAt: number;
	/** Continuaciones automáticas emitidas (nº del prompt "continuation #N"). */
	iteration: number;
	/** Turnos automáticos del modelo contados en agent_end (cap 25). */
	automaticModelTurns: number;
	tokenBudget?: number;
	tokensUsed: number;
	/** Tokens de contexto al activar el goal; usage = actual - baseline. */
	baselineTokens: number;
	toolFreeRepeatCount: number;
	lastToolFreeOutputFingerprint?: string;
	safetyPauseCause?: SafetyPauseCause;
	pausedReason?: string;
	blockedReason?: string;
	blockedEvidence?: string;
	/** Intentos consecutivos de goal_blocked con la misma razón. */
	blockedAttempts: number;
	lastBlockedReasonFingerprint?: string;
	completionSummary?: string;
}

export function newGoalId(): string {
	return `goal-${Math.random().toString(16).slice(2, 10)}-${Date.now().toString(36)}`;
}

export function createGoal(
	text: string,
	tokenBudget: number | undefined,
	baselineTokens: number,
): ActiveGoal {
	const now = Date.now();
	return {
		id: newGoalId(),
		text,
		status: "active",
		startedAt: now,
		updatedAt: now,
		iteration: 0,
		automaticModelTurns: 0,
		tokenBudget,
		tokensUsed: 0,
		baselineTokens,
		toolFreeRepeatCount: 0,
		blockedAttempts: 0,
	};
}

/** Reinicia los contadores de seguridad (el usuario redirigió el trabajo). */
export function resetSafetyEpoch(goal: ActiveGoal): ActiveGoal {
	return {
		...goal,
		automaticModelTurns: 0,
		toolFreeRepeatCount: 0,
		lastToolFreeOutputFingerprint: undefined,
		safetyPauseCause: undefined,
		blockedAttempts: 0,
		lastBlockedReasonFingerprint: undefined,
		updatedAt: Date.now(),
	};
}

export function toSnapshot(goal: ActiveGoal): GoalStateSnapshot {
	return {
		id: goal.id,
		text: goal.text,
		status: goal.status,
		iteration: goal.iteration,
		automaticTurns: goal.automaticModelTurns,
		tokensUsed: goal.tokensUsed,
		tokenBudget: goal.tokenBudget,
		pausedReason: goal.pausedReason,
		blockedReason: goal.blockedReason,
		completionSummary: goal.completionSummary,
		updatedAt: goal.updatedAt,
	};
}

/** Fingerprint del texto visible del último mensaje assistant (NFKC,
 * minúsculas, whitespace colapsado) — igual que el upstream. */
export function fingerprintAssistantText(messages: readonly unknown[]): string {
	const text: string[] = [];
	for (const message of messages) {
		if (!isRecord(message) || message.role !== "assistant") continue;
		const content = message.content;
		if (!Array.isArray(content)) continue;
		for (const block of content) {
			if (!isRecord(block) || block.type !== "text" || typeof block.text !== "string")
				continue;
			text.push(block.text);
		}
	}
	const normalized = text
		.join("\n")
		.normalize("NFKC")
		.toLowerCase()
		.replace(/\s+/gu, " ")
		.replace(/[\p{Cc}\p{Cf}]/gu, "")
		.trim();
	return normalized === "" || /^[\p{P}\s]+$/u.test(normalized)
		? ""
		: createHash("sha256").update(normalized, "utf8").digest("hex");
}

/** ¿El run intentó al menos un tool? (para el detector de no-progreso). */
export function hasAssistantToolCall(messages: readonly unknown[]): boolean {
	for (const message of messages) {
		if (!isRecord(message) || message.role !== "assistant") continue;
		const content = message.content;
		if (!Array.isArray(content)) continue;
		if (content.some((b) => isRecord(b) && b.type === "toolCall")) return true;
	}
	return false;
}

/** Siguiente estado del contador no-progreso tras un agent_end automático. */
export function nextToolFreeRepeatState(
	goal: ActiveGoal,
	messages: readonly unknown[],
): Pick<ActiveGoal, "toolFreeRepeatCount" | "lastToolFreeOutputFingerprint"> {
	if (hasAssistantToolCall(messages)) {
		return { toolFreeRepeatCount: 0, lastToolFreeOutputFingerprint: undefined };
	}
	const fingerprint = fingerprintAssistantText(messages);
	// Sin texto visible o fingerprint nuevo → cuenta desde 1 (no congela en 0:
	// outputs vacíos repetidos también son no-progreso).
	const repeated =
		fingerprint !== "" && fingerprint === goal.lastToolFreeOutputFingerprint;
	return {
		toolFreeRepeatCount: repeated
			? goal.toolFreeRepeatCount + 1
			: 1,
		lastToolFreeOutputFingerprint: fingerprint === "" ? undefined : fingerprint,
	};
}

/** Último mensaje assistant del run (stopReason/errores viven ahí). */
export function findFinalAssistantMessage(
	messages: readonly unknown[],
): Record<string, unknown> | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (isRecord(m) && m.role === "assistant") return m;
	}
	return undefined;
}

/** Clasificación de errores del assistant (semántica del upstream, reducida). */
export function classifyAssistantError(
	final: Record<string, unknown> | undefined,
): "none" | "aborted" | "usage_limited" | "retryable" | "blocked" {
	const stopReason = final?.stopReason;
	if (stopReason !== "error" && stopReason !== "aborted") return "none";
	if (stopReason === "aborted") return "aborted";
	const msg = typeof final?.errorMessage === "string" ? final.errorMessage : "";
	const lower = msg.toLowerCase();
	// Límites de cuota/uso del proveedor: pausable, no bloqueo.
	if (
		lower.includes("usage limit") ||
		lower.includes("quota") ||
		lower.includes("rate limit") ||
		lower.includes("429")
	) {
		return "usage_limited";
	}
	// Errores transitorios de red/conexión que el host puede reintentar.
	if (
		lower.includes("timeout") ||
		lower.includes("econnreset") ||
		lower.includes("econnrefused") ||
		lower.includes("enotfound") ||
		lower.includes("fetch failed") ||
		lower.includes("network") ||
		lower.includes("502") ||
		lower.includes("503") ||
		lower.includes("504")
	) {
		return "retryable";
	}
	return "blocked";
}

/** ¿El goal está parado (no auto-continúa)? */
export function isStopped(goal: ActiveGoal | undefined): boolean {
	return !goal || goal.status !== "active";
}

/** Normaliza un goal cargado de persistencia; undefined si es inválido,
 * completo (terminal) o de una versión futura con campos desconocidos. */
export function normalizeLoadedGoal(raw: unknown): ActiveGoal | undefined {
	if (!isRecord(raw)) return undefined;
	if (typeof raw.id !== "string" || typeof raw.text !== "string") return undefined;
	const status = raw.status;
	if (status !== "active" && status !== "paused" && status !== "blocked") {
		// "complete" y estados desconocidos no se restauran.
		return undefined;
	}
	const num = (v: unknown): number =>
		typeof v === "number" && Number.isFinite(v) ? v : 0;
	return {
		id: raw.id,
		text: raw.text,
		status,
		startedAt: num(raw.startedAt),
		updatedAt: num(raw.updatedAt),
		iteration: num(raw.iteration),
		automaticModelTurns: num(raw.automaticModelTurns),
		tokenBudget:
			typeof raw.tokenBudget === "number" && Number.isFinite(raw.tokenBudget)
				? raw.tokenBudget
				: undefined,
		tokensUsed: num(raw.tokensUsed),
		baselineTokens: num(raw.baselineTokens),
		toolFreeRepeatCount: num(raw.toolFreeRepeatCount),
		lastToolFreeOutputFingerprint:
			typeof raw.lastToolFreeOutputFingerprint === "string"
				? raw.lastToolFreeOutputFingerprint
				: undefined,
		safetyPauseCause: isSafetyPauseCause(raw.safetyPauseCause)
			? raw.safetyPauseCause
			: undefined,
		pausedReason:
			typeof raw.pausedReason === "string" ? raw.pausedReason : undefined,
		blockedReason:
			typeof raw.blockedReason === "string" ? raw.blockedReason : undefined,
		blockedEvidence:
			typeof raw.blockedEvidence === "string" ? raw.blockedEvidence : undefined,
		blockedAttempts: num(raw.blockedAttempts),
		lastBlockedReasonFingerprint:
			typeof raw.lastBlockedReasonFingerprint === "string"
				? raw.lastBlockedReasonFingerprint
				: undefined,
		completionSummary:
			typeof raw.completionSummary === "string" ? raw.completionSummary : undefined,
	};
}

function isSafetyPauseCause(v: unknown): v is SafetyPauseCause {
	return (
		v === "continuation_limit" ||
		v === "no_progress" ||
		v === "budget_limited" ||
		v === "interruption" ||
		v === "usage_limited" ||
		v === "agent_error"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
