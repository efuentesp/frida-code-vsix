// webview/components/Statusline.tsx — Barra de Estado Unificada estilo nativo VS Code (Propuesta 1)
// Consolida WorkspaceBar (carpeta, branch git, sync, worktree, goal) y ContextBar (tokens, caché, costo)
// en una única barra de 24px de alto al pie del Webview.

import { useState } from "react";
import type { GoalState, Usage, WorkspaceInfo } from "../types";
import { Tooltip } from "./Tooltip";
import { Codicon } from "./Codicon";

function shortCwd(cwd: string): string {
	const normalized = cwd
		.replace(/^\/Users\/[^/]+/, "~")
		.replace(/^\/home\/[^/]+/, "~")
		.replace(/^[A-Z]:\\/, (m) => m);
	const parts = normalized.split(/[/\\]/);
	return parts[parts.length - 1] || normalized;
}

function fmt(n: number): string {
	if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
	if (n >= 1000) return (n / 1000).toFixed(n >= 10_000 ? 0 : 1) + "k";
	return String(n);
}

function branchTooltip(ws: WorkspaceInfo): string {
	const syncBits: string[] = [];
	if ((ws.ahead ?? 0) > 0) syncBits.push(`${ws.ahead} por subir`);
	if ((ws.behind ?? 0) > 0) syncBits.push(`${ws.behind} por bajar`);
	const diffBits: string[] = [];
	if (ws.diff) {
		if (ws.diff.added > 0)
			diffBits.push(`${ws.diff.added} agregado${ws.diff.added === 1 ? "" : "s"}`);
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

function ctxTooltip(usage: Usage, pct: number, unknown: boolean): string {
	const lines: string[] = [];
	lines.push(
		`Contexto: ${usage.contextWindow > 0 ? `${fmt(usage.contextTokens)} / ${fmt(usage.contextWindow)}` : "…"} (${unknown ? "?" : `${pct}%`})`,
	);
	if (usage.inputTotal > 0 || usage.outputTotal > 0) {
		lines.push(
			`Tokens: ↑${fmt(usage.inputTotal)} in · ↓${fmt(usage.outputTotal)} out`,
		);
	}
	if (usage.cacheRead > 0 || usage.cacheWrite > 0) {
		lines.push(
			`Caché: R${fmt(usage.cacheRead)} · W${fmt(usage.cacheWrite)}${
				usage.cacheHitRate === undefined
					? ""
					: ` (Hit Rate: ${usage.cacheHitRate.toFixed(0)}%)`
			}`,
		);
	}
	if (usage.cost > 0) {
		lines.push(`Costo acumulado: $${usage.cost.toFixed(3)}`);
	}
	return lines.join("\n");
}

function goalLabel(goal: GoalState): string {
	const max = 24;
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

export interface StatuslineProps {
	ws?: WorkspaceInfo;
	goal?: GoalState;
	usage?: Usage;
	onRename?: (name: string) => void;
}

export function Statusline({ ws, goal, usage, onRename }: StatuslineProps) {
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

	// Métricas de contexto
	const rawPct = usage?.pressurePercent ?? usage?.contextPercent;
	const pct = Math.round(rawPct ?? 0);
	const unknown = rawPct == null || Number.isNaN(rawPct);
	const level = pct >= 90 ? "high" : pct >= 70 ? "mid" : "low";

	let diffSummary = "";
	if (ws?.diff) {
		const parts: string[] = [];
		if (ws.diff.added > 0) parts.push(`+${ws.diff.added}`);
		if (ws.diff.modified > 0) parts.push(`~${ws.diff.modified}`);
		if (ws.diff.deleted > 0) parts.push(`-${ws.diff.deleted}`);
		diffSummary = parts.join(" ");
	}

	return (
		<footer className="statusline">
			<div className="statusline-left">
				{ws && (
					<Tooltip label={ws.cwd} side="top">
						<span className="statusline-item">
							<Codicon name="folder" size={12} />
							<span className="statusline-txt">{shortCwd(ws.cwd)}</span>
						</span>
					</Tooltip>
				)}

				{ws?.branch && (
					<Tooltip label={branchTooltip(ws)} side="top">
						<span className={"statusline-item" + (ws.dirty ? " is-dirty" : "")}>
							<Codicon name="git-branch" size={12} />
							<span className="statusline-txt">{ws.branch}</span>
							{diffSummary ? (
								<span className="statusline-diff-badge">{diffSummary}</span>
							) : null}
						</span>
					</Tooltip>
				)}

				{ws?.worktreeName && (
					<Tooltip label={`Worktree: ${ws.worktreeName} (${ws.cwd})`} side="top">
						<span className="statusline-item statusline-wt">
							<Codicon name="repo-forked" size={12} />
							<span>wt:{ws.worktreeName}</span>
						</span>
					</Tooltip>
				)}

				{goal && (
					<Tooltip label={`Meta: ${goal.text} (${goal.status})`} side="top">
						<span
							className={
								"statusline-item statusline-goal " +
								(goal.status === "active" ? "active" : "")
							}
						>
							<Codicon name="target" size={12} />
							<span>{goalLabel(goal)}</span>
						</span>
					</Tooltip>
				)}
			</div>

			<div className="statusline-center">
				{ws?.sessionPath &&
					(editing ? (
						<input
							className="statusline-rename-input"
							value={draft}
							autoFocus
							placeholder="Nombre de la sesión…"
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
							className={"statusline-session" + (onRename ? " is-editable" : "")}
							onClick={onRename ? startEdit : undefined}
							title={onRename ? "Click para renombrar la sesión" : ws.sessionName}
						>
							• {ws.sessionName ?? "(sin nombre)"}
						</span>
					))}
			</div>

			<div className="statusline-right">
				{usage && (
					<Tooltip label={ctxTooltip(usage, pct, unknown)} side="top">
						<div className="statusline-ctx">
							<span className="statusline-ctx-bar">
								<span
									className={"statusline-ctx-fill " + level}
									style={{
										width: `${Math.min(100, Math.max(0, pct))}%`,
									}}
								/>
							</span>
							<span className="statusline-ctx-pct">{unknown ? "?" : `${pct}%`}</span>
							{usage.cost > 0 && (
								<span className="statusline-cost">${usage.cost.toFixed(3)}</span>
							)}
						</div>
					</Tooltip>
				)}
			</div>
		</footer>
	);
}
