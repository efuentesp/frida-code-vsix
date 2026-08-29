/**
 * frida-size-app — tests del slash command /size (#140).
 * Moldes: fakePi capturando registerCommand (test/frida-cc-plugins/
 * presenter.test.ts:59-86) + captura de sendUserMessage (test/frida-goal/
 * goal-runtime.test.ts:12-50) + command.test.ts de walkthrough (Slice 1).
 * Sin vscode: la UI se inyecta como fake (adapter D3) — command.ts no
 * importa vscode estáticamente.
 *
 * HERENCIA del pack (File Map): HOME aislado + ensureDeps rechazante —
 * la factory dispara ensureBinary fire-and-forget contra el agentDir del
 * HOME; sin aislamiento tocaría ~/.frida real (molde pattern.test.ts:48-62).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	clearRegisteredBuiltinPatterns,
	registerBuiltinPattern,
} from "../../src/tools/frida-extensible-workflows/builtin-patterns";
import {
	SIZE_APP_PATTERN,
	createFridaSizeApp,
} from "../../src/tools/frida-size-app";
import type { SccInstallDeps } from "../../src/tools/frida-size-app/installer";
import {
	buildSizeAppPrompt,
	registerSizeAppCommand,
	type SlashPickUI,
} from "../../src/tools/frida-size-app/command";

interface Sent {
	text: string;
	opts?: { deliverAs?: string };
}

/** Captura de ExtensionAPI: comandos en Map + sendUserMessage grabado. */
function fakePi() {
	const sent: Sent[] = [];
	const commands = new Map<
		string,
		{
			description?: string;
			handler: (a: string | undefined, c: unknown) => Promise<void>;
		}
	>();
	const pi = {
		commands,
		sent,
		registerCommand: (
			n: string,
			o: {
				description?: string;
				handler: (a: string | undefined, c: unknown) => Promise<void>;
			},
		) => commands.set(n, o),
		sendUserMessage: (text: string, opts?: { deliverAs?: string }) => {
			sent.push({ text, opts });
		},
	};
	return pi;
}

/**
 * Fake de SlashPickUI con respuestas scripted por ORDEN de pick (1º
 * cocomoType, 2º wage — D10) + input para "monto propio". warn/error
 * LANZAN si algo inesperado se emite; los tests del guard D12 y del
 * monto inválido D15 usan fakeUiWithMessages.
 */
function fakeUi(responses: {
	cocomo?: string;
	wage?: string;
	customWage?: string;
}) {
	let pickCalls = 0;
	const ui: SlashPickUI = {
		async input(_prompt: string, _placeHolder?: string) {
			return responses.customWage;
		},
		async pick(_title: string, _labels: readonly string[]) {
			pickCalls++;
			return pickCalls === 1 ? responses.cocomo : responses.wage;
		},
		warn(message: string) {
			throw new Error("warn inesperado: " + message);
		},
		error(message: string) {
			throw new Error("error inesperado: " + message);
		},
	};
	return ui;
}

/** Fake de ExtensionCommandContext (solo isIdle). */
function fakeCtx(idle = true): unknown {
	return { isIdle: () => idle };
}

/** UI que además captura warn/error (guard D12 + wage inválido D15). */
function fakeUiWithMessages(responses: {
	cocomo?: string;
	wage?: string;
	customWage?: string;
}) {
	const warnings: string[] = [];
	const errors: string[] = [];
	let pickCalls = 0;
	const ui: SlashPickUI = {
		async input(_prompt: string, _placeHolder?: string) {
			return responses.customWage;
		},
		async pick(_title: string, _labels: readonly string[]) {
			pickCalls++;
			return pickCalls === 1 ? responses.cocomo : responses.wage;
		},
		warn(message: string) {
			warnings.push(message);
		},
		error(message: string) {
			errors.push(message);
		},
	};
	return { ui, warnings, errors };
}

