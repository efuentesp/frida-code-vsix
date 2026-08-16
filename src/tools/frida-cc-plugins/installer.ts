/**
 * frida-cc-plugins — installer de marketplaces y plugins (issue #49, ADR-0057 D2/D5/D7).
 *
 *  - Marketplace: `git clone --depth 1` (spawn) a marketplaces/<name>@<rev>/;
 *    shorthand GitHub owner/repo → https://github.com/<repo>.git. isomorphic-git
 *    (puro JS) documentado como alternativa para hosts sin git binario.
 *  - Plugin: resuelve el source del catálogo (path relativo | github | url |
 *    git-subdir) y copia el contenido a installed/<plugin>@<rev>/ (inmutable).
 *    MVP: sources github/url/git-subdir → metadata-only reportado (solo
 *    path-relativo instala en línea; los remotos requieren fetch — fase 2).
 *  - Conversión: readers.discoverComponents + convert.convertPluginResources
 *    + merge MCP con sustitución de placeholders.
 *  - Colisiones MCP (D5): se chequean contra los 4 slots de config ANTES de
 *    instalar; el nombre de server se conserva (rompería referencias).
 *
 * Todo con guías accionables (D6) y sin tocar nada del usuario fuera de
 * <agentDir>/cc-plugins + ~/.frida/mcp.json (llaves propias).
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
	ccPluginsRoot,
	installedDir,
	marketplacesDir,
	mcpCollisionSlots,
	fridaMcpConfigPath,
} from "./constants";
import { materializeSource, type FetchDeps } from "./fetch";
import {
	discoverComponents,
	readMarketplaceCatalog,
	type MarketplaceCatalog,
	type MarketplacePluginEntry,
	type PluginSource,
	type RenameMap,
} from "./readers";
import {
	convertPluginResources,
	existingMcpServerKeys,
	mergeMcpServers,
	removePluginResources,
	substituteMcpPlaceholders,
	unmergeMcpServers,
} from "./convert";
import {
	loadLayers,
	loadRegistry,
	loadRegistryAt,
	mergeLayers,
	saveRegistry,
	saveRegistryAt,
	scopeRegistryPath,
	type CcPluginsRegistry,
	type PluginRecord,
	type PluginScope,
	type ScopedPlugin,
} from "./registry";

/** Error de instalación con guía accionable. */
export class CcPluginsInstallError extends Error {
	readonly guide: string;
	constructor(message: string, guide: string) {
		super(message);
		this.name = "CcPluginsInstallError";
		this.guide = guide;
	}
}

/** Deps inyectables para tests. `fetch` cubre git/npm/zip de PLUGINS. */
export interface InstallerDeps {
	gitBin?: string;
	fetch?: FetchDeps;
	run?: (
		bin: string,
		args: string[],
		opts: { cwd: string },
	) => Promise<{ code: number | null; stderr: string }>;
}

async function defaultRun(
	bin: string,
	args: string[],
	opts: { cwd: string },
): Promise<{ code: number | null; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(bin, args, {
			cwd: opts.cwd,
			shell: process.platform === "win32",
			// Anti-hang: git no debe pedir credenciales interactivamente
			// desde el extension host (sin TTY se colgaría la sesión).
			env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "echo" },
		});
		let stderr = "";
		child.stderr?.on("data", (d) => {
			stderr += String(d);
		});
		child.on("error", reject);
		// Timeout: un spawn colgado (proxy mudo) muere a los 120s — jamás
		// bloquea la sesión indefinidamente.
		const killer = setTimeout(() => {
			stderr += "\n[timeout 120s]";
			child.kill();
		}, 120_000);
		child.on("close", (code) => {
			clearTimeout(killer);
			resolve({ code, stderr });
		});
	});
}

async function git(
	deps: InstallerDeps | undefined,
	args: string[],
	cwd: string,
): Promise<{ stdout: string; stderr: string }> {
	const bin = deps?.gitBin ?? "git";
	const run = deps?.run ?? defaultRun;
	const res = await run(bin, args, { cwd });
	if (res.code !== 0) {
		throw new CcPluginsInstallError(
			`git ${args[0]} falló (exit ${res.code}): ${res.stderr.slice(0, 400)}`,
			"Verifica conectividad/credenciales de git (los marketplaces privados requieren auth configurada). Alternativa sin git: isomorphic-git (documentado en docs/tools/frida-cc-plugins.md).",
		);
	}
	return { stdout: "", stderr: res.stderr };
}

