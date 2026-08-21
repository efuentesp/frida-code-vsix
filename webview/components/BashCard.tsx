import type { BashRun } from "../types";
import { Icon } from "./Icon";
import { Spinner } from "./Spinner";
import { Codicon } from "./Codicon";
import { CollapsibleCard } from "./CollapsibleCard";

// Tarjeta para un atajo de bash del usuario (!command / !!command).
// Hermana visual de ToolCard: usa el mismo CollapsibleCard (variante bash) y
// permanece abierta por defecto para ver la salida según se genera.
export function BashCard({ run }: { run: BashRun }) {
	const running = run.status === "running";
	const dim = run.excludeFromContext; // "!!" → el output no fue al modelo

	const leading = <code className="card-label">$ {run.command}</code>;

	const status = (
		<span className="card-status">
			{running ? (
				<>
					<Spinner size={13} /> ejecutando
				</>
			) : run.status === "ok" ? (
				<>
					<Icon name="check" /> exit&nbsp;{run.exitCode ?? 0}
				</>
			) : run.status === "cancelled" ? (
				<>cancelado</>
			) : (
				<>
					<Icon name="x" /> exit&nbsp;{run.exitCode ?? "?"}
				</>
			)}
		</span>
	);

	return (
		<CollapsibleCard
			variant="bash"
			defaultOpen
			hasContent
			running={running}
			className={dim ? "dim" : undefined}
			icon={<Icon name="term" />}
			leading={leading}
			status={status}
			chevronTooltip={(open) => (open ? "Contraer salida" : "Ver salida")}
		>
			{run.output ? (
				<pre>{run.output}</pre>
			) : running ? null : (
				<div className="bash-empty">(sin salida)</div>
			)}
			{run.truncated && run.fullOutputPath && (
				<div className="bash-trunc">
					<Codicon name="warning" size={12} /> Salida truncada. Output completo:{" "}
					{run.fullOutputPath}
				</div>
			)}
			{dim && <div className="bash-dim-note">No enviado al modelo (!!)</div>}
		</CollapsibleCard>
	);
}
