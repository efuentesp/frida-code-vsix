/**
 * frida-cc-plugins — conversores de componentes (issue #49, ADR-0057 D3-D5).
 *
 *  - Skills: copia a resources/skills/<plugin>/<skill>/ con el `name` del
 *    frontmatter REESCRITO a <plugin>-<skill> — manipulación de strings
 *    pura, sin eval YAML (mitigación de inyección de contenido no confiable,
 *    patrón pi-claude-marketplace). Elisión de prefijo: si el name ya empieza
 *    con "<plugin>-", no se duplica.
 *  - Commands: copia PLANA a resources/prompts/<plugin>-<cmd>.md — el loader
 *    de prompts de pi deriva el nombre del FILENAME (basename sin .md) y es
 *    no-recursivo. Hyphen y no ':' (frida soporta Windows; NTFS prohíbe ':').
 *  - MCP: sustitución de placeholders (${CLAUDE_PLUGIN_ROOT},
 *    ${CLAUDE_PROJECT_DIR}, ${user_config:*}) + merge al config global con
 *    registro de llaves por plugin (para uninstall limpio) — los nombres de
 *    server NO se renombran (rompería referencias por nombre; colisiones se
 *    chequean ANTES, ver installer).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { SkippedComponent } from "./readers";
import { resourcesPromptsDir, resourcesSkillsDir } from "./constants";

// ─── Frontmatter de skills (strings puros, sin YAML eval) ────────────────

/**
 * Reescribe el `name:` del frontmatter de un SKILL.md preservando el resto.
 * Sin frontmatter → se antepone uno con solo `name`. La única validación es
 * parse-read-only del resultado (el nombre escrito debe ser seguro).
 */
export function rewriteSkillFrontmatter(raw: string, newName: string): string {
	const lines = raw.split("\n");
	if (!raw.startsWith("---")) {
		return `---\nname: ${newName}\n---\n\n${raw}`;
	}
	const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
	if (end < 0) return `---\nname: ${newName}\n---\n\n${raw}`;
	for (let i = 1; i < end; i++) {
		if (/^name:\s*/.test(lines[i] ?? "")) {
			// Escalar inline: se reemplaza la línea completa (el nombre nuevo
			// es seguro: [a-z0-9-], sin continuaciones que preservar).
			lines[i] = `name: ${newName}`;
			return lines.join("\n");
		}
	}
	// Había frontmatter sin name: insertarlo como primera llave.
	lines.splice(1, 0, `name: ${newName}`);
	return lines.join("\n");
}

/** Nombre de invocación final de una skill: <plugin>-<skill> con elisión. */
export function namespacedSkillName(
	plugin: string,
	sourceName: string,
): string {
	const prefix = `${plugin}-`;
	const elided = sourceName.startsWith(prefix)
		? sourceName.slice(prefix.length)
		: sourceName;
	return `${plugin}-${elided}`;
}

/** Nombre de prompt final de un command: <plugin>-<cmd> con elisión. */
export function namespacedCommandName(
	plugin: string,
	commandFile: string,
): string {
	const source = path.basename(commandFile).replace(/\.md$/, "");
	return namespacedSkillName(plugin, source);
}

// ─── Skills + commands → resources/ ──────────────────────────────────────

export interface ConvertedResources {
	skills: string[];
	commands: string[];
	skipped: SkippedComponent[];
}

/** Convierte skills+commands de un plugin a resources/ (idempotente). */
export function convertPluginResources(
	agentDir: string,
	plugin: string,
	components: { skills: string[]; commands: string[] },
): ConvertedResources {
	const skillsDir = path.join(resourcesSkillsDir(agentDir), plugin);
	const promptsDir = resourcesPromptsDir(agentDir);
	fs.mkdirSync(skillsDir, { recursive: true });
	fs.mkdirSync(promptsDir, { recursive: true });

	const skills: string[] = [];
	const skipped: SkippedComponent[] = [];

	for (const skillRoot of components.skills) {
		const sourceName = path.basename(skillRoot);
		const newName = namespacedSkillName(plugin, sourceName);
		const dest = path.join(skillsDir, sourceName);
		try {
			fs.cpSync(skillRoot, dest, {
				recursive: true,
				force: true,
				// Scripts/references/assets de la skill viajan completos.
			});
			const skillMd = path.join(dest, "SKILL.md");
			if (fs.existsSync(skillMd)) {
				fs.writeFileSync(
					skillMd,
					rewriteSkillFrontmatter(fs.readFileSync(skillMd, "utf-8"), newName),
				);
			}
			skills.push(newName);
		} catch {
			skipped.push({
				kind: "commands-nested",
				path: path.basename(skillRoot),
				reason: `Skill ${sourceName}: falló la copia a resources/.`,
			});
		}
	}

	const commands: string[] = [];
	for (const cmdFile of components.commands) {
		const promptName = namespacedCommandName(plugin, cmdFile);
		const dest = path.join(promptsDir, `${promptName}.md`);
		try {
			fs.copyFileSync(cmdFile, dest);
			commands.push(promptName);
		} catch {
			skipped.push({
				kind: "commands-nested",
				path: path.basename(cmdFile),
				reason: `Command ${path.basename(cmdFile)}: falló la copia a resources/.`,
			});
		}
	}
	return { skills, commands, skipped };
}

