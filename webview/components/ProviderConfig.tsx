import { useState } from "react";
import { Codicon } from "./Codicon";
import type { ProviderOption } from "../types";
import type { ProviderMeta } from "../providers-registry";
import { highlightText } from "../highlight";

// UI de configuración de UN proveedor (Propuesta 1: VS Code Accounts & Model Hub Card):
//  - Por defecto contraída para navegación compacta sin scroll excesivo.
//  - Cabecera clickeable con chevron Codicon, nombre, badge de estado y resumen de modelos.
//  - Al expandir:
//      - apikey: input de key con botón de revelar/ocultar + "Guardar" + link "Obtener key".
//      - oauth: botón "Iniciar sesión" → device code con botón de copiar código al portapapeles.
//      - catálogo visual completo de modelos aportados con tag "En uso".
//      - botón "Cambiar" API key y botón "Olvidar" con confirmación de dos pasos.
export function ProviderConfig({
	provider,
	meta,
	deviceCode,
	activeModelId,
	highlightQuery = "",
	defaultExpanded,
	onSetKey,
	onLogin,
	onLogout,
}: {
	provider: ProviderOption;
	meta: ProviderMeta;
	deviceCode?: { userCode: string; verificationUri: string };
	activeModelId?: string;
	/** Consulta para resaltar coincidencias (filtro del tab o búsqueda global). */
	highlightQuery?: string;
	/** Si la tarjeta arranca expandida o contraída (por defecto contraída: false, salvo si hay deviceCode activo). */
	defaultExpanded?: boolean;
	onSetKey: (id: string, key: string) => void;
	onLogin: (id: string) => void;
	onLogout: (id: string) => void;
}) {
	const [expanded, setExpanded] = useState(
		defaultExpanded ?? deviceCode != null,
	);
	const [key, setKey] = useState("");
	const [showKey, setShowKey] = useState(false);
	const [editing, setEditing] = useState(!provider.authed);
	const [confirmForget, setConfirmForget] = useState(false);
	const [copiedCode, setCopiedCode] = useState(false);

	const cancelEdit = () => {
		setKey("");
		setEditing(false);
		setShowKey(false);
	};
	const save = () => {
		const trimmed = key.trim();
		cancelEdit(); // salir de la edición siempre
		if (trimmed) onSetKey(provider.id, trimmed); // vacío → sin cambios (sigue authed)
	};
	const forget = () => {
		setConfirmForget(false);
		setEditing(false);
		setKey("");
		onLogout(provider.id);
	};

	const copyDeviceCode = () => {
		if (deviceCode && typeof navigator !== "undefined" && navigator.clipboard) {
			navigator.clipboard.writeText(deviceCode.userCode).catch(() => undefined);
			setCopiedCode(true);
			setTimeout(() => setCopiedCode(false), 2000);
		}
	};

	const toggleExpand = () => {
		setExpanded((prev) => !prev);
	};

	const activeModelDef = provider.models?.find((m) => m.id === activeModelId);

	return (
		<div className={`pc-card${expanded ? " expanded" : " collapsed"}`}>
			<div
				className="pc-head"
				onClick={toggleExpand}
				role="button"
				tabIndex={0}
				aria-expanded={expanded}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						toggleExpand();
					}
				}}
				title={expanded ? "Contraer detalles" : "Expandir configuración y modelos"}
			>
				<span className="pc-icon">
					<Codicon
						name={
							meta.authType === "oauth" ? "sparkle" : provider.authed ? "key" : "plug"
						}
						size={16}
					/>
				</span>
				<div className="pc-titles">
					<div className="pc-name-row">
						<span className="pc-name">
							{highlightText(meta.name, highlightQuery)}
						</span>
						<div className="pc-head-right">
							{provider.authed ? (
								<span className="pc-badge ok">
									<Codicon name="pass-filled" size={12} /> Conectado (
									{meta.authType === "oauth" ? "OAuth" : "API Key"})
								</span>
							) : (
								<span className="pc-badge off">
									<Codicon name="circle-outline" size={12} /> Sin conexión
								</span>
							)}
							<span className="pc-chevron" aria-hidden="true">
								<Codicon name={expanded ? "chevron-down" : "chevron-right"} size={14} />
							</span>
						</div>
					</div>
					{meta.blurb && <div className="pc-blurb">{meta.blurb}</div>}

					{/* Resumen compacto en estado contraído */}
					{!expanded && (
						<div className="pc-summary-row">
							{provider.models && provider.models.length > 0 ? (
								<span className="pc-summary-pill">
									<Codicon name="layers" size={11} />
									<span>
										{provider.models.length}{" "}
										{provider.models.length === 1 ? "modelo" : "modelos"}
									</span>
								</span>
							) : null}
							{activeModelDef && (
								<span className="pc-summary-pill pc-summary-active">
									<span className="pc-model-active-tag">En uso</span>
									<span>{activeModelDef.name}</span>
								</span>
							)}
						</div>
					)}
				</div>
			</div>

			{/* Contenido expandido: modelos y controles de autenticación */}
			{expanded && (
				<div className="pc-expanded-content">
					{/* Catálogo de modelos aportados por el proveedor */}
					{provider.models && provider.models.length > 0 && (
						<div className="pc-models-list">
							<div className="pc-models-header">
								<Codicon name="layers" size={12} />
								<span>
									{provider.models.length}{" "}
									{provider.models.length === 1
										? "modelo disponible"
										: "modelos disponibles"}
								</span>
							</div>
							<div className="pc-models-chips">
								{provider.models.map((m) => {
									const isCurrentActive = activeModelId === m.id;
									return (
										<span
											key={m.id}
											className={`pc-model-chip${isCurrentActive ? " active" : ""}`}
											title={isCurrentActive ? "Modelo activo en el chat" : m.name}
										>
											<span className="pc-model-chip-name">
												{highlightText(m.name, highlightQuery)}
											</span>
											{isCurrentActive && (
												<span className="pc-model-active-tag">En uso</span>
											)}
										</span>
									);
								})}
							</div>
						</div>
					)}

					<div className="pc-body">
						{confirmForget ? (
							<div className="pc-confirm">
								<span className="pc-confirm-msg">
									¿Olvidar la credencial de {meta.name}?
								</span>
								<div className="pc-actions">
									<button className="pc-sec" onClick={() => setConfirmForget(false)}>
										Cancelar
									</button>
									<button className="pc-danger" onClick={forget}>
										<Codicon name="trash" size={12} /> Olvidar
									</button>
								</div>
							</div>
						) : meta.authType === "apikey" ? (
							provider.authed && !editing ? (
								<div className="pc-authed">
									<button
										className="pc-iconbtn"
										title="Cambiar API key"
										onClick={() => setEditing(true)}
									>
										<Codicon name="edit" size={13} />
										<span>Cambiar</span>
									</button>
									<button className="pc-link-btn" onClick={() => setConfirmForget(true)}>
										<Codicon name="trash" size={12} /> Olvidar API key
									</button>
								</div>
							) : (
								<>
									<div className="pc-input-wrap">
										<input
											className="pc-input"
											type={showKey ? "text" : "password"}
											placeholder={meta.keyPlaceholder ?? "API key (sk-...)"}
											value={key}
											autoComplete="off"
											spellCheck={false}
											onChange={(e) => setKey(e.target.value)}
											onKeyDown={(e) => {
												if (e.key === "Enter" && key.trim()) save();
											}}
										/>
										<button
											type="button"
											className="pc-reveal-btn"
											title={showKey ? "Ocultar clave" : "Mostrar clave"}
											onClick={() => setShowKey(!showKey)}
										>
											<Codicon name={showKey ? "eye-closed" : "eye"} size={13} />
										</button>
									</div>
									<div className="pc-actions">
										{provider.authed && (
											<button className="pc-sec" onClick={cancelEdit}>
												Cancelar
											</button>
										)}
										<button className="pc-save" onClick={save} disabled={!key.trim()}>
											Guardar key
										</button>
										{meta.getKeyUrl && (
											<a
												className="pc-ext"
												href={meta.getKeyUrl}
												target="_blank"
												rel="noreferrer"
											>
												Obtener key <Codicon name="link-external" size={11} />
											</a>
										)}
									</div>
								</>
							)
						) : provider.authed ? (
							<div className="pc-authed">
								<button className="pc-link-btn" onClick={() => setConfirmForget(true)}>
									<Codicon name="sign-out" size={12} /> Olvidar acceso
								</button>
							</div>
						) : deviceCode ? (
							<div className="oauth-banner">
								<div className="oauth-title">Iniciando sesión…</div>
								<div className="oauth-hint">
									Entra este código en el navegador que se abrió:
								</div>
								<div className="oauth-code-row">
									<div className="oauth-code">{deviceCode.userCode}</div>
									<button
										type="button"
										className="oauth-copy-btn"
										onClick={copyDeviceCode}
										title="Copiar código al portapapeles"
									>
										<Codicon name={copiedCode ? "check" : "copy"} size={12} />
										<span>{copiedCode ? "Copiado" : "Copiar"}</span>
									</button>
								</div>
								<a
									className="oauth-link"
									href={deviceCode.verificationUri}
									target="_blank"
									rel="noreferrer"
								>
									{deviceCode.verificationUri} <Codicon name="link-external" size={11} />
								</a>
							</div>
						) : (
							<button className="pc-save" onClick={() => onLogin(provider.id)}>
								<Codicon name="sign-in" size={13} /> Iniciar sesión
							</button>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
