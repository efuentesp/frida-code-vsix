import { useEffect, useState } from "react";
import type { ModuleResources, OutMessage, State } from "../types";
import { Codicon } from "./Codicon";
import { ApprovalPanel } from "./ApprovalPanel";
import { EnvironmentTab } from "./EnvironmentTab";
import { IndexTab } from "./IndexTab";
import { ProductivityTab } from "./ProductivityTab";
import { ProveedoresTab } from "./ProveedoresTab";
import { RolesSection } from "./ModelPanel";
import { ResourcesContent } from "./ResourcesPanel";
import { UsageDashboard } from "./UsageDashboard";

export type SettingsTab =
	| "providers"
	| "models"
	| "approval"
	| "resources"
	| "tools"
	| "usage"
	| "productivity"
	| "codebaseIndex"
	| "environment";

const TABS: { id: SettingsTab; label: string; iconName: string }[] = [
	{ id: "providers", label: "Proveedores", iconName: "plug" },
	{ id: "models", label: "Modelos", iconName: "sparkle" },
	{ id: "approval", label: "Auto-Aprobación", iconName: "shield" },
	{ id: "resources", label: "Recursos", iconName: "library" },
	{ id: "tools", label: "Herramientas", iconName: "tools" },
	{ id: "usage", label: "Uso", iconName: "graph" },
	{ id: "productivity", label: "Productividad", iconName: "rocket" },
	{ id: "codebaseIndex", label: "Index", iconName: "database" },
	{ id: "environment", label: "Entorno", iconName: "pulse" },
];

