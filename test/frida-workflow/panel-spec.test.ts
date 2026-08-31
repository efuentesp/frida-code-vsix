// panel-spec.test.ts — motor declarativo de paneles de método (FR#9).
//
// Molde: test/frida-workflow/board.test.ts (aislamiento por test con _reset*,
// espejo de _resetRegistry en los tests del comando /wf). Tres frentes:
// 1) SDD_PANEL_SPEC — la primera configuración (FR#1/FR#13/FR#15/FR#16).
// 2) Registro runtime — fixture AJENA al motor (AC del FRD: definir un panel
//    nuevo NO modifica el motor).
// 3) validatePanelSpec — contrato eager del spec.
//
// NOTA: el import de PIPELINE_STAGES (features.ts, Slice 1) es una AFIRMACIÓN
// de consistencia cross-módulo (columnas del spec ↔ etapas del dominio), no
// una dependencia del motor: panel-spec.ts no importa features.ts.
import { beforeEach, describe, expect, it } from "vitest";
import {
	SDD_PANEL_SPEC,
	_resetPanelSpecs,
	listPanelSpecs,
	registerPanelSpec,
	resolvePanelSpec,
	validatePanelSpec,
	type PanelSpec,
} from "../../src/tools/frida-workflow/panel-spec";
import { PIPELINE_STAGES } from "../../src/tools/frida-workflow/features";

/** Columna de SDD_PANEL_SPEC por id (falla ruidoso si el spec deriva). */
function col(id: string) {
	const c = SDD_PANEL_SPEC.columns.find((x) => x.id === id);
	if (!c) throw new Error(`SDD_PANEL_SPEC no tiene columna «${id}»`);
	return c;
}

/** Fixture AJENA al motor (FR#9): un hipotético panel de planeación con
 *  columnas propias — registrar esto no toca panel-spec.ts (AC del FRD). */
const AIDD_PANEL: PanelSpec = {
	id: "aidd",
	title: "AiDD",
	columns: [
		{
			id: "brief",
			label: "brief",
			advanceLabel: "Continuar a PRD →",
			artifactLabel: "Brief",
		},
		{
			id: "prd",
			label: "prd",
			advanceLabel: "Continuar a arquitectura →",
			artifactLabel: "PRD",
		},
		{ id: "architecture", label: "architecture", terminal: true },
	],
	emptyState: {
		command: "/wf aidd-plan",
		hint: "Arranca la planeación por historias.",
	},
};

beforeEach(() => {
	_resetPanelSpecs();
});

describe("SDD_PANEL_SPEC — la primera configuración (FR#1)", () => {
	it("las columnas espejan PIPELINE_STAGES 1:1, mismo orden (contrato UI↔dominio)", () => {
		expect(SDD_PANEL_SPEC.columns.map((c) => c.id)).toEqual([...PIPELINE_STAGES]);
	});

	it("labels visibles del FRD: discover | research | design | plan | 🚀 ready-to-ship", () => {
		expect(SDD_PANEL_SPEC.columns.map((c) => c.label)).toEqual([
			"discover",
			"research",
			"design",
			"plan",
			"🚀 ready-to-ship",
		]);
	});

	it("exactamente una terminal: ready-to-ship, sin botón de avance (FR#6)", () => {
		const terminals = SDD_PANEL_SPEC.columns.filter((c) => c.terminal);
		expect(terminals.map((t) => t.id)).toEqual(["ready-to-ship"]);
		expect(terminals[0]!.advanceLabel).toBeUndefined();
		expect(terminals[0]!.advanceKind).toBeUndefined();
	});

	it("el botón nombra el movimiento (FR#13): research desde discover, ship desde plan", () => {
		expect(col("discover").advanceLabel).toBe("Continuar a research →");
		expect(col("research").advanceLabel).toBe("Continuar a design →");
		expect(col("design").advanceLabel).toBe("Continuar a plan →");
		expect(col("plan").advanceLabel).toBe("Ship → fases a ejecución");
	});

	it("advanceKind declara el disparador por etapa (FR#9): skill en etapas, ship en plan", () => {
		expect(col("discover").advanceKind).toBe("skill");
		expect(col("plan").advanceKind).toBe("ship");
	});

	it("emptyState declara el comando que llena el panel (FR#15)", () => {
		expect(SDD_PANEL_SPEC.emptyState.command).toBe("/skill:discover <idea>");
		expect(SDD_PANEL_SPEC.emptyState.hint).toBeDefined();
	});

	it("artifactLabel por etapa para el detalle del monitor (FR#16)", () => {
		expect(col("discover").artifactLabel).toBe("FRD");
		expect(col("research").artifactLabel).toBe("Research");
		expect(col("design").artifactLabel).toBe("Design");
		expect(col("plan").artifactLabel).toBe("Plan");
		expect(col("ready-to-ship").artifactLabel).toBeUndefined();
	});

	it("validatePanelSpec la acepta (fixture sana)", () => {
		expect(() => validatePanelSpec(SDD_PANEL_SPEC)).not.toThrow();
	});
});

