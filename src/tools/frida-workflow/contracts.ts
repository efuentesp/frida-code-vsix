// frida-workflow — skill contracts (Fase 8, scaffolding).
//
// Un contrato declara qué canales un skill consume/produce. La check práctica
// (reads publicado por algún produces) ya vive en validate.ts; aquí exponemos el
// registro + canCompose para cuando los skills declaren contratos propios. La
// composition real se adjudica con canCompose(consumes, available).

import type { SkillContract } from "./types";

const registry = new Map<string, SkillContract>();

/** Registra contratos de skills (declarados por el dueño o cosechados). */
export function registerSkillContracts(contracts: SkillContract[]): void {
	for (const c of contracts) registry.set(c.skill, c);
}

export function getSkillContract(skill: string): SkillContract | undefined {
	return registry.get(skill);
}

export function getAllSkillContracts(): SkillContract[] {
	return [...registry.values()];
}

/** Sólo tests. */
export function _resetSkillContracts(): void {
	registry.clear();
}

/** ¿Puede el consumidor (requiere `consumes`) componer con lo que el productor
 *  ofrece (`available`)? Devuelve los faltantes si no. */
export function canCompose(
	consumes: string[],
	available: string[],
): { ok: true } | { ok: false; missing: string[] } {
	const missing = consumes.filter((c) => !available.includes(c));
	return missing.length ? { ok: false, missing } : { ok: true };
}
