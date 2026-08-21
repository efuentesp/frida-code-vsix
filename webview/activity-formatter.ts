// webview/activity-formatter.ts — Formateador de actividad de alto valor estilo Copilot Chat

import type { Turn, ToolEntry, RetryState } from "./types";

export interface ActivityView {
	icon: string;
	spin: boolean;
	verb: string;
	target?: string;
	parentDir?: string;
	kind:
		| "thinking"
		| "tool"
		| "bash"
		| "subagent"
		| "compacting"
		| "retry"
		| "default";
	canCancel?: boolean;
}

/** Formatea una ruta destacando el basename y la carpeta padre de forma compacta */
export function formatPathTarget(filePath: string): {
	file: string;
	parent?: string;
} {
	if (!filePath) return { file: "" };
	const normalized = filePath.replace(/\\/g, "/");
	const parts = normalized.split("/").filter(Boolean);
	if (parts.length <= 1) {
		return { file: parts[0] || filePath };
	}
	const file = parts[parts.length - 1];
	const parent = parts
		.slice(Math.max(0, parts.length - 3), parts.length - 1)
		.join("/");
	return { file, parent: parent ? `(${parent})` : undefined };
}

/**
 * Deriva el estado de actividad de alto valor y legible para la barra superior del Composer.
 */
export function formatCurrentActivity(
	turn: Turn | undefined,
	isBusy: boolean,
	isCompacting: boolean,
	compactReason?: string,
	retry?: RetryState | null,
	bgCount?: number,
	retryCountdownSecs?: number | null,
): ActivityView | null {
	// 1. Reintento de red / conexión
	if (retry) {
		const secs = retryCountdownSecs ?? Math.ceil(retry.delayMs / 1000);
		return {
			icon: "sync",
			spin: true,
			verb: "Reintentando conexión",
			target: `(intento ${retry.attempt}/${retry.maxAttempts}, en ${secs}s)`,
			kind: "retry",
		};
	}

	// 2. Compactación de contexto
	if (isCompacting) {
		return {
			icon: "database",
			spin: true,
			verb: "Compactando contexto",
			target:
				compactReason && compactReason !== "manual" ? "(automática)" : undefined,
			kind: "compacting",
			canCancel: true,
		};
	}

	// 3. Subagentes en background cuando el agente principal no está busy
	if (!isBusy) {
		if (bgCount && bgCount > 0) {
			return {
				icon: "hubot",
				spin: false,
				verb: "Subagentes activos",
				target: `${bgCount} en segundo plano`,
				kind: "subagent",
			};
		}
		return null;
	}

	if (!turn) {
		return {
			icon: "loading",
			spin: true,
			verb: "Procesando…",
			kind: "default",
		};
	}

	// 4. Terminal / comando bash
	if (turn.bash?.status === "running") {
		const cmd = turn.bash.command.trim();
		const shortCmd = cmd.length > 35 ? cmd.slice(0, 34) + "…" : cmd;
		return {
			icon: "terminal",
			spin: false,
			verb: "Ejecutando en terminal",
			target: shortCmd,
			kind: "bash",
		};
	}

	// 5. Herramienta activa
	const runningTool =
		turn.segments.find(
			(s): s is { kind: "tool" } & ToolEntry =>
				s.kind === "tool" && s.state === "running",
		) ??
		(turn.executingTool
			? {
					tool: turn.executingTool,
					state: "running" as const,
					startedAt: Date.now(),
					args: {},
				}
			: undefined);

	if (runningTool || turn.status === "executing") {
		const tool = runningTool?.tool || turn.executingTool || "herramienta";
		const args = (runningTool?.args as Record<string, unknown>) || {};

		// Lectura de archivo
		if (tool === "read" || tool === "read_symbol" || tool === "read_enclosing") {
			const path = String(args.path || "");
			const { file, parent } = formatPathTarget(path);
			return {
				icon: "file-text",
				spin: false,
				verb: "Leyendo",
				target: file || "archivo",
				parentDir: parent,
				kind: "tool",
			};
		}

		// Edición de archivo
		if (tool === "edit") {
			const path = String(args.path || "");
			const { file, parent } = formatPathTarget(path);
			return {
				icon: "edit",
				spin: false,
				verb: "Editando",
				target: file || "archivo",
				parentDir: parent,
				kind: "tool",
			};
		}

		// Escritura / creación de archivo
		if (tool === "write") {
			const path = String(args.path || "");
			const { file, parent } = formatPathTarget(path);
			return {
				icon: "file-code",
				spin: false,
				verb: "Escribiendo",
				target: file || "archivo",
				parentDir: parent,
				kind: "tool",
			};
		}

		// Búsqueda de texto / símbolos
		if (tool === "ffgrep" || tool === "grep" || tool === "symbol_search") {
			const query = String(args.pattern || args.query || "");
			const shortQ =
				query.length > 25
					? `"${query.slice(0, 24)}…"`
					: query
						? `"${query}"`
						: "en el proyecto";
			return {
				icon: "search",
				spin: false,
				verb: "Buscando",
				target: shortQ,
				kind: "tool",
			};
		}

		// Búsqueda de archivos
		if (tool === "fffind" || tool === "find" || tool === "ls") {
			const pattern = String(args.pattern || args.path || "");
			return {
				icon: "list-tree",
				spin: false,
				verb: "Explorando archivos",
				target: pattern ? `(${pattern})` : undefined,
				kind: "tool",
			};
		}

		// Diagnósticos de TypeScript / LSP / Lens
		if (tool === "lsp_diagnostics" || tool === "lens_diagnostics") {
			return {
				icon: "checklist",
				spin: false,
				verb: "Verificando diagnósticos de código",
				kind: "tool",
			};
		}

		// Subagentes
		if (tool === "Agent" || tool === "subagent_gate") {
			const desc = String(args.description || args.subagent_type || "subagente");
			return {
				icon: "hubot",
				spin: false,
				verb: "Subagente en ejecución",
				target: desc,
				kind: "subagent",
			};
		}

		// Workflows
		if (tool.startsWith("workflow")) {
			const name = String(args.name || "workflow");
			return {
				icon: "dashboard",
				spin: false,
				verb: "Ejecutando workflow",
				target: name,
				kind: "tool",
			};
		}

		// Navegación Web / Browser
		if (
			tool === "agent_browser" ||
			tool === "web_search" ||
			tool === "web_fetch"
		) {
			const q = String(args.query || args.url || "");
			return {
				icon: "globe",
				spin: false,
				verb: "Consultando información web",
				target: q ? `(${q.slice(0, 30)})` : undefined,
				kind: "tool",
			};
		}

		// Tool genérica
		return {
			icon: "tools",
			spin: false,
			verb: `Ejecutando ${tool}`,
			kind: "tool",
		};
	}

	// 6. Razonamiento / Pensamiento
	if (
		turn.status === "thinking" ||
		turn.segments.some((s) => s.kind === "thinking")
	) {
		return {
			icon: "sparkle",
			spin: false,
			verb: "Razonando la respuesta…",
			kind: "thinking",
		};
	}

	// 7. Fallback activo
	return {
		icon: "loading",
		spin: true,
		verb: "Generando respuesta…",
		kind: "default",
	};
}
