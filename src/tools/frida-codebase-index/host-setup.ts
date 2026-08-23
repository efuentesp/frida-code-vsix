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

/* ──────────────────────────────────────────────────────────────────────────
 * #116 (Fase A) — syncCodebaseIndexConfig: materializa la elección del
 * proveedor de embeddings en <ws>/.codebase-index/config.json (el archivo
 * que el upstream parsea con parseConfig). Merge defensivo
 * read-modify-write: solo toca las claves de embeddings, preserva scope/
 * include/exclude/indexing/… que el usuario (u otra tool) haya puesto.
 *
 * TRADE-OFF DOCUMENTADO: para frida-enterprise, el idToken OAuth queda en
 * texto plano dentro de config.json (gitignorado por ensureGitignore, pero
 * en disco). Alternativa futura: env-var si el upstream la soporta.
 *──────────────────────────────────────────────────────────────────────────*/

export type EmbeddingsProviderSetting =
  | "auto"
  | "frida-enterprise"
  | "ollama"
  | "openai"
  | "custom";

export interface SyncEmbeddingsOpts {
  provider: EmbeddingsProviderSetting;
  /** COMPATIBLE_API_URL de la sesión Enterprise (sin /v1 — se añade aquí). */
  enterpriseBaseUrl?: string;
  /** idToken OAuth de la sesión activa (Bearer). */
  enterpriseToken?: string;
  /** Default "azure-embeddings-default". */
  enterpriseModel?: string;
  /** Deducido por pingEmbeddingsProvider — OBLIGATORIO (entero >0) en el
   *  upstream para customProvider; sin él no se escribe nada. */
  enterpriseDimensions?: number;
  /** Default "nomic-embed-text". */
  ollamaModel?: string;
  /** Default "text-embedding-3-small". La API key via auth.json (sync
   *  existente #43), no por config.json. */
  openaiModel?: string;
  customBaseUrl?: string;
  customModel?: string;
  customDimensions?: number;
}

export interface SyncEmbeddingsResult {
  written: boolean;
  /** auto: el upstream autodetecta, no se escribe. missing-dimensions:
   *  enterprise sin dimensions verificadas (ping pendiente).
   *  missing-config: custom incompleto. */
  skipped?: "auto" | "missing-dimensions" | "missing-config";
}

/**
 * Escribe la configuración de embeddings elegida por el usuario al
 * config.json del proyecto (verificado contra parseConfig del upstream:
 * claves embeddingProvider/embeddingModel/customProvider). Idempotente y
 * no destructivo con claves ajenas a embeddings.
 */
export function syncCodebaseIndexConfig(
  workspacePath: string,
  opts: SyncEmbeddingsOpts,
  onLog?: (line: string) => void,
): SyncEmbeddingsResult {
  if (opts.provider === "auto") return { written: false, skipped: "auto" };

  let next: Record<string, unknown> | null = null;
  if (opts.provider === "frida-enterprise") {
    const dims = opts.enterpriseDimensions ?? 0;
    if (!Number.isInteger(dims) || dims <= 0) {
      return { written: false, skipped: "missing-dimensions" };
    }
    if (!opts.enterpriseBaseUrl || !opts.enterpriseToken) {
      return { written: false, skipped: "missing-config" };
    }
    const base = opts.enterpriseBaseUrl.replace(/\/+$/, "");
    next = {
      embeddingProvider: "custom",
      customProvider: {
        baseUrl: `${base}/v1`,
        model: opts.enterpriseModel || "azure-embeddings-default",
        apiKey: opts.enterpriseToken,
        dimensions: dims,
      },
    };
  } else if (opts.provider === "ollama") {
    next = {
      embeddingProvider: "ollama",
      embeddingModel: opts.ollamaModel || "nomic-embed-text",
    };
  } else if (opts.provider === "openai") {
    next = {
      embeddingProvider: "openai",
      embeddingModel: opts.openaiModel || "text-embedding-3-small",
    };
  } else {
    // custom
    if (
      !opts.customBaseUrl ||
      !opts.customModel ||
      !opts.customDimensions ||
      opts.customDimensions <= 0
    ) {
      return { written: false, skipped: "missing-config" };
    }
    next = {
      embeddingProvider: "custom",
      customProvider: {
        baseUrl: opts.customBaseUrl.replace(/\/+$/, ""),
        model: opts.customModel,
        dimensions: opts.customDimensions,
      },
    };
  }

  const cfgDir = path.join(workspacePath, CODEBASE_INDEX_STORAGE_DIR);
  const cfgPath = path.join(cfgDir, "config.json");
  let merged: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      merged = parsed as Record<string, unknown>;
    }
  } catch {
    /* ausente o inválido → objeto nuevo */
  }
  // Limpia restos de proveedor anterior (p. ej. ollama→custom) para que
  // parseConfig no mezcle señales: solo se tocan claves de embeddings.
  delete merged.embeddingModel;
  delete merged.customProvider;
  Object.assign(merged, next);
  try {
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.writeFileSync(cfgPath, JSON.stringify(merged, null, 2));
    return { written: true };
  } catch (e: any) {
    onLog?.(
      `[codebase-index] syncCodebaseIndexConfig falló: ${e?.message ?? e}`,
    );
    return { written: false };
  }
}

