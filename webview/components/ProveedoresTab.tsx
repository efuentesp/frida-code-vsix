import { Codicon } from "./Codicon";
import type { ProviderOption } from "../types";
import { providerMeta } from "../providers-registry";
import { ProviderConfig } from "./ProviderConfig";

// Sección "Proveedores" del hub de Configuración. Dos bloques:
//  - Configurados: proveedores con credenciales válidas (authed).
//  - Disponibles: el resto, listos para configurar.
// La lista de proveedores viene del host (state.models.providers); el registry
// aporta la metadata de UI. Cada proveedor se configura según su tipo (ProviderConfig).
export function ProveedoresTab({
	providers,
	deviceCode,
	activeModel,
	onSetKey,
	onLogin,
	onLogout,
}: {
	providers: ProviderOption[];
	deviceCode?: { userCode: string; verificationUri: string };
	activeModel?: { provider: string; modelId: string };
	onSetKey: (id: string, key: string) => void;
	onLogin: (id: string) => void;
	onLogout: (id: string) => void;
}) {
	const configured = providers.filter((p) => p.authed);
	const available = providers.filter((p) => !p.authed);

	const card = (p: ProviderOption) => (
		<ProviderConfig
			key={p.id}
			provider={p}
			meta={providerMeta(p.id, p.oauth)}
			deviceCode={p.oauth ? deviceCode : undefined}
			activeModelId={
				activeModel?.provider === p.id ? activeModel.modelId : undefined
			}
			onSetKey={onSetKey}
			onLogin={onLogin}
			onLogout={onLogout}
		/>
	);

	return (
		<div className="pv-tab">
			{configured.length > 0 && (
				<section className="pv-section">
					<h4 className="pv-heading">
						<Codicon name="pass-filled" size={13} /> Configurados ({configured.length}
						)
					</h4>
					<div className="pv-list">{configured.map(card)}</div>
				</section>
			)}

			<section className="pv-section">
				<h4 className="pv-heading">
					<Codicon name="plug" size={13} /> Disponibles ({available.length})
				</h4>
				{available.length === 0 ? (
					<div className="pv-empty">
						Todos los proveedores están configurados. 🎉
					</div>
				) : (
					<div className="pv-list">{available.map(card)}</div>
				)}
			</section>

			<p className="pv-hint">
				<Codicon name="plug" size={12} /> Cada proveedor se configura distinto:
				DevEngine y Z.ai usan API key; GitHub Copilot usa inicio de sesión (OAuth).
			</p>
		</div>
	);
}