// ─── Marketplaces ────────────────────────────────────────────────────────

/**
 * Normaliza la entrada de marketplace a URL git (https/ssh) o path local.
 * El sufijo `#ref` pinea branch/tag del clone (paridad Claude Code).
 */
export type MarketplaceRef =
	| { kind: "git"; url: string; ref?: string }
	| { kind: "local"; path: string };

export function resolveMarketplaceRef(input: string): MarketplaceRef {
	const raw = input.trim();
	const hashIdx = raw.indexOf("#");
	const ref = hashIdx >= 0 ? raw.slice(hashIdx + 1).trim() : undefined;
	const trimmed = (hashIdx >= 0 ? raw.slice(0, hashIdx) : raw).trim();
	if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) {
		return {
			kind: "git",
			url: `https://github.com/${trimmed}.git`,
			...(ref ? { ref } : {}),
		};
	}
	if (/^https:\/\/[^/]+\/.+(\.git)?$/.test(trimmed)) {
		return {
			kind: "git",
			url: trimmed.endsWith(".git") ? trimmed : `${trimmed}.git`,
			...(ref ? { ref } : {}),
		};
	}
	// SSH (paridad Claude): git@host:path[.git]
	if (/^git@[A-Za-z0-9_.-]+:[^\s]+(\.git)?$/.test(trimmed)) {
		return {
			kind: "git",
			url: trimmed.endsWith(".git") ? trimmed : `${trimmed}.git`,
			...(ref ? { ref } : {}),
		};
	}
	// Local (paridad con acolomba): directorio con .claude-plugin/
	// marketplace.json, o path directo al marketplace.json. Sin git.
	const resolved = path.resolve(trimmed);
	const direct =
		resolved.endsWith("marketplace.json") && fs.existsSync(resolved)
			? path.dirname(path.dirname(resolved))
			: resolved;
	if (fs.existsSync(path.join(direct, ".claude-plugin", "marketplace.json"))) {
		return { kind: "local", path: direct };
	}
	throw new CcPluginsInstallError(
		`Referencia de marketplace no reconocida: ${JSON.stringify(input)}`,
		"Usa shorthand GitHub 'owner/repo', una URL https://...git completa, o un path local con .claude-plugin/marketplace.json.",
	);
}

