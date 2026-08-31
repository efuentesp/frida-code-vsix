// features.test.ts — dominio del pipeline N1 (features.json).
// Molde: test/frida-workflow/board.test.ts (fixture tmp + mkdtemp; atomicidad).
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	PIPELINE_STAGES,
	STAGE_BUCKET,
	featuresFilePath,
	findFeature,
	loadFeatures,
	nextStage,
	saveFeatures,
	stageIndex,
	subscribeFeaturesChanges,
	type FeaturesFile,
	type PipelineFeature,
} from "../../src/tools/frida-workflow/features";

let tmp: string;

beforeEach(() => {
	tmp = mkdtempSync(path.join(tmpdir(), "features-test-"));
});

afterEach(() => {
	vi.restoreAllMocks();
});

function sampleFeature(
	overrides: Partial<PipelineFeature> = {},
): PipelineFeature {
	return {
		id: ".frida/artifacts/discover/2026-08-31_07-08-47_mi-feature.md",
		stage: "discover",
		history: [],
		...overrides,
	};
}

describe("features — persistencia atómica (espejo board)", () => {
	it("loadFeatures devuelve null si features.json no existe", () => {
		expect(loadFeatures(tmp)).toBeNull();
	});

	it("saveFeatures crea el directorio pipeline/ y persiste con v=1", () => {
		const state: FeaturesFile = {
			v: 1,
			features: [sampleFeature()],
			updatedAt: "",
			source: "test",
		};
		saveFeatures(tmp, state);
		const file = featuresFilePath(tmp);
		expect(existsSync(file)).toBe(true);
		const round = loadFeatures(tmp);
		expect(round).not.toBeNull();
		expect(round!.v).toBe(1);
		expect(round!.features).toHaveLength(1);
		expect(round!.features[0]!.id).toBe(sampleFeature().id);
		expect(round!.updatedAt).not.toBe("");
	});

	it("saveFeatures no deja archivos .tmp huérfanos", () => {
		const state: FeaturesFile = { v: 1, features: [], updatedAt: "" };
		saveFeatures(tmp, state);
		saveFeatures(tmp, state);
		const dir = path.dirname(featuresFilePath(tmp));
		const leftovers = readdirSync(dir).filter((f) => f.endsWith(".tmp"));
		expect(leftovers).toEqual([]);
	});

	it("loadFeatures degrada a vacío ante JSON corrupto (NFR reliability)", () => {
		const file = featuresFilePath(tmp);
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(file, "{ esto no es json", "utf8");
		expect(loadFeatures(tmp)).toBeNull();
	});

	it("loadFeatures normaliza v ausente y features no-array", () => {
		const file = featuresFilePath(tmp);
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(file, JSON.stringify({ features: {} }), "utf8");
		const loaded = loadFeatures(tmp);
		expect(loaded).not.toBeNull();
		expect(loaded!.v).toBe(1);
		expect(loaded!.features).toEqual([]);
	});

	it("findFeature resuelve por id canónico", () => {
		const state: FeaturesFile = {
			v: 1,
			features: [sampleFeature()],
			updatedAt: "",
		};
		expect(findFeature(state, sampleFeature().id)?.stage).toBe("discover");
		expect(findFeature(state, "otra")).toBeUndefined();
	});
});

describe("features — listeners (overlay vivo)", () => {
	it("saveFeatures emite el cambio a los suscritos", () => {
		const fn = vi.fn();
		const off = subscribeFeaturesChanges(fn);
		saveFeatures(tmp, { v: 1, features: [], updatedAt: "" });
		expect(fn).toHaveBeenCalledTimes(1);
		off();
		saveFeatures(tmp, { v: 1, features: [], updatedAt: "" });
		expect(fn).toHaveBeenCalledTimes(1); // desuscrito: no vuelve a disparar
	});

	it("un listener que lanza no bloquea a los demás", () => {
		const broken = vi.fn(() => {
			throw new Error("roto");
		});
		const ok = vi.fn();
		subscribeFeaturesChanges(broken);
		const off = subscribeFeaturesChanges(ok);
		saveFeatures(tmp, { v: 1, features: [], updatedAt: "" });
		expect(ok).toHaveBeenCalledTimes(1);
		off();
	});
});

describe("features — etapas", () => {
	it("PIPELINE_STAGES tiene las 5 columnas del FRD en orden", () => {
		expect([...PIPELINE_STAGES]).toEqual([
			"discover",
			"research",
			"design",
			"plan",
			"ready-to-ship",
		]);
	});

	it("STAGE_BUCKET mapea a los buckets plurales de los skills bundled", () => {
		expect(STAGE_BUCKET).toEqual({
			discover: "discover",
			research: "research",
			design: "designs",
			plan: "plans",
		});
	});

	it("nextStage avanza y termina en ready-to-ship", () => {
		expect(nextStage("discover")).toBe("research");
		expect(nextStage("research")).toBe("design");
		expect(nextStage("design")).toBe("plan");
		expect(nextStage("plan")).toBe("ready-to-ship");
		expect(nextStage("ready-to-ship")).toBeUndefined();
		expect(stageIndex("ready-to-ship")).toBe(4);
	});
});
