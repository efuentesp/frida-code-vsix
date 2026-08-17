// frida-goal — runtime reactivo: el corazón del porte (issue #20, ADR-0031).
//
// Escucha el lifecycle de la sesión principal y decide CUÁNDO inyectar la
// continuación (sólo en agent_settled + ctx.isIdle() + sin pendientes), con
// guards de seguridad (cap 25, no-progreso, budget) y accounting de tokens.
// Adaptación del GoalRuntime de pi-goal (1.5k LOC) reducido al MVP:
// sin wait, sin queue, sin tool-policy (los tools goal_* se registran siempre),
// sin budget wrap-up custom (el budget detiene y pausa, sin turno de cierre).
//
// Invariantes críticos del upstream que SÍ conservamos:
// - single-flight: nunca dos continuaciones en vuelo para el mismo goal.
// - stale-turn: si el usuario escribe a mitad, la continuación programada
//   se cancela (el input del usuario gana; su turno esteriliza el estado).
// - compaction-safe: session_compact restaura estado y re-dispara vía
//   agent_settled, nunca dentro del hook de compaction.
// - owned prompts: toda inyección lleva marcador; input sin marcador del
//   usuario cancela lo pendiente.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	appendGoalPromptMarker,
	buildContinuePrompt,
	buildGoalPrompt,
	buildObjectiveUpdatedPrompt,
	buildResumePrompt,
	extractContinuationMarker,
	extractGoalPromptMarker,
} from "./prompts.js";
import {
	MAX_AUTOMATIC_MODEL_TURNS,
	MAX_TOOL_FREE_REPEATS,
	type ActiveGoal,
	classifyAssistantError,
	createGoal,
	findFinalAssistantMessage,
	nextToolFreeRepeatState,
	resetSafetyEpoch,
	toSnapshot,
	type GoalStateSnapshot,
} from "./state.js";
import { GOAL_STATE_ENTRY_TYPE, loadGoalFromSession } from "./persistence.js";

/** Tokens actuales de contexto (estimación del host). */
function contextTokens(ctx: ExtensionContext): number {
	return ctx.getContextUsage()?.tokens ?? 0;
}

interface ContinuationPending {
	goalId: string;
	marker: string;
}

interface AgentRun {
	goalId: string | null;
	origin: "manual" | "automatic";
	toolAttempted: boolean;
}

export interface GoalRuntimeCallbacks {
	/** Publica el snapshot (host → webview chip + status). */
	onState: (snapshot: GoalStateSnapshot | undefined) => void;
	/** Notify no bloqueante (host decide superficie). */
	notify: (level: "info" | "warning" | "error", text: string) => void;
}

export class GoalRuntime {
	private goal: ActiveGoal | undefined;
	private pending: ContinuationPending | undefined;
	private run: AgentRun | undefined;
	private dispatching = false;
	private readonly pi: ExtensionAPI;
	private readonly cb: GoalRuntimeCallbacks;

	constructor(pi: ExtensionAPI, cb: GoalRuntimeCallbacks) {
		this.pi = pi;
		this.cb = cb;
	}

	get activeGoal(): ActiveGoal | undefined {
		return this.goal;
	}

	// ── Registro de listeners ──────────────────────────────────────────────

	register(): void {
		const pi = this.pi;
		pi.on("session_start", (_e, ctx) => this.onSessionStart(ctx));
		pi.on("session_shutdown", (_e, ctx) => this.onSessionShutdown(ctx));
		pi.on("before_agent_start", (e, ctx) => this.onBeforeAgentStart(e.prompt, ctx));
		pi.on("turn_end", (e) => this.onTurnEnd(e));
		pi.on("agent_end", (e, ctx) => this.onAgentEnd(e.messages, ctx));
		pi.on("agent_settled", (_e, ctx) => this.onAgentSettled(ctx));
		pi.on("input", (e, ctx) => this.onInput(e.text, e.source, ctx));
		pi.on("session_compact", (_e, ctx) => this.onSessionCompact(ctx));
		pi.on("tool_call", () => {
			if (this.run) this.run.toolAttempted = true;
		});
	}

	// ── Comandos (/goal ...) ───────────────────────────────────────────────

