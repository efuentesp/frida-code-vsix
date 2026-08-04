// Ensambla frida-usage-report/v1 desde el snapshot del indexer + la identidad +
// el nivel de detalle (privacy creciente). effectiveness/quality quedan en defaults (F3/F4).
// Diseño: .rpiv/artifacts/designs/2026-08-03_21-38-12_frida-usage-telemetry.md

import {
	USAGE_REPORT_SCHEMA,
	emptyEffectiveness,
	emptyQuality,
	type UsageReport,
	type ReportIdentity,
	type DetailLevel,
	type PeriodGranularity,
} from "./report-schema";
import type { UsageSnapshot, Period } from "./indexer";

export interface BuildReportOptions {
	snapshot: UsageSnapshot;
	identity: ReportIdentity;
	detailLevel: DetailLevel;
	/** Periodo consultado (para period.granularity + from/to). */
	period: Period;
	periodFrom: number;
	periodTo: number;
	clientVersion: string;
	now?: number;
}

function periodGranularity(_period: Period): PeriodGranularity {
	// F1 bucketiza por día en todos los modos; el concentrador puede re-agrupar.
	return "day";
}

/** Ensambla frida-usage-report/v1 desde el snapshot + identidad + nivel de detalle. */
export function buildReport(opts: BuildReportOptions): UsageReport {
	const { snapshot, identity, detailLevel, period } = opts;
	const now = opts.now ?? Date.now();
	const minimal = detailLevel === "aggregated";
	const consent = { telemetryOptIn: !!identity.email, detailLevel };
	return {
		schema: USAGE_REPORT_SCHEMA,
		generatedAt: new Date(now).toISOString(),
		clientVersion: opts.clientVersion,
		period: {
			from: new Date(opts.periodFrom).toISOString(),
			to: new Date(opts.periodTo).toISOString(),
			granularity: periodGranularity(period),
		},
		identity,
		consent,
		kpis: snapshot.kpis,
		breakdowns: minimal
			? {
					...snapshot.breakdowns,
					byModel: [],
					byProvider: [],
					byTool: [],
					byLanguage: [],
					byArtifact: [],
					byDay: [],
				}
			: snapshot.breakdowns,
		behavior: snapshot.behavior,
		adoption: minimal
			? { ...snapshot.adoption, skillsUsed: [] }
			: snapshot.adoption,
		effectiveness: emptyEffectiveness(), // F4
		quality: emptyQuality(), // F3
	};
}
