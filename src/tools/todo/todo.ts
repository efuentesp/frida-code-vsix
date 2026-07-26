// Factory de la extensión de Pi que registra el tool `todo` (ADR-0006: código
// propio en src/, no extensión ajena descubierta). Porte (MIT) de rpiv-todo
// `todo.ts` — sin overlay TUI (Frida no activa ExtensionUIContext; el panel lo
// renderiza el webview), sin i18n (pendiente, como ask_user_question) y sin
// comando /todos Pi (el host lo ataja como slash builtin del composer).
//
// El `execute` muta el holder en memoria (`src/todo-state.ts`) y devuelve el
// envelope con `details` = snapshot de replay. El host publica el estado al
// webview desde `tool_execution_end` (mismo conducto que el resto de tarjetas),
// así este factory es puro respecto a la UI.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { applyTaskMutation, type TaskState } from "./state-reducer";
import { buildToolResult } from "./response-envelope";
import { TodoParamsSchema, TOOL_LABEL, TOOL_NAME, type TaskAction, type TaskMutationParams } from "./types";
import { getTodoState, setTodoState } from "../../todo-state";

export const DEFAULT_PROMPT_SNIPPET = "Manage a task list to track multi-step progress";

export const DEFAULT_PROMPT_GUIDELINES: string[] = [
	"Use `todo` for complex work with 3+ steps, when the user gives you a list of tasks, or immediately after receiving new instructions to capture requirements. Skip it for single trivial tasks and purely conversational requests.",
	"When starting any task, mark it in_progress BEFORE beginning work. Mark it completed IMMEDIATELY when done — never batch completions. Exactly one task should be in_progress at a time.",
	"Never mark a task completed if tests are failing, the implementation is partial, or you hit unresolved errors — keep it in_progress and create a new task for the blocker instead.",
	"Task status is a 4-state machine: pending → in_progress → completed, plus deleted as a tombstone. Pass activeForm (present-continuous label, e.g. 'researching existing tool') when marking in_progress.",
	"Use blockedBy to express dependencies (A is blocked by B). On create, pass blockedBy as the initial set. On update, use addBlockedBy / removeBlockedBy (additive merge — do not resend the full array). Cycles are rejected.",
	"list hides tombstoned (deleted) tasks by default; pass includeDeleted:true to see them. Pass status to filter by a single status.",
	"Subject must be short and imperative (e.g. 'Research existing tool'); description is for long-form detail. activeForm is a present-continuous label shown while in_progress.",
];

export function createTodoTool() {
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
				const state: TaskState = getTodoState();
				const result = applyTaskMutation(state, p.action, p);
				setTodoState(result.state);
				return buildToolResult(p.action, p, result.state, result.op);
			},
		});
	};
}
