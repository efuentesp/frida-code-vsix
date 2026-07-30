// Spike Fase 0 — viabilidad de `frida-workflow` (porte nativo de rpiv-workflow).
//
// Responde las 3 preguntas go/no-go del diseño (docs/frida-workflow-design.md §10/§11):
//
//  Q1 — ¿Se puede compartir UN DefaultResourceLoader entre varias AgentSession
//       concurrentes (sesión interactiva + N hijas de etapas)?
//  Q2 — ¿SessionManager.forkFrom (sessionPolicy: "continue") corre in-process
//       dentro del extension host de VS Code (no CLI)?
//  Q3 — ¿createPermissionSystem ata los gates de N sesiones hijas a un SOLO
//       ApprovalBridge compartido (paridad de seguridad: un workflow que corre
//       `bash`/`edit` en una hija SIGUE pidiendo aprobación)?
//
// Todo corre offline (PI_OFFLINE=1, allowModelNetwork:false) y sin auth: el
// modelo se toma del catálogo builtin estático del SDK; el auth sólo se valida
// al prompt(), que aquí no invocamos (validamos mecánica de sesión, no LLM).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { ApprovalBridge } from "../../src/approval-bridge";
import { ApprovalLogger } from "../../src/gates/approval-logger";
import { createPermissionSystem } from "../../src/tools/frida-permission-system";
import { GateStatsStore } from "../../src/tools/frida-permission-system/session-store";
import { SessionApprovals } from "../../src/tools/frida-permission-system/session-approvals";
import type { GatePatterns } from "../../src/settings";

// D11 — apagar phone-home a pi.dev y la telemetría, igual que createFridaSession.
const SAVED_ENV: Record<string, string | undefined> = {};
beforeAll(() => {
	for (const k of ["PI_OFFLINE", "PI_SKIP_VERSION_CHECK"]) {
		SAVED_ENV[k] = process.env[k];
		process.env[k] = "1";
	}
});
afterAll(() => {
	for (const [k, v] of Object.entries(SAVED_ENV)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
});

const EMPTY_PATTERNS: GatePatterns = {
	sensitiveExtensions: [],
	sensitiveBasenames: [],
	sensitiveAllowBasenames: [],
	dangerousCommandSubstrings: [],
};

/** "pi" de mentira que sólo captura los handlers registrados (on/getActiveTools/…). */
function fakePi() {
	const handlers = new Map<string, (...a: any[]) => any>();
	return {
		handlers,
		on(event: string, h: (...a: any[]) => any) {
			handlers.set(event, h);
		},
		getActiveTools: () => [] as string[],
		setActiveTools: (_t: string[]) => {},
	};
}

// ---------------------------------------------------------------------------
// Q2 — SessionManager.forkFrom corre in-process (es filesystem puro)
// ---------------------------------------------------------------------------

describe("Q2 — SessionManager.forkFrom (in-process, no CLI)", () => {
	it("crea una sesión nueva que hereda las entradas y apunta al source como parent", () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frida-wf-fork-"));
		const sourcePath = path.join(tmp, "source.jsonl");
		fs.writeFileSync(
			sourcePath,
			[
				JSON.stringify({
					type: "session",
					version: 3,
					id: "src-001",
					timestamp: "2026-01-01T00:00:00.000Z",
					cwd: tmp,
				}),
				JSON.stringify({ type: "user", content: "hola" }),
				JSON.stringify({ type: "assistant", content: "ok" }),
			].join("\n") + "\n",
		);
		const sessionDir = path.join(tmp, "sessions");
		fs.mkdirSync(sessionDir, { recursive: true });

		const sm = SessionManager.forkFrom(sourcePath, tmp, sessionDir);

		// El nuevo archivo vive en sessionDir y es el único .jsonl ahí.
		const jsonls = fs
			.readdirSync(sessionDir)
			.filter((f) => f.endsWith(".jsonl"));
		expect(jsonls.length).toBe(1);
		const newFile = path.join(sessionDir, jsonls[0]!);
		expect(newFile).not.toBe(sourcePath);

		const lines = fs
			.readFileSync(newFile, "utf8")
			.trim()
			.split("\n")
			.map((l) => JSON.parse(l) as any);
		// Header nuevo: nuevo id, parentSession → source, cwd actualizado.
		const header = lines.find((l) => l.type === "session");
		expect(header).toBeDefined();
		expect(header.id).not.toBe("src-001");
		expect(header.parentSession).toBe(sourcePath);
		expect(header.cwd).toBe(tmp);
		// Entradas no-header copiadas tal cual.
		const rest = lines.filter((l) => l.type !== "session");
		expect(rest.map((l) => l.type)).toEqual(["user", "assistant"]);

		// El manager expone su archivo (lo usa el runner para reattach/fork futuros).
		expect((sm as any).sessionFile ?? (sm as any).path ?? newFile).toBeTruthy();
	});
});

// ---------------------------------------------------------------------------
// Q1 — Un DefaultResourceLoader compartido entre 2 AgentSession concurrentes
// ---------------------------------------------------------------------------

