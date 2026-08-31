// pipeline-wiring.test.ts — contrato de cableado del overlay N1 (fix Step 4;
// precedente 32d874d: «tests punta a punta del cableado desde el inicio»).
// extension.ts no es importable desde vitest (clausuras dentro de activate):
// este test afirma el CONTRATO que el case "pipeline" monta y que los
// handlers onAdvance/onShip consumen — el elemento del overlay renderiza
// desde spec + dominio, y advanceFeature entrega el comando pre-move exacto
// que el handler reenvía por runCustomCommand.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import {
	createPipelineOverlayElement,
	type PipelineFeatureView,
	type PipelineOverlayActions,
	type PipelineOverlayData,
} from "../../src/tools/frida-workflow/features-ui";
import {
	advanceFeature,
	saveFeatures,
} from "../../src/tools/frida-workflow/features";

let tmp: string;

beforeEach(() => {
	tmp = mkdtempSync(path.join(tmpdir(), "pipeline-wiring-"));
});

const actions: PipelineOverlayActions = {
	onAdvance: () => {},
	onShip: () => {},
	onRunEmptyCommand: () => {},
	onDismissWarning: () => {},
	onClose: () => {},
};

const STATUS = {
	level: "ready" as const,
	summary: "orquestador v3.4.1 · hermanas 5/5",
	detail: "Skills 5/5 · Agentes 4/4 · Workflows 3/3",
};

function view(overrides: Partial<PipelineFeatureView>): PipelineFeatureView {
	return {
		id: ".frida/artifacts/discover/2026-01-01_10-00-00_wiring.md",
		stage: "discover",
		history: [],
		desync: false,
		...overrides,
	};
}

function data(features: PipelineFeatureView[]): PipelineOverlayData {
	return { features, status: STATUS, warnings: [] };
}

describe('wiring — el elemento que monta case "pipeline"', () => {
	it("renderiza las 5 columnas del spec y el botón nombrado (FR#1/FR#13)", () => {
		const html = renderToStaticMarkup(
			createPipelineOverlayElement(data([view({})]), actions),
		);
		for (const label of [
			"discover",
			"research",
			"design",
			"plan",
			"ready-to-ship",
		])
			expect(html).toContain(label);
		expect(html).toContain("Continuar a research →");
	});

	it("pinta ámbar desinc, badge n/m y sección orquestador (FR#12/FR#6/D5)", () => {
		const html = renderToStaticMarkup(
			createPipelineOverlayElement(
				data([
					view({
						stage: "ready-to-ship",
						desync: true,
						badge: { done: 2, total: 3 },
					}),
				]),
				actions,
			),
		);
		expect(html).toContain("desinc");
		expect(html).toContain("2/3 fases");
		expect(html).toContain("orquestador");
	});

	it("EmptyState con el comando accionable cuando no hay features (FR#15)", () => {
		const html = renderToStaticMarkup(
			createPipelineOverlayElement(data([]), actions),
		);
		expect(html).toContain("/skill:discover");
	});
});

describe("wiring — el comando exacto que onAdvance reenvía (FR#4)", () => {
	it("advanceFeature entrega /skill:<etapa-destino> <frd> computado PRE-move", () => {
		const rel = ".frida/artifacts/discover/2026-01-01_10-00-00_wiring.md";
		const abs = path.join(tmp, ...rel.split("/"));
		mkdirSync(path.dirname(abs), { recursive: true });
		writeFileSync(abs, "---\nstatus: ready\n---\n\n# doc\n", "utf8");
		saveFeatures(tmp, {
			v: 1,
			features: [{ id: rel, stage: "discover", history: [] }],
			updatedAt: "",
		});
		const r = advanceFeature(tmp, rel, "pipeline-ui");
		expect(r.moved).toBe(true);
		expect(r.command).toBe(`/skill:research ${rel}`); // lo que va a runCustomCommand
	});
});
