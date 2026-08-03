// frida-git-sync — tests de sync/settings-portability.
//
// Cubre: isPortablePackageSource, sanitizeSettingsForRepository (quita file:),
// mergeLocalPackagesIntoSettings (preserva file: locales).

import { describe, it, expect } from "vitest";
import {
	isPortablePackageSource,
	sanitizeSettingsForRepository,
	mergeLocalPackagesIntoSettings,
} from "../../src/tools/frida-git-sync/src/sync/settings-portability";

const enc = (obj: unknown) => Buffer.from(JSON.stringify(obj), "utf-8");

describe("frida-git-sync / settings-portability", () => {
	describe("isPortablePackageSource", () => {
		it("acepta npm:, git:, https:// y ssh://", () => {
			expect(isPortablePackageSource("npm:@jachy/pi-git-sync")).toBe(true);
			expect(isPortablePackageSource("git://github.com/x/y.git")).toBe(true);
			expect(isPortablePackageSource("https://example.com/pkg")).toBe(true);
			expect(isPortablePackageSource("ssh://git@github.com/x/y.git")).toBe(
				true,
			);
		});

		it("rechaza file:, ./, ../, /, ~ y vacíos", () => {
			expect(isPortablePackageSource("file:./local")).toBe(false);
			expect(isPortablePackageSource("./local")).toBe(false);
			expect(isPortablePackageSource("../parent")).toBe(false);
			expect(isPortablePackageSource("/abs/path")).toBe(false);
			expect(isPortablePackageSource("~/home")).toBe(false);
			expect(isPortablePackageSource("")).toBe(false);
		});
	});

	describe("sanitizeSettingsForRepository", () => {
		it("elimina packages file: no portables y deja los portables", () => {
			const sanitized = sanitizeSettingsForRepository(
				enc({
					defaultModel: "glm-5.2",
					packages: ["npm:foo", "file:./local", "./another"],
				}),
			);
			const parsed = JSON.parse(sanitized.toString("utf-8"));
			expect(parsed.packages).toEqual(["npm:foo"]);
			// El resto de settings se conserva.
			expect(parsed.defaultModel).toBe("glm-5.2");
		});

		it("devuelve el buffer original si todos son portables (sin reescribir)", () => {
			const original = enc({ packages: ["npm:foo", "npm:bar"] });
			expect(sanitizeSettingsForRepository(original)).toBe(original);
		});

		it("devuelve el buffer original si no hay packages", () => {
			const original = enc({ defaultModel: "x" });
			expect(sanitizeSettingsForRepository(original)).toBe(original);
		});
	});

	describe("mergeLocalPackagesIntoSettings", () => {
		it("preserva los packages file: locales al aplicar settings remotos", () => {
			const remote = enc({ packages: ["npm:foo"] });
			const local = enc({ packages: ["npm:foo", "file:./my-local"] });
			const merged = mergeLocalPackagesIntoSettings(remote, local);
			const parsed = JSON.parse(merged.toString("utf-8"));
			expect(parsed.packages).toEqual(["npm:foo", "file:./my-local"]);
		});

		it("sin packages locales no portables → devuelve el remoto tal cual", () => {
			const remote = enc({ packages: ["npm:foo"] });
			const local = enc({ packages: ["npm:foo"] });
			expect(mergeLocalPackagesIntoSettings(remote, local)).toBe(remote);
		});
	});
});
