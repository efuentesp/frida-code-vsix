# Extensión `frida-plan-mode`: modo `/plan` read-only colaborativo (porte de `@narumitw/pi-plan-mode`)

**Estado:** aceptado (#27).

## Contexto

Frida **ejecuta en cada turno** — edit, write, bash actúan de inmediato. Para cambios grandes o
arriesgados no hay un modo donde el agente **planea y propone sin ejecutar** hasta aprobación.
`frida-permission-system` aprueba por *tool/invocación*, no ofrece un **modo global read-only**.

[`@narumitw/pi-plan-mode`](https://pi.dev/packages/@narumitw/pi-plan-mode) añade un modo `/plan`
estilo Codex: colaboración read-only donde el agente devuelve un plan y la ejecución se desbloquea
tras aprobación.

## Decisión

**D1 — Extensión nativa `frida-plan-mode`.** El comando `/plan` activa un **modo de sesión
read-only** donde las tools mutantes (`edit`, `write`, `bash`) se desactivan o se sustituyen por
**propuestas**; el agente investiga y devuelve un plan.

**D2 — Transición plan → ejecución mediante aprobación explícita.** Reutiliza el `ApprovalBridge`
existente (ADR-0006, patrón de gates) para la aprobación plan→exec.

**D3 — Ortogonal a `frida-pipeline`.** El pipeline orquesta *skills procedurales*; plan-mode es un
**estado de sesión**. Se complementan: plan-mode puede alimentar los stages `discover`/`design`/
`plan` del pipeline.

**D4 — Cero conflicto.** Nuevo modo de interacción; no compite con `frida-permission-system` (eje
distinto: modo global vs. permiso por tool).

**D5 — Reutiliza infraestructura existente.** `ApprovalBridge` (ADR-0006) para la aprobación;
webview para mostrar el plan.

## Alternativas consideradas

- **A — Sólo `frida-permission-system`.** Descartado: permisos son por invocación, no un modo global
  read-only que cambie el comportamiento del turno entero.
- **B — Skill de pipeline.** Descartado: plan-mode es *estado de sesión*, no un procedimiento.

## Consecuencias

**Positivas**

- **Cambios grandes más seguros y predecibles**: el usuario revisa el plan antes de cualquier mutación.
- Reduce sorpresas en refactorings arriesgados.

**Negativas**

- Gestión del estado de modo en el webview (indicador visible de modo read-only).
- Integración con el ciclo de turnos (qué tools se desactivan vs. proponen).
- Decidir el formato del "plan" devuelto y cómo se materializa en ejecución aprobada.

## Referencias

- Issue **#27**.
- Upstream: <https://pi.dev/packages/@narumitw/pi-plan-mode> · <https://github.com/narumiruna/pi-extensions>
- Reutiliza: `ApprovalBridge` (ADR-0006).
- Complementa: `frida-pipeline` (stages discover/design/plan).
