// frida-subagents — descubrimiento de agentes custom (.md).
//
// Porte de pi-subagents/src/custom-agents.ts (ADR-0022 Fase 1 / D8).
// Descubre perfiles .md de dos locations:
//   1. Proyecto:  <cwd>/.frida/agents/*.md (prioridad alta)
//   2. Global:    ~/.frida/global/agents/*.md (donde frida-pipeline sincroniza)
//
// No incluye .agents/agents/ (simplificación vs pi-subagents).

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import type { AgentConfig, PromptMode } from "./types";

/**
 * Parsea frontmatter de forma segura. Si parseFrontmatter del SDK falla
 * (YAML estricto con caracteres especiales), cae a un parser simple de
 * key:value que maneja los patrones más comunes.
 */
function safeParseFrontmatter(content: string): {
	frontmatter: Record<string, unknown>;
	body: string;
} {
	try {
		return parseFrontmatter<Record<string, unknown>>(content);
	} catch {
		// Fallback: parser simple para frontmatter YAML plano.
		const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
		if (!match) return { frontmatter: {}, body: content };
		const yaml = match[1];
		const body = match[2];
		const fm: Record<string, unknown> = {};
		for (const line of yaml.split("\n")) {
			const m = line.match(/^(\w[\w-]*):\s*(.*)$/);
			if (!m) continue;
			const key = m[1];
			let value: unknown = m[2];
			if (value === "true") value = true;
			else if (value === "false") value = false;
			else if (/^\d+$/.test(value as string))
				value = parseInt(value as string, 10);
			fm[key] = value;
		}
		return { frontmatter: fm, body };
	}
}

/**
 * Carga agentes custom desde .frida/agents/ (proyecto) y
 * ~/.frida/global/agents/ (global). Los del proyecto pisan a los globales
 * con el mismo nombre.
 */
export function loadCustomAgents(cwd: string): Map<string, AgentConfig> {
	const globalDir = join(homedir(), ".frida", "global", "agents");
	const projectDir = join(cwd, ".frida", "agents");

	const agents = new Map<string, AgentConfig>();

	// Global primero (prioridad baja).
	loadFromDir(globalDir, agents, "global");
	// Proyecto después (pisa al global).
	loadFromDir(projectDir, agents, "project");

	return agents;
}

/** Carga agentes .md de un directorio al mapa. */
function loadFromDir(
	dir: string,
	agents: Map<string, AgentConfig>,
	source: "project" | "global",
): void {
	if (!existsSync(dir)) return;

	let files: string[];
	try {
		files = readdirSync(dir).filter((f) => f.endsWith(".md"));
	} catch {
		return;
	}

	for (const file of files) {
		const name = basename(file, ".md");

		let content: string;
		try {
			content = readFileSync(join(dir, file), "utf-8");
		} catch {
			continue;
		}

		const { frontmatter: fm, body } = safeParseFrontmatter(content);

		const config: AgentConfig = {
			name,
			displayName: str(fm.display_name) ?? name,
			description: str(fm.description) ?? name,
			builtinToolNames: csvList(fm.tools),
			disallowedTools: csvListOptional(fm.disallowed_tools),
			model: str(fm.model),
			thinking: str(fm.thinking),
			maxTurns: nonNegativeInt(fm.max_turns),
			systemPrompt: body.trim(),
			promptMode: (fm.prompt_mode === "append"
				? "append"
				: "replace") as PromptMode,
			inheritContext: fm.inherit_context === true ? true : undefined,
			runInBackground: fm.run_in_background === true ? true : undefined,
			isolated: fm.isolated === true ? true : undefined,
			isolation: fm.isolation === "worktree" ? "worktree" : undefined,
			enabled: fm.enabled === false ? false : true,
			source,
		};

		agents.set(name, config);
	}
}

// ---------------------------------------------------------------------------
// Helpers de parseo
// ---------------------------------------------------------------------------

function str(v: unknown): string | undefined {
	return typeof v === "string" && v.length > 0 ? v : undefined;
}

function csvList(v: unknown): string[] | undefined {
	if (typeof v !== "string") return undefined;
	if (v === "*" || v === "all") return undefined; // all built-ins
	const parts = v
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
	return parts.length > 0 ? parts : undefined;
}

function csvListOptional(v: unknown): string[] | undefined {
	if (typeof v !== "string") return undefined;
	const parts = v
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
	return parts.length > 0 ? parts : undefined;
}

function nonNegativeInt(v: unknown): number | undefined {
	if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return undefined;
	return Math.floor(v);
}
