import { useState } from "react";
import type { ApprovalMode, OutMessage, PermState, State } from "../types";
import { Codicon } from "./Codicon";

// Panel de Auto-Aprobación (Propuesta 1: VS Code Security Matrix & Policy Cards):
// Editor visual de la política declarativa de permisos con selector visual de modo,
// tri-states con Codicons nativos de VS Code, y tarjetas de reglas de protección.

/** Tri-states con Codicons nativos. */
const PERM_META: Record<
	PermState,
	{ icon: string; label: string; cls: string }
> = {
	allow: { icon: "pass", label: "Permitir", cls: "allow" },
	ask: { icon: "question", label: "Preguntar", cls: "ask" },
	deny: { icon: "error", label: "Negar", cls: "deny" },
};

/** Tools conocidos con su icono contextual. */
const KNOWN_TOOLS: { id: string; label?: string; icon: string }[] = [
	{ id: "read", icon: "file-text" },
	{ id: "edit", icon: "edit" },
	{ id: "write", icon: "edit" },
	{ id: "bash", icon: "terminal" },
	{ id: "grep", icon: "search" },
	{ id: "find", icon: "search" },
	{ id: "ls", icon: "folder" },
	{ id: "todo", icon: "checklist" },
	{ id: "ask_user_question", icon: "question" },
	{ id: "*", label: "* desconocidos (MCP / extensiones)", icon: "extensions" },
];

const MODES: {
	id: ApprovalMode;
	title: string;
	desc: string;
	icon: string;
	badge?: string;
}[] = [
	{
		id: "manual",
		title: "Manual",
		desc: "Estricto: pregunta antes de cada acción relevante.",
		icon: "shield",
	},
	{
		id: "auto-edit",
		title: "Auto-edit",
		desc: "Balanceado: edita archivos sin preguntar; bash pide confirmación.",
		icon: "edit",
		badge: "Recomendado",
	},
	{
		id: "auto",
		title: "Auto",
		desc: "Autónomo: todo corre sin diálogo salvo reglas de bloqueo.",
		icon: "zap",
	},
];

const KIND_LABEL: Record<string, string> = {
	tool: "Tool",
	diff: "Archivos",
	bash: "Bash",
};