/** Credencial OAuth de Frida Enterprise leída de <agentDir>/auth.json
 *  (persistida por pi-ai tras el login; clave "frida-enterprise"). #116 */
export interface EnterpriseEmbeddingsCredential {
  /** COMPATIBLE_API_URL (sin /v1). */
  baseUrl: string;
  /** idToken (access) — Bearer del endpoint compatible. */
  token: string;
  /** Epoch ms de expiración del access token. */
  expiresMs: number;
  /** true si el access ya expiró (refresh solo lo hace pi-ai al usar el provider). */
  expired: boolean;
}

export function readEnterpriseEmbeddingsCredential(
  agentDir: string,
): EnterpriseEmbeddingsCredential | null {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(agentDir, "auth.json"), "utf8"),
    );
    const cred = (parsed as Record<string, any>)?.["frida-enterprise"];
    const url =
      typeof cred?.compatibleApiUrl === "string" ? cred.compatibleApiUrl : "";
    const token = typeof cred?.access === "string" ? cred.access : "";
    const expiresMs = Number(cred?.expires) || 0;
    if (!url || !token || !expiresMs) return null;
    return {
      baseUrl: url.replace(/\/+$/, ""),
      token,
      expiresMs,
      expired: Date.now() >= expiresMs,
    };
  } catch {
    return null;
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * #120 — Toggle de indexación automática (indexing.autoIndex del config.json
 * del upstream). Lectura + escritura con merge defensivo (solo la clave
 * indexing.autoIndex se toca; scope/include/exclude/… quedan intactos).
 *──────────────────────────────────────────────────────────────────────────*/

/** ¿Está activa la indexación automática del workspace? (default false) */
export function readAutoIndexEnabled(workspacePath: string): boolean {
  const cfgPath = path.join(
    workspacePath,
    CODEBASE_INDEX_STORAGE_DIR,
    "config.json",
  );
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    const obj = parsed as Record<string, unknown> | null;
    const idx = obj?.indexing as Record<string, unknown> | undefined;
    return idx?.autoIndex === true;
  } catch {
    return false;
  }
}

/** Activa/desactiva autoIndex preservando el resto del config. */
export function setAutoIndexEnabled(
  workspacePath: string,
  enabled: boolean,
): boolean {
  const cfgDir = path.join(workspacePath, CODEBASE_INDEX_STORAGE_DIR);
  const cfgPath = path.join(cfgDir, "config.json");
  let merged: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      merged = parsed as Record<string, unknown>;
    }
  } catch {
    /* ausente o inválido → objeto nuevo */
  }
  const indexing =
    merged.indexing && typeof merged.indexing === "object"
      ? { ...(merged.indexing as Record<string, unknown>) }
      : {};
  indexing.autoIndex = enabled;
  merged.indexing = indexing;
  try {
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.writeFileSync(cfgPath, JSON.stringify(merged, null, 2));
    return true;
  } catch {
    return false;
  }
}
