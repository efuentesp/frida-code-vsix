// frida-shunt (#202): factory — handler tool_call con fake pi (molde
// mode-override.test.ts). Contrato: block con escalera en lecturas costosas,
// early-out barato con disabled, fail-open ante errores.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createShuntGate } from "../../src/tools/frida-shunt";

const dir = mkdtempSync(join(tmpdir(), "frida-shunt-factory-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeAll(() => {
	writeFileSync(
		join(dir, "big.ts"),
		Array.from({ length: 600 }, (_, i) => `const a${i} = ${i};`).join("\n"),
		"utf8",
	);
});

function makeGate(enabled: boolean) {
	const handlers: Record<string, (e: any, ctx?: any) => any> = {};
	const diags: string[] = [];
	const pi = {
		on: (evt: string, cb: any) => {
			handlers[evt] = cb;
		},
	};
	const gate = createShuntGate({
		isEnabled: () => enabled,
		getMinLines: () => 350,
		getCwd: () => dir,
		diag: (m) => diags.push(m),
	});
	gate(pi as any);
	return { handlers, diags };
}

describe("createShuntGate (#202)", () => {
	it("read completo de archivo grande → { block, reason } con escalera", async () => {
		const { handlers, diags } = makeGate(true);
		const res = await handlers["tool_call"]({
			toolName: "read",
			toolCallId: "t1",
			input: { path: join(dir, "big.ts") },
		});
		expect(res).toEqual({
			block: true,
			reason: expect.stringContaining("module_report"),
		});
		expect(diags[0]).toContain("[shunt] redirect");
	});

	it("read con offset pasa (undefined — no block)", async () => {
		const { handlers } = makeGate(true);
		const res = await handlers["tool_call"]({
			toolName: "read",
			input: { path: join(dir, "big.ts"), offset: 10, limit: 20 },
		});
		expect(res).toBeUndefined();
	});

	it("bash cat grande → block; pipe pasa", async () => {
		const { handlers } = makeGate(true);
		const res = await handlers["tool_call"]({
			toolName: "bash",
			input: { command: `cat ${join(dir, "big.ts")}` },
		});
		expect(res?.block).toBe(true);
		const piped = await handlers["tool_call"]({
			toolName: "bash",
			input: { command: `cat ${join(dir, "big.ts")} | grep a1` },
		});
		expect(piped).toBeUndefined();
	});

	it("disabled → early-out sin tocar fs (ni tools ajenos a read/bash)", async () => {
		const { handlers } = makeGate(false);
		expect(
			await handlers["tool_call"]({
				toolName: "read",
				input: { path: join(dir, "big.ts") },
			}),
		).toBeUndefined();
		expect(
			await handlers["tool_call"]({
				toolName: "grep",
				input: { pattern: "x" },
			}),
		).toBeUndefined();
	});

	it("fail-open: input malformado no lanza (router de costo, no candado)", async () => {
		const { handlers } = makeGate(true);
		await expect(
			handlers["tool_call"]({ toolName: "read", input: null }),
		).resolves.toBeUndefined();
		await expect(
			handlers["tool_call"]({ toolName: "bash", input: { command: 42 } }),
		).resolves.toBeUndefined();
	});
});
