// frida-pipeline — banner persistente en el webview (Fase 1).
//
// Panel React montado vía `webBridge.mountPersistent` en el footer, igual
// patrón que `frida-workflow/panel.ts` (D32). Muestra el estado del
// orquestador: hermanas, conteos y estado global.
//
// Fase 1: el panel lee el estado bajo demanda (cada render) — no tiene store
// reactivo propio. Las Fases 2+ añadirán un store que re-renderice al cambiar
// el estado de las hermanas (ej. una extensión hermana se desinstala).

import { useSyncExternalStore, useState } from "react";
import type { ReactElement } from "react";
import { computePipelineStatus, type PipelineStatus } from "./setup-command";
import { CollapsiblePanel } from "../../frida-webview/CollapsiblePanel";

// ---------------------------------------------------------------------------
// Store del banner (Fase 1: snapshot estático, sin reactividad)
// ---------------------------------------------------------------------------
//
// En Fase 1, el estado no cambia durante la sesión (las hermanas no se
// montan/desmontan en caliente). Mantenemos un store trivial con un solo
// snapshot, para que las Fases 2+ puedan mutarlo sin cambiar la API del
// componente.

let cachedStatus: PipelineStatus = computePipelineStatus();
const listeners = new Set<() => void>();

function emit(): void {
	for (const l of listeners) l();
}

export const bannerStore = {
	subscribe(l: () => void): () => void {
		listeners.add(l);
		return () => listeners.delete(l);
	},
	getSnapshot(): PipelineStatus {
		// Recalcular cada vez que se pida un snapshot — es barato (5 stat + 1
		// readFile) y garantiza que el panel refleja el estado real, no uno
		// cacheado. En Fase 2 lo cambiaremos a un store reactivo con sha256
		// sobre los `index.ts` de las hermanas.
		const next = computePipelineStatus();
		// Si el conteo de hermanas cambió, emitimos para re-renderizar.
		if (next.siblings.presentCount === cachedStatus.siblings.presentCount) {
			cachedStatus = next;
		} else {
			cachedStatus = next;
			emit();
		}
		return cachedStatus;
	},
	/** Sólo tests. */
	_reset(): void {
		cachedStatus = computePipelineStatus();
		listeners.clear();
	},
};

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

const STATE_ICON: Record<PipelineStatus["level"], string> = {
	ready: "pass-filled",
	degraded: "warning",
	empty: "circle",
};

const STATE_COLOR: Record<PipelineStatus["level"], string> = {
	ready: "var(--vscode-gitDecoration-addedResourceForeground, #3fb950)",
	degraded: "var(--vscode-list-warningForeground, #cca700)",
	empty: "var(--vscode-descriptionForeground)",
};

function BannerPanel(): ReactElement {
	const status = useSyncExternalStore(
		bannerStore.subscribe,
		bannerStore.getSnapshot,
	);
	const allPresent = status.siblings.allPresent;
	const counts = status.counts;
	const [collapsed, setCollapsed] = useState(false);

	return (
		<CollapsiblePanel
			collapsed={collapsed}
			onToggle={() => setCollapsed((c) => !c)}
			padding={6}
			header={
				<fbox flexDirection="row" gap={6} alignItems="center">
					<ficon
						name="layers"
						size={13}
						color="var(--vscode-textLink-foreground, #4daafc)"
					/>
					<ftext bold size={12}>
						frida-pipeline
					</ftext>
					<ficon
						name={STATE_ICON[status.level]}
						size={11}
						color={STATE_COLOR[status.level]}
					/>
					<ftext color={STATE_COLOR[status.level]} size={11}>
						v{status.siblings.fridaVersion}
					</ftext>
				</fbox>
			}
		>
			{/* Hermanas */}
			<fbox flexDirection="row" gap={6} alignItems="center">
				<ficon
					name={allPresent ? "check" : "warning"}
					size={11}
					color={
						allPresent
							? "var(--vscode-testing-iconPassed)"
							: "var(--vscode-list-warningForeground)"
					}
				/>
				<ftext size={11}>
					Hermanas: {status.siblings.presentCount}/{status.siblings.expectedCount}
				</ftext>
			</fbox>

			{/* Conteos */}
			<fbox flexDirection="row" gap={12} alignItems="center">
				<ftext size={11} color="var(--vscode-descriptionForeground)">
					Skills: {counts.skills.present}/{counts.skills.expected}
				</ftext>
				<ftext size={11} color="var(--vscode-descriptionForeground)">
					Agentes: {counts.agents.present}/{counts.agents.expected}
				</ftext>
				<ftext size={11} color="var(--vscode-descriptionForeground)">
					Workflows: {counts.workflows.present}/{counts.workflows.expected}
				</ftext>
			</fbox>

			{/* Lista de hermanas (sólo si falta alguna, para no saturar el footer) */}
			{!status.siblings.allPresent && (
				<fbox flexDirection="column" padding={2} gap={2}>
					{status.siblings.siblings
						.filter((s) => !s.present)
						.map((s) => (
							<fbox key={s.id} flexDirection="row" gap={4} alignItems="center">
								<ficon name="error" size={11} color={STATE_COLOR.degraded} />
								<ftext color={STATE_COLOR.degraded} size={11}>
									{s.id}
								</ftext>
							</fbox>
						))}
				</fbox>
			)}
		</CollapsiblePanel>
	);
}

/** Factory del elemento raíz (el host lo pasa a `mountPersistent`). */
export function createPipelineBannerElement(): ReactElement {
	return <BannerPanel />;
}
