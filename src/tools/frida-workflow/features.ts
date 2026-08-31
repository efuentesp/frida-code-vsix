// features.ts — pipeline N1 (planeación): dominio de features SDD.
//
// Espejo del patrón de board.ts (#159/#163): persistencia atómica multi-escritor
// (tmp+rename), listeners in-process para overlays vivos y versionado `v`.
// La unidad es la FEATURE (un FRD); las etapas son las skills del pipeline RPIV
// (discover→research→design→plan) más la columna terminal ready-to-ship, cuyo
// gesto de entrada es el SHIP manual (crea fases en backlog del board N2 — ver
// shipFeature, Slice 3).
//
// Contrato multi-escritor (extension-api.ts:8-16, heredado del board):
// - features.json es el estado de verdad: overlay, SSE y HTML leen SÓLO aquí.
// - Escritores: UI (▶ del overlay), reconciler (auto-adopción de FRDs) y POST
//   autenticado del monitor HTML — todos vía saveFeatures.
// - id canónico = ruta relativa del FRD normalizada (dedup trivial; lección #1
//   del área: la sincronización derivada duplica sin id canónico).
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

// ── Etapas ──────────────────────────────────────────────────────────────────

/** Columnas del pipeline N1 en orden de avance (espejo 1:1 de los comandos). */
export const PIPELINE_STAGES = [
	"discover",
	"research",
	"design",
	"plan",
	"ready-to-ship",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** Etapa con skill asociada (ready-to-ship es terminal: el gesto es el ship). */
export type SkillStage = Exclude<PipelineStage, "ready-to-ship">;

/** Bucket de artefactos por etapa (raíz .frida/artifacts/<bucket>/). Los skills
 *  bundled escriben en PLURAL (designs/, plans/) — ver research §7. */
export const STAGE_BUCKET: Record<SkillStage, string> = {
	discover: "discover",
	research: "research",
	design: "designs",
	plan: "plans",
};

/** Índice ordinal de la etapa (discover=0 … ready-to-ship=4). */
export function stageIndex(stage: PipelineStage): number {
	return PIPELINE_STAGES.indexOf(stage);
}

/** Etapa siguiente; undefined en ready-to-ship (terminal). */
export function nextStage(stage: PipelineStage): PipelineStage | undefined {
	const i = stageIndex(stage);
	return i >= 0 && i < PIPELINE_STAGES.length - 1
		? PIPELINE_STAGES[i + 1]
		: undefined;
}

// ── Tipos ───────────────────────────────────────────────────────────────────

/** Movimiento de la feature (historial ligero append-only; NO BoardTransition
 *  completo: failed/regress/blocked/runId no aplican a un pipeline lineal). */
export interface FeatureTransition {
	to: PipelineStage;
	ts: string;
	/** Escritor: "pipeline-ui" (▶ overlay), "reconciler" (auto-adopción),
	 *  "monitor" (POST del HTML), "skill" (skills nivel 1 FS-API). */
	source?: string;
}

/** Una feature del pipeline: un FRD avanzando por las etapas de planeación. */
export interface PipelineFeature {
	/** Id canónico: ruta relativa del FRD (`.frida/artifacts/discover/<slug>_<topic>.md`
	 *  o `.rpiv/artifacts/discover/…` para el seed histórico). */
	id: string;
	/** Título corto (topic del filename); opcional: la UI deriva del basename. */
	title?: string;
	stage: PipelineStage;
	/** Pausada por el usuario: timeline en ámbar; NO bloquea el avance (FR#14). */
	paused?: boolean;
	/** Artefacto enlazado por etapa (ruta relativa; resuelto por el reconciler). */
	artifacts?: Partial<Record<SkillStage, string>>;
	/** Ruta del plan (token del board N2) — se fija al ship (Slice 3). */
	planPath?: string;
	/** ISO del ship (la tarjeta permanece en ready-to-ship con badge n/m). */
	shippedAt?: string;
	history: FeatureTransition[];
}

/** Estado persistido en `.frida/artifacts/pipeline/features.json`. */
export interface FeaturesFile {
	v: number;
	features: PipelineFeature[];
	updatedAt: string;
	/** Escritor principal (trazabilidad multi-escritor; no excluyente). */
	source?: string;
}

// ── Overlay vivo: listeners (espejo board.ts:213-227) ───────────────────────

const featuresListeners = new Set<() => void>();

/** Suscripción para re-render del overlay /pipeline y broadcast del SSE
 *  cuando features.json cambia (sólo escrituras in-process; las externas
 *  las atrapa el watcher del monitor — monitor-server.ts). */
export function subscribeFeaturesChanges(fn: () => void): () => void {
	featuresListeners.add(fn);
	return () => {
		featuresListeners.delete(fn);
	};
}

function emitFeaturesChange(): void {
	for (const l of [...featuresListeners]) {
		try {
			l();
		} catch {
			/* listener roto: no bloquear a los demás */
		}
	}
}

// ── Persistencia (espejo board.ts:233-265) ──────────────────────────────────

/** `.frida/artifacts/pipeline/features.json` — un solo archivo para TODAS las
 *  features del proyecto (a diferencia de boardFilePath, que es por plan). */
export function featuresFilePath(cwd: string): string {
	return join(cwd, ".frida", "artifacts", "pipeline", "features.json");
}

/** Carga el estado; null si no existe; degrada a vacío si está corrupto
 *  (NFR reliability: el panel arranca vacío sin error). */
export function loadFeatures(cwd: string): FeaturesFile | null {
	const file = featuresFilePath(cwd);
	if (!existsSync(file)) return null;
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8")) as FeaturesFile;
		if (typeof parsed.v !== "number") parsed.v = 1;
		if (!Array.isArray(parsed.features)) parsed.features = [];
		return parsed;
	} catch {
		return null;
	}
}

/** Escritura atómica multi-escritor (tmp PID + rename) + emit del cambio. */
export function saveFeatures(cwd: string, state: FeaturesFile): void {
	const file = featuresFilePath(cwd);
	mkdirSync(dirname(file), { recursive: true });
	state.updatedAt = new Date().toISOString();
	const tmp = `${file}.${process.pid}.tmp`;
	writeFileSync(tmp, JSON.stringify(state, null, "\t") + "\n", "utf8");
	renameSync(tmp, file);
	emitFeaturesChange();
}

/** Busca una feature por id canónico. */
export function findFeature(
	state: FeaturesFile,
	id: string,
): PipelineFeature | undefined {
	return state.features.find((f) => f.id === id);
}

// (La Fase 2 añade aquí la sección ── Reconciler ──; la Fase 3 la sección
//  ── Acciones ── — ver Architecture del diseño.)
