// monitor-server.test.ts — servidor HTTP+SSE + watcher del monitor (FR#7/FR#8).
// Molde: test/frida-workflow/board.test.ts (fixture tmp + mkdtemp). La
// plantilla del servidor es node_modules/pi-mcp-adapter/ui-server.ts; los
// deltas del FRD (401 sin token en POST, GET abierto, vida larga) se afirman
// aquí. Los tests de SSE usan fetch-streaming con un lector en background y
// márgenes derivados de MONITOR_DEBOUNCE_MS (NFR <1s con debounce incluido).
import { mkdirSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	MONITOR_DEBOUNCE_MS,
	startPipelineMonitor,
	type PipelineMonitorHandle,
} from "../../src/tools/frida-workflow/monitor-server";
import {
	featuresFilePath,
	loadFeatures,
	reconcileFeatures,
	saveFeatures,
} from "../../src/tools/frida-workflow/features";

let tmp: string;
let handle: PipelineMonitorHandle | undefined;
let sse: SseConnection | undefined;

beforeEach(() => {
	tmp = mkdtempSync(path.join(tmpdir(), "monitor-test-"));
});

afterEach(async () => {
	await sse?.close();
	sse = undefined;
	handle?.dispose(); // idempotente
	handle = undefined;
	vi.restoreAllMocks();
});

async function startMonitor(
	onCommand?: (command: string) => void,
): Promise<PipelineMonitorHandle> {
	handle = await startPipelineMonitor({ cwd: tmp, onCommand });
	return handle;
}

/** POST JSON (con o sin token). */
async function postJson(
	h: PipelineMonitorHandle,
	pathname: string,
	body: unknown,
	token?: string,
): Promise<Response> {
	const headers: Record<string, string> = {};
	if (token) headers["x-frida-monitor-token"] = token;
	return fetch(`${h.url}${pathname}`, {
		method: "POST",
		headers,
		body: JSON.stringify(body),
	});
}

const sleep = (ms: number): Promise<void> =>
	new Promise((r) => setTimeout(r, ms));

/** Escribe un artefacto .md con frontmatter bajo tmp (ruta relativa con `/`). */
function writeArtifact(
	rel: string,
	frontmatter: Record<string, string> = {},
): string {
	const abs = path.join(tmp, ...rel.split("/"));
	mkdirSync(path.dirname(abs), { recursive: true });
	const fm = Object.entries(frontmatter)
		.map(([k, v]) => `${k}: ${v}`)
		.join("\n");
	writeFileSync(abs, `---\n${fm}\n---\n\n# doc\n`, "utf8");
	return abs;
}

const FRD = ".frida/artifacts/discover/2026-01-01_10-00-00_mi-feature.md";
const RESEARCH_REL =
	".frida/artifacts/research/2026-01-02_10-00-00_mi-feature.md";
const DESIGN_REL = ".frida/artifacts/designs/2026-01-03_10-00-00_mi-feature.md";
const PLAN_REL = ".frida/artifacts/plans/2026-01-04_10-00-00_mi-feature.md";

/** Plan con fases `## FN` reales (syncUnitsFromPlan sólo parsea headers). */
function writePlan(rel: string, parent: string, titles: string[]): void {
	const abs = writeArtifact(rel, { parent });
	const body = titles.map((t, i) => `## F0${i + 1} — ${t}`).join("\n");
	writeFileSync(abs, `---\nparent: ${parent}\n---\n\n${body}\n`, "utf8");
}

// ── SSE: lector en background + waitFor ─────────────────────────────────

type SseEvent = { id: number; event: string; data: string };

interface SseConnection {
	events: SseEvent[];
	waitFor(pred: (e: SseEvent) => boolean, timeoutMs?: number): Promise<SseEvent>;
	close(): Promise<void>;
}

