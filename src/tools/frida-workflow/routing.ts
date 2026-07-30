// frida-workflow — DSL de routing (edges condicionales).
//
// Tres wrappers que construyen un EdgeFn con `.targets` declarados (para BFS de
// alcanzabilidad en validate.ts). El "no-match" es siempre explícito: gate exige
// `otherwise`; match usa `opts.fallback` o STOP. El runner append-ea una fila
// `route` al audit cuando un EdgeFn decide.

import type { EdgeFn, Output, RouteCtx } from "./types";

export const STOP = "stop";

// ---------------------------------------------------------------------------
// Helpers numéricos (para gate)
// ---------------------------------------------------------------------------

export const gt = (n: number) => (v: number) => v > n;
export const gte = (n: number) => (v: number) => v >= n;
export const lt = (n: number) => (v: number) => v < n;
export const lte = (n: number) => (v: number) => v <= n;
export const eq = (n: number) => (v: number) => v === n;

type NumPred = (v: number) => boolean;

/** Las keys integer-like ("2") se hoistean adelante en los object literals y
 *  reordenarían la prioridad de match silenciosamente → se rechazan. */
function rejectIntegerKeys(
	branches: Record<string, unknown>,
	where: string,
): void {
	for (const key of Object.keys(branches)) {
		if (/^\d+$/.test(key))
			throw new Error(
				`${where}: branch key integer-like "${key}" no permitida`,
			);
	}
}

// ---------------------------------------------------------------------------
// gate — campo numérico con predicados de umbral
// ---------------------------------------------------------------------------

/**
 * Evalúa `Number(output.data[field])` contra los predicados en orden de
 * declaración; primer match gana. `otherwise` es OBLIGATORIO (el no-match debe
 * ser deliberado). Las keys no deben ser integer-like (lo rechaza validate.ts).
 */
export function gate(
	field: string,
	branches: Record<string, NumPred>,
	otherwise: string,
): EdgeFn {
	rejectIntegerKeys(branches, "gate");
	const targets = [...Object.keys(branches), otherwise];
	const fn = (ctx: RouteCtx): string => {
		const v = Number(
			(ctx.output.data as Record<string, unknown> | null)?.[field],
		);
		for (const [target, pred] of Object.entries(branches)) {
			if (pred(v)) return target;
		}
		return otherwise;
	};
	return Object.assign(fn, { targets });
}

// ---------------------------------------------------------------------------
// match — campo enum (string/number/boolean) por === estricto
// ---------------------------------------------------------------------------

export type MatchValue = string | number | boolean;

/**
 * Compara `output.data[field]` por === estricto contra cada valor en orden de
 * declaración. Sin `opts.fallback` ⇒ STOP (termina). Las keys no deben ser
 * integer-like (JS hoistearía las array-index y reordenaría la prioridad).
 */
export function match(
	field: string,
	branches: Record<string, MatchValue>,
	opts?: { fallback?: string },
): EdgeFn {
	rejectIntegerKeys(branches, "match");
	const fallback = opts?.fallback;
	const targets = [...Object.keys(branches), ...(fallback ? [fallback] : [])];
	const fn = (ctx: RouteCtx): string => {
		const data = (ctx.output.data as Record<string, unknown> | null)?.[field];
		for (const [target, val] of Object.entries(branches)) {
			if (data === val) return target;
		}
		return fallback ?? STOP;
	};
	return Object.assign(fn, { targets });
}

// ---------------------------------------------------------------------------
// defineRoute — TS arbitrario (strings/enum/multi-campo)
// ---------------------------------------------------------------------------

export interface DefineRouteOptions {
	/** Marca si el body lee output.data (default true → el source necesita outputSchema). */
	readsData?: boolean;
}

/**
 * Caso general: body en TS puro. TODO valor retornado debe estar en `targets`
 * (lo verifica validate.ts). Para state-only routes (no leen output.data) pasar
 * `{ readsData: false }`.
 */
export function defineRoute(
	targets: readonly string[],
	fn: (ctx: RouteCtx) => string,
	opts?: DefineRouteOptions,
): EdgeFn {
	return Object.assign(fn, { targets, readsData: opts?.readsData !== false });
}

/** ¿El edge lee output.data? (gate/match siempre; defineRoute respeta readsData). */
export function routeReadsData(edge: EdgeFn): boolean {
	return (edge as unknown as { readsData?: boolean }).readsData !== false;
}

export type { EdgeFn, Output };
