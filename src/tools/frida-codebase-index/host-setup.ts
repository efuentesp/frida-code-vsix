/**
 * frida-codebase-index — host setup (issue #25, ADR-0036, D4).
 *
 * Dos efectos de lado del host ANTES de crear la sesión:
 *
 * 1. syncOpenAiKeyToAuthJson: si el usuario guardó la OpenAI key en Frida
 *    (SecretStorage frida.openaiKey, issue #43), la expone al detector de
 *    embeddings del upstream escribiendo authData["openai"]={type:"api",key}
 *    en <agentDir>/auth.json (research §F). Merge defensivo read-modify-write:
 *    NUNCA pisa una entrada `openai` existente del usuario — sea cual sea su
 *    shape (api con key, oauth, null tombstone, o cualquier otro): la suya
 *    manda — y nunca tira el resto del archivo (github-copilot oauth vive
 *    ahí). Best-effort: fallos se loggean, no rompen la sesión.
 * 2. ensureGitignore: añade `.codebase-index/` al .gitignore del workspace si
 *    no está (storage del upstream DENTRO del repo — research §D), para que el
 *    índice no aparezca como ruido en el SCM. Sin .gitignore lo crea.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { CODEBASE_INDEX_STORAGE_DIR } from "./constants";

export interface SyncOpenAiKeyResult {
  written: boolean;
  /** already-present: el usuario ya tiene CUALQUIER auth openai propia (la suya
   *  manda). no-key: no hay OpenAI key guardada en Frida. */
  skipped?: "already-present" | "no-key";
}

/**
 * Expone la OpenAI key de Frida al detector del upstream vía auth.json del
 * agentDir. Idempotente y no destructivo. NOTA de carrera: el CLI `pi` también
 * escribe auth.json — ventana de carrera mínima (read-modify-write sin lock) y
 * el peor caso es re-escribir la misma entrada o perder una auth añadida
 * EXACTAMENTE entre read y write (no hemos visto locks en el SDK; aceptamos el
 * riesgo documentándolo).
 */
export function syncOpenAiKeyToAuthJson(
  agentDir: string,
  openAiKey: string | undefined,
  onLog?: (line: string) => void,
): SyncOpenAiKeyResult {
  if (!openAiKey) return { written: false, skipped: "no-key" };
  const authPath = path.join(agentDir, "auth.json");
  let data: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(authPath, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    /* ausente o inválido → empezamos un objeto nuevo */
  }
  const existing = data.openai;
  // NUNCA pisamos una entrada openai existente del usuario — sea cual sea su
  // shape (api con key, oauth, null tombstone, o cualquier otro): la suya manda
  // (D4 absoluto; un null puede ser un provider deliberadamente desactivado).
  if (existing !== undefined) {
    return { written: false, skipped: "already-present" };
  }
  data.openai = { type: "api", key: openAiKey };
  try {
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(authPath, JSON.stringify(data, null, 2));
    // chmod explícito (el mode flag de writeFileSync sólo aplica en creación;
    // auth.json ya suele existir con github-copilot oauth — patrón
    // ApprovalLogger, gates/approval-logger.ts).
    fs.chmodSync(authPath, 0o600);
    return { written: true };
  } catch (e: any) {
    onLog?.(`[codebase-index] syncOpenAiKey falló: ${e?.message ?? e}`);
    return { written: false };
  }
}

/** Añade `.codebase-index/` al .gitignore del workspace si no está. Devuelve
 *  true si escribió. Best-effort: fallos silenciosos (no rompen la sesión). */
export function ensureGitignore(
  workspacePath: string,
  onLog?: (line: string) => void,
): boolean {
  const giPath = path.join(workspacePath, ".gitignore");
  const entry = `${CODEBASE_INDEX_STORAGE_DIR}/`;
  try {
    if (fs.existsSync(giPath)) {
      const cur = fs.readFileSync(giPath, "utf8");
      const lines = cur.split("\n").map((l) => l.trim());
      if (
        lines.includes(entry.trim()) ||
        lines.includes(CODEBASE_INDEX_STORAGE_DIR)
      ) {
        return false;
      }
      const next = cur.endsWith("\n")
        ? `${cur}${entry}\n`
        : `${cur}\n${entry}\n`;
      fs.writeFileSync(giPath, next);
      return true;
    }
    fs.writeFileSync(giPath, `${entry}\n`);
    return true;
  } catch (e: any) {
    onLog?.(`[codebase-index] ensureGitignore falló: ${e?.message ?? e}`);
    return false;
  }
}
