# Paridad de Frida con "Graph Engineering" (Claude Code)

**Tipo:** nota de investigación (no requiere acción de implementación).
**Fecha:** 2026-08-11.
**Fuente:** video *"Graph Engineering — the Anthropic fix"* (youtube `H7t3uUp3HVw`, ~57 min).
**Transcripción:** extraída vía `yt-dlp` + sesión Brave + `--remote-components` (ver ADR-0049 para el método).

## Resumen

El video describe **Graph Engineering** como evolución del Loop Engineering: una
tarea se divide en **nodos** (agentes con contexto aislado) conectados por **edges**
(flujo de datos), en formas como el **diamante** (fan-out → fan-in) y el
**fan-out/fan-in con barrera** (juzgar desde varios ángulos; nada avanza hasta que
todos reportan). El problema central: *un error se propaga y no ves qué lo causó*.
La solución es **verificación**: skills `verify`, `code-review`, `second-opinion`
(sesión fresca vía `-P`), chaining (review+simplify+verify+design) y un
**orchestrator skill** que corre todo en paralelo. Insight titular: *«el nodo que
juzga es donde ahorrar tokens te cuesta todo»* → correr el juez en el modelo más
fuerte (Opus).

**Veredicto:** Frida logra **~85% del video HOY**; el resto está planeado. El único
gap crítico es el **routing de modelo por nodo**, bloqueado por **#18**.

## Mapeo Claude Code → Frida

| Capacidad del video | Equivalente Frida | Estado |
| --- | --- | --- |
| **Motor de grafos** (nodos/edges, diamante, barrera fan-in) | `frida-extensible-workflows` (`parallel()`/`pipeline()`/`agent()`) | ✅ MATCH — el runtime ES el motor de grafos |
| `verify` skill (comportamiento start-to-finish) | DSL workflow `verify`/`judge`/`assess` + patrón **detached-auditor** (#19) | ✅ MATCH |
| Tool chaining (corre tests, lee errores, fix) | `bash` + `lsp_diagnostics` + `lens_diagnostics` (pi-lens) | ✅ MATCH (más rico que Claude) |
| `code-review` skill (estándares) | patrón **#19 code-review** + skill `code-review` existente | ✅ MATCH |
| Review multi-ángulo ("thermonuclear") | **#19 adversarial-review** + detached-auditor | ✅ MATCH |
| `second-opinion` (sesión fresca, sin contexto, `-P`) | `frida-subagents` Agent (contexto aislado) + detached-auditor | ✅ MATCH — el subagente ES la segunda opinión |
| Skill standalone (review profundo manual) | skills disponibles (`code-review`, `tdd`, `diagnosing-bugs`…) | ✅ MATCH |
| **Orchestrator skill** (reviews paralelos → 1 reporte) | `parallel()` + converge (el runtime del workflow) | ✅ MATCH — esto es literalmente `frida-extensible-workflows` |
| Skill chaining (review+simplify+verify+design) | #19 patrones + **#22 refine** (produce skills) + **#29 KB** (design.md) | ✅ MATCH |
| Browser testing (Chrome/screenshots) | `frida-agent-browser` | ✅ MATCH |
| Skill embedded (auto-fire en workflow) | verificación explícita en ADW (workflow=sí); reactiva en chat = hooks #20/#21 | 🟡 PARCIAL |
| Skill creator (skills probados) | `frida-pipeline` scaffolding + **#16** sistema de skills | 🟡 PLANEADO |
| Visibilidad (qué pasó / qué causó el error) | `RunStore` + WorkflowPanel + **#36 kanban** | 🟡 PARCIAL (#7 bug, #36 planeado) |
| **Routing de modelo por nodo (juez en Opus)** | **#19 G2 tier routing — bloqueado por #18** | ❌ GAP (el titular) |

## Hallazgos clave

1. **La arquitectura de Frida es el modelo correcto.** El video valida que
   «workflow = grafo» y «subagente = nodo aislado» son exactamente las primitivas
   correctas. El motor (`frida-extensible-workflows`), la segunda opinión
   (`frida-subagents`), el orchestrator (`parallel()`+converge) y el browser testing
   (`frida-agent-browser`) — todo **MATCH directo**.

2. **El gap único y crítico es el titular del video.** Frida hoy usa **un solo
   modelo** (el de la sesión) para todos los agentes del workflow. El video insiste:
   *el nodo que juzga es donde ahorrar tokens te cuesta todo* → el juez debe correr
   en el modelo más fuerte, y los nodos triviales en el barato. Esto exige **tier
   routing** (#19 G2), que está **bloqueado por #18 (token accounting)** — porque
   enrutar modelos por nodo requiere presupuestos de tokens por agente.

3. **El resto del gap es planificado, no imposible.** Skills embedded reactivas y el
   skill creator dependen de #16 (sistema de skills) + #20/#21 (lifecycle hooks),
   todos en el roadmap.

## Camino crítico hacia paridad plena

```text
#18 (token accounting)              ← EL DESENCADENANTE
   └─ #19 G2 (tier routing = modelo por nodo)   ← paridad con el titular del video
        └─ #19 completo (review/auditor con routing de modelo)

#7  (panel intermitente)            ← operacional, también bloquea #19
#16 (sistema de skills)             ← skill creator + skills embedded
#20/#21 (lifecycle hooks)           ← skills embedded reactivas en el chat principal
```

## Conclusión

**¿Podría Frida conseguir lo mismo que Claude Code (según este video)? → Sí.** La
arquitectura ya lo contempla y el roadmap cubre los faltantes. El único bloqueador
**técnico** real para paridad plena es **#18** (contabilización de tokens), que
desbloquea el routing de modelos por nodo — la capacidad que el video enfatiza como
la más importante. El video es, además, una **validación externa** de las decisiones
arquitectónicas de Frida (ADW determinista como grafo, subagentes como nodos
aislados, verificación detached).

## Referencias

- Fuente: video *"Graph Engineering — the Anthropic fix"* (youtube `H7t3uUp3HVw`).
- ADR-0028 — `frida-extensible-workflows` (runtime base = motor de grafos).
- ADR-0030 — `frida-dynamic-workflows` (capa de patrones: code-review, adversarial,
  auditor detached, factory-router). Issue **#19** (bloqueado por #7 y #18).
- ADR-0022 — `frida-subagents` (segunda opinión / nodo aislado).
- ADR-0046 — Loop Engineering como arquitectura de referencia (precedente conceptual).
- Issues críticos: **#18** (token accounting) · **#7** (panel) · **#16** (skills).
