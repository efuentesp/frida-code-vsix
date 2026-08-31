// frida-workflow — DSL de autoría.
//
// `defineWorkflow` es passthrough de tipos (0 costo runtime, idiom Vite/Astro).
// Factorías de etapa: produces() / acts() / terminal(). Collectors básicos para
// Fase 1; el catálogo completo (FS-diff/tool/git/union) llega en Fase 2.

import type {
	Artifact,
	CollectCtx,
	Collector,
	CollectResult,
	Handle,
	LoopDef,
	OutputSpec,
	PromptFn,
	ReadSpec,
	ScriptFn,
	StageDef,
	StandardSchemaV1,
	VerifyDef,
	Workflow,
} from "./types";

// ---------------------------------------------------------------------------
// defineWorkflow
// ---------------------------------------------------------------------------

export function defineWorkflow(wf: Workflow): Workflow {
	return wf;
}

// ---------------------------------------------------------------------------
// Factorías de etapa
// ---------------------------------------------------------------------------

export interface ProducesOptions {
	skill?: string;
	outcome: OutputSpec;
	outputSchema?: StandardSchemaV1;
	inputSchema?: StandardSchemaV1;
	onInvalid?: "retry" | "halt";
	maxRetries?: number;
	loop?: LoopDef;
	reads?: ReadSpec[];
	verify?: VerifyDef;
	inheritsArtifacts?: boolean;
}

/** `kind: "produces". La skill escribe un artefacto que la siguiente lee. */
export function produces(opts: ProducesOptions): StageDef {
	return {
		kind: "produces",
		skill: opts.skill,
		outcome: opts.outcome,
		outputSchema: opts.outputSchema,
		inputSchema: opts.inputSchema,
		onInvalid: opts.onInvalid,
		maxRetries: opts.maxRetries,
		loop: opts.loop,
		reads: opts.reads,
		verify: opts.verify,
		inheritsArtifacts: opts.inheritsArtifacts,
	};
}

export interface ActsOptions {
	skill?: string;
	/** Opcional: detectar artefactos pese a ser side-effect (ej. git commit). */
	outcome?: OutputSpec;
	outputSchema?: StandardSchemaV1;
	inputSchema?: StandardSchemaV1;
	onInvalid?: "retry" | "halt";
	maxRetries?: number;
	loop?: LoopDef;
	reads?: ReadSpec[];
	inheritsArtifacts?: boolean;
}

/** `kind: "side-effect"`. El efecto ES el trabajo; hereda el artefacto upstream. */
export function acts(opts: ActsOptions = {}): StageDef {
	return {
		kind: "side-effect",
		skill: opts.skill,
		outcome: opts.outcome,
		outputSchema: opts.outputSchema,
		inputSchema: opts.inputSchema,
		onInvalid: opts.onInvalid,
		maxRetries: opts.maxRetries,
		loop: opts.loop,
		reads: opts.reads,
		inheritsArtifacts: opts.inheritsArtifacts,
	};
}

/** `kind: "side-effect"` con `inheritsArtifacts: false`. No hereda; recibe el brief. */
export function terminal(opts: { skill?: string } = {}): StageDef {
	return { kind: "side-effect", skill: opts.skill, inheritsArtifacts: false };
}

// --- Despacho script / prompt (Fase 8): namespaces mergeados a las factorías ---

export namespace produces {
	export interface ScriptOptions {
		run: ScriptFn;
		outputSchema?: StandardSchemaV1;
		onInvalid?: "retry" | "halt";
		maxRetries?: number;
	}
	/** Despacho script (sin modelo): run() devuelve {kind, artifacts, data}. */
	export function script(opts: ScriptOptions): StageDef {
		return {
			kind: "produces",
			run: opts.run,
			outputSchema: opts.outputSchema,
			onInvalid: opts.onInvalid,
			maxRetries: opts.maxRetries,
		};
	}
	export interface PromptOptions {
		prompt: PromptFn | string;
		outcome?: OutputSpec;
		outputSchema?: StandardSchemaV1;
	}
	/** Despacho prompt: texto crudo al modelo (chat turn, sin /skill:). */
	export function prompt(opts: PromptOptions): StageDef {
		return {
			kind: "produces",
			prompt: opts.prompt,
			outcome: opts.outcome,
			outputSchema: opts.outputSchema,
		};
	}
}

