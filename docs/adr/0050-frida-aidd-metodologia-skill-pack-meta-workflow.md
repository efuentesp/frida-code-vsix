# `frida-aidd`: metodología AiDD como skill pack + meta-workflow nativo

**Estado:** aceptado (#38). Bloqueado por **#16** (skills/plugins), **#18** (tokens),
**#19** (patrones de workflow).

## Contexto

La investigación *"Factibilidad de AiDD (BMAD Method) sobre la infraestructura de
Frida"* (`docs/research/aidd-bmad-feasibility.md`) exploró el ecosistema completo
de BMAD: `BMAD-METHOD` (skills markdown + installer JS), `bmad-loop` (orquestador
Python determinista, ~80 módulos) y `bmad-method-ui` (extensión VS Code).

**AiDD = "Agile AI-Driven Development"** = metodología spec-first (el LLM implementa
sobre especificaciones buenas → menos iteración, mejor validación) orquestrada por
un loop determinista. BMAD la implementa en 4 capas: metodología (skills),
installer (JS), loop (Python), UI (extensión VS Code).

**Hallazgo central del `engine.py` de bmad-loop:** *"The deterministic control loop.
Per story: dev session → artifact verification → bounded review loop → deterministic
verify commands → orchestrator commit. The engine never edits sprint-status.yaml or
spec files; it re-reads them to decide and verify. All creative work happens inside
disposable adapter sessions."* — Este loop es **literalmente el modelo ADW de
`frida-extensible-workflows`** (creator-verifier, orquestación determinista fuera
del LLM, subagentes desechables con contexto fresco).

Buena parte de la complejidad de bmad-loop — adapters (tmux/psmux/opencode/multiplexer),
pane-scraping, hooks de `Stop`/`SessionStart`/`SessionEnd`/`PreCompact` — existe
únicamente porque es un **orquestador externo** que drivar agentes de codificación
(claude/codex/gemini/copilot/antigravity/opencode) vía TMux. Frida **ES** el
harness: tiene acceso nativo a sesiones, artefactos y estado → ese "impuesto del
orquestador externo" no aplica.

## Decisión

**D1 — AiDD se implementa como skill pack + meta-workflow que COMPONE extensiones
existentes.** NO es una nueva extensión horizontal. `frida-aidd` reusa
`frida-worktree` (#13), `frida-extensible-workflows` (motor del loop),
`frida-permission-system`, y las extensiones planeadas **#16** (skills/plugins),
**#18** (tokens), **#19** (patrones), **#36** (kanban). Consistente con la
política de no redundancia.

**D2 — Porteo nativo de patrones (camino A), no envoltura de bmad-loop (camino B).**
B no es viable: bmad-loop drivar **CLIs** de codificación vía TMux; Frida es una
extensión VS Code, no un CLI. Ningún adapter de bmad-loop hablaría con Frida. Se
reimplementan los **patrones** de AiDD sobre la infraestructura nativa de Frida.

**D3 — La infraestructura dura ya está en el roadmap.** El motor del loop
(`frida-extensible-workflows`), los worktrees (#13), el resume (`workflow_retry`/
`workflow_resume`), la carga de skills (#16), el sistema de plugins (#16), el
token tracking (#18), el panel de observabilidad (#36) y el permission system
cubren el equivalente funcional de bmad-loop **sin** la capa de adapters/probes
externos.

**D4 — Ocho piezas a construir, ninguna infraestructura fundamental nueva:**

| # | Pieza | Categoría | Vive en |
| --- | --- | --- | --- |
| 1 | `frida-aidd` skill pack (prd, arch, epics, stories, spec, build, code-review, retrospective + 5 agentes) | Contenido portable (BMAD MIT) | skill pack |
| 2 | Resolver de customización 3-capas (defaults→team→user) | Sub-capabilidad | **#16** |
| 3 | Deferred-work engine (split / defer non-blocking / continue) | Patrón nuevo | **#19** |
| 4 | Sweep engine (triage ledger → empaqueta → resuelve → repite) | Patrón nuevo | **#19** |
| 5 | Sprint-status single-source-of-truth + writer never-regress | Modelo de datos nuevo | meta-workflow |
| 6 | Dev-contract / frozen-spec enforcement | Patrón + policy | **#19** + permission |
| 7 | Baseline-commit "lie detector" (verifica diff vs commit baseline) | Patrón verify | **#19** |
| 8 | `frida-aidd-loop` meta-workflow (encadena plan → ship → loop) | Integración | workflows |

**D5 — Cero conflicto.** `frida-aidd` es composición pura: lee skills (#16),
orquesta con workflows, aísla con worktree (#13), verifica con detached-auditor
(#19), observa con kanban (#36). No duplica ninguna capacidad horizontal.

## Alternativas consideradas

- **A — Envolver bmad-loop como herramienta externa.** Descartado: bmad-loop
  drivar CLIs de codificación (claude, codex…) vía TMux; Frida es una extensión
  VS Code, no un CLI. Ningún adapter de bmad-loop hablaría con Frida.
- **B — Nueva extensión horizontal `frida-aidd`.** Descartado: viola la política
  de no redundancia. AiDD es composición de capacidades ya planeadas (worktree,
  workflows, skills, tokens, kanban), no una capacidad nueva.
- **C — Solo la metodología (skills) sin el loop determinista.** Descartado: sin
  el loop, AiDD degrada a "vibe coding con prompts buenos" — el valor de AiDD es
  precisely el loop determinista (software factory).

## Consecuencias

**Positivas**

- Implementación **más simple** que bmad-loop: Frida elimina el impuesto del
  orquestador externo (sin TMux, adapters, probes ni pane-scraping).
- Reusa infraestructura ya planeada — no se inventa el motor del loop.
- La metodología (skills markdown, MIT-licensed) es portable y de bajo riesgo.
- Refuerza el valor de las extensiones críticas: #16 y #18 tienen un consumidor
  concreto de alto valor (AiDD).

**Negativas**

- **Dependencias críticas:** #16 (skills, dónde cargar la metodología; debe incluir
  el resolver 3-capas #2) y #18 (tokens, el gap recurrente — bmad-loop tiene
  `tokens.py` explícito). Sin ambas, AiDD no se puede construir.
- **Propiedad de corrección sutil:** sprint-status.yaml con un único writer
  idempotente never-regress (pieza #5). Si múltiples writers escriben, el loop
  pierde determinismo.
- **Drift metodológico:** BMAD es early beta con breaking changes pre-1.0. El
  porteo debe ser **adaptación de conceptos**, no mirror línea-por-línea que se
  vuelve obsoleto.

## Referencias

- Issue **#38**.
- Investigación: `docs/research/aidd-bmad-feasibility.md`.
- Nota previa: `docs/research/bmad-loop-parity.md` (video `iW86sMHszJw`).
- Serie: `graph-engineering-parity.md` · `sdlc-antigravity-parity.md` ·
  `factory-missions-parity.md` · `adlc-boundary.md` · `bmad-loop-parity.md`.
- Fuentes externas: [`BMAD-METHOD`](https://github.com/bmad-code-org/BMAD-METHOD)
  · [`bmad-loop`](https://github.com/bmad-code-org/bmad-loop) ·
  [`bmad-method-ui`](https://github.com/bmad-code-org/bmad-method-ui) (MIT).
- Dependencias: **#16** (skills/plugins) · **#18** (tokens, gap recurrente) ·
  **#19** (patrones: detached-auditor + los 5 nuevos de este ADR).
- Relacionados: ADR-0028 (`frida-extensible-workflows` = motor del loop) ·
  ADR-0046 (Loop Engineering como arquitectura de referencia) · ADR-0013
  (`frida-worktree`).
