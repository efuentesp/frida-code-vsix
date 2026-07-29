// ContextReport — UI rica del reporte /context (fase B, ADR-0015). Paridad con
// supi-context: barra segmentada (estilo Claude Code) + métricas + desglose por
// categoría + composición del system prompt (instruction files, skills,
// guidelines por fuente, tool snippets) + tool definitions. Se monta vía
// WebBridge.mountPersistent al ejecutar /context; se cierra con el botón.
//
// Tags intrinsic de frida-webview (fbox/ftext/fbutton).
//
// Las listas usan conectores de árbol (├ intermedio, └ último) con indentación,
// para distinguir el header de la sección (en bold, sin conector) de los items.

import type { ReactElement, ReactNode } from "react";
import type { ContextAnalysis } from "./analysis";

/** Paleta por categoría (variables charts de VS Code). */
const COLORS = {
	systemPrompt: "var(--vscode-charts-blue)",
	toolSnippets: "var(--vscode-charts-purple)",
	messages: "var(--vscode-charts-green)",
	toolCalls: "var(--vscode-charts-orange)",
	toolResults: "var(--vscode-charts-yellow)",
	other: "var(--vscode-charts-red)",
	free: "var(--vscode-editor-inactiveSelectionBackground, rgba(127,127,127,0.3))",
} as const;
const TENUE = "var(--vscode-descriptionForeground)";
/** Indent de los items respecto al header (nbsp para preservarlo siempre). */
const INDENT = "\u00A0\u00A0";

function fmt(n: number): string {
	if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
	if (n >= 1000) return (n / 1000).toFixed(n >= 10_000 ? 0 : 1) + "k";
	return String(n);
}

/** Conectores de árbol para una lista de `count` items: ├ para todos salvo el
 *  último, que lleva └. El último item visible puede llevar ├ si hay un elemento
 *  "… y N más" detrás (pasar hasMore=true). */
function treeConnectors(count: number, hasMore = false): string[] {
	return Array.from({ length: count }, (_, i) => {
		const isLast = i === count - 1;
		if (!isLast) return "├";
		return hasMore ? "├" : "└";
	});
}

export function createContextReportElement(
	analysis: ContextAnalysis,
	onClose: () => void,
): ReactElement {
	return <ContextReport analysis={analysis} onClose={onClose} />;
}

