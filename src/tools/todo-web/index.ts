// Extensión `todo` construida sobre Remote React persistente (ADR-0014). Reemplaza
// al porte nativo (src/tools/todo/todo.ts): en vez de mutar un holder mudo y
// depender de que el host publique el estado por un conducto aparte
// (post {type:"todos"}), esta extensión registra el tool Y monta un panel
// persistente (TodoWebPanel) que se re-renderiza solo ante cada mutation del store
// reactivo (useSyncExternalStore).
//
// Patrón (paridad conceptual con rpiv-todo, pero con UI web en vez del overlay
// pi-tui):
//   - El tool execute muta el store (setTodoState EMITE → el panel re-renderiza).
//   - session_start: replay desde la rama (sobrevive recarga/switch/compaction) +
//     montar el panel si hay UI.
//   - session_compact: replay (la rama cambió tras compactar).
//   - session_shutdown: desmontar el panel y resetear el store.
//
// Inline en el host (decisión D23 / ADR-0014): React+reconciler viven en el bundle;
// useState/useSyncExternalStore exigen el mismo React que el reconciler.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ReactElement } from "react";
import { applyTaskMutation, type TaskState } from "../todo/state-reducer";
import { buildToolResult } from "../todo/response-envelope";
import {
	TOOL_LABEL,
	TOOL_NAME,
	TodoParamsSchema,
	type TaskAction,
	type TaskMutationParams,
} from "../todo/types";
import { replayFromBranch } from "../todo/replay";
import {
	getTodoState,
	resetTodoState,
	setHiddenIds,
	setTodoState,
} from "./store";
import { createTodoWebPanelElement } from "./todo-web";

// Prompt del tool (copiado del porte nativo; se mantiene aquí al ser el único
// registro del tool a partir de esta extensión).
export const DEFAULT_PROMPT_SNIPPET =
	"Manage a task list to track multi-step progress";

export const DEFAULT_PROMPT_GUIDELINES: string[] = [
	"Use `todo` for complex work with 3+ steps, when the user gives you a list of tasks, or immediately after receiving new instructions to capture requirements. Skip it for single trivial tasks and purely conversational requests.",
	"When starting any task, mark it in_progress BEFORE beginning work. Mark it completed IMMEDIATELY when done — never batch completions. Exactly one task should be in_progress at a time.",
	"Never mark a task completed if tests are failing, the implementation is partial, or you hit unresolved errors — keep it in_progress and create a new task for the blocker instead.",
	"Task status is a 4-state machine: pending → in_progress → completed, plus deleted as a tombstone. Pass activeForm (present-continuous label, e.g. 'researching existing tool') when marking in_progress.",
	"Use blockedBy to express dependencies (A is blocked by B). On create, pass blockedBy as the initial set. On update, use addBlockedBy / removeBlockedBy (additive merge — do not resend the full array). Cycles are rejected.",
	"list hides tombstoned (deleted) tasks by default; pass includeDeleted:true to see them. Pass status to filter by a single status.",
	"Subject must be short and imperative (e.g. 'Research existing tool'); description is for long-form detail. activeForm is a present-continuous label shown while in_progress.",
];

/** Slice del ExtensionUIContext de Frida que expone fridaWebMount (no está en el SDK). */
type FridaWebMountUI = {
	fridaWebMount: (
		factory: () => ReactElement,
		placement?: import("../../web-protocol").WebPlacement,
	) => { unmount: () => void };
};

/**
 * Factory de la extensión. Registra el tool `todo` y monta el panel persistente
 * (TodoWebPanel) al inicio de cada sesión con UI. El panel se re-renderiza solo
 * ante cada mutation del store reactivo; el host no necesita publicar nada.
 */
