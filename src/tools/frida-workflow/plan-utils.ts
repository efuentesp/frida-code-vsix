// plan-utils.ts — utilidades para analizar planes SDD, extraer fases y sugerir el siguiente paso.
import { readFileSync, existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export interface PlanPhaseInfo {
	id: string; // ej. "F10c.1"
	title: string; // ej. "Identidad jurídica, período, Policy y gates"
	fullName: string; // ej. "F10c.1 — Identidad jurídica..."
}

export interface NextStepSuggestion {
	planPath: string;
	currentPhase?: PlanPhaseInfo;
	nextPhase?: PlanPhaseInfo;
	phaseIndex: number;
	totalPhases: number;
	isPlanComplete: boolean;
	elaborateCommand?: string;
	shipCommand?: string;
}

/** Extrae las fases declaradas como encabezados `## F10c.N — Título` o `## Phase N: Título` de un plan Markdown. */
export function parsePlanPhases(planContent: string): PlanPhaseInfo[] {
	const phases: PlanPhaseInfo[] = [];
	// Soporta tanto `## F10c.1 — Titulo` como `## F01 - Titulo` o `## Phase 1: Titulo`
	const regex = /^##\s+(?:Phase\s+)?(F[\w.]+(?:\.\w+)?|\d+)\s*[—–\-:]\s*(.+)$/gm;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(planContent)) !== null) {
		const rawId = match[1]!.trim();
		const id = rawId.startsWith("F") ? rawId : `Phase ${rawId}`;
		const title = match[2]!.trim();
		phases.push({
			id,
			title,
			fullName: `${id} — ${title}`,
		});
	}
	return phases;
}

/** Limpia cualquier envoltorio de comillas o escapes de un string de entrada. */
export function sanitizeInput(input: string): string {
	let s = input.trim();
	// Quita comillas envolventes simples, dobles o escapadas
	while (
		(s.startsWith('"') && s.endsWith('"')) ||
		(s.startsWith("'") && s.endsWith("'")) ||
		(s.startsWith('\\"') && s.endsWith('\\"'))
	) {
		if (s.startsWith('\\"') && s.endsWith('\\"')) {
			s = s.slice(2, -2).trim();
		} else {
			s = s.slice(1, -1).trim();
		}
	}
	return s;
}

/** #154 — Etapa mínima estructural para contar validates fallidos (sin importar
 * el tipo completo de StageView: mantiene el helper puro y testeable). */
export interface StageLike {
	name: string;
	status: string;
	data?: unknown;
}

/** #154 — Cuenta validates FAIL consecutivos al final de la secuencia de etapas.
 *
 * El corte del circuit breaker ocurre justo después de un validate fallido que
 * es la última etapa del run. Caminamos hacia atrás tolerando `implement`
 * intercalado; cualquier validate pasado (o sin verdict) u otra etapa corta el
 * conteo. Robusto ante grafos con más etapas previas (p. ej. elaborate) — a
 * diferencia de la heurística anterior `stages.length >= 6`, que se desincroniza
 * cada vez que cambia la forma del workflow.
 */
export function countTrailingFailedValidates(stages: StageLike[]): number {
	let count = 0;
	for (let i = stages.length - 1; i >= 0; i--) {
		const s = stages[i]!;
		if (s.name === "implement") continue; // interludio del ciclo — seguir atrás
		if (s.name === "validate" && s.status === "completed") {
			const passed = (s.data as { passed?: boolean } | undefined)?.passed;
			if (passed === false) {
				count++;
				continue;
			}
		}
		break; // validate pasado/running, u otra etapa: fin del tramo fallido
	}
	return count;
}

/** Resuelve la fase actual y calcula el siguiente paso sugerido a partir del input y el plan. */
export function resolveNextStep(
	input: string,
	cwd: string = process.cwd(),
): NextStepSuggestion | null {
	if (!input) return null;
	const cleanInput = sanitizeInput(input);
	const tokens = cleanInput.split(/\s+/);
	const planPathToken = sanitizeInput(tokens[0] ?? "");
	if (!planPathToken || !planPathToken.includes(".md")) return null;

	const fullPlanPath = isAbsolute(planPathToken)
		? planPathToken
		: join(cwd, planPathToken);

	if (!existsSync(fullPlanPath)) return null;

	try {
		const content = readFileSync(fullPlanPath, "utf8");
		const phases = parsePlanPhases(content);
		if (phases.length === 0) return null;

		// Detectar fase actual del input (ej. "Phase F10c.2" o "F10c.2")
		const phaseMatch = cleanInput.match(/(?:Phase\s+)?(F[\w.]+(?:\.\w+)?|\d+)/i);
		const currentPhaseId = phaseMatch ? phaseMatch[1] : undefined;

		let currentIndex = 0;
		if (currentPhaseId) {
			const idx = phases.findIndex(
				(p) =>
					p.id.toLowerCase() === currentPhaseId.toLowerCase() ||
					p.id.toLowerCase().replace(/^phase\s+/i, "") ===
						currentPhaseId.toLowerCase(),
			);
			if (idx >= 0) currentIndex = idx;
		}

		const currentPhase = phases[currentIndex];
		const nextIndex = currentIndex + 1;
		const nextPhase = phases[nextIndex];
		const isPlanComplete = nextIndex >= phases.length;

		return {
			planPath: planPathToken,
			currentPhase,
			nextPhase,
			phaseIndex: currentIndex + 1,
			totalPhases: phases.length,
			isPlanComplete,
			elaborateCommand: nextPhase
				? `/skill:elaborate ${planPathToken} Phase ${nextPhase.id}`
				: undefined,
			shipCommand: nextPhase
				? `/wf sdd-ship "${planPathToken} Phase ${nextPhase.id}"`
				: undefined,
		};
	} catch {
		return null;
	}
}
