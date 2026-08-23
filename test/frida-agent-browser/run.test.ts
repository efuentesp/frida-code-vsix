import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	applyOutputPath,
	isHarmlessAgentBrowserInspection,
	isMissingBinary,
	looksLikeAgentBrowserBash,
	missingBinaryResult,
	parseAgentBrowserOutput,
	runAgentBrowser,
} from "../../src/tools/frida-agent-browser/run";
import {
	ManagedSession,
	hasExplicitSession,
	hasLaunchScopedFlag,
} from "../../src/tools/frida-agent-browser/session";

/** spawn fake: devuelve un child tipo EventEmitter controlable. */
function fakeSpawn(out: {
	stdout?: string;
	stderr?: string;
	exitCode?: number;
	error?: { code?: string };
}) {
	return (_bin: string, _args: string[], _opts: unknown) => {
		const child = new EventEmitter() as EventEmitter & {
			stdin: { end: (d?: unknown) => void };
			stdout: EventEmitter;
			stderr: EventEmitter;
			kill: (s?: string) => void;
		};
		child.stdin = { end: () => {} };
		child.stdout = new EventEmitter();
		child.stderr = new EventEmitter();
		child.kill = () => {};
		queueMicrotask(() => {
			if (out.stdout) child.stdout.emit("data", Buffer.from(out.stdout));
			if (out.stderr) child.stderr.emit("data", Buffer.from(out.stderr));
			if (out.error) {
				child.emit(
					"error",
					Object.assign(new Error("spawn ENOENT"), { code: out.error.code }),
				);
			} else {
				child.emit("close", out.exitCode ?? 0);
			}
		});
		return child;
	};
}

describe("runAgentBrowser", () => {
	it("captura stdout JSON y exit 0", async () => {
		const r = await runAgentBrowser(
			{ args: ["open", "https://x", "--json"], cwd: process.cwd() },
			{ spawnFn: fakeSpawn({ stdout: '{"text":"ok"}' }) },
		);
		expect(r.exitCode).toBe(0);
		expect(r.stdout).toBe('{"text":"ok"}');
		expect(isMissingBinary(r)).toBe(false);
	});

	it("ENOENT → spawnError + isMissingBinary", async () => {
		const r = await runAgentBrowser(
			{ args: ["snapshot", "--json"], cwd: process.cwd() },
			{ spawnFn: fakeSpawn({ error: { code: "ENOENT" } }) },
		);
		expect(r.spawnError?.code).toBe("ENOENT");
		expect(isMissingBinary(r)).toBe(true);
	});

	it("exitCode != 0 se refleja", async () => {
		const r = await runAgentBrowser(
			{ args: ["x", "--json"], cwd: process.cwd() },
			{ spawnFn: fakeSpawn({ stdout: "boom", exitCode: 2 }) },
		);
		expect(r.exitCode).toBe(2);
	});
});

describe("parseAgentBrowserOutput (integración presentation — Fase 1)", () => {
	const P = (
		stdout: string,
		args: string[],
		extra: { stderr?: string; exitCode?: number | null } = {},
	) =>
		parseAgentBrowserOutput({
			stdout,
			stderr: extra.stderr ?? "",
			exitCode: extra.exitCode ?? 0,
			mode: "args",
			args,
			cwd: process.cwd(),
		});

	it("snapshot exitoso → render compacto con @refs", () => {
		const r = P(
			JSON.stringify({
				success: true,
				data: {
					origin: "https://example.com/",
					refs: { e1: { name: "Example Domain", role: "heading" } },
					snapshot: '- heading "Example Domain" [ref=e1]',
				},
				error: null,
			}),
			["snapshot", "-i"],
		);
		expect(r.content[0].text).toContain("[ref=e1]");
		expect(r.content[0].text).toMatch(/@e1 heading/);
		expect(r.isError).toBe(false);
		expect((r.details as { successCategory: string }).successCategory).toBe(
			"completed",
		);
	});

	it("open exitoso → 'Opened <url>'", () => {
		const r = P(
			JSON.stringify({
				success: true,
				data: { url: "https://x", title: "X" },
				error: null,
			}),
			["open", "https://x"],
		);
		expect(r.content[0].text).toBe("Opened https://x — X");
	});

	it("fallo del binario (success:false) → error + failureCategory + isError", () => {
		const r = P(
			JSON.stringify({
				success: false,
				data: null,
				error:
					"Element not found: @eZZ. Verify the selector, role, or name is correct.",
			}),
			["click", "@eZZ"],
			{ exitCode: 1 },
		);
		expect(r.isError).toBe(true);
		expect((r.details as { failureCategory: string }).failureCategory).toBe(
			"selector-not-found",
		);
		expect(r.content[0].text).toMatch(/Element not found/);
	});

	it("no-JSON → parseFailureResult (volcado crudo + parseError)", () => {
		const r = P("raw text", ["snapshot"]);
		expect(r.content[0].text).toBe("raw text");
		expect((r.details as { parseError: boolean }).parseError).toBe(true);
	});

	it("stdout vacío + stderr → usa stderr", () => {
		const r = P("", ["x"], { stderr: "boom", exitCode: 1 });
		expect(r.content[0].text).toBe("boom");
		expect(r.isError).toBe(true);
	});
});