export namespace acts {
	export interface ScriptOptions {
		run: ScriptFn;
	}
	export function script(opts: ScriptOptions): StageDef {
		return { kind: "side-effect", run: opts.run };
	}
	export interface PromptOptions {
		prompt: PromptFn | string;
	}
	export function prompt(opts: PromptOptions): StageDef {
		return { kind: "side-effect", prompt: opts.prompt };
	}
}

export namespace terminal {
	export interface ScriptOptions {
		run: ScriptFn;
	}
	/** Script terminal: side-effect + inheritsArtifacts:false (limpia el slot). */
	export function script(opts: ScriptOptions): StageDef {
		return { kind: "side-effect", run: opts.run, inheritsArtifacts: false };
	}
}

// ---------------------------------------------------------------------------
// Handles
// ---------------------------------------------------------------------------

export const fs = (path: string): Handle => ({ kind: "fs", path });
export const url = (href: string): Handle => ({ kind: "url", href });
export const opaque = (id: string): Handle => ({ kind: "opaque", id });

// ---------------------------------------------------------------------------
// Collectors (catálogo básico — Fase 1)
// ---------------------------------------------------------------------------

/**
 * Escanea el texto del asistente de la sesión hija buscando el último match de
 * `pattern` (típicamente una ruta de archivo). Emite un artefacto `fs` por match
 * único en orden de aparición; el primero es `primary`.
 *
 * Nota: `messages` es `unknown[]` (shape del SDK). Se leen defensivamente los
 * bloques de texto del assistant.
 */
export function transcriptPathCollector(opts: { pattern: RegExp }): Collector {
	// matchAll exige flag global; lo aseguramos para no lanzar si el autor lo omitió.
	const re = opts.pattern.global
		? opts.pattern
		: new RegExp(opts.pattern.source, opts.pattern.flags + "g");
	return (ctx: CollectCtx): CollectResult => {
		const paths: string[] = [];
		for (const m of ctx.messages) {
			const text = extractAssistantText(m);
			if (!text) continue;
			for (const match of text.matchAll(re)) {
				const p = (match[1] ?? match[0]) as string;
				const clean = p.trim().replace(/^['"`]|['"`]$/g, "");
				if (clean && !paths.includes(clean)) paths.push(clean);
			}
		}
		if (paths.length === 0) {
			return {
				kind: "fatal",
				message: `transcriptPathCollector: ningún match de ${opts.pattern} en el transcript`,
			};
		}
		const artifacts: Artifact[] = paths.map((p, i) => ({
			handle: fs(p),
			role: i === 0 ? "primary" : "secondary",
		}));
		return { kind: "ok", artifacts };
	};
}

/** Siempre `{ ok, [] }`. Para `acts` sin outcome o casos donde no hay nada que extraer. */
export const noopCollector: Collector = () => ({ kind: "ok", artifacts: [] });

/** Constructor de collector propio (first-class: mismo CollectCtx que los built-in). */
export function defineCollector(
	fn: (ctx: CollectCtx) => CollectResult,
): Collector {
	return fn;
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/** Extrae texto del assistant de un mensaje del SDK (forma inestable → defensivo). */
export function extractAssistantText(message: unknown): string | undefined {
	const m = message as Record<string, unknown> | null;
	if (!m || typeof m !== "object") return undefined;
	if (m.role !== "assistant") return undefined;
	const content = m.content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((part) => {
				const p = part as Record<string, unknown> | null;
				if (!p) return "";
				if (typeof p.text === "string") return p.text;
				return "";
			})
			.join("");
	}
	return undefined;
}

// Re-export de tipos que el autor usa junto con el DSL.
export type { Collector, OutputSpec };
