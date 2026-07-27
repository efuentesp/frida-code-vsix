import { describe, it, expect } from "vitest";
import { homedir } from "node:os";
import { isExternalPath } from "../../src/gates/external-paths";

// cwd canónico para los tests (POSIX). Los asserts de paths absolutos son
// deterministas; los de `~` dependen del homedir real (se validan como external
// sin chequear el absPath, que varía por máquina).
const CWD = "/Users/dev/proyecto";

describe("isExternalPath", () => {
	describe("marca como externos (force-ask)", () => {
		const externalsAbs: Array<[unknown, string]> = [
			["/etc/passwd", "/etc/passwd"],
			["/tmp/foo", "/tmp/foo"],
			["/Users/dev/otro/x.ts", "/Users/dev/otro/x.ts"], // hermano del workspace
		];
		for (const [p, expectedAbs] of externalsAbs) {
			it(`externo absoluto: ${String(p)}`, () => {
				const r = isExternalPath(p, CWD);
				expect(r.external).toBe(true);
				expect(r.absPath).toBe(expectedAbs);
			});
		}

		it("marca relativo con .. que escapa del workspace", () => {
			const r = isExternalPath("../../otro/secreto", CWD);
			expect(r.external).toBe(true);
			expect(r.absPath).toBe("/Users/otro/secreto");
		});

		it("expande ~ y queda fuera del workspace", () => {
			const r = isExternalPath("~/Documents/notas.md", CWD);
			expect(r.external).toBe(true);
			expect(r.absPath).toBe(`${homedir()}/Documents/notas.md`);
		});

		it("expande $HOME y queda fuera del workspace", () => {
			const r = isExternalPath("$HOME/.bashrc", CWD);
			expect(r.external).toBe(true);
			expect(r.absPath).toBe(`${homedir()}/.bashrc`);
		});
	});

	describe("deja pasar paths internos", () => {
		const internals: Array<unknown> = [
			"src/app.ts",
			"./config.json",
			"../proyecto/sub/x.ts", // resolve a /Users/dev/proyecto/sub/x.ts (dentro)
			"README.md",
			"/Users/dev/proyecto", // el cwd mismo
			"/Users/dev/proyecto/deep/nested/file.ts",
		];
		for (const p of internals) {
			it(`interno: ${String(p)}`, () => {
				expect(isExternalPath(p, CWD).external).toBe(false);
			});
		}
	});

	describe("entradas inválidas o sin cwd", () => {
		it("no marca si el path no es string (array)", () => {
			expect(isExternalPath(["a", "b"], CWD).external).toBe(false);
		});
		it("no marca si el path es vacío", () => {
			expect(isExternalPath("", CWD).external).toBe(false);
		});
		it("no marca si el path es undefined", () => {
			expect(isExternalPath(undefined, CWD).external).toBe(false);
		});
		it("no decide si cwd está vacío", () => {
			expect(isExternalPath("/etc/passwd", "").external).toBe(false);
		});
	});
});
