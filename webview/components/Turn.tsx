import type { Turn } from "../types";
import { useEffect, useState } from "react";
import { Bot, Brain, Copy, TriangleAlert, UserRound } from "lucide-react";
import { Markdown } from "./Markdown";
import { ToolCard, fmtDuration, estimateTokens, fmtTok } from "./ToolCard";
import { ToolGroup } from "./ToolGroup";
import { toolRuns } from "../group-stats";
import { BashCard } from "./BashCard";
import { CollapsibleCard } from "./CollapsibleCard";
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
						{(() => {
							// F5 P2 (AUTORIZADO): el tool `todo` NO se renderiza en el
							// transcript — el widget del input-stack es su única superficie.
							// Se filtra ANTES de toolRuns para que los conteos de los grupos
							// no cuenten filas invisibles.
							const segs = turn.segments.filter(
								(s) => !(s.kind === "tool" && s.tool === "todo"),
							);
							// Agrupación por corridas contiguas (Fase 3 P1): turnos COMPLETADOS
							// envuelven sus corridas de tools en <ToolGroup> (colapsado por
							// defecto, autorizado 2026-08-19); turno en vivo → toolRuns() = [] →
							// filas sueltas (regla §5.0.2). La cronología texto⇄tools se preserva:
							// sólo las corridas contiguas se agrupan.
							const runs = toolRuns({ status: turn.status, segments: segs });
							let runIdx = 0; // índice de la corrida actual (para memKey y corte)
							return segs.map((s, i) => {
								// ¿inicia una corrida agrupada? → pintar el grupo con TODO su rango
								const run = runs.find((r) => r.startIndex === i);
								if (run && run.count > 1) {
									const memKey = { turnId: turn.id, run: runIdx++ };
									const inner = segs
										.slice(run.startIndex, run.endIndex + 1)
										.map((ts, j) =>
											ts.kind === "tool" ? (
												<ToolCard key={run.startIndex + j} entry={ts} />
												) : null,
										);
									return (
										<ToolGroup key={i} summary={run.summary} memKey={memKey}>
											{inner}
										</ToolGroup>
									);
								}
								// segment DENTRO de una corrida multi-tool ya pintada → saltar
								if (
									runs.some(
										(r) => r.count > 1 && i > r.startIndex && i <= r.endIndex,
									)
								)
									return null;

								// segmentos normales (turno vivo, corridas de 1, texto, thinking…)
								if (s.kind === "thinking")
									return !hideThinking && s.text ? (
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
											) : null;
								if (s.kind === "reasoning_hint")
									return (
											// ADR-1003-F3: razonó tokens sin resumen del backend
											<div key={i} className="reasoning-hint">
												<Brain size={11} /> razonó {s.tokens.toLocaleString()} tokens · el
												proveedor no envió el resumen del pensamiento
											</div>
										);
								if (s.kind === "text")
									return s.text ? (
											<div key={i} className="bubble">
												<Markdown>{s.text}</Markdown>
											</div>
										) : null;
								return <ToolCard key={i} entry={s} />;
							});
						})()}
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
			variant="flat"
			className="thinking-row"
			icon={<Brain size={13} />}
			leading={
				<>
					{isLive ? (
						// en vivo: shimmer del verbo (§5.2); el Brain azul queda fijo a la izq
						<span className="card-title">
							<span className="tc-shimmer-verb">Razonando…</span>
						</span>
					) : (
						// completado: pasado + detalle tabular en el subtítulo (patrón fila tool)
						<span className="card-title">Razonó {fmtDuration(elapsed)}</span>
					)}
					{!isLive && (ctxStr || llmStr) ? (
						<span className="card-sub">
							{[ctxStr, llmStr].filter(Boolean).join("").replace(/^ · /, "")}
						</span>
					) : null}
				</>
			}
			status={
				hasTimer && isLive ? (
					<span className="card-status running">
						<Spinner size={13} /> {fmtDuration(elapsed)}
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
