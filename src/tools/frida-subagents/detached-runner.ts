// frida-subagents — orquestador de runs detached (issue #26, ADR-0037).
//
// Spawn del child `pi -p --mode json` (pi embebido del VSIX), registro
// durable, finalización con resultado+tokens (#18), notificación al host y
// live-progress por tail del log para widget/panel.
//
// Decisiones (addendum ADR-0037):
// - Child limpio: --no-extensions (builtin tools + custom agent prompt).
// - Auth: mismo agentDir del padre (PI_CODING_AGENT_DIR=~/.frida) + key del
//   SecretStorage via --api-key cuando el provider la requiere.
// - max_turns: el CLI no lo expone; MVP sin límite (Detener = SIGTERM).
// - steer remoto: requiere --mode rpc; MVP lo rechaza con nota honesta.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentConfig } from "./types";
import {
	resolveEmbeddedPiCli,
	spawnDetached,
	killProcessTree,
	processExists,
} from "./detached-spawn";
import {
	type DetachedRunMeta,
	logPathFor,
	nextRunId,
	readMeta,
	reconcileRuns,
	runDir,
	writeMeta,
	adoptOrphaned,
	listMetas,
} from "./detached-registry";
import { parseOutcome, readProgress } from "./detached-log";
import { mkdirSync } from "node:fs";

export interface DetachedSpawnOptions {
	prompt: string;
	description: string;
	config: AgentConfig;
	/** Modelo "provider/id" del padre (heredado si el agente no fija uno). */
	model?: string;
	thinking?: string;
	/** API key del provider activo (SecretStorage del host). */
	apiKey?: string;
	provider?: string;
	/** agentDir de Frida (~/.frida) — el child lo usa via env. */
	agentDir: string;
	cwd: string;
	/** Notifica al host (toast/notify del webview). */
	notify?: (msg: string) => void;
	/** Callback al finalizar el run (estado final ya persistido). */
	onSettled?: (meta: DetachedRunMeta) => void;
	/** Sólo tests: binario alternativo (p.ej. node -e). */
	_cliOverride?: string;
}

export interface DetachedSpawnHandle {
	id: string;
	pid: number;
	meta: DetachedRunMeta;
	/** Promise del exit code (tests / hosts que quieren esperar el child). */
	exit: Promise<number | null>;
}

/** Herramientas del agente que el child jamás debe tener (recursión). */
const SUBAGENT_TOOLS_EXCLUDE = "Agent,get_subagent_result,steer_subagent";

/**
 * Spawn un subagente detached. Registra el meta durable, lanza el proceso y
 * conecta el exit handler (mismo proceso). No espera el resultado.
 */
export function spawnDetachedAgent(
	opts: DetachedSpawnOptions,
): DetachedSpawnHandle {
	const cli =
		opts._cliOverride ??
		(() => {
			const c = resolveEmbeddedPiCli();
			if (!c) {
				throw new Error(
					"No se encontró el CLI de pi embebido en el VSIX (node_modules/@earendil-works/pi-coding-agent/dist/cli.js)",
				);
			}
			return c;
		})();

	const id = nextRunId();
	mkdirSync(runDir(id), { recursive: true });
	// Prompt a disco (auditable + el argv queda corto).
	writeFileSync(join(runDir(id), "prompt.txt"), opts.prompt, "utf8");

	const model = opts.config.model ?? opts.model;
	const thinking = opts.config.thinking ?? opts.thinking;

	// Allowlist del agente (builtinToolNames) o builtin completo.
	const allow = opts.config.builtinToolNames?.length
		? ["--tools", opts.config.builtinToolNames.join(",")]
		: [];

	const fileArgs = [
		cli,
		"-p",
		"--mode",
		"json",
		"--session-dir",
		join(opts.agentDir, "detached", "sessions"),
		"--session-id",
		id,
		"--no-extensions",
		"--no-skills",
		"--no-prompt-templates",
		"--no-themes",
		...(model ? ["--model", model] : []),
		...(thinking ? ["--thinking", thinking] : []),
		...allow,
		"--exclude-tools",
		SUBAGENT_TOOLS_EXCLUDE,
		// System prompt del agente custom (append al default del CLI).
		...(opts.config.promptMode === "replace" && opts.config.systemPrompt
			? ["--system-prompt", opts.config.systemPrompt]
			: opts.config.promptMode === "append" && opts.config.systemPrompt
				? ["--append-system-prompt", opts.config.systemPrompt]
				: []),
		...(opts.apiKey && opts.provider
			? ["--api-key", opts.apiKey, "--provider", opts.provider]
			: []),
		opts.prompt,
	];

	const env: Record<string, string> = {
		ELECTRON_RUN_AS_NODE: "1",
		PI_CODING_AGENT_DIR: opts.agentDir,
		PI_SKIP_VERSION_CHECK: "1",
		PI_OFFLINE: "1",
	};

	const { pid, exit } = spawnDetached({
		fileArgs,
		cwd: opts.cwd,
		logPath: logPathFor(id),
		env,
	});

	const meta: DetachedRunMeta = {
		id,
		name: opts.description,
		status: "running",
		pid,
		spawnPid: process.pid,
		model,
		thinking,
		cwd: opts.cwd,
		promptPreview: opts.prompt.slice(0, 200),
		startedAt: Date.now(),
		logPath: logPathFor(id),
		agentType: opts.config.name,
	};
	writeMeta(meta);

	// Exit handler (sólo vive este proceso): resultado + tokens + estado.
	void exit.then((code) => {
		const m = readMeta(id);
		if (!m) return;
		if (m.status === "killed") {
			// Detener explícito: el estado ya quedó persistido por stopRun.
			opts.onSettled?.(m);
			return;
		}
		const outcome = parseOutcome(m.logPath);
		m.exitCode = code;
		m.endedAt = Date.now();
		if (outcome) {
			m.status = "completed";
			m.result = outcome.result;
			m.tokensIn = outcome.tokensIn;
			m.tokensOut = outcome.tokensOut;
		} else {
			m.status = "failed";
			m.failureReason =
				code === 0
					? "terminó sin producir resultado (stream incompleto)"
					: `exit ${code}`;
		}
		writeMeta(m);
		opts.onSettled?.(m);
	});

	return { id, pid, meta, exit };
}

