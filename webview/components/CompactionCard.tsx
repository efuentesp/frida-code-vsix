import type { CompactionEntry } from "../types";
import { Archive } from "lucide-react";
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
			icon={<Archive size={14} />}
		/>
	);
}
