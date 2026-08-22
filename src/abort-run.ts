/**
 * abortRun (#96): orquestación del botón Detener / doble Esc / comando
 * frida.abort.
 *
 * Extraída de extension.ts como seam testeable (mismo precedente que
 * src/abort-gate.ts en #90): la función vive en el closure de activate()
 * con ~8 dependencias mutables del host, imposible de testear in situ.
 *
 * El contrato crítico que este módulo debe garantizar: el abort SIEMPRE se
 * ejecuta sobre el AgentSession real del SDK (fridaSession.session), nunca
 * sobre undefined. La regresión #96 fue un doble desestructurado
 * (`const s = session.session` con `session` YA siendo el AgentSession)
 * que volvió no-op el 100% de los aborts: clearQueue, abortBash, abort
 * y la señal del agente nunca se tocaban (firma forense: isIdle=? en
 * ~/.frida/logs/abort.log).
 */
import { ABORT_GATE_TTL_MS } from "./abort-gate";

/** Forma mínima de FridaSession que abortRun necesita (desacoplada del
 *  tipo completo de pi-session.ts para no arrastrar dependencias del host). */
export interface AbortSessionLike {
	session: any;
}

export interface AbortRunDeps {
	ensureSession: () => Promise<AbortSessionLike>;
	abortDiag: (msg: string) => void;
	queueStore: {
		snapshot: () => readonly unknown[];
		restoreAll: () => string[];
	};
	resetQueue: () => void;
	post: (msg: any) => void;
	/** inRetry es un `let` mutable del host → getter, no valor. */
	isInRetry: () => boolean;
	abortGate: { requestAbort: () => void };
	abortGateTtlMs?: number;
}

export async function abortRun(deps: AbortRunDeps): Promise<void> {
	const { abortDiag, queueStore, resetQueue, post } = deps;
	const ttlMs = deps.abortGateTtlMs ?? ABORT_GATE_TTL_MS;
	abortDiag(
		`abortRun START — pendingLocal=${queueStore.snapshot().length} inRetry=${deps.isInRetry()}`,
	);
	const t0 = Date.now();
	try {
		const { session } = await deps.ensureSession();
		// #96: session YA es el AgentSession (desestructurado de FridaSession).
		// El histórico `const s = session.session` buscaba una propiedad .session
		// que AgentSession no tiene → s=undefined → todos los aborts no-op.
		const s = session;
		abortDiag(
			`pre-abort — isStreaming=${!!s?.isStreaming} isBashRunning=${!!s?.isBashRunning} isIdle=${s?.isIdle ?? "?"} isRetrying=${!!s?.isRetrying} retryAttempt=${s?.retryAttempt ?? "?"} agentSignalAborted=${!!s?.agent?.signal?.aborted} queueSteer=${s?.getSteeringMessages?.().length ?? "?"} queueFollow=${s?.getFollowUpMessages?.().length ?? "?"} pendingLocal=${queueStore.snapshot().length}`,
		);
		// VACIAR LA COLA DE ENCOLADOS ANTES DE ABORTAR. El abort() del SDK NO vacía
		// la cola interna de steer/followUp: si hay mensajes encolados, sobreviven
		// al abort y el agente los procesa al cancelar el turno actual → parece que
		// "no sucede nada" al presionar Detener. clearQueue() vacía
		// _steeringMessages/_followUpMessages + agent.clearAllQueues() (paridad con
		// el Esc de la TUI de pi: restoreQueuedMessagesToEditor({abort:true}) llama
		// clearAllQueues() ANTES de agent.abort()). Restauramos los textos al
		// composer (vía composer_insert) para no perder lo encolado.
		const restoreTexts = queueStore.restoreAll();
		try {
			s?.clearQueue?.();
		} catch {
			/* noop */
		}
		resetQueue();
		abortDiag(
			`post-clearQueue — queueSteer=${s?.getSteeringMessages?.().length ?? "?"} queueFollow=${s?.getFollowUpMessages?.().length ?? "?"} pendingLocal=${queueStore.snapshot().length}`,
		);
		if (restoreTexts.length > 0) {
			post({ type: "composer_insert", text: restoreTexts.join("\n\n") });
		}
		// C: el botón Detener SIEMPRE aborta la corrida completa. Como primer paso
		// (paridad TUI: el primer Esc mata el bash en vuelo) cesamos el bash y el
		// retry en curso de inmediato — PERO sin return: después abortamos el
		// agente entero. Antes los early-returns dejaban la corrida autónoma
		// corriendo (solo mataban un bash/retry a la vez y el run seguía).
		if (s?.isBashRunning) {
			abortDiag("isBashRunning → abortBash()");
			try {
				await s.abortBash?.();
			} catch {
				/* noop */
			}
		}
		if (deps.isInRetry()) {
			abortDiag("inRetry → abortRetry()");
			try {
				await s.abortRetry?.();
			} catch {
				/* noop */
			}
		}
		// B: session.abort() dispara agent.abort() (la señal) y luego await
		// waitForIdle(). Si un tool largo no respeta la señal (frida-subagents ya
		// la propaga vía signal→child.abort; un MCP de terceros podría no hacerlo),
		// waitForIdle() podría tardar: carreramos con un timeout de 8s para no
		// colgar el botón. El evento agent_end (al que ya nos suscribimos) bajará
		// busy cuando el agente realmente pare, aun si esta promesa resuelve antes.
		abortDiag("abort() race(8s) START");
		let timedOut = false;
		await Promise.race([
			Promise.resolve(s?.abort?.()).then(() => {
				abortDiag(
					`abort() RESOLVED tras ${Date.now() - t0}ms — isIdle=${s?.isIdle ?? "?"} isStreaming=${!!s?.isStreaming} isRetrying=${!!s?.isRetrying} retryAttempt=${s?.retryAttempt ?? "?"} agentSignalAborted=${!!s?.agent?.signal?.aborted}`,
				);
			}),
			new Promise<void>((resolve) =>
				setTimeout(() => {
					timedOut = true;
					resolve();
				}, 8000),
			),
		]);
		if (timedOut) {
			abortDiag(
				`abort() TIMEOUT 8000ms — SIGUE isStreaming=${!!s?.isStreaming} isIdle=${s?.isIdle ?? "?"} isRetrying=${!!s?.isRetrying} retryAttempt=${s?.retryAttempt ?? "?"} agentSignalAborted=${!!s?.agent?.signal?.aborted} (probable tool/MCP/subagente que ignora la señal de abort)`,
			);
		}
		// #90: marcar el gate — si el abort cayó en el GAP entre runs (no-op) o el
		// ciclo tool→LLM sigue vivo, el PRÓXIMO agent_start se re-aborta (ahí el
		// abort del SDK sí mata el run con isStreaming=true). El gate se limpia con
		// agent_settled real (isIdle) o un prompt nuevo del usuario.
		deps.abortGate.requestAbort();
		abortDiag(
			`abortGate SET (re-abortará agent_start si el ciclo sigue vivo; TTL ${ttlMs / 1000}s)`,
		);
		abortDiag(`abortRun END tras ${Date.now() - t0}ms`);
	} catch (e: any) {
		abortDiag(`abortRun THROW: ${String(e?.message ?? e)}`);
	}
}
