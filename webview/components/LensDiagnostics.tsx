// Panel de diagnósticos de pi-lens (D16). Resumen agregado del último turno:
// "N errores · M warnings · K archivos" + lista plegable. NO son squiggles del
// editor (eso lo cubre el LSP de VS Code); es visibilidad en el panel de lo que
// pi-lens calculó y de otro modo viaja oculto al modelo.
//
// Refleja el estado publicado por el host (post {type:"lens_diagnostics"}).
// Auto-oculto cuando no hay errores ni warnings. Iconos lucide: X = error ·
// TriangleAlert = warning.

import { useState } from "react";
import type { LensSummary } from "../types";
import { Icon } from "./Icon";

export function LensDiagnostics({
	lens,
}: {
	lens: LensSummary | null | undefined;
}) {
	const [open, setOpen] = useState(false);
	if (!lens) return null;
	// Solo mostramos si hay errores o warnings (los "others"/info solos no merecen ruido).
	if (lens.totalErrors === 0 && lens.totalWarnings === 0) return null;

	const head = (
		<>
			{lens.totalErrors > 0 && (
				<span className="lens-count err">
					<Icon name="x" size={11} />
					{lens.totalErrors}
				</span>
			)}
			{lens.totalWarnings > 0 && (
				<span className="lens-count warn">
					<Icon name="alert" size={11} />
					{lens.totalWarnings}
				</span>
			)}
			<span className="lens-files">
				· {lens.fileCount} archivo{lens.fileCount === 1 ? "" : "s"}
			</span>
			{lens.truncated && <span className="lens-trunc">(lista truncada)</span>}
		</>
	);

	return (
		<div className="lens-panel">
			<button
				type="button"
				className="lens-head"
				onClick={() => setOpen((v) => !v)}
				title={open ? "Contraer" : "Expandir"}
			>
				<span className="lens-head-icon">
					<Icon name="search" size={12} />
				</span>
				<span className="lens-head-label">frida-lens</span>
				{head}
				<span className={"lens-caret" + (open ? "" : " closed")}>
					<Icon name="chevron" size={12} />
				</span>
			</button>
			{open && (
				<ul className="lens-list">
					{lens.files.map((f) => (
						<li key={f.path} className="lens-item">
							<span className="lens-path" title={f.path}>
								{f.path}
							</span>
							<span className="lens-item-counts">
								{f.errors > 0 && (
									<span className="err">
										<Icon name="x" size={11} />
										{f.errors}
									</span>
								)}
								{f.warnings > 0 && (
									<span className="warn">
										<Icon name="alert" size={11} />
										{f.warnings}
									</span>
								)}
								{f.others > 0 && <span className="other">• {f.others}</span>}
								{f.truncated && <span className="lens-trunc">+</span>}
							</span>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
