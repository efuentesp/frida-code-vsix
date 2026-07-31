// frida-pipeline — tests de guidance (walk recursivo + dedup + formato).
//
// Verifica el gate de Fase 2 (ADR-0021):
//   - resolveGuidance encuentra AGENTS.md / CLAUDE.md / architecture.md en
//     el orden de precedencia correcto y a la profundidad correcta.
//   - Profundidad 0 omite AGENTS.md/CLAUDE.md (el loader de Pi los carga).
//   - Profundidad 0 SÍ revisa .frida/guidance/architecture.md.
//   - Dedup: no se reinyecta lo ya inyectado.
//   - El wrapper declara que es "material de referencia, NO una tarea".
//   - Archivo fuera de la raíz → [] (no se camina).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	resolveGuidance,
	resolveAndFormatNewGuidance,
	clearInjectionState,
} from "../../src/tools/frida-pipeline/guidance";

// ---------------------------------------------------------------------------
// Helpers — estructura un árbol de directorios temporal.
// ---------------------------------------------------------------------------

let tmp: string;

function write(relativePath: string, content: string): void {
	const full = path.join(tmp, relativePath);
	fs.mkdirSync(path.dirname(full), { recursive: true });
	fs.writeFileSync(full, content, "utf8");
}

beforeEach(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frida-guidance-"));
	clearInjectionState();
});