export function createTodoWeb() {
	return (pi: ExtensionAPI) => {
		pi.registerTool({
			name: TOOL_NAME,
			label: TOOL_LABEL,
			description:
				"Manage a task list for tracking multi-step progress. Actions: create (new task), update (change status/fields/dependencies), list (all tasks, optionally filtered by status), get (single task details), delete (tombstone), clear (reset all). Status: pending → in_progress → completed, plus deleted tombstone. Use this to plan and track multi-step work like research, design, and implementation.",
			promptSnippet: DEFAULT_PROMPT_SNIPPET,
			promptGuidelines: DEFAULT_PROMPT_GUIDELINES,
			parameters: TodoParamsSchema,

			async execute(_toolCallId, params) {
				const p = params as TaskMutationParams & { action: TaskAction };
				let state: TaskState = getTodoState();
				// clear-on-new-create: si el primer action MUTANTE del turno es un
				// `create` y quedan tareas no-completadas del plan anterior, descartarlas
				// antes de crear — el plan nuevo arranca limpio y no acumula sobre
				// pendientes stale. "Primer mutante del turno = create" detecta "plan
				// nuevo": si el modelo RETOMA el plan, su primera acción es `update`, no
				// `create`, así que no se limpia (preserva continuidad multi-turno). Las
				// sólo-lectura (list/get) no setean mutatedThisTurn → un `list` previo no
				// bloquea la limpieza. Robusto al reload: el estado limpio queda en el
				// historial (cada create graba el estado completo) y el flag se resetea
				// en agent_start/session_start (vs. el abort-detection, que perdía su
				// flag efímero al recargar).
				if (p.action === "create" && !mutatedThisTurn) {
					const leftovers = state.tasks.filter((t) => t.status !== "completed");
					if (leftovers.length > 0) {
						state = {
							tasks: state.tasks.filter((t) => t.status === "completed"),
							nextId: state.nextId,
						};
					}
				}
				if (p.action !== "list" && p.action !== "get") {
					mutatedThisTurn = true;
				}
				const result = applyTaskMutation(state, p.action, p);
				// setTodoState EMITE → el panel persistente re-renderiza (Remote React)
				// sin que el host tenga que publicar nada por separado.
				setTodoState(result.state);
				return buildToolResult(p.action, p, result.state, result.op);
			},
		});

		// Panel persistente: se monta al session_start (cuando hay UI) y vive hasta
		// session_shutdown. El componente se suscribe al store reactivo y se
		// re-renderiza ante cada mutation del tool.
		let panel: { unmount: () => void } | undefined;
		// clear-on-new-create: marca si ya hubo un action mutante (create/update/
		// delete/clear) en el turno actual. Se resetea en agent_start/session_start.
		// El primer mutante del turno, si es `create` y hay pendientes previas,
		// dispara la limpieza del plan anterior (ver execute).
		let mutatedThisTurn = false;

		pi.on("session_start", async (_event, ctx) => {
			// Reconstruir desde la rama (sobrevive recarga/switch/compaction).
			mutatedThisTurn = false;
			resetTodoState();
			setTodoState(replayFromBranch({ sessionManager: ctx.sessionManager }));
			panel = mountPanel(ctx, panel);
		});

		pi.on("session_compact", async (_event, ctx) => {
			// La rama cambió tras compactar → replay + reset del display state (no
			// sabemos qué estaba oculto en la rama compactada).
			setHiddenIds(new Set());
			setTodoState(replayFromBranch({ sessionManager: ctx.sessionManager }));
		});

		pi.on("agent_start", async () => {
			// Nueva corrida: reset del flag de clear-on-new-create — el primer mutante
			// de ESTE turno vuelve a poder disparar la limpieza del plan anterior.
			mutatedThisTurn = false;
			// Ocultar las tareas completadas de turnos anteriores (paridad con
			// rpiv-todo hideCompletedTasksFromPreviousTurn): al iniciar un nuevo
			// turno, las que ya están completed pasan a ocultas para reducir ruido.
			// Las que se completen en ESTE turno se muestran hasta el siguiente
			// agent_start. Una tarea descompletada (vuelve a in_progress) se vuelve a
			// ver: el filtro exige status==="completed" && hiddenIds.has(id).
			const completed = getTodoState()
				.tasks.filter((t) => t.status === "completed")
				.map((t) => t.id);
			setHiddenIds(new Set(completed));
		});

		pi.on("session_shutdown", async () => {
			panel?.unmount();
			panel = undefined;
			resetTodoState();
		});
	};
}

/** Monta (o re-monta) el panel si el ctx trae UI con fridaWebMount. */
function mountPanel(
	ctx: { hasUI: boolean; ui: unknown },
	current: { unmount: () => void } | undefined,
): { unmount: () => void } | undefined {
	if (!ctx.hasUI) return current;
	const ui = ctx.ui as unknown as Partial<FridaWebMountUI>;
	if (typeof ui?.fridaWebMount !== "function") return current;
	current?.unmount();
	// "footer": el panel vive en el footer del webview (entre proc-bar y Composer),
	// no como overlay en el cuerpo (que es para diálogos efímeros como ask_user_question).
	return ui.fridaWebMount(() => createTodoWebPanelElement(), "footer");
}
