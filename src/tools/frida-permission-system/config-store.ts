// Store reactivo de la política declarativa de frida-permission-system (ADR-0016).
//
// #55: la UI de edición es la pestaña Configuración > Auto-aprobación del
// webview (el overlay /gates-config fue retirado). El puente de mensajes de
// extension.ts llama a estos setters y el panel se re-renderiza desde el
// snapshot publicado (postPermissionsConfig). Doble rol del store:
//  1. Mantiene el snapshot editable (current) que el panel lee vía el puente.
//  2. Cachea la policy que el GATE lee en cada tool_call (getPermissionPolicy).
//     Tras save(), el cache se actualiza con la nueva policy → el gate la ve al
//     instante sin recargar la sesión (sin leer el archivo en cada tool_call).

import {
	DEFAULT_POLICY,
	defaultPermissionConfigPath,
	loadPermissionConfig,
	savePermissionConfig,
} from "./config";
import type {
	PermissionConfig,
	PermissionMode,
	PermissionPolicy,
	PermissionState,
} from "./types";

let current: PermissionConfig = loadPermissionConfig(
	defaultPermissionConfigPath(),
);

/** Snapshot editable (para el puente del panel de auto-aprobación, #55). */
export function getConfig(): PermissionConfig {
	return current;
}

/** Policy cacheada que lee el gate en cada tool_call. Tras save() queda fresca. */
export function getPermissionPolicy(): PermissionPolicy {
	return current.policy;
}

/** Cambia el estado de un tool en la superficie `tool` (re-render del panel). */
export function setTool(tool: string, state: PermissionState): void {
	current = {
		...current,
		policy: {
			...current.policy,
			tool: { ...current.policy.tool, [tool]: state },
		},
	};
}

/** Cambia el modo (manual/auto-edit/auto). */
export function setMode(mode: PermissionMode): void {
	current = { ...current, mode };
}

/**
 * Toggle del log de auditoría approvals.jsonl (knob `auditLog`, #55).
 * Paridad permissionReviewLog de pi-permission-system.
 */
export function setAuditLog(enabled: boolean): void {
	current = { ...current, auditLog: enabled };
}

// --- Superficies path / bash (Fase 5b): patrones wildcard declarativos ---

/** Cambia/crea el estado de un patrón en la superficie indicada. */
function setSurfacePattern(
	surface: "path" | "bash",
	pattern: string,
	state: PermissionState,
): void {
	const p = pattern.trim();
	if (!p) return;
	current = {
		...current,
		policy: {
			...current.policy,
			[surface]: { ...current.policy[surface], [p]: state },
		},
	};
}

/** Quita un patrón de la superficie indicada. */
function removeSurfacePattern(surface: "path" | "bash", pattern: string): void {
	const next = { ...current.policy[surface] };
	delete next[pattern];
	current = {
		...current,
		policy: { ...current.policy, [surface]: next },
	};
}

/** Crea/cambia un patrón de path (ej. `*.env`: deny). */
export function setPathPattern(pattern: string, state: PermissionState): void {
	setSurfacePattern("path", pattern, state);
}
/** Quita un patrón de path. */
export function removePathPattern(pattern: string): void {
	removeSurfacePattern("path", pattern);
}
/** Crea/cambia un patrón de bash (ej. `git push *`: deny). */
export function setBashPattern(pattern: string, state: PermissionState): void {
	setSurfacePattern("bash", pattern, state);
}
/** Quita un patrón de bash. */
export function removeBashPattern(pattern: string): void {
	removeSurfacePattern("bash", pattern);
}

/** Cambia el estado de la superficie external_directory (CWD boundary, #55). */
export function setExternalDirectory(state: PermissionState): void {
	current = {
		...current,
		policy: { ...current.policy, external_directory: state },
	};
}

/**
 * Persiste la política a `~/.frida/permission.json`. El cache (current.policy) ya
 * tiene la nueva política → el gate la lee fresca en el próximo tool_call.
 */
export function saveConfig(): void {
	savePermissionConfig(current);
}

/**
 * Restaura la default (quedan en el store; el puente persiste tras el reset, #55).
 */
export function resetConfig(): void {
	current = {
		version: 1,
		mode: "manual",
		auditLog: true,
		policy: {
			tool: { ...DEFAULT_POLICY.tool },
			path: { ...DEFAULT_POLICY.path },
			bash: { ...DEFAULT_POLICY.bash },
			external_directory: DEFAULT_POLICY.external_directory,
		},
	};
}
