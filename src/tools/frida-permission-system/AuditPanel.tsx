// AuditPanel — UI navegable del JSONL de auditoría (ADR-0016, Fase 2).
//
// Panel overlay Remote React que se monta al ejecutar /gates. Convierte el log
// opaco (approvals.jsonl) en observabilidad real: lista de decisiones con filtros
// (Todas / Permitidas / Bloqueadas), colores por decisión (✓ allow / ✗ block) y
// detalle por fila (tool · source · path|command · flags · hora).
//
// El estado del filtro vive en useState (como WebQuestionnaire); al clic un
// fbutton, fireEvent → re-render con el nuevo filtro. Las entradas se pasan
// inmutables desde el host (postGatesCommand lee el log al ejecutar el comando;
// el panel no re-lee en vivo — es un snapshot, por diseño).

import { useState } from "react";
import type { ReactElement } from "react";
import type { GateEntry } from "./audit-log";

type Filter = "all" | "allow" | "block";

/** Glyph + color por decisión (verde allow / rojo block, como los badges git). */
const DECISION_STYLE: Record<
	GateEntry["decision"],
	{ glyph: string; color: string }
> = {
	allow: {
		glyph: "✓",
		color: "var(--vscode-gitDecoration-addedResourceForeground)",
	},
	block: {
		glyph: "✗",
		color: "var(--vscode-gitDecoration-deletedResourceForeground)",
	},
};

/** Source legible (es-MX) para el contexto de la decisión. */
const SOURCE_LABEL: Record<string, string> = {
	mode: "auto (modo)",
	sensitive_path: "path sensible",
	dangerous_command: "comando peligroso",
	user_approved: "aprobado",
	user_rejected: "rechazado",
	gate_error: "error del gate",
};

/** ISO → HH:MM:SS (es-MX, 24h). Best-effort: si falla, deja el crudo. */
function fmtTime(ts: string): string {
	try {
		return new Date(ts).toLocaleTimeString("es-MX", { hour12: false });
	} catch {
		return ts;
	}
}

/** Trunca a `n` chars con elipsis. */
function truncate(s: string, n: number): string {
	return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function createAuditPanelElement(
	entries: GateEntry[],
	onClose: () => void,
): ReactElement {
	return <AuditPanel entries={entries} onClose={onClose} />;
}

function AuditPanel({
	entries,
	onClose,
}: {
	entries: GateEntry[];
	onClose: () => void;
}): ReactElement {
	const [filter, setFilter] = useState<Filter>("all");

	const allowCount = entries.filter((e) => e.decision === "allow").length;
	const blockCount = entries.filter((e) => e.decision === "block").length;
	const shown =
		filter === "all" ? entries : entries.filter((e) => e.decision === filter);

	return (
		<fbox flexDirection="column" gap={10} padding={12} bordered>
			{/* Header */}
			<fbox flexDirection="row" gap={6} alignItems="center">
				<ftext bold>Auditoría de permisos</ftext>
				<ftext color="var(--vscode-descriptionForeground)">
					· {entries.length} decisiones (últimas {entries.length})
				</ftext>
			</fbox>

			{/* Stats + filtros */}
			<fbox flexDirection="row" gap={8} alignItems="center">
				<ftext color={DECISION_STYLE.allow.color}>✓ {allowCount}</ftext>
				<ftext color={DECISION_STYLE.block.color}>✗ {blockCount}</ftext>
				<fbox flex={1} />
				<fbutton
					variant={filter === "all" ? "primary" : "secondary"}
					onClick={() => setFilter("all")}
				>
					Todas
				</fbutton>
				<fbutton
					variant={filter === "allow" ? "primary" : "secondary"}
					onClick={() => setFilter("allow")}
				>
					Permitidas
				</fbutton>
				<fbutton
					variant={filter === "block" ? "primary" : "secondary"}
					onClick={() => setFilter("block")}
				>
					Bloqueadas
				</fbutton>
			</fbox>

			{/* Lista de decisiones */}
			<fbox flexDirection="column" gap={3}>
				{shown.length === 0 ? (
					<ftext color="var(--vscode-descriptionForeground)">
						{entries.length === 0
							? "Sin decisiones registradas todavía. Ejecuta acciones en el agente para generar auditoría."
							: "Sin decisiones para este filtro."}
					</ftext>
				) : (
					shown.map((e, i) => {
						const style = DECISION_STYLE[e.decision] ?? DECISION_STYLE.allow;
						const detail = e.command ?? e.path;
						return (
							<fbox
								key={`${e.ts}-${i}`}
								flexDirection="row"
								gap={8}
								alignItems="center"
							>
								<ftext color={style.color}>{style.glyph}</ftext>
								<ftext bold wrap={false}>
									{e.tool}
								</ftext>
								<ftext color="var(--vscode-descriptionForeground)" wrap={false}>
									{SOURCE_LABEL[e.source] ?? e.source}
								</ftext>
								{detail ? (
									<ftext
										color="var(--vscode-descriptionForeground)"
										wrap={false}
									>
										{truncate(detail, 48)}
									</ftext>
								) : null}
								{e.flags && e.flags.length > 0 ? (
									<ftext
										color="var(--vscode-editorWarning-foreground)"
										wrap={false}
									>
										⚠ {e.flags.join(", ")}
									</ftext>
								) : null}
								<fbox flex={1} />
								<ftext color="var(--vscode-descriptionForeground)" wrap={false}>
									{fmtTime(e.ts)}
								</ftext>
							</fbox>
						);
					})
				)}
			</fbox>

			{/* Cerrar */}
			<fbox flexDirection="row" justifyContent="flex-end">
				<fbutton variant="secondary" onClick={onClose}>
					Cerrar
				</fbutton>
			</fbox>
		</fbox>
	);
}
