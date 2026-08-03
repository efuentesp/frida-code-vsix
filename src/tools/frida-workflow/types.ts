// frida-workflow — tipos centrales.
//
// Espejo conceptual de @juicesharp/rpiv-workflow (Workflow/Stage/Output/Outcome),
// adaptado al modelo de Frida (sesiones hijas vía createAgentSession, webview).
// Esta capa NO importa el SDK de Pi: el runner se testa con un host stub.

// ---------------------------------------------------------------------------
// Handles / artefactos (lo que una etapa produce y la siguiente consume)
// ---------------------------------------------------------------------------

/** Referencia opaca a algo que la etapa materializó. */
export type Handle =
	| { kind: "fs"; path: string }
	| { kind: "url"; href: string }
	| { kind: "opaque"; id: string };

/** Un artefacto: un handle + su rol dentro del Output de la etapa. */
export interface Artifact {
	handle: Handle;
	role: "primary" | "secondary";
}

/** El envelope que una etapa pasa hacia abajo: routing, prompts y audit lo leen. */
export interface Output<D = unknown> {
	kind: string;
	data: D;
	artifacts: Artifact[];
}

// ---------------------------------------------------------------------------
// Standard Schema v1 (lib-agnostic: Zod/Valibot/TypeBox vía typeboxSchema)
// ---------------------------------------------------------------------------

export interface StandardIssue {
	message?: string;
	path?: unknown[];
}
export type StandardResult<T = unknown> = {
	value?: T;
	issues?: StandardIssue[];
};

/** Un valor con `~standard` (cualquier lib de schemas que hable Standard Schema v1). */
export interface StandardSchemaV1<Result = unknown> {
	"~standard": {
		version: 1;
		vendor: string;
		validate: (
			value: unknown,
		) => StandardResult<Result> | Promise<StandardResult<Result>>;
	};
}

// ---------------------------------------------------------------------------
// Outcomes (cómo se construye el Output de una etapa desde su sesión hija)
// ---------------------------------------------------------------------------

export interface StageSnapshot {
	/** Salida de `git status --porcelain` ANTES de la etapa. */
	gitStatus: string;
	/** HEAD sha ANTES de la etapa (para gitCommitCollector). */
	headSha: string | undefined;
}

export interface CollectCtx {
	/** Mensajes de la sesión hija (rama transcript). `unknown[]` — shape del SDK. */
	messages: unknown[];
	cwd: string;
	stage: string;
	skill?: string;
	/** Snapshot del FS capturado ANTES de correr la etapa (collectors diff/git). */
	preSnapshot?: StageSnapshot;
}

export type CollectResult =
	| { kind: "ok"; artifacts: Artifact[] }
	| { kind: "fatal"; message: string };

/** Enumera los artefactos que la etapa produjo (escanea texto / dif FS / tools…). */
export type Collector = (ctx: CollectCtx) => CollectResult;

/** Interpreta opcionalmente los artefactos en `data` tipado (para routing).
 *  Puede retornar `undefined` si no pudo parsear (falla grácil, no fatal). */
export type Parser<D = unknown> = (
	artifacts: Artifact[],
	ctx: CollectCtx,
) => D | undefined;

/** Declaración productor-side: cómo construir el Output. Requerido en `produces`. */
export interface OutputSpec {
	/** Clave de publicación en state.named (para `reads`/`fanin` — Fase 2+). */
	name?: string;
	collector: Collector;
	parser?: Parser;
}

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

export type StageKind = "produces" | "side-effect";

// ---------------------------------------------------------------------------
// Loops (Fase 6): fanout (push paralelo) / iterate (pull acumulativo)
// ---------------------------------------------------------------------------

/** Una unidad de loop: su propio prompt + etiqueta + identidad estable. */
export interface Unit {
	prompt: string;
	label: string;
	/** Identidad estable para audit/join (fallback label). Útil si label cambia. */
	id?: string;
	/** (fanout) ids de unidades de las que depende → scheduler de waves (Kahn). */
	deps?: string[];
}

