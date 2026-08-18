// frida-extensible-workflows · workflow_gc (#69) — núcleo de clasificación y
// purga de runs huérfanos.
//
// Un run huérfano vive en disco (~/.frida/projects/<proj>/<session>/runs/) sin
// handle vivo: su sesión murió (F5, host reiniciado, sesión borrada) con el run
// running/awaiting. workflow_stop ya no lo alcanza (registry por sesión) y el
// checkpoint nunca se aprobará. Este módulo los detecta, clasifica y purga con
// candados — sin tocar jamás runs de sesiones vivas ni de la sesión actual.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	scanOrphans,
	purgeOrphans,
} from "../../src/tools/frida-extensible-workflows/gc";

/** PID que con certeza no existe (> pid_max en Linux y macOS → ESRCH). */
const DEAD_PID = 999_999_998;
/** PID de ESTE proceso — con certeza vivo (lease válido). */
const ALIVE_PID = process.pid;

let home: string;

/** Crea un árbol temporal falso: <home>/.frida/projects/<projKey>/<sess>/runs/<runId>/. */
function seedTree(): void {
	const projKey = makeProjKey();
	const base = join(home, ".frida/projects", projKey, "sessions");
	mkdirSync(base, { recursive: true });
}

function makeProjKey(): string {
	// Imita projectStorageKey: <slug>-<hash12>. El GC no debe depender del
	// formato exacto (escanea todo ~/.frida/projects/*/sessions/*).
	return "frida-llops-abc123def456";
}

function seedSession(sess: string, ownerPid: number | null): void {
	const dir = join(home, ".frida/projects", makeProjKey(), "sessions", sess);
	mkdirSync(join(dir, "runs"), { recursive: true });
	if (ownerPid !== null) {
		writeFileSync(
			join(dir, "owner.json"),
			JSON.stringify({ pid: ownerPid, token: "tok", startedAt: Date.now() - 1000 }),
		);
	}
}

function seedRun(
	sess: string,
	runId: string,
	state: string,
	ageDays: number,
): void {
	const dir = join(
		home,
		".frida/projects",
		makeProjKey(),
		"sessions",
		sess,
		"runs",
		runId,
	);
	mkdirSync(dir, { recursive: true });
	const ts = new Date(Date.now() - ageDays * 86_400_000).toISOString();
	writeFileSync(
		join(dir, "summary.json"),
		JSON.stringify({
			schemaVersion: 1,
			runId,
			sessionId: sess,
			workflowName: "aidd-plan",
			state,
			createdAt: ts,
			updatedAt: ts,
			...(state === "awaiting" ? { checkpointName: "stage-prd" } : {}),
		}),
	);
	// Journal mínimo (para el tail del purgado atascado).
	writeFileSync(
		join(dir, "journal.jsonl"),
		[
			JSON.stringify({ op: "agent", label: "stage brief", value: "brief.md listo" }),
			JSON.stringify({ op: "agent", label: "stage prd", value: "prd.md listo" }),
			JSON.stringify({ op: "checkpoint", name: "stage-prd", state: "pending" }),
		].join("\n"),
	);
}

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "wf-gc-home-"));
	seedTree();
});

afterEach(() => {
	rmSync(home, { recursive: true, force: true });
});

