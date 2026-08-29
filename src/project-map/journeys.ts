// M2 (#143) — Mapa del proyecto: derivación determinista de journeys J01..
// desde el actionLog plano de M8.
//
// Los IDs J01.. NO existen en ningún JSON (journeys.md lo escribe un LLM,
// frida-app-walkthrough/workflow.ts:182-186): la vista los deriva. Semántica
// fijada en checkpoint de design: CORTE POR GOTO — un journey es la secuencia
// maximal de aristas traversed entre gotos que progresan; el goto marca una
// entrada explícita (nueva intención del explorador); clicks/forms navegan
// dentro de la intención; los fails NO cortan (quedan como attempted-failed
// del journey en curso). Fiel al timeline: una pantalla puede aparecer en
// varios journeys.
//
// Clasificación de aristas = algoritmo canónico M9 re-implementado
// (frida-traffic2api/workflow.ts:1053-1064): outcome "fail:" solo certifica el
// COMANDO; la navegación la certifica la progresión inter-paso.

/** ActionLog normalizado (tras validación en functional-inventory.ts). */
export interface PmAction {
	step: number;
	screenId: string;
	kind: string;
	description: string;
	outcome: string;
}

export interface PmJourneyEdge {
	type: "traversed" | "attempted-failed";
	/** Pantalla origen (siempre registrada). */
	from: string;
	/** Pantalla destino ("" en attempted-failed sin progresión). */
	to: string;
	/** Acción que produjo la arista. */
	kind: string;
	description: string;
	step: number;
	/** attempted-failed: shell-error | app-validation | no-progression. */
	cause?: string;
	/** attempted-failed: detalle acotado (≤200 chars). */
	detail?: string;
}

export interface PmJourney {
	id: string;
	/** Paso de la acción que abrió el journey. */
	startStep: number;
	/** Pantallas en orden de primera visita DENTRO del journey. */
	screenIds: string[];
	edges: PmJourneyEdge[];
}

/** Deriva journeys del actionLog (determinista, sin estado). */
export function deriveJourneys(log: PmAction[]): PmJourney[] {
	const journeys: PmJourney[] = [];
	let cur: PmJourney | null = null;
	const openJourney = (step: number, screenId: string): PmJourney => {
		const j: PmJourney = {
			id: `J${String(journeys.length + 1).padStart(2, "0")}`,
			startStep: step,
			screenIds: [screenId],
			edges: [],
		};
		journeys.push(j);
		return j;
	};
	const visit = (screenId: string): void => {
		if (cur && !cur.screenIds.includes(screenId)) cur.screenIds.push(screenId);
	};

	for (let i = 0; i < log.length; i++) {
		const a = log[i];
		const next = log[i + 1] ?? null;
		const progressed = !!(next && next.screenId !== a.screenId);

		// Corte por goto (checkpoint): SOLO un goto que progresa abre journey.
		// La primera acción (goto o no) abre J01 si aún no hay ninguno.
		if (!cur) {
			cur = openJourney(a.step, a.screenId);
		} else if (a.kind === "goto" && progressed) {
			cur = openJourney(a.step, a.screenId);
		} else {
			visit(a.screenId);
		}

		// Clasificación canónica M9 — el edge pertenece al journey en curso.
		if (a.outcome.indexOf("fail:") === 0) {
			cur.edges.push({
				type: "attempted-failed",
				from: a.screenId,
				to: progressed && next ? next.screenId : "",
				kind: a.kind,
				description: a.description,
				step: a.step,
				cause: "shell-error",
				detail: a.outcome.slice(0, 200),
			});
		} else if (a.kind === "validate") {
			cur.edges.push({
				type: "attempted-failed",
				from: a.screenId,
				to: "",
				kind: a.kind,
				description: a.description,
				step: a.step,
				cause: "app-validation",
				detail: "regla de validación reportada como fallida",
			});
		} else if ((a.kind === "click" || a.kind === "form") && !progressed) {
			cur.edges.push({
				type: "attempted-failed",
				from: a.screenId,
				to: "",
				kind: a.kind,
				description: a.description,
				step: a.step,
				cause: "no-progression",
				detail: next
					? "la pantalla no cambió tras la acción"
					: "última acción sin paso siguiente",
			});
		} else if (
			(a.kind === "click" || a.kind === "goto" || a.kind === "form") &&
			progressed &&
			next
		) {
			cur.edges.push({
				type: "traversed",
				from: a.screenId,
				to: next.screenId,
				kind: a.kind,
				description: a.description,
				step: a.step,
			});
			visit(next.screenId);
		}
		// kind "done" (y kinds desconocidos sin fail): no producen arista.
	}
	return journeys;
}
