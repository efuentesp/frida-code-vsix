// Puente entre el gate `tool_call` (corre en-proceso dentro de Pi) y el webview.
// El handler del gate llama request() y queda en await; el webview responde vía
// resolve() cuando el usuario hace clic en Aceptar/Rechazar.
//
// Abort del turn (ADR-0006, decisión A — aplicado también aquí): Pi no hace
// Promise.race con el signal del tool; si no lo escuchamos, el handler queda en
// await y el agent loop se cuelga. Por eso request() acepta `signal`: al
// dispararse resuelve como REJECT (la acción no procede) y limpia la tarjeta.
// Mismo patrón que QuestionBridge; la generalización a DialogBridge<T> queda como
// refactor posterior (ADR-0006, "Patrón reutilizable").

export interface ApprovalRequest {
  id: string;
  toolName: string;
  kind: "diff" | "bash";
  path?: string;
  command?: string;
  diff?: string;
}

export interface ApprovalResponse {
  id: string;
  decision: "accept" | "reject";
  acceptAll?: boolean;
}

type Resolver = (r: ApprovalResponse) => void;

interface Pending {
  req: ApprovalRequest;
  resolve: Resolver;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export class ApprovalBridge {
  private pending = new Map<string, Pending>();

  constructor(private readonly onChange: (reqs: ApprovalRequest[]) => void) {}

  /**
   * Pide aprobación para `req`. Resuelve cuando el webview llama resolve(), o
   * cuando `signal` se dispara (abort del turn) → resuelve como reject.
   * Race-safe: gana el primero entre resolve()/abort; el otro es no-op.
   */
  request(req: ApprovalRequest, signal?: AbortSignal): Promise<ApprovalResponse> {
    return new Promise<ApprovalResponse>((resolve) => {
      if (signal?.aborted) {
        resolve({ id: req.id, decision: "reject" });
        return;
      }

      const onAbort = () => {
        const entry = this.pending.get(req.id);
        if (!entry) return; // ya resuelto por resolve() normal
        this.pending.delete(req.id);
        entry.resolve({ id: req.id, decision: "reject" });
        this.emit();
      };
      if (signal) signal.addEventListener("abort", onAbort, { once: true });

      this.pending.set(req.id, { req, resolve, signal, onAbort });
      this.emit();
    });
  }

  /** El webview respondió. Idempotente si ya se resolvió por abort. */
  resolve(resp: ApprovalResponse): void {
    const entry = this.pending.get(resp.id);
    if (!entry) return;
    this.pending.delete(resp.id);
    if (entry.signal && entry.onAbort) entry.signal.removeEventListener("abort", entry.onAbort);
    entry.resolve(resp);
    this.emit();
  }

  private emit(): void {
    this.onChange([...this.pending.values()].map((e) => e.req));
  }
}
