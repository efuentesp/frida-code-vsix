import { useState } from "react";
import type { ApprovalMode, OutMessage, PermState, State } from "../types";

// Panel de Auto-Aprobación (#55): editor visual de la política declarativa de
// frida-permission-system (permission.json) dentro del webview. Reemplaza al
// overlay /gates-config (Remote React, retirado). Cada cambio persiste en el
// host vía el puente perm_* y el gate lee la política fresca en el próximo
// tool_call — sin recargar la sesión. El snapshot llega en state.permissions
// (host lo publica al abrir el tab, tras cada cambio y al limpiar sesión).

/** Tri-states con glifos (paridad con el overlay retirado). */
const PERM_META: Record<PermState, { glyph: string; label: string }> = {
	allow: { glyph: "✓", label: "Permitir" },
	ask: { glyph: "●", label: "Preguntar" },
	deny: { glyph: "✕", label: "Negar" },
};

/** Tools conocidos de la superficie `tool` (paridad DEFAULT_POLICY). */
const KNOWN_TOOLS: { id: string; label?: string }[] = [
	{ id: "read" },
	{ id: "edit" },
	{ id: "write" },
	{ id: "bash" },
	{ id: "grep" },
	{ id: "find" },
	{ id: "ls" },
	{ id: "todo" },
	{ id: "ask_user_question" },
	{ id: "*", label: "desconocidos (MCP / extensiones)" },
];

