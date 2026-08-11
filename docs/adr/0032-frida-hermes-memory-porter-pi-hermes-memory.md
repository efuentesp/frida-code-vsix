# Porte nativo de `pi-hermes-memory` como extensión `frida-hermes-memory` (no workflow)

**Estado:** aceptado (issue #21).

## Contexto

Se busca que el agente **aprenda de los aciertos y errores de múltiples sesiones** para mejorar su
razonamiento. Hay dos enfoques complementarios —contrastados en el análisis previo y en el
comparativo *"Prime Agent VS Hermes"*:

- **Enfoque Hermes** (Nous Research / `pi-hermes-memory`): *self-improvement a nivel de agente en
  runtime*. El aprendizaje ocurre en **memoria + skills** que el agente curte sin tocar el modelo
  (background learning, correction detection, skill creation, cross-session recall, consolidación).
- **Enfoque Prime** (PrimeIntellect): *self-improvement a nivel de modelo*. El aprendizaje ocurre
  **afinando los pesos** con RL/LoRA a partir de traces y evals ("turn production traces into the
  next training run"). Requiere GPUs y training infra.

Solo el **enfoque Hermes** está al alcance de una extensión de agente: el Prime es infraestructura
de entrenamiento (ninguna extensión de pi lo proporciona, y portearlo a Frida no tiene sentido).

[`pi-hermes-memory`](https://github.com/chandra447/pi-hermes-memory) es, de hecho, un **porte del
propio Hermes Agent** a pi. Su mecanismo es **tools + hooks del lifecycle**, no procedural:

- **Tools** en la sesión: `memory_write`/`memory_read`/`memory_search`, `scratchpad` y la tool
  nativa `skill_manage`.
- **Hooks del lifecycle**: *background learning* cada 10 turnos / 15 tool calls, *correction
  detection* (guarda al instante al corregir al agente) e **inyección de contexto antes de cada
  turno** (memoria relevante → system prompt, con snapshot KV-cache-estable).
- **Storage**: `MEMORY.md` (facts), `USER.md` (perfil), `SKILL.md` (procedimientos); two-tier global
  - por proyecto; *session search* vía SQLite FTS5; *secret scanning*; *auto-consolidation*.

Frida **no tiene hoy memoria cross-session de aprendizaje**: cada sesión arranca limpia salvo el
contexto vivo. La pregunta de diseño es si esto se emula ampliando `frida-extensible-workflows` o si
se porta como extensión nativa.

## Decisión

**D1 — Extensión nativa `frida-hermes-memory`, no workflow.** Se porte `pi-hermes-memory` como un
módulo nativo `src/tools/frida-hermes-memory/`. Su naturaleza (tools + hooks del lifecycle:
captura al final de turno, inyección de contexto antes de turno) **no encaja** en la VM sandbox
aislada y procedural de `frida-extensible-workflows`. Como en `frida-goal` (ADR-0031), requiere
acceso a los eventos y al system prompt de la sesión principal.

**D2 — Prerequisito: punto de *context injection* antes de turno.** Frida ya reemite `turn_end`
(suficiente para el contador de *background learning* y la detección de correcciones), pero hay que
**confirmar/exponer un punto de inyección de contexto** en el system prompt antes de cada turno,
con snapshot KV-cache-estable (como hace el upstream). Es trabajo de integración, análogo al
`agent_settled`/`agent_end` de `frida-goal`.

**D3 — Sinergia con el sistema de skills de Frida (no duplicación).** Los `SKILL.md` procedurales
que el agente crea ("cómo lo resolví") deben vivir en el **mismo store** que `frida-multi-skills` /
`frida-pix-skills` ya leen, y ser descubribles vía la tool `skill_manage` nativa. Así el aprendizaje
procedural **alimenta el sistema de skills existente** en vez de competir con él.

**D4 — Adaptación de storage y UI al shell de VS Code.** Rutas `~/.pi/agent/` → `~/.frida/`;
SQLite FTS5 (ya en uso en `session-stats`/`usage/indexer`); comandos `/memory-*` → comando + paleta
de VS Code (no menú TUI de pi).

**D5 — Cero conflicto.** La superficie que `frida-hermes-memory` registra (tools `memory_*` +
comandos `/memory-*`) es **nueva**, no duplicada. La coordinación con skills (D3) es **sinergia**
(mismo store), no colisión.

**D6 — Ortogonal a #7 y #18.** No depende del panel de workflow (#7) ni del token-accounting de
workflows (#18): tiene su propio storage y su propio loop de aprendizaje. (A diferencia de #19, que
sí exige #7/#18 resueltos.)

### Capacidades de Frida hoy vs. lo que falta

| Pieza que pi-hermes-memory necesita | Frida |
| --- | --- |
| Registrar tools | ✅ |
| `turn_end` (contador de turnos) | ✅ ya reemitido |
| **Punto de *context injection* antes de turno** | ⚠️ prerequisito (D2) |
| Storage en disco | ✅ `~/.frida/` |
| SQLite FTS5 | ✅ ya en uso |
| Sistema de skills (`SKILL.md` descubribles) | ✅ sinergia (D3) |

## Alternativas consideradas

- **A — Workflow que emula el loop de aprendizaje sobre `frida-extensible-workflows`.** Un script
  procedural. **Descartada** por *mismatch*: el worker aislado no recibe `turn_end` (no puede contar
  turnos para *background learning*), no puede inyectar contexto en el system prompt de la sesión
  principal antes de cada turno, y no observa las correcciones del usuario en la conversación
  principal. El agente que "aprende" es la sesión principal con su contexto acumulado, no
  subagentes efímeros.
- **B — Enfoque Prime (RL/LoRA) como extensión.** **Descartada**: es infraestructura de
  entrenamiento (GPUs, evals, fine-tuning), no una extensión de agente. Ninguna extensión de pi lo
  hace; portearlo a Frida no aplica.

## Consecuencias

**Positivas**

- **Cierra un gap grande**: memoria cross-session de aprendizaje (hoy inexistente en Frida).
- **Reutiliza** piezas presentes: `turn_end`, SQLite FTS5, `~/.frida/`.
- **Sinergia con skills**: el aprendizaje procedural alimenta el sistema de skills existente (D3).
- **Patrón Frida**: porte nativo coherente con `frida-goal`, `frida-worktree`, etc.

**Negativas**

- **Porte sustancial**: 732 tests en el upstream.
- **Prerequisito D2**: exige exponer un punto de *context injection* antes del MVP.
- **Coordinación con skills**: los `SKILL.md` generados deben convivir con el store de
  `frida-multi-skills` sin duplicar gestión.
- **Mantenimiento**: seguir el upstream de `pi-hermes-memory`.

## Referencias

- Issue **#21** (este trabajo).
- ADR-0031 — `frida-goal`: misma forma de porte (extensión nativa reactiva al lifecycle); aquí el
  prerequisito es *context injection* en vez de `agent_settled`.
- ADR-0030 — contraste: los patrones de `pi-dynamic-workflows` son **procedurales** → capa sobre
  workflows; el learning loop de Hermes es **tools+lifecycle** → extensión nativa.
- Upstream: <https://github.com/chandra447/pi-hermes-memory>.
