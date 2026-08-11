# Factibilidad de AiDD (BMAD Method) sobre la infraestructura de Frida

**Tipo:** nota de investigación (no requiere acción de implementación).
**Fecha:** 2026-08-11.
**Pregunta:** ¿Es factible implementar el enfoque AiDD de BMAD sobre la infraestructura de Frida, asumiendo que TODAS las extensiones planeadas están desarrolladas y probadas? ¿Qué piezas habría que construir?
**Fuentes:** [`bmad-code-org/BMAD-METHOD`](https://github.com/bmad-code-org/BMAD-METHOD) · [`bmad-code-org/bmad-loop`](https://github.com/bmad-code-org/bmad-loop) · [`bmad-code-org/bmad-method-ui`](https://github.com/bmad-code-org/bmad-method-ui) + video `iW86sMHszJw` (nota `bmad-loop-parity.md`).

## TL;DR — veredicto

**SÍ es factible, y sería MÁS simple que la implementación de BMAD Loop.** La razón
estructural: BMAD Loop existe como orquestador **externo** que drivar agentes de
codificación (claude/codex/gemini/copilot/antigravity/opencode) vía TMux, y gran
parte de su complejidad (adapters, pane-scraping, hooks de `Stop`/`SessionStart`,
multiplexer backends) es **impuesto por ser externo**. Frida **ES** el harness — ya
tiene acceso nativo a sesiones, artefactos y estado, así que ese "impuesto del
orquestador externo" no aplica. El loop determinista de BMAD (`pick story →
implement → adversarially review → verify → commit`) es **literalmente el modelo
ADW de `frida-extensible-workflows`** (confirmado por el docstring de `engine.py`:
*"The engine never edits sprint-status.yaml or spec files; it re-reads them to
decide and verify. All creative work happens inside disposable adapter sessions."*).

Asumiendo todas las extensiones planeadas (#16 skills/plugins, #18 tokens, #19
patrones, #20 goal, #21 hermes, #24 bg-tasks, #27 plan-mode, #29 knowledge-base,
# 34 advise, #36 kanban, #13 worktree) **ya construidas**, lo que falta es:

- **1 paquete de contenido** (skills de metodología — portable, bajo riesgo).
- **1 sub-capacidad** (resolver de customización 3-capas — pertenece a #16).
- **5 patrones/modelos de datos nuevos** (deferred-work, sweep, sprint-status,
  dev-contract, baseline-commit "lie detector").
- **1 meta-workflow** (`frida-aidd-loop` que encadena plan→ship→loop).

**Ninguno requiere infraestructura fundamental nueva** fuera del roadmap planeado.
Todo es contenido + patrones sobre las extensiones planeadas.

## Qué es AiDD y cómo se compone BMAD

**AiDD = "Agile AI-Driven Development"** = una metodología spec-first donde el
LLM implementa sobre especificaciones buenas (menos iteración, mejor validación),
orquestrada por un loop determinista. BMAD la implementa como **4 capas
separadas**:

| Capa | Repo | Rol | Tecnología |
| --- | --- | --- | --- |
| **Metodología (skills)** | `BMAD-METHOD` | prompts/agentes/flujos | Markdown + TOML |
| **Installer** | `BMAD-METHOD` (`tools/installer`) | copia skills al proyecto según IDE | JS (npx) |
| **Loop determinista** | `bmad-loop` | orquesta dev/review/verify/commit | Python |
| **UI** | `bmad-method-ui` | panel + webview | VS Code ext (React) |

**La metodología es skill-based.** Los agentes (analyst Mary, PM John, architect
Winston, dev, ux) y los flujos (plan: product-brief → prd → prfaq → ux →
architecture → epics-and-stories → sprint-planning → spec; ship: build →
code-review → retrospective) son **archivos markdown `SKILL.md`** con frontmatter,
cada uno con un `customize.toml` para personalización. Un `module.yaml` define el
roster de agentes, las carpetas de artefactos (planning/implementation/project-knowledge)
y variables.

## Mapeo BMAD Loop → Frida (asumiendo roadmap completo)

| Pieza BMAD Loop (`src/bmad_loop/`) | Función | Cobertura Frida (planeada) | ¿Gap? |
| --- | --- | --- | --- |
| `engine`/`machine`/`statemachine` | loop determinista | `frida-extensible-workflows` (ADW) | ✅ |
| `adapters/` (tmux, psmux, opencode, multiplexer) | drivar agentes externos | **N/A — Frida ES el harness** | ✅ (más simple) |
| `probe`, hooks `Stop`/`SessionStart`, pane-scraping | extraer estado de sesión | **N/A — acceso nativo** | ✅ (más simple) |
| `escalation`/`resolve`/`recovery_flow` | halt → sesión nueva → resume | `checkpoint()` + `workflow_retry`/`workflow_resume` | ✅ nativo |
| `gates`/`checks`/`verify` | verificación determinista | detached-auditor (#19) + patrón verify | ✅ (+ patrón) |
| `deferredwork` | split / defer / continue | patrón | ⚠️ **NUEVO** |
| `sweep` | triage ledger / empaqueta / resuelve | patrón | ⚠️ **NUEVO** |
| `sprintstatus` | single-source-of-truth, writer never-regress | modelo de datos + writer | ⚠️ **NUEVO** |
| `devcontract` | frozen-spec enforcement | patrón + policy | ⚠️ **NUEVO** |
| `worktree_flow` | worktrees por story | `frida-worktree` (#13) + `withWorktree()` | ✅ |
| `tokens` | token tracking por nodo | **#18** | ✅ (prereq) |
| `policy` | allow/deny | `frida-permission-system` | ✅ |
| `plugins/` (bus/loader/trust/registry/manifest) | sistema de plugins | **#16** | ✅ (prereq) |
| `tui/` (dashboard, screens, widgets) | panel de observabilidad | **#36 kanban** + panel de workflow existente | ✅ |
| `journal`/`runs`/`runsetup` | log + lifecycle | `RunStore` | ✅ |
| `stories_engine` | story → spec → dev → review | patrón workflow | ✅ |
| `decisions` | registro de decisiones | `RunStore` + ADRs | ✅ |
| Skills (plan+ship+agents) | la metodología | **#16** + porte de contenido | ⚠️ **CONTENIDO** |
| Customization resolver (merge defaults→team→user) | personalización de agentes | sub-capacidad de **#16** | ⚠️ **sub-cap** |
| Installer (copiar skills según IDE) | distribución | Frida empaqueta skills (sin installer) | ✅ (más simple) |

**4 de las filas marcadas "N/A — más simple" son el hallazgo central:** toda la
capa de adapters/probes/hooks de BMAD Loop existe únicamente porque es un
orquestador externo. Frida, al ser el harness, no la necesita.

## Piezas a construir (gaps reales más allá del roadmap)

Asumiendo todas las extensiones planeadas desarrolladas y probadas, hay que
construir **8 piezas**. Se agrupan en 3 categorías; ninguna requiere
infraestructura fundamental nueva.

### Categoría A — Contenido portable (1 pieza, bajo riesgo)

1. **`frida-aidd` skill pack.** Portear las skills de metodología de BMAD como
   skills de Frida (asumiendo que #16 carga skills markdown con frontmatter):
   - **Plan:** product-brief, prd, prfaq, ux, architecture, epics-and-stories,
     sprint-planning, spec.
   - **Ship:** build, code-review, retrospective.
   - **Agentes:** analyst, PM, architect, dev, ux-designer (con sus personas).
   - Son prompts/markdown — porteo directo, bajo riesgo. BMAD es MIT-licensed.

### Categoría B — Sub-capabilidad de una extensión planeada (1 pieza)

1. **Resolver de customización 3-capas** (pertenece a #16). El mecanismo de merge
   `defaults → team → user` (escalares sobreescriben, tablas deep-merge, arrays
   keyed by `code`/`id` reemplazan + append) que BMAD usa para personalizar
   agentes sin tocar el original. **Debe diseñarse dentro de #16**, no como
   extensión separada.

### Categoría C — Patrones y modelos de datos nuevos (6 piezas)

1. **Deferred-work engine.** Inteligencia de split: si una story hace A,B,C,
   ¿puede continuar con C diferida? Si sí, difiere C y continúa. = patrón
   workflow + artefacto `deferred-work-ledger` (bajo `implementation-artifacts/`).
   Implementable con `iterate`/`fanin` del DSL de workflows (#19).

2. **Sweep engine.** Al final de un epic (o on-demand): triagea el ledger de
   deferred-work, empaqueta lo resolvible según el estado del sprint, lo ejecuta,
   repite (con tope de iteraciones). = patrón workflow sobre el ledger (#19).

3. **Sprint-status single-source-of-truth.** Modelo de datos
   `sprint-status.yaml` + un **writer idempotente never-regress** (único writer:
   la skill de dev; el orquestador solo re-lee para decidir y verificar). Es una
   propiedad de corrección sutil: el motor nunca escribe el estado, solo lo lee.

4. **Dev-contract / frozen-spec enforcement.** Marcar un spec como "congelado" y
   bloquear modificaciones durante el dev loop. = patrón + policy
   (`frida-permission-system`).

5. **Baseline-commit "lie detector".** Registrar el commit baseline de forma
   independiente y verificar el diff contra él tras cada sesión (detecta cuando
   el LLM afirma haber hecho algo que no hizo). = patrón verify (detached-auditor
   #19) — barato y de alto valor.

6. **`frida-aidd-loop` meta-workflow.** El orquestador end-to-end que encadena
   plan → ship → loop como un workflow de Frida. **Este es el equivalente nativo
   de BMAD Loop.** Compone las skills (#16), worktrees (#13), detached-auditor
   (#19), deferred-work + sweep (#3/#4), sprint-status (#5), y expone el panel
   (#36). Es la pieza de integración — no infraestructura nueva, composición.

## La decisión de "envolver vs reimplementar"

Hay dos caminos para "hacer AiDD sobre Frida":

- **(A) Porteo nativo** — reimplementar los PATRONES de AiDD sobre la
  infraestructura de Frida (skills como skills de Frida, loop como workflow).
  **Viable y recomendada.** Frida es el harness, así que se evita el impuesto del
  orquestador externo.
- **(B) Envolver BMAD Loop** — correr `bmad-loop` como herramienta externa que
  "driva" Frida. **NO viable**: BMAD Loop drivar CLIs de codificación (claude,
  codex…) vía TMux; Frida es una extensión VS Code, no un CLI de codificación.
  Ningún adapter de BMAD Loop hablaría con Frida.

Por tanto el camino es **(A): porteo nativo de patrones**, no envoltura. Esto es
consistente con toda la serie de investigación (Factory, Antigravity, BMAD Loop):
Frida ya tiene el orquestador determinista; lo que falta es la capa de
metodología + los patrones específicos.

## Veredicto de factibilidad

**FACTIBLE.** Con el roadmap planeado completo:

- La **infraestructura dura** (loop determinista, worktrees, resume, skills,
  plugins, token tracking, kanban, permission system, subagentes detached) está
  100% cubierta por extensiones ya planeadas.
- El "impuesto del orquestador externo" (adapters TMux, probes, hooks de sesión,
  pane-scraping) **no aplica** a Frida porque Frida es el harness — esto hace la
  implementación **más simple** que BMAD Loop.
- Lo que falta es **contenido (skills) + patrones específicos + 1 meta-workflow**:
  8 piezas, todas sobre las extensiones planeadas, ninguna infraestructura
  fundamental nueva.

**Dependencias críticas (prerequisitos del roadmap):**

- **#16 (skills/plugins)** — sin esto, no hay dónde cargar la metodología. Y debe
  incluir el resolver de customización 3-capas (#2).
- **#18 (tokens)** — el gap recurrente de la serie; BMAD Loop tiene `tokens.py`
  explícito. Sin contabilidad de tokens, el loop no puede budgetar por story.
- **#19 (patrones: detached-auditor + los 5 nuevos)** — la capa donde viven
  deferred-work, sweep, sprint-status, dev-contract, lie-detector.

## Riesgos y notas

- **Riesgo de licencia/attribution:** BMAD es MIT — el porteo es legalmente limpio,
  pero hay que preservar atribución. La metodología (prompts) es reescribible; no
  es necesario copiar literal.
- **Riesgo de "single-source-of-truth never-regress":** es la propiedad más sutil
  (sprint-status.yaml con un único writer idempotente). Requiere cuidado en el
  diseño — si múltiples writers, el loop pierde determinismo.
- **Riesgo de drift metodológico:** BMAD se mueve rápido (early beta, breaking
  changes pre-1.0). Un porteo nativo debe ser una **adaptación** de los conceptos,
  no un mirror línea-por-línea que se vuelve obsoleto.
- **No es una extensión nueva en el roadmap.** `frida-aidd` sería un **skill pack
  - meta-workflow que COMPONE** extensiones existentes, no una nueva extensión
  horizontal (consistente con la política de no redundancia: AiDD reusa
  frida-worktree, workflows, #16, #18, #19, #36). Si se quisiera abrir issue,
  sería "skill pack AiDD" dependiente de #16/#18/#19, no una extensión
  independiente.

## Conclusión

AiDD sobre Frida es factible y resulta en una implementación **más limpia** que
BMAD Loop porque Frida elimina el impuesto del orquestador externo (no necesita
TMux, adapters, probes ni pane-scraping). La infraestructura determinista ya está
planeada en el roadmap (`frida-extensible-workflows` = el motor, + worktree +
resume + skills + plugins + tokens + kanban). Lo que falta es la **capa de
metodología** (skills portables) + **5 patrones específicos** (deferred-work,
sweep, sprint-status never-regress, dev-contract, lie-detector) + **1
meta-workflow** que los componga. Esta nota refuerza la conclusión de toda la
serie de investigación: Frida tiene la arquitectura correcta; el desbloqueador
sigue siendo **#18** (token accounting, prereq del loop) y **#16** (skills, prereq
de la metodología).

## Referencias

- Repos: [`BMAD-METHOD`](https://github.com/bmad-code-org/BMAD-METHOD) · [`bmad-loop`](https://github.com/bmad-code-org/bmad-loop) · [`bmad-method-ui`](https://github.com/bmad-code-org/bmad-method-ui).
- Nota previa: `bmad-loop-parity.md` (video `iW86sMHszJw`).
- Serie: `graph-engineering-parity.md` · `sdlc-antigravity-parity.md` · `factory-missions-parity.md` · `adlc-boundary.md` · `bmad-loop-parity.md`.
- Issues críticos: **#16** (skills/plugins — prereq metodología) · **#18** (tokens — prereq loop, gap recurrente) · **#19** (patrones — donde viven los 5 nuevos).
- ADR-0028 — `frida-extensible-workflows` (= el motor del loop) · ADR-0046 — Loop Engineering como arquitectura de referencia · ADR-0013 — `frida-worktree`.
