/**
 * frida-sandboxes — constantes y defaults (issue #35, ADR-0047).
 *
 * Container Docker local por agente ("own computer", tier-2 de aislamiento:
 * worktree = tier-1). El container ES el boundary; la policy in-container
 * (policy.ts) refina qué puede tocar el agente DENTRO.
 */
import * as path from "node:path";

/** Prefix de todo container creado por frida-sandboxes. */
export const CONTAINER_PREFIX = "frida-sbx-";

/** Nombre canónico de la extensión/factory. */
export const SANDBOXES_FACTORY_NAME = "frida-sandboxes";

/** Comando slash registrado. */
export const SANDBOXES_COMMAND = "sandbox";

/**
 * Imagen por defecto. node:22 (Debian full) trae git + npm — necesario para
 * el flujo changes/merge (git diff in-container) y el e2e del issue
 * ("agente corre npm test dentro del container"). Configurable:
 * frida.sandboxes.defaultImage.
 */
export const DEFAULT_IMAGE = "node:22";

/** Directorio de trabajo DENTRO del container. */
export const CONTAINER_WORKDIR = "/workspace";

/** Registro persistente de sandboxes (uno por agentDir). */
export function sandboxesDir(agentDir: string): string {
	return path.join(agentDir, "sandboxes");
}

/** registry.json — estado persistido de todos los sandboxes. */
export function registryPath(agentDir: string): string {
	return path.join(sandboxesDir(agentDir), "registry.json");
}

/** Timeout por defecto de operaciones docker (lifecycle, no exec). */
export const DOCKER_OP_TIMEOUT_MS = 30_000;

/** Timeout por defecto de sandbox_exec (comandos del agente). */
export const EXEC_TIMEOUT_MS = 5 * 60_000;

/** Cache del probe de capability (docker --version) — evita probe por tool. */
export const PROBE_CACHE_MS = 60_000;
