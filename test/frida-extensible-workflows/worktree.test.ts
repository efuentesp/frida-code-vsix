// Fase 6 — withWorktree: el agente del scope corre en el path del worktree
// aislado (git worktree). Requiere git en el entorno.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWorkflowInStore } from "../../src/tools/frida-extensible-workflows/frida-host";
import type { SpawnAgentFn } from "../../src/tools/frida-extensible-workflows/frida-agent-execution";

const SESSION = "sess-wt";
let home: string;
let repo: string;
beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "frida-wt-home-"));
	repo = mkdtempSync(join(tmpdir(), "frida-wt-repo-"));
	// worktree add requiere al menos 1 commit + user config.
	execSync("git init -q", { cwd: repo });
	execSync("git config user.email t@t.t", { cwd: repo });
	execSync("git config user.name t", { cwd: repo });
	execSync("git commit --allow-empty -q -m init", { cwd: repo });
});
afterEach(() => {
	rmSync(home, { recursive: true, force: true });
	rmSync(repo, { recursive: true, force: true });
});

describe("frida-extensible-workflows · withWorktree (Fase 6)", () => {
	it("el agente dentro de withWorktree corre en el path del worktree", async () => {
		const seenCwds: string[] = [];
		const spawn: SpawnAgentFn = async (p) => `default:${p}`;
		const createSpawnerForCwd = (worktreeCwd: string): SpawnAgentFn => {
			return async (p) => {
				seenCwds.push(worktreeCwd);
				return `wt:${p}`;
			};
		};
		const script =
			"const r = await withWorktree('iso', async () => agent('x')); return r;";

		const { result } = await runWorkflowInStore({
			name: "wt",
			script,
			args: null,
			cwd: repo,
			sessionId: SESSION,
			spawnAgent: spawn,
			home,
			createSpawnerForCwd,
		});

		expect(result).toBe("wt:x");
		expect(seenCwds).toHaveLength(1);
		// El worktree se materializa bajo home/.frida-worktrees. El owner que recibe
		// bridge.worktree es el path estructural (worktree/named/iso), así que el
		// path contiene el nombre del scope ('iso').
		expect(seenCwds[0]!.startsWith(join(home, ".frida-worktrees"))).toBe(true);
		expect(seenCwds[0]!).toContain("iso");
	}, 15000);

	it("agentes FUERA de withWorktree usan el spawner por defecto (cwd del repo)", async () => {
		const seenCwds: string[] = [];
		const spawn: SpawnAgentFn = async (p) => `default:${p}`;
		const createSpawnerForCwd = (worktreeCwd: string): SpawnAgentFn => {
			return async () => {
				seenCwds.push(worktreeCwd);
				return "wt";
			};
		};
		// Sin withWorktree → el agente usa el spawner por defecto.
		const { result } = await runWorkflowInStore({
			name: "nowt",
			script: "return await agent('plain');",
			args: null,
			cwd: repo,
			sessionId: SESSION,
			spawnAgent: spawn,
			home,
			createSpawnerForCwd,
		});
		expect(result).toBe("default:plain");
		expect(seenCwds).toHaveLength(0);
	}, 15000);
});
