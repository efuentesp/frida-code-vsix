// board.ts — #159/#160: kanban interno por plan, jerárquico (soporta splits).
//
// Diseño C híbrido (capas):
//   0) Vocabulario: cada transición se etiqueta con el artifactKind real del
//      skill (override config > contrato SKILL.md > defaults).
//   1) Genérica: transiciones escritas por eventos del lifecycle del motor —
//      cualquier workflow con stages produce board sin código extra.
//   2) Específicas: defineWorkflow({ board: BoardSpec }) sobreescribe
//      columnas/mapas SIN ramificar el motor (dato, no código).
//
// Jerarquía (#160): un skill puede PARTIR una fase si es muy grande. El split
// se declara en el propio plan (sub-fases `## F10c.3.1 — …` bajo el padre);
// syncUnitsFromPlan cuelga cada id descendiente de su raíz (origin "split") y
// el cierre del padre exige que TODAS sus hojas estén done.
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import {
	extractPhaseId,
	normalizePhaseId,
	parsePlanPhases,
	readCompletedPhases,
	resolveNextStep as resolveNextStepRel,
	sanitizeInput,
} from "./plan-utils";
import type { BoardSpec } from "./types";

// ── Tipos ───────────────────────────────────────────────────────────────────

// BoardSpec vive en types.ts (vocabulario del DSL); el resto de tipos del
// board (unidades, transiciones, board) son del motor y viven aquí.

export interface BoardArtifactLink {
	kind: string; // artifactKind del contrato (elaboration, validation, git-commit…)
	path: string; // vínculo EXPLÍCITO al artefacto real
	label?: string;
}

export interface BoardTransition {
	to: string; // columna tras la transición
	stage: string; // stage del workflow que la produjo
	artifactKind?: string;
	runId?: string;
	ts: string;
	/** #161 — Quién escribió la transición (workflow, skill u otra extensión).
	 *  Trazabilidad multi-escritor; los workflows ponen su nombre aquí. */
	source?: string;
	/** #163 — Zigzag: validate FAIL (transición de ciclo, con o sin regreso). */
	failed?: boolean;
	/** #163 — true si la transición MOVIO la tarjeta hacia atrás. */
	regress?: boolean;
	/** #172 — Corte del circuit breaker en esta columna (fase bloqueada). */
	blocked?: boolean;
	artifacts?: BoardArtifactLink[];
}

export interface BoardUnit {
	id: string; // jerárquico: "F10c.3", "F10c.3.1"
	title?: string;
	parentId?: string; // vínculo explícito (id prefijo)
	/** "plan": nació del plan original; "split": la añadió un skill que partió la fase. */
	origin: "plan" | "split";
	status: string; // columna actual
	transitions: BoardTransition[];
}

export interface Board {
	/** #161 — Versión del schema del board (multi-escritor: evoluciones seguras). */
	v: number;
	planPath: string; // relativo al cwd
	columns: string[];
	doneColumn: string;
	units: BoardUnit[]; // en orden de plan (raíces e hijas intercaladas por posición)
	updatedAt: string;
	/** #161 — Escritor principal del board (trazabilidad; no excluyente). */
	source?: string;
	/** #163 — Workflow dueño (p. ej. "sdd-ship"): la UI lo usa para el comando
	 *  de avance desde el tablero. Seteado por el runtime en cada transición. */
	workflow?: string;
	/** #166 — Boards de roadmap (unidades manuales, p. ej. filas de la tabla de
	 *  vista general): NO sincronizar fases de los headers del plan — el sync
	 * colaría duplicados cuando headers ≠ unidades (p. ej. ## F0..## F6–F8 vs
	 * F01–F17). Los boards derivados de plan (splits #160) no lo marcan. */
	disablePlanSync?: boolean;
}

// ── Defaults (Capa 1 genérica) ──────────────────────────────────────────────

export const DEFAULT_BOARD_COLUMNS = [
	"backlog",
	"elaborada",
	"implementada",
	"validada",
	"commiteada",
] as const;

