// panel-spec.ts — motor declarativo de paneles de método (FR#9).
//
// SDD-N1 es la PRIMERA configuración; un método nuevo entra como spec
// registrada en runtime por su extensión consumidora (dirección de
// dependencia consumidor → motor), sin que el motor la conozca — espejo
// exacto de registerBuiltinPattern (builtin-patterns.ts:481-505), el patrón
// con que una extensión registra hoy sus workflows sin tocar el motor (#38).
//
// Qué es declarativo aquí y qué vive en el dominio del método (anti-drift):
// - Columnas, etiquetas de avance, gesto por columna, etiquetas de artefacto
//   y estado vacío son DATOS del spec (FR#1/FR#13/FR#15/FR#16).
// - El COMANDO de avance NO se declara: es behavior del dominio (features.ts
//   lo computa pre-move en AdvanceResult.command); duplicarlo aquí crearía
//   dos fuentes destinadas a diverger.
// - La DETECCIÓN de artefactos tampoco: cada método escanea sus raíces
//   (para SDD, el reconciler de features.ts con STAGE_BUCKET).
//
// Contrato de ids: las columnas de SDD_PANEL_SPEC espejan PIPELINE_STAGES
// (features.ts) 1:1 — la UI mapea feature.stage → columna por id. La
// consistencia la afirma panel-spec.test.ts; derivar aquí sería importar el
// dominio al motor (rompe la independencia del registro).

/** Gesto que dispara el botón de avance de una columna (FR#9 disparadores):
 *  "skill" inyecta el comando de la etapa siguiente (advanceFeature);
 *  "ship" ejecuta el gesto terminal del método (shipFeature → board N2). */
export type PanelAdvanceKind = "skill" | "ship";

/** Una columna del panel, en orden de avance (FR#1). */
export interface PanelColumnSpec {
	/** Id estable de la columna. Para SDD coincide con PipelineStage de
	 *  features.ts (la UI resuelve la columna de una tarjeta por stage). */
	id: string;
	/** Etiqueta visible de la columna (FR#1: `🚀 ready-to-ship`). */
	label: string;
	/** Columna terminal: sin botón de avance — la entrada es un gesto manual
	 *  del dominio (para SDD, el ship la POBLA; luego vive con el badge n/m,
	 *  FR#6). Validación: exactamente una por spec (pipeline lineal). */
	terminal?: boolean;
	/** Etiqueta del botón de avance DESDE esta columna (FR#13: «Continuar a
	 *  research →», «Ship → fases a ejecución»). Obligatoria si la columna
	 *  no es terminal; prohibida si lo es (validación eager). */
	advanceLabel?: string;
	/** Gesto del botón (FR#9). Default "skill" cuando se omite; prohibido en
	 *  la columna terminal. */
	advanceKind?: PanelAdvanceKind;
	/** Nombre visible del artefacto que respalda la etapa, para el detalle
	 *  del monitor (FR#16: «FRD», «Research», «Design», «Plan»). Opcional:
	 *  la columna terminal no produce artefacto. */
	artifactLabel?: string;
}

/** Comando que llena el estado vacío del panel (FR#15). */
export interface PanelEmptyStateSpec {
	/** Comando accionable que crea la primera unidad (para SDD:
	 *  `/skill:discover <idea>` — el placeholder lo completa el usuario). */
	command: string;
	/** Explicación corta del vacío, junto al botón. */
	hint?: string;
}

/** Definición declarativa de un panel de método (FR#9). */
export interface PanelSpec {
	/** Id estable del método. Dobla como segmento de ruta de su página en el
	 *  monitor (`sdd` → `/sdd`, FR#7) y como llave del registro. */
	id: string;
	/** Título corto (header del overlay / título de página del monitor). */
	title: string;
	/** Columnas en orden de avance (FR#1). */
	columns: PanelColumnSpec[];
	/** Comando del estado vacío (FR#15). */
	emptyState: PanelEmptyStateSpec;
}

// ── Validación eager (falla en el wiring, no en el render) ─────────────────

/** Nombre del spec para mensajes (tolera specs a medio construir). */
function specName(spec: PanelSpec): string {
	const id = (spec as { id?: unknown } | undefined)?.id;
	return typeof id === "string" && id ? id : "<sin id>";
}

/**
 * Valida un spec ANTES de registrarlo/usarlo (espejo de la validación eager
 * de los patrones: error accionable en el wiring, no un render roto después).
 * Reglas: id y title no vacíos; columns no vacío con ids únicos y labels no
 * vacíos; EXACTAMENTE una columna terminal (pipeline lineal); advanceLabel y
 * advanceKind prohibidos en la terminal, advanceLabel obligatorio en las
 * demás (FR#13); emptyState.command no vacío (FR#15).
 */
