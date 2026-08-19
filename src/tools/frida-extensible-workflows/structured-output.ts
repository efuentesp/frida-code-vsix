// frida-extensible-workflows — salida estructurada para agent({ outputSchema })
// (#19 Lote 2, gap G1). El validador estático ya acepta outputSchema y el
// sandbox lo transporta en options, pero el spawner devolvía texto plano y los
// scripts hacían r.candidates sobre un string → undefined.
//
// Estrategia (misma que el upstream): instrucción de formato en el prompt,
// parseo tolerante del texto del agente, validación mínima contra el schema y
// REPARACIÓN acotada (re-prompt con el error) antes de fallar. Módulo PURO
// (testeable sin SDK): envuelve un SpawnAgentFn inyectable.
//
// El wrapper preserva el accounting de #18: los intentos de reparación cuestan
// tokens reales → se SUMAN (input/output/cache/cost) y la duración total se
// acumula, para que el orquestador reporte el costo verdadero de la llamada.

import {
	spawnResult,
	unpackSpawnResult,
	type AgentSpawnResult,
	type SpawnAgentFn,
} from "./frida-agent-execution";
import type { AgentAccounting, JsonSchema, JsonValue } from "./core/types";

/** Intentos de reparación tras el primer intento (total = 1 + maxRepairAttempts). */
export const DEFAULT_MAX_REPAIR_ATTEMPTS = 1;

/** Quita fences ```json, backticks sueltos y espacios; JSON.parse estricto. */
export function parseJsonLoose(text: string): unknown {
	let t = text.trim();
	const fence = t.match(/^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/);
	if (fence) t = fence[1]!.trim();
	// Objeto/array embebido en prosa: recorta al primer { o [ y el último } o ].
	const firstObj = t.indexOf("{");
	const firstArr = t.indexOf("[");
	const start =
		firstObj === -1
			? firstArr
			: firstArr === -1
				? firstObj
				: Math.min(firstObj, firstArr);
	if (start > 0) t = t.slice(start);
	const lastObj = t.lastIndexOf("}");
	const lastArr = t.lastIndexOf("]");
	const end = Math.max(lastObj, lastArr);
	if (end !== -1 && end < t.length - 1) t = t.slice(0, end + 1);
	try {
		return JSON.parse(t);
	} catch (e) {
		throw new Error(
			`JSON inválido en la respuesta del agente (${e instanceof Error ? e.message : String(e)}): ${t.slice(0, 200)}`,
		);
	}
}

/**
 * Validación mínima de un valor contra un subconjunto de JSON Schema: type,
 * required, properties, items, enum. Suficiente para los schemas de los
 * patrones curados (objetos planos/anidados y arrays). Devuelve la lista de
 * errores con ruta ($[0].candidates[2].file); vacía = válido.
 */
export function validateJsonSchemaValue(
	value: unknown,
	schema: JsonSchema | undefined,
	path = "$",
): string[] {
	if (
		!schema ||
		typeof schema !== "object" ||
		Array.isArray(schema)
	)
		return [];
	const errors: string[] = [];
	const t = schema.type;
	if (typeof t === "string") {
		const actual = Array.isArray(value)
			? "array"
			: value === null
				? "null"
				: typeof value;
		const matches =
			t === "integer"
				? actual === "number" && Number.isInteger(value)
				: t === actual;
		if (!matches) {
			errors.push(`${path}: expected ${t}, got ${actual}`);
			return errors; // el tipo no calza: no tiene caso validar adentro
		}
	}
	if (Array.isArray(schema.enum)) {
		if (
			!schema.enum.some(
				(e) => JSON.stringify(e) === JSON.stringify(value),
			)
		) {
			errors.push(
				`${path}: value ${JSON.stringify(value)} not in enum [${schema.enum
					.map((e) => JSON.stringify(e))
					.join(", ")}]`,
			);
		}
	}
	if (value && typeof value === "object" && !Array.isArray(value)) {
		const record = value as Record<string, unknown>;
		if (Array.isArray(schema.required)) {
			for (const key of schema.required) {
				if (typeof key === "string" && !(key in record)) {
					errors.push(`${path}: missing required property "${key}"`);
				}
			}
		}
		const props = schema.properties;
		if (props && typeof props === "object" && !Array.isArray(props)) {
			for (const [key, child] of Object.entries(
				props as Record<string, JsonValue>,
			)) {
				if (record[key] !== undefined && child && typeof child === "object") {
					errors.push(
						...validateJsonSchemaValue(
							record[key],
							child as JsonSchema,
							`${path}.${key}`,
						),
					);
				}
			}
		}
	}
	if (
		Array.isArray(value) &&
		schema.items &&
		typeof schema.items === "object"
	) {
		value.forEach((item, i) => {
			errors.push(
				...validateJsonSchemaValue(
					item,
					schema.items as JsonSchema,
					`${path}[${i}]`,
				),
			);
		});
	}
	return errors;
}

