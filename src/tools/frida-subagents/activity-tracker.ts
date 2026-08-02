// activity-tracker — tracker de actividad de un sub-agente.
//
// Porte del patrón createActivityTracker / describeActivity de
// @tintinweb/pi-subagents (ADR-0022). Mantiene el estado vivo de un sub-agente
// (tools activos con start/end, contador de tool uses, turnos, texto del último
// mensaje, tokens) y expone callbacks tipados que forwardLiveProgress cablea a
// los eventos de la sesión hija.
//
// describeActivity() reduce ese estado a un resumen compacto de una línea
// ("searching 3 patterns…", "editing…", "thinking…") para el vistazo en vivo:
// más legible y estable que un volcado de texto creciendo.

/** Mapa tool → verbo de acción legible para describeActivity. */
const TOOL_DISPLAY: Record<string, string> = {
	bash: "running",
	read: "reading",
	write: "writing",
	edit: "editing",
	grep: "searching",
	find: "searching",
	ls: "listing",
	todo: "planning",
	agent: "delegating",
	agent_browser: "browsing",
	web_search: "searching",
	web_fetch: "fetching",
};

export interface ActivityState {
	/** Tools actualmente ejecutándose (key única → nombre). start añade, end quita. */
	activeTools: Map<string, string>;
	/** Tools completados (contador). */
	toolUses: number;
	/** Turno actual. */
	turnCount: number;
	/** Límite de turnos (si lo hay), para mostrar "turn X/maxTurns". */
	maxTurns?: number;
	/** Texto acumulado del último mensaje del asistente. */
	responseText: string;
	/** Tokens acumulados (input + output) a lo largo de la vida del agente. */
	tokens: number;
}

export interface ToolActivity {
	type: "start" | "end";
	toolName: string;
}

export interface AssistantUsage {
	input: number;
	output: number;
}

export interface ActivityCallbacks {
	onToolActivity: (activity: ToolActivity) => void;
	onTextDelta: (delta: string, fullText: string) => void;
	onTurnEnd: (turnCount: number) => void;
	onAssistantUsage: (usage: AssistantUsage) => void;
}

export interface ActivityTracker {
	state: ActivityState;
	callbacks: ActivityCallbacks;
}

/**
 * Crea un tracker de actividad para un sub-agente. `onStreamUpdate` se llama en
 * cada cambio de estado (tools, texto, turnos, tokens) para que el llamador lo
 * reenvíe (throttled) al webview vía onUpdate.
 */
export function createActivityTracker(
	maxTurns?: number,
	onStreamUpdate?: () => void,
): ActivityTracker {
	const state: ActivityState = {
		activeTools: new Map(),
		toolUses: 0,
		turnCount: 1,
		maxTurns,
		responseText: "",
		tokens: 0,
	};
	const callbacks: ActivityCallbacks = {
		onToolActivity: (activity) => {
			if (activity.type === "start") {
				// Key única (nombre + timestamp) para distinguir tools homónimos
				// ejecutándose a la vez (p. ej. dos read paralelos).
				state.activeTools.set(
					`${activity.toolName}_${Date.now()}_${Math.random()}`,
					activity.toolName,
				);
			} else {
				// end: quita la primera ocurrencia de ese tool (la más antigua).
				for (const [key, name] of state.activeTools) {
					if (name === activity.toolName) {
						state.activeTools.delete(key);
						break;
					}
				}
				state.toolUses++;
			}
			onStreamUpdate?.();
		},
		onTextDelta: (_delta, fullText) => {
			state.responseText = fullText;
			onStreamUpdate?.();
		},
		onTurnEnd: (turnCount) => {
			state.turnCount = turnCount;
			onStreamUpdate?.();
		},
		onAssistantUsage: (usage) => {
			state.tokens += usage.input + usage.output;
			onStreamUpdate?.();
		},
	};
	return { state, callbacks };
}

/**
 * Resumen compacto de una línea de la actividad actual:
 *   - tools activos → "searching 3 patterns, editing…" (agrupa por verbo)
 *   - si no, texto truncado del último mensaje → "Analizando el módulo…"
 *   - si no, → "thinking…"
 */
export function describeActivity(
	activeTools: Map<string, string>,
	responseText: string,
): string {
	if (activeTools.size > 0) {
		const groups = new Map<string, number>();
		for (const toolName of activeTools.values()) {
			const action = TOOL_DISPLAY[toolName] ?? toolName;
			groups.set(action, (groups.get(action) ?? 0) + 1);
		}
		const parts: string[] = [];
		for (const [action, count] of groups) {
			parts.push(count > 1 ? `${action} ×${count}` : action);
		}
		return parts.join(", ") + "…";
	}
	if (responseText && responseText.trim().length > 0) {
		const line = responseText.replace(/\s+/g, " ").trim();
		return line.length > 80 ? `${line.slice(0, 80)}…` : line;
	}
	return "thinking…";
}
