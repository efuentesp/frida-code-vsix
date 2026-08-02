import type { Turn } from "../types";
import { useEffect, useState } from "react";
import { Bot, Brain, Copy, TriangleAlert, UserRound } from "lucide-react";
import { Markdown } from "./Markdown";
import { ToolCard, fmtDuration } from "./ToolCard";
import { BashCard } from "./BashCard";
import { Icon } from "./Icon";
import { Spinner } from "./Spinner";
import { parseSkillBlock } from "../skill-block";
import { SkillBlockCard } from "./SkillBlock";

export function TurnView({
	turn,
	onCopy,
	hideThinking,
	live,
}: {
	turn: Turn;
	onCopy?: (text: string) => void;
	hideThinking?: boolean;
	/** true si este turno es el activo (el último, con el agente ocupado):
	 *  permite que el Brain del segmento thinking en curso "lata". */
	live?: boolean;
}) {
	const hasAssistant = turn.segments.length > 0 || !!turn.error || !!turn.bash;
	const assistantText = turn.segments
		.map((s) => (s.kind === "text" ? s.text : null))
		.filter((x): x is string => !!x)
		.join("\n\n")
		.trim();
	// /skill:nombre → pi expande el mensaje a un <skill> block; lo colapsamos.
	const skill = parseSkillBlock(turn.user);
	// Mensaje del sistema (ej. /todos): bloque multiline sin avatares.
	if (turn.notice) {
		return (
			<div className="turn">
				<div className="notice-block">{turn.notice}</div>
			</div>
		);
	}
	return (
		<div className="turn">
			<div className="row">
				<span className="avatar user">
					<UserRound size={15} />
				</span>
				<div className="body">
					<div className="who">Tú</div>
					{skill ? (
						<SkillBlockCard
							block={skill}
							live={live}
							input={skill.userMessage?.replace(/^Skill input:\s*/, "")}
						/>
					) : (
						<div className="bubble">{turn.user}</div>
					)}
					{turn.images && turn.images.length > 0 && (
						<div className="bubble imgs-inline">
							{turn.images.map((im, i) => (
								<img
									key={i}
									className="img-thumb"
									src={`data:${im.mimeType};base64,${im.data}`}
									alt=""
								/>
							))}
						</div>
					)}
				</div>
			</div>

			{hasAssistant && (
				<div className="row">
					<span className="avatar ai">
						<Bot size={15} />
					</span>
					<div className="body">
						<div className="who">
							Frida
							{onCopy && assistantText && (
								<button
									className="turn-copy"
									title="Copiar respuesta"
									onClick={() => onCopy(assistantText)}
								>
									<Copy size={12} />
								</button>
							)}
						</div>
						{turn.segments.map((s, i) =>
							s.kind === "thinking" ? (
								!hideThinking && s.text ? (
									<ThinkingSegment
										key={i}
										text={s.text}
										startedAt={s.startedAt}
										endedAt={s.endedAt}
										isLive={
											!!live &&
											i === turn.segments.length - 1 &&
											s.endedAt === undefined
										}
									/>
								) : null
							) : s.kind === "text" ? (
								s.text ? (
									<div key={i} className="bubble">
										<Markdown>{s.text}</Markdown>
									</div>
								) : null
							) : (
								<ToolCard key={i} entry={s} />
							),
						)}
						{turn.bash && <BashCard run={turn.bash} />}
						{turn.error && (
							<div className="err">
								<TriangleAlert size={12} /> {turn.error}
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

/** Bloque de razonamiento colapsable con cronómetro (réplica del read):
 *  - En vivo (isLive): 🧠 pulsa + timer sube cada 250 ms.
 *  - Al terminar (endedAt set): 🧠 quieto + tiempo congelado.
 *  startedAt===0 → historial reconstruido sin timestamp: no se muestra tiempo. */
function ThinkingSegment({
	text,
	startedAt,
	endedAt,
	isLive,
}: {
	text: string;
	startedAt: number;
	endedAt?: number;
	isLive: boolean;
}) {
	const [now, setNow] = useState(Date.now());
	useEffect(() => {
		if (!isLive) return;
		const id = setInterval(() => setNow(Date.now()), 250);
		return () => clearInterval(id);
	}, [isLive]);
	const hasTimer = startedAt > 0;
	const elapsed = hasTimer ? (endedAt ?? now) - startedAt : 0;
	return (
		<details className="thinking">
			<summary className="thinking-head">
				<Brain
					size={13}
					className={"thinking-icon" + (isLive ? " thinking-live" : "")}
				/>
				<span className="thinking-name">Razonamiento</span>
				{hasTimer && (
					<span
						className={
							"thinking-time " + (isLive ? "thinking-running" : "thinking-done")
						}
					>
						{isLive ? (
							<>
								<Spinner size={13} /> {fmtDuration(elapsed)}
							</>
						) : (
							<>
								<Icon name="check" size={13} /> {fmtDuration(elapsed)}
							</>
						)}
					</span>
				)}
				<span className="thinking-chev">
					<Icon name="chevron" size={12} />
				</span>
			</summary>
			<div className="thinking-body">
				<Markdown>{text}</Markdown>
			</div>
		</details>
	);
}
