/**
 * frida-cc-plugins — readers de formato Claude Code (issue #49, ADR-0057).
 *
 * Parsing PURO de los formatos de Claude Code (nunca ejecutan nada — el
 * diseño sigue a @nklisch/pi-plugins, MIT, dist/formats/claude/*-reader):
 *
 *  - .claude-plugin/plugin.json   (manifiesto del plugin)
 *  - .claude-plugin/marketplace.json (catálogo del marketplace)
 *  - .mcp.json / hooks/hooks.json (se leen como JSON, ejecución es otra capa)
 *
 * Reglas de validación adaptadas de los readers upstream: paths relativos
 * del catálogo exigidos "./", sin backslashes/null/traversal ("..", ".",
 * segmentos vacíos); sources github con repo válido; degradación suave
 * (componente no soportado se REPORTA, no bloquea el install — D6).
 */
import * as fs from "node:fs";
import * as path from "node:path";

// ─── Tipos de dominio ────────────────────────────────────────────────────

/** Manifiesto .claude-plugin/plugin.json (campos relevantes para frida). */
export interface ClaudePluginManifest {
	name: string;
	description?: string;
	version?: string;
	/** ¿Declara componentes? (detección de conflicto strict:false). */
	hasComponents?: boolean;
	author?: string | { name?: string };
	/** Declaración de raíces de skills (rutas relativas al root del plugin). */
	skills?: string | string[];
	/** Declaración de rutas de commands (legacy: directorio commands/). */
	commands?: string | string[];
	/** Declaración inline o ruta de servers MCP (.mcp.json por convención). */
	mcpServers?: Record<string, unknown>;
	/** Hooks inline (hooks/hooks.json por convención). */
	hooks?: unknown;
}

/** Entrada de plugin en marketplace.json. */
export interface MarketplacePluginEntry {
	name: string;
	source: PluginSource;
	description?: string;
	version?: string;
	/** Declaraciones de componentes en el catálogo (autoridad si strict:false). */
	strict?: boolean;
	/** Nombre legible para UI (no usado en namespacing/lookup). */
	displayName?: string;
	/** Metadata de descubrimiento (fase autor #51 — informativa). */
	category?: string;
	tags?: string[];
	/** Declaraciones de componentes en la entrada (autoridad si strict:false). */
	skills?: string | string[];
	commands?: string | string[];
	agents?: string | string[];
	hooks?: unknown;
	mcpServers?: Record<string, unknown>;
	[k: string]: unknown;
}

/** Map renames del catálogo: viejo → nuevo (o null = eliminado). */
export type RenameMap = Record<string, string | null>;

/** Source de un plugin (formas del catálogo Claude). */
export type PluginSource =
	| { kind: "path"; path: string }
	| { kind: "github"; repo: string; ref?: string; sha?: string }
	| { kind: "url"; url: string; ref?: string; sha?: string }
	| { kind: "git-subdir"; url: string; path: string; ref?: string; sha?: string }
	| { kind: "npm"; package: string; version?: string; registry?: string }
	| { kind: "archive"; url: string; sha256?: string };

/** Catálogo .claude-plugin/marketplace.json. */
export interface MarketplaceCatalog {
	name: string;
	owner?: string;
	/** Base dir prepended a sources relativos (fase autor #51). */
	pluginRoot?: string;
	/** Map de renombrados/eliminados para migración (fase autor #51). */
	renames?: RenameMap;
	plugins: MarketplacePluginEntry[];
}

/** Componentes descubiertos en un plugin instalado (con veredicto). */
export interface PluginComponents {
	/** skills/<s>/SKILL.md — rutas absolutas de las skills convertibles. */
	skills: string[];
	/** commands/<c>.md planos — rutas absolutas convertibles como prompts. */
	commands: string[];
	/** Servers MCP declarados (inline del manifiesto o parseados de .mcp.json). */
	mcpServers: Record<string, unknown>;
	/** Componentes presentes pero NO soportados en el MVP (degradación D6). */
	skipped: SkippedComponent[];
}

export interface SkippedComponent {
	kind:
		| "agents"
		| "hooks"
		| "lsp"
		| "monitors"
		| "bin"
		| "settings"
		| "commands-nested";
	/** Path relativo al root del plugin o descripción. */
	path: string;
	reason: string;
}

/** Error de lectura con guía accionable (D6). */
export class ReaderError extends Error {
	readonly guide: string;
	constructor(message: string, guide: string) {
		super(message);
		this.name = "ReaderError";
		this.guide = guide;
	}
}

