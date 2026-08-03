// Metadata de prompt por tool (porte de supi-web).
//
// Construye la superficie de prompt (descripción + snippet + guidelines) desde
// el catálogo compartido, añadiendo guidance runtime cuando es útil (p.ej. usar
// `gh` CLI para URLs de GitHub si está instalado).

import { spawnSync } from "node:child_process";
import {
	getWebToolSpec,
	WEB_FETCH_MD_TOOL_NAME,
	type WebToolName,
} from "./tool-specs";

/** Metadata de prompt enviada a pi para un tool web. */
export interface WebToolPromptSurface {
	description: string;
	promptSnippet: string;
	promptGuidelines: string[];
}

/** Construye la metadata de prompt desde el catálogo, añadiendo guidance runtime cuando aplica. */
export function getWebToolPromptSurface(
	name: WebToolName,
): WebToolPromptSurface {
	const spec = getWebToolSpec(name);
	const promptGuidelines = [...spec.promptGuidelines];

	if (name === WEB_FETCH_MD_TOOL_NAME && isGhAvailable()) {
		promptGuidelines.push(
			"Use `gh` CLI instead of web_fetch_md for GitHub URLs.",
		);
	}

	return {
		description: spec.description,
		promptSnippet: spec.promptSnippet,
		promptGuidelines,
	};
}

function isGhAvailable(): boolean {
	try {
		const result = spawnSync("gh", ["--version"], { stdio: "ignore" });
		return result.status === 0;
	} catch {
		return false;
	}
}
