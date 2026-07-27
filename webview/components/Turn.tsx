import type { Turn } from "../types";
import { Bot, Copy, TriangleAlert, UserRound } from "lucide-react";
import { Markdown } from "./Markdown";
import { ToolCard } from "./ToolCard";
import { BashCard } from "./BashCard";
import { parseSkillBlock } from "../skill-block";
import { SkillBlockCard } from "./SkillBlock";

export function TurnView({
	turn,
	onCopy,
	hideThinking,
}: {
	turn: Turn;
	onCopy?: (text: string) => void;
	hideThinking?: boolean;
}) {
	const hasAssistant = turn.segments.length > 0 || !!turn.error || !!turn.bash;
	const assistantText = turn.segments
		.map((s) => (s.kind === "text" ? s.text : null))
		.filter((x): x is string => !!x)
		.join("\n\n")
		.trim();
	// /skill:nombre → pi expande el mensaje a un <skill> block; lo colapsamos.
	const skill = parseSkillBlock(turn.user);
	return (
		<div className="turn">
			<div className="row">
				<span className="avatar user">
					<UserRound size={15} />
				</span>
				<div className="body">
					<div className="who">Tú</div>
					{skill ? (
						<>
							<SkillBlockCard block={skill} />
							{skill.userMessage && (
								<div className="bubble">{skill.userMessage}</div>
							)}
						</>
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
									<details key={i} className="thinking">
										<summary>Razonamiento</summary>
										<div className="thinking-body">
											<Markdown>{s.text}</Markdown>
										</div>
									</details>
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
