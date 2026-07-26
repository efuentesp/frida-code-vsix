// Tipos, identidad y schema del tool `todo`.
//
// Porte (bajo licencia MIT) de @juicesharp/rpiv-todo (su `tool/types.ts`),
// adaptado a Frida: en lugar de `StringEnum` de `@earendil-works/pi-ai` (que
// aquí es dependencia anidada no expuesta) se usa `Type.Union([Type.Literal])`,
// que genera el mismo JSON schema `enum` que ve el modelo. Proveniencia:
// github.com/juicesharp/rpiv-mono · packages/rpiv-todo.
//
// El nombre del tool ("todo") es la CLAVE de persistencia para el replay
// (filtra `toolResult.toolName === "todo"`) — NO renombrar.

import { type Static, Type } from "typebox";

export const TOOL_NAME = "todo";
export const TOOL_LABEL = "Todo";
export const COMMAND_NAME = "todos";

export const MSG_NO_TODOS = "Aún no hay tareas. Pídele al agente que agregue algunas.";

// ---------------------------------------------------------------------------
// Tipos de dominio públicos
// ---------------------------------------------------------------------------

export type TaskStatus = "pending" | "in_progress" | "completed" | "deleted";

export type TaskAction = "create" | "update" | "list" | "get" | "delete" | "clear";

export interface Task {
	id: number;
	subject: string;
	description?: string;
	activeForm?: string;
	status: TaskStatus;
	blockedBy?: number[];
	owner?: string;
	metadata?: Record<string, unknown>;
}

/**
 * Snapshot de persistencia + replay. Cada llamada exitosa al tool devuelve este
 * shape bajo `details`; `replay.ts` lee el último de la rama para reconstruir
 * el estado. Nombres y orden de campos fijados por compatibilidad de replay.
 * (Paridad con rpiv-todo `TaskDetails`.)
 */
export interface TaskDetails {
	action: TaskAction;
	params: Record<string, unknown>;
	tasks: Task[];
	nextId: number;
	error?: string;
}

/** Bag de input abierto que acepta el reducer. */
export interface TaskMutationParams {
	[key: string]: unknown;
	subject?: string;
	description?: string;
	activeForm?: string;
	status?: TaskStatus;
	blockedBy?: number[];
	addBlockedBy?: number[];
	removeBlockedBy?: number[];
	owner?: string;
	metadata?: Record<string, unknown>;
	id?: number;
	includeDeleted?: boolean;
}

// ---------------------------------------------------------------------------
// Schema TypeBox — los `description` son copy que lee el LLM.
// ---------------------------------------------------------------------------

const actionEnum = Type.Union(
	[Type.Literal("create"), Type.Literal("update"), Type.Literal("list"), Type.Literal("get"), Type.Literal("delete"), Type.Literal("clear")],
);
const statusEnum = Type.Union(
	[Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("completed"), Type.Literal("deleted")],
);

export const TodoParamsSchema = Type.Object({
	action: actionEnum,
	subject: Type.Optional(Type.String({ description: "Task subject line (required for create)" })),
	description: Type.Optional(Type.String({ description: "Long-form task description" })),
	activeForm: Type.Optional(
		Type.String({
			description: "Present-continuous spinner label shown while status is in_progress (e.g. 'writing tests')",
		}),
	),
	status: Type.Optional(
		statusEnum,
	),
	blockedBy: Type.Optional(
		Type.Array(Type.Number(), {
			description: "Initial blockedBy ids (create only)",
		}),
	),
	addBlockedBy: Type.Optional(
		Type.Array(Type.Number(), {
			description: "Task ids to add to blockedBy (update only, additive merge)",
		}),
	),
	removeBlockedBy: Type.Optional(
		Type.Array(Type.Number(), {
			description: "Task ids to remove from blockedBy (update only, additive merge)",
		}),
	),
	owner: Type.Optional(Type.String({ description: "Agent/owner assigned to this task" })),
	metadata: Type.Optional(
		Type.Record(Type.String(), Type.Unknown(), {
			description: "Arbitrary metadata; pass null value for a key to delete that key on update",
		}),
	),
	id: Type.Optional(
		Type.Number({
			description: "Task id (required for update, get, delete)",
		}),
	),
	includeDeleted: Type.Optional(
		Type.Boolean({
			description: "If true, list action returns deleted (tombstoned) tasks as well. Default: false.",
		}),
	),
});

export type TodoParams = Static<typeof TodoParamsSchema>;
