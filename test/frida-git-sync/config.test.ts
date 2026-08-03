// frida-git-sync — tests de sync/config (validateConfig + DEFAULT_CONFIG).
//
// Cubre: acepta config válida; rechaza schemaVersion, branch, paths unsafe,
// delete, pullTimeoutMs y security inválidos.

import { describe, it, expect } from "vitest";
import {
	validateConfig,
	DEFAULT_CONFIG,
	type PiSyncConfig,
} from "../../src/tools/frida-git-sync/src/sync/config";

function valid(
	overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
	return {
		schemaVersion: 2,
		branch: "main",
		root: "sync",
		include: ["settings.json", "skills/**"],
		exclude: ["**/.DS_Store"],
		delete: "tracked",
		pullTimeoutMs: 10000,
		security: { scanSecretsBeforePush: true },
		...overrides,
	};
}

describe("frida-git-sync / config", () => {
	describe("DEFAULT_CONFIG", () => {
		it("tiene schemaVersion 2, branch main, root sync, delete tracked", () => {
			expect(DEFAULT_CONFIG.schemaVersion).toBe(2);
			expect(DEFAULT_CONFIG.branch).toBe("main");
			expect(DEFAULT_CONFIG.root).toBe("sync");
			expect(DEFAULT_CONFIG.delete).toBe("tracked");
			expect(DEFAULT_CONFIG.pullTimeoutMs).toBe(10000);
			expect(DEFAULT_CONFIG.security.scanSecretsBeforePush).toBe(true);
		});

		it("include cubre settings, AGENTS, extensions, skills, prompts, themes", () => {
			for (const p of [
				"settings.json",
				"AGENTS.md",
				"extensions/**",
				"skills/**",
				"prompts/**",
				"themes/**",
			]) {
				expect(DEFAULT_CONFIG.include).toContain(p);
			}
		});
	});

	describe("validateConfig", () => {
		it("acepta una config válida", () => {
			const cfg: PiSyncConfig = validateConfig(valid());
			expect(cfg.branch).toBe("main");
			expect(cfg.include).toEqual(["settings.json", "skills/**"]);
		});

		it("rechaza schemaVersion distinto de 2", () => {
			expect(() => validateConfig(valid({ schemaVersion: 1 }))).toThrow();
			expect(() => validateConfig(valid({ schemaVersion: 3 }))).toThrow();
		});

		it("rechaza branch con espacios líder/final o prefijo '-'", () => {
			expect(() => validateConfig(valid({ branch: " fea ture" }))).toThrow();
			expect(() => validateConfig(valid({ branch: "fea ture " }))).toThrow();
			expect(() => validateConfig(valid({ branch: "-leading" }))).toThrow();
		});

		it("rechaza include/exclude con traversal .. o rutas absolutas", () => {
			expect(() => validateConfig(valid({ include: ["../escape"] }))).toThrow();
			expect(() => validateConfig(valid({ exclude: ["/abs/path"] }))).toThrow();
		});

		it("rechaza delete fuera de tracked|none", () => {
			expect(() => validateConfig(valid({ delete: "all" }))).toThrow();
		});

		it("rechaza pullTimeoutMs no entero positivo", () => {
			expect(() => validateConfig(valid({ pullTimeoutMs: -1 }))).toThrow();
			expect(() => validateConfig(valid({ pullTimeoutMs: 1.5 }))).toThrow();
		});

		it("rechaza scanSecretsBeforePush no booleano", () => {
			expect(() =>
				validateConfig(valid({ security: { scanSecretsBeforePush: "yes" } })),
			).toThrow();
		});
	});
});