export const DEFAULT_DONE_COLUMN = "commiteada";

/** stage ⇒ columna destino (validate sólo avanza con passed === true). */
export const DEFAULT_STAGE_COLUMNS: Record<string, string> = {
	elaborate: "elaborada",
	implement: "implementada",
	validate: "validada",
	commit: "commiteada",
};

/** stage ⇒ artifactKind (fallback cuando ni config ni SKILL.md declaran). */
export const DEFAULT_STAGE_KINDS: Record<string, string> = {
	elaborate: "elaboration",
	implement: "code-mutation",
	validate: "validation",
	commit: "git-commit",
};

// ── Contratos de skills (Capa 0) ────────────────────────────────────────────

let skillContracts: Record<string, string> = {};

/** La extensión escanea ~/.frida/skills una vez y registra skill ⇒ artifactKind. */
export function setSkillContracts(map: Record<string, string>): void {
	skillContracts = map;
}

export function getSkillContracts(): Record<string, string> {
	return skillContracts;
}

/** Resuelve el artifactKind de un stage: config > contrato SKILL.md > default. */
export function resolveStageKind(
	stage: string,
	spec?: BoardSpec,
): string | undefined {
	return (
		spec?.stageKinds?.[stage] ??
		skillContracts[stage] ??
		DEFAULT_STAGE_KINDS[stage]
	);
}

// ── Resolución del spec por workflow (runtime) ────────────────────────────────

let boardSpecResolver:
	| ((workflowName: string) => BoardSpec | undefined)
	| undefined;

/** La extensión registra un resolver nombre-de-workflow ⇒ BoardSpec (desde el
 *  registry cargado). El lifecycle sólo ve el nombre; así el runtime también
 *  honra los overrides declarativos de config sin acoplar el motor. */
export function setBoardSpecResolver(
	fn: (workflowName: string) => BoardSpec | undefined,
): void {
	boardSpecResolver = fn;
}

export function resolveBoardSpec(
	workflowName: string | undefined,
): BoardSpec | undefined {
	return workflowName ? boardSpecResolver?.(workflowName) : undefined;
}

// ── Derivación de columnas desde el grafo del workflow (#163) ───────────────

/** Submínimo estructural de Workflow para derivar el spec (sin importar el
 *  tipo completo: mantiene la función pura y testeable). */
export interface WorkflowLike {
	name: string;
	stages: Record<string, unknown>;
	edges: Record<string, unknown>;
}

/** #163 — Deriva el BoardSpec del propio workflow: las columnas SON las
 *  stages en orden de declaración (sdd-ship → backlog, elaborate, implement,
 *  validate, commit), stageColumns identidad y validateRegress leído de los
 *  targets del route de validate (el destino de reintento que no es el
 *  terminal ni stop). El tablero se vuelve imagen fiel del ciclo. */
export function deriveBoardSpec(wf: WorkflowLike): BoardSpec {
	const stageNames = Object.keys(wf.stages);
	const columns = ["backlog", ...stageNames];
	const stageColumns: Record<string, string> = {};
	for (const s of stageNames) stageColumns[s] = s;
	const doneColumn = stageNames[stageNames.length - 1] ?? "commiteada";

	// validateRegress: targets del route de validate que no son el done ni stop.
	let validateRegress: string | undefined;
	const edge = wf.edges.validate as { targets?: readonly string[] } | undefined;
	if (edge?.targets) {
		validateRegress = edge.targets.find((t) => t !== "stop" && t !== doneColumn);
	}
	return { columns, stageColumns, doneColumn, validateRegress };
}

/** #163 — Ciclos de validate fallidos de una unidad (badge del tablero). */
export function validateFails(unit: BoardUnit): number {
	return unit.transitions.filter((t) => t.stage === "validate" && t.failed)
		.length;
}

// ── Overlay vivo: listeners de cambio del board (#163) ───────────────────────

