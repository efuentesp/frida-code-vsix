import { useState } from "react";
import type { GoalState, WorkspaceInfo } from "../types";
import { Tooltip } from "./Tooltip";
import { Codicon } from "./Codicon";

// Pinta la carpeta de trabajo y el branch git (con sync ↑↓ y conteo de cambios
// +N ~N -N). Siempre visible en el footer, para saber exactamente dónde opera el
// agente y en qué estado está el repo respecto a origin.
function shortCwd(cwd: string): string {
	return cwd
		.replace(/^\/Users\/[^/]+/, "~")
		.replace(/^\/home\/[^/]+/, "~")
		.replace(/^[A-Z]:\\/, (m) => m);
}

/** Tooltip legible del chip de rama: "main · 2 por subir · 3 agregados". */
function branchTooltip(ws: WorkspaceInfo): string {
	const syncBits: string[] = [];
	if ((ws.ahead ?? 0) > 0) syncBits.push(`${ws.ahead} por subir`);
	if ((ws.behind ?? 0) > 0) syncBits.push(`${ws.behind} por bajar`);
	const diffBits: string[] = [];
	if (ws.diff) {
		if (ws.diff.added > 0)
			diffBits.push(
				`${ws.diff.added} agregado${ws.diff.added === 1 ? "" : "s"}`,
			);
		if (ws.diff.modified > 0)
			diffBits.push(
				`${ws.diff.modified} modificado${ws.diff.modified === 1 ? "" : "s"}`,
			);
		if (ws.diff.deleted > 0)
			diffBits.push(
				`${ws.diff.deleted} eliminado${ws.diff.deleted === 1 ? "" : "s"}`,
			);
	}
	const clean = !ws.dirty && syncBits.length === 0;
	if (clean) return `${ws.branch} · sin cambios`;
	return [ws.branch, ...syncBits, ...diffBits].join(" · ");
}

export function WorkspaceBar({
	ws,
	goal,
	onRename,
}: {
	ws?: WorkspaceInfo;
	goal?: GoalState;
	onRename?: (name: string) => void;
}) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState("");

	function startEdit() {
		setDraft(ws?.sessionName ?? "");
		setEditing(true);
	}
	function commit() {
		const name = draft.trim();
		setEditing(false);
		if (name && name !== ws?.sessionName && onRename && ws?.sessionPath) {
			onRename(name);
		}
	}
	return (
		<div className="ws-bar">
			<Tooltip label={ws?.cwd ?? "Carpeta de trabajo"} side="top">
				<span className="ws-cwd">
					<Codicon name="folder" size={13} />
					<code>{ws ? shortCwd(ws.cwd) : "…"}</code>
				</span>
			</Tooltip>
			{ws?.sessionPath &&
				(editing ? (
					<input
						className="ws-session-input"
						value={draft}
						placeholder="Nombre de la sesión…"
						autoFocus
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								commit();
							} else if (e.key === "Escape") {
								e.preventDefault();
								setEditing(false);
							}
						}}
						onBlur={commit}
					/>
				) : (
					<span
						className={"ws-session" + (onRename ? " editable" : "")}
						title={
							onRename ? "Click para renombrar la sesión" : ws?.sessionName
						}
						onClick={onRename ? startEdit : undefined}
					>
						• {ws?.sessionName ?? "(sin nombre)"}
					</span>
				))}
			{ws?.branch && (
				<Tooltip label={branchTooltip(ws)} side="top">
					<span className={"ws-branch" + (ws.dirty ? " dirty" : "")}>
						<Codicon name="git-branch" size={13} />
						{ws.branch}
						{/* Conteo de cambios +N ~N -N */}
						{ws.diff &&
							(ws.diff.added > 0 ||
								ws.diff.modified > 0 ||
								ws.diff.deleted > 0) && (
								<span className="ws-diff">
									{ws.diff.added > 0 && (
										<span className="ws-add">+{ws.diff.added}</span>
									)}
									{ws.diff.modified > 0 && (
										<span className="ws-mod">~{ws.diff.modified}</span>
									)}
									{ws.diff.deleted > 0 && (
										<span className="ws-del">-{ws.diff.deleted}</span>
									)}
								</span>
							)}
						{/* Sync vs origin ↑N ↓N */}
						{((ws.ahead ?? 0) > 0 || (ws.behind ?? 0) > 0) && (
							<span className="ws-sync">
								{(ws.ahead ?? 0) > 0 && (
									<span className="ws-ahead">↑{ws.ahead}</span>
								)}
								{(ws.behind ?? 0) > 0 && (
									<span className="ws-behind">↓{ws.behind}</span>
								)}
							</span>
						)}
						{ws.dirty && (
							<span className="ws-dirty">
								<Codicon name="circle-filled" size={10} />
							</span>
						)}
					</span>
				</Tooltip>
			)}
			{/* Worktree vinculado: chip «wt: nombre» — única fuente del indicador */}
			{ws?.worktreeName && (
				<Tooltip
					label={`Worktree · ${ws.cwd} · checkout vinculado del repo principal`}
					side="top"
				>
					<span className="ws-worktree">
						<Codicon name="repo-forked" size={13} /> wt: {ws.worktreeName}
					</span>
				</Tooltip>
			)}
			{goal && goalChip(goal)}
		</div>
	);
}

/** Chip del goal: texto corto + tooltip completo. */
function goalChip(goal: GoalState) {
	const tooltipLines: string[] = [goal.text];
	tooltipLines.push(
		`estado: ${goal.status} · continuaciones: ${goal.iteration} · auto ${goal.automaticTurns}/25`,
	);
	if (goal.tokenBudget !== undefined)
		tooltipLines.push(`tokens: ${goal.tokensUsed}/${goal.tokenBudget}`);
	if (goal.pausedReason) tooltipLines.push(`pausado: ${goal.pausedReason}`);
	if (goal.blockedReason) tooltipLines.push(`bloqueado: ${goal.blockedReason}`);
	if (goal.completionSummary)
		tooltipLines.push(`resumen: ${goal.completionSummary}`);
	if (goal.status === "paused" || goal.status === "blocked")
		tooltipLines.push("/goal resume para retomarlo");
	const cls =
		goal.status === "active"
			? "ws-goal ws-goal-active"
			: goal.status === "complete"
				? "ws-goal ws-goal-complete"
				: "ws-goal ws-goal-stopped";
	return (
		<Tooltip label={tooltipLines.join("\n")} side="top">
			<span className={cls}>
				<Codicon name="target" size={13} /> {goalLabel(goal)}
			</span>
		</Tooltip>
	);
}

function goalLabel(goal: GoalState): string {
	const max = 32;
	const txt = goal.text.replace(/\s+/g, " ").trim();
	const trunc = txt.length > max ? `${txt.slice(0, max - 1)}…` : txt;
	if (goal.status === "active") return trunc;
	if (goal.status === "complete") return `✓ ${trunc}`;
	if (goal.status === "paused") return `⏸ ${trunc}`;
	if (goal.status === "blocked") return `⚠ ${trunc}`;
	if (goal.status === "exhausted") return `⌛ ${trunc}`;
	if (goal.status === "failed") return `✗ ${trunc}`;
	if (goal.status === "aborted") return `⊘ ${trunc}`;
	return trunc;
}
