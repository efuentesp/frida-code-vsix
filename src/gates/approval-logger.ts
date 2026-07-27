// Logger de auditoría del gate de aprobación (Prioridad 2).
//
// Escribe una línea JSONL por cada decisión TERMINAL del gate (allow o block),
// para cerrar el gap de auditoría que Frida vende como pilar (§2 CONTEXT.md:
// "todo lo que pasa por el router queda logueado") pero que los gates de tools
// no cubrían. Cada entrada es correlacionable por timestamp + tool + decisión.
//
// Endurecimiento de ficheros (como gotgenes): el directorio se crea 0700 y el
// archivo 0600, porque el log lleva comandos bash y paths potencialmente
// sensibles. Best-effort: en Windows chmod solo toggrea read-only y nunca
// rompe el gate (la operación real del gate es lo importante).
//
// Es NO-BLOQUEANTE respecto al gate: cualquier fallo de IO se traga (nothrow),
// porque un logger roto no debe impedir una decisión de seguridad. El log es
// observabilidad, no control.

import { appendFileSync, chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** Resultado terminal del gate para una llamada de tool. */
export type GateDecision = "allow" | "block";

/** Origen de la decisión (trazabilidad de POR QUÉ se allow/block). */
export type DecisionSource =
  | "mode" // modo auto/auto-edit dejó pasar sin preguntar
  | "sensitive_path" // path sensible bloqueado por policy
  | "dangerous_command" // comando destructivo bloqueado por policy
  | "user_approved" // el usuario aceptó el diálogo
  | "user_rejected" // el usuario rechazó el diálogo
  | "gate_error"; // excepción → fail-closed

export interface ApprovalLogEntry {
  /** ISO timestamp de la decisión. */
  ts: string;
  /** Id de sesión de Pi (best-effort; puede faltar). */
  sessionId?: string;
  /** Nombre del tool. */
  tool: string;
  /** Clasificación: diff | bash | tool. */
  kind: "diff" | "bash" | "tool";
  /** Decisión terminal. */
  decision: GateDecision;
  /** Por qué se llegó a esa decisión. */
  source: DecisionSource;
  /** Path involucrado (si aplica). */
  path?: string;
  /** Comando bash involucrado (si aplica). */
  command?: string;
  /** Patrón que disparó un deny por policy (sensitive_path / dangerous_command). */
  pattern?: string;
  /** Motivo legible (especialmente en block). */
  reason?: string;
  /** Marcadores de force-ask (compound_command / external_path) para correlación. */
  flags?: string[];
}

/**
 * Logger append-only JSONL. Una instancia por sesión de Frida.
 *
 * No mantiene estado entre escrituras: cada `log()` es un append síncrono
 * (pequeño, baja frecuencia — una por tool call) que garantiza orden y no
 * pierde entradas ante crash.
 */
export class ApprovalLogger {
  private dirEnsured = false;

  constructor(private readonly logPath: string) {}

  /** Escribe una entrada. No lanza: un fallo de IO nunca rompe el gate. */
  log(entry: ApprovalLogEntry): void {
    try {
      this.ensureDir();
      // ¿Es la primera escritura (archivo nuevo)? El chmod 0600 debe ir DESPUÉS
      // de crear el archivo: si se hace antes, appendFileSync lo crea con el
      // modo por defecto del umask (0o644) y el chmod previo no aplica a nada.
      const isNew = !existsSync(this.logPath);
      const line = JSON.stringify(entry) + "\n";
      appendFileSync(this.logPath, line, { encoding: "utf8" });
      if (isNew) this.chmodBestEffort(this.logPath, 0o600);
    } catch {
      // Intencionalmente ignorado: el log es observabilidad, no control.
      // Un logger roto no debe impedir ni alterar la decisión de seguridad.
    }
  }

  /** Crea el directorio (0700) una sola vez (idempotente). */
  private ensureDir(): void {
    if (this.dirEnsured) return;
    try {
      mkdirSync(dirname(this.logPath), { recursive: true, mode: 0o700 });
      // mkdir mode lo respeta umask; reforzamos best-effort (como gotgenes).
      this.chmodBestEffort(dirname(this.logPath), 0o700);
    } catch {
      // Si no se pudo crear, appendFileSync fallará luego y se tragará en log().
    }
    this.dirEnsured = true;
  }

  private chmodBestEffort(target: string, mode: number): void {
    try {
      chmodSync(target, mode);
    } catch {
      // Windows: chmod solo toggrea read-only y puede rechazar directorios.
      // No reportamos: sería ruido en cada sesión.
    }
  }
}