const MODE_DESC: Record<string, string> = {
	manual: "Respeta la política tal cual: todo `preguntar` abre el diálogo.",
	"auto-edit":
		"Ediciones (edit/write) con `preguntar` pasan sin diálogo; bash y force-ask siguen pidiendo.",
	auto: "Todo `preguntar` pasa sin diálogo (salvo deny, que siempre gana).",
};

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

	// Tools extra definidos directamente en permission.json (fuera de la lista
	// conocida): se muestran igual, el usuario no debería perderlos de vista.
	const extraTools = Object.keys(cfg.tool).filter(
		(t) => !KNOWN_TOOLS.some((k) => k.id === t),
	);
	const tools = [...KNOWN_TOOLS, ...extraTools.map((t) => ({ id: t }))];

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
			{/* ── Modo global ── */}
			<div className="cfg-section">Modo global</div>
			<div className="perm-mode-row">
				<select
					className="perm-select"
					value={cfg.mode}
					onChange={(e) =>
						post({ type: "set_mode", mode: e.target.value as ApprovalMode })
					}
				>
					<option value="manual">Manual</option>
					<option value="auto-edit">Auto-edit</option>
					<option value="auto">Auto</option>
				</select>
				<span className="perm-note">{MODE_DESC[cfg.mode]}</span>
			</div>
			<div className="perm-note">
				`negar` siempre gana, incluso en Auto. El modo también vive en el footer
				de la conversación (los dos mandan al mismo lugar).
			</div>

			{/* ── Tools ── */}
			<div className="cfg-section">Tools</div>
			{tools.map((t) => (
				<div key={t.id} className="perm-row">
					<span className="perm-row-name" title={t.id}>
						{t.id === "*" ? "* desconocidos (MCP / extensiones)" : t.id}
					</span>
					<TriState
						value={cfg.tool[t.id] ?? "ask"}
						onChange={(s) => post({ type: "perm_set_tool", tool: t.id, state: s })}
					/>
				</div>
			))}

			{/* ── Paths ── */}
			<div className="cfg-section">Paths (wildcards)</div>
			<div className="perm-note">
				Cross-cutting: aplica a cualquier tool que toque el archivo. El patrón
				más específico gana (`*.env.example` tras `*.env`). Ej. `*.env`, `~/.ssh/*`.
			</div>
			<PatternChips
				map={cfg.path}
				onRemove={(p) => post({ type: "perm_remove_path", pattern: p })}
			/>
			<div className="perm-add">
				<input
					className="perm-input"
					placeholder="*.env"
					value={newPath}
					onChange={(e) => setNewPath(e.target.value)}
					onKeyDown={(e) => e.key === "Enter" && addPath()}
				/>
				<StateSelect value={newPathState} onChange={setNewPathState} />
				<button className="perm-add-btn" onClick={addPath}>
					Añadir
				</button>
			</div>

			{/* ── Bash ── */}
			<div className="cfg-section">Comandos bash</div>
			<div className="perm-note">
				Wildcards sobre el comando completo. Ej. `git push *`, `rm -rf *`,
				`npm *`. Los deny hardcodeados (dangerous-commands) siguen aplicando
				como capa extra.
			</div>
			<PatternChips
				map={cfg.bash}
				onRemove={(p) => post({ type: "perm_remove_bash", pattern: p })}
			/>
			<div className="perm-add">
				<input
					className="perm-input"
					placeholder="git push *"
					value={newBash}
					onChange={(e) => setNewBash(e.target.value)}
					onKeyDown={(e) => e.key === "Enter" && addBash()}
				/>
				<StateSelect value={newBashState} onChange={setNewBashState} />
				<button className="perm-add-btn" onClick={addBash}>
					Añadir
				</button>
			</div>

			{/* ── Fuera del workspace ── */}
			<div className="cfg-section">Fuera del workspace</div>
			<div className="perm-row">
				<span className="perm-row-name">
					Acceso a paths fuera de la carpeta de trabajo
				</span>
				<TriState
					value={cfg.externalDirectory}
					onChange={(s) => post({ type: "perm_set_external", state: s })}
				/>
			</div>

			{/* ── Sesión ── */}
			<div className="cfg-section">Aprobado en esta sesión</div>
			<div className="perm-note">
				Patrones aprobados con «sí, siempre» en el diálogo de permisos. Viven en
				memoria: al revocarlos aquí vuelven a pedir de inmediato; al cerrar la
				sesión se olvidan solos.
			</div>
			{(state.sessionPatterns ?? []).length === 0 ? (
				<div className="perm-note muted">— Nada aprobado por sesión todavía —</div>
			) : (
				<div className="perm-chips">
					{(state.sessionPatterns ?? []).map((sp) => (
						<button
							key={`${sp.kind}:${sp.pattern}`}
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
							<span className="rm">×</span>
						</button>
					))}
				</div>
			)}

			{/* ── Auditoría ── */}
			<div className="cfg-section">Auditoría</div>
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
				<button className="perm-add-btn" onClick={() => post({ type: "perm_reset" })}>
					Restablecer defaults
				</button>
			</div>
			<div className="perm-note">
				El log lo consulta <code>/gates</code>. Restablecer vuelve a la política
				por defecto (y a modo Manual) — no borra el historial.
			</div>
		</div>
	);
}

/** Control segmentado ✓ / ● / ✕ (un tri-state). */
function TriState({
	value,
	onChange,
}: {
	value: PermState;
	onChange: (s: PermState) => void;
}) {
	return (
		<div className="perm-seg">
			{(["allow", "ask", "deny"] as const).map((s) => (
				<button
					key={s}
					className={`perm-seg-btn is-${s}${value === s ? " active" : ""}`}
					title={PERM_META[s].label}
					onClick={() => onChange(s)}
				>
					{PERM_META[s].glyph}
				</button>
			))}
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
			<option value="allow">✓ Permitir</option>
			<option value="ask">● Preguntar</option>
			<option value="deny">✕ Negar</option>
		</select>
	);
}

/** Chips de patrones declarativos (con estado y remove). */
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
			{entries.map(([pattern, state]) => (
				<span key={pattern} className={`perm-chip is-${state}`}>
					<span className={`perm-glyph is-${state}`}>{PERM_META[state].glyph}</span>
					<code>{pattern}</code>
					<button
						className="rm"
						title="Quitar patrón"
						onClick={() => onRemove(pattern)}
					>
						×
					</button>
				</span>
			))}
		</div>
	);
}
