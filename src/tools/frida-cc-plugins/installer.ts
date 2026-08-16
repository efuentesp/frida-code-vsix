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
	installedDir,
	marketplacesDir,
	mcpCollisionSlots,
	fridaMcpConfigPath,
} from "./constants";
import {
	discoverComponents,
	readMarketplaceCatalog,
	type MarketplaceCatalog,
	type PluginSource,
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
	loadRegistry,
	saveRegistry,
	type CcPluginsRegistry,
	type PluginRecord,
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

/** Deps inyectables para tests. */
export interface InstallerDeps {
	gitBin?: string;
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
		});
		let stderr = "";
		child.stderr?.on("data", (d) => {
			stderr += String(d);
		});
		child.on("error", reject);
		child.on("close", (code) => resolve({ code, stderr }));
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

/** Normaliza la entrada de marketplace a URL git https o path local. */
export type MarketplaceRef =
	| { kind: "git"; url: string }
	| { kind: "local"; path: string };

export function resolveMarketplaceRef(input: string): MarketplaceRef {
	const trimmed = input.trim().replace(/#.*$/, "");
	if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) {
		return { kind: "git", url: `https://github.com/${trimmed}.git` };
	}
	if (/^https:\/\/[^/]+\/.+(\.git)?$/.test(trimmed)) {
		return {
			kind: "git",
			url: trimmed.endsWith(".git") ? trimmed : `${trimmed}.git`,
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
function marketplaceDirOf(
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
		["clone", "--depth", "1", "--filter=blob:none", url, dir],
		process.cwd(),
	);
	const catalog: MarketplaceCatalog = readMarketplaceCatalog(dir);
	const rev = await cloneRev(opts.deps, dir);
	reg.marketplaces[catalog.name] = {
		url,
		rev,
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

/** Resuelve el directorio fuente de un plugin dentro del marketplace. */
function resolvePluginSourceDir(
	source: PluginSource,
	marketplaceDir: string,
): { dir: string; remote: true } | { dir: string; remote: false } | null {
	if (source.kind === "path") {
		const rel = source.path.slice(2); // "./x" → "x"
		return { dir: path.join(marketplaceDir, rel), remote: false };
	}
	if (source.kind === "github") {
		return {
			dir: `github:${source.repo}${source.ref ? `#${source.ref}` : ""}`,
			remote: true,
		};
	}
	if (source.kind === "url") {
		return {
			dir: `git:${source.url}${source.ref ? `#${source.ref}` : ""}`,
			remote: true,
		};
	}
	if (source.kind === "git-subdir") {
		return { dir: `git:${source.url}#${source.path}`, remote: true };
	}
	return null;
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
	} = {},
): Promise<PluginInstallResult> {
	const reg = opts.reg ?? loadRegistry(agentDir);
	// Formato: <plugin>@<marketplace> (o <plugin> si es único).
	const at = pluginRef.lastIndexOf("@");
	const [pluginName, marketplaceName] =
		at > 0
			? [pluginRef.slice(0, at), pluginRef.slice(at + 1)]
			: [pluginRef, undefined];

	// Localizar la entrada en los marketplaces registrados.
	let entry: {
		marketplace: string;
		source: PluginSource;
		version?: string;
	} | null = null;
	const candidates = Object.entries(reg.marketplaces).filter(
		([name]) => !marketplaceName || name === marketplaceName,
	);
	for (const [name, m] of candidates) {
		const dir = marketplaceDirOf(agentDir, m);
		if (!fs.existsSync(dir)) continue;
		try {
			const catalog = readMarketplaceCatalog(dir);
			const found = catalog.plugins.find((p) => p.name === pluginName);
			if (found) {
				entry = { marketplace: name, source: found.source, version: found.version };
				break;
			}
		} catch {
			/* marketplace ilegible → siguiente */
		}
	}
	if (!entry) {
		throw new CcPluginsInstallError(
			`Plugin '${pluginName}' no encontrado${marketplaceName ? ` en '${marketplaceName}'` : " en ningún marketplace registrado"}`,
			"Usa /ccplugin list --available para ver plugins instalables.",
		);
	}

	// Resolver el source a directorio local del marketplace.
	const mDir = marketplaceDirOf(agentDir, reg.marketplaces[entry.marketplace]);
	const resolved = resolvePluginSourceDir(entry.source, mDir);
	if (!resolved || resolved.remote) {
		throw new CcPluginsInstallError(
			`El source del plugin '${pluginName}' es remoto (${resolved?.dir ?? "desconocido"}); fetch remoto llega en fase 2.`,
			"Mientras tanto, clona el repo del plugin dentro del marketplace y cambia su entrada a './<dir>', o espera el fetch remoto (fase 2).",
		);
	}
	if (!fs.existsSync(resolved.dir)) {
		throw new CcPluginsInstallError(
			`El directorio del plugin no existe en el marketplace: ${path.relative(mDir, resolved.dir)}`,
			"Actualiza el marketplace (/ccplugin marketplace update) y reintenta.",
		);
	}

	// Descubrir componentes ANTES de escribir nada.
	const components = discoverComponents(resolved.dir);
	const manifestName = path.basename(resolved.dir);
	const plugin = pluginName || manifestName;

	// Colisiones MCP: TODOS los slots deben tener las llaves libres (D5) —
	// salvo las PROPIAS del plugin (record previo): un re-install/reconcile
	// debe poder sobreescribir sus llaves, no colisionar consigo mismo.
	const ownMcpKeys = reg.plugins[plugin]?.mcpServers ?? [];
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

	// Copiar contenido inmutable a installed/<plugin>@<rev>.
	const rev = reg.marketplaces[entry.marketplace].rev;
	const installDir = path.join(installedDir(agentDir), `${plugin}@${rev}`);
	if (fs.existsSync(installDir))
		fs.rmSync(installDir, { recursive: true, force: true });
	fs.mkdirSync(installDir, { recursive: true });
	fs.cpSync(resolved.dir, installDir, { recursive: true });

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
	saveRegistry(agentDir, reg);
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
	opts: { reg?: CcPluginsRegistry; keepData?: boolean } = {},
): Promise<void> {
	const reg = opts.reg ?? loadRegistry(agentDir);
	const rec = reg.plugins[plugin];
	if (!rec) {
		throw new CcPluginsInstallError(
			`Plugin '${plugin}' no instalado`,
			"Usa /ccplugin list para ver los instalados.",
		);
	}
	removePluginResources(agentDir, plugin);
	unmergeMcpServers(fridaMcpConfigPath(agentDir), rec.mcpServers ?? []);
	const installDir = path.join(installedDir(agentDir), `${plugin}@${rec.rev}`);
	if (fs.existsSync(installDir)) {
		fs.rmSync(installDir, { recursive: true, force: true });
	}
	delete reg.plugins[plugin];
	if (!opts.reg) saveRegistry(agentDir, reg); // caller con reg propio lo guarda
}

/** Enable/disable: el resources_discover filtra por enabled. */
export function setPluginEnabled(
	agentDir: string,
	plugin: string,
	enabled: boolean,
	opts: { reg?: CcPluginsRegistry } = {},
): CcPluginsRegistry {
	const reg = opts.reg ?? loadRegistry(agentDir);
	const rec = reg.plugins[plugin];
	if (!rec) {
		throw new CcPluginsInstallError(
			`Plugin '${plugin}' no instalado`,
			"Usa /ccplugin list para ver los instalados.",
		);
	}
	rec.enabled = enabled;
	if (!opts.reg) saveRegistry(agentDir, reg);
	return reg;
}

/** Lista plugins instalados (con estado enabled/skipped). */
export function listInstalled(
	agentDir: string,
	reg?: CcPluginsRegistry,
): PluginRecord[] {
	const r = reg ?? loadRegistry(agentDir);
	return Object.entries(r.plugins).map(
		([name, p]) =>
			({
				...p,
				marketplace: p.marketplace,
				// el nombre vive en la llave; se agrega como campo para listar
				plugin: name,
				skills: p.skills,
				commands: p.commands,
				mcpServers: p.mcpServers,
				skipped: p.skipped,
			}) as PluginRecord & { plugin: string },
	);
}
