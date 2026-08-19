import { useEffect, useState } from "react";
import { Codicon } from "./Codicon";
import type { OutMessage, State } from "../types";
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
	| "usage";

const TABS: { id: SettingsTab; label: string; icon: string }[] = [
	{ id: "providers", label: "Proveedores", icon: "plug" },
	{ id: "models", label: "Modelos", icon: "settings" },
	{ id: "approval", label: "Auto-Aprobación", icon: "settings" },
	{ id: "resources", label: "Recursos", icon: "library" },
	{ id: "tools", label: "Herramientas", icon: "wrench" },
	{ id: "usage", label: "Uso", icon: "graph" },
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

	// Esc cierra el overlay (§5.6); click en el scrim también (onClose en wrapper).
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	return (
		<div className="cfg-overlay" onClick={onClose}>
			<div
				className="cfg-panel"
				onClick={(e) => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-label="Configuración"
			>
			<div className="cfg-head">
				<span className="cfg-title">Configuración</span>
				<button className="ico" onClick={onClose}>
					<Codicon name="close" size={15} label="Cerrar" />
				</button>
			</div>
			<div className="cfg-tabs">
				{TABS.map((t) => (
					<button
						key={t.id}
						className={"cfg-tab" + (tab === t.id ? " active" : "")}
						onClick={() => setTab(t.id)}
					>
						<Codicon name={t.icon} size={13} /> {t.label}
					</button>
				))}
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
									<Codicon name="refresh" size={13} /> Recargar extensiones y recursos
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
						<ToggleRow
							title="Preguntar al usuario"
							desc="Habilita el tool ask_user_question para que el agente pregunte con opciones concretas en vez de adivinar."
							on={state.toolToggles?.askUserQuestion ?? true}
							onToggle={() =>
								post({
									type: "set_tool_toggle",
									key: "askUserQuestion",
									enabled: !(state.toolToggles?.askUserQuestion ?? true),
								})
							}
						/>
						<ToggleRow
							title="Lista de tareas"
							desc="Habilita el tool todo y el panel de Tareas para seguimiento multi-paso. Aplica al recargar (sin perder historial)."
							on={state.toolToggles?.todo ?? true}
							onToggle={() =>
								post({
									type: "set_tool_toggle",
									key: "todo",
									enabled: !(state.toolToggles?.todo ?? true),
								})
							}
						/>
					</>
				)}

				{tab === "usage" && <UsageDashboard state={state} post={post} />}
			</div>
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
