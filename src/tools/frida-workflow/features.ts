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
	readdirSync,
	renameSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { isUnitDone, loadBoard, openBoard, saveBoard } from "./board";

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

// ── Reconciler: FS ↔ features.json (FR#3/FR#12; decisiones D4/D6) ──────────

/** Raíces escaneadas por el reconciler. Orden = prioridad: `.frida/` es la
 *  raíz primaria donde escriben los skills bundled; `.rpiv/` es el seed
 *  histórico de solo-lectura (se lee en cada reconciliación; NO se vigila). */
export const PIPELINE_ROOTS = [".frida/artifacts", ".rpiv/artifacts"] as const;

/** `<slug-de-fecha>_<topic>.md` — el slug admite fecha sola (seed histórico,
 *  p. ej. 2025-07-31_porte.md) o fecha+hora (skills actuales). */
const TOPIC_RE = /^\d{4}-\d{2}-\d{2}(?:_\d{2}-\d{2}-\d{2})?_(.+)\.md$/;

/** Artefacto .md escaneado del FS (lectura FRESCA por mtime en cada pase —
 *  molde readFreshVerdict sdd-factory.ts:84; nunca un snapshot, #174). */
export interface ScannedArtifact {
	/** Ruta relativa normalizada (separador `/`): id del FRD / valor de link. */
	rel: string;
	/** Segmento del filename tras el slug de fecha (fallback de vinculación). */
	topic: string | undefined;
	/** Frontmatter `parent` (ruta relativa del upstream; comillas stripped). */
	parent: string | undefined;
	mtimeMs: number;
}

/** Mapa etapa → ruta del artefacto enlazado (el FRD es la propia feature). */
export type StageArtifacts = Partial<Record<SkillStage, string>>;

/** Frontmatter plano del head YAML: pares `key: value` (split("---")[1] +
 *  regex por línea — molde readFreshVerdict, sin parser YAML completo).
 *  Tolerante: archivo ilegible o sin frontmatter ⇒ objeto vacío. */