describe("frida-extensible-workflows · workflow_gc scan (#69)", () => {
	it("clasifica: viva (lease) no se lista; huérfano terminal y atascado sí", async () => {
		seedSession("sess-alive", ALIVE_PID);
		seedRun("sess-alive", "run-alive-running", "running", 0);
		seedRun("sess-alive", "run-alive-await", "awaiting", 0);
		seedSession("sess-dead", null); // nunca hubo lease
		seedRun("sess-dead", "run-dead-failed", "failed", 3);
		seedRun("sess-dead", "run-dead-await", "awaiting", 3);

		const orphans = await scanOrphans({ home });

		const ids = orphans.map((o) => o.runId);
		expect(ids).toContain("run-dead-failed");
		expect(ids).toContain("run-dead-await");
		expect(ids).not.toContain("run-alive-running");
		expect(ids).not.toContain("run-alive-await");

		const stuck = orphans.find((o) => o.runId === "run-dead-await");
		expect(stuck?.kind).toBe("stuck");
		expect(stuck?.checkpointName).toBe("stage-prd");
		const terminal = orphans.find((o) => o.runId === "run-dead-failed");
		expect(terminal?.kind).toBe("terminal");
	}, 15000);

	it("lease muerto (pid inexistente) también es huérfano — no basta con que exista owner.json", async () => {
		seedSession("sess-lease-muerto", DEAD_PID);
		seedRun("sess-lease-muerto", "run-x", "running", 5);

		const orphans = await scanOrphans({ home });
		expect(orphans.map((o) => o.runId)).toContain("run-x");
		expect(orphans[0]?.kind).toBe("stuck");
	}, 15000);

	it("la sesión ACTUAL nunca se lista, aunque el lease haya muerto (se gestiona aparte)", async () => {
		// La sesión actual se identifica por el lease del propio home real; en el
		// test la pasamos explícita: scanOrphans la excluye SIEMPRE.
		seedSession("sess-actual", DEAD_PID);
		seedRun("sess-actual", "run-mio", "awaiting", 0);

		const orphans = await scanOrphans({
			home,
			excludeSessionIds: ["sess-actual"],
		});
		expect(orphans.map((o) => o.runId)).not.toContain("run-mio");
	}, 15000);
});

describe("frida-extensible-workflows · workflow_gc purge (#69)", () => {
	it("purga huérfanos con candados: respeta olderThanDays y stuckOnly", async () => {
		seedSession("sess-d", null);
		seedRun("sess-d", "run-fresh", "failed", 1); // < 2 días → NO
		seedRun("sess-d", "run-old-failed", "failed", 3);
		seedRun("sess-d", "run-old-stuck", "awaiting", 3);

		const r1 = await purgeOrphans({ home });
		expect(r1.purged.map((p) => p.runId).sort()).toEqual([
			"run-old-failed",
			"run-old-stuck",
		]);

		// Re-seed para stuckOnly.
		seedRun("sess-d", "run-old-failed2", "failed", 3);
		seedRun("sess-d", "run-old-stuck2", "awaiting", 3);
		const r2 = await purgeOrphans({ home, stuckOnly: true });
		expect(r2.purged.map((p) => p.runId)).toEqual(["run-old-stuck2"]);
	}, 15000);

	it("NUNCA purga runs de sesiones vivas (lease válido), aunque sean viejos", async () => {
		seedSession("sess-viva", ALIVE_PID);
		seedRun("sess-viva", "run-vivo-viejo", "running", 10);
		seedSession("sess-muerta", null);
		seedRun("sess-muerta", "run-muerto", "failed", 10);

		const r = await purgeOrphans({ home });
		expect(r.purged.map((p) => p.runId)).toEqual(["run-muerto"]);
		// El vivo sigue en disco.
		expect(
			readFileSync(join(home, ".frida/projects", makeProjKey(), "sessions/sess-viva/runs/run-vivo-viejo/summary.json"), "utf8"),
		).toContain("run-vivo-viejo");
	}, 15000);

	it("al purgar un atascado, la salida incluye tail del journal + checkpoint pendiente", async () => {
		seedSession("sess-s", null);
		seedRun("sess-s", "run-stuck", "awaiting", 3);

		const r = await purgeOrphans({ home });
		const stuck = r.purged.find((p) => p.runId === "run-stuck");
		expect(stuck?.journalTail).toContain("stage-prd");
		expect(stuck?.journalTail).toContain("prd.md listo");
	}, 15000);

	it("runIds acota la purga a los pedidos (🗑 por run del panel)", async () => {
		seedSession("sess-r", null);
		seedRun("sess-r", "run-a", "failed", 3);
		seedRun("sess-r", "run-b", "failed", 3);

		const r = await purgeOrphans({ home, runIds: ["run-a"] });
		expect(r.purged.map((p) => p.runId)).toEqual(["run-a"]);
	}, 15000);
});