const boardListeners = new Set<() => void>();

/** Suscripción para re-render del overlay /board cuando el board cambia. */
export function subscribeBoardChanges(fn: () => void): () => void {
	boardListeners.add(fn);
	return () => {
		boardListeners.delete(fn);
	};
}

function emitBoardChange(): void {
	for (const l of [...boardListeners]) {
		try {
			l();
		} catch {
			/* listener roto: no bloquear a los demás */
		}
	}
}

// ── Persistencia ─────────────────────────────────────────────────────────────

/** `.frida/artifacts/board/<slug>.json` (estado máquina; los .md humanos viven aparte). */
export function boardFilePath(cwd: string, planPathToken: string): string {
	const slug = basename(planPathToken).replace(/\.md$/i, "");
	return join(cwd, ".frida", "artifacts", "board", `${slug}.json`);
}

export function loadBoard(cwd: string, planPathToken: string): Board | null {
	const file = boardFilePath(cwd, planPathToken);
	if (!existsSync(file)) return null;
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8")) as Board;
		// #161 — Boards previos al versionado (o escritores externos sin v): 1.
		if (typeof parsed.v !== "number") parsed.v = 1;
		return parsed;
	} catch {
		return null;
	}
}

export function saveBoard(
	cwd: string,
	planPathToken: string,
	board: Board,
): void {
	const file = boardFilePath(cwd, planPathToken);
	mkdirSync(dirname(file), { recursive: true });
	board.updatedAt = new Date().toISOString();
	// #161 — Escritura atómica (tmp + rename): multi-escritor sin boards
	// corruptos a medias (lectores nunca ven el archivo parcial).
	const tmp = `${file}.${process.pid}.tmp`;
	writeFileSync(tmp, JSON.stringify(board, null, "\t") + "\n", "utf8");
	renameSync(tmp, file);
	emitBoardChange(); // #163 — overlay vivo: re-render de /board si está abierto
}

/** Board nuevo (o existente) sincronizado con el contenido actual del plan. */
export function openBoard(
	cwd: string,
	planPathToken: string,
	planContent: string | undefined,
	spec?: BoardSpec,
): Board {
	const columns = spec?.columns ?? [...DEFAULT_BOARD_COLUMNS];
	const doneColumn = spec?.doneColumn ?? columns[columns.length - 1]!;
	const persisted = loadBoard(cwd, planPathToken);
	const board: Board = persisted ?? {
		v: 1,
		planPath: planPathToken,
		columns,
		doneColumn,
		units: [],
		updatedAt: new Date().toISOString(),
		source: "frida-workflow",
	};
	// El spec manda sobre lo persistido (config cambió ⇒ board adopta columnas).
	// #163 — Con columnas derivadas (nombres de stage), los status de boards
	// previos ("elaborada"/"commiteada") se REMAPEAN para no romper el avance.
	if (
		persisted &&
		(persisted.columns.join("\u0000") !== columns.join("\u0000") ||
			persisted.doneColumn !== doneColumn)
	) {
		remapUnitStatuses(board, columns, doneColumn, spec);
	}
	board.columns = columns;
	board.doneColumn = doneColumn;
	if (planContent && !board.disablePlanSync)
		syncUnitsFromPlan(board, planContent);
	return board;
}

/** #163 — Traduce status de columnas viejas a las del spec nuevo: vía el
 *  inverso de DEFAULT_STAGE_COLUMNS ("elaborada"→stage"elaborate"→columna
 *  nueva) o posición proporcional como último recurso. */
