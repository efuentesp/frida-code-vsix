import type { BranchSummaryEntry } from "../types";
import { SummaryCard } from "./SummaryCard";

// Wrapper de SummaryCard para el resumen de branch. Mantiene el export
// BranchSummaryCard para no tocar los puntos de uso (App.tsx).
export function BranchSummaryCard({ entry }: { entry: BranchSummaryEntry }) {
	return (
		<SummaryCard
			label="[branch]"
			subtitle="Resumen del branch (contexto previo)"
			summary={entry.summary}
		/>
	);
}
