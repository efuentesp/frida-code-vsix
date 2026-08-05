import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { indexUsage } from "../../src/usage/indexer";
import {
	classifyFileType,
	fileTypeFamily,
} from "../../src/usage/artifact-classifier";

const FIXTURE = [
	'{"type":"session","version":3,"id":"s1","timestamp":"2026-08-01T10:00:00.000Z","cwd":"/proj/demo"}',
	'{"type":"model_change","id":"m1","timestamp":"2026-08-01T10:00:00.000Z","provider":"zai","modelId":"glm-5"}',
	'{"type":"message","id":"a1","timestamp":"2026-08-01T10:01:00.000Z","message":{"role":"assistant","content":[{"type":"text","text":"hola"},{"type":"toolCall","id":"call_1","name":"write","arguments":{"path":"src/a.ts","content":"line1\\nline2\\nline3"}}],"usage":{"input":100,"output":50,"cacheRead":200,"cacheWrite":0,"cost":{"total":0}}}}',
	'{"type":"message","id":"r1","timestamp":"2026-08-01T10:01:05.000Z","message":{"role":"toolResult","toolCallId":"call_1","toolName":"write","content":[{"type":"text","text":"Successfully wrote 30 bytes to src/a.ts"}]}}',
	'{"type":"message","id":"a2","timestamp":"2026-08-01T10:02:00.000Z","message":{"role":"assistant","content":[{"type":"text","text":"done"}],"usage":{"input":20,"output":10,"cacheRead":0,"cacheWrite":0,"cost":{"total":0}}}}',
].join("\n");

describe("indexer", () => {
	let dir: string;
	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-usage-"));
		fs.writeFileSync(path.join(dir, "2026-08-01_s1.jsonl"), FIXTURE, "utf8");
	});
	afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

	const NOW = Date.parse("2026-08-03T00:00:00Z");

	it("cuenta sesiones/turnos y atribuye usage al modelo activo", () => {
		const { snapshot } = indexUsage({
			sessionsDir: dir,
			period: "all",
			timezone: "UTC",
			now: NOW,
		});
		expect(snapshot.kpis.sessions).toBe(1);
		expect(snapshot.kpis.turns).toBe(2); // a1, a2
		expect(snapshot.breakdowns.byModel[0].model).toBe("glm-5");
		expect(snapshot.breakdowns.byModel[0].provider).toBe("zai");
	});

	it("cuenta assistedKloc por tipo de archivo desde toolCall arguments", () => {
		const { snapshot } = indexUsage({
			sessionsDir: dir,
			period: "all",
			timezone: "UTC",
			now: NOW,
		});
		const ts = snapshot.breakdowns.byFileType.find((f) => f.fileType === ".ts");
		expect(ts?.files).toBe(1);
		// 3 líneas = 0.003 kloc
		expect(ts?.assistedKloc).toBeCloseTo(0.003, 5);
		// familia legible + categoría
		expect(ts?.family).toBe("TypeScript · backend");
		// tokens del mensaje a1 (350) atribuidos al único tool (write)
		expect(ts?.tokens).toBe(350);
	});

	it("bucketiza turnos por hora (UTC)", () => {
		const { snapshot } = indexUsage({
			sessionsDir: dir,
			period: "all",
			timezone: "UTC",
			now: NOW,
		});
		const total = snapshot.breakdowns.byHour.reduce((a, b) => a + b, 0);
		expect(total).toBe(2); // a1@10:01, a2@10:02 UTC
	});

	it("filtra por periodo (today excluye sesiones previas)", () => {
		const { snapshot } = indexUsage({
			sessionsDir: dir,
			period: "today",
			timezone: "UTC",
			now: NOW,
		});
		expect(snapshot.kpis.sessions).toBe(0);
	});

	it("consolida totales: ΣbyDay y Σsesiones == KPI (incluye caché)", () => {
		const { snapshot } = indexUsage({
			sessionsDir: dir,
			period: "all",
			timezone: "UTC",
			now: NOW,
		});
		const kpiTotal = snapshot.kpis.tokensIn + snapshot.kpis.tokensOut;
		const byDayTotal = snapshot.breakdowns.byDay.reduce(
			(a, b) => a + b.tokens,
			0,
		);
		const sessionsTotal = snapshot.sessions.reduce(
			(a, s) => a + s.tokensIn + s.tokensOut,
			0,
		);
		// a1: in=100+cacheRead200, out=50 ; a2: in=20, out=10
		// tokensIn=320, tokensOut=60 → total 380; ΣbyDay idéntico (ya incluye caché).
		expect(kpiTotal).toBe(380);
		expect(byDayTotal).toBe(kpiTotal); // cuadre exacto: el bug del caché ya no existe
		expect(sessionsTotal).toBe(kpiTotal);
		// caché poblado (antes siempre 0) y cache hit real
		expect(snapshot.kpis.cacheRead).toBe(200);
		expect(snapshot.kpis.cacheHitPct).toBe(63); // 200/(100+200+20)=62.5→63
	});
});

describe("classifyFileType", () => {
	it("devuelve la extensión con punto (sin agrupar)", () => {
		expect(classifyFileType("src/a.ts")).toBe(".ts");
		expect(classifyFileType("comp/b.tsx")).toBe(".tsx");
		expect(classifyFileType("docs/README.md")).toBe(".md");
		expect(classifyFileType("Dockerfile")).toBe(".dockerfile");
		expect(classifyFileType("Makefile")).toBe(".makefile");
		expect(classifyFileType("LICENSE")).toBe("(sin ext)");
	});
});

describe("fileTypeFamily", () => {
	it("familia legible + categoría para el tooltip", () => {
		expect(fileTypeFamily("comp/b.tsx")).toBe("TypeScript JSX · frontend");
		expect(fileTypeFamily("src/a.ts")).toBe("TypeScript · backend");
		expect(fileTypeFamily("docs/README.md")).toBe("Markdown · docs");
		expect(fileTypeFamily("pkg.json")).toBe("JSON · config");
	});
});