/** Deps que rechazan sin tocar la red — seam ensureDeps de la factory. */
const noNetworkDeps = (): SccInstallDeps => ({
	fetchArchive: () => Promise.reject(new Error("sin red (test)")),
});

const REAL_HOME = process.env.HOME;
let home: string;

beforeEach(() => {
	// HOME aislado (File Map: herencia del pack — la factory sondea y
	// dispara la descarga de scc contra un agentDir derivado de
	// os.homedir(); sin esto tocaría ~/.frida real).
	home = mkdtempSync(join(tmpdir(), "size-app-cmd-home-"));
	process.env.HOME = home;
});

afterEach(() => {
	if (REAL_HOME) process.env.HOME = REAL_HOME;
	rmSync(home, { recursive: true, force: true });
	clearRegisteredBuiltinPatterns();
});

describe("frida-size-app · slash command /size (#140)", () => {
	it("buildSizeAppPrompt arma el mensaje FR-7 (objeto literal con requeridos)", () => {
		expect(buildSizeAppPrompt(35000, "semi-detached", "MXN")).toBe(
			'Ejecuta el workflow \'size-app\' con los siguientes argumentos:\n{ wage: 35000, currency: "MXN", cocomoType: "semi-detached" }',
		);
		expect(buildSizeAppPrompt(45000.5, "organic")).toBe(
			"Ejecuta el workflow 'size-app' con los siguientes argumentos:\n{ wage: 45000.5, cocomoType: \"organic\" }",
		);
	});

	it("la factory registra /size con descripción es-MX no vacía", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const pi = fakePi();
			registerBuiltinPattern(SIZE_APP_PATTERN);
			createFridaSizeApp({
				ensureDeps: noNetworkDeps(),
				ui: fakeUi({
					cocomo: "semi-detached (recomendado)",
					wage: "MXN $35,000",
				}),
			})(pi as unknown as ExtensionAPI);
			expect(pi.commands.has("size")).toBe(true);
			const desc = pi.commands.get("size")?.description ?? "";
			expect(desc.length).toBeGreaterThan(10);
			expect(desc).toMatch(/[áéíóúñ¿¡]|dimensionamiento|salario/);
			// Silencio del fire-and-forget rechazante (molde pattern.test.ts) —
			// el warn llegó antes del mockRestore.
			await vi.waitFor(() =>
				expect(warn).toHaveBeenCalledWith(
					expect.stringContaining("instalación de scc falló"),
				),
			);
		} finally {
			warn.mockRestore();
		}
	});

	it("armado completo MXN: 1 sendUserMessage exacto; args ignorados (D5)", async () => {
		const pi = fakePi();
		registerBuiltinPattern(SIZE_APP_PATTERN);
		registerSizeAppCommand(
			pi as unknown as ExtensionAPI,
			fakeUi({ cocomo: "semi-detached (recomendado)", wage: "MXN $35,000" }),
		);
		await pi.commands.get("size")?.handler("35000", fakeCtx());
		expect(pi.sent).toHaveLength(1);
		expect(pi.sent[0]?.text).toBe(
			'Ejecuta el workflow \'size-app\' con los siguientes argumentos:\n{ wage: 35000, currency: "MXN", cocomoType: "semi-detached" }',
		);
		expect(pi.sent[0]?.opts).toBeUndefined();
	});

	it("USD $6,000: wage 6000, currency USD, cocomoType organic literal", async () => {
		const pi = fakePi();
		registerBuiltinPattern(SIZE_APP_PATTERN);
		registerSizeAppCommand(
			pi as unknown as ExtensionAPI,
			fakeUi({ cocomo: "organic", wage: "USD $6,000" }),
		);
		await pi.commands.get("size")?.handler(undefined, fakeCtx());
		expect(pi.sent).toHaveLength(1);
		expect(pi.sent[0]?.text).toBe(
			'Ejecuta el workflow \'size-app\' con los siguientes argumentos:\n{ wage: 6000, currency: "USD", cocomoType: "organic" }',
		);
	});

	it("monto propio: InputBox numérico con decimales; sin currency (default USD del patrón, D15)", async () => {
		const pi = fakePi();
		registerBuiltinPattern(SIZE_APP_PATTERN);
		registerSizeAppCommand(
			pi as unknown as ExtensionAPI,
			fakeUi({
				cocomo: "organic",
				wage: "monto propio",
				customWage: " 45000.50 ",
			}),
		);
		await pi.commands.get("size")?.handler(undefined, fakeCtx());
		expect(pi.sent).toHaveLength(1);
		expect(pi.sent[0]?.text).toContain("wage: 45000.5");
		expect(pi.sent[0]?.text).not.toContain("currency");
		expect(pi.sent[0]?.text).toContain('cocomoType: "organic"');
	});

	it("no-idle: deliverAs followUp (seam git-sync index.ts:403-404)", async () => {
		const pi = fakePi();
		registerBuiltinPattern(SIZE_APP_PATTERN);
		registerSizeAppCommand(
			pi as unknown as ExtensionAPI,
			fakeUi({ cocomo: "embedded", wage: "USD $6,000" }),
		);
		await pi.commands.get("size")?.handler(undefined, fakeCtx(false));
		expect(pi.sent).toHaveLength(1);
		expect(pi.sent[0]?.opts).toEqual({ deliverAs: "followUp" });
		expect(pi.sent[0]?.text).toContain('cocomoType: "embedded"');
	});

	it("cancelación silenciosa FR-8: Esc en cocomoType o en wage → 0 envíos", async () => {
		for (const responses of [
			{ cocomo: undefined, wage: "MXN $35,000" },
			{ cocomo: "organic", wage: undefined },
		]) {
			const pi = fakePi();
			registerBuiltinPattern(SIZE_APP_PATTERN);
			registerSizeAppCommand(pi as unknown as ExtensionAPI, fakeUi(responses));
			await pi.commands.get("size")?.handler(undefined, fakeCtx());
			expect(pi.sent).toHaveLength(0);
		}
	});

	it("cancelación silenciosa FR-8: Esc o Enter-vacío en el monto propio → 0 envíos, sin error", async () => {
		for (const customWage of [undefined, "", "   "]) {
			const pi = fakePi();
			registerBuiltinPattern(SIZE_APP_PATTERN);
			const { ui, errors } = fakeUiWithMessages({
				cocomo: "organic",
				wage: "monto propio",
				customWage,
			});
			registerSizeAppCommand(pi as unknown as ExtensionAPI, ui);
			await pi.commands.get("size")?.handler(undefined, fakeCtx());
			expect(pi.sent).toHaveLength(0);
			expect(errors).toHaveLength(0);
		}
	});

	it("monto propio inválido → error accionable D15, 0 envíos (coma, texto, 0, negativo)", async () => {
		for (const customWage of ["35,000", "abc", "0", "-5"]) {
			const pi = fakePi();
			registerBuiltinPattern(SIZE_APP_PATTERN);
			const { ui, errors } = fakeUiWithMessages({
				cocomo: "organic",
				wage: "monto propio",
				customWage,
			});
			registerSizeAppCommand(pi as unknown as ExtensionAPI, ui);
			await pi.commands.get("size")?.handler(undefined, fakeCtx());
			expect(pi.sent).toHaveLength(0);
			expect(errors).toHaveLength(1);
			expect(errors[0]).toContain("/size");
			expect(errors[0]).toContain("número > 0");
		}
	});

	it("guard D12: patrón ausente → warning accionable, 0 envíos", async () => {
		const pi = fakePi();
		const { ui, warnings } = fakeUiWithMessages({
			cocomo: "semi-detached (recomendado)",
			wage: "MXN $35,000",
		});
		registerSizeAppCommand(pi as unknown as ExtensionAPI, ui);
		await pi.commands.get("size")?.handler(undefined, fakeCtx());
		expect(pi.sent).toHaveLength(0);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("size-app");
		expect(warnings[0]).toContain("/reload");
	});
});
