/**
 * frida-subagents — tests del modo detached (issue #26, ADR-0037).
 *
 * Usa un child FALSO (`node -e` que emite eventos --mode json y sale) via
 * _cliOverride, con FRIDA_DETACHED_DIR apuntando a un tmpdir — nada toca
 * ~/.frida real ni spawn pi.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const FAKE_EVENTS = [
	{ type: "tool_execution_start", toolName: "read" },
	{ type: "tool_execution_end" },
	{ type: "turn_end" },
	{
		type: "message_end",
		message: {
			role: "assistant",
			usage: { input: 100, output: 50 },
			content: [{ type: "text", text: "Análisis: todo bien." }],
		},
	},
];

/** Escribe un child FALSO a disco: emite eventos --mode json y sale con exitCode.
 *  (_cliOverride es una RUTA de script — el argv del child no es fiable para
 *  pasar payload porque lleva flags del CLI real). */
function writeFakeCli(events: unknown[], exitCode = 0): string {
	const name = `fake-cli-${Date.now()}-${Math.floor(Math.random() * 1e6)}.mjs`;
	const p = path.join(tmpRoot, name);
	fs.writeFileSync(
		p,
		[
			`const evs = ${JSON.stringify(events)};`,
			"for (const e of evs) console.log(JSON.stringify(e));",
			`process.exitCode = ${exitCode};`,
		].join("\n"),
		"utf8",
	);
	return p;
}

let tmpRoot: string;

beforeEach(() => {
	tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "frida-detached-"));
	process.env.FRIDA_DETACHED_DIR = path.join(tmpRoot, "runs");
});

