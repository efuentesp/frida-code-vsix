// ContextReport — UI del reporte /context (fase B, ADR-0015; rediseñado #124 bajo
// la dirección estética de DESIGN.md: estilo nativo Copilot Chat con Tree View).
//
// Se monta vía WebBridge.mountPersistent al ejecutar /context; se cierra con el
// botón (o al Compactar). Tags intrinsic de frida-webview (fbox/ftext/fbutton/ficon).
//
// Componentes clave:
//   - Resumen métrico y barra de progreso segmentada limpia con paleta de charts.
//   - Tree View jerárquico y colapsable (estilo VS Code Explorer / Test Explorer)
//     con chevrons vectoriales, iconos Codicon y alineación tabular a la derecha.
//   - Hover/Click interactivo cruzado entre la barra y las filas de categoría.

import { useState, type ReactElement, type ReactNode } from "react";
import type { ContextAnalysis } from "./analysis";

/** Paleta por categoría (variables charts de VS Code con fallbacks). */
const COLORS = {
	systemPrompt: "var(--vscode-charts-blue, #3794ff)",
	toolSnippets: "var(--vscode-charts-purple, #b180d7)",
	messages: "var(--vscode-charts-green, #89d185)",
	toolCalls: "var(--vscode-charts-orange, #d18616)",
	toolResults: "var(--vscode-charts-yellow, #cca700)",
	other: "var(--vscode-charts-red, #f14c4c)",
	free:
		"var(--vscode-editor-inactiveSelectionBackground, rgba(127, 127, 127, 0.25))",
} as const;

const TENUE = "var(--vscode-descriptionForeground)";

/** Formato numérico compacto (ej. 87.2k, 1.4M). */
function fmt(n: number): string {
	if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
	if (n >= 1000) return (n / 1000).toFixed(n >= 10_000 ? 0 : 1) + "k";
	return String(n);
}

/** Color del semáforo de presión por umbral (paridad con ContextBar). */
function pressureColor(pct: number | null): string {
	if (pct == null) return TENUE;
	if (pct >= 90) return "var(--vscode-errorForeground, #f14c4c)";
	if (pct >= 70) return "var(--vscode-list-warningForeground, #cca700)";
	return "var(--vscode-testing-iconPassed, #73c991)";
}

/** Acciones del reporte inyectadas por extension.ts. */
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

/** Un segmento de la barra de progreso. */
interface Seg {
	key: string;
	label: string;
	tokens: number;
	color: string;
}

