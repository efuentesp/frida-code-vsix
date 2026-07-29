// Store reactivo de la política declarativa para el ConfigPanel (ADR-0016, Fase 5).
//
// El ConfigPanel (/gates-config) edita la política allow/ask/deny por superficie.
// Como Remote React serializa los handlers (handlerId) y el host NO ve el useState
// del webview, el estado editable vive AQUÍ (host): el panel es "controlado" por
// este store vía useSyncExternalStore. Cada control dispara setTool/setMode → el
// store emite → el panel re-renderiza con el nuevo snapshot.
//
// Doble rol del store:
//  1. Mantiene el snapshot editable (current) que el ConfigPanel lee.
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
const listeners = new Set<() => void>();

function emit(): void {
	for (const l of [...listeners]) l();
}

/** Snapshot editable (para useSyncExternalStore en el ConfigPanel). */
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
	emit();
}

/** Cambia el modo (manual/auto-edit/auto). */
export function setMode(mode: PermissionMode): void {
	current = { ...current, mode };
	emit();
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
	emit();
}

/** Quita un patrón de la superficie indicada. */
function removeSurfacePattern(surface: "path" | "bash", pattern: string): void {
	const next = { ...current.policy[surface] };
	delete next[pattern];
	current = {
		...current,
		policy: { ...current.policy, [surface]: next },
	};
	emit();
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

/** Suscripción para useSyncExternalStore. Devuelve cleanup. */
export function subscribeConfig(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/**
 * Persiste la política a `~/.frida/permission.json`. El cache (current.policy) ya
 * tiene la nueva política → el gate la lee fresca en el próximo tool_call.
 */
export function saveConfig(): void {
	savePermissionConfig(current);
}

/** Restaura la default (sin guardar; el usuario debe pulsar Guardar para persistir). */
export function resetConfig(): void {
	current = {
		version: 1,
		mode: "manual",
		policy: {
			tool: { ...DEFAULT_POLICY.tool },
			path: { ...DEFAULT_POLICY.path },
			bash: { ...DEFAULT_POLICY.bash },
			external_directory: DEFAULT_POLICY.external_directory,
		},
	};
	emit();
}
