/**
 * frida-codebase-index — installer on-demand (issue #25, ADR-0036, D2).
 *
 * PI_OFFLINE (src/pi-session.ts) desactiva el auto-install del SDK → el host
 * instala. Spawn de npm con el MISMO mecanismo que el PackageManager del SDK
 * (npm install <spec> --prefix <agentDir>/npm --legacy-peer-deps —
 * package-manager.js) y poda post-install de los natives de otras
 * plataformas (~4/5 del disco en uso; research §C). Errores siempre con guía
 * accionable (D6, lección del revert 7500370).
 *
 * Limitaciones conocidas: withTimeout no mata el proceso npm huérfano al
 * expirar (defaultRun no expone el child); npm sin package.json en el prefix
 * sólo warning (exit 0) — no replicamos ensureNpmProject del SDK.
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  BUNDLED_NATIVES,
  CODEBASE_INDEX_PACKAGE,
  CODEBASE_INDEX_PIN,
  CODEBASE_INDEX_SPEC,
  currentPlatformNative,
  upstreamEntryPath,
  upstreamNativeDir,
} from "./constants";

/** Error de instalación con guía accionable (D6: nunca errores opacos). */
export class CodebaseIndexInstallError extends Error {
  /** Pasos concretos para resolver (se muestra al usuario en el tab/guía). */
  readonly guide: string;
  constructor(message: string, guide: string) {
    super(message);
    this.name = "CodebaseIndexInstallError";
    this.guide = guide;
  }
}

/** Ejecutable/resultado inyectable para tests. */
export interface InstallDeps {
  npmBin?: string;
  /** Spawn inyectable: resuelve código de salida o rechaza (ENOENT npm ausente). */
  run?: (
    bin: string,
    args: string[],
  ) => Promise<{ code: number | null; stderr: string }>;
  /** Timeout del spawn (ms). Default 10 min (tarball ~256 MB). */
  timeoutMs?: number;
}

/** Versión instalada del paquete en ~/.frida/npm (lee su package.json). */
export function installedVersion(agentDir: string): string | undefined {
  const pkgJson = path.join(
    agentDir,
    "npm",
    "node_modules",
    CODEBASE_INDEX_PACKAGE,
    "package.json",
  );
  try {
    const raw = JSON.parse(fs.readFileSync(pkgJson, "utf8")) as {
      version?: string;
    };
    return typeof raw.version === "string" ? raw.version : undefined;
  } catch {
    return undefined;
  }
}

/** ¿El paquete está instalado con el pin actual y entry válido? */
export function isInstalledAtPin(agentDir: string): boolean {
  return (
    installedVersion(agentDir) === CODEBASE_INDEX_PIN &&
    fs.existsSync(upstreamEntryPath(agentDir))
  );
}

/** Ejecuta un comando (impl real por defecto; win32 usa shell para npm.cmd). */
async function defaultRun(bin: string, args: string[]) {
  return new Promise<{ code: number | null; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(bin, args, {
        shell: process.platform === "win32",
      });
      let stderr = "";
      child.stderr?.on("data", (d) => {
        stderr += String(d);
      });
      child.on("error", reject); // ENOENT: npm ausente
      child.on("close", (code) => resolve({ code, stderr }));
    },
  );
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () =>
        reject(
          Object.assign(new Error(`timeout tras ${ms}ms`), {
            code: "ETIMEOUT",
          }),
        ),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * Poda best-effort de los natives de otras plataformas (research §C). Nunca
 * lanza: dejar natives extra sólo cuesta disco, no funcionalidad. Devuelve los
 * eliminados. Platform/arch inyectables (tests).
 */