describe("registro runtime — espejo registerBuiltinPattern (FR#9)", () => {
	it("resolvePanelSpec('sdd') funciona SIN registro: el default del motor", () => {
		expect(resolvePanelSpec("sdd")).toBe(SDD_PANEL_SPEC);
	});

	it("fixture ajena (aidd) registra y resuelve sin tocar el motor (AC del FRD)", () => {
		registerPanelSpec(AIDD_PANEL);
		expect(resolvePanelSpec("aidd")).toBe(AIDD_PANEL);
		expect(listPanelSpecs().map((s) => s.id)).toContain("aidd");
	});

	it("idempotente por id: re-registrar no duplica y gana el último", () => {
		registerPanelSpec(AIDD_PANEL);
		registerPanelSpec({ ...AIDD_PANEL, title: "AiDD v2" });
		const aidds = listPanelSpecs().filter((s) => s.id === "aidd");
		expect(aidds).toHaveLength(1);
		expect(aidds[0]!.title).toBe("AiDD v2");
	});

	it("una extensión puede pisar el default: registrado gana a 'sdd' (dedup por id)", () => {
		const override: PanelSpec = {
			...SDD_PANEL_SPEC,
			title: "Pipeline SDD (custom)",
		};
		registerPanelSpec(override);
		expect(resolvePanelSpec("sdd")).toBe(override);
		expect(listPanelSpecs().filter((s) => s.id === "sdd")).toHaveLength(1);
	});

	it("_resetPanelSpecs vacía el runtime; los defaults sobreviven", () => {
		registerPanelSpec(AIDD_PANEL);
		_resetPanelSpecs();
		expect(resolvePanelSpec("aidd")).toBeUndefined();
		expect(resolvePanelSpec("sdd")).toBe(SDD_PANEL_SPEC);
	});

	it("registrar un spec inválido lanza y NO queda registrado", () => {
		const broken = { ...AIDD_PANEL, columns: [] } as PanelSpec;
		expect(() => registerPanelSpec(broken)).toThrow(/columns/);
		expect(resolvePanelSpec("aidd")).toBeUndefined();
	});
});

describe("validatePanelSpec — contrato eager", () => {
	it("requiere columns no vacío", () => {
		expect(() => validatePanelSpec({ ...AIDD_PANEL, columns: [] })).toThrow(
			/no vacío/,
		);
	});

	it("rechaza ids de columna duplicados", () => {
		expect(() =>
			validatePanelSpec({
				...AIDD_PANEL,
				columns: [
					{ id: "brief", label: "brief", advanceLabel: "→" },
					{ id: "brief", label: "brief 2", advanceLabel: "→" },
					{ id: "done", label: "done", terminal: true },
				],
			}),
		).toThrow(/duplicado/);
	});

	it("exige EXACTAMENTE una terminal (pipeline lineal): ni cero ni dos", () => {
		const sinTerminal = {
			...AIDD_PANEL,
			columns: AIDD_PANEL.columns.map((c) => ({
				...c,
				terminal: false,
				advanceLabel: c.advanceLabel ?? "→",
			})),
		};
		expect(() => validatePanelSpec(sinTerminal)).toThrow(/terminal/);
		const dosTerminales = {
			...AIDD_PANEL,
			columns: [
				...AIDD_PANEL.columns,
				{ id: "epicas", label: "epicas", terminal: true },
			],
		};
		expect(() => validatePanelSpec(dosTerminales)).toThrow(/terminal/);
	});

	it("no-terminal exige advanceLabel (FR#13); terminal la prohíbe", () => {
		expect(() =>
			validatePanelSpec({
				...AIDD_PANEL,
				columns: [
					{ id: "brief", label: "brief" }, // sin advanceLabel
					{ id: "done", label: "done", terminal: true },
				],
			}),
		).toThrow(/advanceLabel/);
		expect(() =>
			validatePanelSpec({
				...AIDD_PANEL,
				columns: [
					{ id: "brief", label: "brief", advanceLabel: "→" },
					{ id: "done", label: "done", terminal: true, advanceLabel: "¿y esto?" },
				],
			}),
		).toThrow(/terminal/);
	});

	it("advanceKind sólo admite skill|ship; prohibido en la terminal", () => {
		const kindInvalido = {
			...AIDD_PANEL,
			columns: [
				{ id: "brief", label: "brief", advanceLabel: "→", advanceKind: "teleport" },
				{ id: "done", label: "done", terminal: true },
			],
		} as unknown as PanelSpec;
		expect(() => validatePanelSpec(kindInvalido)).toThrow(/advanceKind/);
		const kindEnTerminal: PanelSpec = {
			...AIDD_PANEL,
			columns: [
				{ id: "brief", label: "brief", advanceLabel: "→" },
				{ id: "done", label: "done", terminal: true, advanceKind: "skill" },
			],
		};
		expect(() => validatePanelSpec(kindEnTerminal)).toThrow(/advanceKind/);
	});

	it("columnas sin advanceKind son válidas (default skill)", () => {
		expect(() => validatePanelSpec(AIDD_PANEL)).not.toThrow();
	});

	it("id, title y emptyState.command no vacíos", () => {
		expect(() => validatePanelSpec({ ...AIDD_PANEL, id: " " })).toThrow(
			/id debe ser/,
		);
		expect(() => validatePanelSpec({ ...AIDD_PANEL, title: "" })).toThrow(
			/title debe ser/,
		);
		expect(() =>
			validatePanelSpec({ ...AIDD_PANEL, emptyState: { command: "" } }),
		).toThrow(/emptyState\.command/);
	});
});
