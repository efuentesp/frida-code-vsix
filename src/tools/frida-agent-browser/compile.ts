/**
 * frida-agent-browser — compiladores de input-modes (porte nativo).
 *
 * Porte fiel de los compiladores del paquete referencia:
 *  - compileAgentBrowserSemanticAction  (lib/input-modes/semantic-action.js)
 *  - compileAgentBrowserJob             (lib/input-modes/job.js — núcleo de steps)
 *  - compileAgentBrowserQaPreset        (lib/input-modes/job.js — qa)
 *  - getSelectValues / buildQaVisibleTextPredicate (lib/input-modes/shared.js, job.js)
 *
 * Cada compilador valida el input y devuelve { args, stdin? } listo para pasarse al
 * binario upstream `agent-browser` (sin --json, que lo inyecta el wrapper).
 * `resolveAgentBrowserInput` selecciona el modo activo (exclusión mutua) y normaliza.
 */

import {
	JOB_STEP_ACTIONS,
	JOB_TYPE_DELAYED_TEXT_MAX_CHARACTERS,
	QA_LOAD_STATES,
	QA_VISIBLE_TEXT_TIMEOUT_MS,
	SEMANTIC_ACTIONS,
	SEMANTIC_LOCATORS,
} from "./constants";
import { compileElectron, type CompiledElectron } from "./electron/compile";

type Record_ = Record<string, unknown>;

export interface CompiledInput {
	/** argv (sin el binario, sin --json). */
	args: string[];
	/** stdin opcional (sólo batch/eval/auth). */
	stdin?: string;
	/** modo que se compiló (para details). */
	mode: "args" | "semanticAction" | "job" | "qa" | "electron" | "script";
	/** plan electron (sólo mode="electron"). */
	electron?: CompiledElectron;
	/** código del sandbox (sólo mode="script"). */
	script?: { code: string };
}

export interface CompileError {
	error: string;
}