	start(objective: string, tokenBudget: number | undefined, ctx: ExtensionContext): void {
		if (this.goal?.status === "active") {
			this.cb.notify("warning", "Ya hay un goal activo. Usa /goal edit para cambiarlo o /goal clear.");
			return;
		}
		this.goal = createGoal(objective, tokenBudget, contextTokens(ctx));
		this.cancelPending();
		this.beginRun(this.goal.id, "manual");
		this.persist();
		this.emitState();
		// El prompt inicial ES el turno del usuario (comando): lo inyectamos con
		// marcador propio para que message boundaries lo reconozcan.
		const prompt = appendGoalPromptMarker(
			buildGoalPrompt(this.goal),
			this.goal.id,
		);
		this.pi.sendUserMessage(prompt);
	}

	pause(reason: string, ctx: ExtensionContext): void {
		if (!this.goal || this.goal.status === "complete") {
			this.cb.notify("info", "No hay goal activo.");
			return;
		}
		if (this.goal.status === "active") {
			this.recordUsage(this.goal, ctx);
		}
		this.goal = {
			...this.goal,
			status: "paused",
			pausedReason: reason,
			updatedAt: Date.now(),
		};
		this.cancelPending();
		this.persist();
		this.emitState();
		this.cb.notify("info", "Goal pausado. /goal resume para continuar.");
	}

	resume(ctx: ExtensionContext): void {
		if (!this.goal || this.goal.status === "active") {
			this.cb.notify("info", "No hay goal pausado/bloqueado.");
			return;
		}
		this.goal = resetSafetyEpoch({ ...this.goal, status: "active" });
		this.beginRun(this.goal.id, "manual");
		this.persist();
		this.emitState();
		this.pi.sendUserMessage(buildResumePrompt(this.goal));
	}

	clear(): void {
		if (!this.goal) {
			this.cb.notify("info", "No hay goal.");
			return;
		}
		this.goal = undefined;
		this.cancelPending();
		this.run = undefined;
		this.persist();
		this.emitState();
		this.cb.notify("info", "Goal descartado.");
	}

	edit(objective: string, tokenBudget: number | undefined, ctx: ExtensionContext): void {
		if (!this.goal) {
			this.cb.notify("warning", "No hay goal que editar.");
			return;
		}
		this.goal = resetSafetyEpoch({
			...this.goal,
			text: objective,
			tokenBudget: tokenBudget ?? this.goal.tokenBudget,
			updatedAt: Date.now(),
		});
		this.cancelPending();
		this.persist();
		this.emitState();
		if (this.goal.status === "active") {
			this.pi.sendUserMessage(buildObjectiveUpdatedPrompt(this.goal));
		} else {
			this.cb.notify("info", "Objetivo actualizado (el goal sigue pausado).");
		}
	}

	status(): void {
		if (!this.goal) {
			this.cb.notify("info", "No hay goal activo.");
			return;
		}
		this.cb.notify("info", formatStatusLine(this.goal));
	}

	// ── Tools (goal_complete / goal_blocked) ───────────────────────────────

	onGoalComplete(goalId: string, summary: string): string | undefined {
		if (!this.goal || this.goal.id !== goalId) {
			return "goal_id no coincide con el goal activo (stale turn). No completes con un id viejo.";
		}
		if (this.goal.status !== "active") {
			return "El goal no está activo.";
		}
		this.goal = {
			...this.goal,
			status: "complete",
			completionSummary: summary,
			updatedAt: Date.now(),
		};
		this.cancelPending();
		this.persist();
		this.emitState();
		this.cb.notify("info", `🎯 Goal completo: ${summary.slice(0, 200)}`);
		// El goal se limpia del runtime pero queda en la sesión como terminal.
		this.goal = undefined;
		return undefined;
	}