function remapUnitStatuses(
	board: Board,
	newColumns: string[],
	newDone: string,
	spec?: BoardSpec,
): void {
	const inverse: Record<string, string> = {};
	for (const [stage, col] of Object.entries(DEFAULT_STAGE_COLUMNS)) {
		inverse[col] = stage;
	}
	const oldCols = board.columns;
	for (const u of board.units) {
		if (newColumns.includes(u.status)) continue;
		const stage = inverse[u.status] ?? u.status;
		const mapped =
			spec?.stageColumns?.[stage] ??
			(newColumns.includes(stage) ? stage : undefined);
		if (mapped) {
			u.status = mapped;
			continue;
		}
		// Fallback proporcional por índice (boards con columnas exóticas).
		const oldIdx = oldCols.indexOf(u.status);
		if (oldIdx < 0) {
			u.status = newColumns[0]!;
			continue;
		}
		const ratio = oldCols.length > 1 ? oldIdx / (oldCols.length - 1) : 0;
		u.status = newColumns[Math.round(ratio * (newColumns.length - 1))] ?? newDone;
	}
}

// ── Sync desde el plan (con jerarquía de splits, #160) ─────────────────────

/** Prefijo padre de un id jerárquico: "F10c.3.1" → "F10c.3"; "F10c.3" → undefined. */
function parentOf(id: string): string | undefined {
	const i = id.lastIndexOf(".");
	if (i <= 0) return undefined;
	return id.slice(0, i);
}

/**
 * Incorpora las fases `## FN` del plan como unidades. Ids descendientes
 * ("F10c.3.1") se cuelgan de su raíz con origin "split": así un skill que
 * parte una fase sólo necesita añadir sub-fases al plan (o a un sub-plan ya
 * fusionado) para que el board las adopte. Unidades que desaparecen del plan
 * se conservan (histórico auditable).
 */
export function syncUnitsFromPlan(board: Board, planContent: string): void {
	const phases = parsePlanPhases(planContent);
	const first = board.columns[0]!;
	for (const p of phases) {
		const existing = board.units.find((u) => u.id === p.id);
		if (existing) {
			existing.title = p.title;
			continue;
		}
		const parentId = parentOf(p.id);
		const parentKnown = parentId && board.units.some((u) => u.id === parentId);
		board.units.push({
			id: p.id,
			title: p.title,
			parentId: parentKnown ? parentId : undefined,
			origin: parentKnown ? "split" : "plan",
			status: first,
			transitions: [],
		});
	}
}

export function boardChildren(board: Board, unitId: string): BoardUnit[] {
	return board.units.filter((u) => u.parentId === unitId);
}

// ── Transiciones (lifecycle) ────────────────────────────────────────────────

export interface StageTransitionInput {
	stage: string;
	runId: string;
	ts: string;
	artifacts?: BoardArtifactLink[];
	/** Para validate: verdict del output. false = FAIL (zigzag/breaker);
	 *  undefined = inicio de etapa (#171, avanza temprano). */
	passed?: boolean;
	/** #172 — El circuit breaker cortó tras N ciclos FAIL: la tarjeta se
	 *  queda en la columna de validate con marca `blocked`. */
	breakerTrip?: boolean;
	spec?: BoardSpec;
	/** #161 — Escritor de la transición (workflow, skill u otra extensión). */
	source?: string;
}

/** Aplica la transición de un stage sobre la unidad (id canónico de fase).
 *  Reglas: sólo avanza hacia adelante; validate sin passed NO avanza;
 *  idempotente (re-aplicar una columna ya alcanzada es no-op). */
