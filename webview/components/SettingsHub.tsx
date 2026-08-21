import { useEffect, useState } from "react";
import type { ModuleResources, OutMessage, State } from "../types";
import { Codicon } from "./Codicon";
import { ApprovalPanel } from "./ApprovalPanel";
import { IndexTab } from "./IndexTab";
import { ProveedoresTab } from "./ProveedoresTab";
import { ResourcesContent } from "./ResourcesPanel";
import { UsageDashboard } from "./UsageDashboard";

export type SettingsTab =
	| "providers"
	| "models"
	| "approval"
	| "resources"
	| "tools"
	| "usage"
	| "codebaseIndex";

const TABS: { id: SettingsTab; label: string; iconName: string }[] = [
	{ id: "providers", label: "Proveedores", iconName: "plug" },
	{ id: "models", label: "Modelos", iconName: "sliders" },
	{ id: "approval", label: "Auto-Aprobación", iconName: "shield" },
	{ id: "resources", label: "Recursos", iconName: "library" },
	{ id: "tools", label: "Herramientas", iconName: "tools" },
	{ id: "usage", label: "Uso", iconName: "graph" },
	{ id: "codebaseIndex", label: "Index", iconName: "database" },
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
						(m) =>
							m.name.toLowerCase().includes(q) ||
							m.id.toLowerCase().includes(q),
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

	const totalSearchResults =
		matchedProviders.length +
		matchedModules.length +
		matchedSkills.length +
		matchedCommands.length;

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
						className={
							"cfg-tab" +
							(tab === t.id && !hasQuery ? " active" : "")
						}
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
											onSetKey={(id, key) =>
												post({ type: "set_key", provider: id, key })
											}
											onLogin={(id) =>
												post({ type: "login_provider", provider: id })
											}
											onLogout={(id) =>
												post({ type: "logout_provider", provider: id })
											}
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
																	enabled: !(
																		state.toolToggles?.[m.module] ?? true
																	),
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
										<div className="cfg-section">
											Skills ({matchedSkills.length})
										</div>
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
															<span className="cfg-res-hint">
																{c.argumentHint}
															</span>
														)}
													</div>
													<div className="cfg-res-desc">{c.description}</div>
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
								onSetKey={(id, key) =>
									post({ type: "set_key", provider: id, key })
								}
								onLogin={(id) =>
									post({ type: "login_provider", provider: id })
								}
								onLogout={(id) =>
									post({ type: "logout_provider", provider: id })
								}
							/>
						)}

						{tab === "models" && (
							<div className="cfg-stub">
								La selección rápida de modelo está en el botón de modelo de la
								barra superior. Próximamente: gestión completa de modelos aquí.
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
										<Codicon name="refresh" size={13} /> Recargar extensiones y
										recursos
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
								{(state.resources?.modules ?? []).filter((m) => !m.toggleable)
									.length > 0 && (
									<>
										<div className="cfg-section">
											Módulos base (siempre activos)
										</div>
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

						{tab === "codebaseIndex" && <IndexTab state={state} post={post} />}
					</>
				)}
			</div>
		</div>
	);
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
		<div className="cfg-row">
			<div className="cfg-row-info">
				<div className="cfg-row-title">{title}</div>
				<div className="cfg-row-desc">{desc}</div>
			</div>
			<button className={"switch" + (on ? " on" : "")} onClick={onToggle} />
		</div>
	);
}

/** Fila de recurso en el acordeón (#54): etiqueta + pills separadas por ·. */
function ResLine({
	label,
	items,
	prefix,
}: {
	label: string;
	items: string[];
	prefix?: string;
}) {
	const shown = items.slice(0, 12);
	const rest = items.length - shown.length;
	return (
		<div className="tool-res-line">
			<span className="tool-res-label">{label}</span>
			{shown.length === 0 ? (
				<span className="tool-res-empty">—</span>
			) : (
				<span className="tool-res-items">
					{shown.map((v) => (
						<code key={v}>
							{prefix}
							{v}
						</code>
					))}
					{rest > 0 && <span className="muted">+{rest} más</span>}
				</span>
			)}
		</div>
	);
}

/** Toggle con acordeón de recursos del módulo (#54): tools, comandos,
 *  skills, prompts y errores — lo que se activa/desactiva con el toggle. */
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
	return (
		<div className={"tool-acc" + (open ? " open" : "")}>
			<div className="tool-acc-head">
				<button
					className="tool-acc-exp"
					aria-label={open ? "Colapsar" : "Expandir"}
					onClick={() => setOpen(!open)}
				>
					<Codicon name={open ? "chevron-down" : "chevron-right"} size={12} />
				</button>
				<button
					className="tool-acc-info"
					title={desc}
					onClick={() => setOpen(!open)}
				>
					<span className="tool-acc-title">{title}</span>
					<span className={"tool-acc-count" + (total === 0 ? " zero" : "")}>
						{total}
					</span>
				</button>
				{onToggle ? (
					<button
						className={"switch" + (on ? " on" : "")}
						aria-label="Activar/desactivar"
						onClick={onToggle}
					/>
				) : (
					<span className="tag" title="Módulo base — siempre activo">
						base
					</span>
				)}
			</div>
			{open && (
				<div className="tool-acc-body">
					{on ? null : (
						<div className="tool-res-off">
							Desactivado: la sesión se recarga al mover el toggle; los recursos
							listados reaparecen al reactivarlo.
						</div>
					)}
					<ResLine label="Tools" items={res.tools} />
					<ResLine label="Comandos" items={res.commands} prefix="/" />
					<ResLine label="Skills" items={res.skills} />
					<ResLine label="Prompts" items={res.prompts} prefix="/" />
					{res.errors.length > 0 && (
						<div className="tool-res-errors">
							{res.errors.map((e, i) => (
								<div key={i} className="tool-res-err">
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
