/**
 * frida-size-app — slash command /size (issue #140, Pista M).
 *
 * Réplica del molde command.ts de frida-app-walkthrough (D4, Slice 1) con
 * las adaptaciones propias del patrón: DOS QuickPicks requeridos
 * (cocomoType primero, luego wage — D10) y el InputBox numérico SOLO para
 * "monto propio" (D15). El adapter SlashPickUI agrega un 4º método
 * `error` (adaptación del pack, D15): el warning (D12) cubre el patrón
 * ausente; el error cubre la entrada numérica inválida del usuario —
 * showWarningMessage sería semánticamente débil para esa barra.
 *
 * vscode NO se importa estáticamente — index.ts importa este archivo y las
 * suites pattern.test.ts cargan index.ts en vitest sin vscode resolvable;
 * el default de producción carga vscode LAZY (dynamic import) únicamente
 * cuando el handler corre sin ui inyectada (molde Slice 1; guardián
 * estructural: npm test).
 *
 * Flujo (FR-4/FR-7/FR-8): QuickPick cocomoType (D10) → QuickPick wage
 * (MXN/USD traen wage+currency; "monto propio" → InputBox numérico, sin
 * currency — default "USD" del patrón) → guard findBuiltinPattern (D12) →
 * delegación al chat vía sendUserMessage (D2, seam git-sync
 * index.ts:403-404). Cancelación = no-op silencioso (FR-8/D13): return
 * plano tras undefined o Enter-vacío. args se IGNORAN (D5: QuickPicks
 * siempre — cards sin espacio final).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { findBuiltinPattern } from "../frida-extensible-workflows/builtin-patterns";
import type { CocomoType } from "./workflow";

/** Opciones de cocomoType del QuickPick (D10 — enum del validador). */
const COCOMO_OPTIONS: ReadonlyArray<{ label: string; value: CocomoType }> = [
	{ label: "semi-detached (recomendado)", value: "semi-detached" },
	{ label: "organic", value: "organic" },
	{ label: "embedded", value: "embedded" },
];

/**
 * Opciones de wage del QuickPick (D10): MXN/USD traen wage+currency
 * embebidos; "monto propio" abre el InputBox numérico (sin currency — el
 * patrón aplica su default "USD", D15).
 */
const WAGE_OPTIONS: ReadonlyArray<{
	label: string;
	wage?: number;
	currency?: string;
	custom?: boolean;
}> = [
	{ label: "MXN $35,000", wage: 35000, currency: "MXN" },
	{ label: "USD $6,000", wage: 6000, currency: "USD" },
	{ label: "monto propio", custom: true },
];

/**
 * UI adapter inyectable (molde WorktreeUI, src/worktree/command.ts:56-63):
 * pick/input devuelven undefined al cancelar (Esc) — el return plano del
 * handler ES el no-op de FR-8. Tests inyectan un fake; producción usa el
 * default lazy de abajo. `error` es la adaptación del pack (D15):
 * showErrorMessage para el monto propio inválido (entrada del usuario),
 * distinto del warn D12 (condición del entorno: patrón ausente).
 */
export interface SlashPickUI {
	/** QuickPick sobre labels; undefined = Esc. */
	pick(title: string, labels: readonly string[]): Promise<string | undefined>;
	/** InputBox de texto; undefined = Esc. */
	input(prompt: string, placeHolder?: string): Promise<string | undefined>;
	/** Warning no-modal (guard D12: patrón ausente — causa+remedio). */
	warn(message: string): void;
	/** Error no-modal (D15: monto propio no numérico — causa+remedio). */
	error(message: string): void;
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
		error(message) {
			void vscode.window.showErrorMessage(message);
		},
	};
}

/**
 * Arma el mensaje de lanzamiento (D11 — objeto literal 1:1 con el `args`
 * declarado del patrón): wage SIEMPRE (único requerido del patrón),
 * currency solo cuando la opción del pick la trae ("monto propio" deja el
 * default "USD" del patrón, D15) y cocomoType siempre (elegido en
 * QuickPick, D8: maxMinutes/language/review/exclude viven en defaults del
 * patrón y no se mencionan).
 */
