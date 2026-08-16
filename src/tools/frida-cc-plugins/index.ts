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
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
	CC_PLUGINS_COMMAND,
	CC_PLUGINS_FACTORY_NAME,
	OFFICIAL_MARKETPLACE,
	registryPath,
	resourcesPromptsDir,
	resourcesSkillsDir,
} from "./constants";
import {
	addMarketplace,
	installPlugin,
	listAvailable,
	listInstalled,
	pluginCatalogInfo,
	removeMarketplace,
	setPluginEnabled,
	uninstallPlugin,
} from "./installer";
import { validateMarketplaceDir } from "./validate";
import { readMarketplaceCatalog, type RenameMap } from "./readers";
import { marketplaceDirOf, resolveRename } from "./installer";
import {
	loadRegistry,
	saveRegistry,
	type CcPluginsRegistry,
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
}

/** Estado del wrapper para el host (notificaciones). */
export interface CcPluginsState {
	ready: boolean;
	marketplaces: number;
	plugins: number;
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

/** Formatea la lista para notify (texto plano, cross-UI). */
function formatList(agentDir: string, reg: CcPluginsRegistry): string {
	const lines: string[] = [];
	const installed = listInstalled(agentDir, reg);
	if (installed.length === 0) {
		lines.push("Sin plugins instalados. Comienza con /ccplugin bootstrap.");
	}
	for (const p of installed) {
		const parts = [
			`${(p as unknown as { plugin: string }).plugin}@${p.marketplace}`,
			p.version ? `v${p.version}` : undefined,
			p.enabled ? undefined : "(deshabilitado)",
		].filter(Boolean);
		lines.push(`• ${parts.join(" ")}`);
		const comps = [
			p.skills.length ? `${p.skills.length} skills` : undefined,
			p.commands.length ? `${p.commands.length} commands` : undefined,
			p.mcpServers.length ? `${p.mcpServers.length} MCP` : undefined,
			p.skipped.length ? `${p.skipped.length} omitidos` : undefined,
		].filter(Boolean);
		if (comps.length) lines.push(`  ${comps.join(" · ")}`);
	}
	if (Object.keys(reg.marketplaces).length > 0) {
		lines.push(
			`Marketplaces: ${Object.keys(reg.marketplaces)
				.map((m) => `${m}@${reg.marketplaces[m]?.rev}`)
				.join(", ")}`,
		);
	}
	return lines.join("\n");
}

/** Registra el comando /ccplugin con sus subcomandos. */
function registerCommand(pi: ExtensionAPI, opts: CreateCcPluginsOpts): void {
	const { agentDir, cwd, onLog } = opts;
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
							notifyCtx(
								avail.length
									? avail
											.map(
												(a) =>
													`• ${a.name}@${a.marketplace}${a.version ? ` v${a.version}` : ""}${a.displayName && a.displayName !== a.name ? ` — ${a.displayName}` : ""}${a.installed ? (a.enabled ? " (instalado)" : " (instalado, deshabilitado)") : ""}${a.remote ? " [remoto: fase 2]" : ""}`,
											)
											.join("\n")
									: "Sin plugins disponibles en los marketplaces registrados.",
							);
							return;
						}
						if (flags.includes("--enabled") || flags.includes("--disabled")) {
							const wantEnabled = flags.includes("--enabled");
							const reg = loadRegistry(agentDir);
							const filtered = listInstalled(agentDir, reg).filter(
								(p) =>
									(p as unknown as { plugin: string; enabled: boolean }).enabled ===
									wantEnabled,
							);
							notifyCtx(
								filtered.length
									? filtered
											.map(
													(p) =>
														`• ${(p as unknown as { plugin: string }).plugin}@${p.marketplace}`,
											)
											.join("\n")
									: `Sin plugins ${wantEnabled ? "habilitados" : "deshabilitados"}.`,
							);
							return;
						}
						notifyCtx(formatList(agentDir, loadRegistry(agentDir)));
						return;
					}
					case "bootstrap": {
						const res = await addMarketplace(agentDir, OFFICIAL_MARKETPLACE, {
							cwd: workCwd,
						});
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
								.map(([n, m]) => `• ${n} @${m.rev} — ${m.url}`)
								.join("\n");
							notifyCtx(
								ms || "Sin marketplaces. /ccplugin bootstrap para el oficial.",
							);
						} else if (msub === "remove" || msub === "rm") {
							const n = await removeMarketplace(agentDir, mrest[0] ?? "");
							notifyCtx(
								`Marketplace eliminado (+${n} plugins desinstalados). Ejecuta /reload.`,
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
						if (!rest[0]) {
							notifyCtx("Uso: /ccplugin add <plugin>@<marketplace>", "warning");
							return;
						}
						const res = await installPlugin(agentDir, rest[0], {
							cwd: workCwd,
						});
						const skippedNote = res.skipped.length
							? ` · omitidos: ${res.skipped.map((s) => s.kind).join(", ")}`
							: "";
						notifyCtx(
							`Plugin '${res.plugin}' instalado: ${res.skills.length} skills, ${res.commands.length} commands, ${res.mcpServers.length} MCP${skippedNote}. Ejecuta /reload para activarlo.`,
						);
						return;
					}
					case "remove":
					case "uninstall": {
						if (!rest[0]) {
							notifyCtx("Uso: /ccplugin remove <plugin>", "warning");
							return;
						}
						await uninstallPlugin(agentDir, rest[0]);
						notifyCtx(`Plugin '${rest[0]}' desinstalado. Ejecuta /reload.`);
						return;
					}
					case "enable":
					case "disable": {
						if (!rest[0]) {
							notifyCtx(`Uso: /ccplugin ${sub} <plugin>`, "warning");
							return;
						}
						setPluginEnabled(agentDir, rest[0], sub === "enable");
						notifyCtx(
							`Plugin '${rest[0]}' ${sub === "enable" ? "habilitado" : "deshabilitado"}. Ejecuta /reload.`,
						);
						return;
					}
					case "info": {
						const reg = loadRegistry(agentDir);
						const p = Object.entries(reg.plugins).find(
							([n]) => n === rest[0],
						);
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
									? `instalará: ${cat.components.skills.length} skills, ${cat.components.commands.length} commands, ${cat.components.mcpServers.length} MCP`
									: undefined,
								cat.components?.skipped.length
									? `omitidos: ${cat.components.skipped.map((s) => s.kind).join(", ")}`
									: undefined,
							].filter(Boolean);
							notifyCtx(lines.join("\n"));
							return;
						}
						const [n, r] = p;
						notifyCtx(
							[
								`${n}@${r.marketplace} v${r.version ?? "?"} (rev ${r.rev})`,
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
			let reg = loadRegistry(agentDir);
			// Bootstrap auto (paridad Claude: el oficial se agrega en el primer
			// arranque). Intento ÚNICO (bootstrapped), best-effort: offline no
			// bloquea la carga — el usuario puede /ccplugin bootstrap manual.
			if (!reg.bootstrapped) {
				reg.bootstrapped = true;
				if (Object.keys(reg.marketplaces).length === 0) {
					try {
						// reg (bootstrapped=true ya mutado) viaja al save interno:
						// persiste marketplace + flag en una sola escritura.
						const res = await addMarketplace(agentDir, OFFICIAL_MARKETPLACE, {
							cwd,
							deps: opts.deps,
							reg,
						});
						reg = loadRegistry(agentDir); // re-leer tras el save
						notify(
							`cc-plugins: marketplace oficial '${res.name}' agregado automáticamente (${res.plugins} plugins). /ccplugin list --available para explorar; /ccplugin marketplace remove ${res.name} si no lo quieres.`,
						);
					} catch (e: any) {
						onLog?.(
							`[cc-plugins] bootstrap auto falló: ${e?.message ?? e}`,
						);
					}
				} else {
					saveRegistry(agentDir, reg); // solo marcar bootstrapped
				}
			}
			// Reconcile self-healing (best-effort, nunca bloquea la carga).
			await reconcile(agentDir, reg, cwd, notify, onLog, opts.deps);

			const skillPaths: string[] = [];
			const promptPaths: string[] = [];
			for (const [name, rec] of Object.entries(reg.plugins)) {
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
			const enabledPrefixes = Object.entries(reg.plugins)
				.filter(([, r]) => r.enabled)
				.map(([n]) => `${n}-`);
			if (fs.existsSync(promptsRoot)) {
				for (const f of fs.readdirSync(promptsRoot)) {
					if (f.endsWith(".md") && enabledPrefixes.some((p) => f.startsWith(p))) {
						promptPaths.push(path.join(promptsRoot, f));
					}
				}
			}
			onStateChange?.({
				ready: true,
				marketplaces: Object.keys(reg.marketplaces).length,
				plugins: Object.keys(reg.plugins).length,
			});
			return { skillPaths, promptPaths };
		});

		registerCommand(pi, opts);
		onLog?.(
			`[cc-plugins] extensión activa (registry: ${registryPath(agentDir)}).`,
		);
	};
}

export { CC_PLUGINS_FACTORY_NAME };