/** Detiene un run (SIGTERM al grupo). Persiste killed ANTES de matar. */
export function stopDetachedRun(id: string): boolean {
	const meta = readMeta(id);
	if (!meta) return false;
	if (meta.status === "running" || meta.status === "orphaned") {
		meta.status = "killed";
		meta.endedAt = Date.now();
		writeMeta(meta);
		killProcessTree(meta.pid, "SIGTERM");
		return true;
	}
	return false;
}

/** Estado en vivo de un run para el tool/panel: meta + tail del log. */
export function detachedSnapshot(id: string): {
	meta: DetachedRunMeta;
	turnCount: number;
	toolUses: number;
	tokensIn: number;
	tokensOut: number;
	activity: string;
	lastText: string;
	alive: boolean;
} | undefined {
	const meta = readMeta(id);
	if (!meta) return undefined;
	const running =
		meta.status === "running" ||
		meta.status === "orphaned" ||
		meta.status === "lost";
	if (!running) {
		return {
			meta,
			turnCount: 0,
			toolUses: 0,
			tokensIn: meta.tokensIn ?? 0,
			tokensOut: meta.tokensOut ?? 0,
			activity: meta.status,
			lastText: meta.result ?? "",
			alive: false,
		};
	}
	const p = readProgress(meta.logPath);
	return {
		meta,
		turnCount: p.turnCount,
		toolUses: p.toolUses,
		tokensIn: p.tokensIn,
		tokensOut: p.tokensOut,
		activity: p.activity,
		lastText: p.lastText,
		alive: processExists(meta.pid),
	};
}

/**
 * Arranque de sesión / apertura de panel: reconciliar disco vs procesos.
 * Los orphaned con child vivo se adoptan (vigilamos su exit desde aquí).
 */
export function bootDetached(
	onSettled?: (meta: DetachedRunMeta) => void,
): void {
	const { changed } = reconcileRuns();
	// Adoptar orphans vivos: montarles exit-poll (el child no es nuestro, no
	// hay exit handler — un interval corto observa la muerte y finaliza).
	for (const meta of listMetas()) {
		if (meta.status !== "orphaned") continue;
		if (!processExists(meta.pid)) continue;
		adoptOrphaned(meta);
		watchAdopted(meta.id, onSettled);
	}
	// Los changed "lost" con resultado en log lo recuperamos aquí.
	for (const m of changed) {
		if (m.status === "lost") {
			const outcome = parseOutcome(m.logPath);
			if (outcome) {
				m.status = "completed";
				m.result = outcome.result;
				m.tokensIn = outcome.tokensIn;
				m.tokensOut = outcome.tokensOut;
				writeMeta(m);
			}
			onSettled?.(m);
		}
	}
}

/** Vigila un run adoptado con poll barato (2s) hasta que el proceso muera. */
function watchAdopted(
	id: string,
	onSettled?: (meta: DetachedRunMeta) => void,
): void {
	const timer = setInterval(() => {
		const meta = readMeta(id);
		if (!meta) {
			clearInterval(timer);
			return;
		}
		if (meta.status !== "orphaned" && meta.status !== "running") {
			clearInterval(timer);
			return;
		}
		if (processExists(meta.pid)) return; // sigue vivo
		clearInterval(timer);
		// Murió bajo nuestra custodia: finalizar por log.
		const outcome = parseOutcome(meta.logPath);
		meta.endedAt = Date.now();
		if (outcome) {
			meta.status = "completed";
			meta.result = outcome.result;
			meta.tokensIn = outcome.tokensIn;
			meta.tokensOut = outcome.tokensOut;
		} else {
			meta.status = "failed";
			meta.failureReason = "proceso terminado sin resultado";
		}
		writeMeta(meta);
		onSettled?.(meta);
	}, 2_000);
	timer.unref?.();
}
