/**
 * frida-agent-browser — Compilador del input-mode `electron` (Fase 7).
 *
 * Porte fiel de input-modes/electron.js del referencia: valida el input `electron`
 * (action + campos por acción) y devuelve un plan compilado, o un error. Reglas:
 *  - list: sólo query/maxResults.
 *  - launch: exactamente UNO de appPath/appName/bundleId/executablePath; appArgs sin
 *    flags wrapper-owned (--user-data-dir/--remote-debugging-port/...).
 *  - status/cleanup: launchId O all (no ambos).
 *  - probe: sólo launchId/timeoutMs.
 */

export const ELECTRON_ACTIONS = [
	"list",
	"launch",
	"status",
	"cleanup",
	"probe",
] as const;
export const ELECTRON_HANDOFFS = ["connect", "tabs", "snapshot"] as const;
export const ELECTRON_TARGET_TYPES = ["page", "webview", "any"] as const;
export const ELECTRON_RESERVED_APP_ARGS = [
	"--user-data-dir",
	"--remote-debugging-port",
	"--remote-debugging-address",
	"--remote-debugging-pipe",
];
const LIST_FIELDS = new Set(["action", "query", "maxResults"]);
const PROBE_FIELDS = new Set(["action", "launchId", "timeoutMs"]);

type Record_ = Record<string, unknown>;

export interface CompiledList {
	action: "list";
	query?: string;
	maxResults?: number;
}
export interface CompiledLaunch {
	action: "launch";
	appArgs?: string[];
	allow?: string[];
	deny?: string[];
	appPath?: string;
	appName?: string;
	bundleId?: string;
	executablePath?: string;
	handoff: "connect" | "tabs" | "snapshot";
	targetType: "page" | "webview" | "any";
	timeoutMs?: number;
}
export interface CompiledStatusCleanup {
	action: "status" | "cleanup";
	all?: true;
	launchId?: string;
	timeoutMs?: number;
}
export interface CompiledProbe {
	action: "probe";
	launchId?: string;
	timeoutMs?: number;
}
export type CompiledElectron =
	| CompiledList
	| CompiledLaunch
	| CompiledStatusCleanup
	| CompiledProbe;

