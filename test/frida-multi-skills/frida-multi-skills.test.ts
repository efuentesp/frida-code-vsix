// Tests de frida-multi-skills — invocación multi-skill con `$skill_name`.
//
// Cubre:
//   - Parser: extracción, dedupe, escape `\$`, mayúsculas ignoradas, no-match
//     parcial ($code dentro de $code-review), replaceSkillRefs (orden por
//     longitud), hasSkillRefs.
//   - Expansión: 1 skill → bloque <skill> idéntico a frida-args; N skills →
//     merger name="a, b"; skills desconocidas → unresolved + omisión; escape
//     `\$` → null; sin `$skill` → null; strip de frontmatter.
//
// El índice de skills vive en frida-args (cache módulo-level); se invalida en
// beforeEach para que cada test construya su propio set.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { invalidateSkillIndex } from "../../src/tools/frida-args";
import { expandMultiSkillText } from "../../src/tools/frida-multi-skills";
import {
	parseSkillRefs,
	replaceSkillRefs,
	hasSkillRefs,
} from "../../src/tools/frida-multi-skills/parser";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Mock mínimo de ExtensionAPI: getCommands() expone skills en `dir` con el
 *  formato que espera buildSkillIndex de frida-args (source "skill", nombre
 *  prefijado "skill:", sourceInfo.path al SKILL.md). */
function mockPiWithSkills(dir: string, names: string[]): ExtensionAPI {
	return {
		getCommands: () =>
			names.map((n) => ({
				source: "skill",
				name: `skill:${n}`,
				sourceInfo: { path: path.join(dir, n, "SKILL.md") },
			})),
	} as unknown as ExtensionAPI;
}

/** Crea <dir>/<name>/SKILL.md con frontmatter opcional + body. */
function writeSkill(
	dir: string,
	name: string,
	body: string,
	description?: string,
): void {
	const skillDir = path.join(dir, name);
	fs.mkdirSync(skillDir, { recursive: true });
	const fm = description ? `---\ndescription: ${description}\n---\n\n` : "";
	fs.writeFileSync(path.join(skillDir, "SKILL.md"), fm + body);
}

const deps = { sessionId: "sess-test", cwd: "/cwd" };

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

describe("parseSkillRefs", () => {
	it("extrae una skill standalone", () => {
		expect(parseSkillRefs("$code-review")).toEqual([
			{ raw: "$code-review", name: "code-review", index: 0 },
		]);
	});

	it("extrae múltiples skills embebidas en prosa", () => {
		const r = parseSkillRefs("Aplica $code-review y $commit a esto");
		expect(r.map((x) => x.name)).toEqual(["code-review", "commit"]);
	});

	it("deduplica conservando el orden de primera aparición", () => {
		expect(parseSkillRefs("$a $b $a $c $b").map((x) => x.name)).toEqual([
			"a",
			"b",
			"c",
		]);
	});

	it("ignora variables mayúsculas ($PATH, $ARGUMENTS, $SESSION_ID)", () => {
		expect(parseSkillRefs("usa $PATH y $ARGUMENTS y $SESSION_ID")).toEqual([]);
	});

	it("respeta el escape \\$ (no resuelve)", () => {
		expect(
			parseSkillRefs("\\$code-review y $commit").map((x) => x.name),
		).toEqual(["commit"]);
	});

	it("no matchea un prefijo parcial: $code-review no produce 'code'", () => {
		expect(parseSkillRefs("$code-review").map((x) => x.name)).toEqual([
			"code-review",
		]);
	});

	it("no resuelve $5 ni tokens sin minúscula inicial", () => {
		expect(parseSkillRefs("precio $5 y $123")).toEqual([]);
	});
});

describe("replaceSkillRefs", () => {
	it("reemplaza $name por el marker", () => {
		expect(
			replaceSkillRefs("$a y $b", [
				{ name: "a", marker: "AAA" },
				{ name: "b", marker: "BBB" },
			]),
		).toBe("AAA y BBB");
	});

	it("ordena por longitud desc: code-review antes que code", () => {
		expect(
			replaceSkillRefs("$code-review", [
				{ name: "code", marker: "<code>" },
				{ name: "code-review", marker: "<cr>" },
			]),
		).toBe("<cr>");
	});

	it("limpia los $ escapados (\\$ → $)", () => {
		expect(replaceSkillRefs("\\$a literal", [{ name: "a", marker: "A" }])).toBe(
			"$a literal",
		);
	});
});

