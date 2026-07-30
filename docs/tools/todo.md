# todo

> **Estado:** <!-- TODO -->

Tool `todo` + panel de **Tareas**: seguimiento multi-paso del trabajo del agente, con
un panel reactivo que muestra el progreso (pendiente → en curso → completada).

> **Stub.** Sigue la [plantilla](./TEMPLATE.md); API marcada `<!-- TODO -->`.
> La UI web vive en [todo-web](./todo-web.md).

## ¿Qué es?

El equivalente Frida de la lista de tareas de la TUI de Pi/rpiv: el agente crea,
actualiza y completa tareas; un store reactivo (`useSyncExternalStore`) alimenta el
panel de Tareas para que el humano vea el progreso en vivo.

## ¿Cuándo usarla?

<!-- TODO: trabajos de 3+ pasos, listas explícitas del usuario, etc. -->

## Uso

- **`/todos`** → imprime la lista agrupada por estado (lee el store reactivo).
- Setting `frida.todo.enabled` (`true` por defecto) — aplica al recargar.

## API / DSL

<!-- TODO: la API del tool (create/update/list/get/delete/clear), el modelo de
     estados (pending/in_progress/completed/deleted), dependencias (blockedBy),
     y cómo se persiste. -->

## Configuración

| Clave | Tipo | Default | Descripción |
| --- | --- | --- | --- |
| `frida.todo.enabled` | boolean | `true` | Habilita el tool `todo` y el panel. Aplica al recargar. |

## Integración con Frida

- Tool del `AgentSession` + store reactivo consumido por el [panel web](./todo-web.md).

## Ver también

- [todo-web](./todo-web.md) — la UI del panel.
- [README §Slash commands](../../README.md#slash-commands) — `/todos`.

## Estado y madurez

<!-- TODO -->
