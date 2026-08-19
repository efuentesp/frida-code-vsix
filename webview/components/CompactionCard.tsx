import type { CompactionEntry } from "../types";
import { Codicon } from "./Codicon";
import { SummaryCard } from "./SummaryCard";

// Wrapper de SummaryCard para la compactación de contexto. Mantiene el export
// CompactionCard para no tocar los puntos de uso (App.tsx).
export function CompactionCard({ entry }: { entry: CompactionEntry }) {
	return (
		<SummaryCard
			label="[compaction]"
			subtitle={`Compactado desde ${entry.tokensBefore.toLocaleString()} tokens`}
			summary={entry.summary}
			intro={`Compactado desde ${entry.tokensBefore.toLocaleString()} tokens`}
			icon={<Codicon name="archive" size={14} />}
		/>
	);
}