/** Slug determinista del dir de clone: https://host/path.git → host-path-git. */
function marketplaceSlug(url: string): string {
	return url.replace(/^https?:\/\//, "").replace(/[/:.]+/g, "-");
}

/** Dir de un marketplace según su registro: local = path original; git = clone. */
export function marketplaceDirOf(
	agentDir: string,
	rec: { url: string; local?: boolean },
): string {
	return rec.local
		? rec.url
		: path.join(marketplacesDir(agentDir), marketplaceSlug(rec.url));
}

/** HEAD short sha del clone (identidad de la revisión). */
async function cloneRev(
	deps: InstallerDeps | undefined,
	dir: string,
): Promise<string> {
	// --depth 1 no guarda rev-parse HEAD~n, pero HEAD sí existe.
	const out = await git(deps, ["rev-parse", "--short", "HEAD"], dir);
	return out.stdout.trim() || Date.now().toString(36);
}

export interface MarketplaceAddResult {
	name: string;
	rev: string;
	dir: string;
	plugins: number;
}

/** Clona un marketplace, valida su catálogo y lo registra. Idempotente. */
export async function addMarketplace(
	agentDir: string,
	ref: string,
	opts: {
		deps?: InstallerDeps;
		cwd?: string;
		reg?: CcPluginsRegistry;
	} = {},
): Promise<MarketplaceAddResult> {
	const reg = opts.reg ?? loadRegistry(agentDir);
	const resolved = resolveMarketplaceRef(ref);
	if (resolved.kind === "local") {
		// Marketplace local (paridad acolomba): sin clone — el catálogo se lee
		// in situ; el contenido vive fuera de cc-plugins (remover NO lo borra).
		const catalog = readMarketplaceCatalog(resolved.path);
		reg.marketplaces[catalog.name] = {
			url: resolved.path,
			rev: "local",
			local: true,
			refreshedAt: new Date().toISOString(),
			addedAt: new Date().toISOString(),
		};
		saveRegistry(agentDir, reg);
		return {
			name: catalog.name,
			rev: "local",
			dir: resolved.path,
			plugins: catalog.plugins.length,
		};
	}
	const url = resolved.url;
	fs.mkdirSync(marketplacesDir(agentDir), { recursive: true });
	const dir = path.join(marketplacesDir(agentDir), marketplaceSlug(url));
	// Clone fresco idempotente: quitar el previo y clonar de nuevo (el
	// marketplace cambia; la identidad de plugins vive en installed/).
	if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
	await git(
		opts.deps,
		[
			"clone",
			"--depth",
			"1",
			"--filter=blob:none",
			...(resolved.ref ? ["--branch", resolved.ref] : []),
			url,
			dir,
		],
		process.cwd(),
	);
	const catalog: MarketplaceCatalog = readMarketplaceCatalog(dir);
	const rev = await cloneRev(opts.deps, dir);
	const prevAuto = reg.marketplaces[catalog.name]?.autoUpdate;
	reg.marketplaces[catalog.name] = {
		url,
		rev,
		...(resolved.ref ? { ref: resolved.ref } : {}),
		...(prevAuto !== undefined ? { autoUpdate: prevAuto } : {}),
		refreshedAt: new Date().toISOString(),
		addedAt: new Date().toISOString(),
	};
	saveRegistry(agentDir, reg);
	return {
		name: catalog.name,
		rev,
		dir,
		plugins: catalog.plugins.length,
	};
}

/** Toggle de auto-update por marketplace (#50 F5). */
export function setMarketplaceAutoUpdate(
	agentDir: string,
	name: string,
	on: boolean,
): void {
	const reg = loadRegistry(agentDir);
	const rec = reg.marketplaces[name];
	if (!rec) {
		throw new CcPluginsInstallError(
			`Marketplace '${name}' no registrado`,
			"Usa /ccplugin marketplace list para ver los registrados.",
		);
	}
	rec.autoUpdate = on;
	saveRegistry(agentDir, reg);
}

/** Elimina un marketplace y TODOS los plugins instalados desde él. */
export async function removeMarketplace(
	agentDir: string,
	name: string,
	opts: { reg?: CcPluginsRegistry } = {},
): Promise<number> {
	const reg = opts.reg ?? loadRegistry(agentDir);
	const rec = reg.marketplaces[name];
	if (!rec) {
		throw new CcPluginsInstallError(
			`Marketplace '${name}' no registrado`,
			"Usa /ccplugin marketplace list para ver los registrados.",
		);
	}
	let removed = 0;
	for (const [plugin, prec] of Object.entries(reg.plugins)) {
		if (prec.marketplace === name) {
			await uninstallPlugin(agentDir, plugin, { reg });
			removed++;
		}
	}
	delete reg.marketplaces[name];
	if (!rec.local) {
		const dir = marketplaceDirOf(agentDir, rec);
		if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
	} // local: el contenido es del usuario — nunca se borra.
	saveRegistry(agentDir, reg);
	return removed;
}

// ─── Plugins ─────────────────────────────────────────────────────────────

/**
 * Sigue el map renames del catálogo (encadenado, paridad Claude) desde un
 * nombre viejo. Devuelve el nombre final, o null si el plugin fue
 * eliminado (renames[name] === null). Detecta ciclos.
 */
export function resolveRename(
	renames: Record<string, string | null> | undefined,
	from: string,
): string | null {
	if (!renames) return from;
	const visited = new Set<string>([from]);
	let current = from;
	for (let i = 0; i < 32; i++) {
		const next = renames[current];
		if (next === undefined) return current; // sin entrada: nombre vigente
		if (next === null) return null; // eliminado
		if (visited.has(next)) {
			throw new CcPluginsInstallError(
				`Ciclo en renames del catálogo: ${[...visited, next].join(" → ")}`,
				"renames debe ser append-only y terminar en un nombre existente o null (claude plugin validate lo rechaza igual).",
			);
		}
		visited.add(next);
		current = next;
	}
	throw new CcPluginsInstallError(
		`Cadena renames demasiado larga desde '${from}'`,
		"renames debe ser append-only y terminar en un nombre existente o null.",
	);
}

export interface AvailablePlugin {
	/** Nombre de entrada en el catálogo. */
	name: string;
	/** Nombre legible para UI (fase autor #51). */
	displayName?: string;
	marketplace: string;
	version?: string;
	description?: string;
	/** ¿Ya instalado (y habilitado) desde ese marketplace? */
	installed: boolean;
	enabled: boolean;
	/** Source remoto aún no instalable en el MVP. */
	remote: boolean;
	/** Metadata de descubrimiento (panel #49: señal sin downloads). */
	category?: string;
	author?: string;
	homepage?: string;
}

/**
 * Lista los plugins DISPONIBLES en los catálogos de los marketplaces
 * registrados (paridad `list --available` de Claude Code), marcando los ya
 * instalados. Marketplaces ilegibles se omiten (degradación suave).
 */
export function listAvailable(
	agentDir: string,
	opts: { reg?: CcPluginsRegistry; marketplace?: string } = {},
): AvailablePlugin[] {
	const reg = opts.reg ?? loadRegistry(agentDir);
	const out: AvailablePlugin[] = [];
	for (const [name, m] of Object.entries(reg.marketplaces)) {
		if (opts.marketplace && name !== opts.marketplace) continue;
		const dir = marketplaceDirOf(agentDir, m);
		let catalog: MarketplaceCatalog;
		try {
			catalog = readMarketplaceCatalog(dir);
		} catch {
			continue;
		}
		for (const p of catalog.plugins) {
			const rec = reg.plugins[p.name];
			out.push({
				name: p.name,
				displayName: p.displayName,
				marketplace: name,
				version: p.version,
				description: p.description,
				installed: !!rec && rec.marketplace === name,
				enabled: !!rec && rec.marketplace === name && rec.enabled,
				remote: p.source.kind !== "path",
				category: p.category,
				author:
					typeof p.author === "string"
						? p.author
						: (p.author?.name ?? undefined),
				homepage: p.homepage,
			});
		}
	}
	return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Describe un source no-path para info/list (npm/archive/remotos). */
function describePluginSource(s: PluginSource): string {
	switch (s.kind) {
		case "github":
			return `github:${s.repo}`;
		case "url":
			return `git:${s.url}`;
		case "git-subdir":
			return `git:${s.url}#${s.path}`;
		case "npm":
			return `npm:${s.package}${s.version ? `@${s.version}` : ""}`;
		case "archive":
			return `zip:${s.url}`;
		default:
			return s.kind;
	}
}

export interface CatalogPluginInfo {
	name: string;
	marketplace: string;
	version?: string;
	description?: string;
	/** Inventario in situ (solo sources de path). */
	components?: {
		skills: string[];
		commands: string[];
		mcpServers: string[];
		skipped: { kind: string; reason: string }[];
		/** Estimación de tokens/turno (#50): bytes de skills+prompts / 4. */
		estimatedTokens?: number;
	};
	remote?: string;
}

/**
 * Info PRE-INSTALL de un plugin del catálogo (paridad del detalle de
 * Discover): inventario de componentes leído in situ para sources de path;
 * los remotos se describen por su source (fetch: fase 2).
 */
export function pluginCatalogInfo(
	agentDir: string,
	pluginRef: string,
	opts: { reg?: CcPluginsRegistry } = {},
): CatalogPluginInfo {
	const reg = opts.reg ?? loadRegistry(agentDir);
	const at = pluginRef.lastIndexOf("@");
	const [pluginName, marketplaceName] =
		at > 0
			? [pluginRef.slice(0, at), pluginRef.slice(at + 1)]
			: [pluginRef, undefined];
	for (const [name, m] of Object.entries(reg.marketplaces)) {
		if (marketplaceName && name !== marketplaceName) continue;
		const dir = marketplaceDirOf(agentDir, m);
		let catalog: MarketplaceCatalog;
		try {
			catalog = readMarketplaceCatalog(dir);
		} catch {
			continue;
		}
		const found = catalog.plugins.find((p) => p.name === pluginName);
		if (!found) continue;
		const base: CatalogPluginInfo = {
			name: found.name,
			marketplace: name,
			version: found.version,
			description: found.description,
		};
		if (found.source.kind !== "path") {
			return {
				...base,
				remote: describePluginSource(found.source),
			};
		}
		const pluginDir = path.join(dir, found.source.path.slice(2));
		if (!fs.existsSync(pluginDir)) return { ...base, remote: "path-ausente" };
		const c = discoverComponents(pluginDir);
		// Context cost aproximado (#50): contenido de skills+commands en bytes
		// / 4 ≈ tokens por turno (paridad del "Context cost" de Discover).
		const bytesOf = (p: string): number => {
			try {
				return fs.statSync(p).size;
			} catch {
				return 0;
			}
		};
		const estBytes =
			c.skills.reduce((a, s) => a + bytesOf(path.join(s, "SKILL.md")), 0) +
			c.commands.reduce((a, cmd) => a + bytesOf(cmd), 0);
		return {
			...base,
			components: {
				skills: c.skills.map((s) => path.basename(s)),
				commands: c.commands.map((s) => path.basename(s, ".md")),
				mcpServers: Object.keys(c.mcpServers),
				skipped: c.skipped.map((s) => ({ kind: s.kind, reason: s.reason })),
				estimatedTokens: Math.ceil(estBytes / 4),
			},
		};
	}
	throw new CcPluginsInstallError(
		`Plugin '${pluginName}' no encontrado${marketplaceName ? ` en '${marketplaceName}'` : " en ningún marketplace registrado"}`,
		"Usa /ccplugin list --available para ver plugins instalables.",
	);
}

export interface PluginInstallResult {
	plugin: string;
	version?: string;
	skills: string[];
	commands: string[];
	mcpServers: string[];
	skipped: { kind: string; reason: string }[];
}

/**
 * Instala un plugin: copia contenido, convierte recursos y registra MCP.
 * Chequea colisiones de nombres MCP contra TODOS los slots ANTES de escribir.
 */
export async function installPlugin(
	agentDir: string,
	pluginRef: string,
	opts: {
		deps?: InstallerDeps;
		cwd?: string;
		reg?: CcPluginsRegistry;
		/** Scope destino del record (default user). #50 */
		scope?: PluginScope;
	} = {},
): Promise<PluginInstallResult> {
	const scope = opts.scope ?? "user";
	const workCwd = opts.cwd ?? process.cwd();
	// Registro DESTINO (donde vive el record) + marketplaces MERGEADOS:
	// project puede instalar desde marketplaces del user (paridad acolomba).
	const reg = opts.reg ?? loadRegistry(agentDir);
	const layers = loadLayers(agentDir, workCwd);
	const mkts = mergeLayers(layers).marketplaces;
	const findScoped = (n: string): ScopedPlugin | undefined =>
		mergeLayers(layers).plugins.find((p) => p.name === n);
	// Formato: <plugin>@<marketplace> (o <plugin> si es único).
	const at = pluginRef.lastIndexOf("@");
	const [pluginName, marketplaceName] =
		at > 0
			? [pluginRef.slice(0, at), pluginRef.slice(at + 1)]
			: [pluginRef, undefined];

	// Refresh-before-lookup (paridad Claude): refrescar el catálogo destino
	// antes de resolver <plugin>@<marketplace> — throttle 30s por registro.
	// Fallo (offline) NO bloquea: se busca en el catálogo cacheado.
	if (marketplaceName) {
		const m = mkts[marketplaceName];
		const age = m?.refreshedAt
			? Date.now() - Date.parse(m.refreshedAt)
			: Number.POSITIVE_INFINITY;
		if (m && !m.local && age > 30_000) {
			try {
				await addMarketplace(agentDir, `${m.url}${m.ref ? `#${m.ref}` : ""}`, {
					deps: opts.deps,
					cwd: opts.cwd,
					reg,
				});
			} catch {
				// Offline: catálogo cacheado sigue siendo utilizable.
			}
		}
	}

	// Localizar la entrada en los marketplaces registrados (con renames:
	// si el nombre pedido ya no existe, seguir el map antes de fallar).
	let entry: {
		marketplace: string;
		source: PluginSource;
		version?: string;
		entry?: MarketplacePluginEntry;
		renames?: RenameMap;
	} | null = null;
	const candidates = Object.entries(mkts).filter(
		([name]) => !marketplaceName || name === marketplaceName,
	);
	for (const [name, m] of candidates) {
		const dir = marketplaceDirOf(agentDir, m);
		if (!fs.existsSync(dir)) continue;
		try {
			const catalog = readMarketplaceCatalog(dir);
			let found = catalog.plugins.find((p) => p.name === pluginName);
			if (!found && catalog.renames) {
				// renames: el usuario referencia un nombre viejo → migrar.
				const resolvedName = resolveRename(catalog.renames, pluginName);
				if (resolvedName === null) {
					throw new CcPluginsInstallError(
						`El plugin '${pluginName}' fue ELIMINADO de '${name}' (renames → null).`,
						"Desinstálalo con /ccplugin remove y elige un plugin vigente del catálogo.",
					);
				}
				found = catalog.plugins.find((p) => p.name === resolvedName);
			}
			if (found) {
				entry = {
					marketplace: name,
					source: found.source,
					version: found.version,
					entry: found,
					renames: catalog.renames,
				};
				break;
			}
		} catch (e) {
			if (e instanceof CcPluginsInstallError) throw e; // guías loud
			/* marketplace ilegible → siguiente */
		}
	}
	if (!entry) {
		throw new CcPluginsInstallError(
			`Plugin '${pluginName}' no encontrado${marketplaceName ? ` en '${marketplaceName}'` : " en ningún marketplace registrado"}`,
			"Usa /ccplugin list --available para ver plugins instalables.",
		);
	}

	// Resolver el source: path relativo al marketplace dir IN SITU; sources
	// remotos (github/url/git-subdir/npm/archive) se MATERIALIZAN por fetch
	// a staging (#50) y de ahí fluyen igual (discover → installed).
	const mDir = marketplaceDirOf(agentDir, mkts[entry.marketplace]);
	let sourceDir: string;
	let sourceRev: string | undefined;
	if (entry.source.kind === "path") {
		sourceDir = path.join(mDir, entry.source.path.slice(2));
		if (!fs.existsSync(sourceDir)) {
			throw new CcPluginsInstallError(
				`El directorio del plugin no existe en el marketplace: ${path.relative(mDir, sourceDir)}`,
				"Actualiza el marketplace (/ccplugin marketplace update) y reintenta.",
			);
		}
	} else {
		// Staging efímero bajo cc-plugins; el contenido final vive en installed/.
		const staging = path.join(
			ccPluginsRoot(agentDir),
			"staging-sources",
			`${pluginName ?? "plugin"}-${Date.now().toString(36)}`,
		);
		try {
			const m = await materializeSource(staging, entry.source, opts.deps?.fetch);
			sourceDir = m.dir;
			sourceRev = m.rev;
		} catch (e: any) {
			throw new CcPluginsInstallError(
				`Fetch del source '${entry.source.kind}' de '${pluginName}' falló: ${e?.message ?? e}`,
				`Verifica conectividad/credenciales (git/npm) o el digest sha256 del zip. Detalle: ${e?.message ?? e}`,
			);
		}
	}

	// Descubrir componentes ANTES de escribir nada. La entrada del catálogo
	// viaja para strict:false/pluginRoot/componentes declarados (#51).
	const components = discoverComponents(sourceDir, entry?.entry);
	const manifestName = path.basename(sourceDir);
	// El nombre vigente es el de la ENTRADA resuelta (renames: instalar
	// "p-viejo" registra "p-nuevo" — paridad Claude).
	const plugin = entry?.entry?.name ?? pluginName ?? manifestName;

	// Colisiones MCP: TODOS los slots deben tener las llaves libres (D5) —
	// salvo las PROPIAS del plugin (record previo): un re-install/reconcile
	// debe poder sobreescribir sus llaves, no colisionar consigo mismo.
	const ownMcpKeys = findScoped(plugin)?.rec.mcpServers ?? [];
	const cwd = opts.cwd ?? process.cwd();
	const { homedir } = await import("node:os");
	const taken = new Set<string>();
	for (const slot of mcpCollisionSlots(agentDir, cwd, homedir())) {
		for (const k of existingMcpServerKeys(slot)) taken.add(k);
	}
	for (const k of ownMcpKeys) taken.delete(k);
	const mcpKeys = Object.keys(components.mcpServers);
	const clash = mcpKeys.find((k) => taken.has(k));
	if (clash) {
		throw new CcPluginsInstallError(
			`Conflicto de nombre MCP: '${clash}' ya está en uso en un config MCP existente.`,
			"Los servers de plugins conservan su nombre (las skills los referencian así). Renombra el server existente o elige otro plugin.",
		);
	}

	// Copiar contenido inmutable a installed/<plugin>@<rev>. Remotos: la rev
	// resuelta del SOURCE (sha/versión/digest) — más granular que la del
	// marketplace; path-relativos: la del marketplace (comportamiento previo).
	const rev = sourceRev ?? mkts[entry.marketplace].rev;
	const installDir = path.join(installedDir(agentDir), `${plugin}@${rev}`);
	if (fs.existsSync(installDir))
		fs.rmSync(installDir, { recursive: true, force: true });
	fs.mkdirSync(installDir, { recursive: true });
	fs.cpSync(sourceDir, installDir, { recursive: true });

	// Convertir recursos (skills reescritas + prompts planos).
	const converted = convertPluginResources(agentDir, plugin, components);

	// MCP: placeholders + merge a ~/.frida/mcp.json. Las llaves propias se
	// retiran primero: el merge ve slots libres aunque sea un re-install.
	let mcpWritten: string[] = [];
	if (ownMcpKeys.length > 0) {
		unmergeMcpServers(fridaMcpConfigPath(agentDir), ownMcpKeys);
	}
	if (mcpKeys.length > 0) {
		const substituted: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(components.mcpServers)) {
			substituted[k] = substituteMcpPlaceholders(v, {
				pluginRoot: installDir,
				projectDir: cwd,
			});
		}
		mcpWritten = mergeMcpServers(fridaMcpConfigPath(agentDir), substituted);
	}

	const skipped = [...components.skipped, ...converted.skipped];
	reg.plugins[plugin] = {
		marketplace: entry.marketplace,
		source: entry.source as { kind: string; [k: string]: unknown },
		version: entry.version,
		rev,
		enabled: true,
		installedAt: new Date().toISOString(),
		skills: converted.skills,
		commands: converted.commands,
		mcpServers: mcpWritten,
		skipped,
	};
	saveRegistryAt(scopeRegistryPath(agentDir, workCwd, scope), reg);
	return {
		plugin,
		version: entry.version,
		skills: converted.skills,
		commands: converted.commands,
		mcpServers: mcpWritten,
		skipped: skipped.map((s) => ({ kind: s.kind, reason: s.reason })),
	};
}

