// Fase 2 — bridge Frida: createWorkflowBridge cablea agent() al spawner
// inyectado (mock aquí; el real createFridaAgentSpawner vive en el host) y
// shell() a executeShellCommand. Verifica el wiring end-to-end vía runWorkflow.
import { describe, it, expect } from "vitest";
import { runWorkflow } from "../../src/tools/frida-extensible-workflows/core/execution";
import { createWorkflowBridge } from "../../src/tools/frida-extensible-workflows/frida-agent-execution";

describe("frida-extensible-workflows · bridge Frida (Fase 2)", () => {
	it("createWorkflowBridge cablea agent() al spawner inyectado", async () => {
		const bridge = createWorkflowBridge({
			cwd: process.cwd(),
			agent: async (prompt) => `FRIDA:${prompt}`,
		});
		const exec = runWorkflow(`return await agent("tarea");`, null, bridge);
		await expect(exec.result).resolves.toBe("FRIDA:tarea");
	}, 15000);

	it("parallel() dispara el spawner por cada rama y devuelve keyed", async () => {
		const bridge = createWorkflowBridge({
			cwd: process.cwd(),
			agent: async (prompt) => `R:${prompt}`,
		});
		const script = `
			const r = await parallel("op", {
				a: () => agent("A"),
				b: () => agent("B"),
			});
			return r;
		`;
		const exec = runWorkflow(script, null, bridge);
		await expect(exec.result).resolves.toEqual({ a: "R:A", b: "R:B" });
	}, 15000);

	it("shell() del bridge ejecuta un comando real y captura stdout", async () => {
		const bridge = createWorkflowBridge({
			cwd: process.cwd(),
			agent: async () => "ok",
		});
		const script = `
			const r = await shell("echo hola-frida");
			return r.stdout.trim();
		`;
		const exec = runWorkflow(script, null, bridge);
		await expect(exec.result).resolves.toBe("hola-frida");
	}, 15000);

	it("composición: parallel() + prompt() con valores string interpolados", async () => {
		const bridge = createWorkflowBridge({
			cwd: process.cwd(),
			agent: async (prompt) => `F:${prompt}`,
		});
		// prompt() inserta strings crudos en {key}; usamos placeholders
		// individuales (no un objeto) para evitar JSON.pretty multi-línea.
		const script = `
			const r = await parallel("review", {
				correctness: () => agent("correctness"),
				security: () => agent("security"),
			});
			return prompt("a={correctness} b={security}", {
				correctness: r.correctness,
				security: r.security,
			});
		`;
		const exec = runWorkflow(script, null, bridge);
		await expect(exec.result).resolves.toBe("a=F:correctness b=F:security");
	}, 15000);
});