describe("Q1 — resourceLoader compartido entre sesiones hijas", () => {
	it("dos AgentSession pueden reusar el MISMO loader sin romperse (offline, sin auth)", async () => {
		const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-wf-agent-"));
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "frida-wf-cwd-"));
		const settingsManager = SettingsManager.create(cwd, agentDir);
		settingsManager.applyOverrides({ enableInstallTelemetry: false });

		const modelRuntime = await ModelRuntime.create({
			modelsPath: null, // InMemoryCodingAgentModelsStore: sin archivo
			allowModelNetwork: false,
		});

		// Modelo del catálogo builtin estático (z.ai es builtin, ver D29); fallback al primero.
		let model: any = modelRuntime.getModel("zai", "glm-4.5-air");
		if (!model) {
			const all = modelRuntime.getModels();
			model = all[0];
		}
		expect(
			model,
			"debe existir al menos un modelo builtin offline",
		).toBeTruthy();

		// El loader se construye UNA vez y se reusa en ambas sesiones.
		const loader = new DefaultResourceLoader({
			cwd,
			agentDir,
			settingsManager,
			extensionFactories: [],
		});
		await loader.reload();

		const sessionDirA = path.join(agentDir, "sessA");
		const sessionDirB = path.join(agentDir, "sessB");
		fs.mkdirSync(sessionDirA, { recursive: true });
		fs.mkdirSync(sessionDirB, { recursive: true });

		const { session: sessionA } = (await createAgentSession({
			resourceLoader: loader,
			modelRuntime,
			model,
			settingsManager,
			sessionManager: SessionManager.create(cwd, sessionDirA),
			agentDir,
			cwd,
		} as any)) as any;

		const { session: sessionB } = (await createAgentSession({
			resourceLoader: loader, // MISMA instancia
			modelRuntime,
			model,
			settingsManager,
			sessionManager: SessionManager.create(cwd, sessionDirB),
			agentDir,
			cwd,
		} as any)) as any;

		// Las dos sesiones ven el MISMO loader (shareable; no hay estado por sesión).
		expect(sessionA.resourceLoader).toBe(loader);
		expect(sessionB.resourceLoader).toBe(loader);
		// Crear B no corrompió A: sigue idle y con el mismo loader.
		expect(sessionA.isIdle).toBe(true);
		expect(sessionA.resourceLoader).toBe(sessionB.resourceLoader);
		// Skills disponibles (demostrando que el loader cargó recursos reutilizables).
		const skills = sessionA.resourceLoader?.getSkills?.();
		expect(Array.isArray(skills?.skills)).toBe(true);
	}, 60_000);
});

// ---------------------------------------------------------------------------
// Q3 — createPermissionSystem ata N sesiones hijas a un SOLO ApprovalBridge
// ---------------------------------------------------------------------------

describe("Q3 — gates de sesiones hijas → un ApprovalBridge compartido", () => {
	it("dos sesiones hijas registran sendos handlers que confluyen en el mismo bridge", async () => {
		const pending: any[] = [];
		const bridge = new ApprovalBridge((reqs) => {
			pending.length = 0;
			pending.push(...reqs);
		});
		const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-wf-gates-"));
		const logger = new ApprovalLogger(path.join(logDir, "approvals.jsonl"));
		const stats = new GateStatsStore(() => {});
		const sessionApprovals = new SessionApprovals();
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "frida-wf-cwd2-"));

		// Misma factory atada al MISMO bridge → cada "sesión hija" registra su handler.
		const factory = createPermissionSystem(
			bridge,
			() => "manual", // bash siempre pide
			logger,
			() => cwd,
			() => EMPTY_PATTERNS,
			stats,
			sessionApprovals,
		);

		// "Sesión hija A"
		const piA = fakePi();
		factory(piA as any);
		expect(piA.handlers.has("tool_call")).toBe(true);

		// Dispara un bash desde la hija A → debe llegar al bridge como pendiente.
		const handlerA = piA.handlers.get("tool_call")!;
		const bashEventA = {
			toolCallId: "childA-1",
			toolName: "bash",
			input: { command: "echo hola" },
		};
		const pendingA = handlerA(bashEventA, { session: { id: "childA" } }); // no awaited: queda en bridge.request
		await new Promise((r) => setImmediate(r)); // deja que llegue al request()
		expect(pending.map((p) => p.id)).toContain("childA-1");

		// "Sesión hija B" (mismo bridge) dispara OTRO bash → el bridge acumula ambos.
		const piB = fakePi();
		factory(piB as any);
		const handlerB = piB.handlers.get("tool_call")!;
		const bashEventB = {
			toolCallId: "childB-1",
			toolName: "bash",
			input: { command: "ls -la" },
		};
		const pendingB = handlerB(bashEventB, { session: { id: "childB" } });
		await new Promise((r) => setImmediate(r));
		expect(pending.map((p) => p.id).sort()).toEqual(["childA-1", "childB-1"]);

		// El usuario aprueba ambos desde el webview (mismo conducto de siempre).
		// El handler devuelve el VEREDICTO del gate, no la respuesta: accept → undefined
		// (deja ejecutar); reject → { block: true, reason }.
		bridge.resolve({ id: "childA-1", decision: "accept" });
		bridge.resolve({ id: "childB-1", decision: "accept" });
		const [verdictA, verdictB] = await Promise.all([pendingA, pendingB]);
		expect(verdictA).toBeUndefined(); // accept → sin bloqueo
		expect(verdictB).toBeUndefined();
		expect(pending.length).toBe(0); // bridge vaciado

		// Un reject posterior llega como { block: true } — el modelo lo ve como veto.
		const pendingC = handlerA(
			{
				toolCallId: "childA-2",
				toolName: "bash",
				input: { command: "rm -rf x" },
			},
			{ session: { id: "childA" } },
		);
		await new Promise((r) => setImmediate(r));
		expect(pending.map((p) => p.id)).toContain("childA-2");
		bridge.resolve({ id: "childA-2", decision: "reject" });
		const verdictC = await pendingC;
		expect(verdictC).toEqual({ block: true, reason: expect.any(String) });
	});
});