function readFrontmatter(file: string): Record<string, string> {
	try {
		const head = readFileSync(file, "utf8").split("---")[1] ?? "";
		const out: Record<string, string> = {};
		for (const line of head.split("\n")) {
			const m = line.match(/^([\w-]+):\s*(.*)$/);
			if (!m) continue;
			out[m[1]!] = m[2]!
				.trim()
				.replace(/^["']|["']$/g, "")
				.replace(/^\.\//, "");
		}
		return out;
	} catch {
		return {};
	}
}

/** Escanea un bucket en TODAS las raíces (readdir + statSync por mtime;
 *  bucket inexistente en una raíz es normal y se salta). */
function scanBucket(cwd: string, bucket: string): ScannedArtifact[] {
	const out: ScannedArtifact[] = [];
	for (const root of PIPELINE_ROOTS) {
		const dir = join(cwd, root, bucket);
		let files: string[];
		try {
			files = readdirSync(dir).filter((f) => f.endsWith(".md"));
		} catch {
			continue;
		}
		for (const f of files) {
			const abs = join(dir, f);
			try {
				out.push({
					rel: `${root}/${bucket}/${f}`,
					topic: f.match(TOPIC_RE)?.[1],
					parent: readFrontmatter(abs).parent,
					mtimeMs: statSync(abs).mtimeMs,
				});
			} catch {}
		}
	}
	return out;
}

/** Instantánea fresca de los buckets de planeación. */
export interface PipelineScan {
	frds: ScannedArtifact[];
	byStage: Record<SkillStage, ScannedArtifact[]>;
}

/** Escanea discover/research/designs/plans en las raíces del pipeline. */
export function scanPipeline(cwd: string): PipelineScan {
	const byStage = {} as Record<SkillStage, ScannedArtifact[]>;
	for (const stage of Object.keys(STAGE_BUCKET) as SkillStage[]) {
		byStage[stage] = scanBucket(cwd, STAGE_BUCKET[stage]);
	}
	return { frds: byStage.discover, byStage };
}

/** Vinculación híbrida (D6): parent explícito primero; fallback por topic del
 *  filename; entre candidatos empatados gana el mtime más reciente. */
function pickArtifact(
	candidates: ScannedArtifact[],
	parent: string | undefined,
	topic: string | undefined,
): ScannedArtifact | undefined {
	const byParent = parent ? candidates.filter((c) => c.parent === parent) : [];
	const pool = byParent.length
		? byParent
		: topic
			? candidates.filter((c) => c.topic === topic)
			: [];
	return [...pool].sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
}

/** Resuelve la cadena FRD → research → design → plan de una feature:
 *  cada etapa enlaza por parent contra el artefacto resuelto de la etapa
 *  previa (el parent del design apunta al research, etc.); sin upstream
 *  resuelto cae al fallback por topic. */
export function linkArtifacts(
	scan: PipelineScan,
	frd: ScannedArtifact,
): StageArtifacts {
	const research = pickArtifact(scan.byStage.research, frd.rel, frd.topic);
	const design = pickArtifact(scan.byStage.design, research?.rel, frd.topic);
	const plan = pickArtifact(scan.byStage.plan, design?.rel, frd.topic);
	const out: StageArtifacts = {};
	if (research) out.research = research.rel;
	if (design) out.design = design.rel;
	if (plan) out.plan = plan.rel;
	return out;
}

/** Etapa respaldada por el FS: el artefacto enlazado más avanzado (por
 *  EXISTENCIA, no por status del enum — research §7). Techo "plan":
 *  ready-to-ship sólo se alcanza por el ship manual (FR#5). */
export function deriveStageFromArtifacts(
	artifacts: StageArtifacts,
): SkillStage {
	if (artifacts.plan) return "plan";
	if (artifacts.design) return "design";
	if (artifacts.research) return "research";
	return "discover";
}

/** Reconciliación de UNA feature (FR#12: insumo del ámbar «desincronizado»). */
export interface FeatureReconcile {
	id: string;
	/** Etapa que el FS respalda; undefined si el FRD desapareció. */
	derivedStage: PipelineStage | undefined;
	/** true si el FS va MÁS adelante que features.json. El early-move (tarjeta
	 *  por delante del artefacto pendiente) NO cuenta como desync. */
	desync: boolean;
}

function buildReport(
	state: FeaturesFile,
	scan: PipelineScan,
): FeatureReconcile[] {
	return state.features.map((f) => {
		const frd = scan.frds.find((a) => a.rel === f.id);
		if (!frd) return { id: f.id, derivedStage: undefined, desync: false };
		const derived = deriveStageFromArtifacts(linkArtifacts(scan, frd));
		return {
			id: f.id,
			derivedStage: derived,
			desync: stageIndex(derived) > stageIndex(f.stage),
		};
	});
}

/** Reporte de reconciliación SIN efectos (cero escrituras): lo consumen el
 *  snapshot del monitor (Slice 6/7) y la UI (Slice 5) para pintar el ámbar
 *  sin adoptar nada. */
export function computeFeatureReconcile(cwd: string): FeatureReconcile[] {
	const scan = scanPipeline(cwd);
	const state = loadFeatures(cwd) ?? { v: 1, features: [], updatedAt: "" };
	return buildReport(state, scan);
}

/** Resultado de un pase del reconciler con efectos. */
export interface ReconcileResult {
	/** FRDs adoptados como features nuevas en este pase (FR#3). */
	adopted: string[];
	/** Features cuyo mapa `artifacts` cambió (FR#16: detalle HTML vivo). */
	relinked: string[];
	/** true si hubo adopción/relink ⇒ saveFeatures ya corrió. */
	changed: boolean;
	/** Reporte por feature tras el pase (mismo shape que compute). */
	report: FeatureReconcile[];
}

/** Pase del reconciler (D4: auto-adopción persistente). Adopta FRDs nuevos
 *  con la etapa DERIVADA de sus artefactos encadenados (Migration Notes: la
 *  etapa refleja el más avanzado con artefacto), re-vincula artefactos y
 *  reporta desync. NO adelanta stages de features existentes: ese hueco lo
 *  pinta el ámbar (FR#12) y el avance lo dispara el ▶ (Slice 3).
 *  Idempotente: sin cambios no escribe (lección #1: re-scan no duplica). */
export function reconcileFeatures(cwd: string): ReconcileResult {
	const scan = scanPipeline(cwd);
	const state = loadFeatures(cwd) ?? { v: 1, features: [], updatedAt: "" };
	const adopted: string[] = [];
	const relinked: string[] = [];
	const now = new Date().toISOString();

	// 1) Auto-adopción (FR#3): FRD sin feature ⇒ tarjeta con etapa derivada.
	for (const frd of scan.frds) {
		if (findFeature(state, frd.rel)) continue;
		const artifacts = linkArtifacts(scan, frd);
		const stage = deriveStageFromArtifacts(artifacts);
		state.features.push({
			id: frd.rel,
			title: frd.topic,
			stage,
			artifacts,
			history: [{ to: stage, ts: now, source: "reconciler" }],
		});
		adopted.push(frd.rel);
	}

	// 2) Re-vinculación: el mapa artifacts refleja el FS (histórico auditable:
	//    la feature sobrevive aunque el FRD desaparezca).
	for (const f of state.features) {
		const frd = scan.frds.find((a) => a.rel === f.id);
		if (!frd) continue;
		const artifacts = linkArtifacts(scan, frd);
		const unchanged = (["research", "design", "plan"] as const).every(
			(k) => f.artifacts?.[k] === artifacts[k],
		);
		if (!unchanged) {
			f.artifacts = artifacts;
			relinked.push(f.id);
		}
	}

	if (adopted.length > 0 || relinked.length > 0) {
		state.source = "reconciler";
		saveFeatures(cwd, state);
	}

	return {
		adopted,
		relinked,
		changed: adopted.length > 0 || relinked.length > 0,
		report: buildReport(state, scan),
	};
}

// ── Acciones: ▶ del overlay y POST del monitor (FR#4/FR#5/FR#6/FR#11/FR#14) ─

/** Resultado de advanceFeature. */
export interface AdvanceResult {
	/** false: feature inexistente, etapa plan (el gesto terminal es el ship) o
	 *  ya en ready-to-ship. */
	moved: boolean;
	/** FR#14: el INSUMO de la etapa actual existía en el FS. Sólo informativo —
	 *  el movimiento NUNCA se bloquea (advertencia, no bloqueo). */
	prerequisitesMet: boolean;
	/** Etapa destino efectiva. */
	to?: PipelineStage;
	/** Comando que el handler inyecta al chat para ESTE avance (FR#4), computado
	 *  del stage ANTES del movimiento: `/skill:<etapa-destino> <frd>`. El handler
	 *  NO debe recomputarlo sobre `feature` (ya movida: daría la etapa siguiente
	 *  equivocada — footgun de la auditoría 1, cerrada por diseño). */
	command?: string;
	/** Feature tras el intento (refrescada también cuando moved=false). */
	feature?: PipelineFeature;
}

/** Insumo que la etapa siguiente consume (FR#14): el FRD en discover y el
 *  artefacto enlazado de la etapa actual en las demás. */
function stageInput(f: PipelineFeature): string | undefined {
	switch (f.stage) {
		case "discover":
			return f.id;
		case "research":
			return f.artifacts?.research;
		case "design":
			return f.artifacts?.design;
		case "plan":
			return f.artifacts?.plan;
		default:
			return undefined; // ready-to-ship: terminal
	}
}

/** Movimiento temprano (FR#4): el handler del ▶ llama esto AL MOMENTO DEL
 *  clic y luego inyecta `result.command` al chat — el comando llega computado
 *  (etapa destino correcta) sin importar que la feature ya esté movida.
 *  Idempotente en los extremos; registra history con el escritor. */
export function advanceFeature(
	cwd: string,
	id: string,
	source = "pipeline-ui",
): AdvanceResult {
	const state = loadFeatures(cwd) ?? { v: 1, features: [], updatedAt: "" };
	const f = findFeature(state, id);
	if (!f) return { moved: false, prerequisitesMet: false };
	const input = stageInput(f);
	const prerequisitesMet = !!input && existsSync(join(cwd, input));
	const target = nextStage(f.stage);
	// plan → ready-to-ship NO es advance: es el ship manual (FR#5).
	if (!target || f.stage === "plan") {
		return { moved: false, prerequisitesMet, feature: f };
	}
	const command = `/skill:${target} ${f.id}`;
	f.stage = target;
	const ts = new Date().toISOString();
	f.history.push({ to: target, ts, source });
	state.source = source;
	saveFeatures(cwd, state);
	return { moved: true, prerequisitesMet, to: target, command, feature: f };
}

/** Comando del ▶ para una feature SIN moverla (FR#4/FR#13): la UI lo usa para
 *  rotular el botón («Continuar a research →») antes del clic. undefined en
 *  plan (el gesto es el ship) y en ready-to-ship. */
export function featureAdvanceCommand(f: PipelineFeature): string | undefined {
	const target = nextStage(f.stage);
	if (!target || target === "ready-to-ship") return undefined;
	return `/skill:${target} ${f.id}`;
}

/** Motivo de un ship sin efecto. */
export type ShipFailure = "missing" | "no-plan" | "already-shipped";

/** Resultado de shipFeature. */
export interface ShipResult {
	moved: boolean;
	failure?: ShipFailure;
	/** Token del plan (board N2) fijado en la feature. */
	planPath?: string;
	/** Fases raíz del plan ahora en backlog del board N2 (FR#5: SIN ejecución). */
	phaseCount: number;
	feature?: PipelineFeature;
}

/** Ship manual N1→N2 (FR#5/FR#13): replica el flujo exacto del escalón /board
 *  (mountBoardOverlay: openBoard → saveBoard) — las fases `## FN` del plan
 *  nacen como unidades en backlog con CERO transiciones, y la tarjeta pasa a
 *  ready-to-ship con planPath+shippedAt (el badge n/m vive en shipBadge
 *  consultando ese board). Idempotente: re-ship no duplica nada. */
export function shipFeature(
	cwd: string,
	id: string,
	source = "pipeline-ui",
): ShipResult {
	const state = loadFeatures(cwd) ?? { v: 1, features: [], updatedAt: "" };
	const f = findFeature(state, id);
	if (!f) return { moved: false, failure: "missing", phaseCount: 0 };
	if (f.stage === "ready-to-ship") {
		return {
			moved: false,
			failure: "already-shipped",
			planPath: f.planPath,
			phaseCount: 0,
			feature: f,
		};
	}
	const planRel = f.artifacts?.plan;
	if (!planRel || !existsSync(join(cwd, planRel))) {
		return { moved: false, failure: "no-plan", phaseCount: 0, feature: f };
	}
	const planContent = readFileSync(join(cwd, planRel), "utf8");
	const board = openBoard(cwd, planRel, planContent);
	saveBoard(cwd, planRel, board);
	const ts = new Date().toISOString();
	f.stage = "ready-to-ship";
	f.planPath = planRel;
	f.shippedAt = ts;
	f.history.push({ to: "ready-to-ship", ts, source });
	state.source = source;
	saveFeatures(cwd, state);
	return {
		moved: true,
		planPath: planRel,
		phaseCount: board.units.filter((u) => u.parentId === undefined).length,
		feature: f,
	};
}

/** Pausa/reanuda una feature (FR#11 punto ámbar; FR#14: NO bloquea el
 *  avance — es una señal visual persistida). */
export function setFeaturePaused(
	cwd: string,
	id: string,
	paused: boolean,
	source = "monitor",
): PipelineFeature | undefined {
	const state = loadFeatures(cwd);
	if (!state) return undefined;
	const f = findFeature(state, id);
	if (!f) return undefined;
	f.paused = paused;
	state.source = source;
	saveFeatures(cwd, state);
	return f;
}

/** Badge «n/m fases commit» post-ship (FR#6): n = fases raíz done del board
 *  N2 (isUnitDone resuelve la jerarquía de splits), m = total de raíces. Se
 *  consulta FRESCO en cada render — el overlay reacciona vía
 *  subscribeBoardChanges (el board emite en cada transición del run). */
export interface ShipBadge {
	done: number;
	total: number;
}

export function shipBadge(
	cwd: string,
	feature: PipelineFeature,
): ShipBadge | undefined {
	if (!feature.planPath) return undefined;
	const board = loadBoard(cwd, feature.planPath);
	if (!board || board.units.length === 0) return undefined;
	const roots = board.units.filter((u) => u.parentId === undefined);
	const pool = roots.length > 0 ? roots : board.units;
	return {
		done: pool.filter((u) => isUnitDone(board, u)).length,
		total: pool.length,
	};
}
