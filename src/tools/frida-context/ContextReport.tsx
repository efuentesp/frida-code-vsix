// ContextReport — UI del reporte /context (fase B, ADR-0015; rediseño #124 bajo
// la dirección estética de DESIGN.md: instrumento técnico denso). Paridad de
// datos con supi-context; el render evoluciona a dos columnas densas con
// barra-instrumento interactiva. Se monta vía WebBridge.mountPersistent al
// ejecutar /context; se cierra con el botón (Compactar también lo cierra).
//
// Tags intrinsic de frida-webview (fbox/ftext/fbutton).
//
// Interacción (el diferenciador): hover en un segmento de la barra resalta su
// fila de leyenda y atenúa el resto (y viceversa); click fija (pin) el
// resaltado. El estado vive aquí con useState — el renderer remoto soporta
// hooks (precedente: CollapsiblePanel). El atenuado en sí lo resuelve CSS
// (.ctxr.is-dimming → :not(.is-hot)) para que el fade sea una transición del
// navegador y no un re-render por frame.
//
// Las listas usan conectores de árbol (├ intermedio, └ último) con indentación,
// para distinguir el header de la sección (en bold, sin conector) de los items.

import { useState, type ReactElement, type ReactNode } from "react";
import type { ContextAnalysis } from "./analysis";

/** Paleta por categoría (variables charts de VS Code). */
const COLORS = {
	systemPrompt: "var(--vscode-charts-blue)",
	toolSnippets: "var(--vscode-charts-purple)",
	messages: "var(--vscode-charts-green)",
	toolCalls: "var(--vscode-charts-orange)",
	toolResults: "var(--vscode-charts-yellow)",
	other: "var(--vscode-charts-red)",
} as const;
const TENUE = "var(--vscode-descriptionForeground)";
/** Indent de los items respecto al header (nbsp para preservarlo siempre). */
const INDENT = "\u00A0\u00A0";

/** Color del % de presión por umbral (paridad con ContextBar del footer). */
function pressureColor(pct: number | null): string {
	if (pct == null) return TENUE;
	if (pct >= 90) return "var(--vscode-errorForeground, #f14c4c)";
	if (pct >= 70) return "var(--vscode-editorWarning-foreground, #cca700)";
	return "var(--vscode-charts-green, #3fb950)";
}

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

/** Acciones del reporte: las inyecta extension.ts al crear el elemento. */
export interface ContextReportActions {
	/** Cierra el reporte (unmount del root persistente). */
	onClose: () => void;
	/** Dispara la compactación manual (compactContext) y cierra el reporte. */
	onCompact?: () => void;
}

export function createContextReportElement(
	analysis: ContextAnalysis,
	actions: ContextReportActions,
): ReactElement {
	return <ContextReport analysis={analysis} actions={actions} />;
}

/** Un segmento de la barra-instrumento. `color` ausente = hatch CSS (free). */
interface Seg {
	key: string;
	label: string;
	tokens: number;
	color?: string;
}

/** Fila de leyenda de "Uso por categoría" con su segmento vinculado (link). */
interface LegendRow {
	key: string;
	label: string;
	tokens: number;
	color?: string;
	/** Key del segmento al que se vincula el hover (user/assistant → "msg"). */
	link: string;
}