export function buildSizeAppPrompt(
	wage: number,
	cocomoType: CocomoType,
	currency?: string,
): string {
	const parts = [`wage: ${wage}`];
	if (currency !== undefined) {
		parts.push(`currency: ${JSON.stringify(currency)}`);
	}
	parts.push(`cocomoType: ${JSON.stringify(cocomoType)}`);
	return `Ejecuta el workflow 'size-app' con los siguientes argumentos:\n{ ${parts.join(", ")} }`;
}

/**
 * Registra el comando /size en el ExtensionAPI del pack. Se llama desde el
 * setup de la factory (index.ts); pi queda en closure — sendUserMessage
 * SOLO se invoca diferido, dentro del handler (nunca en setup: el stub
 * lanza hasta bindCore, loader.js:131-133).
 */
export function registerSizeAppCommand(
	pi: ExtensionAPI,
	ui?: SlashPickUI,
): void {
	pi.registerCommand("size", {
		description:
			"Dimensiona cuantitativamente la app del repo para preventa: KLOC, COCOMO 81 con costo por salario mensual, deuda técnica y riesgos; entrega docs/dimensionamiento/. Pregunta modo COCOMO y salario.",
		async handler(_args, ctx) {
			const pickUi = ui ?? (await createDefaultPickUI());
			// D5: /size NO lee args — cocomoType y wage se eligen SIEMPRE en los
			// QuickPicks (cards sin espacio final).
			const cocomoLabel = await pickUi.pick(
				"¿Modo Basic COCOMO 81?",
				COCOMO_OPTIONS.map((o) => o.label),
			);
			if (cocomoLabel === undefined) return;
			const cocomoType =
				COCOMO_OPTIONS.find((o) => o.label === cocomoLabel)?.value ??
				"semi-detached";

			const wageLabel = await pickUi.pick(
				"¿Salario MENSUAL por persona?",
				WAGE_OPTIONS.map((o) => o.label),
			);
			if (wageLabel === undefined) return;
			const chosen = WAGE_OPTIONS.find((o) => o.label === wageLabel);
			let wage: number;
			let currency: string | undefined;
			if (chosen?.custom) {
				// D15: monto propio — InputBox numérico. Esc y Enter-vacío: no-op
				// silencioso (FR-8, molde aidd-plan src/extension.ts:4465).
				const entered = await pickUi.input(
					"Salario MENSUAL por persona (número > 0; punto decimal, p. ej. 35000.50)",
					"35000.50",
				);
				const text = entered?.trim() ?? "";
				if (!text) return;
				// Formato estricto ANTES del parseFloat: la coma ("35,000") es la
				// trampa clásica — parseFloat pararía en 35 y enviaría un wage
				// engañoso; se rechaza con causa+remedio (D15, sin envío).
				if (!/^\d+(?:\.\d+)?$/.test(text)) {
					pickUi.error(
						"/size: el salario debe ser un número > 0 con punto decimal (p. ej. 35000.50), sin comas ni texto. Vuelve a lanzar /size.",
					);
					return;
				}
				const parsed = Number.parseFloat(text);
				if (!Number.isFinite(parsed) || parsed <= 0) {
					pickUi.error(
						"/size: el salario debe ser un número > 0. Vuelve a lanzar /size.",
					);
					return;
				}
				wage = parsed; // currency queda undefined → default "USD" del patrón
			} else {
				wage = chosen?.wage ?? 6000;
				currency = chosen?.currency;
			}

			// D12 (claim estrechado en plan Step 5): patrón ausente del REGISTRO
			// (p. ej. registro limpiado) — error accionable, sin enviar (el tool
			// fallaría opaco, index.ts:226-228 del motor). NOTA: NO cubre "motor
			// apagado" — ese toggle (pi-session.ts:953-958) excluye el tool
			// workflow pero NO el registro de patrones, así que ese caso pasa este
			// guard (design follow-up: getter extensibleWorkflowsEnabled si se
			// quiere cubrir de verdad).
			if (!findBuiltinPattern("size-app")) {
				pickUi.warn(
					"/size: el patrón 'size-app' no está registrado. Verifica que el motor de workflows extensibles esté activo y recarga con /reload.",
				);
				return;
			}
			const prompt = buildSizeAppPrompt(wage, cocomoType, currency);
			// D2: seam git-sync (frida-git-sync/index.ts:403-404) — nunca steer.
			if (ctx.isIdle()) pi.sendUserMessage(prompt);
			else pi.sendUserMessage(prompt, { deliverAs: "followUp" });
		},
	});
}
