// Bloque de invocación de skill colapsable (equivalente al
// SkillInvocationMessageComponent del TUI). Cuando el mensaje del usuario es un
// skill block (/skill:nombre expandido por pi), se colapsa en "[skill] name" y se
// expande bajo clic para no inundar el transcript con el SKILL.md completo.

import { useState } from "react";
import type { SkillBlock } from "../skill-block";
import { Markdown } from "./Markdown";
import { Icon } from "./Icon";
import { Codicon } from "./Codicon";

export function SkillBlockCard({
	block,
	live,
	input,
	onCopy,
}: {
	block: SkillBlock;
	/** true mientras Frida trabaja en este skill (el turno es el activo + busy).
	 *  El icono 🎓 pulsa para indicar que el skill está en ejecución. */
	live?: boolean;
	/** Argumento(s) que el usuario pasó al skill (tras /skill:nombre), ya limpios
	 *  del prefijo 'Skill input:'. Se muestra como chip muteado en la cabecera. */
	input?: string;
	onCopy?: (text: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const [copied, setCopied] = useState(false);
	// Invocación completa lista para repetir (pegar en el composer de otra sesión).
	const cmd = input ? `/skill:${block.name} ${input}` : `/skill:${block.name}`;
	const copy = () => {
		onCopy?.(cmd);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};
	return (
		<div className="skill-block">
			<button
				type="button"
				className="skill-head"
				onClick={() => setOpen((v) => !v)}
				title={open ? "Contraer skill" : "Expandir skill"}
			>
				<Codicon
					name="sparkle"
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
					<div className="tc-section">
						<div className="tc-section-label">Entrada</div>
						<div className="tc-section-body">
							<div className="skill-args-text">{cmd}</div>
							<button
								type="button"
								className="skill-args-copy"
								onClick={copy}
								title={cmd}
							>
								{copied ? (
									<Codicon name="check" size={12} />
								) : (
									<Codicon name="copy" size={12} />
								)}
								{copied ? "Copiado" : `Copiar /skill:${block.name}`}
							</button>
						</div>
					</div>
					<SkillOutput block={block} />
				</div>
			)}
		</div>
	);
}

/** Sección "Salida" del skill: las instrucciones del SKILL.md que se inyectaron
 *  al modelo. Va PLEGADA por defecto (el cuerpo suele ser largo y rara vez se
 *  relee; lo que importa al expandir es ver/copiar la invocación, en Entrada). */
function SkillOutput({ block }: { block: SkillBlock }) {
	const [out, setOut] = useState(false);
	return (
		<div className="tc-section">
			<button
				type="button"
				className="tc-section-toggle"
				onClick={() => setOut((v) => !v)}
				aria-expanded={out}
			>
				<span className="tc-section-label">
					Salida
					<span className="tc-section-sub"> · instrucciones inyectadas</span>
				</span>
				<span className={"skill-chev" + (out ? "" : " closed")}>
					<Icon name="chevron" size={12} />
				</span>
			</button>
			{out && (
				<div className="tc-section-body">
					<div className="skill-path" title={block.location}>
						{block.location}
					</div>
					<Markdown>{`**${block.name}**\n\n${block.content}`}</Markdown>
				</div>
			)}
		</div>
	);
}