function ContextReport({
	analysis,
	actions,
}: {
	analysis: ContextAnalysis;
	actions: ContextReportActions;
}): ReactElement {
	// Hover cruzado segmento↔fila + pin por click. `hot` = lo que manda ahora.
	const [hovered, setHovered] = useState<string | null>(null);
	const [pinned, setPinned] = useState<string | null>(null);
	const hot = hovered ?? pinned;

	const s = analysis.snapshot;
	const cat = analysis.categories;
	const b = analysis.systemPromptBreakdown;
	const td = analysis.toolDefinitions;
	const cw = s.contextWindow ?? 0;
	const messages = cat.userMessages + cat.assistantMessages;
	const free = Math.max(0, cw - s.usedTokens);
	const pct = (t: number) => (cw > 0 ? Math.round((t / cw) * 100) : 0);
	const flexOf = (t: number) => Math.max(1, Math.round(t / 100));
	// Presión accionable (ajustada por reserve); fallback al % bruto.
	const pressure = s.pressurePercent ?? s.usagePercent ?? null;

	const segments: Seg[] = [
		{ key: "sp", label: "System prompt", tokens: cat.systemPrompt, color: COLORS.systemPrompt },
		{ key: "ts", label: "Tool snippets", tokens: b.toolSnippets, color: COLORS.toolSnippets },
		{ key: "msg", label: "Messages", tokens: messages, color: COLORS.messages },
		{ key: "tc", label: "Tool calls", tokens: cat.toolCalls, color: COLORS.toolCalls },
		{ key: "tr", label: "Tool results", tokens: cat.toolResults, color: COLORS.toolResults },
		...(cat.other > 0
			? [{ key: "ot", label: "Otros", tokens: cat.other, color: COLORS.other }]
			: []),
		// Free: sin color prop — el hatch lo pinta CSS (.ctxr-seg--free).
		{ key: "fs", label: "Free space", tokens: free },
	];
	const visible = segments.filter((seg) => seg.tokens > 0);

	const legendRows: LegendRow[] = [
		{ key: "sp", label: "System prompt", tokens: cat.systemPrompt, color: COLORS.systemPrompt, link: "sp" },
		{ key: "um", label: "User messages", tokens: cat.userMessages, color: COLORS.messages, link: "msg" },
		{ key: "am", label: "Assistant messages", tokens: cat.assistantMessages, color: COLORS.messages, link: "msg" },
		{ key: "tc", label: "Tool calls", tokens: cat.toolCalls, color: COLORS.toolCalls, link: "tc" },
		{ key: "tr", label: "Tool results", tokens: cat.toolResults, color: COLORS.toolResults, link: "tr" },
		...(cat.other > 0
			? [{ key: "ot", label: "Otros", tokens: cat.other, color: COLORS.other, link: "ot" }]
			: []),
		{ key: "fs", label: "Free space", tokens: free, link: "fs" },
	];

	const instructionTotal = b.instructionFiles.reduce((a, c) => a + c.tokens, 0);
	const skillsTotal = b.skills.reduce((a, c) => a + c.tokens, 0);

	// Composición del system prompt (columna derecha).
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
		{ key: "sk", label: `Skills (${b.skills.length})`, tokens: skillsTotal },
		{ key: "gl", label: "Guidelines", tokens: b.guidelines },
		{ key: "ts", label: `Tool snippets (${b.toolSnippetDetails.length})`, tokens: b.toolSnippets },
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
	const compConns = treeConnectors(compItems.length);
	const ifConns = treeConnectors(b.instructionFiles.length);
	const legendConns = treeConnectors(legendRows.length);
	const bulletsShown = b.guidelineBullets.slice(0, 3);
	const bulletsMore = b.guidelineBullets.length - 3;
	const bulletsConns = treeConnectors(bulletsShown.length, bulletsMore > 0);

	/** Clases del elemento interactivo: is-hot cuando su key es la activa. */
	const hotCls = (key: string) => (hot === key ? " is-hot" : "");

	return (
		<fbox
			flexDirection="column"
			gap={12}
			padding={14}
			cls={"ctxr" + (hot ? " is-dimming" : "")}
		>
			{/* Header */}
			<fbox
				flexDirection="row"
				justifyContent="space-between"
				alignItems="center"
			>
				<ftext bold cls="ctxr-title" wrap={false}>
					Context Usage
				</ftext>
				<ftext color={TENUE} wrap={false}>
					{s.modelName}
				</ftext>
			</fbox>

			{/* Hero: presión grande + uso */}
			<fbox flexDirection="row" alignItems="flex-end" gap={12}>
				<fbox flexDirection="column" gap={1} alignItems="flex-start">
					<fbox flexDirection="row" alignItems="baseline" gap={1}>
						<ftext
							bold
							size={30}
							color={pressureColor(pressure)}
							cls={"ctxr-pressure" + (pressure != null && pressure >= 70 ? " ctxr-pulse" : "")}
							wrap={false}
						>
							{pressure == null ? "?" : String(pressure)}
						</ftext>
						<ftext size={12} color={pressureColor(pressure)} wrap={false}>
							%
						</ftext>
					</fbox>
					<ftext color={TENUE} size={10} wrap={false}>
						presión
					</ftext>
				</fbox>
				<fbox flexDirection="column" gap={2} flex={1}>
					<ftext bold wrap={false}>
						{fmt(s.usedTokens)} / {cw ? fmt(cw) : "?"} tokens
						{s.usagePercent == null ? "" : ` (${s.usagePercent}%)`}
					</ftext>
					<ftext color={TENUE} wrap={false}>
						{s.headroomTokens == null ? "headroom ?" : `headroom ${fmt(s.headroomTokens)}`}
						{" · "}
						{s.compacted ? "compactada" : "sin compactar"}
						{" · compaction "}
						{s.compactionEnabled ? "on" : "off"}
						{s.compactionEnabled ? ` (reserve ${fmt(s.reserveTokens)})` : ""}
					</ftext>
				</fbox>
			</fbox>

			{/* Barra-instrumento: segmentos con hover cruzado + pin por click */}
			<fbox flexDirection="row" cls="ctxr-bar" overflow="hidden" height={22}>
				{visible.map((seg) => (
					<fbox
						key={seg.key}
						flex={flexOf(seg.tokens)}
						background={seg.color}
						cls={
							"ctxr-seg" +
							(seg.color ? "" : " ctxr-seg--free") +
							hotCls(seg.key)
						}
						onMouseEnter={() => setHovered(seg.key)}
						onMouseLeave={() => setHovered(null)}
						onClick={() =>
							setPinned((p) => (p === seg.key ? null : seg.key))
						}
						title={`${seg.label} · ${fmt(seg.tokens)} · ${pct(seg.tokens)}%`}
					/>
				))}
			</fbox>
			{analysis.approximationNote ? (
				<ftext color="var(--vscode-editorWarning-foreground)" wrap={true}>
					⚠ {analysis.approximationNote}
				</ftext>
			) : null}

			{/* Dos columnas densas (colapsan a una en panel angosto vía CSS wrap) */}
			<fbox flexDirection="row" cls="ctxr-cols" gap={16}>
				{/* Columna izquierda: conversación */}
				<fbox flexDirection="column" cls="ctxr-col" gap={12}>
					<Section title="Uso por categoría">
						{legendRows.map((it, i) => (
							<fbox
								key={it.key}
								flexDirection="row"
								gap={6}
								alignItems="center"
								cls={"ctxr-row" + hotCls(it.link)}
								onMouseEnter={() => setHovered(it.link)}
								onMouseLeave={() => setHovered(null)}
								onClick={() =>
									setPinned((p) => (p === it.link ? null : it.link))
								}
							>
								<ftext color={TENUE} wrap={false}>
									{INDENT}
									{legendConns[i]}
								</ftext>
								{it.color ? <ftext color={it.color}>■</ftext> : null}
								<ftext wrap={false}>{it.label}</ftext>
								<fbox flex={1} />
								<ftext color={TENUE} wrap={false}>
									{fmt(it.tokens)} ({pct(it.tokens)}%)
								</ftext>
							</fbox>
						))}
					</Section>

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
							{bulletsShown.map((bl, i) => (
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
				</fbox>

				{/* Columna derecha: system prompt */}
				<fbox flexDirection="column" cls="ctxr-col" gap={12}>
					<Section
						title={`System prompt · ${fmt(cat.systemPrompt)} tokens`}
					>
						{compItems.map((it, i) => (
							<TreeItem key={it.key} connector={compConns[i]}>
								<Row label={it.label} tokens={it.tokens} pct={pct(it.tokens)} />
							</TreeItem>
						))}
					</Section>

					{b.instructionFiles.length > 0 ? (
						<Section title="Instruction files (AGENTS.md / CLAUDE.md)">
							{b.instructionFiles.map((f, i) => (
								<TreeItem key={`if-${i}`} connector={ifConns[i]}>
									<Row
										label={`${f.path} · ${f.origin}`}
										tokens={f.tokens}
										extra={`${f.lines}L`}
									/>
								</TreeItem>
							))}
						</Section>
					) : null}

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
				</fbox>
			</fbox>

			{/* Footer */}
			<fbox flexDirection="row" justifyContent="flex-end" gap={8}>
				{actions.onCompact && s.compactionEnabled ? (
					<fbutton
						variant="secondary"
						onClick={actions.onCompact}
						title="Compacta el historial de la sesión (resume el contexto)"
					>
						Compactar
					</fbutton>
				) : null}
				<fbutton variant="secondary" onClick={actions.onClose}>
					Cerrar
				</fbutton>
			</fbox>
		</fbox>
	);
}

function truncate(s: string, n: number): string {
	return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Sección con título (header distinguible: bold + mayúsculas vía CSS). */
function Section({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}): ReactElement {
	return (
		<fbox flexDirection="column" gap={3}>
			<ftext bold cls="ctxr-sec">
				{title}
			</ftext>
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
				{pct == null ? "" : ` (${pct}%)`}
			</ftext>
		</fbox>
	);
}
