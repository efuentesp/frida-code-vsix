/**
 * frida-understand-app — tests del slash command /understand (#140).
 * Moldes: fakePi capturando registerCommand (test/frida-cc-plugins/
 * presenter.test.ts:59-86) + captura de sendUserMessage (test/frida-goal/
 * goal-runtime.test.ts:12-50) + command.test.ts de walkthrough (Slice 1).
 * Sin vscode: la UI se inyecta como fake (adapter D3) — command.ts no
 * importa vscode estáticamente.
 */
import { describe, it, expect, afterEach } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	clearRegisteredBuiltinPatterns,
	registerBuiltinPattern,
} from "../../src/tools/frida-extensible-workflows/builtin-patterns";
import {
	UNDERSTAND_APP_PATTERN,
	createFridaUnderstandApp,
} from "../../src/tools/frida-understand-app";
import {
	buildUnderstandAppPrompt,
	registerUnderstandAppCommand,
	type SlashPickUI,
} from "../../src/tools/frida-understand-app/command";

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
 * Fake de SlashPickUI con respuesta scripted de pick. input LANZA si se
 * invoca: /understand no tiene paso de InputBox (D5 — el target es el cwd).
 */
function fakeUi(responses: { pick?: string }) {
	const ui: SlashPickUI = {
		async input() {
			throw new Error("input inesperado: /understand no usa InputBox");
		},
		async pick(_title: string, _labels: readonly string[]) {
			return responses.pick;
		},
		warn(message: string) {
			throw new Error("warn inesperado: " + message);
		},
	};
	return ui;
}

/** Fake de ExtensionCommandContext (solo isIdle). */
function fakeCtx(idle = true): unknown {
	return { isIdle: () => idle };
}

/** UI que además captura los warnings (para el guard D12). */
function fakeUiWithWarnings(responses: { pick?: string }) {
	const warnings: string[] = [];
	const ui: SlashPickUI = {
		async input() {
			throw new Error("input inesperado: /understand no usa InputBox");
		},
		async pick(_title: string, _labels: readonly string[]) {
			return responses.pick;
		},
		warn(message: string) {
			warnings.push(message);
		},
	};
	return { ui, warnings };
}

afterEach(() => {
	// Lesson M8: el registro es module-global — limpiar entre tests.
	clearRegisteredBuiltinPatterns();
});

describe("frida-understand-app · slash command /understand (#140)", () => {
	it("buildUnderstandAppPrompt arma el mensaje FR-7 (objeto literal con el requerido)", () => {
		expect(buildUnderstandAppPrompt(8)).toBe(
			"Ejecuta el workflow 'understand-app' con los siguientes argumentos:\n{ maxHotspots: 8 }",
		);
	});

	it("la factory registra /understand con descripción es-MX no vacía", () => {
		const pi = fakePi();
		registerBuiltinPattern(UNDERSTAND_APP_PATTERN);
		createFridaUnderstandApp({
			ui: fakeUi({ pick: "8 hotspots (recomendado)" }),
		})(pi as unknown as ExtensionAPI);
		expect(pi.commands.has("understand")).toBe(true);
		const desc = pi.commands.get("understand")?.description ?? "";
		expect(desc.length).toBeGreaterThan(10);
		expect(desc).toMatch(/[áéíóúñ¿¡]|entendimiento|hotspots/);
	});

	it("armado completo: 1 sendUserMessage exacto; args ignorados (D5), sin InputBox", async () => {
		const pi = fakePi();
		registerBuiltinPattern(UNDERSTAND_APP_PATTERN);
		registerUnderstandAppCommand(
			pi as unknown as ExtensionAPI,
			fakeUi({ pick: "8 hotspots (recomendado)" }),
		);
		await pi.commands.get("understand")?.handler("  15  ", fakeCtx());
		expect(pi.sent).toHaveLength(1);
		expect(pi.sent[0]?.text).toBe(
			"Ejecuta el workflow 'understand-app' con los siguientes argumentos:\n{ maxHotspots: 8 }",
		);
		expect(pi.sent[0]?.opts).toBeUndefined();
	});

	it("'Todo (sin tope)' viaja como maxHotspots: 0 (D15)", async () => {
		const pi = fakePi();
		registerBuiltinPattern(UNDERSTAND_APP_PATTERN);
		registerUnderstandAppCommand(
			pi as unknown as ExtensionAPI,
			fakeUi({ pick: "Todo (sin tope)" }),
		);
		await pi.commands.get("understand")?.handler(undefined, fakeCtx());
		expect(pi.sent).toHaveLength(1);
		expect(pi.sent[0]?.text).toContain("maxHotspots: 0");
	});

	it("no-idle: deliverAs followUp (seam git-sync index.ts:403-404)", async () => {
		const pi = fakePi();
		registerBuiltinPattern(UNDERSTAND_APP_PATTERN);
		registerUnderstandAppCommand(
			pi as unknown as ExtensionAPI,
			fakeUi({ pick: "15 hotspots" }),
		);
		await pi.commands.get("understand")?.handler(undefined, fakeCtx(false));
		expect(pi.sent).toHaveLength(1);
		expect(pi.sent[0]?.opts).toEqual({ deliverAs: "followUp" });
		expect(pi.sent[0]?.text).toContain("maxHotspots: 15");
	});

	it("cancelación silenciosa FR-8: Esc en el QuickPick → 0 envíos", async () => {
		const pi = fakePi();
		registerBuiltinPattern(UNDERSTAND_APP_PATTERN);
		registerUnderstandAppCommand(
			pi as unknown as ExtensionAPI,
			fakeUi({ pick: undefined }),
		);
		await pi.commands.get("understand")?.handler(undefined, fakeCtx());
		expect(pi.sent).toHaveLength(0);
	});

	it("guard D12: patrón ausente → warning accionable, 0 envíos", async () => {
		const pi = fakePi();
		const { ui, warnings } = fakeUiWithWarnings({
			pick: "8 hotspots (recomendado)",
		});
		registerUnderstandAppCommand(pi as unknown as ExtensionAPI, ui);
		await pi.commands.get("understand")?.handler(undefined, fakeCtx());
		expect(pi.sent).toHaveLength(0);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("understand-app");
		expect(warnings[0]).toContain("/reload");
	});
});
