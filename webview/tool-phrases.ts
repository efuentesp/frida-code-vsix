import type { ToolEntry } from "./types";

/**
 * Frase descriptiva y metadatos de una herramienta para renderizado Copilot (.tool-flat).
 */
export interface ToolPhrase {
	/** Verbo activo con shimmer ("Leyendo", "Ejecutando") o en pasado ("Leyó", "Ejecutó") */
	verb: string;
	/** Argumento principal (ruta de archivo, comando, consulta, símbolo) */
	arg?: string;
	/** Subtítulo de métrica o detalle ("84 líneas", "exit 0", "12 coincidencias") */
	detail?: string;
	/** true si `arg` es una ruta de archivo clicable (ancla textLink) */
	isAnchor?: boolean;
	/** Nombre del glifo en @vscode/codicons */
	iconName: string;
}

/** Formatea una duración en ms a algo legible (318 ms · 4.2s). */
export function fmtDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return "";
	if (ms < 1000) return `${Math.round(ms)} ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

/** Cuenta líneas leídas en el resultado de `read`. */
function countLines(result?: string): number {
	if (!result) return 0;
	return result.trimEnd().split("\n").length;
}

/** Cuenta cambios (+ / -) en un diff unificado. */
function diffStats(diff?: string): string | undefined {
	if (!diff) return undefined;
	let add = 0;
	let del = 0;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+++") || line.startsWith("---")) continue;
		if (line.startsWith("+")) add++;
		else if (line.startsWith("-")) del++;
	}
	if (add === 0 && del === 0) return undefined;
	if (add > 0 && del > 0) return `+${add} -${del}`;
	return add > 0 ? `+${add}` : `-${del}`;
}

/**
 * Genera la frase estandarizada estilo Copilot según el tool y su estado.
 */
export function getToolPhrase(entry: ToolEntry): ToolPhrase {
	const tool = entry.tool;
	const args = (entry.args as Record<string, unknown>) ?? {};
	const running = entry.state === "running";
	const isError = entry.state === "error";

	// 1. Archivos (read, write, edit)
	if (tool === "read") {
		const path = String(args.path ?? "");
		const lines = countLines(entry.result);
		return {
			verb: running ? "Leyendo" : isError ? "Falló al leer" : "Leyó",
			arg: path || undefined,
			detail: !running && !isError && lines > 0 ? `${lines} líneas` : undefined,
			isAnchor: true,
			iconName: "file-text",
		};
	}

	if (tool === "write") {
		const path = String(args.path ?? "");
		const lines = countLines(String(args.content ?? ""));
		return {
			verb: running ? "Escribiendo" : isError ? "Falló al escribir" : "Escribió",
			arg: path || undefined,
			detail: !running && !isError && lines > 0 ? `${lines} líneas` : undefined,
			isAnchor: true,
			iconName: "file-code",
		};
	}

	if (tool === "edit") {
		const path = String(args.path ?? "");
		const stats = diffStats(entry.diff);
		return {
			verb: running ? "Editando" : isError ? "Falló al editar" : "Editó",
			arg: path || undefined,
			detail: !running && !isError ? stats : undefined,
			isAnchor: true,
			iconName: "edit",
		};
	}

	// 2. Terminal y Shell (bash)
	if (tool === "bash") {
		const cmd = String(args.command ?? "");
		const shortCmd = cmd.length > 50 ? `${cmd.slice(0, 47)}…` : cmd;
		let detail: string | undefined;
		if (!running) {
			const dur =
				entry.endedAt && entry.startedAt
					? fmtDuration(entry.endedAt - entry.startedAt)
					: "";
			detail = isError ? "exit 1" : dur ? `exit 0 (${dur})` : "exit 0";
		}
		return {
			verb: running ? "Ejecutando" : isError ? "Falló" : "Ejecutó",
			arg: shortCmd || undefined,
			detail,
			iconName: "terminal",
		};
	}

	// 3. Búsqueda (ffgrep, grep, fffind, find, ls)
	if (tool === "ffgrep" || tool === "grep") {
		const pattern = String(args.pattern ?? "");
		const resLines = entry.result
			? entry.result.trim().split("\n").filter(Boolean).length
			: 0;
		return {
			verb: running ? "Buscando texto" : isError ? "Error en búsqueda" : "Buscó",
			arg: pattern ? `"${pattern}"` : undefined,
			detail:
				!running && !isError
					? `${resLines} coincidencia${resLines === 1 ? "" : "s"}`
					: undefined,
			iconName: "search",
		};
	}

	if (tool === "fffind" || tool === "find" || tool === "ls") {
		const pat = String(args.pattern ?? args.path ?? "");
		const resCount = entry.result
			? entry.result.trim().split("\n").filter(Boolean).length
			: 0;
		return {
			verb: running
				? "Buscando archivos"
				: isError
					? "Error al buscar"
					: "Encontró",
			arg: pat || undefined,
			detail:
				!running && !isError
					? `${resCount} archivo${resCount === 1 ? "" : "s"}`
					: undefined,
			iconName: "file-submodule",
		};
	}

	// 4. Diagnósticos e Inspección AST (lens_diagnostics, lsp_diagnostics, ast_grep)
	if (tool === "lens_diagnostics" || tool === "lsp_diagnostics") {
		return {
			verb: running
				? "Comprobando diagnósticos"
				: isError
					? "Error de diagnóstico"
					: "Diagnosticó",
			detail:
				!running && !isError
					? entry.result
						? "completado"
						: "0 problemas"
					: undefined,
			iconName: "pulse",
		};
	}

	if (tool.startsWith("ast_grep") || tool === "lsp_navigation") {
		return {
			verb: running
				? "Inspeccionando AST"
				: isError
					? "Error en AST"
					: "Inspeccionó AST",
			iconName: "code",
		};
	}

	// 5. Símbolos y Navegación (symbol_search, module_report, read_symbol, read_enclosing)
	if (
		tool === "symbol_search" ||
		tool === "module_report" ||
		tool === "read_symbol" ||
		tool === "read_enclosing" ||
		tool === "project_report"
	) {
		const sym = String(
			args.symbol ?? args.query ?? args.path ?? args.focus ?? "",
		);
		return {
			verb: running
				? "Analizando código"
				: isError
					? "Error en análisis"
					: "Analizó",
			arg: sym ? `"${sym}"` : undefined,
			iconName: "symbol-class",
		};
	}

	// 6. Subagentes (Agent, get_subagent_result, steer_subagent, subagent_gate)
	if (tool === "Agent") {
		const type = String(args.subagent_type ?? "agente");
		const desc = String(args.description ?? "");
		const dur =
			entry.endedAt && entry.startedAt
				? fmtDuration(entry.endedAt - entry.startedAt)
				: "";
		return {
			verb: running
				? "Lanzando sub-agente"
				: isError
					? "Sub-agente falló"
					: "Sub-agente completó",
			arg: desc ? `[${type}] ${desc}` : `[${type}]`,
			detail: !running && !isError && dur ? dur : undefined,
			iconName: "hubot",
		};
	}

	if (
		tool === "get_subagent_result" ||
		tool === "steer_subagent" ||
		tool === "subagent_gate"
	) {
		return {
			verb: running ? "Coordinando subagentes" : "Subagentes coordinados",
			iconName: "organization",
		};
	}

	// 7. Workflows
	if (tool === "workflow" || tool.startsWith("workflow_")) {
		const wfName = String(args.name ?? "workflow");
		return {
			verb: running
				? "Ejecutando workflow"
				: isError
					? "Workflow falló"
					: "Workflow finalizado",
			arg: wfName ? `"${wfName}"` : undefined,
			iconName: "play-circle",
		};
	}

	// 8. Tareas y Preguntas (todo, ask_user_question, context)
	if (tool === "todo") {
		const action = String(args.action ?? "update");
		return {
			verb: running ? "Actualizando tareas" : "Tareas actualizadas",
			detail: running ? undefined : `(${action})`,
			iconName: "checklist",
		};
	}

	if (tool === "ask_user_question") {
		return {
			verb: running ? "Preguntando al usuario" : "Pregunta respondida",
			iconName: "question",
		};
	}

	if (tool === "context" || tool === "workspace_session_summaries") {
		return {
			verb: running ? "Sincronizando contexto" : "Contexto sincronizado",
			iconName: "graph",
		};
	}

	// 9. Web y Docs (agent_browser, web_search, web_fetch, web_docs_*)
	if (tool === "agent_browser") {
		return {
			verb: running ? "Navegando" : isError ? "Navegación fallida" : "Navegó",
			iconName: "globe",
		};
	}

	if (tool.startsWith("web_search") || tool.startsWith("web_fetch")) {
		const q = String(args.query ?? args.url ?? "");
		const shortQ = q.length > 40 ? `${q.slice(0, 37)}…` : q;
		return {
			verb: running
				? "Buscando en la web"
				: isError
					? "Búsqueda fallida"
					: "Búsqueda web",
			arg: shortQ || undefined,
			iconName: "search",
		};
	}

	if (tool.startsWith("web_docs")) {
		const lib = String(args.library_name ?? args.library_id ?? "docs");
		return {
			verb: running
				? "Consultando docs"
				: isError
					? "Error en docs"
					: "Docs consultados",
			arg: lib,
			iconName: "book",
		};
	}

	// 10. Extensibilidad y MCP (mcp, mcpScript, read_skills, wiki_*)
	if (tool === "mcp" || tool === "mcpScript") {
		const name = String(args.tool ?? args.server ?? "mcp");
		return {
			verb: running ? "Llamando MCP" : isError ? "Error en MCP" : "MCP respondió",
			arg: name,
			iconName: "plug",
		};
	}

	if (tool === "read_skills" || tool.startsWith("wiki_")) {
		const name = String(args.name ?? args.query ?? "");
		return {
			verb: running ? "Cargando conocimiento" : "Conocimiento cargado",
			arg: name || undefined,
			iconName: "mortar-board",
		};
	}

	// Fallback genérico para herramientas personalizadas o de terceros
	return {
		verb: running
			? `Ejecutando ${tool}`
			: isError
				? `Falló ${tool}`
				: `Ejecutó ${tool}`,
		iconName: "tools",
	};
}
