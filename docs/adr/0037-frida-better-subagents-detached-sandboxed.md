# Extensión `frida-better-subagents`: subagentes detached/sandboxed (porte de `pi-better-subagents`)

**Estado:** aceptado (#26).

## Contexto

Frida ya tiene `frida-subagents`, pero los subagentes pueden **bloquear la sesión principal**
(*foreground*) mientras corren. No hay forma de que el usuario **siga trabajando** mientras un
subagente ejecuta una tarea larga en paralelo.

[`pi-better-subagents`](https://pi.dev/packages/pi-better-subagents) ofrece subagentes **detached y
sandboxed** que corren en background **liberando el foreground**.

## Decisión

**D1 — Extiende `frida-subagents` (no módulo nuevo).** Se añade un modo **detached**: el subagente
corre en background sin bloquear el foreground; el usuario continúa su trabajo.

**D2 — Sandboxed.** Aislamiento del subagente (contexto independiente, ya existente en subagents; se
refuerza el aislamiento de ejecución).

**D3 — Resultados asíncronos.** El subagente devuelve un *handle*; la recuperación del resultado es
no bloqueante (consulta/aviso al completar).

**D4 — Coordina con #18 (token accounting).** Los detached **también consumen tokens** y deben
contabilizarse en el `usage` del workflow/sesión — no pueden quedar fuera del presupuesto. *Sinergia*
con `frida-extensible-workflows` (`parallel()` ya es detached en workflows; esto lo lleva a
subagentes ad-hoc fuera de un workflow).

**D5 — Extiende, no reemplaza.** Compatibilidad hacia atrás: los subagentes síncronos actuales
siguen disponibles.

## Alternativas consideradas

- **A — Módulo nuevo separado.** Descartado: duplica `frida-subagents`.
- **B — Reusar sólo `parallel()` de workflows.** Descartado: overhead de orquestación para
  subagentes ad-hoc sueltos.

## Consecuencias

**Positivas**

- **Foreground libre** — el usuario no espera al subagente.
- Paralelismo real para el usuario (no sólo dentro de workflows).

**Negativas**

- Complejidad de concurrencia y presentación de resultados asíncronos en el webview.
- **Contabilidad de tokens** (#18) — debe cubrir los detached.
- UX: cómo se muestra el estado/progreso de un subagente detached.

## Referencias

- Issue **#26**.
- Upstream: <https://pi.dev/packages/pi-better-subagents>
- Extiende: `frida-subagents`.
- Coordina con: **#18** (token accounting) — `Refs #18`.
- Sinergia: `frida-extensible-workflows` (`parallel()`).