function parseFrame(frame: string): SseEvent | undefined {
	let id: number | undefined;
	let event: string | undefined;
	let data: string | undefined;
	for (const line of frame.split("\n")) {
		if (line.startsWith(":")) continue; // heartbeat/comentarios
		if (line.startsWith("id: ")) id = Number(line.slice(4));
		else if (line.startsWith("event: ")) event = line.slice(7);
		else if (line.startsWith("data: ")) data = line.slice(6);
	}
	return id !== undefined && event !== undefined && data !== undefined
		? { id, event, data }
		: undefined;
}

async function connectSse(
	base: string,
	lastEventId?: number,
): Promise<SseConnection> {
	const res = await fetch(`${base}events`, {
		headers:
			lastEventId === undefined ? {} : { "Last-Event-ID": String(lastEventId) },
	});
	expect(res.status).toBe(200);
	expect(res.headers.get("content-type")).toContain("text/event-stream");
	const reader = res.body!.getReader();
	const decoder = new TextDecoder();
	const events: SseEvent[] = [];
	let buf = "";
	let stop = false;
	const pump = (async () => {
		try {
			while (!stop) {
				const { done, value } = await reader.read();
				if (done) break;
				buf += decoder.decode(value, { stream: true });
				let idx = buf.indexOf("\n\n");
				while (idx >= 0) {
					const frame = buf.slice(0, idx);
					buf = buf.slice(idx + 2);
					const ev = parseFrame(frame);
					if (ev) events.push(ev);
					idx = buf.indexOf("\n\n");
				}
			}
		} catch {
			/* conexión cerrada */
		}
	})();
	async function waitFor(
		pred: (e: SseEvent) => boolean,
		timeoutMs = 3000,
	): Promise<SseEvent> {
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			const hit = [...events].reverse().find(pred);
			if (hit) return hit;
			if (Date.now() > deadline) throw new Error("timeout esperando evento SSE");
			await sleep(25);
		}
	}
	return {
		events,
		waitFor,
		close: async () => {
			stop = true;
			try {
				await reader.cancel();
			} catch {
				/* ya cerrado */
			}
			await pump;
		},
	};
}