/** Desinstala: borra recursos convertidos, contenido y llaves MCP. */
export async function uninstallPlugin(
	agentDir: string,
	plugin: string,
	opts: {
		reg?: CcPluginsRegistry;
		keepData?: boolean;
		cwd?: string;
		/** Scope explícito; sin él se busca en todos (local>project>user). */
		scope?: PluginScope;
	} = {},
): Promise<void> {
	if (opts.reg) {
		// Modo legacy (reconcile/renames con reg propio en memoria).
		const rec0 = opts.reg.plugins[plugin];
		if (!rec0) {
			throw new CcPluginsInstallError(
				`Plugin '${plugin}' no instalado`,
				"Usa /ccplugin list para ver los instalados.",
			);
		}
		removePluginResources(agentDir, plugin);
		unmergeMcpServers(fridaMcpConfigPath(agentDir), rec0.mcpServers ?? []);
		const d0 = path.join(installedDir(agentDir), `${plugin}@${rec0.rev}`);
		if (fs.existsSync(d0)) fs.rmSync(d0, { recursive: true, force: true });
		delete opts.reg.plugins[plugin];
		return;
	}
	const workCwd = opts.cwd ?? process.cwd();
	const layers = loadLayers(agentDir, workCwd);
	const found = opts.scope
		? (() => {
				const rec = layers[opts.scope].plugins[plugin];
				return rec ? ({ name: plugin, rec, scope: opts.scope } as ScopedPlugin) : undefined;
			})()
		: mergeLayers(layers).plugins.find((p) => p.name === plugin);
	if (!found) {
		throw new CcPluginsInstallError(
			`Plugin '${plugin}' no instalado`,
			"Usa /ccplugin list para ver los instalados.",
		);
	}
	removePluginResources(agentDir, plugin);
	unmergeMcpServers(fridaMcpConfigPath(agentDir), found.rec.mcpServers ?? []);
	const installDir = path.join(installedDir(agentDir), `${plugin}@${found.rec.rev}`);
	if (fs.existsSync(installDir)) {
		fs.rmSync(installDir, { recursive: true, force: true });
	}
	const file = scopeRegistryPath(agentDir, workCwd, found.scope);
	const reg = loadRegistryAt(file);
	delete reg.plugins[plugin];
	saveRegistryAt(file, reg);
}

