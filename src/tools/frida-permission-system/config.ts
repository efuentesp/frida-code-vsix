// Carga/guardado de la política declarativa de frida-permission-system (ADR-0016).
//
// El archivo `~/.frida/permission.json` define la política por superficie
// (tool/path/bash/external_directory) + el modo. Si no existe o está roto, se usa
// DEFAULT_POLICY, que reproduce EXACTAMENTE el behavior actual (Fase 0-1 = migración
// sin surprise): los sets hardcodeados (FREE_TOOLS/DIFF_TOOLS) se traducen a la
// superficie `tool`, y sensitive-paths.ts / dangerous-commands.ts siguen aplicando
// sus deny hardcodeados como capas de seguridad.
//
// Hardening (como gotgenes y approval-logger.ts): directorio 0700, archivo 0600,
// porque el archivo puede listar patrones que delatan estructura del proyecto.
// Best-effort: en Windows chmod sólo toggrea read-only y nunca rompe el gate.

import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type {
	PermissionConfig,
	PermissionMode,
	PermissionPolicy,
} from "./types";

/** Path default del archivo de política: `~/.frida/permission.json`. */
export function defaultPermissionConfigPath(): string {
	return join(homedir(), ".frida", "permission.json");
}

/**
 * Política default que reproduce EXACTAMENTE el behavior actual.
 *
 * - `tool`: FREE_TOOLS (read/grep/find/ls/todo/ask_user_question) → `allow`;
 *   DIFF_TOOLS (edit/write) + bash → `ask`; desconocido (`*`) → `ask`.
 * - `path`/`bash`: minimal en Fase 0-1; los deny concretos los aplican los helpers
 *   hardcodeados. Listas para overrides declarativos puros en fases posteriores.
 * - `external_directory`: `ask` (force-ask vía isExternalPath, heredado).
 */
export const DEFAULT_POLICY: PermissionPolicy = {
	tool: {
		read: "allow",
		grep: "allow",
		find: "allow",
		ls: "allow",
		todo: "allow",
		ask_user_question: "allow",
		edit: "ask",
		write: "ask",
		bash: "ask",
		// Default: desconocido (MCP / extensión de terceros) pide aprobación.
		"*": "ask",
	},
	// Fase 0-1: sensitive-paths.ts aplica los deny hardcodeados; esto deja lugar
	// para overrides declarativos puros (path: { "*.env": "deny", ... }).
	path: { "*": "allow" },
	// Fase 0-1: dangerous-commands.ts aplica los deny hardcodeados.
	bash: { "*": "ask" },
	// CWD boundary: acceso fuera del workspace pide (force-ask vía isExternalPath).
	external_directory: "ask",
};

/** Config default completa (modo `manual`). */
export const DEFAULT_PERMISSION_CONFIG: PermissionConfig = {
	version: 1,
	mode: "manual",
	policy: DEFAULT_POLICY,
};

/**
 * Carga la política desde `~/.frida/permission.json`. Si no existe o está roto,
 * devuelve el default (no rompe el gate: un JSON inválido → default seguro).
 */
export function loadPermissionConfig(
	configPath: string = defaultPermissionConfigPath(),
): PermissionConfig {
	try {
		if (!existsSync(configPath)) return cloneDefault();
		const raw = readFileSync(configPath, "utf8");
		const parsed = JSON.parse(raw) as Partial<PermissionConfig>;
		return mergeWithDefault(parsed);
	} catch {
		// Best-effort: config rota → default (fail-safe, no fail-open).
		return cloneDefault();
	}
}

/** Guarda la política (dir 0700, archivo 0600). Best-effort: no rompe el gate. */
export function savePermissionConfig(
	config: PermissionConfig,
	configPath: string = defaultPermissionConfigPath(),
): void {
	try {
		const dir = dirname(configPath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true, mode: 0o700 });
			chmodBestEffort(dir, 0o700);
		}
		writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
		chmodBestEffort(configPath, 0o600);
	} catch {
		// Intencionalmente ignorado: no poder persistir la política no debe romper
		// la evaluación en memoria de esta sesión.
	}
}

/** ¿Es un modo válido? (defensivo ante JSON corrupto). */
export function isValidMode(m: unknown): m is PermissionMode {
	return m === "manual" || m === "auto-edit" || m === "auto";
}

/** Mergea una config parcial sobre el default (rellena huecos, valida modo). */
function mergeWithDefault(parsed: Partial<PermissionConfig>): PermissionConfig {
	const mode = isValidMode(parsed.mode) ? parsed.mode : "manual";
	return {
		version: typeof parsed.version === "number" ? parsed.version : 1,
		mode,
		policy: {
			tool: { ...DEFAULT_POLICY.tool, ...(parsed.policy?.tool ?? {}) },
			path: { ...DEFAULT_POLICY.path, ...(parsed.policy?.path ?? {}) },
			bash: { ...DEFAULT_POLICY.bash, ...(parsed.policy?.bash ?? {}) },
			external_directory:
				parsed.policy?.external_directory ?? DEFAULT_POLICY.external_directory,
		},
	};
}

function cloneDefault(): PermissionConfig {
	return {
		version: DEFAULT_PERMISSION_CONFIG.version,
		mode: DEFAULT_PERMISSION_CONFIG.mode,
		policy: {
			tool: { ...DEFAULT_POLICY.tool },
			path: { ...DEFAULT_POLICY.path },
			bash: { ...DEFAULT_POLICY.bash },
			external_directory: DEFAULT_POLICY.external_directory,
		},
	};
}

function chmodBestEffort(target: string, mode: number): void {
	try {
		chmodSync(target, mode);
	} catch {
		// Windows: chmod sólo toggrea read-only.
	}
}
