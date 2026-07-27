import { describe, it, expect } from "vitest";
import { hasShellIndirection } from "../../src/gates/bash-indirection";

describe("hasShellIndirection", () => {
	describe("detecta encadenamiento y wrappers (force-ask)", () => {
		const cases: string[] = [
			"git status && npm test",
			"build || exit 1",
			"ls | grep foo",
			"cd /tmp; rm x",
			"npm run build\nnpm test", // salto de línea
			"sudo apt update",
			"sudo -u root whoami",
			"bash -c 'echo hi'",
			"sh -c 'rm x'",
			"zsh -lc 'pwd'",
			"eval $(cat cmd)",
			"exec ./server",
			"find . | xargs rm",
			"source ~/.bashrc",
			"nohup ./server &",
			"env VAR=1 ./bin",
		];
		for (const cmd of cases) {
			it(`detecta "${cmd}"`, () => {
				const r = hasShellIndirection(cmd);
				expect(r.detected).toBe(true);
				expect(r.reason).toBeTruthy();
			});
		}
	});

	describe("deja pasar comandos simples", () => {
		const cases: Array<string | undefined> = [
			"git status",
			"npm install",
			"ls -la",
			"echo hello world",
			"node script.js",
			"docker build -t app .",
			"",
			undefined,
		];
		for (const cmd of cases) {
			it(`deja pasar "${String(cmd)}"`, () => {
				expect(hasShellIndirection(cmd).detected).toBe(false);
			});
		}
	});
});
