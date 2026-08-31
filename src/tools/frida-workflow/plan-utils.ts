// plan-utils.ts — utilidades para analizar planes SDD, extraer fases y sugerir el siguiente paso.
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";

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
	/** #158 — ids (normalizados) de fases con commit registrado en el progreso. */
	completedPhases: string[];
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

/** #158 — Normaliza un id de fase para comparar: "F10c.3" ≡ "f10c-3" ≡ "f10c_3" ≡ "F10C.3".
 *  Todos los separadores (espacios, puntos, guiones, bajos) fuera + lowercase. */
export function normalizePhaseId(id: string): string {
	return id.trim().toLowerCase().replace(/[\s._-]+/g, "");
}

/** #157/#158 — Extrae (planPathToken, fase) de un input de workflow.
 *  Orden estricto: "Phase F10c.2" explícito; luego token suelto tras el path.
 *  Jamás un match suelto sobre el string completo: el path contiene ".frida"
 *  y "pdle2-f10c-wizard…" que matchean F[\w.]+ case-insensitive. */
export function extractPhaseId(
	input: string,
): { planPathToken: string; phaseId?: string } | null {
	const cleanInput = sanitizeInput(input);
	const tokens = cleanInput.split(/\s+/);
	const planPathToken = sanitizeInput(tokens[0] ?? "");
	if (!planPathToken || !planPathToken.includes(".md")) return null;

	const explicit = cleanInput.match(/Phase\s+(F[\w.]+(?:\.\w+)?|\d+)\b/i);
	let phaseId = explicit?.[1];
	if (!phaseId) {
		const afterPath = cleanInput.slice((tokens[0] ?? "").length).trim();
		const bare = afterPath.match(/^(F[\w.]+(?:\.\w+)?|\d+)\b/i);
		phaseId = bare?.[1];
	}
	return { planPathToken, phaseId };
}

/** #158 — Ruta del archivo de progreso de un plan:
 *  `<cwd>/.frida/artifacts/progress/<slug>.md` (slug = basename sin .md). */
export function progressFilePath(cwd: string, planPathToken: string): string {
	const slug = basename(planPathToken).replace(/\.md$/i, "");
	return join(cwd, ".frida", "artifacts", "progress", `${slug}.md`);
}

/** #158 — Lee las fases registradas como completadas (ids normalizados) del
 *  archivo de progreso del plan. Tabla Markdown `| Fase | Run | Completado |`. */
export function readCompletedPhases(
	cwd: string,
	planPathToken: string,
): string[] {
	const file = progressFilePath(cwd, planPathToken);
	if (!existsSync(file)) return [];
	try {
		const lines = readFileSync(file, "utf8").split("\n");
		const ids: string[] = [];
		for (const line of lines) {
			const m = line.match(/^\|\s*([^|]+?)\s*\|/);
			if (!m) continue;
			const first = m[1]!;
			if (first === "---" || first.toLowerCase() === "fase") continue;
			ids.push(normalizePhaseId(first));
		}
		return ids;
	} catch {
		return [];
	}
}

/** #158 — Registra (idempotente) una fase completada en el progreso del plan.
 *  Se llama con el id canónico del plan cuando el plan existe (mismas claves
 *  que usa readCompletedPhases al comparar). */
export function appendPhaseProgress(
	cwd: string,
	planPathToken: string,
	phaseId: string,
	runId: string,
	completedAtIso: string,
): void {
	const file = progressFilePath(cwd, planPathToken);
	const slug = basename(planPathToken).replace(/\.md$/i, "");
	const key = normalizePhaseId(phaseId);
	if (readCompletedPhases(cwd, planPathToken).includes(key)) return;

	const existing = existsSync(file)
		? readFileSync(file, "utf8")
				.split("\n")
				.filter((l) => l.trim().length > 0)
		: [`# Progreso del plan — ${slug}`, "", "| Fase | Run | Completado |", "| --- | --- | --- |"];
	existing.push(`| ${phaseId} | ${runId} | ${completedAtIso} |`);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, existing.join("\n") + "\n", "utf8");
}

/** #158 — Fila mínima de un JSONL de run (sólo los campos que importan). */
interface RunRow {
	type: string;
	input?: string;
	stage?: string;
	status?: string;
}

/** #158 — Bootstrap idempotente: escanea los runs JSONL de `runsDir` y registra
 *  en el progreso las fases de corridas pasadas con etapa `commit` completada
 *  (cubre fases terminadas antes de esta versión). Procesa por fecha de nombre. */
export function bootstrapPlanProgressFromRuns(
	runsDir: string,
	cwd: string,
): number {
	if (!existsSync(runsDir)) return 0;
	const files = readdirSync(runsDir)
		.filter((f) => f.endsWith(".jsonl"))
		.sort(); // nombres con fecha → orden cronológico
	let registered = 0;
	for (const f of files) {
		const rows: RunRow[] = [];
		for (const line of readFileSync(join(runsDir, f), "utf8").split("\n")) {
			if (!line.trim()) continue;
			try {
				rows.push(JSON.parse(line) as RunRow);
			} catch {
				/* fila corrupta: ignorar */
			}
		}
		const input = rows.find((r) => r.type === "workflow")?.input;
		const hasCommit = rows.some(
			(r) => r.type === "stage" && r.stage === "commit" && r.status === "completed",
		);
		if (!input || !hasCommit) continue;
		const extracted = extractPhaseId(input);
		if (!extracted?.phaseId) continue;
		const runId = f.replace(/\.jsonl$/, "");
		const before = readCompletedPhases(cwd, extracted.planPathToken).length;
		appendPhaseProgress(
			cwd,
			extracted.planPathToken,
			extracted.phaseId,
			runId,
			rows.find((r) => r.type === "workflow") ? f.slice(0, 10) : "",
		);
		if (readCompletedPhases(cwd, extracted.planPathToken).length > before) {
			registered++;
		}
	}
	return registered;
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
	const extracted = extractPhaseId(input);
	if (!extracted) return null;
	const planPathToken = extracted.planPathToken;

	const fullPlanPath = isAbsolute(planPathToken)
		? planPathToken
		: join(cwd, planPathToken);

	if (!existsSync(fullPlanPath)) return null;

	try {
		const content = readFileSync(fullPlanPath, "utf8");
		const phases = parsePlanPhases(content);
		if (phases.length === 0) return null;

		const currentPhaseId = extracted.phaseId;
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

		// #158 — Sugerir el PRIMER HUECO REAL del plan: la primera fase cuyo id
		// (normalizado) no esté registrada como completada en el progreso. Si el
		// archivo no existe (sin bootstrap previo), degrada al comportamiento
		// anterior: la fase siguiente a la del input.
		const completedPhases = readCompletedPhases(cwd, planPathToken);
		const hasProgressFile = existsSync(progressFilePath(cwd, planPathToken));
		const nextPhase = hasProgressFile
			? (phases.find((p) => !completedPhases.includes(normalizePhaseId(p.id))) ??
				undefined)
			: phases[currentIndex + 1];
		const isPlanComplete = nextPhase === undefined;

		return {
			planPath: planPathToken,
			currentPhase,
			nextPhase,
			phaseIndex: currentIndex + 1,
			totalPhases: phases.length,
			isPlanComplete,
			completedPhases,
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
