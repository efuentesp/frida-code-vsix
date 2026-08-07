// Fase 1 — sandbox node:vm: runWorkflow forkea un hijo que corre el script en
// un contexto VM congelado y llama al bridge (agent/shell) por IPC/RPC.
// Verificado: el SDK de Pi carga en vitest (test/sdk-passthrough.test.ts).
import { describe, it, expect } from "vitest";
import { runWorkflow } from "../../src/tools/frida-extensible-workflows/core/execution";
import type { WorkflowBridge } from "../../src/tools/frida-extensible-workflows/core/types";

/** Bridge mock: agent(prompt) → `result:<prompt>`. */
function mockBridge(): WorkflowBridge {
	return { agent: async (prompt) => `result:${prompt}` };
}

describe("frida-extensible-workflows · sandbox node:vm (Fase 1)", () => {
	it("ejecuta un script inline con un agent() y devuelve su resultado", async () => {
		const exec = runWorkflow(`return await agent("hola");`, null, mockBridge());
		await expect(exec.result).resolves.toBe("result:hola");
	}, 15000);

	it("fan-out paralelo: parallel() con dos agent() devuelve resultados keyed", async () => {
		const script = `
			const r = await parallel("research", {
				a: () => agent("A"),
				b: () => agent("B"),
			});
			return r;
		`;
		const exec = runWorkflow(script, null, mockBridge());
		await expect(exec.result).resolves.toEqual({
			a: "result:A",
			b: "result:B",
		});
	}, 15000);

	it("prompt() interpola valores JSON en el template", async () => {
		const script = `
			const x = await agent("primero");
			return prompt("resumen: {x}", { x });
		`;
		const exec = runWorkflow(script, null, mockBridge());
		await expect(exec.result).resolves.toBe("resumen: result:primero");
	}, 15000);

	it("args del lanzamiento queda disponible como global en el sandbox", async () => {
		const script = `return args.target;`;
		const exec = runWorkflow(script, { target: 42 }, mockBridge());
		await expect(exec.result).resolves.toBe(42);
	}, 15000);
});
