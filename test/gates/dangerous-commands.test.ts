import { describe, it, expect } from "vitest";
import { isDangerousBash } from "../../src/gates/dangerous-commands";

describe("isDangerousBash", () => {
	describe("bloquea comandos destructivos (deny)", () => {
		const cases: Array<[string, string]> = [
			["rm -rf /", "rm-rf-root"],
			["rm  -rf  /*", "rm-rf-root"], // espacios colapsados
			["sudo rm -rf /", "rm-rf-root"],
			["rm -rf ~", "rm-rf-home"],
			["rm -rf ~/", "rm-rf-home"],
			["rm -rf $HOME", "rm-rf-home"],
			['rm -rf "$HOME"', "rm-rf-home"],
			["sudo rm -rf ~ && echo done", "rm-rf-home"], // encadenado: pesca igual
			[":(){ :|:& };:", "fork-bomb"],
			["mkfs", "mkfs"],
			["mkfs.ext4 /dev/sda1", "mkfs"],
			["dd if=img.iso of=/dev/sda", "dd-to-device"],
			["> /dev/sda", "truncate-device"],
			["echo x > /dev/nvme0n1", "truncate-device"],
			["chmod -R 777 /", "chmod-777-root"],
		];
		for (const [cmd, pattern] of cases) {
			it(`deniega "${cmd}" → [${pattern}]`, () => {
				const r = isDangerousBash(cmd);
				expect(r.denied).toBe(true);
				expect(r.pattern).toBe(pattern);
				expect(r.reason).toBeTruthy();
			});
		}
	});

	describe("permite comandos legítimos (allow)", () => {
		const cases: Array<string | undefined> = [
			"rm -rf dist",
			"rm -rf node_modules",
			"rm -rf .cache", // rm -rf * de subdir es legítimo
			"rm -rf *", // común en builds
			"git status",
			"npm install",
			"npm run build && npm test", // && NO es peligroso (es indirección, otro gate)
			"ls -la",
			"curl -sL https://get.example.com | bash", // subjetivo: fuera del subconjunto conservador
			"chmod 755 script.sh",
			"chmod -R 777 ./build", // 777 pero de subdir, no de raíz
			"",
			undefined,
		];
		for (const cmd of cases) {
			it(`permite "${String(cmd)}"`, () => {
				expect(isDangerousBash(cmd).denied).toBe(false);
			});
		}
	});

	describe("patrones configurables (opts)", () => {
		it("bloquea por un substring extra del usuario", () => {
			// dropdb es legítimo por defecto; el usuario lo marca.
			expect(isDangerousBash("dropdb mydb").denied).toBe(false);
			expect(
				isDangerousBash("dropdb mydb", { extraSubstrings: ["dropdb"] }).denied,
			).toBe(true);
			expect(isDangerousBash("dropdb mydb", { extraSubstrings: ["dropdb"] }).pattern).toBe("user-substring");
		});

		it("el substring es sensible a mayúsculas", () => {
			expect(isDangerousBash("DROPDB x", { extraSubstrings: ["dropdb"] }).denied).toBe(false);
		});

		it("ignora substrings vacíos", () => {
			expect(isDangerousBash("ls", { extraSubstrings: [""] }).denied).toBe(false);
		});

		it("el substring se evalúa sobre el comando normalizado (espacios colapsados)", () => {
			expect(
				isDangerousBash("foo    bar   baz", { extraSubstrings: ["foo bar baz"] }).denied,
			).toBe(true);
		});

		it("sin opts, se comporta igual que antes (compatibilidad)", () => {
			expect(isDangerousBash("rm -rf /").denied).toBe(true);
			expect(isDangerousBash("git status").denied).toBe(false);
		});
	});
});
