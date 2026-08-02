// Bloque de invocación de skill colapsable (equivalente al
// SkillInvocationMessageComponent del TUI). Cuando el mensaje del usuario es un
// skill block (/skill:nombre expandido por pi), se colapsa en "[skill] name" y se
// expande bajo clic para no inundar el transcript con el SKILL.md completo.

import { useState } from "react";
import { GraduationCap } from "lucide-react";
import type { SkillBlock } from "../skill-block";
import { Markdown } from "./Markdown";
import { Icon } from "./Icon";

export function SkillBlockCard({
	block,
	live,
	input,
}: {
	block: SkillBlock;
	/** true mientras Frida trabaja en este skill (el turno es el activo + busy).
	 *  El icono 🎓 pulsa para indicar que el skill está en ejecución. */
	live?: boolean;
	/** Argumento(s) que el usuario pasó al skill (tras /skill:nombre), ya limpios
	 *  del prefijo 'Skill input:'. Se muestra como chip muteado en la cabecera. */
	input?: string;
}) {
	const [open, setOpen] = useState(false);
	return (
		<div className="skill-block">
			<button
				type="button"
				className="skill-head"
				onClick={() => setOpen((v) => !v)}
				title={open ? "Contraer skill" : "Expandir skill"}
			>
				<GraduationCap
					size={13}
					className={"skill-icon" + (live ? " live" : "")}
				/>
				<span className="skill-label">[skill]</span>
				<span className="skill-name">{block.name}</span>
				{input ? (
					<span className="skill-input" title={input}>
						{input}
					</span>
				) : null}
				<span className={"skill-chev" + (open ? "" : " closed")}>
					<Icon name="chevron" size={12} />
				</span>
			</button>
			{open && (
				<div className="skill-content">
					<div className="skill-path" title={block.location}>
						{block.location}
					</div>
					<Markdown>{`**${block.name}**\n\n${block.content}`}</Markdown>
				</div>
			)}
		</div>
	);
}
