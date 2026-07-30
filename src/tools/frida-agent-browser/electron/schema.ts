/**
 * frida-agent-browser — Schema del input-mode `electron` (Fase 7).
 *
 * Porte recortado de input-modes/params.js (variantes electron). La validación
 * fina por acción la hace compile.ts; este schema expone la forma aceptada.
 */

import { Type, type TSchema } from "typebox";
import {
	ELECTRON_ACTIONS,
	ELECTRON_HANDOFFS,
	ELECTRON_TARGET_TYPES,
} from "./compile";

function stringEnum<T extends string>(values: readonly T[]): TSchema {
	return Type.Union(values.map((v) => Type.Literal(v)));
}

/** Campos compartidos de launch (las 4 variantes de target difieren sólo en ese campo). */
const launchShared = {
	appArgs: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
	handoff: Type.Optional(stringEnum(ELECTRON_HANDOFFS)),
	targetType: Type.Optional(stringEnum(ELECTRON_TARGET_TYPES)),
	timeoutMs: Type.Optional(Type.Integer({ minimum: 1 })),
	allow: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
	deny: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
};

/** Forma del input electron (unión de variantes por acción). */
export const ELECTRON_INPUT = Type.Union([
	Type.Object(
		{
			action: Type.Literal("list"),
			query: Type.Optional(Type.String()),
			maxResults: Type.Optional(Type.Integer({ minimum: 1 })),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			action: Type.Literal("launch"),
			appPath: Type.String({ minLength: 1 }),
			...launchShared,
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			action: Type.Literal("launch"),
			appName: Type.String({ minLength: 1 }),
			...launchShared,
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			action: Type.Literal("launch"),
			bundleId: Type.String({ minLength: 1 }),
			...launchShared,
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			action: Type.Literal("launch"),
			executablePath: Type.String({ minLength: 1 }),
			...launchShared,
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			action: stringEnum(["status", "cleanup"]),
			launchId: Type.Optional(Type.String({ minLength: 1 })),
			all: Type.Optional(Type.Literal(true)),
			timeoutMs: Type.Optional(Type.Integer({ minimum: 1 })),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			action: Type.Literal("probe"),
			launchId: Type.Optional(Type.String({ minLength: 1 })),
			timeoutMs: Type.Optional(Type.Integer({ minimum: 1 })),
		},
		{ additionalProperties: false },
	),
]);

/** Parámetros del input-mode electron (campo top-level). */
export const ELECTRON_PARAMS = Type.Object(
	{
		electron: Type.Optional(ELECTRON_INPUT),
	},
	{ additionalProperties: false },
);

export { ELECTRON_ACTIONS };