export function validatePanelSpec(spec: PanelSpec): void {
	const name = `PanelSpec «${specName(spec)}»`;
	if (!spec || typeof spec !== "object") {
		throw new Error(`${name}: se requiere un objeto PanelSpec.`);
	}
	if (typeof spec.id !== "string" || !spec.id.trim()) {
		throw new Error(`${name}: id debe ser un string no vacío.`);
	}
	if (typeof spec.title !== "string" || !spec.title.trim()) {
		throw new Error(`${name}: title debe ser un string no vacío.`);
	}
	if (!Array.isArray(spec.columns) || spec.columns.length === 0) {
		throw new Error(`${name}: columns debe ser un arreglo no vacío.`);
	}
	const seen = new Set<string>();
	for (const c of spec.columns) {
		if (!c || typeof c !== "object") {
			throw new Error(`${name}: toda columna debe ser un objeto.`);
		}
		if (typeof c.id !== "string" || !c.id.trim()) {
			throw new Error(`${name}: toda columna necesita id no vacío.`);
		}
		if (seen.has(c.id)) {
			throw new Error(`${name}: id de columna duplicado «${c.id}».`);
		}
		seen.add(c.id);
		if (typeof c.label !== "string" || !c.label.trim()) {
			throw new Error(`${name}: la columna «${c.id}» necesita label no vacío.`);
		}
		if (
			c.advanceKind !== undefined &&
			c.advanceKind !== "skill" &&
			c.advanceKind !== "ship"
		) {
			throw new Error(
				`${name}: advanceKind de «${c.id}» debe ser "skill" | "ship".`,
			);
		}
	}
	const terminals = spec.columns.filter((c) => c.terminal);
	if (terminals.length !== 1) {
		throw new Error(
			`${name}: se requiere EXACTAMENTE una columna terminal (pipeline lineal); hay ${terminals.length}.`,
		);
	}
	for (const c of spec.columns) {
		if (c.terminal) {
			if (c.advanceLabel !== undefined) {
				throw new Error(
					`${name}: la columna terminal «${c.id}» no lleva advanceLabel (no hay avance desde ella).`,
				);
			}
			if (c.advanceKind !== undefined) {
				throw new Error(
					`${name}: la columna terminal «${c.id}» no lleva advanceKind.`,
				);
			}
		} else if (typeof c.advanceLabel !== "string" || !c.advanceLabel.trim()) {
			throw new Error(
				`${name}: la columna «${c.id}» necesita advanceLabel (FR#13: el botón nombra el movimiento).`,
			);
		}
	}
	if (
		!spec.emptyState ||
		typeof spec.emptyState.command !== "string" ||
		!spec.emptyState.command.trim()
	) {
		throw new Error(
			`${name}: emptyState.command debe ser un string no vacío (FR#15).`,
		);
	}
}

// ── Registro runtime (espejo builtin-patterns.ts:481-505) ──────────────────

/** Specs registradas en runtime por extensiones consumidoras (FR#9): un
 *  método futuro inyecta su panel aquí sin que el motor dependa de él.
 *  Dirección de dependencia consumidor → motor (patrón #38). */
const REGISTERED_PANEL_SPECS: PanelSpec[] = [];

/** Registra un spec en runtime: validación eager, idempotente por id, gana
 *  el último (espejo registerBuiltinPattern). */
export function registerPanelSpec(spec: PanelSpec): void {
	validatePanelSpec(spec);
	const i = REGISTERED_PANEL_SPECS.findIndex((p) => p.id === spec.id);
	if (i >= 0) REGISTERED_PANEL_SPECS.splice(i, 1);
	REGISTERED_PANEL_SPECS.push(spec);
}

/** Sólo tests: vacía las specs registradas en runtime (los defaults sobreviven). */
export function _resetPanelSpecs(): void {
	REGISTERED_PANEL_SPECS.length = 0;
}

// ── Primera configuración: SDD-N1 ───────────────────────────────────────────

/** SDD-N1 (FR#1): `discover | research | design | plan | 🚀 ready-to-ship`.
 *  Los ids espejan PIPELINE_STAGES (features.ts) 1:1. El botón de `plan`
 *  nombra el ship (FR#13): el gesto que CRUZA a ready-to-ship creando las
 *  fases en backlog del board N2 (FR#5); post-ship la tarjeta vive en la
 *  terminal con el badge n/m (FR#6), sin botón. */
export const SDD_PANEL_SPEC: PanelSpec = {
	id: "sdd",
	title: "Pipeline SDD",
	columns: [
		{
			id: "discover",
			label: "discover",
			advanceKind: "skill",
			advanceLabel: "Continuar a research →",
			artifactLabel: "FRD",
		},
		{
			id: "research",
			label: "research",
			advanceKind: "skill",
			advanceLabel: "Continuar a design →",
			artifactLabel: "Research",
		},
		{
			id: "design",
			label: "design",
			advanceKind: "skill",
			advanceLabel: "Continuar a plan →",
			artifactLabel: "Design",
		},
		{
			id: "plan",
			label: "plan",
			advanceKind: "ship",
			advanceLabel: "Ship → fases a ejecución",
			artifactLabel: "Plan",
		},
		{
			id: "ready-to-ship",
			label: "🚀 ready-to-ship",
			terminal: true,
		},
	],
	emptyState: {
		command: "/skill:discover <idea>",
		hint: "Genera el FRD de una feature para abrirle camino en el pipeline.",
	},
};

/** Defaults con que el motor arranca: la primera configuración es un DATO
 *  del módulo, no código del motor. Una extensión puede pisar el id "sdd"
 *  registrando el suyo (los registrados van primero — espejo allPatterns). */
const DEFAULT_PANEL_SPECS: readonly PanelSpec[] = [SDD_PANEL_SPEC];

/** Registradas primero (la extensión gana), defaults después. */
function allSpecs(): readonly PanelSpec[] {
	return [...REGISTERED_PANEL_SPECS, ...DEFAULT_PANEL_SPECS];
}

/** Busca un spec por id exacto (estable; registradas ganan a los defaults). */
export function resolvePanelSpec(id: string): PanelSpec | undefined {
	return allSpecs().find((p) => p.id === id);
}

/** Catálogo de specs para el monitor (página por método, FR#7). Deduplicado
 *  por id — un override registrado no lista el default que pisa (delta
 *  amigable vs allPatterns: el hub no debe pintar un método dos veces). */
export function listPanelSpecs(): readonly PanelSpec[] {
	const seen = new Set<string>();
	const out: PanelSpec[] = [];
	for (const s of allSpecs()) {
		if (seen.has(s.id)) continue;
		seen.add(s.id);
		out.push(s);
	}
	return out;
}