describe("missingBinaryResult", () => {
	it("devuelve error graceful con failureCategory", () => {
		const r = missingBinaryResult();
		expect(r.isError).toBe(true);
		expect((r.details as { failureCategory: string }).failureCategory).toBe(
			"missing-binary",
		);
		expect(r.content[0].text).toMatch(/not found on PATH/);
	});
});

describe("applyOutputPath", () => {
	it("escribe el payload a archivo (relativo al cwd)", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fab-out-"));
		const abs = applyOutputPath(dir, "sub/out.json", { text: "hi" });
		expect(abs).toBe(path.join(dir, "sub", "out.json"));
		expect(JSON.parse(fs.readFileSync(abs, "utf8"))).toEqual({ text: "hi" });
		fs.rmSync(dir, { recursive: true, force: true });
	});
});

describe("bash-guard", () => {
	it("detecta agent-browser por bash", () => {
		expect(looksLikeAgentBrowserBash("agent-browser open https://x")).toBe(
			true,
		);
		expect(looksLikeAgentBrowserBash("ls -la")).toBe(false);
	});
	it("permite --help/--version", () => {
		expect(isHarmlessAgentBrowserInspection("agent-browser --help")).toBe(true);
		expect(isHarmlessAgentBrowserInspection("agent-browser --version")).toBe(
			true,
		);
		expect(isHarmlessAgentBrowserInspection("agent-browser open x")).toBe(
			false,
		);
	});
});

describe("ManagedSession", () => {
	it("reutiliza el mismo nombre y lo prefija", () => {
		const s = new ManagedSession("/tmp");
		const p1 = s.prefixFor(["open", "https://x"], false);
		expect(p1).toEqual(["--session", s.name]);
		const before = s.name;
		const p2 = s.prefixFor(["snapshot", "-i"], false);
		expect(s.name).toBe(before); // sin bump
		expect(p2[1]).toBe(before);
	});
	it("sessionMode fresh eleva el ordinal", () => {
		const s = new ManagedSession("/tmp");
		s.prefixFor(["open", "https://x"], false);
		const n0 = s.name;
		s.prefixFor(["open", "https://y"], true);
		expect(s.name).not.toBe(n0);
	});
	it("sesión explícita (--session) → sin prefijo", () => {
		const s = new ManagedSession("/tmp");
		expect(s.prefixFor(["--session", "mine", "open", "x"], false)).toEqual([]);
	});
	it("detecta flags launch-scoped", () => {
		expect(hasLaunchScopedFlag(["--profile", "Default", "open", "x"])).toBe(
			true,
		);
		expect(hasLaunchScopedFlag(["open", "x"])).toBe(false);
		expect(hasExplicitSession(["--session-name", "s", "open", "x"])).toBe(true);
	});

	it("contrato 0.34.0: flags que pasaron a ser launch-scoped", () => {
		// 0.4.3: caller --args y --user-agent son launch-scoped (0.34.0 trata
		// override vacío como nueva config de launch).
		expect(hasLaunchScopedFlag(["--args", "--headless", "open", "x"])).toBe(
			true,
		);
		expect(hasLaunchScopedFlag(["--user-agent=X", "open", "x"])).toBe(true);
		expect(hasLaunchScopedFlag(["--headed", "open", "x"])).toBe(true);
		expect(hasLaunchScopedFlag(["--idle-timeout", "30000", "open", "x"])).toBe(
			true,
		);
		expect(
			hasLaunchScopedFlag(["--allowed-domains", "a.com", "open", "x"]),
		).toBe(true);
		expect(
			hasLaunchScopedFlag(["--restore-check-url", "http://x", "open", "y"]),
		).toBe(true);
	});

	it("wait --state es predicado, no launch-scoped (mirror 0.34.0)", () => {
		expect(hasLaunchScopedFlag(["wait", "--state", "visible"])).toBe(false);
		// --state ANTES del comando sigue siendo launch-scoped (estado de launch).
		expect(hasLaunchScopedFlag(["--state", "x", "open", "y"])).toBe(true);
		// Con flags de valor globales delante, el comando se detecta igual.
		expect(
			hasLaunchScopedFlag(["--profile", "P", "wait", "--state", "hidden"]),
		).toBe(true); // por --profile, no por --state
	});

	it("--auto-connect sólo cuando habilitado (last-wins)", () => {
		expect(hasLaunchScopedFlag(["--auto-connect", "open", "x"])).toBe(true);
		expect(
			hasLaunchScopedFlag(["--auto-connect", "false", "open", "x"]),
		).toBe(false);
		expect(hasLaunchScopedFlag(["--auto-connect=false", "open", "x"])).toBe(
			false,
		);
	});

	it("--pin-tab es sticky (booleano global, NO launch-scoped)", () => {
		expect(hasLaunchScopedFlag(["--pin-tab", "snapshot", "-i"])).toBe(false);
		expect(hasLaunchScopedFlag(["--no-pin-tab", "snapshot", "-i"])).toBe(
			false,
		);
		// Puede operar sobre sesión viva: no debe disparar política de fresh.
		expect(hasLaunchScopedFlag(["--pin-tab", "false", "get", "url"])).toBe(
			false,
		);
	});
});
