import { useState } from "react";
import { Codicon } from "./Codicon";
import type { ProviderOption } from "../types";
import { providerMeta } from "../providers-registry";
import { ProviderConfig } from "./ProviderConfig";
import { FilterBar } from "./FilterBar";
import { highlightText, matchesAny } from "../highlight";

// Sección "Proveedores" del hub de Configuración. Dos bloques:
//  - Configurados: proveedores con credenciales válidas (authed).
//  - Disponibles: el resto, listos para configurar.
// La lista de proveedores viene del host (state.models.providers); el registry
// aporta la metadata de UI. Cada proveedor se configura según su tipo (ProviderConfig).
// Filtro local (embudo): filtra tarjetas por nombre, id o modelo — mismo
// predicado que la búsqueda global del hub, sin abandonar el tab.
export function ProveedoresTab({
	providers,
	deviceCode,
	activeModel,
	onSetKey,
	onLogin,
	onLogout,
	initialQuery = "",
	showFilter = true,
	highlightQuery = "",
}: {
	providers: ProviderOption[];
	deviceCode?: { userCode: string; verificationUri: string };
	activeModel?: { provider: string; modelId: string };
	onSetKey: (id: string, key: string) => void;
	onLogin: (id: string) => void;
	onLogout: (id: string) => void;
	/** Consulta inicial del filtro (pruebas / deep-links). */
	initialQuery?: string;
	/** false oculta la barra (p.ej. cuando se reusa dentro de los resultados
	 * de la búsqueda global del hub, que ya trae su propio input). */
	showFilter?: boolean;
	/** Consulta externa para resaltar coincidencias sin barra propia
	 * (resultados de la búsqueda global). */
	highlightQuery?: string;
}) {
	const [query, setQuery] = useState(initialQuery);
	const q = query.trim();
	// Con barra propia se resalta lo filtrado aquí; sin barra (vista de
	// resultados globales) se resalta la consulta externa.
	const hq = showFilter ? q : highlightQuery.trim();

	const allConfigured = providers.filter((p) => p.authed);
	const allAvailable = providers.filter((p) => !p.authed);
	const match = (p: ProviderOption) =>
		matchesAny(
			q,
			p.name,
			p.id,
			...(p.models ?? []).map((m) => m.name),
			...(p.models ?? []).map((m) => m.id),
		);
	const configured = q ? allConfigured.filter(match) : allConfigured;
	const available = q ? allAvailable.filter(match) : allAvailable;
	// Contador de sección: "n/total" mientras se filtra.
	const cnt = (n: number, t: number) => (q ? `${n}/${t}` : String(n));

	const card = (p: ProviderOption) => (
		<ProviderConfig
			key={p.id}
			provider={p}
			meta={providerMeta(p.id, p.oauth)}
			deviceCode={p.oauth ? deviceCode : undefined}
			activeModelId={
				activeModel?.provider === p.id ? activeModel.modelId : undefined
			}
			highlightQuery={hq}
			onSetKey={onSetKey}
			onLogin={onLogin}
			onLogout={onLogout}
		/>
	);

	return (
		<div className="pv-tab">
			{showFilter && (
				<FilterBar
					value={query}
					onChange={setQuery}
					placeholder="Filtrar proveedores (nombre o modelo)…"
					label="Filtrar proveedores"
				/>
			)}
			{q && configured.length === 0 && available.length === 0 ? (
				<div className="cfg-search-empty">
					<Codicon name="search" size={24} className="cfg-empty-icon" />
					<div className="cfg-empty-title">
						No hay proveedores que coincidan con &quot;{q}&quot;
					</div>
					<div className="cfg-empty-desc">
						Verifica la ortografía o busca por otro término.
					</div>
					<button
						type="button"
						className="cfg-empty-btn"
						onClick={() => setQuery("")}
					>
						Limpiar filtro
					</button>
				</div>
			) : (
				<>
					{configured.length > 0 && (
						<section className="pv-section">
							<h4 className="pv-heading">
								<Codicon name="pass-filled" size={13} /> Configurados (
								{cnt(configured.length, allConfigured.length)})
							</h4>
							<div className="pv-list">{configured.map(card)}</div>
						</section>
					)}

					{(available.length > 0 || !q) && (
						<section className="pv-section">
							<h4 className="pv-heading">
								<Codicon name="plug" size={13} /> Disponibles (
								{cnt(available.length, allAvailable.length)})
							</h4>
							{available.length === 0 ? (
								<div className="pv-empty">
									Todos los proveedores están configurados. 🎉
								</div>
							) : (
								<div className="pv-list">{available.map(card)}</div>
							)}
						</section>
					)}
				</>
			)}

			{!q && (
				<p className="pv-hint">
					<Codicon name="plug" size={12} /> Cada proveedor se configura distinto:
					DevEngine y Z.ai usan API key; GitHub Copilot usa inicio de sesión (OAuth).
				</p>
			)}
		</div>
	);
}
