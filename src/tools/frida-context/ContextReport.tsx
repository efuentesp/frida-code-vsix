// ContextReport — UI rica del reporte /context (fase B, ADR-0015). Reemplaza al
// `notice` de texto plano por un panel Remote React overlay: barra segmentada
// (estilo Claude Code) + leyenda coloreada + métricas. Se monta vía
// WebBridge.mountPersistent al ejecutar /context; se cierra con el botón (onClose →
// unmount) o se reemplaza al re-ejecutar el comando.
//
// Tags intrinsic de frida-webview (fbox con background/height para los segmentos).

import type { ReactElement } from "react";
import type { ContextAnalysis } from "./analysis";

/** Paleta por categoría (variables charts de VS Code → consistente con el tema). */
const COLORS = {
	systemPrompt: "var(--vscode-charts-blue)",
	toolSnippets: "var(--vscode-charts-purple)",
	messages: "var(--vscode-charts-green)",
	toolCalls: "var(--vscode-charts-orange)",
	toolResults: "var(--vscode-charts-yellow)",
	other: "var(--vscode-charts-red)",
	free: "var(--vscode-editor-inactiveSelectionBackground, rgba(127,127,127,0.3))",
} as const;

function fmt(n: number): string {
	if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
	if (n >= 1000) return (n / 1000).toFixed(n >= 10_000 ? 0 : 1) + "k";
	return String(n);
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
	const cw = s.contextWindow ?? 0;
	const used = s.usedTokens;
	const messages = cat.userMessages + cat.assistantMessages;
	const free = Math.max(0, cw - used);

	// Segmentos de la barra, en orden. flex proporcional a tokens (escala /100 para
	// estabilidad del layout; el navegador normaliza las proporciones).
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
	const pct = (t: number) => (cw > 0 ? Math.round((t / cw) * 100) : 0);
	const flexOf = (t: number) => Math.max(1, Math.round(t / 100));

	return (
		<fbox flexDirection="column" gap={10} padding={12} bordered>
			{/* Header */}
			<fbox flexDirection="row" gap={6} alignItems="center">
				<ftext bold>Context Usage</ftext>
				<ftext color="var(--vscode-descriptionForeground)">
					· {s.modelName} · {fmt(used)}/{cw ? fmt(cw) : "?"} tokens (
					{s.usagePercent ?? 0}%)
				</ftext>
			</fbox>

			{/* Barra segmentada: el contextWindow completo, dividido por categoría.
			    overflow:hidden recorta los segmentos al radius; los segmentos definen
			    la altura (el contenedor NO lleva height → el borde se ve completo). */}
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

			{/* Métricas clave */}
			<fbox flexDirection="row" gap={10} alignItems="center">
				{s.pressurePercent != null ? (
					<ftext color="var(--vscode-charts-red)">
						presión {s.pressurePercent}%
					</ftext>
				) : null}
				{s.headroomTokens != null ? (
					<ftext color="var(--vscode-descriptionForeground)">
						headroom {fmt(s.headroomTokens)}
					</ftext>
				) : null}
				<ftext color="var(--vscode-descriptionForeground)">
					{s.compacted ? "compactada" : "sin compactar"}
					{s.compactionEnabled ? " · compaction on" : " · compaction off"}
					{s.compactionEnabled ? ` (reserve ${fmt(s.reserveTokens)})` : ""}
				</ftext>
			</fbox>
			{analysis.approximationNote ? (
				<ftext color="var(--vscode-editorWarning-foreground)">
					⚠ {analysis.approximationNote}
				</ftext>
			) : null}

			{/* Leyenda: cada categoría con color + tokens + %. */}
			<fbox flexDirection="column" gap={4}>
				{visible.map((seg, i) => (
					<fbox
						key={`lg-${seg.label}-${i}`}
						flexDirection="row"
						gap={8}
						alignItems="center"
					>
						<ftext color={seg.color}>■</ftext>
						<ftext wrap={false}>{seg.label}</ftext>
						<ftext color="var(--vscode-descriptionForeground)">
							{fmt(seg.tokens)} ({pct(seg.tokens)}%)
						</ftext>
					</fbox>
				))}
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
