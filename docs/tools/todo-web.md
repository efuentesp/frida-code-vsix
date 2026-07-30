# todo-web

> **Estado:** <!-- TODO -->

UI web (panel React) del tool [`todo`](./todo.md): renderiza la lista de tareas y su
progreso de forma reactiva.

> **Stub.** Sigue la [plantilla](./TEMPLATE.md); API marcada `<!-- TODO -->`.

## ¿Qué es?

El componente de presentación que consume el store reactivo de tareas
(`useSyncExternalStore`) y lo dibuja en el webview de Frida. Mismo patrón de "panel
web persistente" que `WorkflowPanel` y `ask-user-question-web`.

## ¿Cuándo usarla?

<!-- TODO: cuándo aporta frente a /todos en texto. -->

## Uso

- Visible mientras `frida.todo.enabled` esté activo (ver [todo](./todo.md)).

## API / DSL

<!-- TODO: el store (subscribe/getSnapshot), el componente React, y el puente
     host→webview. -->

## Integración con Frida

- Montado por el webBridge; alimenta del store de [todo](./todo.md).

## Ver también

- [todo](./todo.md) — el tool y su modelo.
- [ask-user-question-web](./ask-user-question-web.md) — patrón de UI web equivalente.

## Estado y madurez

<!-- TODO -->
