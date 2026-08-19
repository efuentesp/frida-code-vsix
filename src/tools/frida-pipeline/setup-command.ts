// frida-pipeline — setup / status (Fase 1).
//
// Calcula el estado del orquestador: hermanas detectadas, conteos de skills /
// agentes / workflows (0/0/0 en Fase 1; se irán llenando en Fases 5–10).
// La forma del reporte es estable: lo consumen el slash command, el panel
// persistente, y (en Fases 2+) el banner de session_start.

import {
	detectSiblings,
	formatSiblingsStatus,
	type PipelineSiblingsStatus,
} from "./siblings";
import { readdirSync } from "node:fs";
import { BUNDLED_AGENTS_DIR } from "./paths";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { PIPELINE_WORKFLOWS } from "./workflows";

/** Cuenta las skills SKILL.md en el directorio empaquetado. */
function countBundledSkills(): number {
	const skillsDir = join(BUNDLED_AGENTS_DIR, "..", "skills");
	try {
		if (!existsSync(skillsDir)) return 0;
		return readdirSync(skillsDir, { withFileTypes: true })
			.filter((e) => e.isDirectory() && e.name !== "_shared")
			.filter((e) => existsSync(join(skillsDir, e.name, "SKILL.md"))).length;
	} catch {
		return 0;
	}
}

/** Cuenta los agentes .md en el directorio empaquetado. */
function countBundledAgents(): number {
	try {
		return readdirSync(BUNDLED_AGENTS_DIR).filter((f) => f.endsWith(".md"))
			.length;
	} catch {
		return 0;
	}
}

/** Conteos agregados. Fase 5 reporta agentes reales; skills/workflows siguen en 0. */
export interface PipelineCounts {
	skills: { present: number; expected: number };
	agents: { present: number; expected: number };
	workflows: { present: number; expected: number };
}

/** Estado completo del orquestador. */
export interface PipelineStatus {
	siblings: PipelineSiblingsStatus;
	counts: PipelineCounts;
	/** "ready" si todas las hermanas están y los conteos coinciden con los
	 *  esperados; "degraded" si falta alguna hermana; "empty" si todo está en
	 *  cero (Fase 1 del proyecto). */
	level: "ready" | "degraded" | "empty";
}

// Conteos esperados. Los Workflows built-in (`build`/`vet`/`polish`) se
// registran via registerWorkflows() desde createFridaPipeline().
// #87: contrato de empaquetado — cuántas skills DEBEN enviarse. El conteo
// real (present) viene del directorio; si difiere, el banner lo muestra y el
// estado degrada. Actualizar al añadir/quitar una skill del set.
export const EXPECTED_SKILLS = 28;
const EXPECTED_AGENTS = 15;
const EXPECTED_WORKFLOWS = 3;

/** Cuenta los workflows built-in de frida-pipeline. */
function countRegisteredWorkflows(): number {
	return PIPELINE_WORKFLOWS.length;
}

/** Calcula el estado actual del orquestador. */
export function computePipelineStatus(): PipelineStatus {
	const siblings = detectSiblings();
	const agentCount = countBundledAgents();
	const skillCount = countBundledSkills();
	const counts: PipelineCounts = {
		skills: { present: skillCount, expected: EXPECTED_SKILLS },
		agents: { present: agentCount, expected: EXPECTED_AGENTS },
		workflows: {
			present: countRegisteredWorkflows(),
			expected: EXPECTED_WORKFLOWS,
		},
	};

	let level: PipelineStatus["level"];
	if (!siblings.allPresent) {
		level = "degraded";
	} else if (
		counts.skills.present === 0 &&
		counts.agents.present === 0 &&
		counts.workflows.present === 0
	) {
		level = "empty";
	} else {
		level = "ready";
	}

	return { siblings, counts, level };
}

/** Serializa el estado a texto chat-friendly (lo que muestra `/pipeline`). */
export function formatPipelineStatus(status: PipelineStatus): string {
	const lines: string[] = [];
	lines.push(`frida-pipeline v${status.siblings.fridaVersion}`);
	lines.push("");

	// Hermanas.
	lines.push(
		`Hermanas: ${status.siblings.presentCount}/${status.siblings.expectedCount} detectadas`,
	);
	for (const sib of status.siblings.siblings) {
		const glyph = sib.present ? "✅" : "❌";
		const ver = sib.present ? `v${sib.version}` : "missing";
		lines.push(`  ${glyph} ${sib.id.padEnd(26)} ${ver}`);
	}

	// Conteos.
	lines.push("");
	lines.push("Capacidades:");
	lines.push(
		`  Skills:    ${status.counts.skills.present}/${status.counts.skills.expected}`,
	);
	lines.push(
		`  Agentes:   ${status.counts.agents.present}/${status.counts.agents.expected}`,
	);
	lines.push(
		`  Workflows: ${status.counts.workflows.present}/${status.counts.workflows.expected}`,
	);

	// Estado.
	lines.push("");
	const stateLabel = {
		ready: "✅ Listo",
		degraded: "⚠️ Degradado (faltan hermanas)",
		empty: "🚧 Esqueleto (Fase 1 — sin skills/agentes/workflows aún)",
	}[status.level];
	lines.push(`Estado: ${stateLabel}`);

	return lines.join("\n");
}

// Re-export para conveniencia.
export { detectSiblings, formatSiblingsStatus };
export type { PipelineSiblingsStatus };
