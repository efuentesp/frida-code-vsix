// Session approvals por patrón (ADR-0016, Fase 4). Paridad con gotgenes: cuando
// el diálogo prompta, el usuario puede aprobar un PATRÓN para la sesión (ej.
// `npm *`, `src/*`), no sólo "aceptar todas". Próximas llamadas que matcheen el
// patrón pasan sin diálogo.
//
// Matching: wildcard simple (* → .* en regex). Sugerencia de patrón: bash →
// primer token + ` *`; diff (edit/write) → directorio + `/*`. Los tools
// desconocidos (MCP/extensión) no sugieren patrón: no aprobamos a ciegas.

import type { ToolKind } from "./types";

export interface SessionPattern {
	kind: ToolKind;
	pattern: string;
}

export class SessionApprovals {
	private patterns: SessionPattern[] = [];

	/** Registra un patrón aprobado (ignora duplicados y vacíos). */
	add(kind: ToolKind, pattern: string): void {
		const p = pattern.trim();
		if (!p) return;
		if (this.patterns.some((x) => x.kind === kind && x.pattern === p)) return;
		this.patterns.push({ kind, pattern: p });
	}

	/** ¿el valor (command/path) matchea algún patrón aprobado de este kind? */
	matches(kind: ToolKind, value: string): boolean {
		if (this.patterns.length === 0) return false;
		return this.patterns.some(
			(p) => p.kind === kind && matchesWildcard(p.pattern, value),
		);
	}

	/** Resetea los patrones (sesión nueva). */
	clear(): void {
		this.patterns = [];
	}
}

/** Convierte un wildcard simple (* → .*) en regex y testa el value. */
export function matchesWildcard(pattern: string, value: string): boolean {
	try {
		const escaped = pattern
			.replace(/[.+^${}()|[\]\\]/g, "\\$&")
			.replace(/\*/g, ".*");
		return new RegExp(`^${escaped}$`).test(value);
	} catch {
		return false;
	}
}

/**
 * Sugiere un patrón para aprobar por sesión (paridad gotgenes "approve pattern").
 * - bash: `npm run build` → `npm *` (primer token).
 * - diff:  `src/app.ts` → `src/*` (directorio del path).
 * - tool:  undefined (desconocido → no sugerimos).
 */
export function suggestPattern(
	kind: ToolKind,
	input: { command?: string; path?: string },
): string | undefined {
	if (kind === "bash") {
		const cmd = input.command?.trim();
		if (!cmd) return undefined;
		const firstToken = cmd.split(/\s+/)[0];
		return firstToken ? `${firstToken} *` : undefined;
	}
	if (kind === "diff") {
		const p = input.path;
		if (!p) return undefined;
		const slash = p.lastIndexOf("/");
		const dir = slash > 0 ? p.slice(0, slash) : "";
		return dir ? `${dir}/*` : undefined;
	}
	return undefined;
}