// ─── Validación de paths y nombres (reglas upstream) ────────────────────

/** Path relativo de catálogo: "./x", sin \, sin null, sin traversal. */
export function validateCatalogRelativePath(p: string): string {
	if (
		typeof p !== "string" ||
		p.length < 3 ||
		!p.startsWith("./") ||
		p === "./" ||
		p.includes("\\") ||
		p.includes("\0") ||
		/^[A-Za-z]:/.test(p.slice(2))
	) {
		throw new ReaderError(
			`Path relativo de catálogo inválido: ${JSON.stringify(p)}`,
			"Los paths de plugins en marketplace.json deben ser relativos con prefijo './' (p. ej. './mi-plugin'), sin '..' ni backslashes.",
		);
	}
	const segments = p.slice(2).split("/");
	if (segments.some((s) => s.length === 0 || s === "." || s === "..")) {
		throw new ReaderError(
			`Path relativo de catálogo inválido: ${JSON.stringify(p)}`,
			"Los segmentos del path no pueden ser vacíos, '.' ni '..'.",
		);
	}
	return p;
}

/** repo GitHub "owner/name". */
export function validateGithubRepo(repo: string): string {
	if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
		throw new ReaderError(
			`repo GitHub inválido: ${JSON.stringify(repo)}`,
			"El campo 'repo' debe tener la forma 'owner/name' (p. ej. 'anthropics/claude-plugins-official').",
		);
	}
	return repo;
}

/** Nombre de plugin/invocación seguro (compatible cross-platform). */
export function assertSafeName(name: string, what: string): string {
	if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
		throw new ReaderError(
			`Nombre ${what} inválido: ${JSON.stringify(name)}`,
			`El nombre debe ser minúsculas a-z, 0-9 y guiones (no puede empezar con '-'): ${JSON.stringify(name)}.`,
		);
	}
	return name;
}

// ─── plugin.json ─────────────────────────────────────────────────────────

/** Lee y valida .claude-plugin/plugin.json (o null si no existe). */
export function readPluginManifest(
	pluginRoot: string,
): ClaudePluginManifest | null {
	const manifestPath = path.join(pluginRoot, ".claude-plugin", "plugin.json");
	if (!fs.existsSync(manifestPath)) return null;
	let raw: unknown;
	try {
		raw = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
	} catch (e: any) {
		throw new ReaderError(
			`plugin.json no es JSON válido: ${e?.message ?? e}`,
			`Revisa la sintaxis de ${manifestPath}.`,
		);
	}
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		throw new ReaderError(
			"plugin.json debe ser un objeto JSON",
			`Revisa la estructura de ${manifestPath}.`,
		);
	}
	const m = raw as Record<string, unknown>;
	const name = typeof m.name === "string" ? m.name : undefined;
	if (!name) {
		throw new ReaderError(
			"plugin.json sin campo 'name'",
			`El manifiesto requiere 'name' (namespace del plugin): ${manifestPath}.`,
		);
	}
	assertSafeName(name, "de plugin (plugin.json)");
	// Conflicto strict:false SOLO si el JSON declara componentes — los dirs
	// por convención no cuentan (Claude: "a plugin.json that declares
	// components"); con strict:false la entrada define rutas explícitas.
	const hasComponents =
		m.skills !== undefined ||
		m.commands !== undefined ||
		m.mcpServers !== undefined ||
		m.hooks !== undefined ||
		m.agents !== undefined ||
		m.lspServers !== undefined ||
		m.monitors !== undefined;
	return {
		name,
		hasComponents,
		description: typeof m.description === "string" ? m.description : undefined,
		version: typeof m.version === "string" ? m.version : undefined,
		author: m.author as ClaudePluginManifest["author"],
		skills: m.skills as string | string[] | undefined,
		commands: m.commands as string | string[] | undefined,
		mcpServers:
			m.mcpServers && typeof m.mcpServers === "object"
				? (m.mcpServers as Record<string, unknown>)
				: undefined,
		hooks: m.hooks,
	};
}

// ─── marketplace.json ────────────────────────────────────────────────────

/**
 * Parsea el source de una entrada del catálogo (formas Claude). Con
 * `pluginRoot` declarado, un string SIN "./" se resuelve contra él
 * (paridad metadata.pluginRoot: "formatter" ≡ "./plugins/formatter").
 */
