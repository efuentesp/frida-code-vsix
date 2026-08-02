// Card de resumen de branch colapsable (equivalente al
// BranchSummaryMessageComponent del TUI). pi genera este resumen del contexto
// previo al bifurcar una sesión larga (role:"branchSummary"). Se muestra al inicio
// del transcript al abrir/switch. Reusa los estilos de .compact-card.

import { useState } from "react";
import type { BranchSummaryEntry } from "../types";
import { Markdown } from "./Markdown";
import { Tooltip } from "./Tooltip";
import { Icon } from "./Icon";

export function BranchSummaryCard({ entry }: { entry: BranchSummaryEntry }) {
	const [open, setOpen] = useState(false);
	return (
		<div className={"compact-card" + (open ? " open" : "")}>
			<button className="compact-head" onClick={() => setOpen((v) => !v)}>
				<span className="compact-label">[branch]</span>
				<span className="compact-tokens">
					Resumen del branch (contexto previo)
				</span>
				<Tooltip
					label={open ? "Contraer resumen" : "Mostrar resumen"}
					side="top"
				>
					<span className={"compact-toggle" + (open ? "" : " closed")}>
						<Icon name="chevron" size={12} />
					</span>
				</Tooltip>
			</button>
			{open && (
				<div className="compact-body">
					<Markdown>{entry.summary}</Markdown>
				</div>
			)}
		</div>
	);
}
