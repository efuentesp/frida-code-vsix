import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { buildReport } from "../../src/usage/report-builder";
import { indexUsage } from "../../src/usage/indexer";
import {
	USAGE_REPORT_SCHEMA,
	assertUsageReport,
	type ReportIdentity,
} from "../../src/usage/report-schema";

const FIXTURE = [
	'{"type":"session","version":3,"id":"s1","timestamp":"2026-08-01T10:00:00.000Z","cwd":"/proj/demo"}',
	'{"type":"model_change","id":"m1","timestamp":"2026-08-01T10:00:00.000Z","provider":"zai","modelId":"glm-5"}',
	'{"type":"message","id":"a1","timestamp":"2026-08-01T10:01:00.000Z","message":{"role":"assistant","content":[{"type":"toolCall","id":"call_1","name":"write","arguments":{"path":"src/a.ts","content":"x\\ny\\nz"}}],"usage":{"input":100,"output":50,"cacheRead":200,"cacheWrite":0,"cost":{"total":0}}}}',
	'{"type":"message","id":"a2","timestamp":"2026-08-01T10:02:00.000Z","message":{"role":"assistant","content":[{"type":"text","text":"done"}],"usage":{"input":20,"output":10,"cacheRead":0,"cacheWrite":0,"cost":{"total":0}}}}',
].join("\n");

const ID: ReportIdentity = {
	org: "softtek",
	email: "a@b.com",
	project: "p",
	repo: "r",
	repoRemote: "",
	hostFingerprint: "h",
	timezone: "UTC",
	role: "dev",
};

const NOW = Date.parse("2026-08-03T00:00:00Z");

describe("report-builder", () => {
	let dir: string;
	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-rb-"));
		fs.writeFileSync(path.join(dir, "2026-08-01_s1.jsonl"), FIXTURE, "utf8");
	});
	afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

	it("ensambla un v1 válido que pasa assertUsageReport", () => {
		const { snapshot, periodFrom, periodTo } = indexUsage({
			sessionsDir: dir,
			period: "all",
			timezone: "UTC",
			now: NOW,
		});
		const report = buildReport({
			snapshot,
			identity: ID,
			detailLevel: "structured",
			period: "all",
			periodFrom,
			periodTo,
			clientVersion: "0.6.0",
			now: NOW,
		});
		expect(report.schema).toBe(USAGE_REPORT_SCHEMA);
		expect(() => assertUsageReport(report)).not.toThrow();
		expect(report.identity.email).toBe("a@b.com");
		expect(report.kpis.sessions).toBe(1);
	});

	it("nivel 'aggregated' vacía los breakdowns pero conserva KPIs", () => {
		const { snapshot, periodFrom, periodTo } = indexUsage({
			sessionsDir: dir,
			period: "all",
			timezone: "UTC",
			now: NOW,
		});
		const report = buildReport({
			snapshot,
			identity: ID,
			detailLevel: "aggregated",
			period: "all",
			periodFrom,
			periodTo,
			clientVersion: "0.6.0",
		});
		expect(report.kpis.sessions).toBe(1);
		expect(report.breakdowns.byModel).toEqual([]);
		expect(report.breakdowns.byLanguage).toEqual([]);
	});
});
