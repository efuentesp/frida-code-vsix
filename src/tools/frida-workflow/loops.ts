// frida-workflow — constructores de loops (Fase 6).
//
// fanout (push paralelo, waves por deps) / iterate (pull acumulativo). Validan en
// construcción (rpiv: invalid shapes throw antes de cargar). Los defaults de
// `result` (fanout "entry", iterate "last") y `onCap` ("halt") los aplica el
// loop-runner, no el constructor (éste sólo attacha kind + valida).

import type {
	FanoutContext,
	FanoutDef,
	IterateContext,
	IterateDef,
	LoopBase,
	ReadSpec,
	Unit,
} from "./types";

function validateBase(b: LoopBase, where: string): void {
	if (b.max !== undefined && (!Number.isInteger(b.max) || b.max < 1)) {
		throw new Error(`${where}: max debe ser entero ≥ 1 (fue ${String(b.max)})`);
	}
}

export interface FanoutOptions extends LoopBase {
	/** Push: calcula todas las unidades de una vez (ciegas entre sí). */
	units: (ctx: FanoutContext) => Unit[];
	/** Techo de unidades en vuelo (≥1). Default 1 (serial). */
	concurrency?: number;
	/** La 1ª unidad que falla detiene el run y cancela in-flight. */
	failFast?: boolean;
}

export function fanout(opts: FanoutOptions): FanoutDef {
	validateBase(opts, "fanout");
	if (
		opts.concurrency !== undefined &&
		(!Number.isInteger(opts.concurrency) || opts.concurrency < 1)
	) {
		throw new Error(
			`fanout: concurrency debe ser entero ≥ 1 (fue ${String(opts.concurrency)})`,
		);
	}
	if (typeof opts.units !== "function")
		throw new Error("fanout: units debe ser una función");
	return { kind: "fanout", ...opts };
}

export interface IterateOptions extends LoopBase {
	/** Pull: devuelve la siguiente unidad, o null/undefined para terminar. */
	next: (ctx: IterateContext) => Unit | null | undefined;
}

export function iterate(opts: IterateOptions): IterateDef {
	validateBase(opts, "iterate");
	if (typeof opts.next !== "function")
		throw new Error("iterate: next debe ser una función");
	return { kind: "iterate", ...opts };
}

/** read-spec que consume TODAS las entradas del canal (fan-in barrier). */
export function fanin(name: string): ReadSpec {
	return { name, all: true };
}
