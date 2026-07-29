// Evaluación declarativa de permisos de frida-permission-system (ADR-0016, Fase 1).
//
// `evaluate()` es PURA: no conoce el modo ni el toggle acceptAllEdits. Toma la
// policy + los patrones legacy + el input del tool, y devuelve la decisión
// PRE-modo (state/forceAsk/reason/source/flags). El gate (index.ts) aplica el
// override del modo y el diálogo encima.
//
// Reproduce EXACTAMENTE el flow imperativo de approval-gates.ts (pasos 1-4),
// pero leyendo la baseline de la superficie `tool` declarativa en vez de los sets
// FREE_TOOLS/DIFF_TOOLS hardcodeados. Los deny concretos siguen viniendo de los
// helpers (sensitive-paths, dangerous-commands) como capas de seguridad; el
// force-ask (bash compuesto / path externo) se preserva como flag que sobrevive
// al modo `auto`.

import { isSensitivePath } from "../../gates/sensitive-paths";
import { isDangerousBash } from "../../gates/dangerous-commands";
import { hasShellIndirection } from "../../gates/bash-indirection";
import { isExternalPath } from "../../gates/external-paths";
import { matchesWildcard } from "./session-approvals";
import type { GatePatterns } from "../../settings";
import type {
	PatternMap,
	PermissionDecision,
	PermissionPolicy,
	PermissionState,
	ToolKind,
} from "./types";

/**
 * Tools de archivo con `input.path` que pueden apuntar fuera del workspace.
 * Metadata (NO política): indica qué tools inspeccionar con isExternalPath para
 * el force-ask de CWD boundary. Igual que PATH_TOOLS en approval-gates.ts.
 */
const PATH_TOOLS = new Set(["read", "edit", "write", "grep", "find", "ls"]);

export interface EvaluateInput {
	tool: string;
	inputPath?: string;
	command?: string;
	cwd: string;
	policy: PermissionPolicy;
	patterns: GatePatterns;
}

/** Clasifica el tool en la vista que ve el usuario y el log (igual que deriveKind). */
export function classifyKind(tool: string): ToolKind {
	if (tool === "edit" || tool === "write") return "diff";
	if (tool === "bash") return "bash";
	return "tool";
}

/**
 * Devuelve el estado más restrictivo de una lista (deny > ask > allow). Usado
 * para combinar las superficies path/bash/tool (most-restrictive-wins, paridad
 * gotgenes).
 */
function mostRestrictive(...states: PermissionState[]): PermissionState {
	if (states.some((s) => s === "deny")) return "deny";
	if (states.some((s) => s === "ask")) return "ask";
	return "allow";
}

/**
 * Aplica un mapa de patrones (wildcard) a un valor. Devuelve el estado combinado
 * de TODOS los patrones que matchean (most-restrictive-wins, NO last-match: así
 * un `*: allow` default no anula un `*.env: deny` específico sin importar el
 * orden). Undefined si ningún patrón matchea.
 */
function matchPattern(
	map: PatternMap,
	value: string | undefined,
): PermissionState | undefined {
	if (!value) return undefined;
	let found = false;
	let result: PermissionState = "allow";
	for (const [pattern, state] of Object.entries(map)) {
		if (matchesWildcard(pattern, value)) {
			found = true;
			result = mostRestrictive(result, state);
		}
	}
	return found ? result : undefined;
}

/**
 * Evalúa la política para una llamada de tool. PURA (sin modo, sin diálogo).
 *
 * Pasos:
 * 1. `path` surface: deny hardcodeado (sensitive-paths) → bloquea; si no, aplica
 *    los patrones declarativos de `policy.path` (Fase 5b). Un `deny` declarativo
 *    bloquea con reason.
 * 2. `bash` surface: deny hardcodeado (dangerous-commands) → bloquea; si no, aplica
 *    `policy.bash` (Fase 5b).
 * 3. force-ask: bash compuesto/wrapper o path externo → marca forceAsk.
 * 4. Combinación (most-restrictive-wins): path (si hay) · bash (si bash) · tool.
 *    force-ask promueve allow → ask.
 */