export type LoopOnCap = "halt" | "advance";
export type LoopResult = "entry" | "last";

/** Faceta introspectible + perillas compartidas por fanout/iterate. */
export interface LoopBase {
	/** Canal del que las unidades se splitean (hint de `consumes`). */
	source?: string;
	/** Cómo se detectan las unidades (opaco; el framework no lo interpreta). */
	unit?: { by: string; pattern?: string };
	/** Techo de cardinalidad (≥1). Siempre clampeado por maxIterations del run. */
	max?: number;
	/** Qué pasa al llegar al cap efectivo. fanout/iterate default "halt". */
	onCap?: LoopOnCap;
	/** Qué deja el loop en {primaryHandle, lastOutput}. Default: fanout "entry", iterate "last". */
	result?: LoopResult;
}

export interface FanoutContext {
	cwd: string;
	/** Artefacto primario heredado (undefined si la etapa loop es el start). */
	artifact: Artifact | undefined;
	state: Readonly<RunState>;
}

export interface IterateContext {
	cwd: string;
	artifact: Artifact | undefined;
	state: Readonly<RunState>;
	/** Outputs ya completos de esta generación, en orden. */
	accumulated: Output[];
	/** Índice 0-based de la unidad a correr (== accumulated.length). */
	index: number;
}

export interface FanoutDef extends LoopBase {
	kind: "fanout";
	/** Push: calcula TODAS las unidades de una vez (ciegas entre sí). */
	units: (ctx: FanoutContext) => Unit[];
	/** Techo de unidades en vuelo (≥1). Default 1 (serial). */
	concurrency?: number;
	/** Si se setea, la 1ª unidad que falla detiene el run y cancela en-flight. */
	failFast?: boolean;
}

export interface IterateDef extends LoopBase {
	kind: "iterate";
	/** Pull: devuelve la siguiente unidad, o null/undefined para terminar. */
	next: (ctx: IterateContext) => Unit | null | undefined;
}

export type LoopDef = FanoutDef | IterateDef | AssessDef;

/** `reads`: string = última entrada del canal; fanin(name) = TODAS las entradas. */
export type ReadSpec = string | { name: string; all?: boolean };

// ---------------------------------------------------------------------------
// Judges (Fase 7): judge / verify / assess / panel
// ---------------------------------------------------------------------------

/** Nombra una sesión de grading. Despacha skill XOR prompt (raw). */
export interface Judge {
	/** `/skill:<skill> <producerHandle>` (handle auto-inyectado). */
	skill?: string;
	/** Raw text (el autor embebe el handle); skill XOR prompt. */
	prompt?: (ctx: { output: Output }) => string;
	/** Recoge el veredicto; name requerido y distinto del productor. */
	outcome: OutputSpec;
}

export interface FeedForwardContext {
	cwd: string;
	/** Output del productor recién juzgado. */
	output: Output;
	/** Veredicto del judge (lleva el feedback). */
	verdict: Output;
	/** Ronda/intento 0-based recién juzgado. */
	round: number;
	state: Readonly<RunState>;
}

/** Vocabulario compartido por assess y verify (judged repetition). */
export interface JudgedRepetition {
	/** Judge simple o panel de N. */
	judge: Judge | PanelDef;
	/** Predicado de terminación sobre el veredicto. */
	done: (verdict: Output) => boolean;
	/** Mensaje para el siguiente intento/ronda (lleva el feedback). */
	feedForward?: (ctx: FeedForwardContext) => string;
	/** Presupuesto de rondas/intentos (default verify 1, assess 8). */
	max?: number;
}

/** Post-condición por etapa: tras cada intento produce, el judge la califica y
 *  `done` decide avance/reintento. Vive en `stage.verify`. */
export interface VerifyDef extends JudgedRepetition {}

/** Loop juzgado: rondas productor→judge hasta `done`. Default onCap "advance". */
export interface AssessDef extends LoopBase, JudgedRepetition {
	kind: "assess";
}