function isRecord(v: unknown): v is Record_ {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function nonEmptyString(v: unknown): v is string {
	return typeof v === "string" && v.trim().length > 0;
}

/** Porte de shared.js#getSelectValues. */
function getSelectValues(
	input: Record_,
	context: string,
): { values?: string[]; error?: string } {
	const rawValue = input.value;
	const rawValues = input.values;
	if (rawValue !== undefined && rawValues !== undefined) {
		return {
			error: `${context}.value and ${context}.values cannot both be provided for select.`,
		};
	}
	if (rawValues !== undefined) {
		if (
			!Array.isArray(rawValues) ||
			rawValues.length === 0 ||
			rawValues.some((value) => !nonEmptyString(value))
		) {
			return {
				error: `${context}.values must be a non-empty array of non-empty strings for select.`,
			};
		}
		return { values: rawValues as string[] };
	}
	if (nonEmptyString(rawValue)) {
		return { values: [rawValue] };
	}
	return {
		error: `${context}.value or ${context}.values is required for select.`,
	};
}

// ───────────────────────── semanticAction ─────────────────────────

export function compileSemanticAction(input: unknown): {
	compiled?: { action: string; args: string[] };
	error?: string;
} {
	if (!isRecord(input)) return { error: "semanticAction must be an object." };

	const {
		action,
		locator,
		value,
		values,
		selector,
		text,
		role,
		name,
		session,
	} = input as Record_ & {
		action?: string;
		locator?: string;
		value?: string;
		values?: string[];
		selector?: string;
		text?: string;
		role?: string;
		name?: string;
		session?: string;
	};

	if (
		typeof action !== "string" ||
		!SEMANTIC_ACTIONS.includes(action as never)
	) {
		return {
			error: `semanticAction.action must be one of: ${SEMANTIC_ACTIONS.join(", ")}.`,
		};
	}
	if (session !== undefined && !nonEmptyString(session)) {
		return {
			error: "semanticAction.session must be a non-empty string when provided.",
		};
	}
	const sessionPrefix =
		typeof session === "string" ? ["--session", session] : [];

	if (action === "select") {
		if (locator !== undefined || role !== undefined || name !== undefined) {
			return {
				error:
					"semanticAction.locator, role, and name are not supported for select; use selector plus value or values.",
			};
		}
		if (text !== undefined) {
			return {
				error:
					"semanticAction.text is not supported for select; use value or values for option values.",
			};
		}
		if (!nonEmptyString(selector)) {
			return { error: "semanticAction.selector is required for select." };
		}
		const selected = getSelectValues(input, "semanticAction");
		if (selected.error) return { error: selected.error };
		return {
			compiled: {
				action: "select",
				args: ["select", selector as string, ...selected.values!],
			},
		};
	}

	if (values !== undefined) {
		return {
			error: "semanticAction.values is only supported for select actions.",
		};
	}

	// selector directo (click/check/fill)
	if (selector !== undefined) {
		if (!nonEmptyString(selector)) {
			return {
				error:
					"semanticAction.selector must be a non-empty string when provided.",
			};
		}
		if (
			locator !== undefined ||
			value !== undefined ||
			role !== undefined ||
			name !== undefined
		) {
			return {
				error:
					"semanticAction.selector cannot be combined with locator, value, role, or name; use selector for a direct click/check/fill target or locator fields for find-based actions.",
			};
		}
		if (text !== undefined && typeof text !== "string") {
			return { error: "semanticAction.text must be a string when provided." };
		}
		if (action === "fill" && !nonEmptyString(text)) {
			return { error: `semanticAction.text is required for ${action}.` };
		}
		if (action !== "fill" && text !== undefined) {
			return {
				error: "semanticAction.text is only supported for fill actions.",
			};
		}
		const directArgs = [action, selector as string];
		if (action === "fill") directArgs.push(text as string);
		return { compiled: { action, args: [...sessionPrefix, ...directArgs] } };
	}

	// find … <action>
	if (
		typeof locator !== "string" ||
		!SEMANTIC_LOCATORS.includes(locator as never)
	) {
		return {
			error: `semanticAction.locator must be one of: ${SEMANTIC_LOCATORS.join(", ")}.`,
		};
	}
	if (value !== undefined && !nonEmptyString(value)) {
		return {
			error: "semanticAction.value must be a non-empty string when provided.",
		};
	}
	if (role !== undefined && !nonEmptyString(role)) {
		return {
			error: "semanticAction.role must be a non-empty string when provided.",
		};
	}
	const locatorValue =
		locator === "role" && typeof role === "string" ? role : value;
	if (!nonEmptyString(locatorValue)) {
		return {
			error:
				locator === "role"
					? "semanticAction.value or semanticAction.role must be a non-empty string for locator=role."
					: "semanticAction.value must be a non-empty string.",
		};
	}
	if (text !== undefined && typeof text !== "string") {
		return { error: "semanticAction.text must be a string when provided." };
	}
	if (action === "fill" && !nonEmptyString(text)) {
		return { error: `semanticAction.text is required for ${action}.` };
	}
	if (action !== "fill" && text !== undefined) {
		return { error: "semanticAction.text is only supported for fill actions." };
	}
	if (role !== undefined && locator !== "role") {
		return { error: "semanticAction.role is only supported for locator=role." };
	}
	if (role !== undefined && value !== undefined && role !== value) {
		return {
			error:
				"semanticAction.role must match value when both are provided for locator=role.",
		};
	}
	if (name !== undefined && (locator !== "role" || !nonEmptyString(name))) {
		return {
			error:
				"semanticAction.name is only supported as a non-empty string for locator=role.",
		};
	}
	const args = ["find", locator, locatorValue as string, action];
	if (action === "fill") args.push(text as string);
	if (locator === "role" && typeof name === "string") args.push("--name", name);
	return { compiled: { action, args: [...sessionPrefix, ...args] } };
}

// ───────────────────────── job ─────────────────────────

function getRequiredString(
	step: Record_,
	field: string,
	action: string,
): { value?: string; error?: string } {
	const v = step[field];
	if (!nonEmptyString(v)) {
		return {
			error: `job step ${action} requires a non-empty ${field} string.`,
		};
	}
	return { value: v };
}

function compileClickOrFill(
	step: Record_,
	action: "click" | "fill",
): { args?: string[]; error?: string } {
	const hasSelector = nonEmptyString(step.selector);
	const hasLocator =
		step.locator !== undefined ||
		step.role !== undefined ||
		step.name !== undefined ||
		step.value !== undefined;
	if (hasSelector && hasLocator) {
		return {
			error: `job step ${action} must use either selector or semantic locator fields, not both.`,
		};
	}
	if (hasSelector) {
		if (action === "click") return { args: ["click", step.selector as string] };
		const text = getRequiredString(step, "text", action);
		if (text.error) return { error: text.error };
		return { args: ["fill", step.selector as string, text.value!] };
	}
	if (!hasLocator) {
		return {
			error: `job step ${action} requires either a non-empty selector string or semantic locator fields.`,
		};
	}
	const compiled = compileSemanticAction({
		action,
		locator: step.locator,
		name: step.name,
		role: step.role,
		text: step.text,
		value: step.value,
	});
	if (compiled.error) {
		return {
			error: compiled.error.replaceAll("semanticAction", `job step ${action}`),
		};
	}
	return { args: compiled.compiled?.args };
}

interface CompiledStep {
	action: string;
	args: string[];
}
interface StepCompileResult {
	args?: string[];
	extraSteps?: CompiledStep[];
	error?: string;
}

const JOB_STEP_ALLOWED_FIELDS: Record<string, Set<string>> = {
	assertText: new Set(["action", "text"]),
	assertUrl: new Set(["action", "url"]),
	click: new Set(["action", "locator", "name", "role", "selector", "value"]),
	fill: new Set([
		"action",
		"locator",
		"name",
		"role",
		"selector",
		"text",
		"value",
	]),
	open: new Set(["action", "loadState", "url"]),
	screenshot: new Set(["action", "path"]),
	select: new Set(["action", "selector", "value", "values"]),
	snapshot: new Set(["action"]),
	type: new Set(["action", "delayMs", "press", "selector", "text"]),
	wait: new Set(["action", "milliseconds"]),
	waitForDownload: new Set(["action", "path"]),
};

function compileType(step: Record_): {
	steps?: CompiledStep[];
	error?: string;
} {
	const text = getRequiredString(step, "text", "type");
	if (text.error) return { error: text.error };
	const selector = step.selector;
	if (selector !== undefined && !nonEmptyString(selector)) {
		return {
			error: "job step type selector must be a non-empty string when provided.",
		};
	}
	const delayMs = step.delayMs;
	if (
		delayMs !== undefined &&
		(typeof delayMs !== "number" || !Number.isInteger(delayMs) || delayMs <= 0)
	) {
		return {
			error: "job step type delayMs must be a positive integer when provided.",
		};
	}
	const press = step.press;
	if (press !== undefined && !nonEmptyString(press)) {
		return {
			error:
				"job step type press must be a non-empty key string when provided.",
		};
	}
	const typedText = text.value!;
	const typedChars = Array.from(typedText);
	if (typedChars.length === 0)
		return { error: "job step type requires non-empty text." };
	if (
		delayMs !== undefined &&
		typedChars.length > JOB_TYPE_DELAYED_TEXT_MAX_CHARACTERS
	) {
		return {
			error: `job step type delayMs supports at most ${JOB_TYPE_DELAYED_TEXT_MAX_CHARACTERS} characters; split longer text into shorter calls or omit delayMs.`,
		};
	}
	const compiledSteps: CompiledStep[] = [];
	if (delayMs === undefined) {
		compiledSteps.push({
			action: "type",
			args:
				typeof selector === "string"
					? ["type", selector, typedText]
					: ["keyboard", "type", typedText],
		});
	} else {
		if (typeof selector === "string")
			compiledSteps.push({ action: "type", args: ["focus", selector] });
		for (const [index, char] of typedChars.entries()) {
			compiledSteps.push({ action: "type", args: ["keyboard", "type", char] });
			if (index < typedChars.length - 1)
				compiledSteps.push({ action: "wait", args: ["wait", String(delayMs)] });
		}
	}
	if (typeof press === "string")
		compiledSteps.push({ action: "type", args: ["press", press] });
	return { steps: compiledSteps };
}

function compileJobStep(step: Record_, index: number): StepCompileResult {
	const action = step.action;
	if (
		typeof action !== "string" ||
		!JOB_STEP_ACTIONS.includes(action as never)
	) {
		return {
			error: `job.steps[${index}].action must be one of: ${JOB_STEP_ACTIONS.join(", ")}.`,
		};
	}
	const allowed = JOB_STEP_ALLOWED_FIELDS[action];
	const unsupported = Object.keys(step).find((f) => !allowed.has(f));
	if (unsupported) {
		const supportedFields = [...allowed].filter((f) => f !== "action");
		const supportedText =
			supportedFields.length > 0
				? `supported fields are ${supportedFields.join(", ")}.`
				: "no additional fields are supported.";
		return {
			error: `job.steps[${index}]: ${action} does not support ${unsupported}; ${supportedText}`,
		};
	}

	switch (action) {
		case "open": {
			const r = getRequiredString(step, "url", "open");
			if (r.error) return { error: r.error };
			const extraSteps: CompiledStep[] = [];
			if (step.loadState !== undefined) {
				if (
					typeof step.loadState !== "string" ||
					!QA_LOAD_STATES.includes(step.loadState as never)
				) {
					return {
						error: `job.steps[${index}].loadState must be one of: ${QA_LOAD_STATES.join(", ")}.`,
					};
				}
				extraSteps.push({
					action: "wait",
					args: ["wait", "--load", step.loadState],
				});
			}
			return { args: ["open", r.value!], extraSteps };
		}
		case "click":
			return compileClickOrFill(step, "click");
		case "fill":
			return compileClickOrFill(step, "fill");
		case "type": {
			const r = compileType(step);
			if (r.error) return { error: r.error };
			const [first, ...extraSteps] = r.steps!;
			return { args: first.args, extraSteps };
		}
		case "select": {
			const sel = getRequiredString(step, "selector", "select");
			if (sel.error) return { error: sel.error };
			const vals = getSelectValues(step, `job.steps[${index}]`);
			if (vals.error) return { error: vals.error };
			return { args: ["select", sel.value!, ...vals.values!] };
		}
		case "wait": {
			const ms = step.milliseconds;
			if (typeof ms !== "number" || !Number.isInteger(ms) || ms <= 0) {
				return {
					error:
						"job step wait requires a positive integer milliseconds value.",
				};
			}
			return { args: ["wait", String(ms)] };
		}
		case "assertText": {
			const r = getRequiredString(step, "text", "assertText");
			if (r.error) return { error: r.error };
			return { args: ["wait", "--text", r.value!] };
		}
		case "assertUrl": {
			const r = getRequiredString(step, "url", "assertUrl");
			if (r.error) return { error: r.error };
			return { args: ["wait", "--url", r.value!] };
		}
		case "screenshot": {
			const r = getRequiredString(step, "path", "screenshot");
			if (r.error) return { error: r.error };
			return { args: ["screenshot", r.value!] };
		}
		case "waitForDownload": {
			const r = getRequiredString(step, "path", "waitForDownload");
			if (r.error) return { error: r.error };
			return { args: ["wait", "--download", r.value!] };
		}
		case "snapshot":
			return { args: ["snapshot", "-i"] };
		default:
			return { error: `job.steps[${index}]: unsupported action ${action}.` };
	}
}

export function compileJob(input: unknown): {
	compiled?: { args: string[]; stdin: string; failFast: boolean };
	error?: string;
} {
	if (!isRecord(input)) return { error: "job must be an object." };
	const rawFailFast = input.failFast;
	if (rawFailFast !== undefined && typeof rawFailFast !== "boolean") {
		return { error: "job.failFast must be a boolean when provided." };
	}
	const failFast = rawFailFast !== false;
	const rawSteps = input.steps;
	if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
		return { error: "job.steps must be a non-empty array." };
	}
	const steps: CompiledStep[] = [];
	for (const [index, rawStep] of rawSteps.entries()) {
		if (!isRecord(rawStep)) {
			return { error: `job.steps[${index}] must be an object.` };
		}
		const compiled = compileJobStep(rawStep, index);
		if (compiled.error) {
			return {
				error: compiled.error.startsWith(`job.steps[${index}]`)
					? compiled.error
					: `job.steps[${index}]: ${compiled.error}`,
			};
		}
		steps.push({
			action: (rawStep as { action: string }).action,
			args: compiled.args!,
		});
		for (const extra of compiled.extraSteps ?? []) steps.push(extra);
	}
	return {
		compiled: {
			args: failFast ? ["batch", "--bail"] : ["batch"],
			stdin: JSON.stringify(steps.map((s) => s.args)),
			failFast,
		},
	};
}

