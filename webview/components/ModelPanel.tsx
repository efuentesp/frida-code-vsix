import type { ModelRolesUi, ProviderOption } from "../types";
import { Tooltip } from "./Tooltip";
import { Codicon } from "./Codicon";

/** Formatea tokens legibles: 200000 → "200K", 1000000 → "1M". */
function fmtTokens(n: number): string {
	if (n >= 1_000_000)
		return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
	if (n >= 1000) return `${Math.round(n / 1000)}K`;
	return String(n);
}

/** #121 (F7) — tarjeta de rol con selects proveedor→modelo y opción
 * "Hereda Principal". Pura: solo renderiza lo que recibe. */
function RoleCard({
	icon,
	title,
	hint,
	value,
	providers,
	onChange,
}: {
	icon: string;
	title: string;
	hint: string;
	value: { provider: string; modelId: string } | null;
	providers: ProviderOption[];
	onChange: (next: { provider: string; modelId: string } | null) => void;
}) {
	const authed = providers.filter((p) => p.authed && p.models.length > 0);
	const current = authed.find((p) => p.id === value?.provider);
	const costHint =
		value?.provider === "ollama" ? "costo: local · 0 tokens de cuota" : null;
	return (
		<div className="mr-card">
			<div className="mr-card-head">
				<Codicon name={icon} size={13} />
				<span className="mr-card-title">{title}</span>
				{costHint && <span className="mr-card-cost">{costHint}</span>}
			</div>
			<div className="mr-card-hint">{hint}</div>
			<div className="mr-selects">
				<select
					className="bar-select"
					aria-label={`${title}: proveedor`}
					value={value?.provider ?? ""}
					onChange={(e) => {
						const pid = e.target.value;
						if (!pid) {
							onChange(null); // "" = hereda default
							return;
						}
						const first = authed.find((p) => p.id === pid)?.models.at(0);
						onChange(first ? { provider: pid, modelId: first.id } : null);
					}}
				>
					<option value="">Hereda Principal</option>
					{authed.map((p) => (
						<option key={p.id} value={p.id}>
							{p.name}
						</option>
					))}
				</select>
				{value && (
					<select
						className="bar-select"
						aria-label={`${title}: modelo`}
						value={value.modelId}
						onChange={(e) =>
							onChange({ provider: value.provider, modelId: e.target.value })
						}
					>
						{(current?.models ?? []).map((mm) => (
							<option key={mm.id} value={mm.id}>
								{mm.name}
							</option>
						))}
					</select>
				)}
			</div>
		</div>
	);
}

/** #121 (F7) — sección Roles (Opción A del diseño): switch maestro +
 * tarjetas por rol + fila de respaldo. OFF = modo clásico con nota. */
export function RolesSection({
	roles,
	active,
	providers,
	onSetRoles,
}: {
	roles: ModelRolesUi;
	active?: { provider: string; modelId: string };
	providers: ProviderOption[];
	onSetRoles: (patch: Partial<ModelRolesUi>) => void;
}) {
	const providerName = (id?: string) =>
		providers.find((p) => p.id === id)?.name ?? id ?? "—";
	return (
		<div className="mr-roles">
			<div className="mr-head">
				<Codicon name="route" size={14} />
				<span className="mr-title">ROLES — cada trabajo usa su modelo</span>
				<button
					type="button"
					className={`ccp-switch${roles.enabled ? " ccp-switch-on" : ""}`}
					role="switch"
					aria-checked={roles.enabled}
					title={
						roles.enabled
							? "Enrutar por roles — click para apagar (todo usa el modelo Principal)"
							: "Enrutar por roles — click para encender"
					}
					onClick={() => onSetRoles({ enabled: !roles.enabled })}
				>
					<span className="ccp-switch-knob" />
				</button>
			</div>
			{roles.enabled ? (
				<>
					<div className="mr-card mr-card-default">
						<div className="mr-card-head">
							<Codicon name="settings-gear" size={13} />
							<span className="mr-card-title">Principal (default)</span>
						</div>
						<div className="mr-card-val">
							{providerName(active?.provider)}
							{active?.modelId ? ` · ${active.modelId}` : ""} — el modelo que eliges en
							esta misma lista.
						</div>
					</div>
					<RoleCard
						icon="zap"
						title="Rápido (smol)"
						hint="Subagents, extracciones y resúmenes"
						value={roles.smol}
						providers={providers}
						onChange={(smol) => onSetRoles({ smol })}
					/>
					<RoleCard
						icon="edit"
						title="Commits (commit)"
						hint="Changelogs y mensajes de commit"
						value={roles.commit}
						providers={providers}
						onChange={(commit) => onSetRoles({ commit })}
					/>
					<div className="mr-fallback">
						<div className="mr-fallback-head">
							<span>Respaldo (fallback)</span>
							<button
								type="button"
								className={`ccp-switch${roles.fallbackEnabled ? " ccp-switch-on" : ""}`}
								role="switch"
								aria-checked={roles.fallbackEnabled}
								title="Si el modelo del rol falla (429/cuota), la sesión cae al siguiente proveedor autenticado"
								onClick={() => onSetRoles({ fallbackEnabled: !roles.fallbackEnabled })}
							>
								<span className="ccp-switch-knob" />
							</button>
						</div>
						<div className="mr-fallback-copy">
							Si el modelo del rol falla (429/cuota), la sesión cae al siguiente
							proveedor autenticado y se restaura al enfriarse.
						</div>
					</div>
				</>
			) : (
				<div className="mr-off-note">
					Todo lo resuelve el <strong>modelo Principal</strong> que elegiste abajo
					(comportamiento clásico). Enciende los roles para enviar subagents y
					commits a un modelo más barato.
				</div>
			)}
		</div>
	);
}

