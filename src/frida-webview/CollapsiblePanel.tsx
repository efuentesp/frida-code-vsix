// CollapsiblePanel — panel colapsable para los paneles persistentes del footer
// del webview (Subagentes, Todo, Workflow, Pipeline banner).
//
// Envuelve un header clicable (chevron ▼/▶ + contenido que cada panel provee) y
// un cuerpo que se omite del árbol al colapsar. Como renderiza tags intrinsic
// (fbox/ftext) del Remote React de Frida, el host lo serializa a WebNode y el
// webview lo materializa en DOM exactamente igual que WorkflowPanel/AgentWidget.
//
// El onClick del header viaja como handlerId en el árbol → el webview dispara
// web_event → el host ejecuta el toggle. pickEventHandlers (RemoteRoot) soporta
// cualquier clave on* en fbox, así que el header entero es clicable.
//
// El estado colapsado lo mantiene cada panel con useState local (default
// expandido): es puramente cosmético de UI y arranca expandido en cada sesión,
// sin acoplarlo a los stores existentes (agent/runs/tasks), que son fuente de
// verdad del dominio.

import type { ReactElement, ReactNode } from "react";

export interface CollapsiblePanelProps {
	/** ¿Está colapsado? true → sólo se renderiza el header (chevron ▶). */
	collapsed: boolean;
	/** Alterna el estado colapsado. Lo conecta al useState del panel. */
	onToggle: () => void;
	/** Contenido del header, a la derecha del chevron: título, count, indicador.
	 *  Lo arma cada panel con sus propios ftext/fbox. */
	header: ReactNode;
	/** Controles fuera de la zona clicable del header (#84) — el click no
	 *  burbujea al toggle (p.ej. botón pin del panel de workflows). */
	actions?: ReactNode;
	/** Cuerpo del panel. Sólo se renderiza (y serializa al webview) cuando NO
	 *  está colapsado — al colapsar, el subárbol completo deja de viajar, lo que
	 *  reduce commits y libera el espacio vertical del footer. */
	children: ReactNode;
	/** Padding del contenedor (pasa al fbox raíz). Preserva el look de cada panel. */
	padding?: number;
	/** Gap entre header y cuerpo (pasa al fbox raíz). */
	gap?: number;
	/** Clase CSS extra del contenedor. */
	cls?: string;
}

export function CollapsiblePanel({
	collapsed,
	onToggle,
	header,
	actions,
	children,
	padding,
	gap,
	cls,
}: CollapsiblePanelProps): ReactElement {
	return (
		<fbox flexDirection="column" padding={padding} gap={gap} cls={cls}>
			<fbox
				flexDirection="row"
				alignItems="center"
				justifyContent="space-between"
			>
				<fbox
					flexDirection="row"
					gap={4}
					alignItems="center"
					onClick={onToggle}
					cls="panel-header"
				>
					<ficon
						name={collapsed ? "chevron-right" : "chevron-down"}
						size={11}
						color="#8b949e"
					/>
					{header}
				</fbox>
				{actions}
			</fbox>
			{collapsed ? null : children}
		</fbox>
	);
}