function ContextReport({
	analysis,
	onClose,
}: {
	analysis: ContextAnalysis;
	onClose: () => void;
}): ReactElement {
	const s = analysis.snapshot;
	const cat = analysis.categories;
	const b = analysis.systemPromptBreakdown;
	const td = analysis.toolDefinitions;
	const cw = s.contextWindow ?? 0;
	const messages = cat.userMessages + cat.assistantMessages;
	const free = Math.max(0, cw - s.usedTokens);
	const pct = (t: number) => (cw > 0 ? Math.round((t / cw) * 100) : 0);
	const flexOf = (t: number) => Math.max(1, Math.round(t / 100));

	const segments: { color: string; tokens: number; label: string }[] = [
		{
			color: COLORS.systemPrompt,
			tokens: cat.systemPrompt,
			label: "System prompt",
		},
		{
			color: COLORS.toolSnippets,
			tokens: b.toolSnippets,
			label: "Tool snippets",
		},
		{ color: COLORS.messages, tokens: messages, label: "Messages" },
		{ color: COLORS.toolCalls, tokens: cat.toolCalls, label: "Tool calls" },
		{
			color: COLORS.toolResults,
			tokens: cat.toolResults,
			label: "Tool results",
		},
		{ color: COLORS.other, tokens: cat.other, label: "Otros" },
		{ color: COLORS.free, tokens: free, label: "Free space" },
	];
	const visible = segments.filter((seg) => seg.tokens > 0);
	const instructionTotal = b.instructionFiles.reduce((a, c) => a + c.tokens, 0);
	const skillsTotal = b.skills.reduce((a, c) => a + c.tokens, 0);

	// Listas pre-armadas para aplicar conectores de árbol uniformemente.
	const usageItems: {
		key: string;
		label: string;
		tokens: number;
		color: string;
	}[] = [
		{
			key: "sp",
			label: "System prompt",
			tokens: cat.systemPrompt,
			color: COLORS.systemPrompt,
		},
		{
			key: "um",
			label: "User messages",
			tokens: cat.userMessages,
			color: COLORS.messages,
		},
		{
			key: "am",
			label: "Assistant messages",
			tokens: cat.assistantMessages,
			color: COLORS.messages,
		},
		{
			key: "tc",
			label: "Tool calls",
			tokens: cat.toolCalls,
			color: COLORS.toolCalls,
		},
		{
			key: "tr",
			label: "Tool results",
			tokens: cat.toolResults,
			color: COLORS.toolResults,
		},
		...(cat.other > 0
			? [
					{
						key: "ot",
						label: "Otros",
						tokens: cat.other,
						color: COLORS.other,
					},
				]
			: []),
		{
			key: "fs",
			label: "Free space",
			tokens: free,
			color: COLORS.free,
		},
	];

	const compItems: { key: string; label: string; tokens: number }[] = [
		{ key: "base", label: "Base (pi core)", tokens: b.base },
		...(instructionTotal > 0
			? [
					{
						key: "if",
						label: `Instruction files (${b.instructionFiles.length})`,
						tokens: instructionTotal,
					},
				]
			: []),
		{
			key: "sk",
			label: `Skills (${b.skills.length})`,
			tokens: skillsTotal,
		},
		{ key: "gl", label: "Guidelines", tokens: b.guidelines },
		{
			key: "ts",
			label: `Tool snippets (${b.toolSnippetDetails.length})`,
			tokens: b.toolSnippets,
		},
		...(b.appendText > 0
			? [{ key: "ap", label: "Append text", tokens: b.appendText }]
			: []),
	];

	// Skills con truncamiento opcional ("… y N más" cierra el árbol con └).
	const skillsShown = b.skills.slice(0, 12);
	const skillsMore = b.skills.length - 12;
	const skillsConns = treeConnectors(skillsShown.length, skillsMore > 0);

	// Tool definitions con truncamiento.
	const toolsShown = td.tools.slice(0, 10);
	const toolsMore = td.tools.length - 10;
	const toolsConns = treeConnectors(toolsShown.length, toolsMore > 0);

	// Guidelines: fuentes (lista) + bullets de ejemplo (notas indentadas).
	const sourcesConns = treeConnectors(b.guidelineSources.length);
	// Conectores para las listas fijas (una sola pasada).
	const usageConns = treeConnectors(usageItems.length);
	const compConns = treeConnectors(compItems.length);
	// Bullets de guidelines (con truncamiento opcional).
	const bulletsShown = b.guidelineBullets.slice(0, 3);
	const bulletsMore = b.guidelineBullets.length - 3;
	const bulletsConns = treeConnectors(bulletsShown.length, bulletsMore > 0);

	return (
		<fbox flexDirection="column" gap={10} padding={12} bordered>
			{/* Header */}
			<fbox flexDirection="row" gap={6} alignItems="center">
				<ftext bold>Context Usage</ftext>
				<ftext color={TENUE}>
					· {s.modelName} · {fmt(s.usedTokens)}/{cw ? fmt(cw) : "?"} tokens (
					{s.usagePercent ?? 0}%)
				</ftext>
			</fbox>

			{/* Barra segmentada */}
			<fbox flexDirection="row" gap={0} bordered overflow="hidden">
				{visible.map((seg, i) => (
					<fbox
						key={`${seg.label}-${i}`}
						flex={flexOf(seg.tokens)}
						background={seg.color}
						height={18}
					/>
				))}
			</fbox>

			{/* Métricas */}
			<fbox flexDirection="row" gap={10} alignItems="center">
				{s.pressurePercent != null ? (
					<ftext color="var(--vscode-charts-red)">
						presión {s.pressurePercent}%
					</ftext>
				) : null}
				{s.headroomTokens != null ? (
					<ftext color={TENUE}>headroom {fmt(s.headroomTokens)}</ftext>
				) : null}
				<ftext color={TENUE}>
					{s.compacted ? "compactada" : "sin compactar"} · compaction{" "}
					{s.compactionEnabled ? "on" : "off"}
					{s.compactionEnabled ? ` (reserve ${fmt(s.reserveTokens)})` : ""}
				</ftext>
			</fbox>
			{analysis.approximationNote ? (
				<ftext color="var(--vscode-editorWarning-foreground)">
					⚠ {analysis.approximationNote}
				</ftext>
			) : null}

			{/* Usage by category */}
			<Section title="Uso por categoría">
				{usageItems.map((it, i) => (
					<TreeItem key={it.key} connector={usageConns[i]}>
						<Row
							label={it.label}
							tokens={it.tokens}
							pct={pct(it.tokens)}
							color={it.color}
						/>
					</TreeItem>
				))}
			</Section>

			{/* System prompt composition */}
			<Section
				title={`Composición del system prompt · ${fmt(cat.systemPrompt)} tokens`}
			>
				{compItems.map((it, i) => (
					<TreeItem key={it.key} connector={compConns[i]}>
						<Row label={it.label} tokens={it.tokens} pct={pct(it.tokens)} />
					</TreeItem>
				))}
			</Section>

			{/* Instruction files (AGENTS.md / CLAUDE.md) */}
			{b.instructionFiles.length > 0 ? (
				<Section title="Instruction files (AGENTS.md / CLAUDE.md)">
					{b.instructionFiles.map((f, i) => (
						<TreeItem
							key={`if-${i}`}
							connector={treeConnectors(b.instructionFiles.length)[i]}
						>
							<Row
								label={`${f.path} · ${f.origin}`}
								tokens={f.tokens}
								extra={`${f.lines}L`}
							/>
						</TreeItem>
					))}
				</Section>
			) : null}

			{/* Skills */}
			{b.skills.length > 0 ? (
				<Section title={`Skills (${b.skills.length})`}>
					{skillsShown.map((sk, i) => (
						<TreeItem key={`sk-${i}`} connector={skillsConns[i]}>
							<Row label={sk.name} tokens={sk.tokens} />
						</TreeItem>
					))}
					{skillsMore > 0 ? (
						<TreeItem connector="└">
							<ftext color={TENUE}>… y {skillsMore} más</ftext>
						</TreeItem>
					) : null}
				</Section>
			) : null}

			{/* Guidelines (fuentes + ejemplos) */}
			{b.guidelineSources.length > 0 ? (
				<Section title={`Guidelines (${b.guidelineBullets.length} bullets)`}>
					{b.guidelineSources.map((g, i) => (
						<TreeItem key={`gs-${i}`} connector={sourcesConns[i]}>
							<Row
								label={g.source}
								tokens={g.tokens}
								extra={`${g.bulletCount} bullets`}
							/>
						</TreeItem>
					))}
					{b.guidelineBullets.slice(0, 3).map((bl, i) => (
						<TreeItem key={`gb-${i}`} connector={bulletsConns[i]}>
							<ftext color={TENUE} wrap={true}>
								• {bl}
							</ftext>
						</TreeItem>
					))}
					{bulletsMore > 0 ? (
						<TreeItem connector="└">
							<ftext color={TENUE}>… y {bulletsMore} más</ftext>
						</TreeItem>
					) : null}
				</Section>
			) : null}

			{/* Tool Definitions */}
			{td.count > 0 ? (
				<Section
					title={`Tool definitions (${td.count} activos · ${fmt(td.tokens)} tokens)`}
				>
					{toolsShown.map((t, i) => (
						<TreeItem key={`td-${i}`} connector={toolsConns[i]}>
							<fbox flexDirection="row" gap={8} alignItems="center">
								<ftext bold wrap={false}>
									{t.name}
								</ftext>
								<ftext color={TENUE} wrap={true}>
									{truncate(t.description, 60)}
								</ftext>
								<fbox flex={1} />
								<ftext color={TENUE} wrap={false}>
									{fmt(t.tokens)}
								</ftext>
							</fbox>
						</TreeItem>
					))}
					{toolsMore > 0 ? (
						<TreeItem connector="└">
							<ftext color={TENUE}>… y {toolsMore} más</ftext>
						</TreeItem>
					) : null}
				</Section>
			) : null}

			{/* Cerrar */}
			<fbox flexDirection="row" justifyContent="flex-end">
				<fbutton variant="secondary" onClick={onClose}>
					Cerrar
				</fbutton>
			</fbox>
		</fbox>
	);
}

