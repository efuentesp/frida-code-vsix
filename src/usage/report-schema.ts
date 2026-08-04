// Contrato del reporte de uso de Frida (frida-usage-report/v1).
//
// Única fuente de verdad del formato que Frida exporta para que lo consuma la
// app concentradora externa. Todos los campos existen desde v1; los de fases
// posteriores (F2–F4: bySdlcPhase, bugFixSignals, rework, quality.*) son
// opcionales con default 0/[]/false en F1. Regla de versionado: lo aditivo
// sigue siendo v1; solo un cambio breaking sube a v2.
//
// Diseño: .rpiv/artifacts/designs/2026-08-03_21-38-12_frida-usage-telemetry.md

/** Identificador de schema. Subir a "v2" solo ante un cambio breaking. */
export const USAGE_REPORT_SCHEMA = "frida-usage-report/v1" as const;

/** Granularidad del bucket temporal del periodo consultado. */
export type PeriodGranularity = "day" | "week" | "month";

/** Nivel de detalle expuesto en el reporte (privacidad creciente). */
export type DetailLevel = "aggregated" | "structured" | "detailed";

/** Rol declarado del usuario (lo evalúa el concentrador; Frida no juzga). */
export type UserRole = "dev" | "qa" | "architect" | "lead" | "devops" | "other";

/** Fases del SDLC (el clasificador de F2 etiqueta por metadatos). */
export type SdlcPhase =
	| "analysis"
	| "design"
	| "construction"
	| "testing"
	| "release"
	| "maintenance"
	| "unclassified";

export interface ReportPeriod {
	/** ISO-8601 (inclusive). */
	from: string;
	/** ISO-8601 (inclusive). */
	to: string;
	granularity: PeriodGranularity;
}

export interface ReportIdentity {
	org: string;
	/** En claro (opt-in); "" si no hay consentimiento. */
	email: string;
	project: string;
	repo: string;
	repoRemote: string;
	/** Hash estable de la máquina (sha256) para desduplicar en el concentrador. */
	hostFingerprint: string;
	/** IANA (p.ej. "America/Mexico_City"). */
	timezone: string;
	role: UserRole;
}

export interface ReportConsent {
	telemetryOptIn: boolean;
	detailLevel: DetailLevel;
}

export interface ReportKpis {
	tokensIn: number;
	tokensOut: number;
	cacheRead: number;
	cacheWrite: number;
	/** USD (0 si el gateway no factura). */
	cost: number;
	sessions: number;
	turns: number;
	/** Tiempo activo (firstTs→lastTs) sumado por sesión. */
	activeMs: number;
	/** 0–100 (del último request, como postUsage). */
	cacheHitPct: number;
	avgTurnTokens: number;
}

// --- Breakdowns ---

export interface ByModel {
	model: string;
	provider: string;
	tokens: number;
	cost: number;
	turns: number;
}
export interface ByProvider {
	provider: string;
	tokens: number;
	cost: number;
}
export interface ByTool {
	tool: string;
	count: number;
}
export interface ByLanguage {
	language: string;
	files: number;
	edits: number;
	/** Miles de líneas asistidas por Frida (write.content / edit.newText). */
	assistedKloc: number;
}
export interface ByArtifact {
	/** markdown | code | config | doc | data | other. */
	kind: string;
	count: number;
}
export interface ByDay {
	/** YYYY-MM-DD (zona horaria del host). */
	date: string;
	tokens: number;
	cost: number;
	turns: number;
}
export interface BySdlcPhase {
	phase: SdlcPhase;
	tokens: number;
	turns: number;
	activeMs: number;
	assistedKloc: number;
}

export interface ReportBreakdowns {
	byModel: ByModel[];
	byProvider: ByProvider[];
	byTool: ByTool[];
	byLanguage: ByLanguage[];
	byArtifact: ByArtifact[];
	byDay: ByDay[];
	/** 24 buckets (0–23, hora local). */
	byHour: number[];
	/** 7 buckets (0=Dom..6=Sáb). */
	byDow: number[];
	/** F2 — previsto en v1, [] en F1. */
	bySdlcPhase: BySdlcPhase[];
}

