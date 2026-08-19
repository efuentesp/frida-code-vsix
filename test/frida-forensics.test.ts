import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	createForensicAppender,
	formatModelRef,
	reviveCheck,
	type ForensicAppender,
} from "../src/tools/frida-forensics";

let tmp: string;

function freshTmp(): string {
	const dir = join(
		tmpdir(),
		`frida-forensics-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	rmSync(dir, { recursive: true, force: true });
	return dir;
}

beforeEach(() => {
	tmp = freshTmp();
});

afterAll(() => {
	rmSync(tmp, { recursive: true, force: true });
});

describe("frida-forensics · appender (#85/#86)", () => {
	test("append crea el directorio y escribe líneas en orden", () => {
		const file = join(tmp, "logs", "abort.log");
		const app: ForensicAppender = createForensicAppender({ file });
		app.append("primera");
		app.append("segunda");
		const content = readFileSync(file, "utf8");
		expect(content).toBe("primera\nsegunda\n");
	});

	test("rota a .1 al superar maxBytes y reinicia el contador", () => {
		const file = join(tmp, "logs", "abort.log");
		const app = createForensicAppender({ file, maxBytes: 20 });
		app.append("línea uno"); // 11B — acumula
		app.append("línea dos"); // 11B más → 22B ≥ límite
		app.append("línea tres"); // dispara rotación ANTES de escribir
		const rotated = readFileSync(`${file}.1`, "utf8");
		expect(rotated).toBe("línea uno\nlínea dos\n");
		const current = readFileSync(file, "utf8");
		expect(current).toBe("línea tres\n");
	});

	test("append fallido (dir de solo lectura inexistente imposible aquí) no lanza — best effort", () => {
		// Ruta con componente de ARCHIVO en medio: mkdir fallará → noop sin throw.
		const blocker = join(tmp, "blocker");
		mkdirSync(blocker, { recursive: true });
		const app = createForensicAppender({
			file: join(blocker, "no-dir", "x.log"),
		});
		expect(() => app.append("nada")).not.toThrow();
	});
});

describe("frida-forensics · reviveCheck (#85 chat)", () => {
	test("dentro de la ventana de 30s genera línea REVIVE con tipo y elapsed", () => {
		const line = reviveCheck(1_000, 1_000 + 5_000, "agent_start");
		expect(line).toBe("REVIVE event=agent_start tras 5000ms del abortRun END");
	});

	test("fuera de la ventana (o sin armar) devuelve null — sin ruido", () => {
		expect(reviveCheck(1_000, 500, "agent_start")).toBeNull();
	});
});

describe("frida-forensics · formatModelRef (#86 provider-audit)", () => {
	test("proveedor/modelo presentes → 'provider/model'", () => {
		expect(formatModelRef("softtek", "gpt-5.6-sonnet")).toBe(
			"softtek/gpt-5.6-sonnet",
		);
	});

	test("ausente → '(unset)' — nunca lanza", () => {
		expect(formatModelRef(undefined, undefined)).toBe("(unset)");
		expect(formatModelRef(undefined, "glm-5.3")).toBe("(unset)");
	});
});
