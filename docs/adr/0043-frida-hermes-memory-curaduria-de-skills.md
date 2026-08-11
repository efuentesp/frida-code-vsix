# Extensión de `frida-hermes-memory`: curaduría de skills (friction-logging + revisión)

**Estado:** aceptado (#32). **Bloqueado por #21** (Hermes debe implementarse, validarse e2e y
demostrar valor antes de extenderlo).

## Contexto

El meta-skill [`task-observer`](https://skills.sh/rebelytics/one-skill-to-rule-them-all/task-observer)
("One Skill to Rule Them All", CC BY 4.0) ofrece un loop de **mejora continua de la librería de
skills**: capturar fricción notada durante el trabajo real + revisión periódica con triage
(mejorar / simplificar / eliminar). Su tesis —"las skills mejoran mejor desde la fricción notada en
trabajo real que sentándose a 'mejorar una skill'"— es metodológicamente sólida.

Un análisis de cobertura contra el roadmap planeado de Frida muestra que es **~70% redundante**:

| Capacidad de task-observer | Cubierta por |
| --- | --- |
| Capturar fricción durante el trabajo | `#21 Hermes` (background learning cada 10 turns) |
| Log de observaciones → skills | `#21` (`skill_manage` + `SKILL.md`) · `#22 Refine` (skills = 1 de 4 outputs) |
| Candidatos a nuevo skill | `#22 Refine` |
| Mejorar skills existentes | `#22` + `#21` |
| **Revisión/triage de skills (OPEN/ACTIONED/DECLINED)** | — (gap) |
| **Simplificar skills** ("¿qué quitar?") | — (gap) |
| Principios *cross-cutting* | — (gap menor) |

El **30% distinto** —el loop de curaduría/revisión + el eje de simplificación— no está cubierto. La
decisión es **NO incluir task-observer como skill/extensión separada** (rompería la dicotomía
Hermes/Refine y duplicaría storage) sino **plegar ese 30% en `#21 Hermes`**, que ya es dueño de
`skill_manage` + background learning.

**Condición de precedencia:** no se extiende un sistema no probado. Esta extensión **sólo se inicia
tras** que `#21` esté implementado, validado e2e por el usuario, y haya demostrado valor en uso real.

## Decisión

**D1 — Extensión de `#21 frida-hermes-memory`, no nueva extensión.** Aumenta Hermes con una capacidad
de **curaduría de skills**. Reutiliza su store y sus hooks; no crea superficie nueva independiente.

**D2 — Friction-logging continuo.** Durante el trabajo, registrar observaciones de skills
(Issue → Mejora → Principio) **en el store existente de Hermes** (MEMORY.md/SKILL.md, SQLite FTS5),
reutilizando su hook de background learning. **No crea un `skill-observations/log.md` paralelo** —
evita el storage duplicado que tendría task-observer. La captura es **silenciosa y log-and-defer**:
se registra para la próxima revisión, no se actúa en sesión salvo petición explícita.

**D3 — Revisión periódica de curaduría con triage.** Lifecycle `OPEN`/`ACTIONED`/`DECLINED` sobre las
observaciones, con tres ejes:

- **Mejorar** — añadir reglas/clarificaciones a skills existentes (reutiliza `skill_manage`).
- **Simplificar** (eje de **primera clase**) — "¿qué podemos quitar?": secciones nunca relevantes, reglas
  de una sola observación no validada, flujos que el usuario consistentemente shortcuttea, complejidad
  *just-in-case* que nunca dispara, y reglas que el agente falla consistentemente (→ convertirlas a
  enforcement estructural — checklist/paso de verificación/tool call inskippable — o removerlas).
- **Eliminar** — skills obsoletas (nuevo tooling vuelve un paso innecesario).

**D4 — Principios *cross-cutting*.** Cuando una observación revele un principio aplicable a varias
skills, proponerlo como principio transversal en el store de Hermes (no documentarlo dentro de una sola
skill).

**D5 — Hard gate: bloqueado por #21.** Esta extensión sólo arranca tras: (1) `#21` implementado
(incluido su prereq de exponer el hook de *context injection* antes del turn); (2) validación e2e del
usuario; (3) evidencia de valor en uso real. Hasta entonces, **no se toca código**.

**D6 — Distinción con `#22 Refine` (cero solapamiento).** Hermes (+ esta extensión) = captura
**pasiva continua** + curaduría periódica. Refine = destilación **on-demand** (`/refine` revisa una
trayectoria → subagent-specs/skills/memories/prompt addendums). Uno observa continuamente; el otro
destila a pedido.

**D7 — Cero conflicto.** Aumenta `#21` ortogonalmente. No toca a `#22` ni al sistema de skills
(`#16`). Mientras esté bloqueado, es pura decisión documentada.

## Alternativas consideradas

- **A — Instalar/portar `task-observer` como skill/extensión separada.** Descartado: 70% redundante
  con `#21`/`#22`; duplica storage (log paralelo); rompe la dicotomía Hermes (pasivo) / Refine
  (on-demand).
- **B — Plegar en `#22 Refine`.** Descartado: Refine es destilación on-demand post-trayectoria; la
  curaduría es pasiva y continua → su hogar natural es Hermes (que ya tiene `skill_manage` + background
  learning).
- **C — Plegar en `#16` (sistema de skills).** Descartado: `#16` es infraestructura de carga/gestión,
  no un loop de aprendizaje.

## Consecuencias

**Positivas**

- Captura el 30% distinto de task-observer **sin redundancia** (un solo sistema de aprendizaje).
- El eje de **simplificación** reduce deuda de skills (complejidad muerta acumulada).
- Reutiliza el store y hooks de Hermes — sin superficie nueva.

**Negativas**

- Aumenta el scope de `#21` (pero **sólo tras validación** — D5).
- El loop de revisión añade complejidad al background learning de Hermes.

## Referencias

- Issue **#32** (bloqueado por **#21**).
- Base: **#21 `frida-hermes-memory`** (ADR-0032).
- Inspiración descartada como porte: `task-observer` (rebelytics, CC BY 4.0).
- Distinto de: **#22 `frida-refine`** (ADR-0033, destilación on-demand).
