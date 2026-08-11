# Posicionamiento de Frida frente a Factory Missions (multi-agent que "actually ships")

**Tipo:** nota de investigación (no requiere acción de implementación).
**Fecha:** 2026-08-11.
**Fuente:** charla *"The Multi-Agent Architecture That Actually Ships — Luke Alvoeiro, Factory"* (youtube `ow1we5PzK-o`, ~72 min).
**Transcripción:** extraída vía `yt-dlp` + sesión Brave + `--remote-components` (ver ADR-0049 para el método).
**Cierra la trilogía:** `graph-engineering-parity.md` (barra alta, gap #18) → `sdlc-antigravity-parity.md` (barra baja, sin gaps) → esta nota (alineación arquitectónica fuerte).

## Resumen

Luke Alvoeiro (Factory, ex-Goose/Block) describe **Missions**, su arquitectura
multi-agente para correr **días**. Tesis: el cuello de botella no es la
inteligencia, es la **atención humana** — un humano decide *qué* construir y el
sistema averigua *cómo* y corre asíncrono. Arquitectura de **3 roles**
(orchestrator / workers / validators), **validation contract** (aserciones
pre-código, independientes de la implementación), **handoffs estructurados**,
**ejecución serial con paralelización interna de solo-lectura**, y el **bitter
lesson**: casi toda la orquestación en prompts/skills (~700 líneas), NO en una
state machine hard-coded; lógica determinística delgada (sólo bookkeeping).

**Veredicto:** Frida está **arquitectónicamente alineado** con el enfoque que
"actually ships" — el speaker aboga por el modelo bitter-lesson que Frida **ya
implementa**. Los primitivos de los 3 roles y la ejecución serial+parallel son
core hoy. Los gaps (routing de modelo por rol #18→#19; lifecycle multi-día async
# 20/#24; user-testing validator empaquetado) ya están en el roadmap (ADR-0046
Nivel 2/3).

## Mapeo Factory Missions → Frida

| Concepto Factory | Equivalente Frida | Estado |
| --- | --- | --- |
| **Arquitectura "bitter lesson"** (orquestación en texto/skills, lógica determinística delgada, NO state machine) | `frida-extensible-workflows` — el ADW es un script; primitivas delgadas (shell/checkpoint/parallel) | ✅ STRONG MATCH — Frida ES este modelo |
| Delegación (sub-agentes) | `frida-subagents` + workflow `agent()` | ✅ MATCH |
| Creator-verifier (contexto fresco, adversarial) | patrón detached-auditor (#19) + #26 detached | ✅ MATCH |
| Comunicación directa (sin coordinador) | Frida NO la hace (coordinación central vía workflow) | ✅ ALINEADO (speaker la desaconseja) |
| Broadcast (estado compartido) | `args`/`log()`/`phase()` del workflow + `RunStore` | ✅ MATCH |
| **Worker: contexto limpio + commit por git** | workflow `agent()` + `withWorktree()` + git commit (#13) — el siguiente hereda base limpia | ✅ MATCH exacto |
| Orchestrator (planifica + validation contract) | workflow ADW hoy / #20 frida-goal (reactivo, bloqueado) | 🟡 PARCIAL |
| Scrutiny validator | detached-auditor (#19) + `verify`/`judge` DSL | ✅ MATCH |
| **User-testing validator** (computer use, clicks) | `frida-agent-browser` (piezas existen, no empaquetado) | 🟡 PARCIAL |
| Validation contract (aserciones pre-código) | patrón (#19); `verify`/`assess` DSL | ✅ MATCH (como patrón) |
| Handoffs estructurados | patrón; `agent({schema})` = #19 G1 (bloqueado) | 🟡 PARCIAL |
| **Serial + parallel de solo-lectura** | secuencial `agent()` + `parallel()` para reads — primitivas exactas | ✅ MATCH exacto |
| Mission control (vista: %, budget, worker activo) | WorkflowPanel + #36 kanban; budget necesita #18 | 🟡 PARCIAL (#7, #36, #18) |
| **Modelo correcto por rol** ("droid whispering") | #19 G2 tier routing — bloqueado por #18 | ❌ GAP (recurrente) |
| Model-agnostic (distintos proveedores) | Frida multi-provider (sesión); por-nodo = #19/#18 | 🟡 PARCIAL |

## Hallazgos clave

1. **La mejor validación externa del diseño de Frida.** El speaker aboga por la
   arquitectura "bitter lesson" (orquestación en texto/skills, lógica
   determinística delgada, NO state machine). **Eso es exactamente Frida**
   (ADR-0028). Factory tuvo que *llegar* a esa conclusión; Frida *nació* con ella.
   Los matchings exactos — worker = `withWorktree()`+commit, serial+`parallel()`
   de reads, verificador fresco = detached-auditor — son core hoy.

2. **Valida ADR-0046 (Loop Engineering como arquitectura de referencia).** Factory
   Missions = el "Nivel 2/3 continuo/reactivo" que ADR-0046 describe: 3 roles,
   serial, validation contracts, handoffs, multi-día. Frida hoy está en "Nivel 1
   (one-shot)".

3. **El gap recurrente en los 3 videos = routing de modelo por rol (#18 → #19).**
   El speaker lo llama "droid whispering": planning=razonamiento lento,
   impl=fluidez, validación=precisión; distintos proveedores por rol = ventaja
   estructural. Frida usa un solo modelo hoy; tier routing = #19 G2 bloqueado por
   #18 (token accounting).

## Los gaps (2 + 1 empaquetado)

1. **Modelo correcto por rol (#18 → #19)** — gap recurrente de la trilogía. Tier
   routing bloqueado por #18 (presupuestos por rol exigen contabilizar tokens).

2. **Lifecycle async/reactivo para misiones multi-día** — Factory corre días con
   el humano fuera; Frida es foreground/on-demand. Necesita: **#20** frida-goal
   (reactivo, bloqueado por hooks) + **#24** background-tasks (shell durable) +
   mission control (**#36** kanban + **#18** budget). Esto es **ADR-0046 Nivel
   2→3**; cuello de botella = #24.

3. **User-testing validator empaquetado** — `frida-agent-browser` ya hace computer
   use (screenshots/clicks/eval); falta empaquetarlo como workflow de validación de
   comportamiento (territorio de #19).

## Camino a "Missions" real

```text
#18 (token accounting) → #19 G2 (tier routing = modelo por rol)   ← gap recurrente
#24 (background-tasks, shell durable) ← cuello de botella ADR-0046 Nivel 2
#20 (frida-goal, reactivo) ← bloqueado por hooks de lifecycle
#19 + frida-agent-browser → user-testing validator empaquetado
#36 (kanban) + #18 → mission control
```

## Conclusión

Frida está **arquitectónicamente alineado con el enfoque que "actually ships"**.
El speaker describe el modelo bitter-lesson que Frida ya implementa; los
primitivos de los 3 roles y la ejecución serial+parallel son core hoy. El camino a
Missions real = **desbloquear #18 (→#19 routing por rol) + #24/#20 (lifecycle
multi-día async) + empaquetar el user-testing validator (#19)**. Todo está en el
roadmap (ADR-0046 Nivel 2/3); esta charla es la **prueba externa más fuerte** de
que la dirección de Frida es correcta.

## Síntesis de la trilogía de videos

| Video | Barra | ¿Gap revelado? | Acción |
| --- | --- | --- | --- |
| Graph Engineering (`H7t3uUp3HVw`) | Alta (grafos multi-nodo) | ❌ routing de modelo por nodo (#18→#19) | Desbloquear #18 |
| Antigravity SDLC (`K3YYr6yauAw`) | Baja (SDLC lineal) | Ninguno | Componer flujos (#19/#16) |
| **Factory Missions (`ow1we5PzK-o`)** | Alta (multi-día async) | ❌ routing por rol (#18→#19) + lifecycle async (#20/#24) | ADR-0046 Nivel 2/3 |

**Constante:** el gap técnico recurrente en los 3 videos es **#18** (token
accounting), que desbloquea el routing de modelo por nodo/rol — la capacidad más
enfatisada en los dos videos de barra alta.

## Referencias

- Fuente: charla *"The Multi-Agent Architecture That Actually Ships"* (youtube `ow1we5PzK-o`).
- Notas complementarias: `graph-engineering-parity.md` · `sdlc-antigravity-parity.md`.
- ADR-0028 — `frida-extensible-workflows` (script determinista = modelo bitter-lesson).
- ADR-0046 — Loop Engineering como arquitectura de referencia (Factory Missions = Nivel 2/3).
- ADR-0030 — `frida-dynamic-workflows` (capa de patrones #19: auditor, factory-router).
- Issues críticos: **#18** (token accounting) · **#24** (background-tasks, cuello) · **#20** (frida-goal) · **#13** (worktree) · **#36** (kanban).