export function ApprovalPanel({
	state,
	post,
}: {
	state: State;
	post: (m: OutMessage) => void;
}) {
	const cfg = state.permissions;
	const [newPath, setNewPath] = useState("");
	const [newPathState, setNewPathState] = useState<PermState>("deny");
	const [newBash, setNewBash] = useState("");
	const [newBashState, setNewBashState] = useState<PermState>("ask");

	if (!cfg) {
		return <div className="cfg-stub">Cargando política de permisos…</div>;
	}

	const extraTools = Object.keys(cfg.tool).filter(
		(t) => !KNOWN_TOOLS.some((k) => k.id === t),
	);
	const tools: { id: string; label?: string; icon: string }[] = [
		...KNOWN_TOOLS,
		...extraTools.map((t) => ({ id: t, label: t, icon: "tools" })),
	];

	const addPath = (): void => {
		const p = newPath.trim();
		if (!p) return;
		post({ type: "perm_set_path", pattern: p, state: newPathState });
		setNewPath("");
	};
	const addBash = (): void => {
		const p = newBash.trim();
		if (!p) return;
		post({ type: "perm_set_bash", pattern: p, state: newBashState });
		setNewBash("");
	};

	return (
		<div className="perm-body">
			{/* ── 1. Selector de modo global ── */}
			<div className="perm-card">
				<div className="perm-card-head">
					<Codicon name="shield" size={14} className="perm-head-icon" />
					<span className="perm-card-title">Modo de automatización global</span>
				</div>
				<div className="perm-mode-cards">
					{MODES.map((m) => {
						const isSelected = cfg.mode === m.id;
						return (
							<button
								key={m.id}
								type="button"
								className={`perm-mode-card${isSelected ? " active" : ""}`}
								onClick={() => post({ type: "set_mode", mode: m.id })}
							>
								<div className="perm-mode-card-head">
									<Codicon name={m.icon} size={14} />
									<span className="perm-mode-title">{m.title}</span>
									{m.badge && <span className="perm-mode-badge">{m.badge}</span>}
								</div>
								<div className="perm-mode-desc">{m.desc}</div>
							</button>
						);
					})}
				</div>
				<div className="perm-note">
					Nota: la regla <code>Negar</code> siempre prevalece, incluso en modo Auto.
					El modo también se sincroniza en el footer del chat.
				</div>
			</div>

			{/* ── 2. Herramientas del sistema (Tools) ── */}
			<div className="perm-card">
				<div className="perm-card-head">
					<Codicon name="tools" size={14} className="perm-head-icon" />
					<span className="perm-card-title">Herramientas del sistema</span>
				</div>
				<div className="perm-tools-grid">
					{tools.map((t) => (
						<div key={t.id} className="perm-row">
							<div className="perm-tool-label">
								<Codicon name={t.icon} size={13} className="perm-tool-icon" />
								<span className="perm-row-name" title={t.id}>
									{t.label || t.id}
								</span>
							</div>
							<TriState
								value={cfg.tool[t.id] ?? "ask"}
								onChange={(s) => post({ type: "perm_set_tool", tool: t.id, state: s })}
							/>
						</div>
					))}
				</div>
			</div>

			{/* ── 3. Archivos y rutas protegidas (Paths) ── */}
			<div className="perm-card">
				<div className="perm-card-head">
					<Codicon name="folder" size={14} className="perm-head-icon" />
					<span className="perm-card-title">Archivos y rutas protegidas</span>
				</div>
				<div className="perm-note">
					Aplica transversalmente a cualquier tool que acceda al archivo. Prevalece
					la regla más restrictiva (ej. <code>*.env</code>, <code>~/.ssh/*</code>).
				</div>
				<PatternChips
					map={cfg.path}
					onRemove={(p) => post({ type: "perm_remove_path", pattern: p })}
				/>
				<div className="perm-add">
					<input
						className="perm-input"
						placeholder="Patrón (ej. *.env, .git/*)"
						value={newPath}
						onChange={(e) => setNewPath(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && addPath()}
					/>
					<StateSelect value={newPathState} onChange={setNewPathState} />
					<button type="button" className="perm-add-btn" onClick={addPath}>
						<Codicon name="add" size={12} /> Añadir
					</button>
				</div>
			</div>

			{/* ── 4. Comandos bash ── */}
			<div className="perm-card">
				<div className="perm-card-head">
					<Codicon name="terminal" size={14} className="perm-head-icon" />
					<span className="perm-card-title">Comandos bash</span>
				</div>
				<div className="perm-note">
					Wildcards sobre el comando completo (ej. <code>git push *</code>,{" "}
					<code>rm -rf *</code>).
				</div>
				<PatternChips
					map={cfg.bash}
					onRemove={(p) => post({ type: "perm_remove_bash", pattern: p })}
				/>
				<div className="perm-add">
					<input
						className="perm-input"
						placeholder="Patrón (ej. git push *, npm *)"
						value={newBash}
						onChange={(e) => setNewBash(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && addBash()}
					/>
					<StateSelect value={newBashState} onChange={setNewBashState} />
					<button type="button" className="perm-add-btn" onClick={addBash}>
						<Codicon name="add" size={12} /> Añadir
					</button>
				</div>
			</div>

			{/* ── 5. Fuera del workspace ── */}
			<div className="perm-card">
				<div className="perm-card-head">
					<Codicon name="link-external" size={14} className="perm-head-icon" />
					<span className="perm-card-title">Fuera del workspace</span>
				</div>
				<div className="perm-row">
					<span className="perm-row-name">
						Acceso a archivos fuera de la carpeta de trabajo
					</span>
					<TriState
						value={cfg.externalDirectory}
						onChange={(s) => post({ type: "perm_set_external", state: s })}
					/>
				</div>
			</div>

			{/* ── 6. Aprobado en esta sesión ── */}
			<div className="perm-card">
				<div className="perm-card-head">
					<Codicon name="history" size={14} className="perm-head-icon" />
					<span className="perm-card-title">Aprobado en esta sesión</span>
				</div>
				<div className="perm-note">
					Patrones aceptados con «sí, siempre» durante esta sesión. Se descartan
					automáticamente al cerrarla.
				</div>
				{(state.sessionPatterns ?? []).length === 0 ? (
					<div className="perm-note muted">— Nada aprobado por sesión todavía —</div>
				) : (
					<div className="perm-chips">
						{(state.sessionPatterns ?? []).map((sp) => (
							<button
								key={`${sp.kind}:${sp.pattern}`}
								type="button"
								className="perm-chip session"
								title="Revocar (vuelve a preguntar)"
								onClick={() =>
									post({
										type: "perm_revoke_session_pattern",
										kind: sp.kind,
										pattern: sp.pattern,
									})
								}
							>
								<span className="perm-chip-kind">{KIND_LABEL[sp.kind]}</span>
								<code>{sp.pattern}</code>
								<span className="perm-chip-revoke">
									<Codicon name="close" size={11} /> Revocar
								</span>
							</button>
						))}
					</div>
				)}
			</div>

			{/* ── 7. Auditoría y Registro ── */}
			<div className="perm-card">
				<div className="perm-card-head">
					<Codicon name="output" size={14} className="perm-head-icon" />
					<span className="perm-card-title">Auditoría y registro</span>
				</div>
				<div className="perm-row">
					<label className="perm-check">
						<input
							type="checkbox"
							checked={cfg.auditLog}
							onChange={(e) =>
								post({ type: "perm_set_audit", enabled: e.target.checked })
							}
						/>
						<span>
							Registrar decisiones en <code>approvals.jsonl</code>
						</span>
					</label>
					<button
						type="button"
						className="perm-reset-btn"
						onClick={() => post({ type: "perm_reset" })}
					>
						<Codicon name="refresh" size={12} /> Restablecer defaults
					</button>
				</div>
			</div>
		</div>
	);
}

/** Control segmentado interactivo con Codicons de VS Code (allow / ask / deny). */
function TriState({
	value,
	onChange,
}: {
	value: PermState;
	onChange: (s: PermState) => void;
}) {
	return (
		<div className="perm-seg">
			{(["allow", "ask", "deny"] as const).map((s) => {
				const meta = PERM_META[s];
				const isSelected = value === s;
				return (
					<button
						key={s}
						type="button"
						className={`perm-seg-btn is-${s}${isSelected ? " active" : ""}`}
						title={meta.label}
						onClick={() => onChange(s)}
					>
						<Codicon name={meta.icon} size={11} />
						<span className="perm-seg-label">{meta.label}</span>
					</button>
				);
			})}
		</div>
	);
}

/** Select de estado para las formas de añadir patrón. */
function StateSelect({
	value,
	onChange,
}: {
	value: PermState;
	onChange: (s: PermState) => void;
}) {
	return (
		<select
			className="perm-select"
			value={value}
			onChange={(e) => onChange(e.target.value as PermState)}
		>
			<option value="allow">Permitir</option>
			<option value="ask">Preguntar</option>
			<option value="deny">Negar</option>
		</select>
	);
}

/** Chips de patrones declarativos (con codicon de estado y botón de eliminar). */
function PatternChips({
	map,
	onRemove,
}: {
	map: Record<string, PermState>;
	onRemove: (pattern: string) => void;
}) {
	const entries = Object.entries(map);
	if (entries.length === 0) {
		return <div className="perm-note muted">— Sin patrones —</div>;
	}
	return (
		<div className="perm-chips">
			{entries.map(([pattern, state]) => {
				const meta = PERM_META[state];
				return (
					<span key={pattern} className={`perm-chip is-${state}`}>
						<Codicon
							name={meta.icon}
							size={12}
							className={`perm-glyph is-${state}`}
						/>
						<code>{pattern}</code>
						<button
							type="button"
							className="rm"
							title="Quitar patrón"
							onClick={() => onRemove(pattern)}
						>
							<Codicon name="close" size={11} />
						</button>
					</span>
				);
			})}
		</div>
	);
}
