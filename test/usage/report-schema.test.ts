import { describe, it, expect } from "vitest";
import {
	USAGE_REPORT_SCHEMA,
	assertUsageReport,
	emptyKpis,
	emptyBreakdowns,
	emptyBehavior,
	emptyAdoption,
	emptyEffectiveness,
	emptyQuality,
	type UsageReport,
} from "../../src/usage/report-schema";

describe("report-schema (frida-usage-report/v1)", () => {
	it("USAGE_REPORT_SCHEMA es la versión v1 estable", () => {
		expect(USAGE_REPORT_SCHEMA).toBe("frida-usage-report/v1");
	});

	it("emptyBreakdowns inicializa byHour(24) y byDow(7) en ceros", () => {
		const b = emptyBreakdowns();
		expect(b.byHour).toHaveLength(24);
		expect(b.byDow).toHaveLength(7);
		expect(b.byHour.every((n) => n === 0)).toBe(true);
	});

	it("los defaults exponen los campos F2–F3 en 0/false/[]", () => {
		expect(emptyBehavior().bugFixSignals).toBe(0);
		expect(emptyBehavior().rework).toBe(0);
		expect(emptyAdoption().skillsUsed).toEqual([]);
		expect(emptyQuality().diagnosticsOnWrite).toBe(0);
		expect(emptyBreakdowns().bySdlcPhase).toEqual([]);
	});

	it("assertUsageReport acepta un v1 bien formado", () => {
		const report: UsageReport = {
			schema: USAGE_REPORT_SCHEMA,
			generatedAt: "2026-08-03T21:38:12-0600",
			clientVersion: "0.6.0",
			period: { from: "2026-08-01", to: "2026-08-03", granularity: "day" },
			identity: {
				org: "softtek",
				email: "a@b.com",
				project: "p",
				repo: "r",
				repoRemote: "",
				hostFingerprint: "h",
				timezone: "America/Mexico_City",
				role: "dev",
			},
			consent: { telemetryOptIn: true, detailLevel: "structured" },
			kpis: emptyKpis(),
			breakdowns: emptyBreakdowns(),
			behavior: emptyBehavior(),
			adoption: emptyAdoption(),
			effectiveness: emptyEffectiveness(),
			quality: emptyQuality(),
		};
		expect(() => assertUsageReport(report)).not.toThrow();
	});

	it("assertUsageReport rechaza schema desconocido / null", () => {
		expect(() =>
			assertUsageReport({ schema: "frida-usage-report/v2" }),
		).toThrow();
		expect(() => assertUsageReport(null)).toThrow();
	});
});
