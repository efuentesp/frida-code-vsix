# ask-user-question-web

> **Estado:** <!-- TODO -->

Tool `ask_user_question` con **UI web**: el agente pregunta al usuario con opciones
estructuradas (multi-select, previews) en vez de adivinar o hacer preguntas abiertas.

> **Stub.** Sigue la [plantilla](./TEMPLATE.md); API marcada `<!-- TODO -->`.

## ¿Qué es?

Implementa el tool `ask_user_question` del SDK de Pi sobre el webview de Frida: el
agente plantea una pregunta con 2–4 opciones (cada una con etiqueta, descripción y,
opcionalmente, un *preview* rico), y el usuario responde desde el panel. El usuario
siempre puede escribir una respuesta libre o abandonar.

## ¿Cuándo usarla?

<!-- TODO: cuándo conviene que el agente pregunte con opciones vs. proseguir. -->

## Uso

- Setting `frida.askUserQuestion.enabled` (`true` por defecto) — aplica al recargar.
- Demo: **Frida: Demo WebQuestionnaire** (`frida.demoWebQuestionnaire`).

## API / DSL

<!-- TODO: el formato del tool (pregunta → opciones con label/description/preview,
     multiSelect, headers), cómo se renderiza en el webview, y el protocolo
     postMessage host↔webview. -->

## Configuración

| Clave | Tipo | Default | Descripción |
| --- | --- | --- | --- |
| `frida.askUserQuestion.enabled` | boolean | `true` | Habilita el tool. Aplica al recargar. |

## Integración con Frida

- Se monta como tool del `AgentSession`; la UI se sirve por el `webBridge` del panel.

## Ver también

- [README §Modo interactivo](../../README.md#modo-interactivo)
- [todo-web](./todo-web.md) — mismo patrón de UI web persistente.

## Estado y madurez

<!-- TODO -->
