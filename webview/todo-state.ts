import type { Turn } from "./types";

/**
 * Estado de tareas derivado del transcript (F5 P2, §5.4 AUTORIZADO):
 * el widget persistente del input-stack es la ÚNICA superficie del tool
 * `todo` — las filas del transcript no se renderizan. Módulo PURO (TDD):
 * pliega las entradas tool `todo` del transcript (args + result) con el
 * MISMO contrato de texto que src/tools/todo/response-envelope.ts
 * (`Created #N: subj (pending)` · `Updated #N (a → b)` · `[status] #id subj`).
 */

export interface TodoTask {
	id: number;
	subject: string;
	status: "pending" | "in_progress" | "completed";
	activeForm?: string;
}

export interface TodoSnapshot {
	tasks: TodoTask[];
	/** Label de la tarea en curso (activeForm si corre; si no, el subject). */
	current: string;
	done: number;
	total: number;
	/** true si hay un tool-call `todo` en vuelo (última entrada running). */
	anyRunning: boolean;
}

/** `[status] #id subject (activeForm)` por línea (acción `list`). */
const LIST_LINE = /^\[(pending|in_progress|completed|deleted)\] #(\d+) (.+?)(?: \(([^)]+)\))?$/;

/** `Created #N: subject (status)`. */
const CREATED_LINE = /^Created #(\d+): (.+?) \((pending|in_progress|completed)\)$/;

function parseList(result: string): TodoTask[] | null {
	const lines = result.split("\n").filter((l) => l.trim() !== "");
	if (lines.length === 0) return null;
	const tasks: TodoTask[] = [];
	for (const ln of lines) {
		const m = LIST_LINE.exec(ln);
		if (!m) return null; // formato inesperado → no es un list confiable
		const [, status, id, subject, activeForm] = m;
		if (status === "deleted") continue;
		tasks.push({
			id: Number(id),
			subject: subject.trim(),
			status: status as TodoTask["status"],
			activeForm: activeForm?.trim() || undefined,
		});
	}
	return tasks;
}

/** Pliega un tool-call `todo` completado sobre el estado. */
function apply(
	tasks: TodoTask[],
	args: Record<string, unknown>,
	result: string,
): TodoTask[] {
	const action = String(args.action ?? "");
	switch (action) {
		case "list": {
			const parsed = parseList(result);
			return parsed ?? tasks;
		}
		case "create": {
			const m = CREATED_LINE.exec(result.split("\n")[0] ?? "");
			if (!m) return tasks;
			const [, id, subject] = m;
			tasks.push({
				id: Number(id),
				subject: subject.trim(),
				status: "pending",
			});
			return tasks;
		}
		case "update": {
			const id = Number(args.id);
			const t = tasks.find((x) => x.id === id);
			if (!t) return tasks;
			if (typeof args.status === "string" && args.status !== "deleted")
				t.status = args.status as TodoTask["status"];
			if (typeof args.subject === "string") t.subject = args.subject;
			if (typeof args.activeForm === "string") t.activeForm = args.activeForm;
			return tasks;
		}
		case "delete": {
			const id = Number(args.id);
			return tasks.filter((t) => t.id !== id);
		}
		case "clear":
			return [];
		default:
			return tasks;
	}
}


/**
 * Snapshot derivado de TODOS los turnos (en orden cronológico). null cuando
 * no hay tareas → el widget no se monta.
 */
export function todoSnapshot(turns: Turn[]): TodoSnapshot | null {
	let tasks: TodoTask[] = [];
	let anyRunning = false;
	for (const turn of turns) {
		for (const seg of turn.segments) {
			if (seg.kind !== "tool" || seg.tool !== "todo") continue;
			if (seg.state === "running") {
				anyRunning = true;
				continue; // mutación en vuelo: no aplica aún
			}
			if (seg.state === "error") continue; // fallida: no muta
			anyRunning = false; // un todo terminado "limpia" el running anterior
			const args =
				typeof seg.args === "object" && seg.args !== null
					? (seg.args as Record<string, unknown>)
					: {};
			tasks = apply(tasks, args, typeof seg.result === "string" ? seg.result : "");
		}
	}
	const vis = tasks; // deleted jamás entra: create/list/update lo excluyen
	if (vis.length === 0) return null;
	const done = vis.filter((t) => t.status === "completed").length;
	const running = vis.find((t) => t.status === "in_progress");
	const lastDone = [...vis].reverse().find((t) => t.status === "completed");
	const currentTask = running ?? vis.find((t) => t.status === "pending") ?? lastDone;
	return {
		tasks: vis,
		current:
			currentTask && running
				? (running.activeForm ?? running.subject)
				: (currentTask?.subject ?? ""),
		done,
		total: vis.length,
		anyRunning,
	};
}
