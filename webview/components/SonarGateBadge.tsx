// M3 (#144) — badge de quality gate en la franja del chat (FR-6): veredicto
// del último turno + diff +N -M junto al panel frida-lens existente, bajo el
// composer. Estado propio (state.sonar ← sonar_gate_state, D4): NO extiende
// LensSummary ni LensDiagnostics (que se auto-oculta en 0/0 — el badge SÍ
// aparece en PASS limpio, smoke del artefacto). Sólo renderiza en status
// "ready": sin pi-lens (not-installed) o sin datos (no-data) no hay veredicto
// que mostrar y el badge NO aparece (Desired End State #5; error tampoco —
// el hint vive en el tab, la franja no grita). Reusa el mapa visual de
// veredictos del tab (VERDICT_META — Ordering Constraint «el badge reusa
// helpers visuales del tab») y las clases .sn-diff/.sn-diff-add/.sn-diff-res
// del slice 4. NFR UX: codicons (sin glifos unicode), variables --vscode-*,
// prefijo .sn- (docs/webview-ui-styles.md).

import type { SonarUiState } from "../types";
import { Codicon } from "./Codicon";
import { VERDICT_META } from "./SonarTab";

/**
 * Pill compacta: [icono veredicto] Sonar PASS +N -M [warning si degradado].
 * Clic → abrir el tab «Sonar» del SettingsHub (callback inyectado por App,
 * molde onOpenProviders del Composer). Null en todo estado no-ready.
 */
export function SonarGateBadge({
	sonar,
	onOpen,
}: {
	sonar: SonarUiState | undefined;
	onOpen: () => void;
}) {
	if (sonar?.status !== "ready") return null;
	const d = sonar.data;
	const meta = VERDICT_META[d.verdict];
	const title = [
		"frida-sonar — gate del último turno",
		`${d.blocking} blocking · ${d.errors} errores · ${d.effectiveWarnings} warnings efectivas (de ${d.warnings})`,
		`+${d.diff.added} nuevas · -${d.diff.resolved} resueltas contra el snapshot del turno anterior`,
		...(d.degraded ? [`Gate degradado: ${d.causes.join(" · ")}`] : []),
		"Clic para abrir el tab Sonar",
	].join("\n");
	return (
		<button
			type="button"
			className={"sn-badge " + meta.cls}
			onClick={onOpen}
			title={title}
			aria-label={`Sonar ${meta.label}: ${d.diff.added} nuevas, ${d.diff.resolved} resueltas`}
		>
			<Codicon name={meta.icon} size={12} />
			<span className="sn-badge-label">Sonar {meta.label}</span>
			<span className="sn-diff">
				<span className="sn-diff-add">
					<Codicon name="diff-added" size={11} />+{d.diff.added}
				</span>
				<span className="sn-diff-res">
					<Codicon name="diff-removed" size={11} />-{d.diff.resolved}
				</span>
			</span>
			{d.degraded && (
				<Codicon
					name="warning"
					size={11}
					className="sn-badge-deg"
					ariaLabel="gate degradado"
				/>
			)}
		</button>
	);
}
