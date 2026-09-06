import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
	expandHome,
	readSharedDenylist,
} from "../../src/gates/shared-denylist";

const dir = mkdtempSync(join(tmpdir(), "frida-denylist-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Escribe el archivo y fuerza un mtime distinto (la cache compara mtimeMs). */
function write(path: string, content: string, atMs: number): void {
	writeFileSync(path, content, "utf8");
	utimesSync(path, new Date(atMs), new Date(atMs));
}

describe("readSharedDenylist (#196)", () => {
	it("lee el archivo: una regex por línea, sin comentarios ni vacías", () => {
		const f = join(dir, "basic.txt");
		write(
			f,
			[
				"# Comentario del guard",
				"(^|[;&|[:space:]])rm[[:space:]]+-rf[[:space:]]+/",
				"",
				"   # comentario con sangría",
				"gh[[:space:]]+repo[[:space:]]+delete",
				"  --no-preserve-root  ",
			].join("\n"),
			1_000_000,
		);
		expect(readSharedDenylist(f)).toEqual([
			"(^|[;&|[:space:]])rm[[:space:]]+-rf[[:space:]]+/",
			"gh[[:space:]]+repo[[:space:]]+delete",
			"--no-preserve-root",
		]);
	});

	it("FAIL-OPEN: archivo inexistente → [] (no lanza)", () => {
		expect(readSharedDenylist(join(dir, "no-existe.txt"))).toEqual([]);
	});

	it("FAIL-OPEN: ruta vacía o undefined → []", () => {
		expect(readSharedDenylist("")).toEqual([]);
		expect(readSharedDenylist(undefined)).toEqual([]);
	});

	it("cache por mtime: mismo mtime no relee; mtime nuevo relee", () => {
		const f = join(dir, "cache.txt");
		write(f, "patron-a\n", 2_000_000);
		expect(readSharedDenylist(f)).toEqual(["patron-a"]);
		// Cambio de contenido SIN cambio de mtime → cache (semántica mtime).
		writeFileSync(f, "patron-a\npatron-b\n", "utf8");
		utimesSync(f, new Date(2_000_000), new Date(2_000_000));
		expect(readSharedDenylist(f)).toEqual(["patron-a"]);
		// mtime avanza → relectura.
		write(f, "patron-a\npatron-b\n", 3_000_000);
		expect(readSharedDenylist(f)).toEqual(["patron-a", "patron-b"]);
	});

	it("expande ~ y ~/ al home del usuario", () => {
		const home = expandHome("~");
		const nested = expandHome("~/agents/hooks/dangerous-patterns.txt");
		expect(home).not.toContain("~");
		expect(nested.startsWith(home)).toBe(true);
		expect(nested).not.toContain("~");
	});

	it("rutas absolutas y relativas quedan intactas (solo ~ se expande)", () => {
		expect(expandHome("/tmp/x.txt")).toBe("/tmp/x.txt");
		expect(expandHome("relative/patterns.txt")).toBe("relative/patterns.txt");
	});

	it("integra con isDangerousBash: líneas del archivo bloquean vía extraPatterns", async () => {
		const { isDangerousBash } = await import(
			"../../src/gates/dangerous-commands"
		);
		const f = join(dir, "integra.txt");
		write(
			f,
			"(^|[;&|[:space:]])git[[:space:]]+push[^;&|]*[[:space:]](-f|--force)([[:space:]]|$)\n",
			4_000_000,
		);
		const patterns = readSharedDenylist(f);
		expect(
			isDangerousBash("git push --force origin main", { extraPatterns: patterns })
				.denied,
		).toBe(true);
	});
});
