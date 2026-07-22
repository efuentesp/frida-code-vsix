// Puente entre el gate `tool_call` (corre en-proceso dentro de Pi) y el webview.
// El handler del gate llama request() y queda en await; el webview responde vía
// resolve() cuando el usuario hace clic en Aceptar/Rechazar.

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

export class ApprovalBridge {
  private pending = new Map<string, { req: ApprovalRequest; resolve: Resolver }>();

  constructor(
    private readonly onChange: (reqs: ApprovalRequest[]) => void,
    private readonly log?: (m: string) => void
  ) {}

  request(req: ApprovalRequest): Promise<ApprovalResponse> {
    this.log?.(`approval:request id=${req.id} kind=${req.kind} tool=${req.toolName}`);
    return new Promise<ApprovalResponse>((resolve) => {
      this.pending.set(req.id, { req, resolve });
      this.emit();
    });
  }

  resolve(resp: ApprovalResponse): void {
    const entry = this.pending.get(resp.id);
    this.log?.(
      `approval:resolve id=${resp.id} decision=${resp.decision} acceptAll=${!!resp.acceptAll} ${
        entry ? "(encontrado)" : "(DESCONOCIDO — no estaba pendiente)"
      }`
    );
    if (!entry) return;
    this.pending.delete(resp.id);
    entry.resolve(resp);
    this.emit();
  }

  pendingCount(): number {
    return this.pending.size;
  }

  private emit(): void {
    this.onChange([...this.pending.values()].map((e) => e.req));
  }
}
