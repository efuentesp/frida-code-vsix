# Extensión `frida-background-tasks`: shell durable + watchers (porte de `pi-better-background-tasks`)

**Estado:** aceptado (#24).

## Contexto

Frida ejecuta `bash` **síncrono**: un build/watcher/test largo **bloquea el turno**. No hay forma de
"dejar corriendo" un proceso y consultarlo después. Los *workflow runs* (`frida-extensible-workflows`)
son orquestación de **agentes**, no tareas shell durables — overhead alto para un simple *watcher* de
tests.

[`pi-better-background-tasks`](https://pi.dev/packages/pi-better-background-tasks) ofrece tareas
shell **durables** en background con watchers, logs e inspección de estado; sobreviven al turno.

## Decisión

**D1 — Extensión nativa `frida-background-tasks`.** Tools agent-facing para lanzar/consultar/cancelar
tareas shell durables: `bg_start`, `bg_status`, `bg_logs`, `bg_tail`, `bg_kill` (nombres a afinar).

**D2 — Watchers.** Re-ejecución ante cambios de archivo (ej. re-corre tests al guardar), con logs
persistentes consultables.

**D3 — Durabilidad acotada al editor.** Sobreviven al turno, **no al cierre de VS Code** (Frida vive
en el editor). El límite de durabilidad se documenta explícitamente — a diferencia de un *daemon*
externo, aquí el proceso huésped es la extensión.

**D4 — Distinto a workflows y a bash.** No es orquestación de agentes (`frida-extensible-workflows`)
ni ejecución síncrona (`bash`). *Sinergia* con #20 (`frida-goal`): un agente autónomo podría delegar
tareas largas al background.

**D5 — Cero conflicto.** Nueva capacidad de ejecución no bloqueante.

## Alternativas consideradas

- **A — Reusar `parallel()` de workflows para tareas shell.** Descartado: los workflows orquestan
  *agentes*; overhead alto para un *watcher*.
- **B — `comando &` en bash.** Descartado: no durable, no consultable, no logs, zombies.

## Consecuencias

**Positivas**

- Ejecución **no bloqueante**: el agente y el usuario siguen trabajando mientras corre algo largo.
- Watchers habilitan flujos "reacciona al guardar".

**Negativas**

- Gestión de procesos/zombies y logs en disco.
- Límite de durabilidad (VS Code abierto).
- Coordinación con `frida-permission-system` para comandos de larga duración (¿se aprueban una vez?).

## Referencias

- Issue **#24**.
- Upstream: <https://pi.dev/packages/pi-better-background-tasks>
- Distinto de: `frida-extensible-workflows` (ADR implícito) — agentes, no shell.
- Sinergia: #20 (`frida-goal`, ADR-0031).
