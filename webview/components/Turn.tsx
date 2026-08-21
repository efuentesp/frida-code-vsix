import type { Turn, Segment } from "../types";
import { useEffect, useState } from "react";
import { Bot, Copy, TriangleAlert, UserRound } from "lucide-react";
import { Codicon } from "./Codicon";
import { Markdown } from "./Markdown";
import { ToolCard, estimateTokens, fmtTok } from "./ToolCard";
import { fmtDuration } from "../tool-phrases";
import { BashCard } from "./BashCard";
import { parseSkillBlock } from "../skill-block";
import { SkillBlockCard } from "./SkillBlock";
import { groupSegments, summarizeToolGroup } from "../turn-grouping";

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
	 *  permite que el Brain/Thinking y los tool groups muestren estado en vivo. */
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

	const blocks = groupSegments(turn.segments);

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
						{blocks.map((block, idx) => {
							if (block.kind === "thinking") {
								const s = block.segment;
								if (hideThinking || !s.text) return null;
								const isLiveSegment =
									!!live &&
									block.index === turn.segments.length - 1 &&
									s.endedAt === undefined;
								return (
									<ThinkingSegment
										key={`think-${block.index}`}
										text={s.text}
										startedAt={s.startedAt}
										endedAt={s.endedAt}
										tokensLLM={s.tokensLLM}
										isLive={isLiveSegment}
									/>
								);
							}
							if (block.kind === "text") {
								const s = block.segment;
								return s.text ? (
									<div key={`text-${block.index}`} className="bubble">
										<Markdown>{s.text}</Markdown>
									</div>
								) : null;
							}
							if (block.kind === "tools") {
								if (block.tools.length === 1) {
									return (
										<ToolCard
											key={`tool-${block.startIndex}`}
											entry={block.tools[0]}
										/>
									);
								}
								return (
									<ToolGroup
										key={`group-${block.startIndex}`}
										tools={block.tools}
										live={live}
									/>
								);
							}
							return null;
						})}
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

/**
 * Grupo de herramientas contiguas en un turno (Fase 3 Copilot).
 * - En vivo (live): se muestra expandido para ver la actividad en tiempo real.
 * - Finalizado (!live): se colapsa en una sola línea resumen limpia y expandible.
 */
function ToolGroup({
	tools,
	live,
}: {
	tools: Array<Extract<Segment, { kind: "tool" }>>;
	live?: boolean;
}) {
	const [now, setNow] = useState(Date.now());
	const [userToggle, setUserToggle] = useState<boolean | null>(null);

	const isRunning = tools.some((t) => t.state === "running");

	useEffect(() => {
		if (!isRunning) return;
		const id = setInterval(() => setNow(Date.now()), 250);
		return () => clearInterval(id);
	}, [isRunning]);

	const summary = summarizeToolGroup(tools, now);
	const defaultOpen = !!live && isRunning;
	const open = userToggle ?? defaultOpen;

	return (
		<div className="tool-group">
			<button
				type="button"
				className={`tool-group-header ${open ? "is-expanded" : ""}`}
				onClick={() => setUserToggle(!open)}
				title={open ? "Contraer herramientas" : "Ver herramientas usadas"}
			>
				{summary.isRunning ? (
					<Codicon name="sync" spin={true} className="tc-icon-running" />
				) : summary.hasError ? (
					<Codicon name="error" className="tc-icon-error" />
				) : (
					<Codicon name="tools" className="tc-icon-tools" />
				)}

				<span className="tool-group-title">
					{summary.isRunning ? (
						<span className="tc-shimmer">{summary.label}</span>
					) : (
						<span>{summary.label}</span>
					)}
				</span>

				<span className="tool-group-meta">
					{summary.durationStr && <span>{summary.durationStr}</span>}
					{summary.tokensStr && <span>· {summary.tokensStr}</span>}
				</span>

				<Codicon
					name="chevron-right"
					size={14}
					className={`tool-flat-chevron ${open ? "is-expanded" : ""}`}
				/>
			</button>

			<div className={`collapsible-grid ${open ? "is-expanded" : ""}`}>
				<div className="collapsible-grid-inner">
					<div className="tool-group-body">
						{tools.map((t, i) => (
							<ToolCard key={i} entry={t} />
						))}
					</div>
				</div>
			</div>
		</div>
	);
}

/** Bloque de razonamiento plano estilo Copilot (Fase 3):
 *  - En vivo (isLive): «Razonando…» con brillo shimmer + timer en vivo.
 *  - Finalizado: «Razonó 3.2s · 420 tok» con chevron colapsable. */
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
	const [now, setNow] = useState(Date.now());
	const [userToggle, setUserToggle] = useState<boolean | null>(null);

	useEffect(() => {
		if (!isLive) return;
		const id = setInterval(() => setNow(Date.now()), 250);
		return () => clearInterval(id);
	}, [isLive]);

	const hasTimer = startedAt > 0;
	const elapsed = hasTimer ? (endedAt ?? now) - startedAt : 0;
	const durationStr = fmtDuration(elapsed);

	const estTokens = estimateTokens(text);
	const tokenCount = tokensLLM && tokensLLM > 0 ? tokensLLM : estTokens;
	const tokenStr = tokenCount > 0 ? ` · ${fmtTok(tokenCount)}` : "";

	const open = userToggle ?? false;

	return (
		<div className="card card--flat">
			<button
				type="button"
				className={`tool-flat thinking-flat-btn ${open ? "is-expanded" : ""}`}
				onClick={() => setUserToggle(!open)}
				title={open ? "Contraer razonamiento" : "Ver razonamiento"}
			>
				{isLive ? (
					<Codicon name="sparkle" spin={true} className="tc-icon-running" />
				) : (
					<Codicon name="sparkle" className="tc-icon-check" />
				)}

				<span className="tool-flat-title">
					{isLive ? (
						<>
							<span className="tc-shimmer tc-verb">Razonando…</span>
							{hasTimer && durationStr && (
								<span className="tc-arg">{durationStr}</span>
							)}
						</>
					) : (
						<>
							<span className="tc-verb">Razonó</span>
							<span className="tc-arg">
								{hasTimer && durationStr ? `${durationStr}${tokenStr}` : "completado"}
							</span>
						</>
					)}
				</span>

				<Codicon
					name="chevron-right"
					size={14}
					className={`tool-flat-chevron ${open ? "is-expanded" : ""}`}
				/>
			</button>

			<div className={`collapsible-grid ${open ? "is-expanded" : ""}`}>
				<div className="collapsible-grid-inner">
					<div className="thinking-body">
						<Markdown>{text}</Markdown>
					</div>
				</div>
			</div>
		</div>
	);
}