// --- Panel ---

export interface PanelVerdict {
	pass: boolean;
	votes: { pass: number; fail: number };
	/** |mayoría| / N — la señal de desacuerdo. */
	agreement: number;
	/** Empate (split par). */
	tie: boolean;
}

/** Fold crudo: reduce los veredictos de los miembros a data (canal propio). */
export type FoldFn = (verdicts: Output[], members: Judge[]) => unknown;

/** Sugar: majority/all/any sobre un predicado por miembro → PANEL_VERDICT. */
export interface SugarFold {
	rule: "majority" | "all" | "any";
	pred: (v: Output) => boolean;
}

export type Fold = SugarFold | FoldFn;

/** N jueces escépticos reducidos por un fold. Es Judge-shaped (slot en judge). */
export interface PanelDef {
	members: Judge[];
	fold: Fold;
	/** Sólo para FoldFn crudo (nombra+valida el canal del fold). */
	outcome?: OutputSpec;
}

// ---------------------------------------------------------------------------
// Despacho script / prompt (Fase 8)
// ---------------------------------------------------------------------------

/** Contexto que recibe una stage script (cwd + output upstream + state). */
export interface ScriptContext {
	cwd: string;
	/** Output heredado de la etapa upstream (artifacts+data), si lo hay. */
	input: Output | undefined;
	state: Readonly<RunState>;
}

/** Resultado de una produces.script: el runner arma el Output con estos campos. */
export interface ScriptResult {
	kind: string;
	artifacts: Artifact[];
	data?: unknown;
}

/** Función pura (sin modelo): produce el resultado o hace el side-effect. */
export type ScriptFn = (
	ctx: ScriptContext,
) => Promise<ScriptResult | void> | ScriptResult | void;

/** Prompt dinámico: recibe el output upstream y devuelve el texto crudo. */
export type PromptFn = (ctx: { input?: Output }) => string;

// --- Skill contracts (Fase 8, scaffolding) ---

/** Contrato de un skill: qué consume/produce (declarado o cosechado). */
export interface SkillContract {
	skill: string;
	/** Canales nombrados que requiere leer (para canCompose). */
	consumes?: string[];
	/** Canales que publica. */
	produces?: string[];
}

// ---------------------------------------------------------------------------

/**
 * Una etapa del grafo. Despacho por `skill` (`/skill:<name> <arg>` o flags si
 * `reads`); script/prompt en Fase 8. Schemas + routing: Fase 2. Loops: Fase 6.
 */
export interface StageDef {
	kind: StageKind;
	/** Skill a despachar; por defecto la key del record de stages. */
	skill?: string;
	/** Requerido en `produces`. */
	outcome?: OutputSpec;
	/** `false` en terminal → no hereda el artefacto upstream (limpia el slot). */
	inheritsArtifacts?: boolean;
	/** Valida `output.data` tras el parser; habilita routing + retry por shape drift. */
	outputSchema?: StandardSchemaV1;
	/** Valida el `output.data` heredado de la etapa upstream; rechazo ⇒ halt. */
	inputSchema?: StandardSchemaV1;
	/** Qué hacer si `outputSchema` rechaza. Default "retry". */
	onInvalid?: "retry" | "halt";
	/** Reintentos por rechazo de schema (clampeado 1–3). Default 1. */
	maxRetries?: number;
	/** Loop (Fase 6): expande la etapa en una sesión hija por unidad. */
	loop?: LoopDef;
	/** Multi-input (Fase 6): consume canales nombrados (latest o fanin=todas). */
	reads?: ReadSpec[];
	/** Post-condición juzgada (Fase 7): produce→judge→done gate, retry hasta max. */
	verify?: VerifyDef;
	/** Despacho script (Fase 8): función TS pura, sin modelo. Mutuamente excluyente
	 *  con skill/prompt/loop/verify. */
	run?: ScriptFn;
	/** Despacho prompt (Fase 8): texto crudo al modelo (chat turn, sin /skill:).
	 *  string o PromptFn dinámica. Mutuamente excluyente con skill/run/loop/reads. */
	prompt?: PromptFn | string;
}