function parseEntrySource(
	entry: Record<string, unknown>,
	pluginRoot?: string,
): PluginSource | null {
	const raw = entry.source;
	// Path relativo al marketplace: "./dir" (forma más común).
	if (typeof raw === "string") {
		if (raw.startsWith("./")) {
			return { kind: "path", path: validateCatalogRelativePath(raw) };
		}
		if (pluginRoot) {
			// pluginRoot llega como "./plugins" o "plugins" — normalizar el
			// prefijo para no producir "././x".
			const root = pluginRoot.replace(/^\.\//, "");
			return {
				kind: "path",
				path: validateCatalogRelativePath(`./${root}/${raw}`),
			};
		}
		return null; // sin pluginRoot exige "./" (omisión estructural)
	}
	if (raw === null || typeof raw !== "object") return null;
	const s = raw as Record<string, unknown>;
	switch (s.source) {
		case "github":
			return {
				kind: "github",
				repo: validateGithubRepo(String(s.repo)),
				ref: typeof s.ref === "string" ? s.ref : undefined,
				sha: typeof s.sha === "string" ? s.sha : undefined,
			};
		case "url":
		case "git": {
			const url = String(s.url);
			if (!/^https:\/\//.test(url)) {
				throw new ReaderError(
					`source.url debe ser HTTPS: ${JSON.stringify(url)}`,
					"Solo se aceptan URLs https:// para sources git de plugins.",
				);
			}
			if (typeof s.path === "string") {
				return {
					kind: "git-subdir",
					url,
					path: s.path.replace(/^\.\//, ""),
					ref: typeof s.ref === "string" ? s.ref : undefined,
					sha: typeof s.sha === "string" ? s.sha : undefined,
				};
			}
			return {
				kind: "url",
				url,
				ref: typeof s.ref === "string" ? s.ref : undefined,
				sha: typeof s.sha === "string" ? s.sha : undefined,
			};
		}
		case "npm": {
			const pkg = String(s.package ?? "");
			if (!/^[A-Za-z0-9@/._-]+$/.test(pkg)) {
				throw new ReaderError(
					`source.package npm inválido: ${JSON.stringify(pkg)}`,
					"El campo 'package' debe ser un nombre npm (scoped permitido: @org/pkg).",
				);
			}
			const registry =
				typeof s.registry === "string" ? String(s.registry) : undefined;
			if (registry && !/^https:\/\//.test(registry)) {
				throw new ReaderError(
					`source.registry debe ser HTTPS: ${JSON.stringify(registry)}`,
					"Solo se aceptan registries npm https:// (sin credenciales embebidas).",
				);
			}
			return {
				kind: "npm",
				package: pkg,
				version: typeof s.version === "string" ? s.version : undefined,
				registry,
			};
		}
		case "archive": {
			const url = String(s.url ?? "");
			if (!/^https:\/\//.test(url)) {
				throw new ReaderError(
					`source.url de archive debe ser HTTPS: ${JSON.stringify(url)}`,
					"Los zips de plugins solo se descargan por https://.",
				);
			}
			const sha256 =
				typeof s.sha256 === "string" ? s.sha256.toLowerCase() : undefined;
			if (sha256 && !/^[0-9a-f]{64}$/.test(sha256)) {
				throw new ReaderError(
					`source.sha256 inválido (se esperaban 64 hex): ${JSON.stringify(s.sha256)}`,
					"El digest sha256 del zip son 64 caracteres hexadecimales.",
				);
			}
			return { kind: "archive", url, sha256 };
		}
		default:
			return null;
	}
}

/** Lee y valida .claude-plugin/marketplace.json de un clone. */
export function readMarketplaceCatalog(
	marketplaceRoot: string,
): MarketplaceCatalog {
	const catPath = path.join(
		marketplaceRoot,
		".claude-plugin",
		"marketplace.json",
	);
	if (!fs.existsSync(catPath)) {
		throw new ReaderError(
			`No existe ${path.join(".claude-plugin", "marketplace.json")}`,
			`El repo debe contener .claude-plugin/marketplace.json (convención Claude). Buscado: ${catPath}.`,
		);
	}
	let raw: unknown;
	try {
		raw = JSON.parse(fs.readFileSync(catPath, "utf-8"));
	} catch (e: any) {
		throw new ReaderError(
			`marketplace.json no es JSON válido: ${e?.message ?? e}`,
			`Revisa la sintaxis de ${catPath}.`,
		);
	}
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		throw new ReaderError(
			"marketplace.json debe ser un objeto JSON",
			`Revisa la estructura de ${catPath}.`,
		);
	}
	const c = raw as Record<string, unknown>;
	const name = typeof c.name === "string" ? c.name : undefined;
	if (!name) {
		throw new ReaderError(
			"marketplace.json sin campo 'name'",
			"El catálogo requiere 'name' (identidad autoritativa del marketplace).",
		);
	}
	// owner: objeto {name, email?, url?} (schema Claude) o string legacy.
	const owner = (() => {
		if (typeof c.owner === "string") return c.owner;
		if (c.owner && typeof c.owner === "object" && !Array.isArray(c.owner)) {
			const o = c.owner as Record<string, unknown>;
			return typeof o.name === "string" ? o.name : undefined;
		}
		return undefined;
	})();
	// metadata.pluginRoot + renames (fase autor #51).
	const metadata = (c.metadata ?? {}) as Record<string, unknown>;
	const pluginRoot =
		typeof metadata.pluginRoot === "string" ? metadata.pluginRoot : undefined;
	const renames =
		c.renames && typeof c.renames === "object" && !Array.isArray(c.renames)
			? (c.renames as RenameMap)
			: undefined;

	const plugins: MarketplacePluginEntry[] = [];
	const seen = new Set<string>();
	const rawPlugins = Array.isArray(c.plugins) ? c.plugins : [];
	for (const p of rawPlugins) {
		if (p === null || typeof p !== "object" || Array.isArray(p)) continue;
		const e = p as Record<string, unknown>;
		const pname = typeof e.name === "string" ? e.name : undefined;
		// Problemas ESTRUCTURALES (no objeto, sin name, source de tipo
		// desconocido) se omiten y los siblings sobreviven (degradación suave
		// upstream). Los errores de VALIDACIÓN (nombre inseguro, path con
		// traversal, URL no-https, repo inválido) se propagan loud: esconder
		// una declaración insegura tras una omisión silenciosa es peor.
		if (!pname) continue;
		assertSafeName(pname, "de plugin (marketplace.json)");
		const source = parseEntrySource(e, pluginRoot);
		if (!source) continue;
		if (seen.has(pname)) {
			throw new ReaderError(
				`Nombre de plugin duplicado en el catálogo: '${pname}'`,
				"Cada entrada de plugins[] requiere un 'name' único (claude plugin validate lo reporta igual).",
			);
		}
		seen.add(pname);
		plugins.push({
			name: pname,
			source,
			description: typeof e.description === "string" ? e.description : undefined,
			version: typeof e.version === "string" ? e.version : undefined,
			// undefined = default true; false = la entrada es la definición
			// completa. NO normalizar a false (es load-bearing en
			// discoverComponents desde #51: undefined ≠ false).
			strict: typeof e.strict === "boolean" ? e.strict : undefined,
			displayName: typeof e.displayName === "string" ? e.displayName : undefined,
			category: typeof e.category === "string" ? e.category : undefined,
			tags: Array.isArray(e.tags)
				? e.tags.filter((t): t is string => typeof t === "string")
				: undefined,
			skills: e.skills as string | string[] | undefined,
			commands: e.commands as string | string[] | undefined,
			agents: e.agents as string | string[] | undefined,
			hooks: e.hooks,
			mcpServers:
				e.mcpServers && typeof e.mcpServers === "object"
					? (e.mcpServers as Record<string, unknown>)
					: undefined,
		});
	}
	return { name, owner, pluginRoot, renames, plugins };
}

// ─── Descubrimiento de componentes en un plugin ─────────────────────────

/** Normaliza a array las declaraciones de rutas del manifiesto. */
function asArray(v: string | string[] | undefined): string[] {
	if (v === undefined) return [];
	return Array.isArray(v) ? v : [v];
}

/**
 * Descubre componentes convertibles y no soportados en el root del plugin.
 * `entry` (entrada del catálogo) habilita strict:false: la ENTRADA es la
 * definición completa — plugin.json opcional; si existe declarando
 * componentes → conflicto loud (paridad Claude). Con strict:true (default),
 * plugin.json es la autoridad y la entrada puede complementar paths.
 */
export function discoverComponents(
	pluginRoot: string,
	entry?: MarketplacePluginEntry,
): PluginComponents {
	const strict = entry?.strict !== false; // default true
	const manifest = readPluginManifest(pluginRoot);
	if (!strict && manifest?.hasComponents) {
		throw new ReaderError(
			`strict:false con plugin.json que declara componentes (${pluginRoot})`,
			"Con strict:false la entrada del catálogo es la definición completa: quita los componentes de plugin.json o elimina el archivo (paridad Claude: conflicto).",
		);
	}
	const skills: string[] = [];
	const commands: string[] = [];
	const skipped: SkippedComponent[] = [];

	// Skills: strict:false → solo las declaradas en la entrada; default →
	// manifiesto (o convención), complementado por la entrada.
	const entrySkills = asArray(entry?.skills);
	const skillRoots = !strict
		? entrySkills.map((p) => path.join(pluginRoot, p))
		: [
				...(manifest?.skills
					? asArray(manifest.skills).map((p) => path.join(pluginRoot, p))
					: [path.join(pluginRoot, "skills")]),
				...entrySkills.map((p) => path.join(pluginRoot, p)),
			];
	for (const root of skillRoots) {
		if (!fs.existsSync(root)) continue;
		for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			if (!fs.existsSync(path.join(root, entry.name, "SKILL.md"))) continue;
			skills.push(path.join(root, entry.name));
		}
		// Skill única en el root: SKILL.md directo (layout single-skill Claude).
		if (fs.existsSync(path.join(root, "SKILL.md"))) {
			skills.push(root);
		}
	}

	// Commands: commands/*.md PLANOS (los anidados se reportan como saltados).
	const entryCommands = asArray(entry?.commands);
	const commandRoots = !strict
		? entryCommands.map((p) => path.join(pluginRoot, p))
		: [
				...(manifest?.commands
					? asArray(manifest.commands).map((p) => path.join(pluginRoot, p))
					: [path.join(pluginRoot, "commands")]),
				...entryCommands.map((p) => path.join(pluginRoot, p)),
			];
	for (const root of commandRoots) {
		if (!fs.existsSync(root)) continue;
		for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
			const full = path.join(root, entry.name);
			if (entry.isFile() && entry.name.endsWith(".md")) {
				commands.push(full);
			} else if (entry.isDirectory()) {
				skipped.push({
					kind: "commands-nested",
					path: path.relative(pluginRoot, full),
					reason:
						"Commands en subdirectorios no soportados en el MVP (el loader de prompts es plano).",
				});
			}
		}
	}

	// MCP: strict:false → solo la entrada; default → manifiesto/entrada/.mcp.json.
	let mcpServers: Record<string, unknown> = {};
	if (!strict && entry?.mcpServers) {
		mcpServers = { ...entry.mcpServers };
	} else if (entry?.mcpServers && !manifest?.mcpServers) {
		mcpServers = { ...entry.mcpServers };
	} else if (manifest?.mcpServers) {
		mcpServers = { ...manifest.mcpServers };
	} else {
		const mcpPath = path.join(pluginRoot, ".mcp.json");
		if (fs.existsSync(mcpPath)) {
			try {
				const parsed = JSON.parse(fs.readFileSync(mcpPath, "utf-8"));
				if (parsed && typeof parsed === "object") {
					const servers = (parsed as Record<string, unknown>).mcpServers;
					if (servers && typeof servers === "object") {
						mcpServers = { ...(servers as Record<string, unknown>) };
					}
				}
			} catch {
				skipped.push({
					kind: "hooks", // reutilizado como categoría "config inválida"
					path: ".mcp.json",
					reason: ".mcp.json no es JSON válido.",
				});
			}
		}
	}

	// No soportados en el MVP (D6): presencia → reporte, nunca bloqueo.
	const unsupported: [SkippedComponent["kind"], string, string][] = [
		["agents", "agents", "Agents Claude: fase 2 (conversión a frida-subagents)."],
		["hooks", "hooks/hooks.json", "Hooks: fase 2 (approval gates)."],
		["lsp", ".lsp.json", "LSP servers: fuera del MVP."],
		["monitors", "monitors/monitors.json", "Monitors: fuera del MVP."],
		["bin", "bin", "PATH de bin/: fase 2."],
		["settings", "settings.json", "Settings del plugin: fuera del MVP."],
	];
	for (const [kind, rel, reason] of unsupported) {
		if (fs.existsSync(path.join(pluginRoot, rel))) {
			skipped.push({ kind, path: rel, reason });
		}
	}

	return { skills, commands, mcpServers, skipped };
}
