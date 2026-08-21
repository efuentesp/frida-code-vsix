import { useState } from "react";
import { Codicon } from "./Codicon";
import type { ProviderOption } from "../types";
import type { ProviderMeta } from "../providers-registry";

// UI de configuración de UN proveedor (Propuesta 1: VS Code Accounts & Model Hub Card):
//  - apikey: input de key con botón de revelar/ocultar + "Guardar" + link "Obtener key".
//  - oauth: botón "Iniciar sesión" → device code con botón de copiar código al portapapeles.
// Cuando ya está conectado (authed):
//  - badge de estado semántico: "Conectado (OAuth)" / "Conectado (API Key)".
//  - lista visual de modelos aportados con tag "En uso" para el modelo activo en la sesión.
//  - botón "Cambiar" API key y botón "Olvidar" con confirmación de dos pasos.
export function ProviderConfig({
	provider,
	meta,
	deviceCode,
	activeModelId,
	onSetKey,
	onLogin,
	onLogout,
}: {
	provider: ProviderOption;
	meta: ProviderMeta;
	deviceCode?: { userCode: string; verificationUri: string };
	activeModelId?: string;
	onSetKey: (id: string, key: string) => void;
	onLogin: (id: string) => void;
	onLogout: (id: string) => void;
}) {
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

	return (
		<div className="pc-card">
			<div className="pc-head">
				<span className="pc-icon">
					<Codicon
						name={
							meta.authType === "oauth"
								? "sparkle"
								: provider.authed
									? "key"
									: "plug"
						}
						size={16}
					/>
				</span>
				<div className="pc-titles">
					<div className="pc-name-row">
						<span className="pc-name">{meta.name}</span>
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
					</div>
					{meta.blurb && <div className="pc-blurb">{meta.blurb}</div>}
				</div>
			</div>

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
									title={
										isCurrentActive ? "Modelo activo en el chat" : m.name
									}
								>
									<span className="pc-model-chip-name">{m.name}</span>
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
							<button
								className="pc-link-btn"
								onClick={() => setConfirmForget(true)}
							>
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
								<button
									className="pc-save"
									onClick={save}
									disabled={!key.trim()}
								>
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
						<button
							className="pc-link-btn"
							onClick={() => setConfirmForget(true)}
						>
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
							{deviceCode.verificationUri}{" "}
							<Codicon name="link-external" size={11} />
						</a>
					</div>
				) : (
					<button className="pc-save" onClick={() => onLogin(provider.id)}>
						<Codicon name="sign-in" size={13} /> Iniciar sesión
					</button>
				)}
			</div>
		</div>
	);
}
