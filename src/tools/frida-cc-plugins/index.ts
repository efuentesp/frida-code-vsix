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
	/** Presenter VS Code de resultados (output/quickpick/doc). Sin él, notify. */
	presenter?: import("./presenter").CcPluginsPresenter;
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
			p.scope !== "user" ? `[${p.scope}]` : undefined,
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
	let reg = loadRegistry(agentDir);
	// Bootstrap auto (intento único flag bootstrapped).
	if (!reg.bootstrapped) {
		reg.bootstrapped = true;
		if (Object.keys(reg.marketplaces).length === 0) {
			try {
				const res = await addMarketplace(agentDir, OFFICIAL_MARKETPLACE, {
					cwd,
					deps: opts.deps,
					reg,
				});
				reg = loadRegistry(agentDir);
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
function quickPickActions(
	agentDir: string,
	workCwd: string,
	notify: Notify,
	presenter: import("./presenter").CcPluginsPresenter | undefined,
	chat: (title: string, body: string) => void,
): import("./presenter").CcListActions {
	return {
		install: async (ref) => {
			const res = await installPlugin(agentDir, ref, { cwd: workCwd });
			return `Plugin '${res.plugin}' instalado (${res.skills.length} skills, ${res.commands.length} commands, ${res.mcpServers.length} MCP). Ejecuta /reload para activarlo.`;
		},
		uninstall: async (name) => {
			await uninstallPlugin(agentDir, name, { cwd: workCwd });
			return `Plugin '${name}' desinstalado. Ejecuta /reload.`;
		},
		toggle: async (name, enable) => {
			setPluginEnabled(agentDir, name, enable, { cwd: workCwd });
			return `Plugin '${name}' ${enable ? "habilitado" : "deshabilitado"}. Ejecuta /reload.`;
		},
		detailDoc: async (ref) => {
			const cat = pluginCatalogInfo(agentDir, ref);
			const lines = [
				`## ${cat.name}@${cat.marketplace}${cat.version ? ` v${cat.version}` : ""}`,
				"",
				cat.description ?? "",
				cat.remote ? `- **source remoto**: ${cat.remote}` : "",
				cat.components
					? `- **instalará**: ${cat.components.skills.length} skills, ${cat.components.commands.length} commands, ${cat.components.mcpServers.length} MCP`
					: "",
				cat.components?.estimatedTokens
					? `- **contexto**: ~${cat.components.estimatedTokens} tokens/turno aprox.`
					: "",
				cat.components?.skills.length
					? `- skills: ${cat.components.skills.join(", ")}`
					: "",
				cat.components?.commands.length
					? `- commands: ${cat.components.commands.join(", ")}`
					: "",
				cat.components?.mcpServers.length
					? `- MCP: ${cat.components.mcpServers.join(", ")}`
					: "",
				cat.components?.skipped.length
					? `- omitidos: ${cat.components.skipped.map((s) => s.kind).join(", ")}`
					: "",
			].filter((l) => l !== "");
			const md = lines.join("\n");
			// El detalle vive en el CHAT (bloque visible del webview); el doc
			// markdown es un extra para copiar (editor temporal).
			chat(`info ${ref}`, md);
			if (presenter) {
				await presenter.document(`cc-plugins: ${ref}`, md);
			}
			return "";
		},
		notify: (m, l) => notify(m, l),
	};
}

/** Registra el comando /ccplugin con sus subcomandos. */
function registerCommand(pi: ExtensionAPI, opts: CreateCcPluginsOpts): void {
	const { agentDir, cwd, onLog, presenter } = opts;

	/** Bloque persistente en el transcript (customType propio; display =
	 *  fallback de texto plano — renderer bonito de la webview: follow-up). */
	const chatBlock = (title: string, body: string): void => {
		try {
			pi.sendMessage({
				customType: "frida.ccplugins",
				content: `cc-plugins — ${title}\n${body}`,
				display: true,
				details: { title, body },
			});
		} catch {
			/* transcript no disponible (RPC) — queda el output channel */
		}
	};
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
							// Persistencia multicapa (UX #49): transcript + output
							// channel; interacción solo si hay presenter (VS Code).
							chatBlock(`disponibles (${avail.length})`, body);
							presenter?.append([
								`$ ccplugin list --available`,
								...body.split("\n"),
								"",
							]);
							if (presenter) {
								await presenter.interactiveList(
									avail.map((a) => ({
										label: `${a.name}@${a.marketplace}`,
										description: a.version ? `v${a.version}` : undefined,
										detail: [
											a.displayName && a.displayName !== a.name
												? a.displayName
												: undefined,
											a.installed
												? a.enabled
													? "instalado"
													: "instalado, deshabilitado"
												: undefined,
											a.remote ? "source remoto" : undefined,
										]
											.filter(Boolean)
											.join(" · "),
										installed: a.installed,
										enabled: a.enabled,
										ref: `${a.name}@${a.marketplace}`,
									})),
									quickPickActions(agentDir, workCwd, notifyCtx, presenter, chatBlock),
									`Disponibles (${avail.length})`,
									ctx.ui, // diálogo del WEBVIEW de frida (UiDialog)
								);
							} else {
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
						chatBlock("instalados", bodyList);
						presenter?.append([
							`$ ccplugin list`,
							...bodyList.split("\n"),
							"",
						]);
						if (presenter) {
							const mergedL = mergeLayers(loadLayers(agentDir, workCwd));
							await presenter.interactiveList(
								mergedL.plugins.map((p) => ({
									label: `${p.name}@${p.rec.marketplace}`,
									description: [
										p.rec.version ? `v${p.rec.version}` : undefined,
										p.scope !== "user" ? `[${p.scope}]` : undefined,
									]
										.filter(Boolean)
										.join(" "),
									detail: [
										`${p.rec.skills.length} skills`,
										`${p.rec.commands.length} commands`,
										`${p.rec.mcpServers.length} MCP`,
										p.rec.enabled ? undefined : "deshabilitado",
									]
										.filter(Boolean)
										.join(" · "),
									installed: true,
									enabled: p.rec.enabled,
									ref: `${p.name}@${p.rec.marketplace}`,
								})),
								quickPickActions(agentDir, workCwd, notifyCtx, presenter, chatBlock),
								`Instalados (${mergedL.plugins.length})`,
								ctx.ui, // diálogo del WEBVIEW de frida (UiDialog)
							);
						} else {
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
						// Con presenter: detalle completo en documento markdown.
						if (presenter && rest[0] && !rest[0].includes("--")) {
							try {
								const actions = quickPickActions(
									agentDir,
									workCwd,
									notifyCtx,
									presenter,
									chatBlock,
								);
								await actions.detailDoc(rest[0]);
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

		registerCommand(pi, opts);
		onLog?.(
			`[cc-plugins] extensión activa (registry: ${registryPath(agentDir)}).`,
		);
	};
}

export { CC_PLUGINS_FACTORY_NAME };