export function ModelPanel({
	providers,
	active,
	deviceCode,
	onClose,
	onSelect,
	onLogin,
	onLogout,
	onSetKey,
	onDiscoverModels,
	refreshing,
	refreshErrors,
	roles,
	onSetRoles,
}: {
	providers: ProviderOption[];
	active?: { provider: string; modelId: string };
	deviceCode?: { userCode: string; verificationUri: string };
	onClose: () => void;
	onSelect: (provider: string, model: string) => void;
	onLogin: (provider: string) => void;
	onLogout: (provider: string) => void;
	onSetKey: (provider: string) => void;
	onDiscoverModels: (provider: string) => void;
	refreshing?: boolean;
	refreshErrors?: string[];
	/** #121 (F7) — roles de modelo; sin esto no se renderiza la sección. */
	roles?: ModelRolesUi;
	onSetRoles?: (patch: Partial<ModelRolesUi>) => void;
}) {
	return (
		<div className="sessions-overlay" onClick={onClose}>
			<div className="sessions-panel" onClick={(e) => e.stopPropagation()}>
				<div className="sessions-head">
					<span>Modelos y proveedores</span>
					<Tooltip label="Cerrar" side="top">
						<button className="icon-btn" onClick={onClose}>
							<Codicon name="close" size={15} />
						</button>
					</Tooltip>
				</div>

				{deviceCode && (
					<div className="oauth-banner">
						<div className="oauth-title">Iniciando sesión…</div>
						<div className="oauth-hint">Abre el navegador y entra este código:</div>
						<div className="oauth-code">{deviceCode.userCode}</div>
						<a
							className="oauth-link"
							href={deviceCode.verificationUri}
							target="_blank"
							rel="noreferrer"
						>
							{deviceCode.verificationUri}
						</a>
					</div>
				)}

				{refreshing && (
					<div className="refresh-status">
						<Codicon name="loading" size={12} spin /> Refrescando catálogos…
					</div>
				)}
				{!refreshing && refreshErrors && refreshErrors.length > 0 && (
					<div className="refresh-status warn">
						No se pudo refrescar {refreshErrors.join(", ")} · catálogo cacheado
					</div>
				)}

				{roles && onSetRoles && (
					<RolesSection
						roles={roles}
						active={active}
						providers={providers}
						onSetRoles={onSetRoles}
					/>
				)}

				<div className="cfg-section">PROVEEDORES</div>
				<div className="sessions-list">
					{providers.map((p) => {
						const isActiveProvider = active?.provider === p.id;
						return (
							<div key={p.id} className="provider-block">
								<div className="provider-head">
									<span className="provider-name">
										{p.name}
										{p.oauth && <span className="provider-tag">suscripción</span>}
									</span>
									<span className={"provider-badge " + (p.authed ? "ok" : "off")}>
										{p.authed ? (
											<>
												<Codicon name="check" size={12} /> conectado
											</>
										) : (
											"sin conexión"
										)}
									</span>
									{p.oauth &&
										(p.authed ? (
											<Tooltip label="Cerrar sesión" side="top">
												<button className="icon-btn" onClick={() => onLogout(p.id)}>
													<Codicon name="sign-out" size={14} />
												</button>
											</Tooltip>
										) : (
											<Tooltip label="Iniciar sesión" side="top">
												<button className="icon-btn primary" onClick={() => onLogin(p.id)}>
													<Codicon name="sign-in" size={14} /> Iniciar sesión
												</button>
											</Tooltip>
										))}
									{p.apiKey && (
										<>
											<Tooltip
												label={p.authed ? "Actualizar API key" : "Introducir API key"}
												side="top"
											>
												<button className="icon-btn" onClick={() => onSetKey(p.id)}>
													<Codicon name="key" size={14} />
												</button>
											</Tooltip>
											{p.id === "zai" && (
												<Tooltip label="Explorar modelos disponibles" side="top">
													<button
														className="icon-btn"
														onClick={() => onDiscoverModels(p.id)}
													>
														<Codicon name="refresh" size={14} />
													</button>
												</Tooltip>
											)}
										</>
									)}
								</div>
								<div className="model-list">
									{p.models.map((mm) => {
										const selected = isActiveProvider && active?.modelId === mm.id;
										const disabled = !p.authed;
										return (
											<button
												key={mm.id}
												className={
													"model-row" +
													(selected ? " selected" : "") +
													(disabled ? " disabled" : "")
												}
												disabled={disabled}
												onClick={() => onSelect(p.id, mm.id)}
											>
												<span className="model-radio">
													{selected && <Codicon name="record" size={14} />}
												</span>
												<span className="model-name">{mm.name}</span>
												{(mm.contextWindow ||
													mm.reasoning ||
													mm.input?.includes("image")) && (
													<span className="model-meta">
														{mm.contextWindow ? fmtTokens(mm.contextWindow) : null}
														{mm.maxTokens ? ` · ${fmtTokens(mm.maxTokens)} out` : null}
														{mm.reasoning ? (
															<>
																{" · "}
																<Codicon name="sparkle" size={11} /> thinking
															</>
														) : null}
														{mm.input?.includes("image") ? (
															<>
																{" · "}
																<Codicon name="file-media" size={11} />
															</>
														) : null}
													</span>
												)}
											</button>
										);
									})}
									{p.models.length === 0 && (
										<div className="model-empty">Sin modelos disponibles.</div>
									)}
								</div>
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}
