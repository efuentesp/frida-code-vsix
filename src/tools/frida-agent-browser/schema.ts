/**
 * frida-agent-browser — schema del tool (porte nativo de pi-agent-browser-native).
 *
 * Réplica recortada de AGENT_BROWSER_PARAMS
 * (dist/extensions/agent-browser/lib/input-modes/params.js). Se conservan fielmente
 * los input-modes centrales — args, semanticAction, job, qa — más los campos
 * comunes (stdin, outputPath, timeoutMs, sessionMode). Quedan FUERA del alcance
 * "Esencial": electron, sourceLookup, networkSourceLookup (avanzado).
 */

import { Type, type TSchema } from "typebox";
import {
	DEFAULT_SESSION_MODE,
	JOB_STEP_ACTIONS,
	QA_LOAD_STATES,
	SEMANTIC_ACTIONS,
	SEMANTIC_LOCATORS,
} from "./constants";
import { ELECTRON_INPUT } from "./electron/schema";

/** Helper local equivalente al StringEnum del referencia (Union de Literals). */
function stringEnum<T extends string>(values: readonly T[]): TSchema {
	return Type.Union(values.map((v) => Type.Literal(v)));
}

const argsParam = Type.Optional(
	Type.Array(
		Type.String({
			description:
				"Exact agent-browser CLI arguments, excluding the binary name. Do not pass --json; the wrapper injects it. First-call recipe: open → snapshot -i → click/fill @eN → snapshot -i.",
		}),
		{ minItems: 1 },
	),
);

const semanticActionParam = Type.Optional(
	Type.Object(
		{
			action: stringEnum(SEMANTIC_ACTIONS),
			locator: Type.Optional(stringEnum(SEMANTIC_LOCATORS)),
			value: Type.Optional(Type.String()),
			values: Type.Optional(Type.Array(Type.String(), { minItems: 1 })),
			selector: Type.Optional(Type.String()),
			text: Type.Optional(Type.String()),
			role: Type.Optional(Type.String()),
			name: Type.Optional(Type.String()),
			session: Type.Optional(Type.String()),
		},
		{ additionalProperties: false },
	),
);

const qaChecks = {
	expectedText: Type.Optional(
		Type.Union([Type.String(), Type.Array(Type.String())]),
	),
	expectedSelector: Type.Optional(Type.String()),
	screenshotPath: Type.Optional(Type.String()),
	checkConsole: Type.Optional(Type.Boolean()),
	checkErrors: Type.Optional(Type.Boolean()),
	checkNetwork: Type.Optional(Type.Boolean()),
	loadState: Type.Optional(stringEnum(QA_LOAD_STATES)),
};

const qaParam = Type.Optional(
	Type.Union([
		Type.Object(
			{
				attached: Type.Literal(true),
				...qaChecks,
			},
			{ additionalProperties: false },
		),
		Type.Object(
			{
				url: Type.String(),
				attached: Type.Optional(Type.Literal(false)),
				...qaChecks,
			},
			{ additionalProperties: false },
		),
	]),
);

const jobParam = Type.Optional(
	Type.Object(
		{
			failFast: Type.Optional(Type.Boolean()),
			steps: Type.Array(
				Type.Object(
					{
						action: stringEnum(JOB_STEP_ACTIONS),
						url: Type.Optional(Type.String()),
						loadState: Type.Optional(stringEnum(QA_LOAD_STATES)),
						selector: Type.Optional(Type.String()),
						locator: Type.Optional(stringEnum(SEMANTIC_LOCATORS)),
						role: Type.Optional(Type.String()),
						name: Type.Optional(Type.String()),
						text: Type.Optional(Type.String()),
						value: Type.Optional(Type.String()),
						values: Type.Optional(Type.Array(Type.String(), { minItems: 1 })),
						path: Type.Optional(Type.String()),
						delayMs: Type.Optional(Type.Integer({ minimum: 1 })),
						press: Type.Optional(Type.String()),
						milliseconds: Type.Optional(Type.Number()),
					},
					{ additionalProperties: false },
				),
				{ minItems: 1 },
			),
		},
		{ additionalProperties: false },
	),
);

/** Parámetros del tool agent_browser (Esencial: args/semanticAction/job/qa). */
export const AGENT_BROWSER_PARAMS = Type.Object(
	{
		args: argsParam,
		semanticAction: semanticActionParam,
		qa: qaParam,
		job: jobParam,
		electron: Type.Optional(ELECTRON_INPUT),
		script: Type.Optional(
			Type.String({
				description:
					"JavaScript source for the sandboxed script mode: async body with browser({ args, stdin?, timeoutMs? }) and emit(value). Max 25 browser calls; 64 KiB source/output caps; no host globals, no code generation from strings; browser calls cannot change session identity.",
				minLength: 1,
			}),
		),
		stdin: Type.Optional(
			Type.String({
				description:
					"Optional raw stdin content; only supported for batch, eval --stdin, auth save --password-stdin, and is generated internally by job/qa. Do not use with electron mode.",
			}),
		),
		outputPath: Type.Optional(
			Type.String({
				description:
					"Optional workspace-relative or absolute file path that receives the model-facing command data/result after the browser command completes. Useful for eval/get/snapshot captures that should become durable local artifacts.",
				minLength: 1,
			}),
		),
		timeoutMs: Type.Optional(
			Type.Integer({
				description:
					"Optional per-call wrapper subprocess watchdog in milliseconds for browser CLI args/job/qa calls. Use for long opens or large output captures.",
				minimum: 1,
			}),
		),
		sessionMode: Type.Optional(stringEnum(["auto", "fresh"])),
	},
	{ additionalProperties: false },
);

export type AgentBrowserParams = {
	args?: string[];
	semanticAction?: Record<string, unknown>;
	qa?: Record<string, unknown>;
	job?: Record<string, unknown>;
	script?: string;
	stdin?: string;
	outputPath?: string;
	timeoutMs?: number;
	sessionMode?: "auto" | "fresh";
};

export { DEFAULT_SESSION_MODE };