/** Profundidad máxima de decodificación recursiva (#82) — cota defensiva. */
const MAX_DECODE_DEPTH = 8;

/**
 * Decodificación guiada por schema (#82: double-encoding de GLM-5.3, espejo
 * del #76 en la salida): cuando el schema espera object/array pero el valor
 * es un string que PARSEA a ese tipo exacto, se sustituye por el parseado —
 * recursivamente. Los strings que el schema espera como string se conservan
 * tal cual (nunca se promociona prosa ni se toca lo correcto); si el string
 * no parsea, se devuelve intacto y la validación reportará el error real.
 */
export function normalizeStructuredValue(
	value: unknown,
	schema: JsonSchema | undefined,
	depth = 0,
): unknown {
	if (!schema || typeof schema !== "object" || Array.isArray(schema))
		return value;
	if (depth >= MAX_DECODE_DEPTH) return value;
	const t = typeof schema.type === "string" ? schema.type : undefined;

	if (typeof value === "string" && (t === "object" || t === "array")) {
		try {
			const parsed = parseJsonLoose(value);
			const actual = Array.isArray(parsed)
				? "array"
				: parsed === null
					? "null"
					: typeof parsed;
			// Sólo promociona si el tipo parseado calza con el esperado.
			if (actual === t) return normalizeStructuredValue(parsed, schema, depth + 1);
		} catch {
			// no parsea → se valida tal cual y el error es accionable
		}
		return value;
	}

	if (value && typeof value === "object" && !Array.isArray(value)) {
		const record = value as Record<string, unknown>;
		const props = schema.properties;
		if (props && typeof props === "object" && !Array.isArray(props)) {
			let changed = false;
			const next: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(record)) {
				const child = (props as Record<string, JsonValue>)[k];
				const nv =
					child && typeof child === "object"
						? normalizeStructuredValue(v, child as JsonSchema, depth + 1)
						: v;
				if (nv !== v) changed = true;
				next[k] = nv;
			}
			if (changed) return next;
		}
		return value;
	}

	if (
		Array.isArray(value) &&
		schema.items &&
		typeof schema.items === "object"
	) {
		let changed = false;
		const next = value.map((item) => {
			const nv = normalizeStructuredValue(
				item,
				schema.items as JsonSchema,
				depth + 1,
			);
			if (nv !== item) changed = true;
			return nv;
		});
		if (changed) return next;
		return value;
	}

	return value;
}

/** Prompt del primer intento: la tarea + contrato de salida JSON. */
export function structuredPrompt(prompt: string, schema: JsonSchema): string {
	return (
		`${prompt}\n\n` +
		"OUTPUT FORMAT (strict): respond with ONLY one JSON value conforming to this JSON Schema — " +
		"no markdown fences, no prose before or after, just the JSON value:\n" +
		JSON.stringify(schema)
	);
}

