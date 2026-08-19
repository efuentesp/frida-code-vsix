/**
 * frida-cc-plugins — factory de la extensión (issue #49, ADR-0057).
 *
 * Superficie registrada contra el ExtensionAPI real:
 *
 *  - `resources_discover` (patrón pi-claude-marketplace): devuelve
 *    skillPaths/promptPaths de los plugins HABILITADOS bajo
 *    <agentDir>/cc-plugins/resources/ — el resource loader del SDK los carga
 *    como recursos de extensión. Reconcile al cargar: si falta material,
 *    re-instala desde el marketplace clonado (self-healing del registro
 *    declarativo). Enable/disable = no devolver paths.
 *  - Comando `/ccplugin` (subcomandos estilo /claude:plugin de acolomba):
 *    marketplace add|list|remove|update, add|remove|list|enable|disable,
 *    info, bootstrap. Notifica al usuario tras mutaciones: "/reload" para
 *    que el dispatcher recoja prompts/skills nuevos.
 *
 * El gate (frida.ccPlugins.enabled, default true) lo aplica el caller en
 * pi-session.ts: la extensión nunca instala nada por sí sola — todo install
 * requiere /ccplugin add explícito (D8). Sesión main only.
 */
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
	CC_PLUGINS_COMMAND,
	CC_PLUGINS_FACTORY_NAME,
	OFFICIAL_MARKETPLACE,
	installedDir,
	fridaMcpConfigPath,
	registryPath,
	resourcesPromptsDir,
	resourcesSkillsDir,
} from "./constants";
import {
	addMarketplace,
	installPlugin,
	listAvailable,
	pluginCatalogInfo,
	removeMarketplace,
	setPluginEnabled,
	uninstallPlugin,
	pluginLastUpdated,
} from "./installer";
import { validateMarketplaceDir } from "./validate";
import { readMarketplaceCatalog } from "./readers";
import {
	marketplaceDirOf,
	resolveRename,
	setMarketplaceAutoUpdate,
} from "./installer";
import {
	loadLayers,
	loadRegistry,
	mergeLayers,
	saveRegistry,
	type CcPluginsRegistry,
	type ScopedPlugin,
} from "./registry";

export interface CreateCcPluginsOpts {
	/** Agent dir de Frida (~/.frida). */
	agentDir: string;
	/** cwd del workspace. */
	cwd?: string;
	/** Log de diagnóstico. */
	onLog?: (line: string) => void;
	/** Git inyectable para tests (bootstrap/reconcile). */
	deps?: import("./installer").InstallerDeps;
	/**
	 * Team marketplaces (paridad extraKnownMarketplaces): refs que el
	 * reconcile instala automáticamente al cargar (settings de frida).
	 * Formato: "owner/repo[#ref]" o path local.
	 */
	extraMarketplaces?: string[];
	/**
	 * Plugins que el reconcile habilita/instala al cargar
	 * (paridad enabledPlugins): "plugin@marketplace" → true.
	 */
	enabledPlugins?: Record<string, boolean>;
	/** Delay inicial del auto-update background (default 5s; tests: 0). */
	autoUpdateDelayMs?: number;
	/** Presenter VS Code de resultados (output channel). Sin él, notify. */
	presenter?: import("./presenter").CcPluginsPresenter;
	/** Sink del panel nativo del webview (null = cerrar). Sin él, notify. */
	panel?: import("./panel").CcPanelSink;
}

/** Estado del wrapper para el host (notificaciones). */
export interface CcPluginsState {
	ready: boolean;
	marketplaces?: number;
	plugins?: number;
	/** Aviso informativo del trabajo background (bootstrap/equipo/update). */
	notice?: string;
	error?: string;
}

type Notify = (message: string, level?: "info" | "warning" | "error") => void;

/**
 * Reconcile al cargar (D2): plugins habilitados sin material (resources
 * borrados o máquina nueva) se re-instalan desde el marketplace clonado.
 * Best-effort: un plugin irreparable se reporta y se omite — jamás bloquea
 * la carga (misma disciplina NFR-2 de acolomba).
 */
