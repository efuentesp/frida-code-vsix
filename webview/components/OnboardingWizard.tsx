import { useEffect, useState } from "react";
import { Codicon } from "./Codicon";
import type { ProviderOption } from "../types";
import { providerMeta } from "../providers-registry";
import { ProviderConfig } from "./ProviderConfig";

// Wizard de onboarding estilo Kilo: multi-paso guiado.
//   welcome → choose → configure → done
// "configure" reusa ProviderConfig y avanza a "done" cuando el proveedor elegido
// pasa a authed (el host verifica la credencial al configurar). El wizard se queda
// montado por un flag local (wizardDone en App) para mostrar el "¡Listo!" antes
// de cerrar — aunque el host ya haya posteado session_ready.
export type WizardStep = "welcome" | "choose" | "configure" | "done";

export function OnboardingWizard({
	providers,
	deviceCode,
	onSetKey,
	onLogin,
	onLogout,
	onDone,
	onOpenSettings,
}: {
	providers: ProviderOption[];
	deviceCode?: { userCode: string; verificationUri: string };
	onSetKey: (id: string, key: string) => void;
	onLogin: (id: string) => void;
	onLogout: (id: string) => void;
	onDone: () => void;
	onOpenSettings: () => void;
}) {
	const [step, setStep] = useState<WizardStep>("welcome");
	const [chosenId, setChosenId] = useState<string | undefined>(undefined);
	const chosen = providers.find((p) => p.id === chosenId);

	// Conexión verificada: el proveedor elegido pasó a authed → avanzar a "done".
	useEffect(() => {
		if (step === "configure" && chosen?.authed) {
			setStep("done");
		}
	}, [step, chosen?.authed]);

	return (
		<div className="overlay onb-wizard">
			<div className="onb-card">
				<div className="onb-brand">
					<span className="avatar ai">
						<Codicon name="copilot" size={16} />
					</span>{" "}
					Frida Code
				</div>

				{step === "welcome" && (
					<div className="onb-step">
						<h2>Conecta tu primer proveedor</h2>
						<p className="onb-intro">
							Para empezar a chatear necesitas conectar al menos un proveedor de
							modelos. Te guiamos en 3 pasos.
						</p>
						<ul className="onb-checklist">
							<li>Elige un proveedor</li>
							<li>Configúralo (API key o inicio de sesión)</li>
							<li>Verifica la conexión</li>
						</ul>
						<div className="onb-actions">
							<button className="primary-btn" onClick={() => setStep("choose")}>
								Empezar <Codicon name="arrow-right" size={14} />
							</button>
							<button className="onb-link-btn" onClick={onOpenSettings}>
								<Codicon name="settings-gear" size={13} /> Abrir Configuración
							</button>
						</div>
					</div>
				)}

				{step === "choose" && (
					<div className="onb-step">
						<h2>Elige un proveedor</h2>
						<p className="onb-intro">
							Cada uno se configura distinto. Puedes añadir más tarde desde
							Configuración.
						</p>
						<div className="onb-providers">
							{providers.map((p) => {
								const meta = providerMeta(p.id, p.oauth);
								return (
									<button
										key={p.id}
										className="onb-opt"
										onClick={() => {
											setChosenId(p.id);
											setStep("configure");
										}}
									>
										<div>
											<div className="onb-opt-title">{meta.name}</div>
											<div className="onb-opt-sub">
												{meta.authType === "oauth"
													? "Inicio de sesión (OAuth)"
													: (meta.keyHint ?? "API key")}
											</div>
										</div>
										<Codicon name="arrow-right" size={14} />
									</button>
								);
							})}
						</div>
						<div className="onb-actions">
							<button className="onb-link-btn" onClick={() => setStep("welcome")}>
								<Codicon name="arrow-left" size={13} /> Atrás
							</button>
						</div>
					</div>
				)}

				{step === "configure" && chosen && (
					<div className="onb-step">
						<div className="onb-stephead">
							<button className="onb-link-btn" onClick={() => setStep("choose")}>
								<Codicon name="arrow-left" size={13} /> Atrás
							</button>
							<h2>Configura {providerMeta(chosen.id, chosen.oauth).name}</h2>
						</div>
						<ProviderConfig
							provider={chosen}
							meta={providerMeta(chosen.id, chosen.oauth)}
							deviceCode={chosen.oauth ? deviceCode : undefined}
							defaultExpanded={true}
							onSetKey={onSetKey}
							onLogin={onLogin}
							onLogout={onLogout}
						/>
						<p className="onb-hint">
							Al guardar, verificamos la conexión automáticamente…
						</p>
					</div>
				)}

				{step === "done" && chosen && (
					<div className="onb-step onb-done">
						<Codicon name="sparkle" size={28} className="onb-done-icon" />
						<h2>¡Conectado!</h2>
						<p className="onb-intro">
							<Codicon name="check" size={13} />{" "}
							{providerMeta(chosen.id, chosen.oauth).name} está listo. Ya puedes
							chatear con Frida.
						</p>
						<div className="onb-actions">
							<button className="primary-btn" onClick={onDone}>
								Empezar a chatear <Codicon name="arrow-right" size={14} />
							</button>
							<button className="onb-link-btn" onClick={onOpenSettings}>
								<Codicon name="settings-gear" size={13} /> Configuración
							</button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