export function SettingsHub({
	state,
	post,
	onClose,
	initialTab = "providers",
}: {
	state: State;
	post: (m: OutMessage) => void;
	onClose: () => void;
	initialTab?: SettingsTab;
}) {
	const [tab, setTab] = useState<SettingsTab>(initialTab);
	const [searchQuery, setSearchQuery] = useState("");
	const providers = state.models?.providers ?? [];

	// Al abrir la pestaña Recursos o Herramientas, refrescar la lista desde el host
	// #54: Herramientas también consume resources (módulos del acordeón).
	// #55: Auto-Aprobación consume el snapshot del config-store.
	useEffect(() => {
		if (tab === "resources" || tab === "tools" || searchQuery.trim().length > 0) {
			post({ type: "list_resources" });
		}
		if (tab === "approval" || searchQuery.trim().length > 0) {
			post({ type: "get_permissions_config" });
		}
		if (tab === "environment" || searchQuery.trim().length > 0) {
			post({ type: "check_environment" });
		}
	}, [tab, searchQuery]); // eslint-disable-line react-hooks/exhaustive-deps

	const q = searchQuery.trim().toLowerCase();
	const hasQuery = q.length > 0;

	// Filtrado global de búsqueda (Propuesta 1: VS Code Settings style)
	const matchedProviders = hasQuery
		? providers.filter(
				(p) =>
					p.name.toLowerCase().includes(q) ||
					p.id.toLowerCase().includes(q) ||
					p.models.some(
						(m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
					),
			)
		: [];

	const matchedModules = hasQuery
		? (state.resources?.modules ?? []).filter(
				(m) =>
					m.title.toLowerCase().includes(q) ||
					m.desc.toLowerCase().includes(q) ||
					m.module.toLowerCase().includes(q) ||
					m.tools.some((t) => t.toLowerCase().includes(q)) ||
					m.commands.some((c) => c.toLowerCase().includes(q)),
			)
		: [];

	const matchedSkills = hasQuery
		? (state.resources?.skills ?? []).filter(
				(s) =>
					s.name.toLowerCase().includes(q) ||
					s.description.toLowerCase().includes(q),
			)
		: [];

	const matchedCommands = hasQuery
		? (state.resources?.commands ?? []).filter(
				(c) =>
					c.name.toLowerCase().includes(q) ||
					c.description.toLowerCase().includes(q),
			)
		: [];

	const matchedEnvDeps = hasQuery
		? (state.environment?.dependencies ?? []).filter(
				(d) =>
					d.name.toLowerCase().includes(q) ||
					d.description.toLowerCase().includes(q) ||
					d.usedBy.toLowerCase().includes(q) ||
					d.id.toLowerCase().includes(q),
			)
		: [];

	const totalSearchResults =
		matchedProviders.length +
		matchedModules.length +
		matchedSkills.length +
		matchedCommands.length +
		matchedEnvDeps.length;

	return (
		<div className="cfg-panel">
			{/* Encabezado con título e icono de cerrar */}
			<div className="cfg-head">
				<div className="cfg-head-left">
					<Codicon name="settings-gear" size={15} className="cfg-head-icon" />
					<span className="cfg-title">Configuración</span>
				</div>
				<button className="ico" onClick={onClose} aria-label="Cerrar">
					<Codicon name="close" size={15} />
				</button>
			</div>

			{/* Barra de búsqueda global nativa (estilo VS Code Settings) */}
			<div className="cfg-search-bar">
				<Codicon name="search" size={14} className="cfg-search-icon" />
				<input
					type="text"
					className="cfg-search-input"
					placeholder="Buscar ajustes (ej. openai, permisos, git, bash)..."
					value={searchQuery}
					onChange={(e) => setSearchQuery(e.target.value)}
					autoFocus={false}
				/>
				{searchQuery && (
					<button
						type="button"
						className="cfg-search-clear"
						onClick={() => setSearchQuery("")}
						title="Limpiar búsqueda"
					>
						<Codicon name="close" size={13} />
					</button>
				)}
			</div>

			{/* Chips de categorías superiores */}
			<div className="cfg-tabs">
				{TABS.map((t) => (
					<button
						key={t.id}
						type="button"
						className={"cfg-tab" + (tab === t.id && !hasQuery ? " active" : "")}
						onClick={() => {
							setTab(t.id);
							if (searchQuery) setSearchQuery("");
						}}
					>
						<Codicon name={t.iconName} size={13} />
						<span>{t.label}</span>
					</button>
				))}
			</div>

			<div className="cfg-body">
				{hasQuery ? (
					/* Vista de resultados de búsqueda global */
					<div className="cfg-search-results">
						{totalSearchResults === 0 ? (
							<div className="cfg-search-empty">
								<Codicon name="search" size={24} className="cfg-empty-icon" />
								<div className="cfg-empty-title">
									No se encontraron ajustes para &quot;{searchQuery}&quot;
								</div>
								<div className="cfg-empty-desc">
									Verifica la ortografía o intenta buscar por otro término.
								</div>
								<button
									type="button"
									className="cfg-empty-btn"
									onClick={() => setSearchQuery("")}
								>
									Limpiar búsqueda
								</button>
							</div>
						) : (
							<>
								{matchedProviders.length > 0 && (
									<div className="cfg-search-group">
										<div className="cfg-section">
											Proveedores ({matchedProviders.length})
										</div>
										<ProveedoresTab
											providers={matchedProviders}
											deviceCode={state.oauthDeviceCode}
											activeModel={state.models?.active}
											showFilter={false}
											highlightQuery={q}
											onSetKey={(id, key) => post({ type: "set_key", provider: id, key })}
											onLogin={(id) => post({ type: "login_provider", provider: id })}
											onLogout={(id) => post({ type: "logout_provider", provider: id })}
										/>
									</div>
								)}

								{matchedModules.length > 0 && (
									<div className="cfg-search-group">
										<div className="cfg-section">
											Herramientas y Módulos ({matchedModules.length})
										</div>
										{matchedModules.map((m) => (
											<ToolAccordionRow
												key={m.module}
												title={m.title}
												desc={m.desc}
												on={state.toolToggles?.[m.module] ?? true}
												onToggle={
													m.toggleable
														? () =>
																post({
																	type: "set_tool_toggle",
																	key: m.module,
																	enabled: !(state.toolToggles?.[m.module] ?? true),
																})
														: undefined
												}
												res={m}
											/>
										))}
									</div>
								)}

								{matchedSkills.length > 0 && (
									<div className="cfg-search-group">
										<div className="cfg-section">Skills ({matchedSkills.length})</div>
										<div className="cfg-skills-list">
											{matchedSkills.map((s) => (
												<div key={s.name} className="cfg-res-card">
													<div className="cfg-res-head">
														<Codicon name="sparkle" size={13} />
														<span className="cfg-res-name">{s.name}</span>
													</div>
													<div className="cfg-res-desc">{s.description}</div>
												</div>
											))}
										</div>
									</div>
								)}

								{matchedCommands.length > 0 && (
									<div className="cfg-search-group">
										<div className="cfg-section">
											Comandos slash ({matchedCommands.length})
										</div>
										<div className="cfg-commands-list">
											{matchedCommands.map((c) => (
												<div key={c.name} className="cfg-res-card">
													<div className="cfg-res-head">
														<Codicon name="terminal" size={13} />
														<span className="cfg-res-name">/{c.name}</span>
														{c.argumentHint && (
															<span className="cfg-res-hint">{c.argumentHint}</span>
														)}
													</div>
													<div className="cfg-res-desc">{c.description}</div>
												</div>
											))}
										</div>
									</div>
								)}

								{matchedEnvDeps.length > 0 && (
									<div className="cfg-search-group">
										<div className="cfg-section">
											Dependencias de Entorno ({matchedEnvDeps.length})
										</div>
										<div className="cfg-skills-list">
											{matchedEnvDeps.map((d) => (
												<div key={d.id} className="cfg-res-card">
													<div className="cfg-res-head">
														<Codicon name={d.installed ? "check" : "warning"} size={13} />
														<span className="cfg-res-name">{d.name}</span>
														<span className="cfg-res-hint">
															{d.installed ? (d.version ?? "Instalado") : "No encontrado"}
														</span>
													</div>
													<div className="cfg-res-desc">
														{d.description} · Usado por: {d.usedBy}
													</div>
												</div>
											))}
										</div>
									</div>
								)}
							</>
						)}
					</div>
				) : (
					/* Vista por pestaña seleccionada */
					<>
						{tab === "providers" && (
							<ProveedoresTab
								providers={providers}
								deviceCode={state.oauthDeviceCode}
								activeModel={state.models?.active}
								onSetKey={(id, key) => post({ type: "set_key", provider: id, key })}
								onLogin={(id) => post({ type: "login_provider", provider: id })}
								onLogout={(id) => post({ type: "logout_provider", provider: id })}
							/>
						)}

						{tab === "models" && (
							<div className="cfg-models-tab">
								{state.models?.roles ? (
									<RolesSection
										roles={state.models.roles}
										active={state.models.active}
										providers={state.models.providers}
										onSetRoles={(patch) => post({ type: "model_roles_set", ...patch })}
									/>
								) : (
									<div className="cfg-stub">Cargando roles de modelo…</div>
								)}
								{/* #121 — Transcript: el toggle "Ocultar razonamiento" vivía en el
								 * header sin persistir; ahora aquí, persistido y estilo casa. */}
								<div className="mr-roles">
									<div className="mr-head">
										<Codicon name="sparkle" size={14} />
										<span className="mr-title">TRANSCRIPT</span>
									</div>
									<div className="mr-card">
										<div className="mr-card-head">
											<span className="mr-card-title">
												Mostrar razonamiento del modelo
											</span>
											<button
												type="button"
												className={`switch${state.ui?.hideThinking === false ? " on" : ""}`}
												role="switch"
												aria-checked={state.ui?.hideThinking === false}
												aria-label="Mostrar razonamiento del modelo"
												onClick={() =>
													post({
														type: "ui_hide_thinking_set",
														value: !(state.ui?.hideThinking === false),
													})
												}
											/>
										</div>
										<div className="mr-card-hint">
											Los turnos muestran “Razonó 3.2s · 420 tok” expandible por turno.
											Apagado: solo se ve la respuesta.
										</div>
									</div>
								</div>
								<div className="cfg-stub">
									La selección rápida de modelo (intercambio en vivo) está en el botón de
									modelo de la barra superior; los roles de arriba aplican desde la
									próxima sesión.
								</div>
							</div>
						)}

						{tab === "approval" && <ApprovalPanel state={state} post={post} />}

						{tab === "resources" && (
							<div className="cfg-resources">
								<div className="cfg-res-actions">
									<button
										className="pc-save"
										onClick={() => post({ type: "reload" })}
										disabled={state.busy}
									>
										<Codicon name="refresh" size={13} /> Recargar extensiones y recursos
									</button>
								</div>
								{state.resources ? (
									<ResourcesContent res={state.resources} />
								) : (
									<div className="cfg-stub">Cargando recursos…</div>
								)}
							</div>
						)}

						{tab === "tools" && (
							<>
								<div className="cfg-section">Herramientas del agente</div>
								{(state.resources?.modules ?? []).map((m) =>
									m.toggleable ? (
										<ToolAccordionRow
											key={m.module}
											title={m.title}
											desc={m.desc}
											on={state.toolToggles?.[m.module] ?? true}
											onToggle={() =>
												post({
													type: "set_tool_toggle",
													key: m.module,
													enabled: !(state.toolToggles?.[m.module] ?? true),
												})
											}
											res={m}
										/>
									) : null,
								)}
								{(state.resources?.modules ?? []).length === 0 &&
									(state.toolToggleDefs ?? []).map((d) => (
										<ToggleRow
											key={d.key}
											title={d.title}
											desc={d.desc}
											on={state.toolToggles?.[d.key] ?? true}
											onToggle={() =>
												post({
													type: "set_tool_toggle",
													key: d.key,
													enabled: !(state.toolToggles?.[d.key] ?? true),
												})
											}
										/>
									))}
								{(state.resources?.modules ?? []).filter((m) => !m.toggleable).length >
									0 && (
									<>
										<div className="cfg-section">Módulos base (siempre activos)</div>
										{(state.resources?.modules ?? [])
											.filter((m) => !m.toggleable)
											.map((m) => (
												<ToolAccordionRow
													key={m.module}
													title={m.title}
													desc={m.desc}
													on={true}
													res={m}
												/>
											))}
									</>
								)}
							</>
						)}

						{tab === "usage" && <UsageDashboard state={state} post={post} />}

						{tab === "productivity" && <ProductivityTab state={state} post={post} />}

						{tab === "codebaseIndex" && <IndexTab state={state} post={post} />}

						{tab === "environment" && <EnvironmentTab state={state} post={post} />}
					</>
				)}
			</div>
		</div>
	);
}

function getModuleIcon(module: string): string {
	const m = module.toLowerCase();
	if (m.includes("git") || m.includes("sync")) return "git-branch";
	if (m.includes("browser") || m.includes("web")) return "globe";
	if (m.includes("subagent") || m.includes("parallel")) return "organization";
	if (m.includes("permission") || m.includes("gate") || m.includes("approval"))
		return "shield";
	if (m.includes("aidd") || m.includes("workflow")) return "sparkle";
	if (m.includes("lens") || m.includes("lsp") || m.includes("diagnostics"))
		return "search";
	if (m.includes("index") || m.includes("codebase")) return "database";
	if (m.includes("todo") || m.includes("task")) return "checklist";
	if (m.includes("core") || m.includes("system")) return "tools";
	return "extensions";
}

function ToggleRow({
	title,
	desc,
	on,
	onToggle,
}: {
	title: string;
	desc: string;
	on: boolean;
	onToggle: () => void;
}) {
	return (
		<div className={`tool-card-mod${on ? "" : " is-off"}`}>
			<div className="tool-card-head">
				<div className="tool-card-icon-wrap">
					<Codicon name="tools" size={15} className="tool-card-icon" />
				</div>
				<div className="tool-card-info">
					<div className="tool-card-title-row">
						<span className="tool-card-title">{title}</span>
					</div>
					<div className="tool-card-desc">{desc}</div>
				</div>
				<div className="tool-card-actions">
					<button
						type="button"
						className={"switch" + (on ? " on" : "")}
						aria-label={on ? `Desactivar ${title}` : `Activar ${title}`}
						onClick={onToggle}
					/>
				</div>
			</div>
		</div>
	);
}

/** Fila de recurso en el acordeón: categoría con codicon + chips interactivos. */
function ResLine({
	label,
	items,
	prefix,
	iconName,
}: {
	label: string;
	items: string[];
	prefix?: string;
	iconName: string;
}) {
	if (items.length === 0) return null;
	const shown = items.slice(0, 12);
	const rest = items.length - shown.length;
	return (
		<div className="tool-res-line">
			<div className="tool-res-label-wrap">
				<Codicon name={iconName} size={11} className="tool-res-icon" />
				<span className="tool-res-label">{label}:</span>
			</div>
			<div className="tool-res-chips">
				{shown.map((v) => (
					<span key={v} className="tool-res-chip">
						<code>
							{prefix}
							{v}
						</code>
					</span>
				))}
				{rest > 0 && <span className="tool-res-more">+{rest} más</span>}
			</div>
		</div>
	);
}

/** Toggle con tarjeta de módulo de recursos (Propuesta 1: Feature Manager). */
function ToolAccordionRow({
	title,
	desc,
	on,
	onToggle,
	res,
}: {
	title: string;
	desc: string;
	on: boolean;
	onToggle?: () => void;
	res: ModuleResources;
}) {
	const [open, setOpen] = useState(false);
	const total =
		res.tools.length +
		res.commands.length +
		res.skills.length +
		res.prompts.length +
		res.errors.length;
	const iconName = getModuleIcon(res.module);

	return (
		<div className={`tool-card-mod${open ? " open" : ""}${on ? "" : " is-off"}`}>
			<div className="tool-card-head">
				<div className="tool-card-icon-wrap">
					<Codicon name={iconName} size={15} className="tool-card-icon" />
				</div>
				<div className="tool-card-info" onClick={() => setOpen(!open)}>
					<div className="tool-card-title-row">
						<span className="tool-card-title">{title}</span>
						<span className={`tool-card-count${total === 0 ? " zero" : ""}`}>
							{total} {total === 1 ? "recurso" : "recursos"}
						</span>
					</div>
					<div className="tool-card-desc">{desc}</div>
				</div>
				<div className="tool-card-actions">
					{onToggle ? (
						<button
							type="button"
							className={"switch" + (on ? " on" : "")}
							aria-label={on ? `Desactivar ${title}` : `Activar ${title}`}
							title={
								on
									? "Habilitado — click para desactivar"
									: "Desactivado — click para habilitar"
							}
							onClick={onToggle}
						/>
					) : (
						<span
							className="tool-card-base-badge"
							title="Módulo base — siempre activo"
						>
							BASE
						</span>
					)}
					<button
						type="button"
						className="tool-card-exp-btn"
						aria-label={open ? "Contraer detalles" : "Expandir detalles"}
						title={open ? "Contraer detalles" : "Ver herramientas y comandos"}
						onClick={() => setOpen(!open)}
					>
						<Codicon name={open ? "chevron-down" : "chevron-right"} size={12} />
					</button>
				</div>
			</div>
			{open && (
				<div className="tool-card-body">
					{!on && (
						<div className="tool-res-off">
							<Codicon name="info" size={12} />
							<span>
								Desactivado: las herramientas y comandos de este módulo no consumen
								contexto ni están disponibles en el chat.
							</span>
						</div>
					)}
					<ResLine label="Tools" items={res.tools} iconName="tools" />
					<ResLine
						label="Comandos"
						items={res.commands}
						prefix="/"
						iconName="terminal"
					/>
					<ResLine label="Skills" items={res.skills} iconName="sparkle" />
					<ResLine label="Prompts" items={res.prompts} prefix="/" iconName="book" />
					{res.errors.length > 0 && (
						<div className="tool-res-errors">
							{res.errors.map((e, i) => (
								<div key={i} className="tool-res-err">
									<Codicon name="warning" size={12} />
									<code>{e.path}</code> <span>{e.error}</span>
								</div>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
