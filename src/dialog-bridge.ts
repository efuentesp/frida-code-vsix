// Puente genérico host↔webview para diálogos bloqueantes: aprobaciones (D7) y
// preguntas al usuario (ADR-0006). Reúne el patrón que antes vivía duplicado en
// ApprovalBridge y WebBridge (Map de pendientes + race con el AbortSignal
// del turn + emisión de cambios), ahora una sola vez (ADR-0006,
// "Patrón reutilizable").
//
// Abort del turn: Pi NO hace Promise.race con el signal del tool
// (pi-agent-core/agent-loop.js: el corte `if (signal?.aborted) break` corre
// solo DESPUÉS de que el tool termine), así que si el puente no lo escucha el
// handler queda en await y el agent loop se cuelga. Por eso request() acepta
// `signal`: al dispararse resuelve con cancelledResponse(id) —cada diálogo
// decide su forma: reject para approvals, cancelled para questions—, elimina
// la entrada pendiente y emite onChange, y la tarjeta desaparece del webview
// por el mismo conducto que los approvals/questions (post de un array vacío).

/** Toda petición de diálogo se identifica por `id` (== toolCallId de Pi). */
export interface DialogRequest {
	id: string;
}
/** Toda respuesta de diálogo repite el `id` para emparejarla con su petición. */
export interface DialogResponse {
	id: string;
}

interface Pending<TReq, TResp> {
	req: TReq;
	resolve: (r: TResp) => void;
	signal?: AbortSignal;
	onAbort?: () => void;
}

/**
 * Clase base de los puentes de diálogo. `TReq`/`TResp` deben llevar `id`.
 * Las subclases solo implementan `cancelledResponse` (la forma de "abortado").
 */
export abstract class DialogBridge<
	TReq extends DialogRequest,
	TResp extends DialogResponse,
> {
	private pending = new Map<string, Pending<TReq, TResp>>();

	constructor(protected readonly onChange: (reqs: TReq[]) => void) {}

	/**
	 * Respuesta a resolver cuando el turn se aborta. Difiere por diálogo:
	 * approvals → `{ decision: "reject" }`, questions → `{ cancelled: true }`.
	 */
	protected abstract cancelledResponse(id: string): TResp;

	/**
	 * Pide al usuario que resuelva `req`. Resuelve cuando el webview llama
	 * resolve(), o cuando `signal` se dispara (abort del turn) → resuelve con
	 * cancelledResponse(req.id). Race-safe: gana el primero entre resolve()/abort;
	 * el otro es no-op.
	 */
	request(req: TReq, signal?: AbortSignal): Promise<TResp> {
		return new Promise<TResp>((resolve) => {
			// Abort ya disparado al entrar: resolver enseguida sin registrar nada.
			if (signal?.aborted) {
				resolve(this.cancelledResponse(req.id));
				return;
			}

			const onAbort = () => {
				const entry = this.pending.get(req.id);
				if (!entry) return; // ya resuelto por resolve() normal
				this.pending.delete(req.id);
				entry.resolve(this.cancelledResponse(req.id));
				this.emit();
			};
			if (signal) signal.addEventListener("abort", onAbort, { once: true });

			this.pending.set(req.id, { req, resolve, signal, onAbort });
			this.emit();
		});
	}

	/** El webview respondió (enviar o cancelar). Idempotente si ya se resolvió por abort. */
	resolve(resp: TResp): void {
		const entry = this.pending.get(resp.id);
		if (!entry) return;
		this.pending.delete(resp.id);
		if (entry.signal && entry.onAbort)
			entry.signal.removeEventListener("abort", entry.onAbort);
		entry.resolve(resp);
		this.emit();
	}

	protected emit(): void {
		this.onChange([...this.pending.values()].map((e) => e.req));
	}
}
