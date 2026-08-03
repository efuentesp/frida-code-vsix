import type { ReactNode } from "react";
import { Markdown } from "./Markdown";
import { CollapsibleCard } from "./CollapsibleCard";

/**
 * Tarjeta de resumen colapsable para los bloques de metadatos del transcript:
 * la compactación de contexto y el resumen de branch. Unifica lo que antes eran
 * CompactionCard y BranchSummaryCard (casi idénticos entre sí) sobre el mismo
 * CollapsibleCard (variante compact).
 *
 * Equivalente webview del BranchSummaryMessageComponent del TUI de pi.
 */
export interface SummaryCardProps {
	/** Etiqueta corta del título (p.ej. "[compaction]", "[branch]"). */
	label: string;
	/** Subtítulo descriptivo a la derecha del título. */
	subtitle: string;
	/** Resumen (markdown) a mostrar al expandir. */
	summary: string;
	/** Línea introductoria opcional antes del resumen. */
	intro?: ReactNode;
	/** Icono opcional de cabecera. */
	icon?: ReactNode;
}

export function SummaryCard({
	label,
	subtitle,
	summary,
	intro,
	icon,
}: SummaryCardProps) {
	const leading = (
		<>
			<span className="card-title">{label}</span>
			<span className="card-label">{subtitle}</span>
		</>
	);

	return (
		<CollapsibleCard
			variant="compact"
			hasContent
			icon={icon}
			leading={leading}
			chevronTooltip={(open) => (open ? "Contraer resumen" : "Mostrar resumen")}
		>
			{intro ? <div className="compact-intro">{intro}</div> : null}
			<Markdown>{summary}</Markdown>
		</CollapsibleCard>
	);
}