// ───────────────────────── qa ─────────────────────────

function buildQaVisibleTextPredicate(text: string): string {
	return `(() => {
  const expected = ${JSON.stringify(text)}.replace(/\\s+/g, " ").trim();
  if (!expected) return false;
  const root = document.body || document.documentElement;
  if (!root) return false;
  const skipTags = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG"]);
  const normalize = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
  const isVisibleElement = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    if (skipTags.has(element.tagName)) return false;
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    return element.getClientRects().length > 0;
  };
  const hasVisibleAncestors = (node) => {
    for (let element = node.parentElement; element; element = element.parentElement) {
      if (!isVisibleElement(element)) return false;
      if (element === root) break;
    }
    return true;
  };
  const textWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let visitedText = 0;
  for (let node = textWalker.nextNode(); node && visitedText < 6000; node = textWalker.nextNode(), visitedText += 1) {
    if (!hasVisibleAncestors(node)) continue;
    if (normalize(node.nodeValue).includes(expected)) return true;
  }
  const elementWalker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let visitedElements = 0;
  for (let node = elementWalker.nextNode(); node && visitedElements < 3000; node = elementWalker.nextNode(), visitedElements += 1) {
    const element = node;
    if (!isVisibleElement(element) || !("value" in element)) continue;
    if (normalize(element.value).includes(expected)) return true;
  }
  return false;
})()`;
}

