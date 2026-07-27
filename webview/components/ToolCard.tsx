import type { ToolEntry } from "../types";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";
import { Tooltip } from "./Tooltip";
import { Spinner } from "./Spinner";
import { useEffect, useState, type ReactNode } from "react";
import {
	FilePen,
	FileText,
	Folder,
	PencilLine,
	Search,
	Terminal,
	Wrench,
} from "lucide-react";

// Formatea una duración en ms a algo legible (318 ms · 4.2s).
function fmtDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return "";
	if (ms < 1000) return `${Math.round(ms)} ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

// Resumen legible de la llamada (icono + texto) según el tool, en vez de JSON.
function toolCallInfo(
	tool: string,
	args: unknown,
): { icon: ReactNode; label: string } {
	const a = (args ?? {}) as Record<string, unknown>;
	const s = (v: unknown) => String(v ?? "");
	switch (tool) {
		case "read":
			return { icon: <FileText size={13} />, label: s(a.path) };
		case "bash":
			return { icon: <Terminal size={13} />, label: s(a.command) };
		case "edit": {
			const n = Array.isArray(a.edits) ? a.edits.length : 0;
			return {
				icon: <PencilLine size={13} />,
				label: `${s(a.path)}${n ? ` · ${n} edición(es)` : ""}`,
			};
		}
		case "write":
			return { icon: <FilePen size={13} />, label: s(a.path) };
		case "grep":
			return {
				icon: <Search size={13} />,
				label: `"${s(a.pattern)}"${a.path ? ` en ${s(a.path)}` : ""}`,
			};
		case "find":
			return {
				icon: <Search size={13} />,
				label: `${s(a.pattern)}${a.path ? ` en ${s(a.path)}` : ""}`,
			};
		case "ls":
			return { icon: <Folder size={13} />, label: s(a.path) };
		default:
			return { icon: <Wrench size={13} />, label: tool };
	}
}

// Render del resultado según el tipo de tool (estilo TUI: diff, código, terminal).
function renderResult(entry: ToolEntry) {
	if (entry.diff) {
		const lines = entry.diff.split("\n");
		return (
			<pre className="diff-out">
				{lines.map((ln, i) => {
					const cls = ln.startsWith("+")
						? "add"
						: ln.startsWith("-")
							? "del"
							: "ctx";
					return (
						<span key={i} className={"diff-line " + cls}>
							{ln || " "}
						</span>
					);
				})}
			</pre>
		);
	}
	if (!entry.result?.trim()) return null;
	// read/write → bloque de código con resaltado según extensión.
	if (entry.tool === "read" || entry.tool === "write") {
		const path = String((entry.args as any)?.path ?? "");
		const ext = (path.split(".").pop() || "").toLowerCase();
		const fence = "```";
		return (
			<div className="tool-result md">
				<Markdown>{`${fence}${ext}\n${entry.result}\n${fence}`}</Markdown>
			</div>
		);
	}
	// bash / grep / default → terminal plano.
	return <pre className="tool-result">{entry.result}</pre>;
}

export function ToolCard({ entry }: { entry: ToolEntry }) {
	const [open, setOpen] = useState(false);
	const [now, setNow] = useState(Date.now());
	const running = entry.state === "running";
	const { icon, label } = toolCallInfo(entry.tool, entry.args);
	const hasResult =
		!running && (!!(entry.result && entry.result.trim()) || !!entry.diff);
	// Progreso parcial en vivo (tool_execution_update) de un tool largo.
	const livePartial = running && !!entry.partial && !!entry.partial.trim();

	// Cronómetro en vivo solo mientras ejecuta (re-render ligero cada 250 ms).
	useEffect(() => {
		if (!running) return;
		const id = setInterval(() => setNow(Date.now()), 250);
		return () => clearInterval(id);
	}, [running]);

	const elapsed = (entry.endedAt ?? now) - entry.startedAt;

	return (
		<div
			className={
				"tool" + (open && hasResult ? "" : livePartial ? "" : " collapsed")
			}
		>
			<div
				className={"tool-head" + (hasResult ? " has-result" : "")}
				onClick={() => hasResult && setOpen(!open)}
			>
				<span className="tc-icon">{icon}</span>
				<code className="tc-label">{label}</code>
				<span className={"tc-status " + entry.state}>
					{running ? (
						<>
							<Spinner size={13} /> {fmtDuration(elapsed)}
						</>
					) : entry.state === "ok" ? (
						<>
							<Icon name="check" /> {fmtDuration(elapsed)}
						</>
					) : (
						<>
							<Icon name="x" /> {fmtDuration(elapsed)}
						</>
					)}
				</span>
				{hasResult && (
					<Tooltip
						label={open ? "Contraer resultado" : "Ver resultado"}
						side="top"
					>
						<span className={"tc-chev" + (open ? "" : " closed")}>
							<Icon name="chevron" size={12} />
						</span>
					</Tooltip>
				)}
			</div>
			{open && hasResult && (
				<div className="tool-result-wrap">{renderResult(entry)}</div>
			)}
			{livePartial && (
				<div className="tool-result-wrap">
					<pre className="tool-result partial">{entry.partial}</pre>
				</div>
			)}
		</div>
	);
}