/** Enable/disable: opera en el scope donde vive el plugin. */
export function setPluginEnabled(
	agentDir: string,
	plugin: string,
	enabled: boolean,
	opts: { reg?: CcPluginsRegistry; cwd?: string; scope?: PluginScope } = {},
): CcPluginsRegistry {
	const workCwd = opts.cwd ?? process.cwd();
	if (opts.reg) {
		const rec = opts.reg.plugins[plugin];
		if (!rec) throw new CcPluginsInstallError(
			`Plugin '${plugin}' no instalado`,
			"Usa /ccplugin list para ver los instalados.",
		);
		rec.enabled = enabled;
		return opts.reg;
	}
	const layers = loadLayers(agentDir, workCwd);
	const found = opts.scope
		? (() => {
				const rec = layers[opts.scope].plugins[plugin];
				return rec ? ({ name: plugin, rec, scope: opts.scope } as ScopedPlugin) : undefined;
			})()
		: mergeLayers(layers).plugins.find((p) => p.name === plugin);
	if (!found) {
		throw new CcPluginsInstallError(
			`Plugin '${plugin}' no instalado`,
			"Usa /ccplugin list para ver los instalados.",
		);
	}
	found.rec.enabled = enabled;
	const file = scopeRegistryPath(agentDir, workCwd, found.scope);
	const reg = loadRegistryAt(file);
	if (reg.plugins[plugin]) reg.plugins[plugin].enabled = enabled;
	saveRegistryAt(file, reg);
	return reg;
}

