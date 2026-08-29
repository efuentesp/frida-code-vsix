/**
 * frida-understand-app — slash command /understand (issue #140, Pista M).
 *
 * Réplica del molde command.ts de frida-app-walkthrough (D4, Slice 1) con
 * la adaptación propia del patrón: NO hay InputBox ni args —
 * understand-app no tiene URL (el target es el cwd del repo), así que el
 * único paso es el QuickPick de maxHotspots (D5: args ignorados, siempre
 * QuickPick). El adapter SlashPickUI conserva los 3 métodos del molde
 * (input lo usan walkthrough/size) para mantener los fakes copiables
 * entre packs.
 *
 * vscode NO se importa estáticamente — index.ts importa este archivo y las
 * suites pattern.test.ts cargan index.ts en vitest sin vscode resolvable;
 * el default de producción carga vscode LAZY (dynamic import) únicamente
 * cuando el handler corre sin ui inyectada (molde Slice 1; guardián
 * estructural: npm test).
 *
 * Flujo (FR-4/FR-7/FR-8): QuickPick de maxHotspots con defaults del FRD
 * (D10; "todo" = 0, D15) → guard findBuiltinPattern (D12) → delegación al
 * chat vía sendUserMessage (D2, seam git-sync index.ts:403-404).
 * Cancelación = no-op silencioso (FR-8/D13): return plano tras undefined.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { findBuiltinPattern } from "../frida-extensible-workflows/builtin-patterns";

/** Opciones de maxHotspots del QuickPick (D10 — defaults FRD; "todo" = 0). */
const MAX_HOTSPOTS_OPTIONS: ReadonlyArray<{ label: string; value: number }> = [
	{ label: "8 hotspots (recomendado)", value: 8 },
	{ label: "15 hotspots", value: 15 },
	{ label: "Todo (sin tope)", value: 0 },
];

/**
 * UI adapter inyectable (molde WorktreeUI, src/worktree/command.ts:56-63):
 * pick/input devuelven undefined al cancelar (Esc) — el return plano del
 * handler ES el no-op de FR-8. Tests inyectan un fake; producción usa el
 * default lazy de abajo. input NO se usa en este pack (sin URL); se
 * conserva para uniformidad del molde (D4).
 */
export interface SlashPickUI {
	/** QuickPick sobre labels; undefined = Esc. */
	pick(title: string, labels: readonly string[]): Promise<string | undefined>;
	/** InputBox de texto; undefined = Esc. (Sin uso en este pack — molde D4.) */
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
 * declarado del patrón; solo el requerido maxHotspots, D8: maxMinutes/
 * language/review viven en defaults del patrón y no se mencionan).
 */
export function buildUnderstandAppPrompt(maxHotspots: number): string {
	return `Ejecuta el workflow 'understand-app' con los siguientes argumentos:\n{ maxHotspots: ${maxHotspots} }`;
}

/**
 * Registra el comando /understand en el ExtensionAPI del pack. Se llama
 * desde el setup de la factory (index.ts); pi queda en closure —
 * sendUserMessage SOLO se invoca diferido, dentro del handler (nunca en
 * setup: el stub lanza hasta bindCore, loader.js:131-133).
 */
export function registerUnderstandAppCommand(
	pi: ExtensionAPI,
	ui?: SlashPickUI,
): void {
	pi.registerCommand("understand", {
		description:
			"Entiende un códigobase desconocido y produce el entendimiento técnico en docs/entendimiento/ (7 preguntas del día 1 con evidencia, riesgos, modelo LikeC4). Pregunta el presupuesto de hotspots.",
		async handler(_args, ctx) {
			const pickUi = ui ?? (await createDefaultPickUI());
			// D5: /understand NO lee args — el target es el cwd del repo y el
			// presupuesto se elige SIEMPRE en el QuickPick (cards sin espacio).
			const label = await pickUi.pick(
				"¿Cuántas áreas de riesgo (hotspots) explorar?",
				MAX_HOTSPOTS_OPTIONS.map((o) => o.label),
			);
			if (label === undefined) return;
			const maxHotspots =
				MAX_HOTSPOTS_OPTIONS.find((o) => o.label === label)?.value ?? 8;

			// D12 (claim estrechado en plan Step 5): patrón ausente del REGISTRO
			// (p. ej. registro limpiado) — error accionable, sin enviar (el tool
			// fallaría opaco, index.ts:226-228 del motor). NOTA: NO cubre "motor
			// apagado" — ese toggle (pi-session.ts:953-958) excluye el tool
			// workflow pero NO el registro de patrones, así que ese caso pasa este
			// guard (design follow-up: getter extensibleWorkflowsEnabled si se
			// quiere cubrir de verdad).
			if (!findBuiltinPattern("understand-app")) {
				pickUi.warn(
					"/understand: el patrón 'understand-app' no está registrado. Verifica que el motor de workflows extensibles esté activo y recarga con /reload.",
				);
				return;
			}
			const prompt = buildUnderstandAppPrompt(maxHotspots);
			// D2: seam git-sync (frida-git-sync/index.ts:403-404) — nunca steer.
			if (ctx.isIdle()) pi.sendUserMessage(prompt);
			else pi.sendUserMessage(prompt, { deliverAs: "followUp" });
		},
	});
}