export function evaluate(input: EvaluateInput): PermissionDecision {
	const { tool, inputPath, command, cwd, policy, patterns } = input;
	const flags: string[] = [];
	let warning: string | undefined;

	// 1) path surface — helper deny (secretos/credenciales, cross-cutting).
	const pathCheck = isSensitivePath(inputPath, {
		extraExtensions: patterns.sensitiveExtensions,
		extraBasenames: patterns.sensitiveBasenames,
		extraAllow: patterns.sensitiveAllowBasenames,
	});
	if (pathCheck.denied) {
		return {
			state: "deny",
			forceAsk: false,
			reason: pathCheck.reason,
			source: "sensitive_path",
		};
	}
	// 1b) path surface — patrones declarativos (Fase 5b): deny → bloquea.
	const pathMatch = inputPath
		? matchPattern(policy.path, inputPath)
		: undefined;
	if (pathMatch === "deny") {
		return {
			state: "deny",
			forceAsk: false,
			reason:
				"Bloqueado por la política de paths: coincide un patrón 'deny'. Si de verdad necesitas acceder a este archivo, pídeselo explícitamente al usuario.",
			source: "policy_path",
		};
	}

	// 2) bash surface — helper deny (comando destructivo).
	if (tool === "bash") {
		const cmdCheck = isDangerousBash(command, {
			extraSubstrings: patterns.dangerousCommandSubstrings,
		});
		if (cmdCheck.denied) {
			return {
				state: "deny",
				forceAsk: false,
				reason: cmdCheck.reason,
				source: "dangerous_command",
			};
		}
	}
	// 2b) bash surface — patrones declarativos (Fase 5b): deny → bloquea.
	const bashMatch =
		tool === "bash" && command ? matchPattern(policy.bash, command) : undefined;
	if (bashMatch === "deny") {
		return {
			state: "deny",
			forceAsk: false,
			reason:
				"Bloqueado por la política de bash: coincide un patrón 'deny'. Si de verdad necesitas ejecutarlo, pídeselo al usuario para que lo corra fuera del agente.",
			source: "policy_bash",
		};
	}

	// 3) force-ask — disuasivo heredado (Prioridad 3 del diseño original).
	if (tool === "bash") {
		const indir = hasShellIndirection(command);
		if (indir.detected) {
			flags.push("compound_command");
			warning = indir.reason;
		}
	}
	if (PATH_TOOLS.has(tool)) {
		const ext = isExternalPath(inputPath, cwd);
		if (ext.external) {
			flags.push("external_path");
			warning =
				"Ruta fuera del workspace" +
				(ext.absPath ? ` (${ext.absPath})` : "") +
				". Revisa que sea intencional antes de aceptar.";
		}
	}
	const forceAsk = flags.length > 0;

	// 4) combinar superficies (most-restrictive-wins): path · bash · tool.
	const toolState = policy.tool[tool] ?? policy.tool["*"] ?? "ask";
	const applicable = [pathMatch, bashMatch, toolState].filter(
		(s): s is PermissionState => s !== undefined,
	);
	let state = applicable.length > 0 ? mostRestrictive(...applicable) : "ask";

	// force-ask promueve allow → ask: en modo auto el usuario no mira, y un
	// sub-comando peligroso o un path externo no debe colarse amparado por un allow.
	if (forceAsk && state === "allow") state = "ask";

	return {
		state,
		forceAsk,
		reason: warning,
		// El source del log lo decide el gate (mode/user_approved/...): aquí no es
		// terminal. Los deny sí llevan source (sensitive_path/policy_*/...).
		flags: flags.length > 0 ? flags : undefined,
	};
}

/**
 * Tools explícitamente `deny` en la superficie `tool` (para hide-tools, Fase 7).
 *
 * Excluye el wildcard `"*"` a propósito: un `*: deny` default NO oculta todos los
 * tools (sería peligroso — dejaría al agente sin ninguno). Sólo los tools con un
 * `deny` explícito se ocultan del catálogo del LLM vía setActiveTools. El gate
 * `tool_call` sigue siendo la última línea: si el agente alucina un tool oculto,
 * lo bloquea igual.
 */
export function computeDeniedTools(policy: PermissionPolicy): Set<string> {
	const denied = new Set<string>();
	for (const [name, state] of Object.entries(policy.tool)) {
		if (state === "deny" && name !== "*") denied.add(name);
	}
	return denied;
}
