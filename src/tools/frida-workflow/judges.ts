// frida-workflow — constructores de judges (Fase 7).
//
// judge (sesión de grading) / verify (post-condición por etapa) / assess (loop
// juzgado hasta done) / panel (N escépticos + fold) + majority/all/any.
// Validan en construcción (rpiv: shapes inválidos tiran antes de cargar).

import type {
	AssessDef,
	Fold,
	Judge,
	JudgedRepetition,
	Output,
	OutputSpec,
	PanelDef,
	SugarFold,
	VerifyDef,
} from "./types";

function isJudge(v: unknown): v is Judge {
	const j = v as Partial<Judge> | null;
	return !!j && typeof j === "object" && !!j.outcome;
}

export interface JudgeOptions {
	skill?: string;
	prompt?: (ctx: { output: Output }) => string;
	outcome: OutputSpec;
}

/** Nombra una sesión de grading. skill XOR prompt (exactamente uno); outcome req. */
export function judge(opts: JudgeOptions): Judge {
	if ((opts.skill ? 1 : 0) + (opts.prompt ? 1 : 0) !== 1) {
		throw new Error("judge: exige exactamente uno de skill | prompt");
	}
	if (!opts.outcome) throw new Error("judge: outcome es requerido");
	return { skill: opts.skill, prompt: opts.prompt, outcome: opts.outcome };
}

export interface VerifyOptions extends JudgedRepetition {}

/** Post-condición por etapa. max default 1 (gate-only) lo aplica runVerify. */
export function verify(opts: VerifyOptions): VerifyDef {
	validateJudged(opts, "verify");
	return { ...opts };
}

export interface AssessOptions extends JudgedRepetition {
	max?: number;
	onCap?: "halt" | "advance";
	result?: "entry" | "last";
}

/** Loop juzgado: rondas productor→judge hasta done. Default onCap "advance", max 8. */
export function assess(opts: AssessOptions): AssessDef {
	validateJudged(opts, "assess");
	return { kind: "assess", ...opts };
}

function validateJudged(j: JudgedRepetition, where: string): void {
	if (j.max !== undefined && (!Number.isInteger(j.max) || j.max < 1)) {
		throw new Error(`${where}: max debe ser entero ≥ 1 (fue ${String(j.max)})`);
	}
	if (typeof j.done !== "function")
		throw new Error(`${where}: done debe ser una función`);
	if (!j.judge) throw new Error(`${where}: judge es requerido`);
}

// --- Panel ---

export interface PanelOptions {
	members: Judge[];
	fold: Fold;
	outcome?: OutputSpec;
}

/** N jueces escépticos reducidos por un fold. Sugar⊕outcome es XOR. */
export function panel(opts: PanelOptions): PanelDef {
	if (!Array.isArray(opts.members) || opts.members.length === 0) {
		throw new Error("panel: members debe ser un array no vacío");
	}
	for (const m of opts.members) {
		if (!isJudge(m))
			throw new Error("panel: cada member debe ser un judge(...)");
		if ((m as { members?: unknown }).members)
			throw new Error("panel: panel de panel no permitido");
	}
	const sugar = isSugarFold(opts.fold);
	if (sugar && opts.outcome) {
		throw new Error(
			"panel: sugar fold ⊕ outcome es XOR (sugar ⇒ canonical, omite outcome)",
		);
	}
	if (!sugar && !opts.outcome) {
		throw new Error("panel: fold crudo exige outcome (nombra+valida el canal)");
	}
	return { members: opts.members, fold: opts.fold, outcome: opts.outcome };
}

export function majority(pred: (v: Output) => boolean): SugarFold {
	return { rule: "majority", pred };
}
export function all(pred: (v: Output) => boolean): SugarFold {
	return { rule: "all", pred };
}
export function any(pred: (v: Output) => boolean): SugarFold {
	return { rule: "any", pred };
}

export function isSugarFold(f: Fold): f is SugarFold {
	return typeof (f as SugarFold).rule === "string";
}