/** data de un evento como snapshot tipado (fields usados por los tests). */
function snapshotOf(e: SseEvent): {
	specs: Array<{ id: string }>;
	features: Array<{
		id: string;
		stage: string;
		title?: string;
		desync?: boolean;
		paused?: boolean;
	}>;
	boards: Array<{
		path: string;
		units: Array<{ status: string; done: boolean; validateFails: number }>;
	}>;
} {
	return JSON.parse(e.data);
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("servidor — arranque loopback puerto efímero (D3/NFR)", () => {
	it("127.0.0.1 efímero, token UUID por proceso y dispose cierra", async () => {
		const h = await startMonitor();
		expect(h.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
		expect(h.port).toBeGreaterThan(0);
		expect(h.token).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);
		expect((await fetch(`${h.url}api/state`)).status).toBe(200);
		h.dispose();
		await expect(fetch(`${h.url}api/state`)).rejects.toThrow();
	});

	it("workspace sin .frida arranca sin error; / y /sdd sirven la página mínima", async () => {
		const h = await startMonitor();
		for (const p of ["", "sdd"]) {
			const res = await fetch(`${h.url}${p}`);
			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toContain("text/html");
			expect(await res.text()).toContain("Frida Monitor");
		}
		const state = await (await fetch(`${h.url}api/state`)).json();
		expect(state.features).toEqual([]);
		expect(state.specs.map((s: { id: string }) => s.id)).toContain("sdd");
	});
});

describe("auth — POST exige token, 401 sin él (FR#8; delta vs 403 plantilla)", () => {
	it("sin token o token inválido → 401; header propio y Bearer válidos → 200", async () => {
		const h = await startMonitor();
		expect((await postJson(h, "api/advance", { id: FRD })).status).toBe(401);
		expect(
			(await postJson(h, "api/advance", { id: FRD }, "token-equivocado")).status,
		).toBe(401);
		expect(
			(await postJson(h, "api/advance", { id: "no-existe.md" }, h.token)).status,
		).toBe(200);
		const bearer = await fetch(`${h.url}api/pause`, {
			method: "POST",
			headers: { Authorization: `Bearer ${h.token}` },
			body: JSON.stringify({ id: "no-existe.md", paused: true }),
		});
		expect(bearer.status).toBe(200);
	});

	it("cuerpo inválido o sin id → 400; ruta POST desconocida → 404", async () => {
		const h = await startMonitor();
		const bad = await fetch(`${h.url}api/advance`, {
			method: "POST",
			headers: { "x-frida-monitor-token": h.token },
			body: "{no-json",
		});
		expect(bad.status).toBe(400);
		expect((await postJson(h, "api/advance", {}, h.token)).status).toBe(400);
		expect((await postJson(h, "api/nada", { id: "x" }, h.token)).status).toBe(
			404,
		);
	});
});

describe("GET /api/state — snapshot del ecosistema (FR#7/FR#12)", () => {
	it("adopta FRDs escritos al FS (reconcile por GET, FR#3) con title y desync", async () => {
		const h = await startMonitor();
		writeArtifact(FRD, { status: "ready" });
		const state = await (await fetch(`${h.url}api/state`)).json();
		expect(state.features).toHaveLength(1);
		expect(state.features[0]).toMatchObject({
			id: FRD,
			stage: "discover",
			title: "mi-feature",
			desync: false,
		});
	});
});

describe("POST /api/advance — mismo disparo que el overlay (FR#4)", () => {
	it("avanza, entrega el comando pre-move al host (onCommand) y responde", async () => {
		writeArtifact(FRD);
		reconcileFeatures(tmp);
		const onCommand = vi.fn();
		const h = await startMonitor(onCommand);
		const res = await (
			await postJson(h, "api/advance", { id: FRD }, h.token)
		).json();
		expect(res).toMatchObject({
			moved: true,
			to: "research",
			prerequisitesMet: true,
			command: `/skill:research ${FRD}`,
		});
		expect(onCommand).toHaveBeenCalledTimes(1);
		expect(onCommand).toHaveBeenCalledWith(`/skill:research ${FRD}`);
		expect(loadFeatures(tmp)!.features[0]!.stage).toBe("research");
	});

	it("sin insumo previo: mueve igual y responde warning FR#14", async () => {
		writeArtifact(FRD);
		reconcileFeatures(tmp);
		const state = loadFeatures(tmp)!;
		state.features[0]!.stage = "research"; // sin artefacto research real
		saveFeatures(tmp, state);
		const h = await startMonitor();
		const res = await (
			await postJson(h, "api/advance", { id: FRD }, h.token)
		).json();
		expect(res.moved).toBe(true);
		expect(res.to).toBe("design");
		expect(res.prerequisitesMet).toBe(false);
		expect(res.warning).toContain("no está en el FS");
	});
});

describe("POST /api/pause — flag persistido (FR#11)", () => {
	it("pausa y reanuda; feature inexistente → ok:false", async () => {
		writeArtifact(FRD);
		reconcileFeatures(tmp);
		const h = await startMonitor();
		const on = await (
			await postJson(h, "api/pause", { id: FRD, paused: true }, h.token)
		).json();
		expect(on).toEqual({ ok: true, paused: true });
		expect(loadFeatures(tmp)!.features[0]!.paused).toBe(true);
		const off = await (
			await postJson(h, "api/pause", { id: FRD, paused: false }, h.token)
		).json();
		expect(off).toEqual({ ok: true, paused: false });
		expect(loadFeatures(tmp)!.features[0]!.paused).toBe(false);
		const miss = await (
			await postJson(h, "api/pause", { id: "no-existe.md", paused: true }, h.token)
		).json();
		expect(miss).toEqual({ ok: false, error: "missing" });
	});
});

describe("POST /api/ship — fases a backlog N2 sin ejecución (FR#5)", () => {
	it("crea el board con las fases raíz y responde phaseCount; el snapshot lo refleja", async () => {
		writeArtifact(FRD);
		writeArtifact(RESEARCH_REL, { parent: FRD });
		writeArtifact(DESIGN_REL, { parent: RESEARCH_REL });
		writePlan(PLAN_REL, DESIGN_REL, ["alpha", "beta", "gamma"]);
		reconcileFeatures(tmp);
		const h = await startMonitor();
		const res = await (
			await postJson(h, "api/ship", { id: FRD }, h.token)
		).json();
		expect(res).toMatchObject({
			moved: true,
			phaseCount: 3,
			planPath: PLAN_REL,
		});
		expect(loadFeatures(tmp)!.features[0]!.stage).toBe("ready-to-ship");
		const state = await (await fetch(`${h.url}api/state`)).json();
		expect(state.boards).toHaveLength(1);
		expect(state.boards[0].path).toBe(PLAN_REL);
		expect(state.boards[0].units).toHaveLength(3);
		expect(
			state.boards[0].units.every(
				(u: { status: string; done: boolean; validateFails: number }) =>
					u.status === "backlog" && u.done === false && u.validateFails === 0,
			),
		).toBe(true);
	});

	it("sin plan enlazado: failure no-plan + warning", async () => {
		writeArtifact(FRD);
		reconcileFeatures(tmp);
		const h = await startMonitor();
		const res = await (
			await postJson(h, "api/ship", { id: FRD }, h.token)
		).json();
		expect(res).toMatchObject({
			moved: false,
			failure: "no-plan",
			phaseCount: 0,
		});
		expect(res.warning).toContain("/skill:plan");
	});
});

describe("SSE — /events: snapshot inicial, broadcast vivo y replay (FR#8/NFR <1s)", () => {
	it("primer evento = snapshot actual; un POST se refleja <1.5s (debounce incluido)", async () => {
		writeArtifact(FRD);
		reconcileFeatures(tmp);
		const h = await startMonitor();
		sse = await connectSse(h.url);
		const first = await sse.waitFor((e) => e.event === "snapshot");
		expect(snapshotOf(first).features[0]!.stage).toBe("discover");
		await postJson(h, "api/advance", { id: FRD }, h.token);
		const moved = await sse.waitFor((e) => {
			try {
				return snapshotOf(e).features[0]!.stage === "research";
			} catch {
				return false;
			}
		}, MONITOR_DEBOUNCE_MS * 6);
		expect(moved.id).toBeGreaterThan(first.id);
	});

	it("replay Last-Event-ID: al reconectar recibe lo perdido (plantilla replayEvents)", async () => {
		writeArtifact(FRD);
		reconcileFeatures(tmp);
		const h = await startMonitor();
		const a = await connectSse(h.url);
		sse = a;
		const first = await a.waitFor((e) => e.event === "snapshot");
		// Dos POST coalescen en UN broadcast (debounce): stage research + paused.
		await postJson(h, "api/advance", { id: FRD }, h.token);
		await postJson(h, "api/pause", { id: FRD, paused: true }, h.token);
		await sleep(MONITOR_DEBOUNCE_MS + 200); // aterriza el broadcast (al log)
		await a.close();
		const b = await connectSse(h.url, first.id);
		sse = b;
		// El replay entrega SOLO lo perdido: el primer evento de B tiene id > first
		// (sin snapshot extra de conexión). Espera a que aterrice ≥1 frame antes de
		// asertar (el primer chunk depende de microtasks de undici — 1ª pasada).
		await b.waitFor(() => true, 1500);
		expect(b.events[0]!.id).toBeGreaterThan(first.id);
		const missed = await b.waitFor((e) => e.id > first.id, 1500);
		expect(snapshotOf(missed).features[0]).toMatchObject({
			stage: "research",
			paused: true,
		});
	});

	it("watcher: escritura EXTERNA de un FRD se adopta y transmite <1.5s (sin writers in-process)", async () => {
		// El bucket debe existir ANTES de conectar: el watcher se arma por request.
		mkdirSync(path.join(tmp, ".frida", "artifacts", "discover"), {
			recursive: true,
		});
		const h = await startMonitor();
		sse = await connectSse(h.url);
		await sse.waitFor((e) => e.event === "snapshot"); // inicial
		// Escritura externa (bash/skill de otro proceso): nadie emite in-process.
		writeFileSync(
			path.join(tmp, ...FRD.split("/")),
			"---\nstatus: ready\n---\n\n# doc\n",
			"utf8",
		);
		const adopted = await sse.waitFor((e) => {
			try {
				return snapshotOf(e).features.length === 1;
			} catch {
				return false;
			}
		}, MONITOR_DEBOUNCE_MS * 6);
		expect(snapshotOf(adopted).features[0]!.id).toBe(FRD);
	});

	it("tmp+rename: el .tmp no emite; el rename SÍ — una sola señal por ráfaga (D2)", async () => {
		mkdirSync(path.join(tmp, ".frida", "artifacts", "pipeline"), {
			recursive: true,
		});
		const h = await startMonitor();
		sse = await connectSse(h.url);
		const first = await sse.waitFor((e) => e.event === "snapshot");
		// Ráfaga multi-escritor: tmp + rename (el evento del .tmp se IGNORA).
		const file = featuresFilePath(tmp);
		const tmpFile = `${file}.4242.tmp`;
		writeFileSync(
			tmpFile,
			JSON.stringify({
				v: 1,
				features: [{ id: "externo.md", stage: "discover", history: [] }],
				updatedAt: new Date().toISOString(),
			}),
			"utf8",
		);
		renameSync(tmpFile, file);
		const got = await sse.waitFor((e) => {
			try {
				return snapshotOf(e).features.some((f) => f.id === "externo.md");
			} catch {
				return false;
			}
		}, MONITOR_DEBOUNCE_MS * 6);
		// Exactamente UN evento entre el inicial y el rename (tmp ignorado +
		// coalescencia del funnel).
		expect(got.id).toBe(first.id + 1);
		await sleep(MONITOR_DEBOUNCE_MS + 400); // ventana de silencio
		expect(sse.events.filter((e) => e.id > got.id)).toEqual([]);
	});
});

describe("workspace limpio — adopción diferida (NFR reliability)", () => {
	it("sin .frida arranca; al aparecer el árbol, el GET adopta (rearme por request)", async () => {
		const h = await startMonitor();
		const empty = await (await fetch(`${h.url}api/state`)).json();
		expect(empty.features).toEqual([]);
		writeArtifact(FRD); // crea .frida/artifacts/… (el watcher no podía armarse)
		const adopted = await (await fetch(`${h.url}api/state`)).json();
		expect(adopted.features).toHaveLength(1);
		expect(adopted.features[0].id).toBe(FRD);
	});
});

// ── #194 — Arrancar /skill:discover desde el monitor web ────────────────────
describe("api/discover (#194)", () => {
	it("inyecta /skill:discover con la idea sanitizada (saltos colapsados, trim)", async () => {
		const commands: string[] = [];
		const h = await startMonitor((c) => commands.push(c));
		const res = await postJson(
			h,
			"api/discover",
			{ idea: "  exportar\n\nPDF   del monitor  " },
			h.token,
		);
		expect(res.status).toBe(200);
		const data = (await res.json()) as { injected: boolean; command: string };
		expect(data.injected).toBe(true);
		expect(data.command).toBe("/skill:discover exportar PDF del monitor");
		expect(commands).toEqual(["/skill:discover exportar PDF del monitor"]);
	});

	it("idea larga se trunca a 300 caracteres (coincide con el maxlength del input)", async () => {
		const h = await startMonitor();
		const res = await postJson(h, "api/discover", { idea: "x".repeat(350) }, h.token);
		expect(res.status).toBe(200);
		const data = (await res.json()) as { command: string };
		expect(data.command).toBe(`/skill:discover ${"x".repeat(300)}`);
	});

	it("400 sin idea o vacía; 401 sin token", async () => {
		const h = await startMonitor();
		expect((await postJson(h, "api/discover", { idea: "algo" })).status).toBe(401);
		expect((await postJson(h, "api/discover", { idea: "   " }, h.token)).status).toBe(400);
		expect((await postJson(h, "api/discover", {}, h.token)).status).toBe(400);
		expect((await postJson(h, "api/discover", { idea: 42 }, h.token)).status).toBe(400);
	});
});