/** Borra los recursos convertidos de un plugin (uninstall/disable). */
export function removePluginResources(agentDir: string, plugin: string): void {
	const skillsDir = path.join(resourcesSkillsDir(agentDir), plugin);
	if (fs.existsSync(skillsDir)) {
		fs.rmSync(skillsDir, { recursive: true, force: true });
	}
	const promptsDir = resourcesPromptsDir(agentDir);
	const prefix = `${plugin}-`;
	if (fs.existsSync(promptsDir)) {
		for (const f of fs.readdirSync(promptsDir)) {
			if (f.startsWith(prefix) && f.endsWith(".md")) {
				fs.rmSync(path.join(promptsDir, f), { force: true });
			}
		}
	}
}

// ─── MCP: placeholders + merge/unmerge ───────────────────────────────────

/** Sustituye placeholders Claude en todos los strings del server config. */
export function substituteMcpPlaceholders(
	value: unknown,
	ctx: {
		pluginRoot: string;
		projectDir: string;
		userConfig?: Record<string, string>;
	},
): unknown {
	if (typeof value === "string") {
		let out = value.replaceAll("${CLAUDE_PLUGIN_ROOT}", ctx.pluginRoot);
		out = out.replaceAll("${PLUGIN_ROOT}", ctx.pluginRoot);
		out = out.replaceAll("${CLAUDE_PROJECT_DIR}", ctx.projectDir);
		if (ctx.userConfig) {
			for (const [k, v] of Object.entries(ctx.userConfig)) {
				out = out.replaceAll(`\${user_config:${k}}`, v);
			}
		}
		return out;
	}
	if (Array.isArray(value)) {
		return value.map((v) => substituteMcpPlaceholders(v, ctx));
	}
	if (value !== null && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) {
			out[k] = substituteMcpPlaceholders(v, ctx);
		}
		return out;
	}
	return value;
}

/** Lee las llaves mcpServers existentes en un archivo de config MCP. */
export function existingMcpServerKeys(configPath: string): Set<string> {
	try {
		const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8"));
		const servers = parsed?.mcpServers;
		if (servers && typeof servers === "object") {
			return new Set(Object.keys(servers));
		}
	} catch {
		/* inexistente o inválido → sin llaves */
	}
	return new Set();
}

/**
 * Fusiona servers MCP del plugin al config global (~/.frida/mcp.json).
 * Devuelve las llaves escritas. Falla (con guía) si hay colisión: las llaves
 * deben estar libres en TODOS los slots — el caller ya lo verificó; aquí es
 * re-chequeo atómico contra el destino final.
 */
export function mergeMcpServers(
	configPath: string,
	servers: Record<string, unknown>,
): string[] {
	const keys = Object.keys(servers);
	if (keys.length === 0) return [];
	let config: { mcpServers?: Record<string, unknown> } = {};
	try {
		config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
	} catch {
		/* archivo nuevo */
	}
	config.mcpServers ??= {};
	const taken = existingMcpServerKeys(configPath);
	const clash = keys.find((k) => taken.has(k));
	if (clash) {
		throw new Error(
			`Conflicto de nombre MCP: '${clash}' ya existe en ${configPath}. ` +
				"Los servers de plugins conservan su nombre original (ADR-0057 D5); " +
				"renombra el existente o desinstala el plugin que lo declaró.",
		);
	}
	for (const [k, v] of Object.entries(servers)) {
		config.mcpServers[k] = v;
	}
	fs.mkdirSync(path.dirname(configPath), { recursive: true });
	fs.writeFileSync(configPath, JSON.stringify(config, null, "\t") + "\n");
	return keys;
}

/** Quita las llaves MCP de un plugin del config global (uninstall). */
export function unmergeMcpServers(configPath: string, keys: string[]): void {
	if (keys.length === 0 || !fs.existsSync(configPath)) return;
	try {
		const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
		const servers = config?.mcpServers;
		if (!servers || typeof servers !== "object") return;
		for (const k of keys) delete servers[k];
		fs.writeFileSync(configPath, JSON.stringify(config, null, "\t") + "\n");
	} catch {
		/* best-effort */
	}
}