describe("hasSkillRefs", () => {
	it("true cuando hay una $skill", () => {
		expect(hasSkillRefs("Aplica $code-review")).toBe(true);
	});
	it("false cuando no hay $", () => {
		expect(hasSkillRefs("sin skills aqui")).toBe(false);
	});
	it("false cuando sólo hay mayúsculas/dígitos", () => {
		expect(hasSkillRefs("precio $5 y $PATH")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// expandMultiSkillText
// ---------------------------------------------------------------------------

describe("expandMultiSkillText", () => {
	let dir: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "frida-multi-"));
		invalidateSkillIndex(); // reset del cache de skills de frida-args
	});
	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("devuelve null si no hay ninguna $skill", async () => {
		const pi = mockPiWithSkills(dir, ["commit"]);
		const r = await expandMultiSkillText("hola mundo sin skills", {
			pi,
			...deps,
		});
		expect(r).toBeNull();
	});

	it("expande 1 skill a un bloque <skill> y reemplaza $ por el nombre", async () => {
		writeSkill(dir, "code-review", "Revisa el código siguiendo el estándar.");
		const pi = mockPiWithSkills(dir, ["code-review"]);
		const r = await expandMultiSkillText("Aplica $code-review a esto", {
			pi,
			...deps,
		});
		expect(r).not.toBeNull();
		expect(r!.transformed.startsWith('<skill name="code-review"')).toBe(true);
		expect(r!.transformed).toContain("Revisa el código siguiendo el estándar.");
		expect(r!.transformed.endsWith("Aplica code-review a esto")).toBe(true);
		expect(r!.unresolved).toEqual([]);
	});

	it("una skill sola emite SÓLO el bloque (omiti el nombre repetido)", async () => {
		writeSkill(dir, "demo", "Cuerpo de la skill.");
		const pi = mockPiWithSkills(dir, ["demo"]);
		const r = await expandMultiSkillText("$demo", { pi, ...deps });
		expect(r).not.toBeNull();
		expect(r!.transformed).toContain('<skill name="demo"');
		expect(r!.transformed).toContain("Cuerpo de la skill.");
		// Caso standalone puro: el $demo se reduce a sólo el nombre → se omite para
		// no dejarlo como "argumento" espurio tras </skill> (mejora sobre pi-multi-skills).
		expect(r!.transformed.trim()).toMatch(/<\/skill>$/);
		expect(r!.transformed).not.toContain("\n\ndemo");
		expect(r!.unresolved).toEqual([]);
	});

	it('mergea N skills en UN bloque name="a, b" con location del primero', async () => {
		writeSkill(dir, "code-review", "Cuerpo A.");
		writeSkill(dir, "commit", "Cuerpo B.");
		const pi = mockPiWithSkills(dir, ["code-review", "commit"]);
		const r = await expandMultiSkillText("$code-review y $commit", {
			pi,
			...deps,
		});
		expect(r).not.toBeNull();
		// Un único bloque, name con ambos, location del primero.
		expect(r!.transformed).toContain(
			`name="code-review, commit" location="${path.join(dir, "code-review", "SKILL.md")}"`,
		);
		// Ambos cuerpos presentes, separados por el heading de cada uno.
		expect(r!.transformed).toContain("## code-review");
		expect(r!.transformed).toContain("Cuerpo A.");
		expect(r!.transformed).toContain("## commit");
		expect(r!.transformed).toContain("Cuerpo B.");
		// Sólo una etiqueta <skill> de apertura.
		expect(r!.transformed.match(/<skill /g)).toHaveLength(1);
	});

	it("reporta skills desconocidas en unresolved y deja su referencia como texto", async () => {
		writeSkill(dir, "code-review", "Cuerpo A.");
		const pi = mockPiWithSkills(dir, ["code-review"]);
		const r = await expandMultiSkillText("$code-review y $inexistente aquí", {
			pi,
			...deps,
		});
		expect(r).not.toBeNull();
		expect(r!.unresolved).toEqual(["inexistente"]);
		// La skill conocida va en el bloque; la desconocida NO entra al bloque...
		expect(r!.transformed).toContain('<skill name="code-review"');
		// ...pero su referencia queda literal en el userText (paridad con
		// pi-multi-skills: el usuario/modelo ven que $inexistente no resolvió).
		expect(r!.transformed).toContain("$inexistente");
	});

	it("respeta el escape \\$ → devuelve null (no expande)", async () => {
		writeSkill(dir, "commit", "Cuerpo.");
		const pi = mockPiWithSkills(dir, ["commit"]);
		const r = await expandMultiSkillText("\\$commit es literal", {
			pi,
			...deps,
		});
		expect(r).toBeNull();
	});

	it("hace strip del frontmatter: el cuerpo no incluye description ni ---", async () => {
		writeSkill(dir, "demo", "Cuerpo real visible.", "Una descripción");
		const pi = mockPiWithSkills(dir, ["demo"]);
		const r = await expandMultiSkillText("$demo", { pi, ...deps });
		expect(r).not.toBeNull();
		expect(r!.transformed).toContain("Cuerpo real visible.");
		expect(r!.transformed).not.toContain("description:");
		expect(r!.transformed).not.toContain("\n---\n");
	});
});