/**
 * Lista plugins instalados. Con `cwd` devuelve el MERGE de scopes con el
 * campo `scope`; sin él (o con `reg`), el registro user (back-compat).
 */
export function listInstalled(
	agentDir: string,
	reg?: CcPluginsRegistry,
	cwd?: string,
): (PluginRecord & { plugin: string; scope?: PluginScope })[] {
	if (cwd && !reg) {
		const merged = mergeLayers(loadLayers(agentDir, cwd));
		return merged.plugins.map((p) => ({
			...p.rec,
			plugin: p.name,
			scope: p.scope,
		}));
	}
	const r = reg ?? loadRegistry(agentDir);
	return Object.entries(r.plugins).map(
		([name, p]) =>
			({
				...p,
				plugin: name,
			}) as PluginRecord & { plugin: string; scope?: PluginScope },
	);
}

/** Cache de pluginLastUpdated (spawn git por plugin, una sola vez). */
const lastUpdatedCache = new Map<string, string | undefined>();

/**
 * Fecha del último commit que tocó el dir del plugin dentro del clon del
 * marketplace (monorepo estilo claude-plugins-official). Solo sources `path`;
 * remotos y no-git → undefined. Panel #49: "Last updated" de la ficha.
 */
export async function pluginLastUpdated(
	agentDir: string,
	ref: string,
	opts: { cwd?: string } = {},
): Promise<string | undefined> {
	const [name, mkt] = ref.split("@");
	const reg = loadRegistry(agentDir);
	const m = mkt ? reg.marketplaces[mkt] : undefined;
	if (!m || !name) return undefined;
	const dir = marketplaceDirOf(agentDir, m);
	const cat = (() => {
		try {
			return readMarketplaceCatalog(dir);
		} catch {
			return undefined;
		}
	})();
	const entry = cat?.plugins.find((p) => p.name === name);
	// Narrowing ANTES del closure: las propiedades no fluyen a callbacks.
	const relPath =
		entry && entry.source.kind === "path" ? entry.source.path : undefined;
	if (!relPath) return undefined;
	const cacheKey = `${dir}|${relPath}`;
	if (lastUpdatedCache.has(cacheKey)) return lastUpdatedCache.get(cacheKey);
	const when = await new Promise<string | undefined>((resolve) => {
		const child = spawn(
			"git",
			["-C", dir, "log", "-1", "--format=%cs", "--", relPath],
			{
				env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
				timeout: 10_000,
			},
		);
		let out = "";
		child.stdout?.on("data", (d) => (out += String(d)));
		child.on("error", () => resolve(undefined));
		child.on("close", (code) => resolve(code === 0 ? out.trim() || undefined : undefined));
	});
	lastUpdatedCache.set(cacheKey, when);
	return when;
}