	onGoalBlocked(
		goalId: string,
		reason: string,
		evidence: string,
	): string | undefined {
		if (!this.goal || this.goal.id !== goalId) {
			return "goal_id no coincide con el goal activo (stale turn).";
		}
		if (this.goal.status !== "active") {
			return "El goal no está activo.";
		}
		// Validación del upstream: el mismo blocker debe repetirse ≥3 turnos
		// (fingerprint de la razón) y traer evidencia.
		const fp = hashText(reason);
		const attempts =
			fp === this.goal.lastBlockedReasonFingerprint
				? this.goal.blockedAttempts + 1
				: 1;
		if (attempts < 3) {
			this.goal = {
				...this.goal,
				blockedAttempts: attempts,
				lastBlockedReasonFingerprint: fp,
				updatedAt: Date.now(),
			};
			this.persist();
			return `goal_blocked rechazado: el mismo blocker lleva ${attempts}/3 turnos. Sigue trabajando o documenta por qué es un impasse real con evidencia.`;
		}
		if (!evidence.trim()) {
			return "goal_blocked requiere evidence concreta (comandos, errores, archivos) que demuestre el impasse.";
		}
		this.goal = {
			...this.goal,
			status: "blocked",
			blockedReason: reason,
			blockedEvidence: evidence,
			blockedAttempts: attempts,
			updatedAt: Date.now(),
		};
		this.cancelPending();
		this.persist();
		this.emitState();
		this.cb.notify("warning", `🎯 Goal bloqueado: ${reason.slice(0, 200)} — /goal resume para reintentar.`);
		return undefined;
	}

	// ── Lifecycle handlers ─────────────────────────────────────────────────

	private onSessionStart(ctx: ExtensionContext): void {
		this.cancelPending();
		this.run = undefined;
		this.dispatching = false;
		// Restaurar de la rama de la sesión (thread-owned).
		const loaded = loadGoalFromSession(ctx);
		if (loaded && loaded.status === "active") {
			this.recordUsage(loaded, ctx);
			if (this.enforceGuards(ctx, loaded, true)) {
				this.goal = loaded;
				return; // guard pausó el goal restaurado
			}
		}
		this.goal = loaded;
		this.emitState();
	}

	private onSessionShutdown(ctx: ExtensionContext): void {
		if (this.goal?.status === "active") this.recordUsage(this.goal, ctx);
		if (this.goal) this.persist();
		this.goal = undefined;
		this.cancelPending();
		this.run = undefined;
		this.emitState();
	}

	/** Detiene el goal tras una interrupción de la corrida (abort, límite
	 *  de uso, error de proveedor no reintentable). */
	private stopAfterInterruption(
		status: "paused" | "blocked",
		cause: "interruption" | "usage_limited" | "agent_error",
		detail: string,
	): void {
		if (!this.goal) return;
		const truncated = detail.slice(0, 200);
		this.goal =
			status === "paused"
				? {
						...this.goal,
					status,
					safetyPauseCause: cause,
					pausedReason: truncated,
					updatedAt: Date.now(),
				}
				: {
						...this.goal,
					status,
					safetyPauseCause: cause,
					blockedReason: truncated,
					updatedAt: Date.now(),
				};
		this.cancelPending();
		this.run = undefined;
		this.persist();
		this.emitState();
		this.cb.notify(
			status === "paused" ? "warning" : "error",
			`🎯 Goal ${status === "paused" ? "pausado" : "bloqueado"}: ${truncated} — /goal resume para reintentar.`,
		);
	}

	private onBeforeAgentStart(prompt: string, _ctx: ExtensionContext): void {
		// Clasificar el run que arranca: continuación propia, prompt inicial
		// propio, o input del usuario.
		this.run = undefined;
		const goalMarker = extractGoalPromptMarker(prompt);
		const continuationMarker = extractContinuationMarker(prompt);
		const ownedGoalId = goalMarker ?? continuationMarker;
		if (ownedGoalId) {
			// El marker de continuación es "goalId#N" (N = iteración): el id del
			// goal es el prefijo antes del #. El marker de prompt inicial es el id
			// pelado.
			const markerGoalId = goalMarker ?? ownedGoalId.split("#")[0]!;
			if (this.goal && markerGoalId === this.goal.id) {
				this.beginRun(markerGoalId, goalMarker ? "manual" : "automatic");
			}
			return;
		}
		// Input del usuario sin marcador: esteriliza la continuación pendiente.
		this.cancelPending();
		if (this.goal?.status === "active") {
			this.goal = resetSafetyEpoch(this.goal);
			this.persist();
			this.emitState();
		}
	}

