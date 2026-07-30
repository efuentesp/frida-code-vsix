// frida-workflow — registro nombrado (state.named) + resolución de reads (Fase 6).
//
// Cada produces con outcome.name APPEND-ea su Output a state.named[key]. Un
// reads consume: string = última entrada (.at(-1)); fanin(name) = todas. Lo usa
// el constructor de prompts multi-input del runner.

import type { Artifact, Output, ReadSpec, RunState } from "./types";

/** APPEND-ea `output` al canal `name` (muta state.named — el run es mutable). */
export function publishNamed(
	state: RunState,
	name: string,
	output: Output,
): void {
	(state.named[name] ??= []).push(output);
}

/** Artefactos resueltos de un read: latest (string) o todas (fanin). */
export function readArtifacts(state: RunState, spec: ReadSpec): Artifact[] {
	const name = typeof spec === "string" ? spec : spec.name;
	const all = typeof spec === "string" ? false : !!spec.all;
	const entries = state.named[name] ?? [];
	const picked = all
		? entries
		: entries.length
			? [entries[entries.length - 1]!]
			: [];
	return picked.flatMap((o) => o.artifacts);
}

/** ¿El canal `name` tiene al menos una entrada? (para preflight de reads). */
export function hasNamed(state: RunState, name: string): boolean {
	return (state.named[name]?.length ?? 0) > 0;
}
