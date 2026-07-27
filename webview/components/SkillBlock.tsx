// Bloque de invocación de skill colapsable (equivalente al
// SkillInvocationMessageComponent del TUI). Cuando el mensaje del usuario es un
// skill block (/skill:nombre expandido por pi), se colapsa en "[skill] name" y se
// expande bajo clic para no inundar el transcript con el SKILL.md completo.

import { useState } from "react";
import type { SkillBlock } from "../skill-block";
import { Markdown } from "./Markdown";

export function SkillBlockCard({ block }: { block: SkillBlock }) {
	const [open, setOpen] = useState(false);
	return (
		<div className="skill-block">
			<button
				type="button"
				className="skill-head"
				onClick={() => setOpen((v) => !v)}
				title={open ? "Contraer skill" : "Expandir skill"}
			>
				<span className="skill-label">[skill]</span>
				<span className="skill-name">{block.name}</span>
				<span className={"skill-chev" + (open ? "" : " closed")}>
					{open ? "▾" : "▸"}
				</span>
			</button>
			{open && (
				<div className="skill-content">
					<Markdown>{`**${block.name}**\n\n${block.content}`}</Markdown>
				</div>
			)}
		</div>
	);
}