	private onTurnEnd(_e: { message: unknown }): void {
		// noop en MVP: el accounting de turnos automáticos corre en agent_end.
	}

	private onAgentEnd(messages: readonly unknown[], ctx: ExtensionContext): void {
		const run = this.run;
		this.run = undefined;
		if (!this.goal || this.goal.status !== "active") return;
		if (run?.goalId && run.goalId !== this.goal.id) return;

		this.recordUsage(this.goal, ctx);
		const final = findFinalAssistantMessage(messages);
		const errorKind = classifyAssistantError(final);

		if (errorKind === "aborted") {
			this.stopAfterInterruption("paused", "interruption", "Corrida abortada.");
			return;
		}
		if (errorKind === "usage_limited") {
			this.stopAfterInterruption("paused", "usage_limited", String(final?.errorMessage ?? "límite de uso del proveedor"));
			return;
		}
		if (errorKind === "retryable") {
			// El host reintenta por sí solo; la continuación llegará vía
			// agent_settled del retry. No pausamos.
			this.persist();
			return;
		}
		if (errorKind === "blocked") {
			this.stopAfterInterruption("blocked", "agent_error", String(final?.errorMessage ?? "error del proveedor"));
			return;
		}

		// Progreso del run AUTOMÁTICO: contador de turnos (cap 25) + fingerprint
		// de no-progreso. Los runs manuales (prompt inicial del /goal, resume,
		// input del usuario) no consumen el cap — sólo las continuaciones que
		// el propio loop emite.
		if (run?.origin === "automatic") {
			this.goal = {
				...this.goal,
				automaticModelTurns: this.goal.automaticModelTurns + 1,
				...nextToolFreeRepeatState(this.goal, messages),
				updatedAt: Date.now(),
			};
		}

		if (this.enforceGuards(ctx, this.goal)) return;

		// Programar continuación (single-flight: agent_settled la dispara).
		const goalId = this.goal.id;
		this.goal = { ...this.goal, iteration: this.goal.iteration + 1, updatedAt: Date.now() };
		this.pending = { goalId, marker: `${goalId}#${this.goal.iteration}` };
		this.persist();
		this.emitState();
	}

	private onAgentSettled(ctx: ExtensionContext): void {
		// Único punto de inyección: el run terminó Y no hay retry/compaction/
		// follow-up pendientes.
		if (this.dispatching) return;
		const pending = this.pending;
		if (!pending || !this.goal) return;
		if (this.goal.id !== pending.goalId || this.goal.status !== "active") {
			this.cancelPending();
			return;
		}
		if (!ctx.isIdle() || ctx.hasPendingMessages()) {
			// El host está ocupado con otra cosa; la próxima settled reintenta.
			return;
		}
		this.cancelPending();
		this.dispatching = true;
		try {
			this.pi.sendUserMessage(buildContinuePrompt(this.goal, pending.marker));
		} finally {
			this.dispatching = false;
		}
	}

	private onInput(
		text: string,
		source: string,
		ctx: ExtensionContext,
	): void {
		if (source === "extension") {
			// Eco de prompts propios: nada que hacer (before_agent_start clasifica).
			return;
		}
		if (/^\/goal(?:\s|$)/u.test(text.trimStart())) return;
		// Input libre del usuario: esteriliza lo pendiente (el usuario manda).
		this.cancelPending();
		if (this.goal?.status === "active") {
			this.goal = resetSafetyEpoch(this.goal);
			this.recordUsage(this.goal, ctx);
			this.persist();
			this.emitState();
		}
	}

	private onSessionCompact(ctx: ExtensionContext): void {
		// Compaction-safe: restaurar el estado viajó en el árbol; re-disparar
		// la continuación se delega al agent_settled que sigue a la compaction
		// (el host reintenta el turno abortado si willRetry; si no, settled
		// llega igual). Aquí sólo re-sincronizamos usage.
		if (this.goal?.status === "active") {
			this.recordUsage(this.goal, ctx);
			this.persist();
		}
	}

	// ── Guards ─────────────────────────────────────────────────────────────

