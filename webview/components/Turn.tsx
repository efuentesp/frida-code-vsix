import type { Turn } from "../types";
import { useEffect, useState } from "react";
import { Bot, Brain, Copy, TriangleAlert, UserRound } from "lucide-react";
import { Markdown } from "./Markdown";
import { ToolCard, fmtDuration, estimateTokens, fmtTok } from "./ToolCard";
import { BashCard } from "./BashCard";
import { CollapsibleCard } from "./CollapsibleCard";
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
							onCopy={onCopy}
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
										tokensLLM={s.tokensLLM}
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
	tokensLLM,
}: {
	text: string;
	startedAt: number;
	endedAt?: number;
	isLive: boolean;
	tokensLLM?: number;
}) {
	// Cronómetro en vivo mientras el modelo razona (re-render cada 250ms). Al
	// terminar (isLive=false) se congela con endedAt.
	const [now, setNow] = useState(Date.now());
	useEffect(() => {
		if (!isLive) return;
		const id = setInterval(() => setNow(Date.now()), 250);
		return () => clearInterval(id);
	}, [isLive]);
	const hasTimer = startedAt > 0;
	const elapsed = hasTimer ? (endedAt ?? now) - startedAt : 0;
	const ctxStr =
		estimateTokens(text) > 0 ? ` · ${fmtTok(estimateTokens(text))} ctx` : "";
	const llmStr =
		tokensLLM && tokensLLM > 0 ? ` · ~${fmtTok(tokensLLM)} llm` : "";
	return (
		<CollapsibleCard
			running={isLive}
			hasPartial={!!text}
			hasContent={!!text}
			variant="thinking"
			icon={<Brain size={13} />}
			iconLive={isLive}
			leading={<span className="card-title">Razonamiento</span>}
			status={
				hasTimer ? (
					<span className={"card-status " + (isLive ? "running" : "done")}>
						{isLive ? (
							<>
								<Spinner size={13} /> {fmtDuration(elapsed)}
								{ctxStr}
								{llmStr}
							</>
						) : (
							<>
								<Icon name="check" size={13} /> {fmtDuration(elapsed)}
								{ctxStr}
								{llmStr}
							</>
						)}
					</span>
				) : null
			}
			chevronTooltip={(open) =>
				open ? "Contraer razonamiento" : "Ver razonamiento"
			}
		>
			<Markdown>{text}</Markdown>
		</CollapsibleCard>
	);
}