export function applyStageTransition(
	board: Board,
	unitId: string,
	input: StageTransitionInput,
): BoardUnit | undefined {
	let unit = board.units.find((u) => u.id === unitId);
	if (!unit) {
		// Unidad no sincronizada aún (p. ej. fase nueva del split): crearla.
		const parentId = parentOf(unitId);
		unit = {
			id: unitId,
			parentId:
				parentId && board.units.some((u) => u.id === parentId)
					? parentId
					: undefined,
			origin: parentId ? "split" : "plan",
			status: board.columns[0]!,
			transitions: [],
		};
		board.units.push(unit);
	}

	const target =
		input.spec?.stageColumns?.[input.stage] ?? DEFAULT_STAGE_COLUMNS[input.stage];
	if (!target) return unit; // stage sin columna (p. ej. pre-flight): no toca el board

	if (input.stage === "validate" && input.passed === false) {
		// #163/#171 — Zigzag: validate FAIL (explícito, del verdict del onStageEnd)
		// registra el ciclo y, si la tarjeta estaba
		// más adelante, REGRESA a la columna del stage de reintento (derivado del
		// route del workflow). El tablero refleja el ciclo implement↔validate
		// real: rebotes visibles + badge de ciclos (validateFails).
		// #172 — breakerTrip (el circuit breaker cortó tras los N ciclos): la
		// tarjeta se queda en VALIDATE — donde falló — con marca `blocked`, en
		// vez de rebotar una última vez a implement: el estado final refleja
		// dónde se bloqueó la fase.
		if (input.breakerTrip) {
			const dstV = board.columns.indexOf(target);
			if (dstV >= 0) {
				unit.status = target;
				unit.transitions.push({
					to: target,
					stage: input.stage,
					artifactKind: resolveStageKind(input.stage, input.spec),
					runId: input.runId,
					ts: input.ts,
					source: input.source,
					failed: true,
					blocked: true,
					artifacts: input.artifacts?.length ? input.artifacts : undefined,
				});
			}
			return unit;
		}
		const regressCol =
			input.spec?.validateRegress ?? DEFAULT_STAGE_COLUMNS.implement;
		const dst2 = board.columns.indexOf(regressCol);
		const cur2 = board.columns.indexOf(unit.status);
		if (dst2 >= 0 && cur2 >= dst2) {
			const moved = cur2 > dst2;
			if (moved) unit.status = regressCol;
			unit.transitions.push({
				to: regressCol,
				stage: input.stage,
				artifactKind: resolveStageKind(input.stage, input.spec),
				runId: input.runId,
				ts: input.ts,
				source: input.source,
				failed: true,
				regress: moved,
				artifacts: input.artifacts?.length ? input.artifacts : undefined,
			});
		}
		return unit;
	}

	const cur = board.columns.indexOf(unit.status);
	const dst = board.columns.indexOf(target);
	if (dst < 0) return unit; // columna destino no existe en este board (spec custom): no-op seguro
	if (dst <= cur) return unit; // no retrocede / ya alcanzada

	unit.status = target;
	unit.transitions.push({
		to: target,
		stage: input.stage,
		artifactKind: resolveStageKind(input.stage, input.spec),
		runId: input.runId,
		ts: input.ts,
		source: input.source,
		artifacts: input.artifacts?.length ? input.artifacts : undefined,
	});
	return unit;
}

// ── Cierre y primer hueco (DFS) ─────────────────────────────────────────────

export function isUnitDone(board: Board, unit: BoardUnit): boolean {
	if (unit.status === board.doneColumn) return true;
	const children = boardChildren(board, unit.id);
	if (children.length === 0) return false;
	return children.every((c) => isUnitDone(board, c));
}

/** Primera HOJA no-done en orden del plan (una fase partida sugiere su primera
 *  sub-fase pendiente; una fase raíz sin hijos se sugiere a sí misma). */
export function firstRealGap(board: Board): BoardUnit | undefined {
	const roots = board.units.filter((u) => u.parentId === undefined);
	const walk = (unit: BoardUnit): BoardUnit | undefined => {
		if (isUnitDone(board, unit)) return undefined;
		const children = boardChildren(board, unit.id);
		if (children.length === 0) return unit;
		for (const c of children) {
			const hit = walk(c);
			if (hit) return hit;
		}
		return undefined; // todas las hojas done ⇒ padre done
	};
	for (const r of roots) {
		const hit = walk(r);
		if (hit) return hit;
	}
	return undefined;
}

// ── Bootstrap desde runs JSONL + migración progress (#158) ─────────────────

interface RunRow {
	type: string;
	input?: string;
	stage?: string;
	status?: string;
	primaryHandle?: string;
	output?: {
		data?: unknown;
		artifacts?: { handle?: { path?: string }; role?: string }[];
	};
}

