// Tests del override de modo del gate (index.ts, #197): escalera plan →
// manual → auto-edit → auto-guarded → auto sobre el handler tool_call real.
//
// Se conduce createPermissionSystem con un pi/bridge/logger falsos y la policy
// DEFAULT (mockeando config-store para NO depender del permission.json del
// usuario). Cubre los invariantes:
//  - plan: edit/write bloqueados (mode_deny) aunque estén ocultos del catálogo.
//  - auto-guarded: ask sin force-ask pasa; force-ask (bash compuesto / path
//    externo) pide diálogo.
//  - auto (YOLO): TODO pasa incl. force-ask (regresión de semántica histórica).
//  - deny SIEMPRE gana: `rm -rf /` bloquea incluso en auto.

import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_POLICY } from "../../src/tools/frida-permission-system/config";

vi.mock("../../src/tools/frida-permission-system/config-store", () => ({
	getPermissionPolicy: () => DEFAULT_POLICY,
}));

// Import DESPUÉS del mock (hoisting de vi.mock garantiza orden).
const { createPermissionSystem } = await import(
	"../../src/tools/frida-permission-system/index"
);
// Patterns vacío inline (evita importar src/settings, que arrastra el módulo
// `vscode` no disponible en vitest). Equivalente a EMPTY_GATE_PATTERNS.
const NO_PATTERNS = {
	sensitiveExtensions: [],
	sensitiveBasenames: [],
	sensitiveAllowBasenames: [],
	dangerousCommandSubstrings: [],
	dangerousCommandPatterns: [],
};
import type { PermissionMode } from "../../src/tools/frida-permission-system/types";

const CWD = process.cwd();

interface Recorded {
	entries: Array<{ source: string; decision: string; reason?: string }>;
	bridgeCalls: string[];
}

/** Construye el sistema con un pi falso y captura log + diálogos. */
function makeSystem(mode: PermissionMode, decision = "accept") {
	const rec: Recorded = { entries: [], bridgeCalls: [] };
	const handlers: Record<string, (e?: any, ctx?: any) => any> = {};
	const pi = {
		on: (evt: string, cb: any) => {
			handlers[evt] = cb;
		},
		getAllTools: () =>
			["read", "grep", "edit", "write", "bash"].map((name) => ({ name })),
		getActiveTools: () => [...active],
		setActiveTools: (names: string[]) => {
			active.length = 0;
			active.push(...names);
		},
	};
	const active = ["read", "grep", "edit", "write", "bash"];
	const bridge = {
		request: async (req: any) => {
			rec.bridgeCalls.push(req.toolName ?? "?");
			return { decision };
		},
	};
	const logger = { log: (e: any) => rec.entries.push(e) };
	const sys = createPermissionSystem(
		bridge as any,
		() => mode,
		logger as any,
		() => CWD,
		() => NO_PATTERNS,
	);
	sys(pi as any);
	return { pi, handlers, rec, active };
}

