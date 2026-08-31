// frida-workflow — API pública (Fase 1: grafo lineal + audit JSONL + run detached).
//
// Porte nativo de @juicesharp/rpiv-workflow. Ver docs/frida-workflow-design.md y
// ADR-0020. Fases siguientes: 2 routing+outcomes+schemas · 3 resume · 4 carga por
// capas · 5 WorkflowPanel · 6 loops · 7 judges · 8 skill-contracts+script/prompt.

// DSL de autoría
export { defineWorkflow, produces, acts, terminal } from "./dsl";
// typebox re-exportado para que los configs importen TODO desde "frida-workflow"
// (frida-workflow está bundleado, no es paquete instalable — el alias jiti mapea
// también "typebox"/"typebox/value" al bundle). Ver load.ts / ADR-0020 Fase 4.
export { Type } from "typebox";
export type { Static } from "typebox";
export { Value } from "typebox/value";
export {
	transcriptPathCollector,
	noopCollector,
	defineCollector,
	fs,
	url,
	opaque,
} from "./dsl";

// Routing (Fase 2)
export {
	gate,
	match,
	defineRoute,
	routeReadsData,
	STOP,
	gt,
	gte,
	lt,
	lte,
	eq,
} from "./routing";
export type { MatchValue, DefineRouteOptions } from "./routing";

// Loops (Fase 6)
export { fanout, iterate, fanin } from "./loops";
export type { FanoutOptions, IterateOptions } from "./loops";

// Judges (Fase 7)
export {
	judge,
	verify,
	assess,
	panel,
	majority,
	all,
	any,
	isSugarFold,
} from "./judges";

// Skill contracts (Fase 8)
export {
	registerSkillContracts,
	getSkillContract,
	getAllSkillContracts,
	canCompose,
	_resetSkillContracts,
} from "./contracts";
export type {
	JudgeOptions,
	VerifyOptions,
	AssessOptions,
	PanelOptions,
} from "./judges";

// Outcomes catálogo (Fase 2)
export {
	urlCollector,
	directoryPathCollector,
	toolCallCollector,
	workspaceDiffCollector,
	gitCommitCollector,
	unionCollectors,
	captureSnapshot,
	jsonBodyParser,
	gitCommitParser,
	gitCommitOutcome,
} from "./outcomes";
export type { ToolCallLike, GitCommitData } from "./outcomes";

// Schemas (Fase 2)
export { typeboxSchema, validateSchema, summarizeIssues } from "./schema";
export { defineSddWorkflow } from "./sdd-factory";
// #161 — Superficie frida.board.* (extensionApi; ver extension-api.ts para el contrato).
export { frida, setBoardShowHandler } from "./extension-api";
export type { BoardTransitionInput } from "./extension-api";
export type { SddWorkflowOptions } from "./sdd-factory";

// Validación de grafo (Fase 2)
export { validateWorkflow, hasErrors } from "./validate";
export type { ValidationIssue } from "./validate";

// Carga por capas (Fase 4)
export { loadWorkflows } from "./load";
export type {
	LoadedWorkflows,
	LoadIssue,
	LoadOptions,
	WorkflowOrigin,
} from "./load";

// Lifecycle + store (Fase 5)
export { registerLifecycle, fire, _resetLifecycle } from "./lifecycle";
export type {
	LifecycleListeners,
	LifecycleContext,
	StageRef,
	StageOutput,
} from "./lifecycle";
export {
	getWorkflowRuns,
	subscribeWorkflowRuns,
	_resetWorkflowRuns,
} from "./store";
export type {
	WorkflowRunsState,
	RunView,
	StageView,
	UnitView,
	RunStatus,
	StageViewStatus,
} from "./store";

// Host + runner
export { createFridaWorkflowHost } from "./host";
export type {
	ChildSessionHost,
	ChildSession,
	ChildSessionManager,
	FridaWorkflowHostDeps,
} from "./host";
export { runWorkflow, resumeWorkflow } from "./runner";
export type { StageOutcome, ResumeOptions } from "./runner";

// Comando /wf + registry
export {
	registerWorkflow,
	registerWorkflows,
	getWorkflow,
	listWorkflows,
	handleWfSlash,
	_resetRegistry,
} from "./command";
export type { WfSlashDeps } from "./command";

// Audit
export {
	generateRunId,
	encodeCwd,
	writeHeader,
	appendStageRow,
	appendRouteRow,
	readRun,
	readTrail,
	readHeader,
	resolveRef,
	resolveName,
	claimName,
	releaseName,
	STATE_SCHEMA_VERSION,
} from "./audit";
export type {
	WorkflowHeader,
	StageRow,
	StageStatus,
	RouteRow,
	Trail,
	TrailRow,
	ClaimResult,
} from "./audit";

// Tipos
export type {
	Workflow,
	StageDef,
	StageKind,
	EdgeTable,
	EdgeTarget,
	EdgeFn,
	RouteCtx,
	OutputSpec,
	Collector,
	Parser,
	CollectCtx,
	CollectResult,
	Artifact,
	Handle,
	Output,
	RunState,
	RunWorkflowOptions,
	RunWorkflowResult,
	WorkflowHost,
	WorkflowSessionContext,
	SpawnChildOptions,
	StandardSchemaV1,
	StandardIssue,
	StandardResult,
	StageSnapshot,
	Unit,
	LoopDef,
	FanoutDef,
	IterateDef,
	LoopBase,
	LoopOnCap,
	LoopResult,
	FanoutContext,
	IterateContext,
	ReadSpec,
	Judge,
	JudgedRepetition,
	VerifyDef,
	AssessDef,
	PanelDef,
	PanelVerdict,
	Fold,
	FoldFn,
	SugarFold,
	FeedForwardContext,
	ScriptFn,
	ScriptContext,
	ScriptResult,
	PromptFn,
	SkillContract,
	BoardSpec,
} from "./types";

// Board / kanban interno (#159/#160) — núcleo del motor + sugerencia.
export {
	openBoard,
	loadBoard,
	saveBoard,
	boardFilePath,
	syncUnitsFromPlan,
	applyStageTransition,
	boardChildren,
	depsSatisfied,
	pendingDeps,
	isUnitDone,
	firstRealGap,
	bootstrapBoardFromRuns,
	resolveNextStepWithBoard,
	setSkillContracts,
	getSkillContracts,
	setBoardSpecResolver,
	resolveBoardSpec,
	resolveStageKind,
	dedupeBoard,
	hasIdenticalTransition,
	subscribeBoardChanges,
	validateFails,
	sortArtifactsChronologically,
	ARTIFACT_KIND_ORDER,
	deriveBoardSpec,
	DEFAULT_BOARD_COLUMNS,
	DEFAULT_DONE_COLUMN,
	DEFAULT_STAGE_COLUMNS,
	DEFAULT_STAGE_KINDS,
} from "./board";
export type {
	Board,
	BoardUnit,
	BoardTransition,
	BoardArtifactLink,
	StageTransitionInput,
} from "./board";
export {
	scanSkillContracts,
	extractContractArtifactKind,
} from "./skill-contracts";

// Pipeline N1 (features.json) — dominio de planeación espejo del board (#159).
export {
	PIPELINE_STAGES,
	STAGE_BUCKET,
	featuresFilePath,
	findFeature,
	loadFeatures,
	saveFeatures,
	stageIndex,
	nextStage,
	subscribeFeaturesChanges,
} from "./features";
export type {
	PipelineFeature,
	PipelineStage,
	SkillStage,
	FeatureTransition,
	FeaturesFile,
} from "./features";
