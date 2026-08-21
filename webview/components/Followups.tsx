// webview/components/Followups.tsx — Fila de sugerencias contextuales estilo Copilot Chat
// (Fase 5: Footer — Paneles Dockeados y Followups).

import type { FollowupSuggestion } from "../followup-rules";
import { Codicon } from "./Codicon";

interface Props {
	items: FollowupSuggestion[];
	onSelect: (prompt: string) => void;
}

export function Followups({ items, onSelect }: Props) {
	if (items.length === 0) return null;

	return (
		<div className="chat-followups">
			{items.map((item) => (
				<button
					key={item.id}
					type="button"
					className="chat-followup-btn"
					onClick={() => onSelect(item.prompt)}
					title={item.prompt}
				>
					{item.iconName ? (
						<Codicon
							name={item.iconName}
							size={13}
							className="followup-icon"
						/>
					) : (
						<Codicon name="sparkle" size={13} className="followup-icon" />
					)}
					<span>{item.label}</span>
				</button>
			))}
		</div>
	);
}
