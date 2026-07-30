# frida-context

> **Estado:** <!-- TODO -->

Tool de **auto-regulación del contexto**: ofrece al agente un snapshot de la presión
del contexto para que decida compactar/dividir antes de operaciones grandes.

> **Stub.** Este documento sigue la [plantilla](./TEMPLATE.md); las secciones de API
> están marcadas `<!-- TODO -->` para detallar.

## ¿Qué es?

Un tool que el agente puede invocar para medir cuánto contexto consume (tokens,
histórico, archivos adjuntos) y actuar en consecuencia. La **barra `ContextBar`**
(visible para el humano) siempre está presente; el tool (controlable con
`frida.context.enabled`) es el que el **agente** consulta para auto-regularse.

## ¿Cuándo usarla?

<!-- TODO: antes de tareas grandes, cuando el histórico crece, etc. -->

## Uso

- **`/context`** → snapshot puntual de la presión del contexto.
- Setting `frida.context.enabled` (`true` por defecto) — aplica al recargar
  (`/reload`). La `ContextBar` (humano) siempre visible independientemente.

## API / DSL

<!-- TODO: qué datos expone el snapshot (tokens usados/libres, desglose por
     mensaje/archivo), cómo lo consume el agente, formato del tool. -->

## Configuración

| Clave | Tipo | Default | Descripción |
| --- | --- | --- | --- |
| `frida.context.enabled` | boolean | `true` | Habilita el tool `context`. Aplica al recargar. |

## Integración con Frida

- La **ventana de contexto** se resuelve por prioridad (`GET /models` → catálogo →
  300 000), ver [ADR-0019](../adr/). Override con `frida.devengine.contextWindow`.

## Ver también

- [README §Context files](../../README.md#context-files)
- [ADR-0019](../adr/) — resolución de la ventana de contexto.

## Estado y madurez

<!-- TODO -->
