# Extensión `frida-relay`: corrección gobernada de creencias (porte del *Relay* de `@remnic/plugin-pi`) como aumento de `frida-hermes-memory`

**Estado:** aceptado (#28; **bloqueado por #21 `frida-hermes-memory`**).

## Contexto

`frida-hermes-memory` (#21, ADR-0032) cubre las 9 capacidades de un sistema de memoria de
aprendizaje, PERO su **corrección de creencias (capacidad G) es débil**: detecta, pero no gobierna
con evidencia, aprobación ni verificación.

El levantamiento de la Parte B sobre el catálogo de pi mostró que **`@remnic/plugin-pi`** es la única
extensión con un **ángulo superior a Hermes** ahí: **Remnic Relay**, un *loop* de corrección
gobernada. El resto del catálogo de memoria (pi-memory, goosedump, context-mode, red-skills) es más
débil o de otro eje. Relay expone la **creencia *stale*** tras un fallo, la conecta con el fallo
verificable (*evidence X-Ray*), propone un *diff* antes/después, lo somete a **aprobación humana**,
preserva la creencia vieja como ***superseded*** y **verifica que un agente nuevo aprendió la
corrección** sin *handoff*.

## Decisión

**D1 — Extensión nativa `frida-relay` que aumenta `frida-hermes-memory` (#21).** No es un *workflow*
(necesita acceso a la sesión principal, lifecycle hooks y el store de memoria) ni un reemplazo de

# 21. **Reutiliza el store de memoria de #21** — no crea un store nuevo. Módulo: `src/tools/frida-relay/`

**D2 — Bloqueada por #21.** Relay se apoya en el **store de memoria + inyección de contexto +
lifecycle hooks** que `frida-hermes-memory` establece, y refuerza su capacidad más débil (G). **No
inicia hasta que #21 esté implementado y validado e2e.**

**D3 — El *loop* Relay:** (1) detección de creencia *stale* tras fallo; (2) *evidence X-Ray* (conecta
la memoria recordada con el fallo verificable); (3) *diff* antes/después de la memoria; (4)
**aprobación humana** (reutiliza `ApprovalBridge`, ADR-0006); (5) ***supersession*** (la creencia vieja
se preserva como *superseded*, con trazabilidad); (6) **verificación en agente nuevo** (un agente
nuevo, sin *handoff*, recuerda la corrección y vuelve verde el mismo test).

**D4 — Reutiliza el store de #21, sin duplicación.** Distingue de #22 (`frida-refine`):

- **Relay (#39)** = **corrección** de creencias/hechos *stale* (algo estaba MAL → se arregla con
  prueba + governance + verificación).
- **Refine (#22)** = **destilación** de patrones repetidos en *skills/subagent-specs/prompt-addendums*
  (algo se repitió → se extrae reutilizable).

Ambos tocan *memories* de #21 en ejes distintos; comparten el store, no se duplican.

**D5 — Cero conflicto.** Los tools de corrección y el *loop* Relay son superficie nueva. Reutiliza
`ApprovalBridge` (ADR-0006) y el store de #21.

## Alternativas consideradas

- **A — Reemplazar #21 por Remnic completo.** Descartado: Remnic carece de *secret scanning*,
  *skills* procedurales, *auto-consolidación* y *two-tier* proyecto; Hermes es más completo.
  Reemplazar duplicaría infraestructura y perdería capacidades.
- **B — Construir Relay dentro de #21 (sin issue separado).** Descartado (decisión del usuario): se
  quiere un issue separado con dependencia explícita, como #22 sobre #20 — #21 debe existir y probarse
  antes de añadir la capa de corrección gobernada.
- **C — Hacer Relay como *workflow*.** Descartado: necesita acceso a la sesión principal, lifecycle
  hooks y el store de memoria; el worker aislado y procedural de los *workflows* no lo permite.

## Consecuencias

**Positivas**

- **Cierra el gap más débil de Hermes (G)** con *governance* + verificación: corrección confiable y
  auditable de creencias *stale*.
- **Reutiliza** el store de #21 y `ApprovalBridge` — poca infraestructura nueva.
- **Complementario** a #22 (corrección vs. destilación).

**Negativas**

- **Dependencia bloqueante #21** (y su prereq de lifecycle hooks / *context injection*).
- Porte del engine Relay (*evidence X-Ray*, *supersession*, verificación en agente nuevo).
- **Verificación en agente nuevo**: definir cómo lanzar un agente nuevo en Frida (`frida-subagents` /
  sesión nueva) de forma reproducible.
- Coordinación con el store de #21 (concurrencia de correcciones).

## Referencias

- Issue **#28**.
- **#21 `frida-hermes-memory`** (ADR-0032) — dependencia bloqueante; store + lifecycle reutilizados.
- **#22 `frida-refine`** (ADR-0033) — complementario (corrección vs. destilación).
- Reutiliza: `ApprovalBridge` (ADR-0006).
- Upstream: <https://pi.dev/packages/@remnic/plugin-pi> · <https://github.com/joshuaswarren/remnic>
