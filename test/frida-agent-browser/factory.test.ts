import { describe, it, expect } from "vitest";
import { createFridaAgentBrowser } from "../../src/tools/frida-agent-browser";

/** pi fake que captura registerTool/on para ejercitar el wiring de la factory. */
function harness(opts: { runFn?: () => Promise<unknown> } = {}) {
	const tools: Array<Record<string, unknown>> = [];
	const hooks: Record<string, (...a: unknown[]) => unknown> = {};
	const pi = {
		registerTool: (t: Record<string, unknown>) => void tools.push(t),
		on: (event: string, cb: (...a: unknown[]) => unknown) => {
			hooks[event] = cb;
		},
	};
	createFridaAgentBrowser(opts as never)(pi as never);
	const tool = tools.find((t) => t.name === "agent_browser")!;
	return { tool, hooks, tools };
}

describe("createFridaAgentBrowser — wiring", () => {
	it("registra el tool agent_browser con promptGuidelines", () => {
		const { tool } = harness();
		expect(tool).toBeTruthy();
		expect(tool.description).toMatch(/Browse websites/);
		expect(Array.isArray(tool.promptGuidelines)).toBe(true);
		expect((tool.promptGuidelines as string[]).length).toBeGreaterThan(0);
	});

	it("before_agent_start APENDIZA la regla de proyecto al systemPrompt", async () => {
		const { hooks } = harness();
		const res = (await hooks.before_agent_start(
			{ systemPrompt: "BASE" },
			{},
		)) as {
			systemPrompt: string;
		};
		expect(res.systemPrompt).toContain("BASE");
		expect(res.systemPrompt).toContain(
			"prefer the native `agent_browser` tool",
		);
	});

	it("tool_call bloquea agent-browser por bash", async () => {
		const { hooks } = harness();
		const blocked = await hooks.tool_call({
			toolName: "bash",
			input: { command: "agent-browser open https://x" },
		});
		expect(blocked).toEqual({
			block: true,
			reason: expect.stringMatching(/native agent_browser tool/),
		});
	});

	it("tool_call permite --help (inspección inofensiva)", async () => {
		const { hooks } = harness();
		expect(
			await hooks.tool_call({
				toolName: "bash",
				input: { command: "agent-browser --help" },
			}),
		).toBeUndefined();
	});

	it("tool_call ignora bash que no toca agent-browser", async () => {
		const { hooks } = harness();
		expect(
			await hooks.tool_call({ toolName: "bash", input: { command: "ls -la" } }),
		).toBeUndefined();
	});

	it("execute → missing-binary cuando el spawn reporta ENOENT (determinístico via seam)", async () => {
		const { tool } = harness({
			runFn: (async () => ({
				stdout: "",
				stderr: "",
				exitCode: null,
				timedOut: false,
				spawnError: { code: "ENOENT", message: "spawn ENOENT" },
			})) as never,
		});
		// runFn inyecta un ENOENT → la pipeline completa (resolveInput → sesión → run
		// → isMissingBinary → missingBinaryResult) devuelve el resultado graceful.
		const result = (await (tool.execute as Function)(
			"call-1",
			{ args: ["open", "https://example.com"] },
			undefined,
			undefined,
			{ cwd: process.cwd() },
		)) as {
			content: { text: string }[];
			details: { failureCategory: string };
			isError: boolean;
		};
		expect(result.isError).toBe(true);
		expect(result.details.failureCategory).toBe("missing-binary");
		expect(result.content[0].text).toMatch(/not found on PATH/);
	});

	it("execute → validation error cuando falta todo input-mode", async () => {
		const { tool } = harness();
		const result = (await (tool.execute as Function)(
			"call-2",
			{},
			undefined,
			undefined,
			{ cwd: process.cwd() },
		)) as {
			content: { text: string }[];
			details: { failureCategory: string };
			isError: boolean;
		};
		expect(result.isError).toBe(true);
		expect(result.details.failureCategory).toBe("validation");
		expect(result.content[0].text).toMatch(/exactly one input mode/);
	});

	it("Fase 6: launch-scoped flag sobre sesión ACTIVA sin fresh → fail-clear (policy-blocked, sin spawn)", async () => {
		let calls = 0;
		const { tool } = harness({
			runFn: (async () => {
				calls += 1;
				return {
					stdout: JSON.stringify({
						success: true,
						data: { url: "https://x", title: "X" },
						error: null,
					}),
					stderr: "",
					exitCode: 0,
					timedOut: false,
				};
			}) as never,
		});
		// 1) open → activa la sesión (markUsed)
		await (tool.execute as Function)(
			"c1",
			{ args: ["open", "https://x"] },
			undefined,
			undefined,
			{ cwd: process.cwd() },
		);
		expect(calls).toBe(1);
		// 2) flag launch-scoped (--profile) sin fresh → fail-clear ANTES de spawn
		const r = (await (tool.execute as Function)(
			"c2",
			{ args: ["--profile", "Default", "open", "https://y"] },
			undefined,
			undefined,
			{ cwd: process.cwd() },
		)) as {
			content: { text: string }[];
			details: { failureCategory: string; nextActions?: { id: string }[] };
			isError: boolean;
		};
		expect(calls).toBe(1); // no se llamó al binario
		expect(r.isError).toBe(true);
		expect(r.details.failureCategory).toBe("policy-blocked");
		expect(r.content[0].text).toMatch(/sessionMode:"fresh"/);
		expect(r.details.nextActions?.[0]?.id).toBe("retry-with-fresh-session");
	});

	it("Fase 8: --allowed-domains + navegación a host fuera del allowlist → policy-blocked", async () => {
		const { tool } = harness({
			runFn: (async () => ({
				stdout: JSON.stringify({
					success: true,
					data: { url: "https://evil.com/landing", title: "Evil" },
					error: null,
				}),
				stderr: "",
				exitCode: 0,
				timedOut: false,
			})) as never,
		});
		const r = (await (tool.execute as Function)(
			"c",
			{
				args: ["--allowed-domains", "allowed.com", "open", "https://evil.com"],
			},
			undefined,
			undefined,
			{ cwd: process.cwd() },
		)) as {
			content: { text: string }[];
			details: {
				failureCategory: string;
				allowedDomainsViolation?: { observedHost: string };
			};
			isError: boolean;
		};
		expect(r.isError).toBe(true);
		expect(r.details.failureCategory).toBe("policy-blocked");
		expect(r.details.allowedDomainsViolation?.observedHost).toBe("evil.com");
		expect(r.content[0].text).toMatch(/does not allow evil.com/);
	});
});