// ---------------------------------------------------------------------------
// Edges (string lineal | EdgeFn con routing)
// ---------------------------------------------------------------------------

/** Contexto que recibe un EdgeFn para decidir la siguiente etapa. */
export interface RouteCtx {
	/** Output validado de la etapa de donde sale el edge (data + artifacts). */
	output: Output;
	state: Readonly<RunState>;
	cwd: string;
}

/** Predicado de routing. `.targets` enumera toda etapa retornable (para BFS). */
export type EdgeFn = ((ctx: RouteCtx) => string) & {
	targets: readonly string[];
};

/** Target de un edge: nombre de etapa, "stop", o un EdgeFn (gate/match/defineRoute). */
export type EdgeTarget = string | EdgeFn;

export type EdgeTable = Record<string, EdgeTarget>;

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

export interface Workflow {
	name: string;
	description?: string;
	start: string;
	stages: Record<string, StageDef>;
	edges: EdgeTable;
}

// ---------------------------------------------------------------------------
// Run state + resultado
// ---------------------------------------------------------------------------

export type Termination =
	| { status: "running" }
	| { status: "completed" }
	| { status: "failed"; error: string }
	| { status: "aborted"; error: string };

export interface RunState {
	runId: string;
	workflow: string;
	originalInput: string;
	/** Handle (path) que hereda la próxima etapa; undefined ⇒ usar originalInput. */
	primaryHandle: string | undefined;
	/** Output validado de la última etapa (para routing e inputSchema downstream). */
	lastOutput: Output | undefined;
	/** Registro nombrado: canales de Outputs (loops publican, reads/fanin consumen). */
	named: Record<string, Output[]>;
	visited: Set<string>;
	stagesCompleted: number;
	/** Techo run-wide de unidades de loop (default 32). */
	maxIterations: number;
	termination: Termination;
}

export interface RunWorkflowResult {
	runId: string;
	stagesCompleted: number;
	success: boolean;
	lastArtifact?: string;
	error?: string;
	termination: Termination;
}

// ---------------------------------------------------------------------------
// Host port (lo que el runner necesita de Frida; el SDK nunca aparece aquí)
// ---------------------------------------------------------------------------

/** Contexto de la sesión hija entregado a `withSession`. */
export interface WorkflowSessionContext {
	/** Mensajes/transcript de la hija (para los collectors). */
	getMessages(): unknown[];
	getSessionId(): string;
	getSessionFile(): string | undefined;
}

export interface SpawnChildOptions {
	prompt: string;
	signal?: AbortSignal;
	/** Directorio donde el host debe crear el archivo de sesión de esta hija
	 *  (el runner es dueño del layout: `<runsDir>/<runId>/sessions/`). */
	sessionDir: string;
	withSession: (child: WorkflowSessionContext) => Promise<void>;
	/** Identidad de etapa para alimentar el transcript en vivo del WorkflowPanel:
	 *  el host se suscribe a los eventos de la hija (tool_execution_start/end +
	 *  message_update) y los vuelca al store reactivo. Undefined si no hay panel. */
	transcriptTarget?: { runId: string; stage: string };
}

/** Contrato que Frida satisface; el runner sólo consume esto. */
export interface WorkflowHost {
	cwd: string;
	notify(message: string, level?: "info" | "warning" | "error"): void;
	spawnChild(options: SpawnChildOptions): Promise<void>;
}

export interface RunWorkflowOptions {
	workflow: Workflow;
	input: string;
	/** Directorio base donde se escriben los runs (`<…>/workflows/<encoded-cwd>/runs`). */
	runsDir: string;
	host: WorkflowHost;
	signal?: AbortSignal;
	/** Alias humano (claimName); se resumible vía /wf @<name>. */
	name?: string;
	/** Techo run-wide de unidades de loop (todo tipo). Default 32. */
	maxIterations?: number;
}
