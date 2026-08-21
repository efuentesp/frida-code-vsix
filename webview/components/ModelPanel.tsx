import type { ProviderOption } from "../types";
import { Tooltip } from "./Tooltip";
import { Codicon } from "./Codicon";

/** Formatea tokens legibles: 200000 → "200K", 1000000 → "1M". */
function fmtTokens(n: number): string {
	if (n >= 1_000_000)
		return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
	if (n >= 1000) return `${Math.round(n / 1000)}K`;
	return String(n);
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
