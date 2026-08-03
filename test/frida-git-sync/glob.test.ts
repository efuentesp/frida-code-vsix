// frida-git-sync — tests de la capa sync/glob (pure, solo node:*).
//
// Cubre: BUILTIN_HARD_DENY, normalizePath, minimatch, isPathAllowed
// (prioridad hard-deny > include > exclude).

import { describe, it, expect } from "vitest";
import {
	BUILTIN_HARD_DENY,
	normalizePath,
	minimatch,
	isPathAllowed,
} from "../../src/tools/frida-git-sync/src/sync/glob";

describe("frida-git-sync / glob", () => {
	describe("BUILTIN_HARD_DENY", () => {
		it("bloquea auth, sessions, trust, models-store, claves y node_modules", () => {
			const expected = [
				"auth.json",
				"sessions/**",
				"trust.json",
				"models-store.json",
				"npm/**",
				"node_modules/**",
			];
			for (const pattern of expected) {
				expect(BUILTIN_HARD_DENY).toContain(pattern);
			}
		});

		it("bloquea secretos potenciales (.env, *.pem, id_rsa, id_ed25519)", () => {
			expect(BUILTIN_HARD_DENY).toContain("**/.env");
			expect(BUILTIN_HARD_DENY).toContain("**/*.pem");
			expect(BUILTIN_HARD_DENY).toContain("**/id_rsa");
			expect(BUILTIN_HARD_DENY).toContain("**/id_ed25519");
		});
	});

	describe("normalizePath", () => {
		it("rechaza rutas absolutas POSIX y Windows", () => {
			expect(() => normalizePath("/etc/passwd")).toThrow();
			expect(() => normalizePath("C:\\Users\\x")).toThrow();
		});

		it("rechaza traversal ..", () => {
			expect(() => normalizePath("../escape")).toThrow();
			expect(() => normalizePath("a/../../b")).toThrow();
		});

		it("normaliza ./ y backslashes", () => {
			expect(normalizePath("./skills/my-skill")).toBe("skills/my-skill");
			expect(normalizePath("skills\\my-skill")).toBe("skills/my-skill");
		});
	});

	describe("minimatch", () => {
		it("soporta globs ** y sufijos", () => {
			expect(minimatch("a/b/.env", "**/.env")).toBe(true);
			expect(minimatch("key.pem", "**/*.pem")).toBe(true);
			expect(minimatch("skills/commit.md", "skills/**")).toBe(true);
		});

		it("no matchea fuera del patrón", () => {
			expect(minimatch("settings.json", "skills/**")).toBe(false);
			expect(minimatch("auth.json", "settings.json")).toBe(false);
		});
	});

	describe("isPathAllowed", () => {
		const include = ["settings.json", "skills/**", "extensions/**"];
		const exclude = ["**/.DS_Store", "extensions/**/.cache/**"];

		it("HARD-DENY gana sobre include (auth.json nunca se permite)", () => {
			const r = isPathAllowed("auth.json", ["auth.json"], []);
			expect(r.allowed).toBe(false);
			expect(r.denied).toBe(true);
		});

		it("niega lo que no está en include", () => {
			const r = isPathAllowed("prompts/x.md", include, exclude);
			expect(r.allowed).toBe(false);
			expect(r.denied).toBe(false);
		});

		it("permite lo que está en include y no en exclude", () => {
			expect(isPathAllowed("settings.json", include, exclude).allowed).toBe(
				true,
			);
			expect(isPathAllowed("skills/commit.md", include, exclude).allowed).toBe(
				true,
			);
		});

		it("exclude niega aunque esté en include", () => {
			const r = isPathAllowed("extensions/foo/.cache/x", include, exclude);
			expect(r.allowed).toBe(false);
		});

		it("hard-deny de subpath (.env dentro de skills)", () => {
			const r = isPathAllowed("skills/.env", include, []);
			expect(r.allowed).toBe(false);
			expect(r.denied).toBe(true);
		});
	});
});
