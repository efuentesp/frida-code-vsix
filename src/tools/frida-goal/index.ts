// frida-goal — punto de entrada: factory + comando /goal.
//
// Porte nativo de @narumitw/pi-goal (issue #20, ADR-0031). El runtime
// reactivo vive en runtime.ts; aquí se registran el comando /goal (con
// subcomandos status/pause/resume/clear/edit) y las devoluciones al host
// (chip 🎯 del footer vía onGoalState → post({type:"goal_state"})).

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { parseCommand } from "./command.js";
import { GoalRuntime, type GoalRuntimeCallbacks } from "./runtime.js";
import { registerGoalTools } from "./tools.js";
import { formatGoalStatus } from "./prompts.js";

export interface CreateFridaGoalOptions extends GoalRuntimeCallbacks {}

/**
 * Factory canónica frida `createFridaXxx(): (pi) => void` (ADR-0022).
 * `cb.onState` publica snapshots al host (webview); `cb.notify` muestra
 * avisos (panel de info / toast del host).
 */
export function createFridaGoal(
	cb: CreateFridaGoalOptions,
): (pi: ExtensionAPI) => void {
	return (pi: ExtensionAPI): void => {
		const runtime = new GoalRuntime(pi, cb);
		runtime.register();
		registerGoalTools(pi, runtime);

		pi.registerCommand("goal", {
			description:
				"Modo goal autónomo: trabaja hasta completar el objetivo (/goal status|pause|resume|clear|edit)",
			async handler(args, ctx) {
				const parsed = parseCommand(args ?? "");
				if (typeof parsed === "string") {
					cb.notify("warning", parsed);
					return;
				}
				switch (parsed.kind) {
					case "show":
						runtime.status();
						return;
					case "start":
						runtime.start(parsed.objective, parsed.tokenBudget, ctx);
						return;
					case "edit":
						runtime.edit(parsed.objective, parsed.tokenBudget, ctx);
						return;
					case "pause":
						runtime.pause("Pausado por el usuario.", ctx);
						return;
					case "resume":
						runtime.resume(ctx);
						return;
					case "clear":
						runtime.clear();
						return;
				}
			},
		});

		// Estado inicial al host (restaurado de persistencia, si aplica).
		cb.onState(undefined);
	};
}

export { formatGoalStatus };
export type { GoalStateSnapshot } from "./state.js";