export interface ReportBehavior {
	compactations: number;
	/** F2 — sin traza en disco; contador en sesión (ver Research Q4). */
	aborts: number;
	approvals: { allow: number; block: number };
	subagentsLaunched: number;
	skillsInvoked: number;
	questionsAsked: number;
	/** F2 — proxy de actividad de corrección de defectos. */
	bugFixSignals: number;
	/** F3 — ediciones repetidas sobre el mismo archivo. */
	rework: number;
}

export interface ReportAdoption {
	skillsUsed: string[];
	browserUsed: boolean;
	mcpUsed: boolean;
	subagentsUsed: boolean;
	contextToolUsed: boolean;
	autoApprovalUsed: boolean;
}

export interface ReportEffectiveness {
	/** 0–100 cada uno. */
	volume: number;
	breadth: number;
	efficiency: number;
	autonomy: number;
	depth: number;
	advanced: number;
	overall: number;
}

export interface ReportQuality {
	/** F3 — diagnostics emitidos al escribir. */
	diagnosticsOnWrite: number;
	testsAdded: number;
	testsPassing: number;
}

/** Contrato completo frida-usage-report/v1. */
export interface UsageReport {
	schema: typeof USAGE_REPORT_SCHEMA;
	/** ISO-8601. */
	generatedAt: string;
	clientVersion: string;
	period: ReportPeriod;
	identity: ReportIdentity;
	consent: ReportConsent;
	kpis: ReportKpis;
	breakdowns: ReportBreakdowns;
	behavior: ReportBehavior;
	adoption: ReportAdoption;
	effectiveness: ReportEffectiveness;
	quality: ReportQuality;
}

/** KPIs en cero (punto de partida para acumular). */
export function emptyKpis(): ReportKpis {
	return {
		tokensIn: 0,
		tokensOut: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
		sessions: 0,
		turns: 0,
		activeMs: 0,
		cacheHitPct: 0,
		avgTurnTokens: 0,
	};
}

/** Breakdowns vacíos (arrays en [], byHour(24)/byDow(7) en ceros). */
export function emptyBreakdowns(): ReportBreakdowns {
	return {
		byModel: [],
		byProvider: [],
		byTool: [],
		byLanguage: [],
		byArtifact: [],
		byDay: [],
		byHour: new Array(24).fill(0),
		byDow: new Array(7).fill(0),
		bySdlcPhase: [],
	};
}

/** Behavior en defaults (campos F2–F3 en 0). */
export function emptyBehavior(): ReportBehavior {
	return {
		compactations: 0,
		aborts: 0,
		approvals: { allow: 0, block: 0 },
		subagentsLaunched: 0,
		skillsInvoked: 0,
		questionsAsked: 0,
		bugFixSignals: 0,
		rework: 0,
	};
}

/** Adoption en defaults (false / []). */
export function emptyAdoption(): ReportAdoption {
	return {
		skillsUsed: [],
		browserUsed: false,
		mcpUsed: false,
		subagentsUsed: false,
		contextToolUsed: false,
		autoApprovalUsed: false,
	};
}

/** Effectiveness en ceros (F3/F4 los llenan). */
export function emptyEffectiveness(): ReportEffectiveness {
	return {
		volume: 0,
		breadth: 0,
		efficiency: 0,
		autonomy: 0,
		depth: 0,
		advanced: 0,
		overall: 0,
	};
}

/** Quality en ceros (F3). */
export function emptyQuality(): ReportQuality {
	return { diagnosticsOnWrite: 0, testsAdded: 0, testsPassing: 0 };
}

/** Guard de contrato: rechaza (throw) un objeto que no sea v1 conocido. El
 *  concentrador debe poder confiar en `schema`; evolución controlada. */
export function assertUsageReport(obj: unknown): asserts obj is UsageReport {
	const o = obj as Partial<UsageReport> | null;
	if (!o || o.schema !== USAGE_REPORT_SCHEMA) {
		throw new Error(
			`usage-report: schema inesperado "${o?.schema}" (esperado "${USAGE_REPORT_SCHEMA}")`,
		);
	}
}
