// SkillsPanel — overlay navegable de skills (sustituye a la toast de /skills).
//
// Panel Remote React que se monta al ejecutar /skills o /skills-search. A
// diferencia de la notificación info efímera (que se desvanece y no se puede
// buscar/copiar), este overlay es persistente: búsqueda en vivo, lista con
// scroll, descripción completa y un botón "insertar" por skill que manda el
// texto al composer (host → composer_insert).
//
// Patrón de AuditPanel/ContextReport: estado local en useState, props
// inmutables del host + callbacks (onInsert/onClose) que son closures del host.

import { useState } from "react";
import type { ReactElement } from "react";

export interface SkillRow {
	name: string;
	description: string;
}

/** Factory que el host usa para montar el panel vía webBridge.mountPersistent. */
export function createSkillsPanelElement(
	skills: SkillRow[],
	initialQuery: string,
	onInsert: (text: string) => void,
	onClose: () => void,
): ReactElement {
	return (
		<SkillsPanel
			skills={skills}
			initialQuery={initialQuery}
			onInsert={onInsert}
			onClose={onClose}
		/>
	);
}

function SkillsPanel({
	skills,
	initialQuery,
	onInsert,
	onClose,
}: {
	skills: SkillRow[];
	initialQuery: string;
	onInsert: (text: string) => void;
	onClose: () => void;
}): ReactElement {
	const [query, setQuery] = useState(initialQuery);

	const q = query.trim().toLowerCase();
	const filtered = q
		? skills.filter(
				(s) =>
					s.name.toLowerCase().includes(q) ||
					s.description.toLowerCase().includes(q),
			)
		: skills;
	const sorted = [...filtered].sort((a, b) => a.name.localeCompare(b.name));

	return (
		<fbox flexDirection="column" gap={10} padding={12} bordered>
			{/* Header */}
			<fbox flexDirection="row" gap={6} alignItems="center">
				<ftext bold>Skills</ftext>
				<ftext color="var(--vscode-descriptionForeground)">
					· {skills.length} disponibles
					{q ? ` · ${filtered.length} coinciden` : ""}
				</ftext>
				<fbox flex={1} />
				<ftext color="var(--vscode-descriptionForeground)">
					invoca inline con $name o /skill:name
				</ftext>
				<fbutton variant="secondary" onClick={onClose}>
					✕
				</fbutton>
			</fbox>

			{/* Búsqueda */}
			<finput
				value={query}
				placeholder="Filtrar por nombre o descripción…"
				onChange={setQuery}
			/>

			{/* Lista (scroll interno para no desbordar) */}
			<fbox flexDirection="column" gap={2} height={360} overflow="auto">
				{sorted.length === 0 ? (
					<ftext color="var(--vscode-descriptionForeground)">
						{skills.length === 0
							? "Sin skills instaladas. Colócalas en ~/.frida/skills/ o .frida/skills/ y recarga con /reload."
							: `Ninguna coincide con "${query}".`}
					</ftext>
				) : (
					sorted.map((s) => (
						<fbox key={s.name} flexDirection="row" gap={8} alignItems="center">
							<ftext bold wrap={false}>
								{"$"}
								{s.name}
							</ftext>
							<ftext color="var(--vscode-descriptionForeground)" wrap={false}>
								{s.description || "(sin descripción)"}
							</ftext>
							<fbox flex={1} />
							<fbutton
								variant="secondary"
								onClick={() => onInsert(`$${s.name} `)}
							>
								insertar
							</fbutton>
						</fbox>
					))
				)}
			</fbox>
		</fbox>
	);
}
