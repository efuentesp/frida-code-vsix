// frida-shunt (#202): contrato del gate de lecturas costosas — puro + fs temp.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	countLinesUpTo,
	evaluateBashRead,
	evaluateExpensiveRead,
	type ShuntConfig,
} from "../../src/gates/expensive-reads";

const dir = mkdtempSync(join(tmpdir(), "frida-shunt-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const bigPath = join(dir, "big.ts");
const smallPath = join(dir, "small.ts");
const imgPath = join(dir, "shot.png");

beforeAll(() => {
	// 600 líneas de código sintético (con salto final: semántica wc -l).
	writeFileSync(
		bigPath,
		Array.from({ length: 600 }, (_, i) => `export const x${i} = ${i};`).join("\n") + "\n",
		"utf8",
	);
	writeFileSync(
		smallPath,
		Array.from({ length: 50 }, (_, i) => `const y${i} = ${i};`).join("\n") + "\n",
		"utf8",
	);
	// "binario": contenido con saltos, pero extensión de imagen → fuera de scope.
	writeFileSync(imgPath, "x\n".repeat(600), "utf8");
});

const cfg = (over: Partial<ShuntConfig> = {}): ShuntConfig => ({
	enabled: true,
	minLines: 350,
	cwd: dir,
	...over,
});

const readInput = (path: string, extra: Record<string, unknown> = {}) => ({
	path,
	...extra,
});

describe("countLinesUpTo", () => {
	it("cuenta exacto por debajo del corte", () => {
		expect(countLinesUpTo(smallPath, 350)).toBe(50);
	});
	it("corta temprano por encima del corte (max+1, sin leer todo)", () => {
		expect(countLinesUpTo(bigPath, 350)).toBe(351);
	});
	it("archivo inexistente → null", () => {
		expect(countLinesUpTo(join(dir, "nope"), 350)).toBe(null);
	});
});

describe("evaluateExpensiveRead: tool read", () => {
	it("read COMPLETO de archivo grande → redirect con la escalera completa", () => {
		const r = evaluateExpensiveRead("read", readInput(bigPath), cfg());
		expect(r).not.toBeNull();
		expect(r?.reason).toContain("frida-shunt");
		expect(r?.reason).toContain("module_report"); // rung 1: pi-lens
		expect(r?.reason).toContain("subagent"); // rung 2: smol
		expect(r?.reason).toContain("offset/limit"); // rung 3: edición
		expect(r?.detail).toContain(bigPath);
	});

	it("read con offset (dirigido) SIEMPRE pasa — es la ruta de edición", () => {
		expect(
			evaluateExpensiveRead("read", readInput(bigPath, { offset: 100 }), cfg()),
		).toBeNull();
	});

	it("read con limit (dirigido) pasa", () => {
		expect(
			evaluateExpensiveRead("read", readInput(bigPath, { limit: 50 }), cfg()),
		).toBeNull();
	});

	it("archivo chico pasa (delegar costaría más de lo que ahorra)", () => {
		expect(
			evaluateExpensiveRead("read", readInput(smallPath), cfg()),
		).toBeNull();
	});

	it("path inexistente pasa (el read fallará con su error natural)", () => {
		expect(
			evaluateExpensiveRead("read", readInput(join(dir, "nope.ts")), cfg()),
		).toBeNull();
	});

	it("extensiones binarias (imágenes/adjuntos) fuera de scope", () => {
		expect(
			evaluateExpensiveRead("read", readInput(imgPath), cfg()),
		).toBeNull();
	});

	it("path RELATIVO se resuelve contra cwd", () => {
		expect(
			evaluateExpensiveRead("read", readInput("big.ts"), cfg()),
		)?.not.toBeNull();
	});

	it("disabled → null siempre (early-out del setting)", () => {
		expect(
			evaluateExpensiveRead("read", readInput(bigPath), cfg({ enabled: false })),
		).toBeNull();
	});

	it("minLines configurable: 1000 deja pasar el de 600", () => {
		expect(
			evaluateExpensiveRead("read", readInput(bigPath), cfg({ minLines: 1000 })),
		).toBeNull();
	});
});

describe("evaluateExpensiveRead: tool bash", () => {
	const bash = (command: string) => evaluateBashRead(command, 350, dir);

	it("cat de archivo grande → redirect", () => {
		expect(bash(`cat ${bigPath}`))?.not.toBeNull();
	});
	it("less / more de archivo grande → redirect", () => {
		expect(bash(`less ${bigPath}`))?.not.toBeNull();
		expect(bash(`more ${bigPath}`))?.not.toBeNull();
	});
	it("head/tail CON conteo acotado pasa (lectura dirigida)", () => {
		expect(bash(`head -n 20 ${bigPath}`)).toBeNull();
		expect(bash(`head -n 350 ${bigPath}`)).toBeNull();
		expect(bash(`tail -50 ${bigPath}`)).toBeNull();
	});
	it("head SIN conteo sobre grande → redirect (es un read completo)", () => {
		expect(bash(`head ${bigPath}`))?.not.toBeNull();
	});
	it("head con conteo MAYOR al umbral → redirect", () => {
		expect(bash(`head -n 99999 ${bigPath}`))?.not.toBeNull();
	});
	it("pipes pasan (extracción dirigida — regla del upstream)", () => {
		expect(bash(`cat ${bigPath} | grep export`)).toBeNull();
		expect(bash(`cat ${bigPath} | wc -l`)).toBeNull();
	});
	it("cat de chico pasa", () => {
		expect(bash(`cat ${smallPath}`)).toBeNull();
	});
	it("cat -n (con opción) sobre grande → redirect", () => {
		expect(bash(`cat -n ${bigPath}`))?.not.toBeNull();
	});
	it("comando encadenado: cat grande tras && se pesca", () => {
		expect(bash(`echo hi && cat ${bigPath}`))?.not.toBeNull();
	});
	it("path entre comillas sobre grande → redirect", () => {
		expect(bash(`cat "${bigPath}"`))?.not.toBeNull();
	});
	it("archivo inexistente / binario pasa", () => {
		expect(bash("cat no-existe.ts")).toBeNull();
		expect(bash(`cat ${imgPath}`)).toBeNull();
	});
	it("comandos no-lectura ni se evalúan", () => {
		expect(bash("npm test")).toBeNull();
		expect(bash("git status")).toBeNull();
	});

	it("via evaluateExpensiveRead (bash) con command", () => {
		expect(
			evaluateExpensiveRead("bash", { command: `cat ${bigPath}` }, cfg()),
		)?.not.toBeNull();
	});
});