/** Registra el board completo desde el histórico de runs (fases con commit de
 *  corridas pasadas, incluyendo los artefactos reales de cada etapa). */
export function bootstrapBoardFromRuns(
	runsDir: string,
	cwd: string,
	spec?: BoardSpec,
): number {
	if (!existsSync(runsDir)) return 0;
	const files = readdirSync(runsDir)
		.filter((f) => f.endsWith(".jsonl"))
		.sort(); // nombres con fecha → orden cronológico
	let touched = 0;
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
		const wfRow = rows.find((r) => r.type === "workflow");
		if (!wfRow?.input) continue;
		const extracted = extractPhaseId(wfRow.input);
		if (!extracted?.phaseId) continue;

		const planPathToken = extracted.planPathToken;
		const planAbs = join(cwd, planPathToken);
		const planContent = existsSync(planAbs)
			? readFileSync(planAbs, "utf8")
			: undefined;
		const before = loadBoard(cwd, planPathToken)?.units.length ?? 0;
		const board = openBoard(cwd, planPathToken, planContent, spec);
		const runId = f.replace(/\.jsonl$/, "");

		for (const r of rows) {
			if (r.type !== "stage" || r.status !== "completed") continue;
			const artifacts: BoardArtifactLink[] = (r.output?.artifacts ?? [])
				.map((a) => ({
					kind: r.stage ?? "artifact",
					path: a.handle?.path ?? "",
				}))
				.filter((a) => a.path);
			const passed = (r.output?.data as { passed?: boolean } | undefined)?.passed;
			applyStageTransition(board, extracted.phaseId, {
				stage: r.stage ?? "",
				runId,
				ts: wfRow.input ? f.slice(0, 10) : "",
				artifacts,
				passed,
				spec,
			});
		}
		// Migración #158: fases registradas en progress/*.md cuentan como commiteadas.
		// readCompletedPhases devuelve ids NORMALIZADOS ("f10c1" sin punto):
		// resolver al id canónico de la unidad existente para no crear duplicados.
		for (const doneId of readCompletedPhases(cwd, planPathToken)) {
			const canonical =
				board.units.find((u) => normalizePhaseId(u.id) === doneId)?.id ?? doneId;
			applyStageTransition(board, canonical, {
				stage: "commit",
				runId: "progress-158",
				ts: "migrated",
				spec,
			});
		}
		if (board.units.length !== before) touched++;
		saveBoard(cwd, planPathToken, board);
	}
	return touched;
}

// ── Escalera de sugerencia (board > progress #158 > relativa al run) ────────

export interface NextStepWithBoard {
	/** Hoja sugerida por el board (primer hueco real), si existe board. */
	boardGap?: BoardUnit;
	/** Sugerencia final efectiva (boardGap si hay board; si no, la de plan-utils). */
	effective: ReturnType<typeof import("./plan-utils").resolveNextStep>;
}

/** Resuelve el siguiente paso consultando primero el board jerárquico. */
export function resolveNextStepWithBoard(input: string, cwd: string) {
	const extracted = extractPhaseId(sanitizeInput(input));
	if (extracted) {
		const board = loadBoard(cwd, extracted.planPathToken);
		if (board) {
			const gap = firstRealGap(board);
			const rel = resolveNextStepRel(input, cwd);
			if (gap) {
				return {
					boardGap: gap,
					effective: rel
						? {
								...rel,
								nextPhase: {
									id: gap.id,
									title: gap.title ?? "",
									fullName: `${gap.id} — ${gap.title ?? ""}`,
								},
								isPlanComplete: false,
								shipCommand: `/wf sdd-ship "${extracted.planPathToken} Phase ${gap.id}"`,
								elaborateCommand: `/skill:elaborate ${extracted.planPathToken} Phase ${gap.id}`,
							}
						: rel,
				};
			}
		}
	}
	return { boardGap: undefined, effective: resolveNextStepRel(input, cwd) };
}