async function reconcile(
	agentDir: string,
	reg: CcPluginsRegistry,
	cwd: string,
	notify: Notify,
	onLog?: (line: string) => void,
	deps?: import("./installer").InstallerDeps,
): Promise<void> {
	// Migración renames (#51): si el catálogo renombró/eliminó un plugin
	// instalado, seguir el map una sola vez (rewrite del registro + notice).
	for (const [name, rec] of Object.entries({ ...reg.plugins })) {
		const mktRec = reg.marketplaces[rec.marketplace];
		if (!mktRec) continue;
		const mDir = marketplaceDirOf(agentDir, mktRec);
		let renames: import("./readers").RenameMap | undefined;
		try {
			renames = readMarketplaceCatalog(mDir).renames;
		} catch {
			continue; // marketplace ilegible → reconcile estándar lo cubre
		}
		if (!renames || !(name in renames)) continue;
		const resolved = resolveRename(renames, name);
		if (resolved === null) {
			// Eliminado del catálogo: uninstall limpio + notice.
			await uninstallPlugin(agentDir, name, { reg });
			notify(
				`cc-plugins: '${name}' fue eliminado de '${rec.marketplace}' (renames) — desinstalado.`,
			);
			continue;
		}
		if (resolved === name) continue;
		await uninstallPlugin(agentDir, name, { reg });
		try {
			await installPlugin(agentDir, `${resolved}@${rec.marketplace}`, {
				cwd,
				deps,
				reg,
			});
			notify(
				`cc-plugins: '${name}' renombrado a '${resolved}' en '${rec.marketplace}' (renames).`,
			);
		} catch (e: any) {
			notify(
				`cc-plugins: migración de '${name}' a '${resolved}' falló (${e?.message ?? e}). /ccplugin add ${resolved}@${rec.marketplace} para completarla.`,
				"warning",
			);
		}
	}

	for (const [name, rec] of Object.entries(reg.plugins)) {
		if (!rec.enabled) continue;
		// Solo los plugins que declaran skills/commands materializan algo
		// (un plugin solo-MCP no tiene recursos — no requiere reconcile).
		const expectsMaterial = rec.skills.length > 0 || rec.commands.length > 0;
		if (!expectsMaterial) continue;
		// Material POR PLUGIN: el dir de prompts es compartido (plano) —
		// verificar el prefijo <plugin>- en sus archivos, no el dir entero.
		const skillsRoot = path.join(resourcesSkillsDir(agentDir), name);
		const hasSkills = (() => {
			try {
				return fs.existsSync(skillsRoot) && fs.readdirSync(skillsRoot).length > 0;
			} catch {
				return false;
			}
		})();
		const hasPrompts = (() => {
			try {
				return fs
					.readdirSync(resourcesPromptsDir(agentDir))
					.some((f) => f.startsWith(`${name}-`) && f.endsWith(".md"));
			} catch {
				return false; // dir inexistente
			}
		})();
		if (hasSkills || hasPrompts) continue;
		try {
			await installPlugin(agentDir, `${name}@${rec.marketplace}`, { cwd, deps });
			notify(
				`cc-plugins: '${name}' re-instalado desde ${rec.marketplace} (reconcile).`,
				"info",
			);
		} catch (e: any) {
			const msg = e?.message ?? String(e);
			onLog?.(`[cc-plugins] reconcile '${name}' falló: ${msg}`);
			notify(
				`cc-plugins: no se pudo re-instalar '${name}' (${msg}). /ccplugin remove ${name} para limpiar.`,
				"warning",
			);
		}
	}
}

/** Formatea la lista para notify (texto plano, cross-UI). Merge de scopes. */
function formatList(agentDir: string, cwd: string): string {
	const merged = mergeLayers(loadLayers(agentDir, cwd));
	const lines: string[] = [];
	if (merged.plugins.length === 0) {
		lines.push("Sin plugins instalados. Comienza con /ccplugin bootstrap.");
	}
	for (const p of merged.plugins) {
		const parts = [
			`${p.name}@${p.rec.marketplace}`,
			p.rec.version ? `v${p.rec.version}` : undefined,
			p.scope === "user" ? undefined : `[${p.scope}]`,
			p.rec.enabled ? undefined : "(deshabilitado)",
		].filter(Boolean);
		lines.push(`• ${parts.join(" ")}`);
		const comps = [
			p.rec.skills.length ? `${p.rec.skills.length} skills` : undefined,
			p.rec.commands.length ? `${p.rec.commands.length} commands` : undefined,
			p.rec.mcpServers.length ? `${p.rec.mcpServers.length} MCP` : undefined,
			p.rec.skipped.length ? `${p.rec.skipped.length} omitidos` : undefined,
		].filter(Boolean);
		if (comps.length) lines.push(`  ${comps.join(" · ")}`);
	}
	const mktNames = Object.keys(merged.marketplaces);
	if (mktNames.length > 0) {
		lines.push(
			`Marketplaces: ${mktNames
				.map((m) => `${m}@${merged.marketplaces[m]?.rev}`)
				.join(", ")}`,
		);
	}
	return lines.join("\n");
}

/**
 * Setup background (#49/#50): bootstrap auto del oficial, marketplaces/
 * plugins del equipo y auto-update. Se dispara UNA vez por factory (singleton
 * en el closure) desde resources_discover como fire-and-forget — NUNCA se
 * awaita: la sesión abre al instante con lo instalado (paridad Claude Code,
 * que carga plugins async y pide /reload-plugins al terminar). Los avisos
 * viajan por onStateChange.notice (el host los muestra como info).
 */