const bashEvent = (command: string) => ({
	toolName: "bash",
	toolCallId: "t1",
	input: { command },
});
const editEvent = {
	toolName: "edit",
	toolCallId: "t2",
	input: { path: join(CWD, "src", "x.ts"), edits: [] },
};
const readEvent = {
	toolName: "read",
	toolCallId: "t3",
	input: { path: join(CWD, "src", "x.ts") },
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe("modo plan (Solo lectura, #197)", () => {
	it("bloquea edit con source mode_deny y motivo que explica el modo", async () => {
		const { handlers, rec } = makeSystem("plan");
		const res = await handlers["tool_call"](editEvent, { session: { id: "s" } });
		expect(res).toEqual({
			block: true,
			reason: expect.stringContaining("Solo lectura"),
		});
		expect(rec.entries.at(-1)).toMatchObject({
			decision: "block",
			source: "mode_deny",
		});
	});

	it("bloquea write igual que edit", async () => {
		const { handlers } = makeSystem("plan");
		const res = await handlers["tool_call"](
			{
				toolName: "write",
				toolCallId: "t4",
				input: { path: join(CWD, "y.ts"), content: "x" },
			},
			{},
		);
		expect(res?.block).toBe(true);
	});

	it("read pasa silencioso (sin diálogo ni log)", async () => {
		const { handlers, rec } = makeSystem("plan");
		const res = await handlers["tool_call"](readEvent, {});
		expect(res).toBeUndefined();
		expect(rec.entries).toHaveLength(0);
	});

	it("bash pide diálogo (lecturas tipo git log las aprueba el usuario)", async () => {
		const { handlers, rec } = makeSystem("plan");
		const res = await handlers["tool_call"](bashEvent("git log --oneline"), {});
		expect(res).toBeUndefined(); // aceptado en el diálogo
		expect(rec.bridgeCalls).toEqual(["bash"]);
	});

	it("before_agent_start oculta edit/write del catálogo del LLM", () => {
		const { handlers, active } = makeSystem("plan");
		handlers["before_agent_start"]();
		expect(active).not.toContain("edit");
		expect(active).not.toContain("write");
		expect(active).toContain("read");
		expect(active).toContain("bash");
	});

	it("al SALIR de plan el catálogo se restaura (fix hide-tools acumulativo)", () => {
		const { handlers, active } = makeSystem("plan");
		handlers["before_agent_start"]();
		expect(active).not.toContain("edit");
		// Cambia el modo: mismo handler re-derivado desde el catálogo completo.
		const manual = makeSystem("manual");
		manual.handlers["before_agent_start"]();
		expect(manual.active).toContain("edit");
		expect(manual.active).toContain("write");
	});
});

describe("modo auto-guarded (Autónomo, #197)", () => {
	it("bash simple pasa sin diálogo (allow por modo)", async () => {
		const { handlers, rec } = makeSystem("auto-guarded");
		const res = await handlers["tool_call"](bashEvent("npm test"), {});
		expect(res).toBeUndefined();
		expect(rec.bridgeCalls).toHaveLength(0);
		expect(rec.entries.at(-1)).toMatchObject({
			decision: "allow",
			source: "mode",
		});
	});

	it("edit en workspace pasa sin diálogo", async () => {
		const { handlers, rec } = makeSystem("auto-guarded");
		const res = await handlers["tool_call"](editEvent, {});
		expect(res).toBeUndefined();
		expect(rec.bridgeCalls).toHaveLength(0);
	});

	it("bash COMPUESTO pide diálogo (force-ask sobrevive)", async () => {
		const { handlers, rec } = makeSystem("auto-guarded");
		const res = await handlers["tool_call"](
			bashEvent("npm test && npm run build"),
			{},
		);
		expect(res).toBeUndefined();
		expect(rec.bridgeCalls).toEqual(["bash"]);
		expect(rec.entries.at(-1)).toMatchObject({
			decision: "allow",
			source: "user_approved",
		});
	});

	it("deny SIEMPRE gana: rm -rf / bloquea sin diálogo", async () => {
		const { handlers, rec } = makeSystem("auto-guarded");
		const res = await handlers["tool_call"](bashEvent("rm -rf /"), {});
		expect(res?.block).toBe(true);
		expect(rec.bridgeCalls).toHaveLength(0);
		expect(rec.entries.at(-1)).toMatchObject({
			decision: "block",
			source: "dangerous_command",
		});
	});
});

describe("modo auto (YOLO): regresión de semántica histórica (#197)", () => {
	it("bash compuesto pasa SIN diálogo (force-ask se suelta, como hoy)", async () => {
		const { handlers, rec } = makeSystem("auto");
		const res = await handlers["tool_call"](
			bashEvent("npm test && npm run build"),
			{},
		);
		expect(res).toBeUndefined();
		expect(rec.bridgeCalls).toHaveLength(0);
		expect(rec.entries.at(-1)).toMatchObject({
			decision: "allow",
			source: "mode",
		});
	});

	it("edit pasa sin diálogo", async () => {
		const { handlers, rec } = makeSystem("auto");
		const res = await handlers["tool_call"](editEvent, {});
		expect(res).toBeUndefined();
		expect(rec.bridgeCalls).toHaveLength(0);
	});

	it("deny SIEMPRE gana incluso en YOLO: rm -rf / bloquea", async () => {
		const { handlers } = makeSystem("auto");
		const res = await handlers["tool_call"](bashEvent("rm -rf /"), {});
		expect(res?.block).toBe(true);
	});

	it("el candado de #196 (reglas nuevas) bloquea en YOLO", async () => {
		// El peor caso (auto/YOLO): el deny hardcodeado gh-repo-delete (#196)
		// debe bloquear igual — el candado es inmune al modo.
		const { handlers } = makeSystem("auto");
		const res = await handlers["tool_call"](
			bashEvent("gh repo delete o/r --yes"),
			{},
		);
		expect(res?.block).toBe(true);
	});
});

describe("modo manual (regresión)", () => {
	it("edit pide diálogo y registra user_approved", async () => {
		const { handlers, rec } = makeSystem("manual");
		const res = await handlers["tool_call"](editEvent, {});
		expect(res).toBeUndefined();
		expect(rec.bridgeCalls).toEqual(["edit"]);
		expect(rec.entries.at(-1)).toMatchObject({
			decision: "allow",
			source: "user_approved",
		});
	});

	it("bash pide diálogo", async () => {
		const { handlers, rec } = makeSystem("manual");
		await handlers["tool_call"](bashEvent("ls"), {});
		expect(rec.bridgeCalls).toEqual(["bash"]);
	});
});