export function compileQa(input: unknown): {
	compiled?: { args: string[]; stdin: string };
	error?: string;
} {
	if (!isRecord(input)) return { error: "qa must be an object." };
	const attached = input.attached === true;
	if (input.attached !== undefined && typeof input.attached !== "boolean") {
		return { error: "qa.attached must be a boolean when provided." };
	}
	const url = input.url;
	if (attached && url !== undefined) {
		return { error: "qa.url must be omitted when qa.attached is true." };
	}
	if (!attached && !nonEmptyString(url)) {
		return { error: "qa.url must be a non-empty string." };
	}
	const normalizedUrl = typeof url === "string" ? url.trim() : undefined;

	const rawExpected = input.expectedText;
	const expectedText: string[] =
		rawExpected === undefined
			? []
			: typeof rawExpected === "string"
				? [rawExpected]
				: Array.isArray(rawExpected)
					? (rawExpected as string[])
					: [];
	if (expectedText.some((t) => !nonEmptyString(t))) {
		return {
			error:
				"qa.expectedText must be a non-empty string or array of non-empty strings when provided.",
		};
	}
	if (
		input.expectedSelector !== undefined &&
		!nonEmptyString(input.expectedSelector)
	) {
		return {
			error: "qa.expectedSelector must be a non-empty string when provided.",
		};
	}
	const expectedSelector = nonEmptyString(input.expectedSelector)
		? input.expectedSelector
		: undefined;
	if (
		input.screenshotPath !== undefined &&
		!nonEmptyString(input.screenshotPath)
	) {
		return {
			error: "qa.screenshotPath must be a non-empty string when provided.",
		};
	}
	const screenshotPath = nonEmptyString(input.screenshotPath)
		? input.screenshotPath
		: undefined;
	for (const field of [
		"checkConsole",
		"checkErrors",
		"checkNetwork",
	] as const) {
		if (input[field] !== undefined && typeof input[field] !== "boolean") {
			return { error: `qa.${field} must be a boolean when provided.` };
		}
	}
	const rawLoadState = input.loadState;
	if (
		rawLoadState !== undefined &&
		(typeof rawLoadState !== "string" ||
			!QA_LOAD_STATES.includes(rawLoadState as never))
	) {
		return {
			error: `qa.loadState must be one of: ${QA_LOAD_STATES.join(", ")}.`,
		};
	}
	const checkConsole =
		typeof input.checkConsole === "boolean" ? input.checkConsole : !attached;
	const checkErrors =
		typeof input.checkErrors === "boolean" ? input.checkErrors : !attached;
	const checkNetwork =
		typeof input.checkNetwork === "boolean" ? input.checkNetwork : !attached;
	const loadState = (
		typeof rawLoadState === "string" ? rawLoadState : "domcontentloaded"
	) as string;
	const diagnosticsResetAtStart = !attached;

	const steps: CompiledStep[] = [];
	if (diagnosticsResetAtStart && checkNetwork)
		steps.push({ action: "wait", args: ["network", "requests", "--clear"] });
	if (diagnosticsResetAtStart && checkConsole)
		steps.push({ action: "wait", args: ["console", "--clear"] });
	if (diagnosticsResetAtStart && checkErrors)
		steps.push({ action: "wait", args: ["errors", "--clear"] });
	if (!attached && normalizedUrl)
		steps.push({ action: "open", args: ["open", normalizedUrl] });
	steps.push({ action: "wait", args: ["wait", "--load", loadState] });
	for (const text of expectedText) {
		steps.push({
			action: "assertText",
			args: [
				"wait",
				"--fn",
				buildQaVisibleTextPredicate(text),
				"--timeout",
				String(QA_VISIBLE_TEXT_TIMEOUT_MS),
			],
		});
	}
	if (expectedSelector)
		steps.push({ action: "wait", args: ["wait", expectedSelector] });
	if (checkNetwork)
		steps.push({ action: "wait", args: ["network", "requests"] });
	if (checkConsole) steps.push({ action: "wait", args: ["console"] });
	if (checkErrors) steps.push({ action: "wait", args: ["errors"] });
	if (screenshotPath)
		steps.push({ action: "screenshot", args: ["screenshot", screenshotPath] });

	return {
		compiled: {
			args: ["batch", "--bail"],
			stdin: JSON.stringify(steps.map((s) => s.args)),
		},
	};
}

