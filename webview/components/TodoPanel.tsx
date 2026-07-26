// Panel persistente de Tareas (tool `todo`) mostrado en el footer, entre el
// indicador de procesamiento (proc-bar) y la caja de texto (Composer).
// Refleja el estado publicado por el host (post {type:"todos"}). Auto-oculto
// cuando no hay tareas. Equivalente visual al overlay "aboveEditor" de la TUI
// de rpiv-todo, pero aquí en el webview (el host no activa ExtensionUIContext).
//
// Glifos: ○ pendiente · ◐ en progreso · ✓ completada. La tarea en progreso se
// destaca y su activeForm aparece entre paréntesis.

import type { TodoTask } from "../types";

const GLYPH: Record<TodoTask["status"], string> = {
  pending: "○",
  in_progress: "◐",
  completed: "✓",
};

export function TodoPanel({ todos }: { todos: { tasks: TodoTask[]; nextId: number } }) {
  const tasks = todos.tasks;
  if (tasks.length === 0) return null;

  const completed = tasks.filter((t) => t.status === "completed").length;
  const hasActive = tasks.some((t) => t.status === "in_progress" || t.status === "pending");

  return (
    <div className="todo-panel">
      <div className="todo-head">
        <span className={"todo-head-icon" + (hasActive ? " active" : "")}>{hasActive ? "●" : "○"}</span>
        <span className="todo-head-label">Tareas</span>
        <span className="todo-head-count">
          ({completed}/{tasks.length})
        </span>
      </div>
      <ul className="todo-list">
        {tasks.map((t) => (
          <li key={t.id} className={"todo-item " + t.status}>
            <span className="todo-glyph">{GLYPH[t.status]}</span>
            <span className="todo-subject">{t.subject}</span>
            {t.status === "in_progress" && t.activeForm && <span className="todo-form">({t.activeForm})</span>}
            {t.blockedBy && t.blockedBy.length > 0 && (
              <span className="todo-blocks">⛓ {t.blockedBy.map((id) => `#${id}`).join(",")}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