/** Prompt de reparación: el error concreto + lo que respondió antes. */
export function repairPrompt(
	prompt: string,
	schema: JsonSchema,
	badOutput: string,
	errors: string[],
): string {
	return (
		`${structuredPrompt(prompt, schema)}\n\n` +
		"Your previous response was rejected. Fix it and respond again with ONLY the corrected JSON value.\n" +
		`Validation errors:\n- ${errors.join("\n- ")}\n\n` +
		`Previous response (may be truncated):\n${badOutput.slice(0, 2000)}`
	);
}

/** Suma accountings (los intentos de reparación cuestan tokens reales, #18). */
function sumAccounting(
	a: AgentAccounting | undefined,
	b: AgentAccounting | undefined,
): AgentAccounting | undefined {
	if (!a) return b;
	if (!b) return a;
	return {
		input: a.input + b.input,
		output: a.output + b.output,
		cacheRead: a.cacheRead + b.cacheRead,
		cacheWrite: a.cacheWrite + b.cacheWrite,
		cost: a.cost + b.cost,
	};
}

/**
 * Envuelve un SpawnAgentFn con soporte de outputSchema: sin la opción es
 * passthrough exacto (cero overhead, compatibilidad total con mocks); con la
 * opción aumenta el prompt, parsea, valida y repara acotadamente antes de
 * fallar. El resultado conserva value+accounting+durationMs combinados.
 */
export function withStructuredOutput(
	spawn: SpawnAgentFn,
	opts: { maxRepairAttempts?: number } = {},
): SpawnAgentFn {
	const maxRepair = opts.maxRepairAttempts ?? DEFAULT_MAX_REPAIR_ATTEMPTS;
	return async (prompt, options, signal, identity) => {
		const schema = options.outputSchema as JsonSchema | undefined;
		if (!schema || typeof schema !== "object") return spawn(prompt, options, signal, identity);

		let currentPrompt = structuredPrompt(prompt, schema);
		let accounting: AgentAccounting | undefined;
		let durationMs = 0;

		for (let attempt = 0; attempt <= maxRepair; attempt++) {
			const raw = (await spawn(
				currentPrompt,
				options,
				signal,
				identity,
			)) as JsonValue | AgentSpawnResult;
			const unpacked = unpackSpawnResult(raw);
			accounting = sumAccounting(accounting, unpacked.accounting);
			durationMs += unpacked.durationMs ?? 0;

			const text =
				typeof unpacked.value === "string" ? unpacked.value : null;
			if (text === null) {
				// El agente ya devolvió un JsonValue no-string (spawn custom):
				// se normaliza (#82: hijos string-encoded) y se valida tal cual.
				const normalized = normalizeStructuredValue(unpacked.value, schema);
				const errors = validateJsonSchemaValue(normalized, schema);
				if (!errors.length)
					return spawnResult(normalized as JsonValue, { accounting, durationMs });
				if (attempt === maxRepair) break;
				currentPrompt = repairPrompt(
					prompt,
					schema,
					JSON.stringify(unpacked.value),
					errors,
				);
				continue;
			}
			try {
				const parsed = normalizeStructuredValue(
					parseJsonLoose(text) as JsonValue,
					schema,
				) as JsonValue;
				const errors = validateJsonSchemaValue(parsed, schema);
				if (!errors.length)
					return spawnResult(parsed, { accounting, durationMs });
				if (attempt === maxRepair) break;
				currentPrompt = repairPrompt(prompt, schema, text, errors);
			} catch (e) {
				if (attempt === maxRepair) break;
				currentPrompt = repairPrompt(
					prompt,
					schema,
					text,
					[
						`invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
					],
				);
			}
		}

		throw new Error(
			`agent(${options.label ?? "unlabeled"}): outputSchema no satisfecho tras ${1 + maxRepair} intento(s); ` +
				"el agente no produjo JSON válido contra el schema. Revisa el schema o relaja sus constraints.",
		);
	};
}