	/** Aplica los 3 guards a un goal activo. true = lo detuvo (y notificó). */
	private enforceGuards(_ctx: ExtensionContext, goal: ActiveGoal, restore = false): boolean {
		// 1) Cap de continuaciones automáticas.
		if (goal.automaticModelTurns >= MAX_AUTOMATIC_MODEL_TURNS) {
			this.goal = {
				...goal,
				status: "paused",
				pausedReason: `Límite de ${MAX_AUTOMATIC_MODEL_TURNS} continuaciones automáticas alcanzado.`,
				updatedAt: Date.now(),
			};
			this.cancelPending();
			this.persist();
			this.emitState();
			this.cb.notify(
				"warning",
				`🎯 Goal pausado: ${MAX_AUTOMATIC_MODEL_TURNS} continuaciones automáticas. /goal resume para seguir o /goal clear para terminar.`,
			);
			return true;
		}
		// 2) Budget de tokens.
		if (
			goal.tokenBudget !== undefined &&
			goal.tokensUsed >= goal.tokenBudget
		) {
			this.goal = {
				...goal,
				status: "paused",
				pausedReason: `Budget de tokens agotado (${goal.tokensUsed}/${goal.tokenBudget}).`,
				updatedAt: Date.now(),
			};
			this.cancelPending();
			this.persist();
			this.emitState();
			this.cb.notify(
				"warning",
				`🎯 Goal pausado: budget de ${goal.tokenBudget} tokens agotado. /goal resume para continuar de todos modos.`,
			);
			return true;
		}
		// 3) No-progreso: sólo con run automático registrado (en agent_end se
		// actualiza el fingerprint antes de llamar). En restore no aplica.
		if (!restore && goal.toolFreeRepeatCount >= MAX_TOOL_FREE_REPEATS) {
			this.goal = {
				...goal,
				status: "paused",
				pausedReason: "Sin progreso: 3 respuestas automáticas idénticas sin usar tools.",
				updatedAt: Date.now(),
			};
			this.cancelPending();
			this.persist();
			this.emitState();
			this.cb.notify(
				"warning",
				"🎯 Goal pausado por no-progreso (3 outputs idénticos sin tools). Escribe al agente o /goal resume.",
			);
			return true;
		}
		return false;
	}

	/** Actualiza tokensUsed (delta vs baseline) y el contador de turnos
	 *  automáticos + fingerprint de no-progreso. */
	private recordUsage(goal: ActiveGoal, ctx: ExtensionContext): void {
		const current = contextTokens(ctx);
		if (current > 0) {
			goal.tokensUsed = Math.max(0, current - goal.baselineTokens);
		}
		goal.updatedAt = Date.now();
	}

	// ── Helpers ────────────────────────────────────────────────────────────

	private beginRun(goalId: string | null, origin: "manual" | "automatic"): void {
		this.run = { goalId, origin, toolAttempted: false };
	}

	private cancelPending(): void {
		this.pending = undefined;
	}

	private persist(): void {
		this.pi.appendEntry(GOAL_STATE_ENTRY_TYPE, { goal: this.goal ?? null });
	}

	private emitState(): void {
		this.cb.onState(this.goal ? toSnapshot(this.goal) : undefined);
	}
}

function hashText(value: string): string {
	let h = 0;
	for (let i = 0; i < value.length; i++) {
		h = (Math.imul(31, h) + value.charCodeAt(i)) | 0;
	}
	return `fp-${h.toString(36)}`;
}

function formatStatusLine(goal: ActiveGoal): string {
	const budget =
		goal.tokenBudget === undefined
			? ""
			: ` · ${goal.tokensUsed}/${goal.tokenBudget} tok`;
	const line = `🎯 [${goal.status}] ${goal.text.slice(0, 80)} · auto ${goal.automaticModelTurns}/${MAX_AUTOMATIC_MODEL_TURNS}${budget}`;
	if (goal.status === "paused" && goal.pausedReason)
		return `${line}\nPausado: ${goal.pausedReason}`;
	if (goal.status === "blocked" && goal.blockedReason)
		return `${line}\nBloqueado: ${goal.blockedReason}`;
	return line;
}