export function pruneOtherPlatformNatives(
  agentDir: string,
  opts: {
    keepOtherPlatforms?: boolean;
    platform?: NodeJS.Platform;
    arch?: string;
  } = {},
): string[] {
  if (opts.keepOtherPlatforms) return [];
  const keep = currentPlatformNative(opts.platform, opts.arch);
  if (!keep) return []; // sin prebuild para esta plataforma: no podamos nada
  const dir = upstreamNativeDir(agentDir);
  const removed: string[] = [];
  try {
    for (const entry of fs.readdirSync(dir)) {
      if (
        entry !== keep &&
        (BUNDLED_NATIVES as readonly string[]).includes(entry)
      ) {
        fs.rmSync(path.join(dir, entry));
        removed.push(entry);
      }
    }
  } catch {
    /* best-effort: dir ausente o ilegible */
  }
  return removed;
}

export interface EnsureInstalledResult {
  alreadyInstalled: boolean;
  pruned: string[];
}

/** Comando manual equivalente, con prefix ABSOLUTO entre comillas (cmd.exe y
 *  PowerShell no expanden ~ en argumentos de comandos nativos — win32). */
function manualCmd(agentDir: string): string {
  return `npm install ${CODEBASE_INDEX_SPEC} --prefix "${path.join(agentDir, "npm")}" --legacy-peer-deps`;
}

/**
 * Garantiza que open-codebase-index@PIN esté instalado en <agentDir>/npm.
 * Idempotente: si ya está al pin con entry válido, no toca nada. Tras instalar
 * poda natives ajenos salvo keepOtherPlatforms. Falla con
 * CodebaseIndexInstallError (guía accionable) si npm falta/timeout/install falla.
 */
export async function ensureInstalled(
  agentDir: string,
  opts: {
    keepOtherPlatforms?: boolean;
    deps?: InstallDeps;
    onProgress?: (line: string) => void;
    platform?: NodeJS.Platform;
    arch?: string;
  } = {},
): Promise<EnsureInstalledResult> {
  if (isInstalledAtPin(agentDir)) return { alreadyInstalled: true, pruned: [] };
  const { npmBin = "npm", run = defaultRun, timeoutMs = 10 * 60_000 } =
    opts.deps ?? {};
  opts.onProgress?.(
    `Instalando ${CODEBASE_INDEX_SPEC} en ${path.join(agentDir, "npm")} (descarga ~256 MB)…`,
  );
  fs.mkdirSync(path.join(agentDir, "npm"), { recursive: true });
  let res: { code: number | null; stderr: string };
  try {
    res = await withTimeout(
      run(npmBin, [
        "install",
        CODEBASE_INDEX_SPEC,
        "--prefix",
        path.join(agentDir, "npm"),
        "--legacy-peer-deps",
        "--no-audit",
        "--no-fund",
      ]),
      timeoutMs,
    );
  } catch (e: any) {
    if (e?.code === "ETIMEOUT") {
      throw new CodebaseIndexInstallError(
        `La instalación excedió ${Math.round(timeoutMs / 60_000)} min.`,
        "Reintenta con mejor red, o corre manualmente: " + manualCmd(agentDir),
      );
    }
    throw new CodebaseIndexInstallError(
      `npm no está disponible (${e?.message ?? e}).`,
      "Instala Node.js 20+ (incluye npm) o corre manualmente: " +
        manualCmd(agentDir),
    );
  }
  if (res.code !== 0 || !fs.existsSync(upstreamEntryPath(agentDir))) {
    throw new CodebaseIndexInstallError(
      `npm install falló (exit ${res.code}). ${res.stderr.slice(0, 500)}`,
      "Revisa la salida (red/proxy corporativo es la causa típica). Comando manual: " +
        manualCmd(agentDir),
    );
  }
  const pruned = pruneOtherPlatformNatives(agentDir, opts);
  opts.onProgress?.(
    pruned.length
      ? `Poda: ${pruned.length} natives de otras plataformas eliminados.`
      : "Sin poda (keepOtherPlatforms o plataforma sin prebuild).",
  );
  return { alreadyInstalled: false, pruned };
}
