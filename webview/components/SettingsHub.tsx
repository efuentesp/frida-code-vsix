import { useEffect, useState } from "react";
import {
	BarChart3,
	Database,
	Library,
	Plug,
	RotateCw,
	SlidersHorizontal,
	Wrench,
	X,
} from "lucide-react";
import type { OutMessage, State } from "../types";
import { IndexTab } from "./IndexTab";
import { ProveedoresTab } from "./ProveedoresTab";
import { ResourcesContent } from "./ResourcesPanel";
import { UsageDashboard } from "./UsageDashboard";

// Hub de Configuración (se abre con el engrane ⚙ o desde el onboarding). Pestañas:
// Proveedores · Modelos · Auto-Aprobación · Herramientas. Reemplaza al viejo
// cfg-panel de un sólo bloque. Modelos y Auto-Aprobación quedan como stubs por
// ahora (alcance: onboarding + proveedores primero).
export type SettingsTab =
	| "providers"
	| "models"
	| "approval"
	| "resources"
	| "tools"
	| "usage"
	| "codebaseIndex";

const TABS: { id: SettingsTab; label: string; icon: typeof Plug }[] = [
	{ id: "providers", label: "Proveedores", icon: Plug },
	{ id: "models", label: "Modelos", icon: SlidersHorizontal },
	{ id: "approval", label: "Auto-Aprobación", icon: SlidersHorizontal },
	{ id: "resources", label: "Recursos", icon: Library },
	{ id: "tools", label: "Herramientas", icon: Wrench },
	{ id: "usage", label: "Uso", icon: BarChart3 },
	{ id: "codebaseIndex", label: "Index", icon: Database },
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
	const providers = state.models?.providers ?? [];

	// Al abrir la pestaña Recursos, refrescar la lista desde el host (el botón
	// Library ya no está en el header; lo dispara esto al entrar a la pestaña).
	useEffect(() => {
		if (tab === "resources") post({ type: "list_resources" });
	}, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

	return (
		<div className="cfg-panel">
			<div className="cfg-head">
				<span className="cfg-title">Configuración</span>
				<button className="ico" onClick={onClose}>
					<X size={15} />
				</button>
			</div>
			<div className="cfg-tabs">
				{TABS.map((t) => {
					const Icon = t.icon;
					return (
						<button
							key={t.id}
							className={"cfg-tab" + (tab === t.id ? " active" : "")}
							onClick={() => setTab(t.id)}
						>
							<Icon size={13} /> {t.label}
						</button>
					);
				})}
			</div>
			<div className="cfg-body">
				{tab === "providers" && (
					<ProveedoresTab
						providers={providers}
						deviceCode={state.oauthDeviceCode}
						onSetKey={(id, key) => post({ type: "set_key", provider: id, key })}
						onLogin={(id) => post({ type: "login_provider", provider: id })}
						onLogout={(id) => post({ type: "logout_provider", provider: id })}
					/>
				)}

				{tab === "models" && (
					<div className="cfg-stub">
						La selección rápida de modelo está en el botón de modelo de la barra
						superior. Próximamente: gestión completa de modelos aquí.
					</div>
				)}

				{tab === "approval" && (
					<div className="cfg-stub">
						Los modos de aprobación (manual / auto-edit / auto) están en la
						barra inferior. Próximamente: toggles granulares (leer, escribir,
						bash) estilo Roo Auto-Approve.
					</div>
				)}

				{tab === "resources" && (
					<div className="cfg-resources">
						<div className="cfg-res-actions">
							<button
								className="pc-save"
								onClick={() => post({ type: "reload" })}
								disabled={state.busy}
							>
								<RotateCw size={13} /> Recargar extensiones y recursos
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
						{(state.toolToggleDefs ?? []).map((d) => (
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
						{(state.toolToggleDefs ?? []).length === 0 && (
							<div className="cfg-stub">Cargando herramientas…</div>
						)}
						<div className="cfg-row">
							<div className="cfg-row-info">
								<div className="cfg-row-title">Módulos base (no conmutables)</div>
								<div className="cfg-row-desc">
									Proveedores (sin ellos no hay LLM), sistema de permisos (la
									seguridad; usa los modos de aprobación), motor de skills
									(frida-args/multi-skills) y pipeline RPIV quedan siempre activos
									por diseño.
								</div>
						</div>
					</div>
					</>
				)}

				{tab === "usage" && <UsageDashboard state={state} post={post} />}

				{tab === "codebaseIndex" && <IndexTab state={state} post={post} />}
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
