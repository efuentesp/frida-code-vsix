import { useState } from "react";
import { Codicon } from "./Codicon";
import type { ProviderOption } from "../types";
import type { ProviderMeta } from "../providers-registry";

// UI de configuración de UN proveedor, según su tipo de auth:
//  - apikey (DevEngine, Z.ai): input de key + "Guardar" + link "Obtener key".
//  - oauth  (GitHub Copilot): botón "Iniciar sesión" → device code.
// Cuando ya está conectado (authed):
//  - ícono pequeño "Cambiar" (entra en edición; Cancelar/Guardar vacío NO cambia nada).
//  - "Olvidar API key" con confirmación → onLogout (borra la credencial → disponible).
// Así cambiar la key por error NUNCA mueve el proveedor a disponibles; sólo lo hace
// "Olvidar", y con confirmación explícita.
export function ProviderConfig({
	provider,
	meta,
	deviceCode,
	onSetKey,
	onLogin,
	onLogout,
}: {
	provider: ProviderOption;
	meta: ProviderMeta;
	deviceCode?: { userCode: string; verificationUri: string };
	onSetKey: (id: string, key: string) => void;
	onLogin: (id: string) => void;
	onLogout: (id: string) => void;
}) {
	const [key, setKey] = useState("");
	const [editing, setEditing] = useState(!provider.authed);
	const [confirmForget, setConfirmForget] = useState(false);

	const cancelEdit = () => {
		setKey("");
		setEditing(false);
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

	return (
		<div className="pc-card">
			<div className="pc-head">
				<span className="pc-icon">
					<Codicon name={meta.authType === "oauth" ? "sparkle" : "key"} size={15} />
				</span>
				<div className="pc-titles">
					<div className="pc-name">
						{meta.name}
						{provider.authed && (
							<span className="pc-badge ok">
								<Codicon name="check" size={11} /> conectado
							</span>
						)}
					</div>
					{meta.blurb && <div className="pc-blurb">{meta.blurb}</div>}
				</div>
			</div>

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
							</button>
							<button className="pc-link-btn" onClick={() => setConfirmForget(true)}>
								<Codicon name="trash" size={12} /> Olvidar API key
							</button>
						</div>
					) : (
						<>
							<input
								className="pc-input"
								type="password"
								placeholder={meta.keyPlaceholder ?? "API key"}
								value={key}
								autoComplete="off"
								spellCheck={false}
								onChange={(e) => setKey(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter" && key.trim()) save();
								}}
							/>
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
							<Codicon name="trash" size={12} /> Olvidar acceso
						</button>
					</div>
				) : deviceCode ? (
					<div className="oauth-banner">
						<div className="oauth-title">Iniciando sesión…</div>
						<div className="oauth-hint">
							Entra este código en el navegador que se abrió:
						</div>
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
				) : (
					<button className="pc-save" onClick={() => onLogin(provider.id)}>
						<Codicon name="sign-in" size={13} /> Iniciar sesión
					</button>
				)}
			</div>
		</div>
	);
}
