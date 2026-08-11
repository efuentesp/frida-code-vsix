# Extensión `frida-refine`: *continual harness* refinement (`/refine`) sobre `frida-goal`

**Estado:** aceptado (issue #22; **bloqueado por #20 `frida-goal`**).

## Contexto

[`prime-agent`](https://github.com/PrimeIntellect-ai/prime-agent) es un *harness* completo construido
sobre `@earendil-works/pi-coding-agent`. La mayor parte **no es portable** a Frida: RLM (IPython
persistente, *prompt-as-a-variable*), daemon/worker/kernel, continuidad *detach/reattach* y
comunicación *agent-to-agent* son infraestructura que no encaja en una extensión VS Code
single-session. Tampoco hay un *feature* de *traces → RL*: ese bucle vive en la plataforma Prime
externa (Verifiers/Prime-RL), no en el agente.

La **única pieza con valor incremental real** es **`/refine` (Continual Harness)**. Leído en
`packages/coding-agent/src/core/refinement/refinement.ts`: `/refine` toma **la trayectoria actual**

+ el estado del *harness* + el historial de refinamientos previos, y aplica **ediciones pequeñas con
evidencia** a un store editable de **4 tipos de componentes**:

+ patrones de delegación repetidos → **subagent specs** reutilizables
+ procedimientos repetidos → **skills**
+ *facts/preferences* durables → **memories**
+ políticas de comportamiento estrechas → **prompt addendums** (el **system prompt base es
  inmutable**)

Con **historial versionado** y **`/refine rollback <id>`**. Local por defecto, `global` para
lecciones cross-session.

La pregunta de diseño es **dónde colocarlo**. Hay dos candidatos naturales: sobre `frida-goal`
(#20) o como parte de `frida-hermes-memory` (#21).

## Decisión

**D1 — Extensión nativa `frida-refine` montada sobre `frida-goal` (#20).** No es un workflow (es
*refinement* agent-driven post-trayectoria, necesita acceso a la sesión principal) ni parte de #21
(es refinamiento **deliberado** post-*goal*, distinto de la **captura pasiva** de hechos de hermes).
Módulo: `src/tools/frida-refine/`.

**D2 — Bloqueada por #20.** `/refine` reutiliza la base que `frida-goal` establece — estado
persistente en la sesión principal, mecanismo de inyección de contexto y eventos del lifecycle
(`agent_settled`/`agent_end`, prerequisito D2 de #20). Además, **la trayectoria más rica para
refinar es la de un *goal* autónomo completado** (larga, estructurada, con éxito/fallo verificable),
no la de un turno suelto. La secuencia natural es: usuario persigue un *goal* → frida-goal lo
completa → `/refine` destila esa trayectoria en componentes reutilizables. **No inicia hasta que #20
esté implementado y validado e2e.**

**D3 — 4 componentes del harness, system prompt inmutable, rollback.** El *continual harness state*
almacena *subagent specs*, *skills*, *memories* y *prompt addendums*. El *system prompt base* **no
se reescribe nunca**; sólo se añaden *prompt addendums* suplementarios. Cada refinamiento queda en un
historial versionado con `/refine rollback <id>`.

**D4 — Sinergia (no duplicación).** El componente *memories* se integra con el store de
`frida-hermes-memory` (#21) cuando esté disponible (no bloqueante; store propio hasta entonces). Los
*skills* y *subagent specs* son descubribles por el sistema de skills de Frida
(`frida-multi-skills`/`frida-pix-skills`), sin duplicar su gestión.

**D5 — Cero conflicto.** El comando `/refine` y el *harness state* son superficie **nueva**, no
duplicada.

### Por qué sobre `frida-goal` y no sobre `frida-hermes-memory`

+ `/refine` revisa una **trayectoria**; la trayectoria más rica la produce un *goal* autónomo
  (`frida-goal`). `frida-hermes-memory` (#21) es **captura pasiva** de *facts/failures*, no genera
  trayectorias estructuradas.
+ `/refine` añade los **2 componentes que #21 no cubre** — *subagent specs* y *prompt addendums* —
  cuyo dominio natural es el del **agente autónomo** (#20), no el de la memoria de hechos (#21).
+ Comparte con #20 el mismo sustrato (estado persistente + inyección en sesión principal); con #21
  comparte sólo el componente *memories* (integración, no dependencia).

## Alternativas consideradas

+ **A — Workflow sobre `frida-extensible-workflows`.** **Descartada**: `/refine` es *refinement*
  agent-driven post-trayectoria que necesita acceso a la sesión principal y a su trayectoria; el
  worker aislado y procedural de los workflows no lo permite.
+ **B — Parte de `frida-hermes-memory` (#21).** **Descartada** (decisión del usuario): aunque toca
  el componente *memories*, `/refine` es refinamiento **deliberado post-*goal***, no captura pasiva;
  su sustrato y su trayectoria de entrada provienen de `frida-goal`, no del store de memoria.
  Mezclarlo con #21 acoplaría dos dominios distintos y retrasaría #21.
+ **C — Porte completo de prime-agent / RLM.** **Descartado**: RLM (IPython persistente) y daemon
  son una re-arquitectura del runtime no portable a Frida; el resto del harness es infraestructura
  que no aplica.

## Consecuencias

**Positivas**

+ **Valor incremental único**: *subagent specs* + *prompt addendums* + *rollback versionado* — nada
  de eso lo cubren #20 ni #21.
+ **Reutiliza la base de #20** en vez de construir infraestructura nueva.
+ **Sinergias** con #21 (*memories*) y con el sistema de skills.

**Negativas**

+ **Dependencia bloqueante #20**: no puede iniciar hasta que `frida-goal` esté validado e2e.
+ **Porte del refinement engine** (~`core/refinement/refinement.ts`) y adaptación al SDK/Frida.
+ **Gobernanza**: snapshots/rollback correctos (no corromper ni perder el *harness*).
+ **Coordinación** con el sistema de skills y con `frida-goal` (acceso a la trayectoria).
+ **Mantenimiento**: seguir el upstream de prime-agent.

## Referencias

+ Issue **#22** (este trabajo).
+ **#20 `frida-goal`** (ADR-0031) — dependencia bloqueante; sustrato reutilizado.
+ **#21 `frida-hermes-memory`** (ADR-0032) — integración del componente *memories*.
+ ADR-0030 — contraste: patrones procedurales → capa sobre workflows.
+ Upstream: <https://github.com/PrimeIntellect-ai/prime-agent> (`/refine`, Continual Harness).