function ContextReport({
	analysis,
	actions,
}: {
	analysis: ContextAnalysis;
	actions: ContextReportActions;
}): ReactElement {
	// Estado de secciones colapsadas del Tree View
	const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
		categories: false, // Uso por categoría (expandido por defecto)
		systemPrompt: false, // Composición del System prompt (expandido)
		instructionFiles: false, // Instruction files (expandido)
		skills: true, // Skills (colapsado)
		guidelines: true, // Guidelines (colapsado)
		toolSnippets: true, // Tool snippets (colapsado)
		tools: true, // Definición de herramientas (colapsado por defecto)
	});

	const toggle = (section: string) => {
		setCollapsed((prev) => ({ ...prev, [section]: !prev[section] }));
	};

	// Hover cruzado segmento ↔ fila de categoría + pin por click
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
	const pressure = s.pressurePercent ?? s.usagePercent ?? null;

	const segments: Seg[] = [
		{
			key: "sp",
			label: "System prompt",
			tokens: cat.systemPrompt,
			color: COLORS.systemPrompt,
		},
		{
			key: "ts",
			label: "Tool snippets",
			tokens: b.toolSnippets,
			color: COLORS.toolSnippets,
		},
		{ key: "msg", label: "Mensajes", tokens: messages, color: COLORS.messages },
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
			? [{ key: "ot", label: "Otros", tokens: cat.other, color: COLORS.other }]
			: []),
		{ key: "fs", label: "Espacio libre", tokens: free, color: COLORS.free },
	];
	const visibleSegments = segments.filter((seg) => seg.tokens > 0);

	const instructionTotal = b.instructionFiles.reduce((a, c) => a + c.tokens, 0);
	const skillsTotal = b.skills.reduce((a, c) => a + c.tokens, 0);

	const hotCls = (key: string) => (hot === key ? " is-hot" : "");

	return (
		<fbox
			flexDirection="column"
			gap={10}
			padding={12}
			cls={"ctxr" + (hot ? " is-dimming" : "")}
		>
			{/* 1. Header estilo Copilot Chat */}
			<fbox
				flexDirection="row"
				justifyContent="space-between"
				alignItems="center"
				cls="ctxr-header"
			>
				<fbox flexDirection="row" gap={6} alignItems="center">
					<ficon
						name="server"
						size={14}
						color="var(--vscode-textLink-foreground, #4daafc)"
					/>
					<ftext bold size={13}>
						Uso de Contexto
					</ftext>
					<ftext color={TENUE} size={12}>
						({s.modelName})
					</ftext>
				</fbox>
				<fbox flexDirection="row" gap={6} alignItems="center">
					<ftext
						bold
						size={12}
						color={pressureColor(pressure)}
						cls={pressure != null && pressure >= 70 ? "ctxr-pulse" : undefined}
					>
						● {pressure == null ? "?" : `${pressure}%`} presión
					</ftext>
				</fbox>
			</fbox>

			{/* 2. Barra de progreso segmentada limpia estilo VS Code */}
			<fbox flexDirection="column" gap={4}>
				<fbox flexDirection="row" cls="ctxr-bar" overflow="hidden" height={8}>
					{visibleSegments.map((seg) => (
						<fbox
							key={seg.key}
							flex={flexOf(seg.tokens)}
							background={seg.color}
							cls={"ctxr-seg" + hotCls(seg.key)}
							onMouseEnter={() => setHovered(seg.key)}
							onMouseLeave={() => setHovered(null)}
							onClick={() => setPinned((p) => (p === seg.key ? null : seg.key))}
							title={`${seg.label}: ${fmt(seg.tokens)} tokens (${pct(seg.tokens)}%)`}
						/>
					))}
				</fbox>
				<fbox
					flexDirection="row"
					justifyContent="space-between"
					alignItems="center"
				>
					<ftext size={11} color={TENUE}>
						{fmt(s.usedTokens)} de {cw ? fmt(cw) : "?"} tokens ({s.usagePercent ?? 0}
						%)
					</ftext>
					<ftext size={11} color={TENUE}>
						headroom: {s.headroomTokens == null ? "?" : fmt(s.headroomTokens)} ·{" "}
						{s.compacted ? "compactada" : "sin compactar"}
						{s.compactionEnabled ? ` (reserva ${fmt(s.reserveTokens)})` : ""}
					</ftext>
				</fbox>
			</fbox>

			{analysis.approximationNote ? (
				<fbox flexDirection="row" gap={6} alignItems="center">
					<ficon
						name="warning"
						size={13}
						color="var(--vscode-editorWarning-foreground, #cca700)"
					/>
					<ftext color="var(--vscode-editorWarning-foreground, #cca700)" size={11}>
						{analysis.approximationNote}
					</ftext>
				</fbox>
			) : null}

			{/* 3. Control Tree View Principal */}
			<fbox flexDirection="column" gap={6} cls="ctx-tree-container">
				{/* 3.1. Sección: Uso por categoría */}
				<TreeSection
					title="Uso por categoría"
					icon="chart-pie"
					expanded={!collapsed.categories}
					onToggle={() => toggle("categories")}
					badge={`${fmt(s.usedTokens)} usados`}
				>
					<TreeRow
						icon="copilot"
						swatchColor={COLORS.systemPrompt}
						label="System prompt"
						tokens={cat.systemPrompt}
						pct={pct(cat.systemPrompt)}
						isHot={hot === "sp"}
						onMouseEnter={() => setHovered("sp")}
						onMouseLeave={() => setHovered(null)}
						onClick={() => setPinned((p) => (p === "sp" ? null : "sp"))}
					/>
					<TreeRow
						icon="comment-discussion"
						swatchColor={COLORS.messages}
						label="Mensajes de usuario"
						tokens={cat.userMessages}
						pct={pct(cat.userMessages)}
						isHot={hot === "msg"}
						onMouseEnter={() => setHovered("msg")}
						onMouseLeave={() => setHovered(null)}
						onClick={() => setPinned((p) => (p === "msg" ? null : "msg"))}
					/>
					<TreeRow
						icon="bot"
						swatchColor={COLORS.messages}
						label="Mensajes del asistente"
						tokens={cat.assistantMessages}
						pct={pct(cat.assistantMessages)}
						isHot={hot === "msg"}
						onMouseEnter={() => setHovered("msg")}
						onMouseLeave={() => setHovered(null)}
						onClick={() => setPinned((p) => (p === "msg" ? null : "msg"))}
					/>
					<TreeRow
						icon="tools"
						swatchColor={COLORS.toolCalls}
						label="Tool calls (llamadas)"
						tokens={cat.toolCalls}
						pct={pct(cat.toolCalls)}
						isHot={hot === "tc"}
						onMouseEnter={() => setHovered("tc")}
						onMouseLeave={() => setHovered(null)}
						onClick={() => setPinned((p) => (p === "tc" ? null : "tc"))}
					/>
					<TreeRow
						icon="terminal"
						swatchColor={COLORS.toolResults}
						label="Tool results (resultados)"
						tokens={cat.toolResults}
						pct={pct(cat.toolResults)}
						isHot={hot === "tr"}
						onMouseEnter={() => setHovered("tr")}
						onMouseLeave={() => setHovered(null)}
						onClick={() => setPinned((p) => (p === "tr" ? null : "tr"))}
					/>
					{cat.other > 0 ? (
						<TreeRow
							icon="circle"
							swatchColor={COLORS.other}
							label="Otros mensajes"
							tokens={cat.other}
							pct={pct(cat.other)}
							isHot={hot === "ot"}
							onMouseEnter={() => setHovered("ot")}
							onMouseLeave={() => setHovered(null)}
							onClick={() => setPinned((p) => (p === "ot" ? null : "ot"))}
						/>
					) : null}
					<TreeRow
						icon="circle-outline"
						swatchColor={COLORS.free}
						label="Espacio libre"
						tokens={free}
						pct={pct(free)}
						isHot={hot === "fs"}
						onMouseEnter={() => setHovered("fs")}
						onMouseLeave={() => setHovered(null)}
						onClick={() => setPinned((p) => (p === "fs" ? null : "fs"))}
					/>
				</TreeSection>

				{/* 3.2. Sección: Composición del System Prompt */}
				<TreeSection
					title="Composición del System Prompt"
					icon="copilot"
					expanded={!collapsed.systemPrompt}
					onToggle={() => toggle("systemPrompt")}
					tokens={cat.systemPrompt}
					pct={pct(cat.systemPrompt)}
				>
					<TreeRow
						icon="package"
						label="Base (pi core)"
						tokens={b.base}
						pct={pct(b.base)}
					/>

					{/* Subsección: Archivos de instrucción */}
					{b.instructionFiles.length > 0 ? (
						<TreeSubSection
							title={`Archivos de instrucción (${b.instructionFiles.length})`}
							icon="file-text"
							expanded={!collapsed.instructionFiles}
							onToggle={() => toggle("instructionFiles")}
							tokens={instructionTotal}
						>
							{b.instructionFiles.map((f, i) => (
								<TreeRow
									key={`if-${i}`}
									level={1}
									icon="file-code"
									label={f.path}
									badge={f.origin}
									extra={`${f.lines}L`}
									tokens={f.tokens}
								/>
							))}
						</TreeSubSection>
					) : null}

					{/* Subsección: Skills */}
					{b.skills.length > 0 ? (
						<TreeSubSection
							title={`Skills habilitadas (${b.skills.length})`}
							icon="sparkle"
							expanded={!collapsed.skills}
							onToggle={() => toggle("skills")}
							tokens={skillsTotal}
						>
							{b.skills.map((sk, i) => (
								<TreeRow
									key={`sk-${i}`}
									level={1}
									icon="sparkles"
									label={sk.name}
									tokens={sk.tokens}
								/>
							))}
						</TreeSubSection>
					) : null}

					{/* Subsección: Directrices / Guidelines */}
					{b.guidelineSources.length > 0 ? (
						<TreeSubSection
							title={`Directrices / Guidelines (${b.guidelineBullets.length} reglas)`}
							icon="list-checks"
							expanded={!collapsed.guidelines}
							onToggle={() => toggle("guidelines")}
							tokens={b.guidelines}
						>
							{b.guidelineSources.map((g, i) => (
								<TreeRow
									key={`gs-${i}`}
									level={1}
									icon="checklist"
									label={g.source}
									extra={`${g.bulletCount} reglas`}
									tokens={g.tokens}
								/>
							))}
							{b.guidelineBullets.slice(0, 3).map((bl, i) => (
								<fbox
									key={`gb-${i}`}
									flexDirection="row"
									gap={6}
									paddingLeft={28}
									cls="ctx-tree-bullet-row"
								>
									<ftext color={TENUE} size={11} wrap={true}>
										• {bl}
									</ftext>
								</fbox>
							))}
						</TreeSubSection>
					) : null}

					{/* Subsección: Tool Snippets */}
					{b.toolSnippetDetails.length > 0 ? (
						<TreeSubSection
							title={`Tool Snippets (${b.toolSnippetDetails.length})`}
							icon="terminal"
							expanded={!collapsed.toolSnippets}
							onToggle={() => toggle("toolSnippets")}
							tokens={b.toolSnippets}
						>
							{b.toolSnippetDetails.map((ts, i) => (
								<TreeRow
									key={`ts-${i}`}
									level={1}
									icon="tools"
									label={ts.name}
									tokens={ts.tokens}
								/>
							))}
						</TreeSubSection>
					) : null}

					{b.appendText > 0 ? (
						<TreeRow icon="note" label="Append System Prompt" tokens={b.appendText} />
					) : null}
				</TreeSection>

				{/* 3.3. Sección: Definición de Herramientas (Tools) */}
				{td.count > 0 ? (
					<TreeSection
						title={`Definición de Herramientas (${td.count} activas)`}
						icon="tools"
						expanded={!collapsed.tools}
						onToggle={() => toggle("tools")}
						tokens={td.tokens}
					>
						{td.tools.map((t, i) => (
							<TreeRow
								key={`td-${i}`}
								icon="terminal"
								label={t.name}
								extra={truncate(t.description, 50)}
								tokens={t.tokens}
							/>
						))}
					</TreeSection>
				) : null}
			</fbox>

			{/* 4. Footer con acciones estilo Copilot */}
			<fbox
				flexDirection="row"
				justifyContent="flex-end"
				gap={8}
				cls="ctxr-footer"
			>
				{actions.onCompact && s.compactionEnabled ? (
					<fbutton
						variant="secondary"
						onClick={actions.onCompact}
						title="Compactar historial de la sesión para liberar espacio de contexto"
					>
						<ficon name="collapse-all" size={12} />
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

/** Encabezado de sección raíz colapsable estilo Tree View. */
function TreeSection({
	title,
	icon,
	expanded,
	onToggle,
	badge,
	tokens,
	pct,
	children,
}: {
	title: string;
	icon: string;
	expanded: boolean;
	onToggle: () => void;
	badge?: string;
	tokens?: number;
	pct?: number;
	children: ReactNode;
}): ReactElement {
	return (
		<fbox flexDirection="column" gap={1} cls="ctx-tree-section">
			<fbox
				flexDirection="row"
				alignItems="center"
				gap={6}
				cls="ctx-tree-section-header"
				onClick={onToggle}
			>
				<ficon
					name={expanded ? "chevron-down" : "chevron-right"}
					size={12}
					color={TENUE}
				/>
				<ficon
					name={icon}
					size={13}
					color="var(--vscode-textLink-foreground, #4daafc)"
				/>
				<ftext bold size={12}>
					{title}
				</ftext>
				{badge ? (
					<ftext size={11} color={TENUE}>
						({badge})
					</ftext>
				) : null}
				<fbox flex={1} />
				{tokens == null ? null : (
					<ftext size={11} color={TENUE} cls="ctx-tree-tokens" wrap={false}>
						{fmt(tokens)}
					</ftext>
				)}
				{pct == null ? null : (
					<ftext size={11} color={TENUE} cls="ctx-tree-pct" wrap={false}>
						({pct}%)
					</ftext>
				)}
			</fbox>
			{expanded ? (
				<fbox flexDirection="column" gap={1} cls="ctx-tree-branch">
					{children}
				</fbox>
			) : null}
		</fbox>
	);
}

/** Subsección colapsable anidada (nivel 1). */
function TreeSubSection({
	title,
	icon,
	expanded,
	onToggle,
	tokens,
	children,
}: {
	title: string;
	icon: string;
	expanded: boolean;
	onToggle: () => void;
	tokens?: number;
	children: ReactNode;
}): ReactElement {
	return (
		<fbox flexDirection="column" gap={1} paddingLeft={12}>
			<fbox
				flexDirection="row"
				alignItems="center"
				gap={6}
				cls="ctx-tree-row ctx-tree-subsec-header"
				onClick={onToggle}
			>
				<ficon
					name={expanded ? "chevron-down" : "chevron-right"}
					size={11}
					color={TENUE}
				/>
				<ficon name={icon} size={12} color={TENUE} />
				<ftext bold size={11.5}>
					{title}
				</ftext>
				<fbox flex={1} />
				{tokens == null ? null : (
					<ftext size={11} color={TENUE} cls="ctx-tree-tokens" wrap={false}>
						{fmt(tokens)}
					</ftext>
				)}
			</fbox>
			{expanded ? (
				<fbox flexDirection="column" gap={1}>
					{children}
				</fbox>
			) : null}
		</fbox>
	);
}

/** Fila individual de nodo hoja en el Tree View con alineación en columnas. */
function TreeRow({
	icon,
	swatchColor,
	label,
	badge,
	extra,
	tokens,
	pct,
	level = 0,
	isHot,
	onMouseEnter,
	onMouseLeave,
	onClick,
}: {
	icon?: string;
	swatchColor?: string;
	label: string;
	badge?: string;
	extra?: string;
	tokens?: number;
	pct?: number;
	level?: number;
	isHot?: boolean;
	onMouseEnter?: () => void;
	onMouseLeave?: () => void;
	onClick?: () => void;
}): ReactElement {
	return (
		<fbox
			flexDirection="row"
			alignItems="center"
			gap={6}
			paddingLeft={level === 1 ? 26 : 14}
			cls={`ctx-tree-row${isHot ? " is-hot" : ""}`}
			onMouseEnter={onMouseEnter}
			onMouseLeave={onMouseLeave}
			onClick={onClick}
		>
			{swatchColor ? (
				<ftext color={swatchColor} wrap={false} size={10}>
					■
				</ftext>
			) : null}
			{icon ? <ficon name={icon} size={12} color={TENUE} /> : null}
			<ftext size={11.5} wrap={false}>
				{label}
			</ftext>
			{badge ? (
				<ftext size={10} color={TENUE} cls="ctx-tree-badge" wrap={false}>
					[{badge}]
				</ftext>
			) : null}
			{extra ? (
				<ftext size={11} color={TENUE} wrap={false}>
					{extra}
				</ftext>
			) : null}
			<fbox flex={1} />
			{tokens == null ? null : (
				<ftext size={11} color={TENUE} cls="ctx-tree-tokens" wrap={false}>
					{fmt(tokens)}
				</ftext>
			)}
			{pct == null ? null : (
				<ftext size={11} color={TENUE} cls="ctx-tree-pct" wrap={false}>
					({pct}%)
				</ftext>
			)}
		</fbox>
	);
}
