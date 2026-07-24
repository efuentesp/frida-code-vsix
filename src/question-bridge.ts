// Puente entre el tool `ask_user_question` (corre en-proceso dentro de Pi) y el
// webview. Análogo a ApprovalBridge: el `execute` del tool llama request() y queda
// en await; el webview responde vía resolve() cuando el usuario envía o cancela.
//
// Abort del turn (ADR-0006, decisión A): el `execute` recibe el AbortSignal del
// turn de Pi. Como Pi NO hace Promise.race con él (el corte `if (signal?.aborted)
// break` corre solo después de que el tool termine), si no escuchamos el signal el
// agent loop se cuelga. Por eso request() acepta `signal`: al dispararse resuelve
// como `cancelled`, elimina la entrada pendiente y emite onChange —la tarjeta
// desaparece del webview por el mismo conducto que los approvals (post questions:[]).

export interface QuestionOption {
  label: string;
  description: string;
  preview?: string;
}

export interface QuestionSpec {
  question: string;
  header: string;
  multiSelect?: boolean;
  options: QuestionOption[];
}

/** Una respuesta del usuario a una pregunta. */
export interface QuestionAnswer {
  questionIndex: number;
  /** option = eligió una opción · custom = escribió su propia respuesta · multi = varias. */
  kind: "option" | "custom" | "multi";
  /** Label elegido (option) o texto libre (custom); null para multi. */
  answer: string | null;
  /** Labels elegidos, solo en multi. */
  selected?: string[];
  /** Nota opcional del usuario. */
  notes?: string;
}

export interface QuestionRequest {
  /** Igual al toolCallId de Pi (igual que los approvals). */
  id: string;
  questions: QuestionSpec[];
}

export interface QuestionResponse {
  id: string;
  answers: QuestionAnswer[];
  cancelled: boolean;
}

type Resolver = (r: QuestionResponse) => void;

interface Pending {
  req: QuestionRequest;
  resolve: Resolver;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export class QuestionBridge {
  private pending = new Map<string, Pending>();

  constructor(private readonly onChange: (reqs: QuestionRequest[]) => void) {}

  /**
   * Pide al usuario que responda `req`. Resuelve cuando el webview llama resolve(),
   * o cuando `signal` se dispara (abort del turn) → resuelve como `cancelled`.
   * Race-safe: gana el primero entre resolve()/abort; el otro es no-op.
   */
  request(req: QuestionRequest, signal?: AbortSignal): Promise<QuestionResponse> {
    return new Promise<QuestionResponse>((resolve) => {
      // Abort ya disparado al entrar: resolvemos enseguida sin registrar nada.
      if (signal?.aborted) {
        resolve({ id: req.id, answers: [], cancelled: true });
        return;
      }

      const onAbort = () => {
        const entry = this.pending.get(req.id);
        if (!entry) return; // ya resuelto por resolve() normal
        this.pending.delete(req.id);
        entry.resolve({ id: req.id, answers: [], cancelled: true });
        this.emit();
      };
      if (signal) signal.addEventListener("abort", onAbort, { once: true });

      this.pending.set(req.id, { req, resolve, signal, onAbort });
      this.emit();
    });
  }

  /** El webview respondió (enviar o cancelar). Idempotente si ya se resolvió por abort. */
  resolve(resp: QuestionResponse): void {
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