async function backgroundSetup(
	agentDir: string,
	cwd: string,
	opts: CreateCcPluginsOpts & {
		onStateChange?: (s: CcPluginsState) => void;
	},
	onLog?: (line: string) => void,
): Promise<void> {
	const notifyBg = (m: string) => {
		try {
			opts.onStateChange?.({ ready: true, notice: m });
		} catch {
			/* best-effort */
		}
	};
	// #88: PRIMERO la configuración explícita del equipo (extraMarketplaces /
	// enabledPlugins — típicamente paths locales, sin red) y DESPUÉS el
	// bootstrap del marketplace oficial. Antes el orden inverso hacía que un
	// git clone lento/caído del oficial BLOQUEARA los plugins del equipo: el
	// poll expiraba con marketplaces vacíos (flaky en red variable, dominante
	// sin red). Config explícita > default implícito.
	// Team marketplaces (settings del equipo).
	for (const ref of opts.extraMarketplaces ?? []) {
		try {
			const res = await addMarketplace(agentDir, ref, {
				cwd,
				deps: opts.deps,
			});
			notifyBg(
					`cc-plugins: marketplace del equipo '${res.name}' agregado desde settings (${res.plugins} plugins).`,
			);
		} catch (e: any) {
			onLog?.(`[cc-plugins] extraMarketplace '${ref}' falló: ${e?.message ?? e}`);
		}
	}
	// enabledPlugins: instalar los que falten.
	for (const [ref, on] of Object.entries(opts.enabledPlugins ?? {})) {
		if (!on) continue;
		const mergedNow = mergeLayers(loadLayers(agentDir, cwd));
		const [pn] = ref.split("@");
		if (mergedNow.plugins.some((p) => p.name === pn)) continue;
		try {
			const res = await installPlugin(agentDir, ref, {
				cwd,
				deps: opts.deps,
			});
			notifyBg(
				`cc-plugins: '${res.plugin}' instalado automáticamente (enabledPlugins del equipo). Ejecuta /reload para activarlo.`,
			);
		} catch (e: any) {
			onLog?.(`[cc-plugins] enabledPlugin '${ref}' falló: ${e?.message ?? e}`);
		}
	}
	// Bootstrap auto del marketplace oficial (#88: ahora DESPUÉS de la config
	// del equipo — ya no la bloquea. Si el equipo ya proveyó marketplaces, el
	// default implícito se salta: config explícita > default).
	{
		const reg = loadRegistry(agentDir);
		if (!reg.bootstrapped) {
			reg.bootstrapped = true;
			if (Object.keys(reg.marketplaces).length === 0) {
				try {
					const res = await addMarketplace(agentDir, OFFICIAL_MARKETPLACE, {
						cwd,
						deps: opts.deps,
						reg,
					});
					notifyBg(
							`cc-plugins: marketplace oficial '${res.name}' agregado automáticamente (${res.plugins} plugins). /ccplugin list --available para explorar; /ccplugin marketplace remove ${res.name} si no lo quieres.`,
					);
				} catch (e: any) {
						onLog?.(`[cc-plugins] bootstrap auto falló: ${e?.message ?? e}`);
				}
			} else {
				saveRegistry(agentDir, reg);
			}
		}
	}
	// Auto-update al final (con su delay propio).
	await autoUpdateTick(
		agentDir,
		cwd,
		(m) => notifyBg(m),
		onLog,
		opts.deps,
		opts.autoUpdateDelayMs ?? 5_000,
	);
}

/**
 * Auto-update background (#50 F5): para cada marketplace con autoUpdate on,
 * re-clone (idempotente) y compara revs; si cambió, re-instala los plugins
 * instalados desde él + notifica /reload. Delay inicial (5s) para no
 * competir con el arranque (paridad Claude: random ≤10min — aquí fijo).
 */
async function autoUpdateTick(
	agentDir: string,
	cwd: string,
	notify: Notify,
	onLog?: (line: string) => void,
	deps?: import("./installer").InstallerDeps,
	delayMs = 5_000,
): Promise<void> {
	await new Promise((r) => setTimeout(r, delayMs));
	const layers = loadLayers(agentDir, cwd);
	const merged = mergeLayers(layers);
	for (const [name, m] of Object.entries(merged.marketplaces)) {
		if (!m.autoUpdate || m.local) continue;
		try {
			const before = m.rev;
			const res = await addMarketplace(agentDir, `${m.url}${m.ref ? `#${m.ref}` : ""}`, {
				cwd,
				deps,
			});
			if (res.rev === before) continue;
			// Rev nueva: re-instalar los plugins de este marketplace.
			let updated = 0;
			for (const p of merged.plugins) {
				if (p.rec.marketplace !== name) continue;
				try {
					await installPlugin(agentDir, `${p.name}@${name}`, {
						cwd,
						deps,
						scope: p.scope,
					});
					updated++;
				} catch (e: any) {
					onLog?.(`[cc-plugins] auto-update '${p.name}' falló: ${e?.message ?? e}`);
				}
			}
			if (updated > 0) {
				notify(
					`cc-plugins: '${name}' actualizado (${before} → ${res.rev}); ${updated} plugin(s) re-instalados. Ejecuta /reload para aplicar.`,
				);
			}
		} catch (e: any) {
			onLog?.(`[cc-plugins] auto-update '${name}' falló: ${e?.message ?? e}`);
		}
	}
}