// ───────────────────────── resolveInput ─────────────────────────

/**
 * Selecciona el modo activo (exclusión mutua) y devuelve el argv + stdin listos.
 * Réplica de resolveAgentBrowserInput del referencia (sin electron/lookups).
 */
export function resolveAgentBrowserInput(
	params: Record_,
): CompiledInput | CompileError {
	const modes = ["args", "semanticAction", "job", "qa", "electron", "script"].filter(
		(m) => params[m] !== undefined,
	);
	if (modes.length === 0) {
		return {
			error:
				"Provide exactly one input mode: args, semanticAction, job, qa, electron, or script.",
		};
	}
	if (modes.length > 1) {
		return {
			error: `Provide exactly one input mode; got ${modes.join(", ")}.`,
		};
	}
	const stdin =
		typeof params.stdin === "string" ? (params.stdin as string) : undefined;

	if (params.args !== undefined) {
		const args = params.args;
		if (
			!Array.isArray(args) ||
			args.length === 0 ||
			args.some((a) => typeof a !== "string")
		) {
			return { error: "args must be a non-empty array of strings." };
		}
		return { args: args as string[], stdin, mode: "args" };
	}
	if (params.semanticAction !== undefined) {
		const r = compileSemanticAction(params.semanticAction);
		if (r.error) return { error: r.error };
		return { args: r.compiled!.args, stdin, mode: "semanticAction" };
	}
	if (params.job !== undefined) {
		const r = compileJob(params.job);
		if (r.error) return { error: r.error };
		return { args: r.compiled!.args, stdin: r.compiled!.stdin, mode: "job" };
	}
	if (params.qa !== undefined) {
		const r = compileQa(params.qa);
		if (r.error) return { error: r.error };
		return { args: r.compiled!.args, stdin: r.compiled!.stdin, mode: "qa" };
	}
	if (params.electron !== undefined) {
		const r = compileElectron(params.electron);
		if (r.error) return { error: r.error };
		return { args: [], mode: "electron", electron: r.compiled };
	}
	if (params.script !== undefined) {
		// El código se valida en script/mode.ts (límite 64 KiB); aquí sólo se
		// tipa y se marca el modo — el orquestador del sandbox lo ejecuta.
		if (typeof params.script !== "string" || params.script.trim() === "") {
			return { error: "script must be a non-empty string." };
		}
		return {
			args: [],
			mode: "script",
			script: { code: params.script as string },
		};
	}
	return { error: "Unsupported input mode." };
}
