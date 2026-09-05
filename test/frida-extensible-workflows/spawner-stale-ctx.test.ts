// frida-extensible-workflows · spawner stale-ctx — regresión del AGENT_FAILED
// "This extension ctx is stale after session replacement or reload"
// (repro: conteo COSMIC SIV 2026-09-04 16:34 — newSession() a mitad de una run
// en background mataba el siguiente agent()).
//
// Contrato testeado: createFridaAgentSpawner captura cwd/modelRuntime/model
// UNA vez al crearse (ctx vivo); el spawn resultante NO toca el ctx nunca más,
// así que sobrevive a que el host caduque el ctx (newSession/switchSession/
// reload) mientras la run background sigue en vuelo.

import { describe, it, expect, vi, beforeEach } from "vitest";

const createAgentSession = vi.fn();

// Mock del SDK: sólo los símbolos runtime que el grafo del spawner consume
// (validation.ts aporta getAgentDir/parseFrontmatter además de los 4 del spawner).
vi.mock("@earendil-works/pi-coding-agent", () => ({
	createAgentSession: (...args: unknown[]) => createAgentSession(...args),
	DefaultResourceLoader: class {
		constructor(_opts: unknown) {}
		async reload() {}
	},
	SessionManager: { inMemory: (_cwd: string) => ({}) },
	SettingsManager: { create: (_cwd: string, _dir: string) => ({}) },
	getAgentDir: () => "/tmp/wf-stale-ctx-test/agent-dir",
	parseFrontmatter: () => ({}),
}));

import {
	createFridaAgentSpawner,
	unpackSpawnResult,
} from "../../src/tools/frida-extensible-workflows/frida-agent-execution";

const CWD = "/tmp/wf-stale-ctx-test";

/** Ctx mock con "caducidad": tras goStale(), TODO acceso a propiedades lanza
 *  (emula el proxy de staleness del SDK). */
function makeCtx() {
	const ctx = {
		cwd: CWD,
		modelRegistry: { runtime: { getModel: () => undefined } },
		model: undefined,
	};
	return {
		ctx,
		goStale: () => {
			for (const k of ["cwd", "modelRegistry", "model"] as const) {
				Object.defineProperty(ctx, k, {
					configurable: true,
					get() {
						throw new Error(
							"This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload().",
						);
					},
				});
			}
		},
	};
}

function mockSessionReturning(text: string) {
	return {
		prompt: vi.fn(async () => {}),
		bindExtensions: vi.fn(async () => {}),
		dispose: vi.fn(async () => {}),
		getSessionStats: () => undefined,
		state: {
			messages: [{ role: "assistant", content: [{ type: "text", text }] }],
		},
	};
}

describe("createFridaAgentSpawner — sobrevive a ctx stale (newSession mid-run)", () => {
	beforeEach(() => {
		createAgentSession.mockReset();
		createAgentSession.mockResolvedValue({ session: mockSessionReturning("ok") });
	});

	it("el spawn no toca el ctx tras crear el spawner (captura eager)", async () => {
		const { ctx, goStale } = makeCtx();
		// SAFETY: el spawner sólo consume cwd/modelRegistry/model (captura eager
		// verificada por este test); el resto de ExtensionContext no se toca
		// bajo el SDK mockeado, así que el partial es suficiente.
		const spawn = createFridaAgentSpawner(ctx as never);
		goStale(); // el host reemplazó la sesión DESPUÉS de lanzar la run

		const raw = await spawn(
			"cuenta algo",
			{},
			new AbortController().signal,
			{} as never,
		);
		// SAFETY: el spawner real devuelve AgentSpawnResult (símbolo interno);
		// unpackSpawnResult es la vía pública para extraer el value.
		expect(unpackSpawnResult(raw as never).value).toBe("ok");
		expect(createAgentSession).toHaveBeenCalledTimes(1);
	});

	it("usa el cwd capturado al lanzar (no re-lo lee del ctx)", async () => {
		const { ctx, goStale } = makeCtx();
		// SAFETY: idem — partial del ctx (sólo cwd/modelRegistry/model en juego).
		const spawn = createFridaAgentSpawner(ctx as never);
		goStale();

		await spawn("x", {}, new AbortController().signal, {} as never);
		const call = createAgentSession.mock.calls[0][0] as { cwd?: string };
		expect(call.cwd).toBe(CWD);
	});
});