function truncate(s: string, n: number): string {
	return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Sección con título (header distinguible: bold, sin conector). */
function Section({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}): ReactElement {
	return (
		<fbox flexDirection="column" gap={3}>
			<ftext bold>{title}</ftext>
			{children}
		</fbox>
	);
}

/** Item de lista con conector de árbol (├/└) indentado a la izquierda. Envuelve
 *  cualquier contenido (Row, ftext, fbox) y lo separa del header de la sección. */
function TreeItem({
	connector,
	children,
}: {
	connector: string;
	children: ReactNode;
}): ReactElement {
	return (
		<fbox flexDirection="row" gap={6} alignItems="flex-start">
			<ftext color={TENUE} wrap={false}>
				{INDENT}
				{connector}
			</ftext>
			<fbox flex={1} flexDirection="column">
				{children}
			</fbox>
		</fbox>
	);
}

/** Fila label · tokens (pct) [extra]. */
function Row({
	label,
	tokens,
	pct,
	color,
	extra,
}: {
	label: string;
	tokens: number;
	pct?: number;
	color?: string;
	extra?: string;
}): ReactElement {
	return (
		<fbox flexDirection="row" gap={8} alignItems="center">
			{color ? <ftext color={color}>■</ftext> : null}
			<ftext wrap={false}>{label}</ftext>
			{extra ? (
				<ftext color={TENUE} wrap={false}>
					{extra}
				</ftext>
			) : null}
			<fbox flex={1} />
			<ftext color={TENUE} wrap={false}>
				{fmt(tokens)}
				{pct != null ? ` (${pct}%)` : ""}
			</ftext>
		</fbox>
	);
}
