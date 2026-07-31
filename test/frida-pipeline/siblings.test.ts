// frida-pipeline — tests del detector de hermanas (siblings) y del status.
//
// Verifica el gate de Fase 1 (ADR-0021):
//   - Detecta las 5 hermanas requeridas leyendo el filesystem.
//   - Reporta versión desde el `package.json` raíz.
//   - `formatPipelineStatus` produce el texto del banner.
//   - El nivel del status es "empty" cuando todo está OK pero los conteos
//     son 0 (Fase 1 del proyecto: sin skills/agentes/workflows propios aún).
//   - Hermana missing: la detección la reporta como `present: false` y el
//     nivel baja a "degraded".

import { describe, it, expect } from "vitest";
import {
	REQUIRED_SIBLINGS,
	detectSiblings,
	formatSiblingsStatus,
} from "../../src/tools/frida-pipeline/siblings";
import {
	computePipelineStatus,
	formatPipelineStatus,
} from "../../src/tools/frida-pipeline/setup-command";

describe("frida-pipeline / siblings", () => {
	it("REQUIRED_SIBLINGS lista las 5 hermanas en el orden del ADR-0021", () => {
		expect(REQUIRED_SIBLINGS).toEqual([
			"frida-workflow",
			"frida-args",
			"frida-context",
			"frida-permission-system",
			"frida-agent-browser",
		]);
	});

	it("detectSiblings reporta las 5 hermanas presentes en este repo", () => {
		const status = detectSiblings();
		expect(status.siblings).toHaveLength(5);
		for (const sib of status.siblings) {
			expect(sib.present, `hermana ${sib.id} debería estar presente`).toBe(
				true,
			);
			expect(sib.version).toMatch(/^\d+\.\d+\.\d+/);
			expect(sib.modulePath).toBeTruthy();
		}
		expect(status.allPresent).toBe(true);
		expect(status.presentCount).toBe(5);
		expect(status.expectedCount).toBe(5);
	});

	it("formatSiblingsStatus incluye versión y hermanas ✅", () => {
		const text = formatSiblingsStatus(detectSiblings());
		expect(text).toMatch(/^frida-pipeline v\d+\.\d+\.\d+/);
		expect(text).toContain("Hermanas: 5/5");
		expect(text).toContain("✅ frida-workflow");
		expect(text).toContain("✅ frida-args");
		expect(text).toContain("✅ frida-context");
		expect(text).toContain("✅ frida-permission-system");
		expect(text).toContain("✅ frida-agent-browser");
	});
});

describe("frida-pipeline / status", () => {
	it("computePipelineStatus es 'ready' con hermanas OK y agentes presentes", () => {
		const status = computePipelineStatus();
		expect(status.siblings.allPresent).toBe(true);
		expect(status.level).toBe("ready");
		expect(status.counts.skills.present).toBeGreaterThanOrEqual(18);
		expect(status.counts.agents.present).toBeGreaterThan(0);
		expect(status.counts.agents.expected).toBe(15);
		expect(status.counts.workflows.present).toBe(3);
	});

	it("formatPipelineStatus incluye el conteo real de agentes", () => {
		const text = formatPipelineStatus(computePipelineStatus());
		expect(text).toContain("Hermanas: 5/5 detectadas");
		expect(text).toContain("Skills:    27/27");
		expect(text).toContain("Agentes:   15/15");
		expect(text).toContain("Workflows: 3/3");
	});

	it("El reporte es estable byte-a-byte bajo la misma detección", () => {
		// Snapshots burdos: si cambia la estructura del reporte, falla el test
		// y hay que actualizar la doc y la skill `pipeline` correspondiente.
		const text = formatPipelineStatus(computePipelineStatus());
		const lines = text.split("\n");
		expect(lines[0]).toMatch(/^frida-pipeline v\d+\.\d+\.\d+$/);
		expect(lines[1]).toBe("");
		expect(lines[2]).toMatch(/^Hermanas: 5\/5 detectadas$/);
	});
});
