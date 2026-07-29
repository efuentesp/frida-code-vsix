import { useState } from "react";
import { Bot, KeyRound, Sparkles } from "lucide-react";

// Ids del contrato host↔webview (deben coincidir con SOFTTEK_PROVIDER/ZAI_PROVIDER
// en el host). El onboarding mapea su selección interna al id real.
const SOFTTEK_ID = "softtek-devengine";
const ZAI_ID = "zai";

type OnbProvider = "softtek" | "zai" | "copilot";

export function Onboarding({
	deviceCode,
	onSubmit,
	onLoginCopilot,
}: {
	deviceCode?: { userCode: string; verificationUri: string };
	onSubmit: (provider: string, key: string) => void;
	onLoginCopilot: () => void;
}) {
	const [provider, setProvider] = useState<OnbProvider>("softtek");
	const [key, setKey] = useState("");

	const submit = () => {
		const trimmed = key.trim();
		if (!trimmed) return;
		onSubmit(provider === "softtek" ? SOFTTEK_ID : ZAI_ID, trimmed);
	};

	return (
		<div className="overlay">
			<h2>
				<span className="avatar ai">
					<Bot size={15} />
				</span>{" "}
				Frida Code
			</h2>
			<p className="onb-intro">Elige cómo conectarte para empezar.</p>

			<div className="onb-providers">
				<button
					className={"onb-opt" + (provider === "softtek" ? " selected" : "")}
					onClick={() => setProvider("softtek")}
				>
					<KeyRound size={16} />
					<div>
						<div className="onb-opt-title">Softtek DevEngine</div>
						<div className="onb-opt-sub">API key (X-Api-Key)</div>
					</div>
				</button>
				<button
					className={"onb-opt" + (provider === "zai" ? " selected" : "")}
					onClick={() => setProvider("zai")}
				>
					<Sparkles size={16} />
					<div>
						<div className="onb-opt-title">Z.ai (GLM)</div>
						<div className="onb-opt-sub">API key · Authorization Bearer</div>
					</div>
				</button>
				<button
					className={"onb-opt" + (provider === "copilot" ? " selected" : "")}
					onClick={() => setProvider("copilot")}
				>
					<Sparkles size={16} />
					<div>
						<div className="onb-opt-title">GitHub Copilot</div>
						<div className="onb-opt-sub">
							Suscripción · inicia sesión con GitHub
						</div>
					</div>
				</button>
			</div>

			{(provider === "softtek" || provider === "zai") && (
				<>
					<input
						type="password"
						placeholder={
							provider === "softtek" ? "mwr-sk-..." : "<z.ai api key>"
						}
						value={key}
						onChange={(e) => setKey(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") submit();
						}}
					/>
					<button onClick={submit}>Guardar key y empezar</button>
				</>
			)}

			{provider === "copilot" &&
				(deviceCode ? (
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
					<button className="primary-btn" onClick={onLoginCopilot}>
						Iniciar sesión con GitHub
					</button>
				))}
		</div>
	);
}
