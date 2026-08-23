/**
 * frida-agent-browser — categorías de resultado (Fase 1).
 *
 * Porte de results/categories.js del referencia: clasifica un outcome en enums
 * estables y machine-readable (`resultCategory`/`successCategory`/`failureCategory`)
 * para que el agente ramifique sin parsear prosa. Los strings son contrato público
 * (cubiertos por tests) y coinciden con los que el system-prompt/prompGuidelines
 * referencia (details.nextActions, failureCategory, …).
 *
 * Se mantiene un subconjunto fiel de las categorías más útiles; las muy nichas del
 * referencia (policy-blocked, cleanup-failed, download-not-verified, tab-drift…) se
 * agregan incrementalmente cuando se porteen sus features asociadas.
 */

export type SuccessCategory =
	| "inspection"
	| "artifact-saved"
	| "artifact-unverified"
	| "completed";
export type FailureCategory =
	| "selector-not-found"
	| "stale-ref"
	| "timeout"
	| "tab-gone"
	| "missing-binary"
	| "parse-failure"
	| "aborted"
	| "upstream-error";
export type ResultCategory = "success" | "failure";

export interface CategoryDetails {
	resultCategory: ResultCategory;
	successCategory?: SuccessCategory;
	failureCategory?: FailureCategory;
}

export interface ClassifyFailureOptions {
	errorText?: string;
	validationError?: string;
	parseError?: boolean;
	spawnError?: string;
	stderr?: string;
	command?: string;
	args?: string[];
	timedOut?: boolean;
}

export interface ClassifySuccessOptions {
	inspection?: boolean;
	savedFile?: string;
	artifacts?: Array<{ exists?: boolean }>;
}

/** Éxito → inspección / artefacto / completado. */
export function classifySuccessCategory(
	opts: ClassifySuccessOptions,
): SuccessCategory {
	if (opts.inspection) return "inspection";
	if ((opts.artifacts ?? []).length > 0) {
		return opts.artifacts!.some((a) => a.exists !== true)
			? "artifact-unverified"
			: "artifact-saved";
	}
	if (opts.savedFile) return "artifact-saved";
	return "completed";
}

/**
 * Fallo → regex sobre el texto de error + señales (timeout/spawn/ref usado).
 * Réplica del orden de precedencia del referencia (confirmation/locator-miss primero,
 * timeout explícito, ENOENT, parse, …).
 */
export function classifyFailureCategory(
	opts: ClassifyFailureOptions,
): FailureCategory {
	const text = [
		opts.errorText,
		opts.validationError,
		opts.parseError ? "invalid JSON" : undefined,
		opts.spawnError,
		opts.stderr,
	]
		.filter(Boolean)
		.join("\n");
	const command = opts.command ?? "";
	const usedRef = opts.args?.some((arg) => /^@e\d+\b/.test(arg)) ?? false;

	// Prefijo canónico del upstream 0.34.0 (tab pin perdido en sesiones
	// compartidas --cdp/--auto-connect): se evalúa PRIMERO porque el lastUrl
	// que arrastra el error puede contener about:blank/aborted y clasificar mal.
	if (/\btab_gone:/i.test(text)) return "tab-gone";

	// Locator miss (getByRole/text=/role=/Element not found con hint de verificación).
	const isLocatorMiss =
		/\bNo element found:\s*(?:getBy[A-Za-z]+|role=|text=|label=|placeholder=|alt=|title=|testid=)/i.test(
			text,
		) ||
		(/\bElement not found:/i.test(text) &&
			/\bVerify the selector, role, or name\b/i.test(text)) ||
		/\bnone match name\b/i.test(text);
	if (isLocatorMiss) return "selector-not-found";

	// Timeout explícito (no la palabra suelta "timeout").
	if (
		opts.timedOut ||
		/\b(?:timed\s+out|timeout exceeded|watchdog|IPC read timeout|Operation timed out)\b/i.test(
			text,
		)
	) {
		return "timeout";
	}

	// Binario ausente.
	if (
		/ENOENT|not found on PATH|agent-browser is required but was not found/i.test(
			text,
		)
	) {
		return "missing-binary";
	}

	// JSON inválido / sin success boolean.
	if (
		opts.parseError ||
		/invalid JSON|missing boolean success|returned no JSON output/i.test(text)
	) {
		return "parse-failure";
	}

	if (/\baborted\b/i.test(text)) return "aborted";

	// Stale ref (explícito o ref usado + element-not-found).
	if (
		/\bUnknown ref\b|\bstale ref\b|@ref may be stale|\bref\b.*\b(?:not found|missing|expired)\b/i.test(
			text,
		)
	) {
		return "stale-ref";
	}
	if (
		usedRef &&
		/could not locate element|element not found|no element/i.test(text)
	) {
		return "stale-ref";
	}

	// Selector no soportado (dialécticas Playwright: text=, :has-text, getByRole…).
	if (
		/\b(?:unsupported|unknown|invalid)\s+(?:selector|locator)\b|\bfailed to parse selector\b/i.test(
			text,
		)
	) {
		return "selector-not-found";
	}

	// find fallido genérico → selector-not-found.
	if (
		command === "find" &&
		/could not locate element|element not found|no elements? found|unable to find/i.test(
			text,
		)
	) {
		return "selector-not-found";
	}
	if (
		/\b(?:no elements? found|failed to find|could not find|unable to find)\b.*\b(?:selector|locator)\b/i.test(
			text,
		)
	) {
		return "selector-not-found";
	}

	if (opts.validationError) return "upstream-error";
	return "upstream-error";
}

export function buildCategoryDetails(
	succeeded: boolean,
	opts: ClassifySuccessOptions & ClassifyFailureOptions,
): CategoryDetails {
	if (succeeded) {
		return {
			resultCategory: "success",
			successCategory: classifySuccessCategory(opts),
		};
	}
	return {
		resultCategory: "failure",
		failureCategory: classifyFailureCategory(opts),
	};
}