afterEach(() => {
	fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("frida-pipeline / guidance / resolveGuidance", () => {
	it("encuentra AGENTS.md en un subdirectorio", () => {
		write("src/lib/AGENTS.md", "# reglas de src/lib");
		const files = resolveGuidance(path.join(tmp, "src/lib/foo.ts"), tmp);
		expect(files).toHaveLength(1);
		expect(files[0].kind).toBe("agents");
		expect(files[0].content).toBe("# reglas de src/lib");
	});

	it("precedencia: AGENTS.md > CLAUDE.md", () => {
		write("src/lib/AGENTS.md", "# agents");
		write("src/lib/CLAUDE.md", "# claude");
		const files = resolveGuidance(path.join(tmp, "src/lib/x.ts"), tmp);
		expect(files).toHaveLength(1);
		expect(files[0].kind).toBe("agents");
		expect(files[0].content).toBe("# agents");
	});

	it("precedencia: CLAUDE.md > architecture.md", () => {
		write("src/lib/CLAUDE.md", "# claude");
		write(".frida/guidance/src/lib/architecture.md", "# arch");
		const files = resolveGuidance(path.join(tmp, "src/lib/x.ts"), tmp);
		expect(files).toHaveLength(1);
		expect(files[0].kind).toBe("claude");
	});

	it("profundidad 0 omite AGENTS.md y CLAUDE.md (loader de Pi los carga)", () => {
		write("AGENTS.md", "# root agents");
		write("CLAUDE.md", "# root claude");
		const files = resolveGuidance(path.join(tmp, "foo.ts"), tmp);
		// Ningún archivo de guidance raíz (AGENTS/CLAUDE) se devuelve en
		// profundidad 0 — Pi ya los cargó en el system prompt.
		expect(files).toHaveLength(0);
	});

	it("profundidad 0 SÍ revisa .frida/guidance/architecture.md", () => {
		write(".frida/guidance/architecture.md", "# arch raíz");
		const files = resolveGuidance(path.join(tmp, "foo.ts"), tmp);
		expect(files).toHaveLength(1);
		expect(files[0].kind).toBe("architecture");
		expect(files[0].relativePath).toBe(".frida/guidance/architecture.md");
	});

	it("camina múltiples profundidades (general → específico)", () => {
		write(".frida/guidance/architecture.md", "# raíz");
		write("src/AGENTS.md", "# src");
		write("src/lib/AGENTS.md", "# src/lib");
		const files = resolveGuidance(path.join(tmp, "src/lib/deep/file.ts"), tmp);
		// raíz (architecture) → src (agents) → src/lib (agents). src/lib/deep
		// no tiene nada.
		expect(files.map((f) => f.content)).toEqual([
			"# raíz",
			"# src",
			"# src/lib",
		]);
	});

	it("archivo fuera de la raíz → []", () => {
		write("src/AGENTS.md", "# src");
		const outside = path.join(os.tmpdir(), "otro-lugar", "file.ts");
		const files = resolveGuidance(outside, tmp);
		expect(files).toEqual([]);
	});

	it("architecture.md se encuentra en un subdirectorio de guidance", () => {
		write(".frida/guidance/src/architecture.md", "# arch de src");
		const files = resolveGuidance(path.join(tmp, "src/x.ts"), tmp);
		expect(files).toHaveLength(1);
		expect(files[0].kind).toBe("architecture");
		expect(files[0].content).toBe("# arch de src");
	});
});

describe("frida-pipeline / guidance / dedup", () => {
	it("no reinyecta lo ya inyectado (resolveAndFormatNewGuidance)", () => {
		write("src/AGENTS.md", "# src");
		const filePath = path.join(tmp, "src/foo.ts");

		// Primera llamada → devuelve contenido.
		const first = resolveAndFormatNewGuidance(filePath, tmp, "read");
		expect(first).not.toBeNull();
		expect(first).toContain("# src");

		// Segunda llamada al mismo archivo → null (ya inyectado).
		const second = resolveAndFormatNewGuidance(filePath, tmp, "read");
		expect(second).toBeNull();
	});

	it("clearInjectionState resetea el dedup", () => {
		write("src/AGENTS.md", "# src");
		const filePath = path.join(tmp, "src/foo.ts");

		resolveAndFormatNewGuidance(filePath, tmp, "read");
		expect(resolveAndFormatNewGuidance(filePath, tmp, "read")).toBeNull();

		clearInjectionState();
		// Tras reset, vuelve a resolver.
		expect(resolveAndFormatNewGuidance(filePath, tmp, "read")).not.toBeNull();
	});
});

describe("frida-pipeline / guidance / formato del wrapper", () => {
	it("declara que es material de referencia, NO una tarea", () => {
		write("src/AGENTS.md", "# reglas");
		const content = resolveAndFormatNewGuidance(
			path.join(tmp, "src/x.ts"),
			tmp,
			"read",
		);
		expect(content).not.toBeNull();
		expect(content).toContain("material de referencia, NO una tarea");
	});

	it("incluye el disparador (tool que tocó el archivo)", () => {
		write("src/AGENTS.md", "# reglas");
		const content = resolveAndFormatNewGuidance(
			path.join(tmp, "src/x.ts"),
			tmp,
			"edit",
		);
		expect(content).toContain("edit");
		expect(content).toContain("tocó");
	});

	it("encabezado en español con el label de la carpeta", () => {
		write("src/lib/AGENTS.md", "# reglas");
		const content = resolveAndFormatNewGuidance(
			path.join(tmp, "src/lib/x.ts"),
			tmp,
			"write",
		);
		expect(content).toContain("## Guidance de arquitectura:");
		expect(content).toContain("src/lib (AGENTS.md)");
	});

	it("label 'raíz' para architecture.md en la raíz", () => {
		write(".frida/guidance/architecture.md", "# arch");
		const content = resolveAndFormatNewGuidance(
			path.join(tmp, "x.ts"),
			tmp,
			"read",
		);
		expect(content).toContain("raíz (architecture.md)");
	});
});

describe("frida-pipeline / guidance / gate E2E", () => {
	it("editar un archivo en una carpeta con AGENTS.md entrega la guidance", () => {
		// Simula el gate del ADR: editar un archivo bajo una carpeta y verificar
		// que la guidance de esa carpeta llega al modelo.
		write("src/tools/frida-permission-system/AGENTS.md", "# reglas de gates");
		const filePath = path.join(
			tmp,
			"src/tools/frida-permission-system/gate.ts",
		);
		const content = resolveAndFormatNewGuidance(filePath, tmp, "edit");
		expect(content).toContain("# reglas de gates");
		expect(content).toContain("src/tools/frida-permission-system (AGENTS.md)");
	});
});