function isRecord(v: unknown): v is Record_ {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateOptionalNonEmptyString(
	input: Record_,
	field: string,
): { value?: string; error?: string } {
	const v = input[field];
	if (v === undefined) return {};
	if (typeof v !== "string" || v.trim().length === 0)
		return {
			error: `electron.${field} must be a non-empty string when provided.`,
		};
	return { value: v.trim() };
}

function validateOptionalStringArray(
	input: Record_,
	field: string,
): string | undefined {
	const v = input[field];
	if (v === undefined) return undefined;
	if (
		!Array.isArray(v) ||
		v.some((i) => typeof i !== "string" || i.trim().length === 0)
	) {
		return `electron.${field} must be an array of non-empty strings when provided.`;
	}
	return undefined;
}

function validateOptionalEnum(
	input: Record_,
	field: string,
	values: readonly string[],
): string | undefined {
	const v = input[field];
	if (v === undefined) return undefined;
	if (typeof v !== "string" || !values.includes(v))
		return `electron.${field} must be one of: ${values.join(", ")}.`;
	return undefined;
}

function validateOptionalPositiveInt(
	input: Record_,
	field: string,
): { value?: number; error?: string } {
	const v = input[field];
	if (v === undefined) return {};
	if (typeof v !== "number" || !Number.isInteger(v) || v <= 0)
		return {
			error: `electron.${field} must be a positive integer when provided.`,
		};
	return { value: v };
}

function findUnsupportedField(
	input: Record_,
	allowed: Set<string>,
): string | undefined {
	return Object.keys(input).find((f) => !allowed.has(f));
}

function getReservedAppArg(appArgs: string[] | undefined): string | undefined {
	return appArgs?.find((arg) => {
		const t = arg.trim();
		return (
			t === "--" ||
			ELECTRON_RESERVED_APP_ARGS.some((r) => t === r || t.startsWith(`${r}=`))
		);
	});
}

export function compileElectron(input: unknown): {
	compiled?: CompiledElectron;
	error?: string;
} {
	if (!isRecord(input)) return { error: "electron must be an object." };
	const action = input.action;
	if (
		typeof action !== "string" ||
		!ELECTRON_ACTIONS.includes(action as never)
	) {
		return {
			error: `electron.action must be one of: ${ELECTRON_ACTIONS.join(", ")}.`,
		};
	}

	// Validación transversal de campos opcionales.
	for (const f of [
		"query",
		"appPath",
		"appName",
		"bundleId",
		"executablePath",
		"launchId",
	]) {
		const r = validateOptionalNonEmptyString(input, f);
		if (r.error) return { error: r.error };
	}
	for (const f of ["appArgs", "allow", "deny"]) {
		const e = validateOptionalStringArray(input, f);
		if (e) return { error: e };
	}
	let e = validateOptionalEnum(input, "handoff", ELECTRON_HANDOFFS);
	if (e) return { error: e };
	e = validateOptionalEnum(input, "targetType", ELECTRON_TARGET_TYPES);
	if (e) return { error: e };
	for (const f of ["maxResults", "timeoutMs"]) {
		const r = validateOptionalPositiveInt(input, f);
		if (r.error) return { error: r.error };
	}
	if (input.all !== undefined && input.all !== true) {
		return { error: "electron.all must be true when provided." };
	}

	if (action === "list") {
		const bad = findUnsupportedField(input, LIST_FIELDS);
		if (bad)
			return {
				error: `electron.list only supports query and maxResults; remove electron.${bad}.`,
			};
		return {
			compiled: {
				action: "list",
				maxResults: validateOptionalPositiveInt(input, "maxResults").value,
				query: validateOptionalNonEmptyString(input, "query").value,
			},
		};
	}

	if (action === "probe") {
		const bad = findUnsupportedField(input, PROBE_FIELDS);
		if (bad)
			return {
				error: `electron.probe only supports action, launchId, and timeoutMs; remove electron.${bad}.`,
			};
		return {
			compiled: {
				action: "probe",
				launchId: validateOptionalNonEmptyString(input, "launchId").value,
				timeoutMs: validateOptionalPositiveInt(input, "timeoutMs").value,
			},
		};
	}

	if (action === "launch") {
		const allowed = new Set([
			"action",
			"allow",
			"appArgs",
			"appName",
			"appPath",
			"bundleId",
			"deny",
			"executablePath",
			"handoff",
			"targetType",
			"timeoutMs",
		]);
		const bad = findUnsupportedField(input, allowed);
		if (bad)
			return { error: `electron.launch does not support electron.${bad}.` };
		const appArgs = (input.appArgs as string[] | undefined)?.map((i) =>
			i.trim(),
		);
		const reserved = getReservedAppArg(appArgs);
		if (reserved)
			return {
				error: `electron.appArgs must not include wrapper-owned launch flag ${reserved}.`,
			};
		const targets = ["appPath", "appName", "bundleId", "executablePath"].filter(
			(f) => input[f] !== undefined,
		);
		if (targets.length !== 1) {
			return {
				error:
					"electron.launch requires exactly one of appPath, appName, bundleId, or executablePath.",
			};
		}
		return {
			compiled: {
				action: "launch",
				allow: (input.allow as string[] | undefined)?.map((i) => i.trim()),
				appArgs,
				deny: (input.deny as string[] | undefined)?.map((i) => i.trim()),
				appName: validateOptionalNonEmptyString(input, "appName").value,
				appPath: validateOptionalNonEmptyString(input, "appPath").value,
				bundleId: validateOptionalNonEmptyString(input, "bundleId").value,
				executablePath: validateOptionalNonEmptyString(input, "executablePath")
					.value,
				handoff: (input.handoff as CompiledLaunch["handoff"]) ?? "snapshot",
				targetType:
					(input.targetType as CompiledLaunch["targetType"]) ?? "page",
				timeoutMs: validateOptionalPositiveInt(input, "timeoutMs").value,
			},
		};
	}

	// status / cleanup
	const allowed = new Set(["action", "all", "launchId", "timeoutMs"]);
	const bad = findUnsupportedField(input, allowed);
	if (bad)
		return { error: `electron.${action} does not support electron.${bad}.` };
	if (input.all === true && input.launchId !== undefined) {
		return { error: `electron.${action} accepts launchId or all, not both.` };
	}
	return {
		compiled: {
			action: action as "status" | "cleanup",
			all: input.all === true ? true : undefined,
			launchId: validateOptionalNonEmptyString(input, "launchId").value,
			timeoutMs: validateOptionalPositiveInt(input, "timeoutMs").value,
		},
	};
}
