import { describe, it, expect } from "vitest";
import { isSensitivePath } from "../../src/gates/sensitive-paths";

describe("isSensitivePath", () => {
	describe("bloquea paths sensibles (deny)", () => {
		const cases: string[] = [
			".env",
			"./.env",
			"config/.env",
			"~/.env",
			".env.local",
			"deploy/.env.production",
			".env.staging",
			"~/.ssh/config",
			"/home/x/.ssh/id_rsa",
			"secrets/key.pem",
			"certs/server.pem",
			"cert.p12",
			"keystore.jks",
			"~/.aws/credentials",
			"~/.gnupg/secring.gpg",
			".npmrc",
			".netrc",
			".pypirc",
			".git/config",
			".gitconfig",
			"id_rsa",
			"id_ed25519",
			"id_ecdsa",
		];
		for (const p of cases) {
			it(`deniega ${p}`, () => {
				const r = isSensitivePath(p);
				expect(r.denied).toBe(true);
				expect(r.reason).toBeTruthy();
			});
		}

		it("ignora mayúsculas en el basename (.ENV)", () => {
			expect(isSensitivePath("APP/.ENV").denied).toBe(true);
		});
	});
	describe("permite paths legítimos (allow)", () => {
		const cases: Array<string | undefined> = [
			".env.example",
			".env.sample",
			".env.template",
			".env.defaults",
			"src/app.ts",
			"config/.env.example",
			"id_rsa.pub", // clave pública: no es secreto
			"README.md",
			"package.json",
			undefined,
			"",
			"   ",
		];
		for (const p of cases) {
			it(`permite ${String(p)}`, () => {
				expect(isSensitivePath(p).denied).toBe(false);
			});
		}
	});

	describe("patrones configurables (opts)", () => {
		it("bloquea una extensión extra del usuario", () => {
			// app.properties es legítimo por defecto; el usuario lo marca como sensible.
			expect(isSensitivePath("config/app.properties").denied).toBe(false);
			expect(
				isSensitivePath("config/app.properties", { extraExtensions: ["properties"] }).denied,
			).toBe(true);
		});

		it("acepta la extensión extra con o sin punto", () => {
			expect(isSensitivePath("x.keystore", { extraExtensions: ["keystore"] }).denied).toBe(true);
			expect(isSensitivePath("x.keystore", { extraExtensions: [".keystore"] }).denied).toBe(true);
		});

		it("bloquea un basename exacto extra", () => {
			expect(
				isSensitivePath("deploy/credentials.json", {
					extraBasenames: ["credentials.json"],
				}).denied,
			).toBe(true);
		});

		it("el allowlist del usuario anula incluso a .env", () => {
			// .env se bloquea por defecto; el usuario permite una variante concreta.
			expect(isSensitivePath(".env").denied).toBe(true);
			expect(
				isSensitivePath(".env.local.dev", { extraAllow: [".env.local.dev"] }).denied,
			).toBe(false);
		});

		it("el allowlist extra es case-insensitive", () => {
			expect(
				isSensitivePath("CONFIG.PROPERTIES", { extraAllow: ["config.properties"] }).denied,
			).toBe(false);
		});

		it("sin opts, se comporta igual que antes (compatibilidad)", () => {
			expect(isSensitivePath("app.properties").denied).toBe(false);
			expect(isSensitivePath(".env").denied).toBe(true);
		});
	});
});
