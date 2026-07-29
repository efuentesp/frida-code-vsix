// Inferencia de la composición del system prompt (ADR-0015, paridad supi-context).
//
// supi-context parsea el systemPrompt para derivar skills/contextFiles/guidelines
// como FALLBACK cuando no hay BuildSystemPromptOptions. En frida SIEMPRE cacheamos
// options en before_agent_start, así que usamos options directo para skills y
// contextFiles. Sólo parseamos la sección "Guidelines:" (sus bullets) porque las
// options traen `promptGuidelines` (los de extensiones/tools) PERO no los defaults
// del core ("Be concise", "Show file paths") ni la atribución por fuente —esos
// sólo salen del texto final.

import { dirname, resolve } from "node:path";

/** Des-escapa entidades XML (las skills del system prompt vienen escapadas). */
function unescapeXml(text: string): string {
	return text
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, "&");
}

// Re-export para que analysis/prompt-inference compartan la misma noción.
export { unescapeXml };

/** Extrae la sección "Guidelines:" del system prompt (texto final armado). */
export function extractGuidelinesSection(systemPrompt: string): string | null {
	const marker = "\nGuidelines:\n";
	const start = systemPrompt.indexOf(marker);
	if (start < 0) return null;
	const afterStart = start + marker.length;
	const endMarkers = [
		"\n\nPi documentation",
		"\n\n# Project Context",
		"\n\n<project_context>",
		"\nCurrent date: ",
		"\nCurrent working directory: ",
	];
	let end = systemPrompt.length;
	for (const endMarker of endMarkers) {
		const index = systemPrompt.indexOf(endMarker, afterStart);
		if (index >= 0) end = Math.min(end, index);
	}
	const section = systemPrompt.slice(afterStart, end).trim();
	return section.length > 0 ? section : null;
}

/** Bullets ("- ...") de la sección Guidelines. */
export function extractGuidelineBullets(
	guidelinesText: string | null,
): string[] {
	if (!guidelinesText) return [];
	return guidelinesText
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.startsWith("- "))
		.map((line) => line.slice(2).trim());
}

/** Textos conocidos de las guidelines DEFAULT del core de pi. */
const DEFAULT_GUIDELINE_TEXTS = new Set([
	"Use bash for file operations like ls, rg, find",
	"Prefer grep/find/ls tools over bash for file exploration (faster, respects .gitignore)",
	"Be concise in your responses",
	"Show file paths clearly when working with files",
]);

/** promptGuidelines conocidos de los tools built-in (hardcodeados en read/write/edit). */
const BUILTIN_TOOL_GUIDELINES: Record<string, string[]> = {
	read: ["Use read to examine files instead of cat or sed."],
	write: ["Use write only for new files or complete rewrites."],
	edit: [
		"Use edit for precise changes (edits[].oldText must match exactly)",
		"When changing multiple separate locations in one file, use one edit call with multiple entries in edits[] instead of multiple edit calls",
		"Each edits[].oldText is matched against the original file, not after earlier edits are applied. Do not emit overlapping or nested edits. Merge nearby changes into one edit.",
		"Keep edits[].oldText as small as possible while still being unique in the file. Do not pad with large unchanged regions.",
	],
};

function buildGuidelineToToolMap(): Map<string, string> {
	const map = new Map<string, string>();
	for (const [tool, guidelines] of Object.entries(BUILTIN_TOOL_GUIDELINES)) {
		for (const g of guidelines) map.set(g, tool);
	}
	return map;
}
const GUIDELINE_TO_TOOL = buildGuidelineToToolMap();

export interface GuidelineSourceInfo {
	source: string; // "default" | tool name | "extensions" | "other"
	tokens: number;
	bulletCount: number;
}

/** Clasifica los bullets por fuente (default/tool built-in/extensions/other). */
export function classifyGuidelines(
	bullets: string[],
	activeToolNames: string[],
): GuidelineSourceInfo[] {
	// Las extensions aportan promptGuidelines; los tools built-in los conocemos arriba.
	// El resto (no default, no built-in conocido) → "extensions" si el tool está activo.
	const activeBuiltins = new Set(
		activeToolNames.filter((t) => t in BUILTIN_TOOL_GUIDELINES),
	);
	const sources = new Map<string, { chars: number; count: number }>();
	const ensure = (s: string) => {
		let e = sources.get(s);
		if (!e) {
			e = { chars: 0, count: 0 };
			sources.set(s, e);
		}
		return e;
	};

	for (const bullet of bullets) {
		let source: string;
		if (DEFAULT_GUIDELINE_TEXTS.has(bullet)) {
			source = "default";
		} else {
			const toolName = GUIDELINE_TO_TOOL.get(bullet);
			if (toolName && activeBuiltins.has(toolName)) {
				source = toolName;
			} else {
				source = "extensions";
			}
		}
		const e = ensure(source);
		e.chars += bullet.length;
		e.count += 1;
	}

	return Array.from(sources.entries())
		.map(([source, { chars, count }]) => ({
			source,
			tokens: Math.ceil(chars / 4),
			bulletCount: count,
		}))
		.sort((a, b) => {
			if (a.source === "default") return -1;
			if (b.source === "default") return 1;
			if (a.source === "extensions") return 1;
			if (b.source === "extensions") return -1;
			return a.source.localeCompare(b.source);
		});
}

/** ¿El path cae dentro del cwd (project) o fuera (global)? */
export function determineOrigin(
	filePath: string,
	cwd: string,
): "global" | "project" {
	const resolvedPath = resolve(cwd, filePath);
	const fileDir = dirname(resolvedPath);
	let current = resolve(cwd);
	const root = resolve("/");
	while (true) {
		if (fileDir === current) return "project";
		if (current === root) break;
		const parent = resolve(current, "..");
		if (parent === current) break;
		current = parent;
	}
	return "global";
}
