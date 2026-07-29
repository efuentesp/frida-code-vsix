// ConfigPanel — editor visual de la política declarativa (ADR-0016, Fase 5 + 5b).
//
// Panel overlay Remote React que se monta al ejecutar /gates-config. Edita las tres
// superficies declarativas:
//  - `tool`: allow/ask/deny por tool (Fase 5).
//  - `path`: patrones wildcard sobre el path del input (Fase 5b). Ej. `*.env: deny`.
//  - `bash`: patrones wildcard sobre el comando (Fase 5b). Ej. `git push *: deny`.
//
// Estado "controlado": la política vive en el HOST (config-store.ts) y el panel la
// lee vía useSyncExternalStore. El DRAFT del input sí es useState local (como
// WebQuestionnaire): el finput controlado hace round-trip onChange→host→re-render,
// aceptable para un patrón corto; al pulsar Añadir se consolida en el store.

import { useSyncExternalStore, useState } from "react";
import type { ReactElement } from "react";
import type { PermissionState } from "./types";
import {
	getConfig,
	removeBashPattern,
	removePathPattern,
	resetConfig,
	saveConfig,
	setBashPattern,
	setPathPattern,
	setTool,
	subscribeConfig,
} from "./config-store";

/** Tools editables en la superficie `tool`. El "*" es el default. */
const TOOLS = [
	"read",
	"grep",
	"find",
	"ls",
	"todo",
	"ask_user_question",
	"edit",
	"write",
	"bash",
	"*",
];

const STATE_META: Record<
	PermissionState,
	{ glyph: string; color: string; label: string }
> = {
	allow: {
		glyph: "✓",
		color: "var(--vscode-gitDecoration-addedResourceForeground)",
		label: "Permitir",
	},
	ask: {
		glyph: "?",
		color: "var(--vscode-editorWarning-foreground)",
		label: "Preguntar",
	},
	deny: {
		glyph: "✗",
		color: "var(--vscode-gitDecoration-deletedResourceForeground)",
		label: "Bloquear",
	},
};
const STATES: PermissionState[] = ["allow", "ask", "deny"];
const TOOL_LABEL: Record<string, string> = { "*": "(otros — default)" };

export function createConfigPanelElement(onClose: () => void): ReactElement {
	return <ConfigPanel onClose={onClose} />;
}

function ConfigPanel({ onClose }: { onClose: () => void }): ReactElement {
	const config = useSyncExternalStore(subscribeConfig, getConfig);

	return (
		<fbox flexDirection="column" gap={10} padding={12} bordered>
			{/* Header */}
			<fbox flexDirection="row" gap={6} alignItems="center">
				<ftext bold>Permisos</ftext>
				<ftext color="var(--vscode-descriptionForeground)">
					· edita y guarda (~/.frida/permission.json)
				</ftext>
			</fbox>

			{/* Nota de capas */}
			<ftext color="var(--vscode-descriptionForeground)" wrap={true}>
				Los patrones se combinan con most-restrictive-wins: deny gana sobre ask,
				ask sobre allow. Paths sensibles y comandos peligrosos se bloquean
				siempre (capa de seguridad) sin importar el estado del tool.
			</ftext>

			{/* --- Superficie tool --- */}
			<ftext bold>Tools</ftext>
			<fbox flexDirection="column" gap={5}>
				{TOOLS.map((tool) => (
					<ToolRow
						key={tool}
						tool={tool}
						current={config.policy.tool[tool] ?? "ask"}
					/>
				))}
			</fbox>

			{/* --- Superficie path (Fase 5b) --- */}
			<PatternSection
				title="Paths (wildcard sobre el path)"
				hint="Ej. *.env, secrets/*, ~/.ssh/*. Un deny bloquea el acceso; ask pide confirmación."
				map={config.policy.path}
				onSet={setPathPattern}
				onRemove={removePathPattern}
				placeholder="*.env  o  secrets/*"
			/>

			{/* --- Superficie bash (Fase 5b) --- */}
			<PatternSection
				title="Bash (wildcard sobre el comando)"
				hint="Ej. git push *, rm -rf *. Un deny bloquea el comando; ask pide confirmación."
				map={config.policy.bash}
				onSet={setBashPattern}
				onRemove={removeBashPattern}
				placeholder="git push *  o  npm *"
			/>

			{/* Acciones */}
			<fbox flexDirection="row" gap={8} justifyContent="flex-end">
				<fbutton variant="secondary" onClick={resetConfig}>
					Restaurar default
				</fbutton>
				<fbutton
					variant="primary"
					onClick={() => {
						saveConfig();
						onClose();
					}}
				>
					Guardar
				</fbutton>
			</fbox>
		</fbox>
	);
}

function ToolRow({
	tool,
	current,
}: {
	tool: string;
	current: PermissionState;
}): ReactElement {
	return (
		<fbox flexDirection="row" gap={8} alignItems="center">
			<ftext bold wrap={false}>
				{TOOL_LABEL[tool] ?? tool}
			</ftext>
			<fbox flex={1} />
			{STATES.map((s) => (
				<fbutton
					key={s}
					variant={current === s ? "primary" : "secondary"}
					onClick={() => setTool(tool, s)}
				>
					{STATE_META[s].glyph} {STATE_META[s].label}
				</fbutton>
			))}
		</fbox>
	);
}

/** Sección de una superficie de patrones (path o bash): lista editable + input. */
function PatternSection({
	title,
	hint,
	map,
	onSet,
	onRemove,
	placeholder,
}: {
	title: string;
	hint: string;
	map: Record<string, PermissionState>;
	onSet: (pattern: string, state: PermissionState) => void;
	onRemove: (pattern: string) => void;
	placeholder: string;
}): ReactElement {
	const [draft, setDraft] = useState("");
	return (
		<fbox flexDirection="column" gap={4}>
			<ftext bold>{title}</ftext>
			<ftext color="var(--vscode-descriptionForeground)" wrap={true}>
				{hint}
			</ftext>
			{Object.entries(map).map(([pattern, state]) => (
				<PatternRow
					key={pattern}
					pattern={pattern}
					current={state}
					onSet={onSet}
					onRemove={onRemove}
				/>
			))}
			<fbox flexDirection="row" gap={6} alignItems="center">
				<finput value={draft} placeholder={placeholder} onChange={setDraft} />
				<fbutton
					variant="secondary"
					onClick={() => {
						const p = draft.trim();
						if (p) {
							onSet(p, "ask");
							setDraft("");
						}
					}}
				>
					Añadir
				</fbutton>
			</fbox>
		</fbox>
	);
}

function PatternRow({
	pattern,
	current,
	onSet,
	onRemove,
}: {
	pattern: string;
	current: PermissionState;
	onSet: (pattern: string, state: PermissionState) => void;
	onRemove: (pattern: string) => void;
}): ReactElement {
	return (
		<fbox flexDirection="row" gap={6} alignItems="center">
			<ftext wrap={false}>{pattern}</ftext>
			<fbox flex={1} />
			{STATES.map((s) => (
				<fbutton
					key={s}
					variant={current === s ? "primary" : "secondary"}
					onClick={() => onSet(pattern, s)}
				>
					{STATE_META[s].glyph}
				</fbutton>
			))}
			<fbutton variant="secondary" onClick={() => onRemove(pattern)}>
				×
			</fbutton>
		</fbox>
	);
}
