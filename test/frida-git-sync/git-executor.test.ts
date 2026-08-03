// frida-git-sync — tests de la inyección del git executor (ADR-0026 D1).
//
// Verifica que gitExec/gitProbe enrutan por el override instalado con
// setGitExecutor (lo que la factory cablea a pi.exec) y que los fallos con la
// forma GitProcessFailure se mapean a GitCommandError. No requiere Pi: se
// inyecta un executor de prueba.

import { describe, it, expect, afterEach } from "vitest";
import {
	gitExec,
	gitProbe,
	setGitExecutor,
	GitCommandError,
} from "../../src/tools/frida-git-sync/src/system/git";

describe("frida-git-sync / git executor injection", () => {
	afterEach(() => setGitExecutor(undefined));

	it("gitExec usa el executor inyectado y devuelve GitCommandOutput", async () => {
		setGitExecutor(async () => ({ stdout: "main", stderr: "" }));
		const out = await gitExec("/repo", ["rev-parse", "--abbrev-ref", "HEAD"]);
		expect(out.stdout).toBe("main");
	});

	it("el executor recibe el request con dir/gitArgs/timeoutMilliseconds", async () => {
		let captured:
			| { dir: string; gitArgs: string[]; timeoutMilliseconds: number }
			| undefined;
		setGitExecutor(async (req) => {
			captured = req;
			return { stdout: "", stderr: "" };
		});
		await gitExec("/my/repo", ["status", "--porcelain"], { timeout: 5000 });
		expect(captured!.dir).toBe("/my/repo");
		expect(captured!.gitArgs).toEqual(["status", "--porcelain"]);
		expect(captured!.timeoutMilliseconds).toBe(5000);
	});

	it("mapea un fallo (code != 0) a GitCommandError con el exit code", async () => {
		setGitExecutor(async () => {
			throw { code: 1, stdout: "", stderr: "boom" };
		});
		await expect(gitExec("/repo", ["bad"])).rejects.toThrow(GitCommandError);
		try {
			await gitExec("/repo", ["bad"]);
		} catch (e) {
			expect((e as GitCommandError).exitCode).toBe(1);
			expect((e as GitCommandError).stderr).toBe("boom");
		}
	});

	it("mapea killed/ETIMEDOUT a GitCommandError con timedOut=true", async () => {
		setGitExecutor(async () => {
			throw { code: "ETIMEDOUT", killed: true, stdout: "", stderr: "" };
		});
		try {
			await gitExec("/repo", ["slow"]);
			expect.fail("debería lanzar");
		} catch (e) {
			expect(e).toBeInstanceOf(GitCommandError);
			expect((e as GitCommandError).timedOut).toBe(true);
		}
	});

	it("gitProbe no lanza y reporta ok:false ante un fallo", async () => {
		setGitExecutor(async () => {
			throw { code: 128, stdout: "", stderr: "no remote" };
		});
		const r = await gitProbe("/repo", ["ls-remote"]);
		expect(r.ok).toBe(false);
		expect(r.stderr).toBe("no remote");
	});

	it("sin override instalado, runGitProcess usa el spawner nativo (falla sin git/repo)", async () => {
		// setGitExecutor(undefined) tras el afterEach; gitExec intenta spawn de git
		// en un path inexistente → lanza GitCommandError (no el override).
		await expect(
			gitExec("/no/such/repo/__frida_test__", ["rev-parse", "HEAD"], {
				timeout: 2000,
			}),
		).rejects.toThrow(GitCommandError);
	});
});