afterEach(() => {
	delete process.env.FRIDA_DETACHED_DIR;
	fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("detached-registry", () => {
	it("nextRunId genera ids secuenciales sin reuso", async () => {
		const { nextRunId, writeMeta } = await import(
			"../../src/tools/frida-subagents/detached-registry"
		);
		expect(nextRunId()).toBe("det-1");
		writeMeta({
			id: "det-1",
			status: "running",
			pid: 1,
			spawnPid: 1,
			cwd: "/x",
			promptPreview: "p",
			startedAt: 1,
			logPath: "/x/log",
			agentType: "general-purpose",
		});
		expect(nextRunId()).toBe("det-2");
	});

	it("readMeta/writeMeta redondean por disco", async () => {
		const { writeMeta, readMeta } = await import(
			"../../src/tools/frida-subagents/detached-registry"
		);
		writeMeta({
			id: "det-9",
			status: "running",
			pid: 42,
			spawnPid: 7,
			cwd: "/x",
			promptPreview: "hola",
			startedAt: 123,
			logPath: "/x/l",
			agentType: "Explore",
		});
		const m = readMeta("det-9");
		expect(m?.pid).toBe(42);
		expect(m?.agentType).toBe("Explore");
	});

	it("reconcileRuns marca lost a los running sin proceso", async () => {
		const { writeMeta, reconcileRuns, readMeta } = await import(
			"../../src/tools/frida-subagents/detached-registry"
		);
		writeMeta({
			id: "det-1",
			status: "running",
			pid: 999999999, // inexistente
			spawnPid: process.pid,
			cwd: "/x",
			promptPreview: "",
			startedAt: 1,
			logPath: "/x/l",
			agentType: "t",
		});
		const { changed } = reconcileRuns();
		expect(changed.map((m) => m.id)).toContain("det-1");
		expect(readMeta("det-1")?.status).toBe("lost");
	});

	it("reconcileRuns marca orphaned si el child vive pero el padre murió", async () => {
		const { writeMeta, reconcileRuns, readMeta } = await import(
			"../../src/tools/frida-subagents/detached-registry"
		);
		writeMeta({
			id: "det-2",
			status: "running",
			pid: process.pid, // vivo (somos nosotros)
			spawnPid: 999999999, // padre muerto
			cwd: "/x",
			promptPreview: "",
			startedAt: 1,
			logPath: "/x/l",
			agentType: "t",
		});
		reconcileRuns();
		expect(readMeta("det-2")?.status).toBe("orphaned");
	});
});

describe("detached-log", () => {
	it("parseProgress cuenta tools/turns/tokens y describe actividad", async () => {
		const { parseProgressFromLines } = await import(
			"../../src/tools/frida-subagents/detached-log"
		);
		const p = parseProgressFromLines(FAKE_EVENTS.map((e) => JSON.stringify(e)));
		expect(p.toolUses).toBe(1);
		expect(p.turnCount).toBe(1);
		expect(p.tokensIn).toBe(100);
		expect(p.tokensOut).toBe(50);
		expect(p.activity).toContain("escribiendo");
		expect(p.lastText).toContain("todo bien");
	});

	it("parseOutcome extrae resultado final y tokens (#18)", async () => {
		const { parseOutcome } = await import(
			"../../src/tools/frida-subagents/detached-log"
		);
		const log = path.join(tmpRoot, "log.jsonl");
		fs.writeFileSync(log, FAKE_EVENTS.map((e) => JSON.stringify(e)).join("\n"));
		const o = parseOutcome(log)!;
		expect(o.status).toBe("completed");
		expect(o.result).toContain("todo bien");
		expect(o.tokensIn + o.tokensOut).toBe(150);
	});

	it("parseOutcome devuelve undefined si no hubo asistente (child roto)", async () => {
		const { parseOutcome } = await import(
			"../../src/tools/frida-subagents/detached-log"
		);
		const log = path.join(tmpRoot, "log.jsonl");
		fs.writeFileSync(log, '{"type":"tool_execution_start"}\n');
		expect(parseOutcome(log)).toBeUndefined();
	});

	it("tailLogLines descarta la primera línea si el corte cae a medias", async () => {
		const { tailLogLines } = await import(
			"../../src/tools/frida-subagents/detached-log"
		);
		const log = path.join(tmpRoot, "log.jsonl");
		const big = '{"type":"m","pad":"' + "x".repeat(500) + '"}';
		fs.writeFileSync(log, [big, big, big].join("\n"));
		// Tail de 100 bytes: cae en medio de una línea → primera parcial fuera.
		const lines = tailLogLines(log, 100);
		for (const l of lines) expect(() => JSON.parse(l)).not.toThrow();
	});
});

describe("detached-runner (child falso)", () => {
	const baseConfig = {
		name: "general-purpose",
		description: "test",
		systemPrompt: "",
		promptMode: "replace" as const,
	};

	it("spawn → completed con resultado y tokens del log", async () => {
		const { spawnDetachedAgent } = await import(
			"../../src/tools/frida-subagents/detached-runner"
		);
		const h = spawnDetachedAgent({
			prompt: "analiza",
			description: "prueba",
			config: baseConfig,
			agentDir: tmpRoot,
			cwd: tmpRoot,
			_cliOverride: writeFakeCli(FAKE_EVENTS, 0),
		});
		expect(h.id).toBe("det-1");
		expect(h.pid).toBeGreaterThan(0);
		const code = await h.exit;
		expect(code).toBe(0);
		const { readMeta } = await import(
			"../../src/tools/frida-subagents/detached-registry"
		);
		const m = readMeta(h.id)!;
		// El exit handler corre async tras exit — dar un tick.
		for (let i = 0; i < 20 && m.status === "running"; i++) {
			await new Promise((r) => setTimeout(r, 50));
		}
		expect(m.status).toBe("completed");
		expect(m.result).toContain("todo bien");
		expect(m.tokensIn).toBe(100);
	});

	it("spawn con exit 1 pero resultado completo → el resultado gana", async () => {
		const { spawnDetachedAgent } = await import(
			"../../src/tools/frida-subagents/detached-runner"
		);
		// Semántica deliberada (difiere de classifyChildExit de pbs): si el child
		// produjo un resultado completo y persistido, el exit code posterior no
		// descarta el trabajo — el meta queda completed con exitCode registrado.
		const h = spawnDetachedAgent({
			prompt: "x",
			description: "falla",
			config: baseConfig,
			agentDir: tmpRoot,
			cwd: tmpRoot,
			_cliOverride: writeFakeCli(FAKE_EVENTS, 1),
		});
		expect(await h.exit).toBe(1);
		const { readMeta } = await import(
			"../../src/tools/frida-subagents/detached-registry"
		);
		for (let i = 0; i < 20 && readMeta(h.id)?.status === "running"; i++) {
			await new Promise((r) => setTimeout(r, 50));
		}
		const m = readMeta(h.id)!;
		expect(m.status).toBe("completed");
		expect(m.exitCode).toBe(1);
	});

	it("child que muere sin emitir nada → failed honesto", async () => {
		const { spawnDetachedAgent } = await import(
			"../../src/tools/frida-subagents/detached-runner"
		);
		const h = spawnDetachedAgent({
			prompt: "x",
			description: "mudo",
			config: baseConfig,
			agentDir: tmpRoot,
			cwd: tmpRoot,
			_cliOverride: writeFakeCli([], 3),
		});
		const code = await h.exit;
		expect(code).toBe(3);
		const { readMeta } = await import(
			"../../src/tools/frida-subagents/detached-registry"
		);
		for (let i = 0; i < 20 && readMeta(h.id)?.status === "running"; i++) {
			await new Promise((r) => setTimeout(r, 50));
		}
		const m = readMeta(h.id)!;
		expect(m.status).toBe("failed");
		expect(m.failureReason).toContain("3");
	});
});

describe("detached-panel", () => {
	it("buildDetachedPanel serializa runs con progreso", async () => {
		const { writeMeta } = await import(
			"../../src/tools/frida-subagents/detached-registry"
		);
		const { buildDetachedPanel } = await import(
			"../../src/tools/frida-subagents/detached-panel"
		);
		const log = path.join(tmpRoot, "l.jsonl");
		fs.writeFileSync(log, FAKE_EVENTS.map((e) => JSON.stringify(e)).join("\n"));
		writeMeta({
			id: "det-1",
			name: "audita",
			status: "running",
			pid: process.pid, // vivo
			spawnPid: 999999999,
			cwd: "/x",
			promptPreview: "preview",
			startedAt: Date.now(),
			logPath: log,
			agentType: "Explore",
			model: "devengine/gpt-5.4-mini",
		});
		const panel = buildDetachedPanel();
		expect(panel.kind).toBe("detached_panel");
		const run = panel.runs.find((r) => r.id === "det-1")!;
		expect(run.activity).toContain("escribiendo");
		expect(run.tokensIn).toBe(100);
	});

	it("syncDetachedToWidget refleja runs 🛰 en el store del footer", async () => {
		const { writeMeta } = await import(
			"../../src/tools/frida-subagents/detached-registry"
		);
		const { syncDetachedToWidget, _resetDetachedWidgetFeed } = await import(
			"../../src/tools/frida-subagents/detached-panel"
		);
		const { agentWidgetStore } = await import(
			"../../src/tools/frida-subagents/store"
		);
		const log = path.join(tmpRoot, "l2.jsonl");
		fs.writeFileSync(log, FAKE_EVENTS.map((e) => JSON.stringify(e)).join("\n"));
		writeMeta({
			id: "det-5",
			name: "audita",
			status: "running",
			pid: process.pid, // vivo
			spawnPid: process.pid,
			cwd: "/x",
			promptPreview: "",
			startedAt: Date.now(),
			logPath: log,
			agentType: "Explore",
		});
		writeMeta({
			id: "det-6",
			name: "listo",
			status: "completed",
			pid: 999999999,
			spawnPid: process.pid,
			cwd: "/x",
			promptPreview: "",
			startedAt: 1,
			endedAt: 2,
			logPath: "/x",
			agentType: "general-purpose",
		});
		try {
			syncDetachedToWidget();
			const snap = agentWidgetStore.getSnapshot();
			const live = snap.find((a) => a.id === "det-5")!;
			expect(live.description).toContain("🛰 audita");
			expect(live.status).toBe("running");
			expect(live.tokens).toBe(150);
			expect(live.activity).toContain("escribiendo");
			const done = snap.find((a) => a.id === "det-6")!;
			expect(done.status).toBe("completed");
		} finally {
			_resetDetachedWidgetFeed();
		}
	});
});
