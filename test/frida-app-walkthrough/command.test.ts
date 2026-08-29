/**
 * frida-app-walkthrough — tests del slash command /walkthrough (#140).
 * Moldes: fakePi capturando registerCommand (test/frida-cc-plugins/
 * presenter.test.ts:59-86) + captura de sendUserMessage (test/frida-goal/
 * goal-runtime.test.ts:12-50). Sin vscode: la UI se inyecta como fake
 * (adapter D3) — command.ts no importa vscode estáticamente.
 */
import { describe, it, expect, afterEach } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	clearRegisteredBuiltinPatterns,
	registerBuiltinPattern,
} from "../../src/tools/frida-extensible-workflows/builtin-patterns";
import {
	APP_WALKTHROUGH_PATTERN,
	createFridaAppWalkthrough,
} from "../../src/tools/frida-app-walkthrough";
import {
	buildWalkthroughPrompt,
	registerWalkthroughCommand,
	type SlashPickUI,
} from "../../src/tools/frida-app-walkthrough/command";

interface Sent {
	text: string;
	opts?: { deliverAs?: string };
}

/** Captura de ExtensionAPI: comandos en Map + sendUserMessage grabado. */
function fakePi() {
	const sent: Sent[] = [];
	const commands = new Map<
		string,
		{ description?: string; handler: (a: string, c: unknown) => Promise<void> }
	>();
	const pi = {
		commands,
		sent,
		registerCommand: (
			n: string,
			o: {
				description?: string;
				handler: (a: string, c: unknown) => Promise<void>;
			},
		) => commands.set(n, o),
		sendUserMessage: (text: string, opts?: { deliverAs?: string }) => {
			sent.push({ text, opts });
		},
	};
	return pi;
}

/** Fake de SlashPickUI con respuestas scripted (undefined = Esc). */
function fakeUi(responses: { url?: string; pick?: string }) {
	const ui: SlashPickUI = {
		async input(_prompt: string, _placeHolder?: string) {
			return responses.url;
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
function fakeUiWithWarnings(responses: { url?: string; pick?: string }) {
	const warnings: string[] = [];
	const ui: SlashPickUI = {
		async input(_prompt: string, _placeHolder?: string) {
			return responses.url;
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

describe("frida-app-walkthrough · slash command /walkthrough (#140)", () => {
	it("buildWalkthroughPrompt arma el mensaje FR-7 (objeto literal con requeridos)", () => {
		expect(buildWalkthroughPrompt("https://a.b", 10)).toBe(
			"Ejecuta el workflow 'app-walkthrough' con los siguientes argumentos:\n{ url: \"https://a.b\", maxScreens: 10 }",
		);
	});

	it("la factory registra /walkthrough con descripción es-MX no vacía", () => {
		const pi = fakePi();
		registerBuiltinPattern(APP_WALKTHROUGH_PATTERN);
		createFridaAppWalkthrough({
			ui: fakeUi({ pick: "10 pantallas (recomendado)" }),
		})(pi as unknown as ExtensionAPI);
		expect(pi.commands.has("walkthrough")).toBe(true);
		const desc = pi.commands.get("walkthrough")?.description ?? "";
		expect(desc.length).toBeGreaterThan(10);
		expect(desc).toMatch(/[áéíóúñ¿¡]|pantallas|document/);
	});

	it("armado completo con URL inline (FR-7): 1 sendUserMessage, sin InputBox", async () => {
		const pi = fakePi();
		registerBuiltinPattern(APP_WALKTHROUGH_PATTERN);
		let inputs = 0;
		const ui: SlashPickUI = {
			async input() {
				inputs++;
				return "https://x.app";
			},
			async pick() {
				return "10 pantallas (recomendado)";
			},
			warn: () => {},
		};
		registerWalkthroughCommand(pi as unknown as ExtensionAPI, ui);
		await pi.commands
			.get("walkthrough")
			?.handler("https://app.ejemplo.com", fakeCtx());
		expect(inputs).toBe(0);
		expect(pi.sent).toHaveLength(1);
		expect(pi.sent[0]?.text).toContain(
			"Ejecuta el workflow 'app-walkthrough' con los siguientes argumentos:",
		);
		expect(pi.sent[0]?.text).toContain('url: "https://app.ejemplo.com"');
		expect(pi.sent[0]?.text).toContain("maxScreens: 10");
		expect(pi.sent[0]?.opts).toBeUndefined();
	});

	it("URL por InputBox cuando args vacíos; 'Todo' viaja como maxScreens: 0", async () => {
		const pi = fakePi();
		registerBuiltinPattern(APP_WALKTHROUGH_PATTERN);
		registerWalkthroughCommand(
			pi as unknown as ExtensionAPI,
			fakeUi({ url: "https://x.app", pick: "Todo (sin tope)" }),
		);
		await pi.commands.get("walkthrough")?.handler("   ", fakeCtx());
		expect(pi.sent).toHaveLength(1);
		expect(pi.sent[0]?.text).toContain('url: "https://x.app"');
		expect(pi.sent[0]?.text).toContain("maxScreens: 0");
	});

	it("no-idle: deliverAs followUp (seam git-sync index.ts:403-404)", async () => {
		const pi = fakePi();
		registerBuiltinPattern(APP_WALKTHROUGH_PATTERN);
		registerWalkthroughCommand(
			pi as unknown as ExtensionAPI,
			fakeUi({ pick: "5 pantallas" }),
		);
		await pi.commands.get("walkthrough")?.handler("https://a.b", fakeCtx(false));
		expect(pi.sent).toHaveLength(1);
		expect(pi.sent[0]?.opts).toEqual({ deliverAs: "followUp" });
		expect(pi.sent[0]?.text).toContain("maxScreens: 5");
	});

	it("cancelación silenciosa FR-8: Esc o Enter-vacío en la URL → 0 envíos", async () => {
		registerBuiltinPattern(APP_WALKTHROUGH_PATTERN);
		for (const url of [undefined, "", "   "]) {
			const pi = fakePi();
			registerWalkthroughCommand(
				pi as unknown as ExtensionAPI,
				fakeUi({ url, pick: "10 pantallas (recomendado)" }),
			);
			await pi.commands.get("walkthrough")?.handler("", fakeCtx());
			expect(pi.sent).toHaveLength(0);
		}
	});

	it("cancelación silenciosa FR-8: Esc en el QuickPick → 0 envíos", async () => {
		const pi = fakePi();
		registerBuiltinPattern(APP_WALKTHROUGH_PATTERN);
		registerWalkthroughCommand(
			pi as unknown as ExtensionAPI,
			fakeUi({ pick: undefined }),
		);
		await pi.commands.get("walkthrough")?.handler("https://a.b", fakeCtx());
		expect(pi.sent).toHaveLength(0);
	});

	it("guard D12: patrón ausente → warning accionable, 0 envíos", async () => {
		const pi = fakePi();
		const { ui, warnings } = fakeUiWithWarnings({
			pick: "10 pantallas (recomendado)",
		});
		registerWalkthroughCommand(pi as unknown as ExtensionAPI, ui);
		await pi.commands.get("walkthrough")?.handler("https://a.b", fakeCtx());
		expect(pi.sent).toHaveLength(0);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("app-walkthrough");
		expect(warnings[0]).toContain("/reload");
	});
});
