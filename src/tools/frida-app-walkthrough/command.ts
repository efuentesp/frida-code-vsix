/**
 * frida-app-walkthrough — slash command /walkthrough (issue #140, Pista M).
 *
 * Molde presenter.ts de cc-plugins (UI adapter por pack) con una
 * adaptación: vscode NO se importa estáticamente — command.ts lo importa
 * index.ts, que las suites pattern.test.ts cargan en vitest sin vscode
 * resolvable; el default de producción carga vscode LAZY (dynamic import)
 * únicamente cuando el handler corre sin ui inyectada. Así el comando
 * completo (interfaz + handler + registro) vive aquí sin romper el
 * guardián estructural (npm test).
 *
 * Flujo (FR-4/FR-7/FR-8): URL inline tras el comando o InputBox (D5) →
 * QuickPick de maxScreens con defaults del FRD (D10; "todo" = 0, D15) →
 * guard findBuiltinPattern (D12) → delegación al chat vía sendUserMessage
 * (D2, seam git-sync index.ts:403-404). Cancelación = no-op silencioso
 * (FR-8/D13): return plano tras undefined, sin notify.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { findBuiltinPattern } from "../frida-extensible-workflows/builtin-patterns";

/** Opciones de maxScreens del QuickPick (D10 — defaults FRD; "todo" = 0). */
const MAX_SCREENS_OPTIONS: ReadonlyArray<{ label: string; value: number }> = [
	{ label: "10 pantallas (recomendado)", value: 10 },
	{ label: "5 pantallas", value: 5 },
	{ label: "25 pantallas", value: 25 },
	{ label: "Todo (sin tope)", value: 0 },
];

/**
 * UI adapter inyectable (molde WorktreeUI, src/worktree/command.ts:56-63):
 * pick/input devuelven undefined al cancelar (Esc) — el return plano del
 * handler ES el no-op de FR-8. Tests inyectan un fake; producción usa el
 * default lazy de abajo.
 */
export interface SlashPickUI {
	/** QuickPick sobre labels; undefined = Esc. */
	pick(title: string, labels: readonly string[]): Promise<string | undefined>;
	/** InputBox de texto; undefined = Esc. */
	input(prompt: string, placeHolder?: string): Promise<string | undefined>;
	/** Warning no-modal (guard D12: patrón ausente — causa+remedio). */
	warn(message: string): void;
}

/** Default de producción: vscode LAZY (ver cabecera). Solo extension host. */
async function createDefaultPickUI(): Promise<SlashPickUI> {
	const vscode = await import("vscode");
	return {
		async pick(title, labels) {
			return vscode.window.showQuickPick([...labels], { title });
		},
		async input(prompt, placeHolder) {
			return vscode.window.showInputBox({ prompt, placeHolder });
		},
		warn(message) {
			void vscode.window.showWarningMessage(message);
		},
	};
}

/**
 * Arma el mensaje de lanzamiento (D11 — objeto literal 1:1 con el `args`
 * declarado del patrón; todos los requeridos presentes, FR-7).
 */
export function buildWalkthroughPrompt(
	url: string,
	maxScreens: number,
): string {
	return `Ejecuta el workflow 'app-walkthrough' con los siguientes argumentos:\n{ url: ${JSON.stringify(url)}, maxScreens: ${maxScreens} }`;
}

/**
 * Registra el comando /walkthrough en el ExtensionAPI del pack. Se llama
 * desde el setup de la factory (index.ts); pi queda en closure —
 * sendUserMessage SOLO se invoca diferido, dentro del handler (nunca en
 * setup: el stub lanza hasta bindCore, loader.js:131-133).
 */
export function registerWalkthroughCommand(
	pi: ExtensionAPI,
	ui?: SlashPickUI,
): void {
	pi.registerCommand("walkthrough", {
		description:
			"Documenta una app web usándola como usuario real y genera docs/funcional/ (pantallas, journeys, reglas, roles). Pregunta URL y presupuesto de pantallas.",
		async handler(args, ctx) {
			const pickUi = ui ?? (await createDefaultPickUI());
			// D5: args inline = URL (sin espacios, molde postWfCommand
			// src/extension.ts:4452-4460). Esc y Enter-vacío: no-op (:4465).
			let url = args?.trim() ?? "";
			if (!url) {
				const entered = await pickUi.input(
					"URL de la app a documentar (sesión de navegador pre-autenticada)",
					"https://app.ejemplo.com",
				);
				if (!entered || !entered.trim()) return;
				url = entered.trim();
			}
			// D10/D15: presupuesto — "Todo" viaja como número 0.
			const label = await pickUi.pick(
				"¿Cuántas pantallas únicas documentar?",
				MAX_SCREENS_OPTIONS.map((o) => o.label),
			);
			if (label === undefined) return;
			const maxScreens =
				MAX_SCREENS_OPTIONS.find((o) => o.label === label)?.value ?? 10;

			// D12 (claim estrechado en plan Step 5): patrón ausente del REGISTRO
			// (p. ej. registro limpiado) — error accionable, sin enviar (el tool
			// fallaría opaco, index.ts:226-228 del motor). NOTA: NO cubre "motor
			// apagado" — ese toggle (pi-session.ts:953-958) excluye el tool
			// workflow pero NO el registro de patrones, así que ese caso pasa este
			// guard (design follow-up: getter extensibleWorkflowsEnabled si se
			// quiere cubrir de verdad).
			if (!findBuiltinPattern("app-walkthrough")) {
				pickUi.warn(
					"/walkthrough: el patrón 'app-walkthrough' no está registrado. Verifica que el motor de workflows extensibles esté activo y recarga con /reload.",
				);
				return;
			}
			const prompt = buildWalkthroughPrompt(url, maxScreens);
			// D2: seam git-sync (frida-git-sync/index.ts:403-404) — nunca steer.
			if (ctx.isIdle()) pi.sendUserMessage(prompt);
			else pi.sendUserMessage(prompt, { deliverAs: "followUp" });
		},
	});
}