/** Acciones del QuickPick (cierre sobre agentDir/workCwd). */
/** ~1.2k / ~890 formato compacto de tokens. */
function fmtTokens(n: number): string {
	return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** Ficha markdown de un plugin DEL CATÁLOGO (disponible/pre-install). */
function catalogRowMarkdown(agentDir: string, ref: string): string {
	const cat = pluginCatalogInfo(agentDir, ref);
	const c = cat.components;
	const lines = [
		`## ${cat.name}${cat.version ? ` v${cat.version}` : ""}`,
		"",
		`${cat.marketplace}${cat.remote ? " · source remoto" : ""}`,
		"",
	];
	if (cat.description) lines.push(cat.description, "");
	if (c) {
		lines.push(
			`**instalará**: ${c.skills.length} skills · ${c.commands.length} commands · ${c.mcpServers.length} MCP`,
		);
		if (c.estimatedTokens)
			lines.push(`**contexto**: ~${fmtTokens(c.estimatedTokens)} tokens/turno`);
		if (c.skills.length) lines.push(`skills: ${c.skills.join(", ")}`);
		if (c.commands.length) lines.push(`commands: ${c.commands.join(", ")}`);
		if (c.mcpServers.length) lines.push(`MCP: ${c.mcpServers.join(", ")}`);
		if (c.skipped.length)
			lines.push(`omitidos: ${c.skipped.map((s) => s.kind).join(", ")}`);
	}
	return lines.join("\n");
}

/** Ficha markdown de un plugin INSTALADO (registry rec). */
function installedRowMarkdown(p: ScopedPlugin, installPath: string): string {
	const r = p.rec;
	const lines = [
		`## ${p.name}${r.version ? ` v${r.version}` : ""}`,
		"",
		`${r.marketplace} · scope ${p.scope}${r.enabled ? "" : " · deshabilitado"}`,
		"",
	];
	if (r.description) lines.push(r.description, "");
	lines.push(
		`**instalado**: ${r.skills.length} skills · ${r.commands.length} commands · ${r.mcpServers.length} MCP`,
	);
	if (r.estimatedTokens)
		lines.push(`**contexto**: ~${fmtTokens(r.estimatedTokens)} tokens/turno`);
	if (r.skills.length) lines.push(`skills: ${r.skills.join(", ")}`);
	if (r.commands.length) lines.push(`commands: ${r.commands.join(", ")}`);
	if (r.mcpServers.length) lines.push(`MCP: ${r.mcpServers.join(", ")}`);
	lines.push(`path: ${installPath}`);
	return lines.join("\n");
}

/** "hace 2 días" — relativo en español (refreshedAt / when del panel). */
function relativeEs(iso?: string): string | undefined {
	if (!iso) return undefined;
	const t = Date.parse(iso);
	if (!Number.isFinite(t)) return undefined;
	const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
	if (s < 120) return "hace un momento";
	const m = Math.floor(s / 60);
	if (m < 60) return `hace ${m} min`;
	const h = Math.floor(m / 60);
	if (h < 24) return `hace ${h} h`;
	const d = Math.floor(h / 24);
	if (d < 7) return `hace ${d} día${d === 1 ? "" : "s"}`;
	const w = Math.floor(d / 7);
	if (w < 5) return `hace ${w} sem`;
	return `hace ${Math.floor(d / 30)} mes(es)`;
}

/** Errores runtime del panel (tab Errores — no persisten; últimos 20). */
interface PanelErrors {
	list(): import("./panel").CcPanelError[];
	push(
		source: import("./panel").CcPanelError["source"],
		message: string,
	): void;
	clear(source: import("./panel").CcPanelError["source"]): void;
}
function createPanelErrors(): PanelErrors {
	const items: import("./panel").CcPanelError[] = [];
	let n = 0;
	return {
		list: () => items.slice(),
		push: (source, message) => {
			items.push({
				id: `err-${++n}`,
				when: relativeEs(new Date().toISOString()) ?? "hace un momento",
				source,
				message,
			});
			if (items.length > 20) items.shift();
		},
		clear: (source) => {
			for (let i = items.length - 1; i >= 0; i--)
				if (items[i].source === source) items.splice(i, 1);
		},
	};
}

/** Filas de la tab Instalados (merge de scopes). */
function buildInstalledRows(
	agentDir: string,
	cwd: string,
): import("./panel").CcPanelRow[] {
	return mergeLayers(loadLayers(agentDir, cwd)).plugins.map(
		(p): import("./panel").CcPanelRow => {
			const installPath = path.join(
				installedDir(agentDir),
				`${p.name}@${p.rec.rev}`,
			);
			return ({
			ref: `${p.name}@${p.rec.marketplace}`,
			label: p.scope === "user" ? p.name : `${p.name} [${p.scope}]`,
			version: p.rec.version,
			status: p.rec.enabled ? "installed" : "disabled",
			markdown: installedRowMarkdown(p, installPath),
			// Datos para la fila y la vista completa (UX Instalados v3):
			components: [
				...(p.rec.skills.length ? ["skill"] : []),
				...(p.rec.commands.length ? ["cmd"] : []),
				...(p.rec.mcpServers.length ? ["mcp"] : []),
			],
			tokens: p.rec.estimatedTokens,
			path: installPath,
				description: p.rec.description,
			});
		},
	);
}

/**
 * Recursos instalados por tipo (lista de la tab Instalados — paridad con el
 * Installed de /plugins de Claude Code, que lista skills una por una):
 * el plugin es el ORIGEN; estado/toggle son del plugin completo.
 */
function buildInstalledResources(
	agentDir: string,
	cwd: string,
): import("./panel").CcInstalledResource[] {
	const out: import("./panel").CcInstalledResource[] = [];
	for (const p of mergeLayers(loadLayers(agentDir, cwd)).plugins) {
		const status: "installed" | "disabled" = p.rec.enabled
			? "installed"
			: "disabled";
		const pluginRef = `${p.name}@${p.rec.marketplace}`;
		for (const name of p.rec.skills) {
			const source = name.slice(p.name.length + 1);
			const md = path.join(
				resourcesSkillsDir(agentDir),
				p.name,
				source,
				"SKILL.md",
			);
			out.push({
				pluginRef,
				plugin: p.name,
				name,
				kind: "skill",
				status,
				tokens: fileTokens(md),
				path: md,
				description: resourceDescription(md),
			});
		}
		for (const name of p.rec.commands) {
			const md = path.join(resourcesPromptsDir(agentDir), `${name}.md`);
			out.push({
				pluginRef,
				plugin: p.name,
				name,
				kind: "cmd",
				status,
				tokens: fileTokens(md),
				path: md,
				description: resourceDescription(md),
			});
		}
		for (const name of p.rec.mcpServers) {
			out.push({
				pluginRef,
				plugin: p.name,
				name,
				kind: "mcp",
				status,
				path: fridaMcpConfigPath(agentDir),
			});
		}
	}
	return out;
}

/** bytes/4 ≈ tokens (best-effort: archivo ausente → undefined). */
function fileTokens(p: string): number | undefined {
	try {
		return Math.ceil(fs.statSync(p).size / 4);
	} catch {
		return undefined;
	}
}

/**
 * Descripción del recurso: frontmatter `description:` (skills) o primer
 * párrafo no-heading (commands). Best-effort.
 */
function resourceDescription(p: string): string | undefined {
	try {
		const raw = fs.readFileSync(p, "utf-8");
		const fm = raw.match(/^---\n([\s\S]*?)\n---/);
		if (fm) {
			const d = fm[1]!.match(/^description:\s*(.+)$/m);
			if (d) return d[1]!.trim().replace(/^["']|["']$/g, "");
		}
		const body = raw.replace(/^---[\s\S]*?\n---\n?/, "");
		const first = body
			.split("\n")
			.map((l) => l.trim())
			.find((l) => l && !l.startsWith("#") && !l.startsWith("---"));
		return first?.replace(/^#+\s*/, "");
	} catch {
		return undefined;
	}
}

/**
 * Acciones del panel (host-side; el webview las invoca por id/ref).
 * `refresh` re-emite el panel (mismo id → el webview conserva tab/filtro).
 */
function panelActions(
	agentDir: string,
	workCwd: string,
	refresh: () => void,
	errs: PanelErrors,
): import("./panel").CcPanelActions {
	return {
		install: async (ref) => {
			const res = await installPlugin(agentDir, ref, { cwd: workCwd });
			refresh();
			return `Plugin '${res.plugin}' instalado (${res.skills.length} skills, ${res.commands.length} commands, ${res.mcpServers.length} MCP). Ejecuta /reload para activarlo.`;
		},
		uninstall: async (ref) => {
			const name = ref.split("@")[0]!;
			await uninstallPlugin(agentDir, name, { cwd: workCwd });
			refresh();
			return `Plugin '${name}' desinstalado. Ejecuta /reload.`;
		},
		toggle: async (ref, enable) => {
			const name = ref.split("@")[0]!;
			setPluginEnabled(agentDir, name, enable, { cwd: workCwd });
			refresh();
			return `Plugin '${name}' ${enable ? "habilitado" : "deshabilitado"}. Ejecuta /reload.`;
		},
		marketplaceAdd: async (spec) => {
			const res = await addMarketplace(agentDir, spec, { cwd: workCwd });
			errs.clear("marketplace");
			refresh();
			return `Marketplace '${res.name}' agregado (${res.plugins} plugins).`;
		},
		marketplaceRemove: async (name) => {
			const n = await removeMarketplace(agentDir, name);
			refresh();
			return `Marketplace eliminado (+${n} plugins desinstalados). Ejecuta /reload.`;
		},
		marketplaceUpdate: async (name) => {
			const reg = loadRegistry(agentDir);
			const targets = name
				? Object.entries(reg.marketplaces).filter(([n]) => n === name)
				: Object.entries(reg.marketplaces);
			for (const [, m] of targets)
				await addMarketplace(agentDir, m.url, { cwd: workCwd });
			errs.clear("marketplace");
			refresh();
			return `${targets.length} marketplace(s) actualizados.`;
		},
		rowMeta: (ref) => pluginLastUpdated(agentDir, ref, { cwd: workCwd }),
		refresh,
		retry: async (source) => {
			if (source === "bootstrap") {
				await addMarketplace(agentDir, OFFICIAL_MARKETPLACE, { cwd: workCwd });
				errs.clear("bootstrap");
				refresh();
				return "Bootstrap completado.";
			}
			if (source === "marketplace") {
				const reg = loadRegistry(agentDir);
				for (const [, m] of Object.entries(reg.marketplaces))
					await addMarketplace(agentDir, m.url, { cwd: workCwd });
				errs.clear("marketplace");
				refresh();
				return "Marketplaces actualizados.";
			}
			return "Reintenta el comando correspondiente.";
		},
	};
}

/**
 * Emite el panel nativo del webview (tabs completas): discover via
 * `buildRows`; instalados/marketplaces/errores se computan aquí SIEMPRE.
 * `buildRows` se re-invoca en cada refresh (tras una acción) para re-emitir
 * filas frescas CON EL MISMO id — el componente conserva tab y filtro.
 * Devuelve false si no hay sink (tests/TUI) → fallback notify.
 */
/** Filas de Discover: TODO el catálogo (opcionalmente de un marketplace). */
function availableRows(
	agentDir: string,
	marketplace?: string,
): import("./panel").CcPanelRow[] {
	return listAvailable(agentDir, { marketplace }).map(
		(a): import("./panel").CcPanelRow => ({
			ref: `${a.name}@${a.marketplace}`,
			label:
				a.displayName && a.displayName !== a.name
					? `${a.name} — ${a.displayName}`
					: a.name,
			version: a.version,
			status: a.installed
				? a.enabled
					? "installed"
					: "disabled"
				: "available",
			markdown: catalogRowMarkdown(agentDir, `${a.name}@${a.marketplace}`),
			category: a.category,
			author: a.author,
			homepage: a.homepage,
		}),
	);
}

function emitPanel(
	sink: import("./panel").CcPanelSink | undefined,
	agentDir: string,
	cwd: string | undefined,
	id: string,
	title: string,
	buildRows: () => import("./panel").CcPanelRow[],
	errs: PanelErrors,
): boolean {
	if (!sink) return false;
	const refresh = () =>
		emitPanel(sink, agentDir, cwd, id, title, buildRows, errs);
	const workCwd = cwd ?? process.cwd();
	const counts = new Map<string, number>();
	for (const a of listAvailable(agentDir))
		counts.set(a.marketplace, (counts.get(a.marketplace) ?? 0) + 1);
	const marketplaces: import("./panel").CcMarketplaceInfo[] = Object.entries(
		loadRegistry(agentDir).marketplaces,
	).map(([n, m]) => ({
		name: n,
		url: m.url,
		plugins: counts.get(n) ?? 0,
		refreshedAt: relativeEs(m.refreshedAt),
		autoUpdate: !!m.autoUpdate,
	}));
	sink({
		id,
		title,
		rows: buildRows(),
		installed: buildInstalledRows(agentDir, workCwd),
		resources: buildInstalledResources(agentDir, workCwd),
		marketplaces,
		errors: errs.list(),
		actions: panelActions(agentDir, workCwd, refresh, errs),
	});
	return true;
}

/** Registra el comando /ccplugin con sus subcomandos. */
function registerCommand(
	pi: ExtensionAPI,
	opts: CreateCcPluginsOpts,
	errs: PanelErrors,
): void {
	const { agentDir, cwd, onLog, presenter, panel } = opts;
	pi.registerCommand(CC_PLUGINS_COMMAND, {
		description:
			"Gestiona marketplaces y plugins de Claude Code (add/remove/list/enable/disable/marketplace/bootstrap)",
		handler: async (args: string, ctx) => {
			const workCwd = cwd ?? ctx.cwd;
			const raw = (args ?? "").trim();
			const [sub, ...rest] = raw.split(/\s+/);
			const notifyCtx: Notify = (m, l) => ctx.ui.notify(m, l ?? "info");
			try {
				switch (sub) {
					case "":
					case "list": {
						const flags = rest.filter((a) => a.startsWith("--"));
						const positional = rest.filter((a) => !a.startsWith("--"));
						if (flags.includes("--available")) {
							const avail = listAvailable(agentDir, {
								marketplace: positional[0],
							});
							const line = (a: (typeof avail)[number]) =>
								`• ${a.name}@${a.marketplace}${a.version ? ` v${a.version}` : ""}${a.displayName && a.displayName !== a.name ? ` — ${a.displayName}` : ""}${a.installed ? (a.enabled ? " (instalado)" : " (instalado, deshabilitado)") : ""}${a.remote ? " [source remoto]" : ""}`;
							const body =
								avail.length
									? avail.map(line).join("\n")
									: "Sin plugins disponibles en los marketplaces registrados.";
							// UX #49 (rediseño e2e): panel nativo del webview — lista
							// filtrable con teclado + ficha lado a lado. Output channel
							// como log silencioso. Sin sink: notify (tests/TUI).
							presenter?.append([
								`$ ccplugin list --available`,
								...body.split("\n"),
								"",
							]);
							const mktFilter = positional[0];
							const buildAvailRows = () =>
								availableRows(agentDir, mktFilter);
							if (
								!emitPanel(
									panel,
									agentDir,
									workCwd,
									randomUUID(),
									`Disponibles (${avail.length})`,
									buildAvailRows,
									errs,
								)
							) {
								notifyCtx(body); // fallback: toast (tests/sin VS Code)
							}
							return;
						}
						if (flags.includes("--enabled") || flags.includes("--disabled")) {
							const wantEnabled = flags.includes("--enabled");
							const filtered = mergeLayers(
								loadLayers(agentDir, workCwd),
							).plugins.filter((p) => p.rec.enabled === wantEnabled);
							notifyCtx(
								filtered.length
									? filtered
											.map((p) => `• ${p.name}@${p.rec.marketplace}`)
											.join("\n")
									: `Sin plugins ${wantEnabled ? "habilitados" : "deshabilitados"}.`,
							);
							return;
						}
						const bodyList = formatList(agentDir, workCwd);
						presenter?.append([
							`$ ccplugin list`,
							...bodyList.split("\n"),
							"",
						]);
						// Panel multitab: Discover siempre muestra TODO el
						// catálogo (rows), independiente del subcomando de
						// origen — la vista de instalados viaja aparte
						// (installed/resources). Fix: '/ccplugin' a secas
						// dejaba Discover vacío al no haber plugins instalados.
						if (
							!emitPanel(
								panel,
								agentDir,
								workCwd,
								randomUUID(),
								`Instalados (${mergeLayers(loadLayers(agentDir, workCwd)).plugins.length})`,
								() => availableRows(agentDir),
								errs,
							)
						) {
							notifyCtx(bodyList);
						}
						return;
					}
					case "bootstrap": {
						const res = await addMarketplace(agentDir, OFFICIAL_MARKETPLACE, {
							cwd: workCwd,
						});
						// El oficial auto-actualiza por default (paridad Claude).
						setMarketplaceAutoUpdate(agentDir, res.name, true);
						notifyCtx(
							`Marketplace '${res.name}' agregado (${res.plugins} plugins). Instala con /ccplugin add <plugin>@${res.name}.`,
						);
						return;
					}
					case "marketplace": {
						const [msub, ...mrest] = rest;
						if (msub === "add") {
							const res = await addMarketplace(agentDir, mrest[0] ?? "", {
								cwd: workCwd,
							});
							notifyCtx(
								`Marketplace '${res.name}' agregado (${res.plugins} plugins).`,
							);
						} else if (msub === "list" || msub === "ls") {
							const reg = loadRegistry(agentDir);
							const ms = Object.entries(reg.marketplaces)
								.map(([n, m]) => `• ${n} @${m.rev}${m.autoUpdate ? " (auto-update)" : ""} — ${m.url}`)
								.join("\n");
							notifyCtx(
								ms || "Sin marketplaces. /ccplugin bootstrap para el oficial.",
							);
						} else if (msub === "remove" || msub === "rm") {
							const n = await removeMarketplace(agentDir, mrest[0] ?? "");
							notifyCtx(
								`Marketplace eliminado (+${n} plugins desinstalados). Ejecuta /reload.`,
							);
						} else if (msub === "autoupdate" || msub === "noautoupdate") {
							if (!mrest[0]) {
								notifyCtx(
									`Uso: /ccplugin marketplace ${msub} <nombre>`,
									"warning",
								);
								return;
							}
							setMarketplaceAutoUpdate(
								agentDir,
								mrest[0],
								msub === "autoupdate",
							);
							notifyCtx(
								`Auto-update ${msub === "autoupdate" ? "habilitado" : "deshabilitado"} para '${mrest[0]}'.`,
							);
						} else if (msub === "update") {
							// Re-add = clone fresco (los plugins instalados conservan su rev).
							const reg = loadRegistry(agentDir);
							const targets = mrest[0]
								? Object.entries(reg.marketplaces).filter(([n]) => n === mrest[0])
								: Object.entries(reg.marketplaces);
							for (const [, m] of targets) {
								await addMarketplace(agentDir, m.url, { cwd: workCwd });
							}
							notifyCtx(
								`${targets.length} marketplace(s) actualizados. /ccplugin update <plugin> para aplicar versiones.`,
							);
						} else {
							notifyCtx(
								"Uso: /ccplugin marketplace add|list|remove|update [args]",
								"warning",
							);
						}
						return;
					}
					case "add":
					case "install": {
						const aflags = rest.filter((a) => a.startsWith("--"));
						const apos = rest.filter((a) => !a.startsWith("--"));
						const scopeEq = aflags
							.find((a) => a.startsWith("--scope="))
							?.slice("--scope=".length);
						const scopeIdx = rest.indexOf("--scope");
						const scope =
							scopeEq ?? (scopeIdx >= 0 ? rest[scopeIdx + 1] : undefined);
						if (!apos[0]) {
							notifyCtx(
								"Uso: /ccplugin add <plugin>@<marketplace> [--scope user|project|local]",
								"warning",
							);
							return;
						}
						if (scope && !["user", "project", "local"].includes(scope)) {
							notifyCtx(`Scope inválido '${scope}' (user|project|local)`, "warning");
							return;
						}
						const res = await installPlugin(agentDir, apos[0], {
							cwd: workCwd,
							...(scope
								? { scope: scope as "user" | "project" | "local" }
								: {}),
						});
						const skippedNote = res.skipped.length
							? ` · omitidos: ${res.skipped.map((s) => s.kind).join(", ")}`
							: "";
						notifyCtx(
							`Plugin '${res.plugin}' instalado${scope ? ` (scope ${scope})` : ""}: ${res.skills.length} skills, ${res.commands.length} commands, ${res.mcpServers.length} MCP${skippedNote}. Ejecuta /reload para activarlo.`,
						);
						return;
					}
					case "remove":
					case "uninstall": {
						if (!rest[0]) {
							notifyCtx("Uso: /ccplugin remove <plugin>", "warning");
							return;
						}
						await uninstallPlugin(agentDir, rest[0], { cwd: workCwd });
						notifyCtx(`Plugin '${rest[0]}' desinstalado. Ejecuta /reload.`);
						return;
					}
					case "enable":
					case "disable": {
						if (!rest[0]) {
							notifyCtx(`Uso: /ccplugin ${sub} <plugin>`, "warning");
							return;
						}
						setPluginEnabled(agentDir, rest[0], sub === "enable", {
							cwd: workCwd,
						});
						notifyCtx(
							`Plugin '${rest[0]}' ${sub === "enable" ? "habilitado" : "deshabilitado"}. Ejecuta /reload.`,
						);
						return;
					}
					case "info": {
						// UX #49: ficha en el panel nativo (fila única — el detalle
						// queda visible lado a lado, sin toasts).
						if (rest[0] && !rest[0].includes("--") && panel) {
							const arg = rest[0];
							try {
								// Ref explícito (name@marketplace) o búsqueda por
								// nombre en TODOS los marketplaces registrados.
								const hit = arg.includes("@")
									? undefined
									: listAvailable(agentDir, {}).find(
											(a) => a.name === arg,
										);
								const ref = hit
									? `${hit.name}@${hit.marketplace}`
									: arg;
								const cat = pluginCatalogInfo(agentDir, ref);
								const status = hit
									? hit.installed
										? (hit.enabled ? "installed" : "disabled")
										: "available"
									: "available";
								emitPanel(
									panel,
									agentDir,
									workCwd,
									randomUUID(),
									`Info ${cat.name}`,
									() => [
										{
											ref: `${cat.name}@${cat.marketplace}`,
											label: cat.name,
											version: cat.version,
											status,
											markdown: catalogRowMarkdown(agentDir, ref),
											category: hit?.category,
											author: hit?.author,
											homepage: hit?.homepage,
										},
									],
									errs,
								);
								return;
							} catch (e: any) {
								notifyCtx(`cc-plugins: ${e?.message ?? e}`, "error");
							}
						}
						const p: ScopedPlugin | undefined = mergeLayers(
							loadLayers(agentDir, workCwd),
						).plugins.find((sp) => sp.name === rest[0]);
						if (!p) {
							// Paridad Discover: detalle PRE-INSTALL desde el catálogo.
							const cat = pluginCatalogInfo(agentDir, rest[0] ?? "");
							const lines = [
								`${cat.name}@${cat.marketplace}${cat.version ? ` v${cat.version}` : ""} (no instalado)`,
								cat.description,
								cat.remote
									? `source remoto (${cat.remote}) — fetch en fase 2`
									: undefined,
								cat.components
									? `instalará: ${cat.components.skills.length} skills, ${cat.components.commands.length} commands, ${cat.components.mcpServers.length} MCP${cat.components.estimatedTokens ? ` (~${cat.components.estimatedTokens} tokens/turno aprox.)` : ""}`
									: undefined,
								cat.components?.skipped.length
									? `omitidos: ${cat.components.skipped.map((s) => s.kind).join(", ")}`
									: undefined,
							].filter(Boolean);
							notifyCtx(lines.join("\n"));
							return;
						}
						const { name: n, rec: r, scope } = p;
						notifyCtx(
							[
								`${n}@${r.marketplace} v${r.version ?? "?"} (rev ${r.rev}) [scope ${scope}]`,
								`skills: ${r.skills.join(", ") || "—"}`,
								`commands: ${r.commands.join(", ") || "—"}`,
								`MCP: ${r.mcpServers.join(", ") || "—"}`,
								r.skipped.length
									? `omitidos:\n${r.skipped.map((s) => `  - ${s.kind}: ${s.reason}`).join("\n")}`
									: undefined,
							]
								.filter(Boolean)
								.join("\n"),
						);
						return;
					}
					case "validate": {
						if (!rest[0]) {
							notifyCtx(
								"Uso: /ccplugin validate <dir-del-marketplace|plugin>",
								"warning",
							);
							return;
						}
						const target = path.resolve(rest[0]);
						const report = validateMarketplaceDir(target);
						for (const line of report.lines) notifyCtx(line.text, line.level);
						notifyCtx(
							report.ok
								? `✔ Validación ${report.errors === 0 ? "sin errores" : "con errores"}: ${report.checks} checks, ${report.warnings} warnings, ${report.errors} errores.`
								: `✖ Validación fallida: ${report.errors} error(es).`,
							report.errors > 0 ? "error" : report.warnings > 0 ? "warning" : "info",
						);
						return;
					}
					default:
						notifyCtx(
							"Subcomandos: list | add | remove | enable | disable | info | validate | marketplace | bootstrap",
							"warning",
						);
				}
			} catch (e: any) {
				const msg = e?.message ?? String(e);
				onLog?.(`[cc-plugins] ${sub} falló: ${msg}`);
				notifyCtx(`cc-plugins: ${msg}`, "error");
				if (e?.guide) notifyCtx(`Guía: ${e.guide}`, "info");
				errs.push(
					sub === "marketplace" ? "marketplace" : "install",
					msg,
				);
			}
		},
	});
}

/**
 * Factory embebida para extensionFactories (src/pi-session.ts). El gate
 * frida.ccPlugins.enabled lo aplica el caller. Main only (D8).
 */
export function createFridaCcPlugins(
	opts: CreateCcPluginsOpts & {
		onStateChange?: (s: CcPluginsState) => void;
	},
) {
	const { agentDir, onLog, onStateChange } = opts;
	// Errores runtime (tab Errores del panel #49): compartidos por el
	// discover (backgroundSetup) y el comando /ccplugin.
	const errs = createPanelErrors();
	// Singleton del setup background: un solo disparo por factory (los
	// discovers repetidos no relanzan bootstrap/installs).
	let bgStarted = false;
	return async (pi: ExtensionAPI): Promise<void> => {
		// Recursos declarativos: crear dirs base (idempotente).
		fs.mkdirSync(resourcesSkillsDir(agentDir), { recursive: true });
		fs.mkdirSync(resourcesPromptsDir(agentDir), { recursive: true });

		// resources_discover: exponer skills/prompts de plugins habilitados.
		pi.on("resources_discover", async (_event, ctx) => {
			const cwd = opts.cwd ?? ctx.cwd;
			const notify: Notify = (m, l) => {
				try {
					ctx.ui.notify(m, l ?? "info");
				} catch {
					/* UI no disponible (RPC) — el estado queda en el log */
				}
			};
			const reg = loadRegistry(agentDir);
			// Setup background (bootstrap auto + equipo + auto-update):
			// fire-and-forget con singleton — NUNCA en el camino awaitado del
			// discover (bug: git lento colgaba la carga de la sesión).
			if (!bgStarted) {
				bgStarted = true;
				void backgroundSetup(agentDir, cwd, opts, onLog).catch((e: any) => {
					onLog?.(`[cc-plugins] background setup falló: ${e?.message ?? e}`);
					errs.push("bootstrap", String(e?.message ?? e));
				});
			}

			// Reconcile self-healing (best-effort, nunca bloquea la carga).
			await reconcile(agentDir, reg, cwd, notify, onLog, opts.deps);

			// Plugins habilitados del MERGE de scopes (precedencia por nombre).
			const mergedView = mergeLayers(loadLayers(agentDir, cwd));
			const skillPaths: string[] = [];
			const promptPaths: string[] = [];
			for (const { name, rec } of mergedView.plugins) {
				if (!rec.enabled) continue;
				const skillsRoot = path.join(resourcesSkillsDir(agentDir), name);
				if (fs.existsSync(skillsRoot)) {
					for (const s of fs.readdirSync(skillsRoot)) {
						const dir = path.join(skillsRoot, s);
						if (fs.statSync(dir).isDirectory()) skillPaths.push(dir);
					}
				}
			}
			// Prompts: TODOS los habilitados comparten el dir plano filtrado por
			// prefijo — el loader acepta archivos sueltos; listamos los del plugin.
			const promptsRoot = resourcesPromptsDir(agentDir);
			const enabledPrefixes = mergedView.plugins
				.filter((p) => p.rec.enabled)
				.map((p) => `${p.name}-`);
			if (fs.existsSync(promptsRoot)) {
				for (const f of fs.readdirSync(promptsRoot)) {
					if (f.endsWith(".md") && enabledPrefixes.some((p) => f.startsWith(p))) {
						promptPaths.push(path.join(promptsRoot, f));
					}
				}
			}
			onStateChange?.({
				ready: true,
				marketplaces: Object.keys(mergedView.marketplaces).length,
				plugins: mergedView.plugins.length,
			});
			return { skillPaths, promptPaths };
		});

		registerCommand(pi, opts, errs);
		onLog?.(
			`[cc-plugins] extensión activa (registry: ${registryPath(agentDir)}).`,
		);
	};
}

export { CC_PLUGINS_FACTORY_NAME };
