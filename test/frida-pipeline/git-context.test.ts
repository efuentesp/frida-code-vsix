// frida-pipeline — tests de git-context y detección de mutating commands.
//
// Verifica:
//   - isGitMutatingCommand detecta checkout/commit/merge/etc. y no dispara
//     en comandos no-mutantes (status, log, diff).
//   - takeGitContextIfChanged con un pi.exec mockeado devuelve el formato
//     "## Git Context" con branch/commit/user.
//   - Dedup: segunda llamada sin cambios → null.
//   - clearGitContextCache + resetInjectedMarker resetean el estado.

import { describe, it, expect, beforeEach } from "vitest";
import {
	isGitMutatingCommand,
	clearGitContextCache,
	resetInjectedMarker,
	takeGitContextIfChanged,
} from "../../src/tools/frida-pipeline/git-context";

/** Mock de ExtensionAPI que sólo implementa exec con respuestas prefijadas. */
function mockPi(responses: Array<{ stdout: string }>): {
	exec: (
		cmd: string,
		args: string[],
		opts?: unknown,
	) => Promise<{ stdout: string }>;
	getFlag: (n: string) => boolean;
	sendMessage: (m: unknown) => void;
} {
	let callIdx = 0;
	return {
		exec: async () => {
			const r = responses[callIdx] ?? { stdout: "" };
			callIdx++;
			return r;
		},
		getFlag: () => false,
		sendMessage: () => {},
	};
}

beforeEach(() => {
	clearGitContextCache();
	resetInjectedMarker();
});

describe("frida-pipeline / git-context / isGitMutatingCommand", () => {
	it("detecta checkout, commit, merge, rebase, pull, reset", () => {
		expect(isGitMutatingCommand("git checkout -b feature")).toBe(true);
		expect(isGitMutatingCommand("git commit -m 'wip'")).toBe(true);
		expect(isGitMutatingCommand("git merge main")).toBe(true);
		expect(isGitMutatingCommand("git rebase -i HEAD~3")).toBe(true);
		expect(isGitMutatingCommand("git pull origin main")).toBe(true);
		expect(isGitMutatingCommand("git reset --hard HEAD~1")).toBe(true);
		expect(isGitMutatingCommand("git revert abc123")).toBe(true);
		expect(isGitMutatingCommand("git stash")).toBe(true);
		expect(isGitMutatingCommand("git switch develop")).toBe(true);
		expect(isGitMutatingCommand("git cherry-pick abc123")).toBe(true);
	});

	it("NO dispara en comandos no-mutantes (status, log, diff, add)", () => {
		expect(isGitMutatingCommand("git status")).toBe(false);
		expect(isGitMutatingCommand("git log --oneline")).toBe(false);
		expect(isGitMutatingCommand("git diff HEAD")).toBe(false);
		expect(isGitMutatingCommand("git add -A")).toBe(false);
		expect(isGitMutatingCommand("git rev-parse --abbrev-ref HEAD")).toBe(false);
		expect(isGitMutatingCommand("ls -la")).toBe(false);
		expect(isGitMutatingCommand("npm test")).toBe(false);
	});

	it("detecta git con argumentos complejos", () => {
		expect(isGitMutatingCommand("git commit --amend --no-edit")).toBe(true);
		expect(isGitMutatingCommand("git worktree add ../foo")).toBe(true);
	});
});

describe("frida-pipeline / git-context / takeGitContextIfChanged", () => {
	it("devuelve el formato '## Git Context' con branch/commit/user", async () => {
		// rev-parse --abbrev-ref → "main", rev-parse --short → "abc1234",
		// config user.name → "Edgar"
		const pi = mockPi([
			{ stdout: "main\n" },
			{ stdout: "abc1234\n" },
			{ stdout: "Edgar\n" },
		]);
		const content = await takeGitContextIfChanged(pi as never);
		expect(content).not.toBeNull();
		expect(content).toContain("## Git Context");
		expect(content).toContain("Branch: main");
		expect(content).toContain("Commit: abc1234");
		expect(content).toContain("User: Edgar");
	});

	it("remapea detached HEAD a 'detached'", async () => {
		const pi = mockPi([
			{ stdout: "HEAD\n" },
			{ stdout: "abc1234\n" },
			{ stdout: "Edgar\n" },
		]);
		const content = await takeGitContextIfChanged(pi as never);
		expect(content).toContain("Branch: detached");
	});

	it("dedup: segunda llamada sin cambios → null", async () => {
		const pi = mockPi([
			{ stdout: "main\n" },
			{ stdout: "abc1234\n" },
			{ stdout: "Edgar\n" },
			// El cache se mantiene, así que la segunda llamada no exec de nuevo.
		]);
		const first = await takeGitContextIfChanged(pi as never);
		expect(first).not.toBeNull();

		const second = await takeGitContextIfChanged(pi as never);
		expect(second).toBeNull();
	});

	it("tras clearGitContextCache, reinyecta si la firma cambió", async () => {
		// Primera lectura: main/abc1234
		const pi1 = mockPi([
			{ stdout: "main\n" },
			{ stdout: "abc1234\n" },
			{ stdout: "Edgar\n" },
		]);
		await takeGitContextIfChanged(pi1 as never);

		// Simula un checkout: limpia cache + nueva lectura con branch distinto.
		clearGitContextCache();
		resetInjectedMarker();
		const pi2 = mockPi([
			{ stdout: "feature\n" },
			{ stdout: "def5678\n" },
			{ stdout: "Edgar\n" },
		]);
		const content = await takeGitContextIfChanged(pi2 as never);
		expect(content).not.toBeNull();
		expect(content).toContain("Branch: feature");
		expect(content).toContain("Commit: def5678");
	});

	it("cae a USER de env si config user.name falla", async () => {
		const oldUser = process.env.USER;
		process.env.USER = "testuser";
		const pi = mockPi([
			{ stdout: "main\n" },
			{ stdout: "abc1234\n" },
			// config user.name → vacío (triggers catch → env fallback)
		]);
		const content = await takeGitContextIfChanged(pi as never);
		expect(content).toContain("User: testuser");
		process.env.USER = oldUser;
	});
});
