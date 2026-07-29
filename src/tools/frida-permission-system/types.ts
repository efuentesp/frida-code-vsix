// Tipos del modelo declarativo de permisos de frida-permission-system (ADR-0016).
//
// Paridad adaptada de @gotgenes/pi-permission-system: estados allow/ask/deny por
// superficie (tool/path/bash/external_directory). La diferencia de fondo NO es
// declarativo-vs-imperativo, sino candado-vs-disuasivo (ADR-0001): Frida asume que
// el operador puede evadir, así que NO portamos symlink-resolve ni project-trust.
// Lo que modelamos es "evitar accidentes del modelo".

import type { DecisionSource } from "../../gates/approval-logger";

/** Estado de permiso (paridad gotgenes). */
export type PermissionState = "allow" | "ask" | "deny";

/** Superficie de política (paridad gotgenes). */
export type Surface = "tool" | "path" | "bash" | "external_directory";

/**
 * Modo de operación (override rápido sobre la política declarativa).
 *
 * - `manual`: respeta la policy tal cual (ask pide, allow pasa).
 * - `auto-edit`: edit/write con `ask` → `allow` (salvo force-ask).
 * - `auto`: TODO `ask` (sin force-ask) → `allow`.
 *
 * `deny` SIEMPRE gana, incluso en `auto` (como el yoloMode de gotgenes).
 */
export type PermissionMode = "manual" | "auto-edit" | "auto";

/** Mapa de patrones → estado (last-match-wins dentro de la superficie). */
export type PatternMap = Record<string, PermissionState>;

/**
 * Política declarativa por superficie.
 *
 * Evaluación en 4 capas (most-restrictive-wins, paridad gotgenes):
 * `path` → `external_directory` → per-tool → `bash`, con deny > ask > allow.
 *
 * En Fase 0-1 las superficies `path` y `bash` quedan minimal ({ "*": ... }) porque
 * los deny concretos los siguen aplicando los helpers hardcodeados
 * (sensitive-paths.ts, dangerous-commands.ts); esta política las deja listas para
 * overrides declarativos puros en fases posteriores.
 */
export interface PermissionPolicy {
	/** Per-tool: nombre de tool (o "*" default) → estado. */
	tool: PatternMap;
	/** Cross-cutting: patrón de path → estado. */
	path: PatternMap;
	/** Wildcard sobre comando bash normalizado → estado. */
	bash: PatternMap;
	/** CWD boundary: allow/ask/deny. (Map de dirs externos: fase posterior.) */
	external_directory: PermissionState;
}

/** Configuración completa (archivo `~/.frida/permission.json`). */
export interface PermissionConfig {
	version: number;
	mode: PermissionMode;
	policy: PermissionPolicy;
}

/**
 * Decisión resultado de `evaluate()`.
 *
 * El flag `forceAsk` es la clave que preserva el disuasivo heredado del diseño
 * actual: un bash compuesto/wrapper o un path fuera del workspace marca la
 * decisión como `ask` que **sobrevive al modo `auto`** (en auto el usuario no
 * mira, y un sub-comando peligroso no debe colarse).
 */
export interface PermissionDecision {
	/** Estado terminal (después de policy + force-ask, ANTES del modo). */
	state: PermissionState;
	/** true si `ask` y debe sobrevivir al modo auto (bash compuesto / path externo). */
	forceAsk: boolean;
	/** Motivo legible (para el modelo en deny; para el warning en force-ask). */
	reason?: string;
	/** Source de auditoría (sensitive_path / dangerous_command / …). Subset de DecisionSource. */
	source?: DecisionSource;
	/** Flags de disuasivo (compound_command / external_path) para el log. */
	flags?: string[];
}

/** Clasificación de la vista del tool (igual que ApprovalRequest.kind). */
export type ToolKind = "diff" | "bash" | "tool";

/**
 * Contadores de decisiones del gate en la sesión actual (Stats footer, Fase 3).
 * Se resetean al iniciar una sesión nueva (/new).
 */
export interface GateStats {
	/** Aprobadas por el usuario en el diálogo (source `user_approved`). */
	allow: number;
	/** Bloqueadas: deny por policy, rechazadas, o error del gate. */
	block: number;
	/** Dejadas pasar por el modo auto/auto-edit sin preguntar (source `mode`). */
	autoAllow: number;
}
