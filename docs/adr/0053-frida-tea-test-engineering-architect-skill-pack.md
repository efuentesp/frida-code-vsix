# `frida-tea` — Test Engineering Architect como skill pack (porte de `bmad-method-test-architecture-enterprise`)

**Estado:** aceptado (#41). **Bloqueado por `#19`** (patrones dynamic-workflows que este
porte materializa), `#29` (frida-knowledge-base), `#21`/`#18` (context routing) y el
customize-layer de `#38` (frida-aidd).

Se porta como **skill pack** el módulo BMAD *Test Architect* (TEA) — 1 agente (Murat,
Master Test Architect) + 9 workflows de QA empresarial: estrategia de test basada en
riesgo, automation, framework setup, CI, ATDD, NFR evidence audit, test review y
traceability. Sigue el **camino A (porte nativo de contenido)** del ADR-0050, mismo
modelo que ADR-0052 (`frida-cis`). Cero dependencias npm del runtime de workflows (el JS
del repo es CLI bin + tooling).

> **Hallazgo clave.** TEA es **casi 100% cubierto por `frida-extensible-workflows` + los
> patrones de `#19`**. Es la materialización de referencia de esos patrones (detached-
> auditor, fan-out, never-regress, dev-contract, gate-decision). Portar TEA **valida**
> que la dirección de `#19` es la correcta y la ejercita en su forma más completa.

## Contexto

[`bmad-code-org/bmad-method-test-architecture-enterprise`](https://github.com/bmad-code-org/bmad-method-test-architecture-enterprise)
(v1.22.0, MIT) es el módulo BMAD más maduro de la serie evaluada. **Arquitectura de 2
capas**:

- **TEA Core** — decide *qué* verificar, a qué profundidad, con qué evidencia, y si esa
  evidencia es suficiente para release. **Agnóstico de stack.**
- **Execution targets** — convierte las decisiones en tests ejecutables en un stack
  específico (Playwright/Cypress/Maestro/Pact/pytest/JUnit/Go test/xUnit/RSpec/k6).
  **Swappable.** Son docs markdown (patrones), no dependencias del agente.

Cada workflow es **tri-modal** (`steps-c` create / `steps-e` edit / `steps-v` validate),
con step-by-step de carga *just-in-time* (frontmatter `nextStepFile`), resume
(`step-01b-resume.md` + YAML frontmatter `stepsCompleted`/`lastStep`), subagentes
paralelos aislados (frontmatter `subagent: true` + `outputFile: /tmp/*.json`, agregados
en un step `aggregate`), templates con `{PLACEHOLDER}`, checklist de validación (pass/fail
report), y gates de release (PASS/CONCERNS/FAIL/WAIVED sobre riesgo P0-P3).

**Tiered knowledge injection**: `tea-index.csv` (columna `tier` ∈ core/extended/
specialized) + config flags (`tea_use_playwright_utils`, `tea_use_pactjs_utils`,
`tea_pact_mcp`, `test_stack_type`). Carga selectiva: backend ~1.800 líneas, fullstack
~4.500 — **ahorra 40-50% de contexto**.

### Dependencias (se separan por propósito)

- **CLI bin `tea-test-review`** (14 deps npm: commander, csv-parse, glob, js-yaml, xml2js,
  yaml, @clack/prompts, ora, boxen, cli-table3, semver, ignore, wrap-ansi, csv-parse) → es
  un **eval/validator** de reportes. No aplica a Frida (webview, no CLI). Se descarta
  (mismo criterio que ADR-0028 D7 excluyó `workflow-evals.ts`).
- **`uv`/Python** (`resolve_customization.py`) — el customize layer. Mismo resolver que
  CIS (ADR-0052), mismo fallback LLM en el `SKILL.md`, misma eliminación (D5).
- **Runtime de workflows** → **puro markdown + CSV + YAML**, sin deps.

## Decisión

**Porte nativo de TEA como skill pack `frida-tea`, extensión separada, reusando el
customize-layer de `#38`, centralizando la knowledge base en `#29`, sin Python/CLI.**

| ID | Decisión | Justificación |
| --- | --- | --- |
| **D1** | **Porte de contenido (camino A).** El agente Murat + 9 workflows (`SKILL.md` + `instructions.md` + `checklist.md` + `steps-c/e/v/*.md` + `*-template.md` + `tea-index.csv` + execution targets) se portan a `~/.pi/agent/skills/frida-tea-*`. MIT. | Mismo modelo que ADR-0050 (frida-aidd) y ADR-0052 (frida-cis). Cero deps npm del runtime. |
| **D2** | **Extensión separada (no absorbida en `#38`/`#40`).** Dominio = QA empresarial; escala dedicada (1 agente + 9 workflows + ~65 knowledge fragments). | Mismo criterio que CIS-`#40` ≠ aidd-`#38`. Reusa infraestructura compartida pero no se mezcla. |
| **D3** | **3er consumidor del customize-layer de `#38`.** TEA usa el mismo resolver 3-niveles que aidd y cis. No se reimplementa. | `frida-tea` es el 3er consumidor (junto con `#38`, `#40`) que valida y amortiza esa capability. |
| **D4** | **Anti-duplicación de knowledge → centralizar en `#29`.** TEA duplica ~65 fragments × 9 workflows físicamente (~520 archivos idénticos), "self-contained skills". En Frida se **centraliza en `frida-knowledge-base` (`#29`)** y los workflows referencian por path. | Single source of truth. 520 copias idénticas es un anti-patrón para Frida; la portabilidad "self-contained" de BMAD se logra con paths estables, no duplicación. |
| **D5** | **Eliminar `uv`/Python.** Resolver → LLM-fallback del `SKILL.md` o tool TS `frida-customize` (compartida con `#38`). | Regla de proyecto: sin deps externas. Mismo que ADR-0052 D3. |
| **D6** | **Descartar CLI bin `tea-test-review` + deps npm + tooling.** Eval/validator CLI no aplica a Frida (webview). | Mismo criterio que ADR-0028 D7. |
| **D7** | **TEA = caso de validación de `#19`.** Los patrones que `#19` (frida-dynamic-workflows) planea portar — detached-auditor, fan-out, never-regress, dev-contract, gate-decision — son **exactamente** los que TEA materializa. Portar TEA **ejercita y valida** `#19`. | TEA es la referencia más concreta y completa de esos patrones. Implementar `#19` con TEA como suite de validación reduce riesgo de diseño. |
| **D8** | **2 capabilities nuevas que TEA ejercita y Frida no tiene** → se cubren con issues existentes: (1) **tiered knowledge injection** (context-routing by tier+config, ahorro 40-50%) → `#21` (frida-hermes-memory) + `#18` (token accounting); (2) **knowledge base centralizada** → `#29`. Además: `required_tools` + `execution_hints` (autonomy) en `workflow.yaml` → **extensión menor** de frida-extensible-workflows (declarar capabilities requeridas + flag de autonomía del workflow). | TEA no exige infraestructura fundamental nueva; reusa el roadmap existente + 1 extensión menor. |
| **D9** | **Execution targets = contenido porteable.** Playwright/Cypress/Maestro/Pact/pytest/JUnit/Go/k6 son docs markdown de patrones, no dependencias del agente. Se portan como knowledge fragments (`#29`). | Sin impacto en deps de Frida. El stack final lo elige el usuario en el código generado, no el agente. |

## Mapeo de componentes

| Mecanismo TEA | Patrón Frida (`#19`) | Herramienta | Estado |
| --- | --- | --- | --- |
| Step-by-step JIT + `nextStepFile` | control-flow determinista | frida-extensible-workflows | ✅ existe |
| YAML frontmatter + resume | **never-regress** / journal | frida-extensible-workflows (`workflow_resume`) | ✅ existe |
| Subagentes paralelos + JSON aggregate | **detached-auditor / fan-out** | frida-extensible-workflows (`parallel`+`agent`) | ✅ existe |
| 3 modos (create/edit/validate) | **dev-contract** | frida-extensible-workflows (phases) | ✅ existe |
| Gate decisions (PASS/CONCERNS/FAIL/WAIVED) | gate-decision | frida-extensible-workflows (`checkpoint`) | ✅ existe |
| Templates `{PLACEHOLDER}` + checklist | template-output + verification | frida-extensible-workflows | ✅ existe |
| Risk-based P0-P3 | contenido porteable | porte | ✅ directo |
| Execution targets (Playwright/Pact/…) | contenido porteable | porte (knowledge `#29`) | ✅ directo |
| **Tiered knowledge** (core/extended/specialized + config) | **context-routing** | frida-hermes-memory (`#21`) + `#18` | ❌ blocked |
| **Knowledge base reusable** (~65 fragments) | knowledge bundle | **frida-knowledge-base (`#29`)** | ❌ open |
| `required_tools` + `execution_hints` (autonomous) | capability declaration + autonomy | extensión menor frida-extensible-workflows | ⚠️ parcial |
| CLI bin `tea-test-review` | eval harness | descartado (D6) | descartar |

## Alternativas consideradas

- **A — Absorber TEA en `#38` (frida-aidd) o `#40` (frida-cis).** Descartado: dominio
  distinto (QA ≠ metodología ≠ creatividad) y escala dedicada. Mismo criterio que CIS.
- **B — Mantener la duplicación física de knowledge (520 archivos "self-contained").**
  Descartado (D4): anti-patrón para Frida; la portabilidad se logra con paths estables en
  `#29`, no copiando.
- **C — Portar el CLI bin `tea-test-review` (eval).** Descartado (D6): Frida es webview;
  el eval CLI no aplica. Mismo criterio que ADR-0028 D7.
- **D — No portar (esperar a que `#19`/`#29` maduren).** Descartado: TEA es el **mejor
  caso de validación** de `#19`; posponerlo pierde esa señal de diseño. Se documenta ahora
  como consumidor-dirigente del roadmap.

## Consecuencias

**Positivas**

- Suite de QA empresarial (estrategia de riesgo + automation + gates de release) en
  Frida.
- **Validación más concreta de `#19`** — portar TEA ejercita detached-auditor, fan-out,
  never-regress, dev-contract y gate-decision en su forma más completa.
- **3er consumidor** del customize-layer de `#38` → refuerza esa capability.
- Caso de uso que justifica `#29` (knowledge base) y `#21`/`#18` (context routing): el
  tiered injection de TEA demuestra el ahorro de contexto (40-50%).
- Cero deps npm; sin Python; sin CLI.

**Negativas**

- **Bloqueado por `#19`, `#29`, `#21`/`#18` y customize-layer de `#38`** — es el
  consumidor que más capabilities del roadmap toca simultáneamente.
- **Extensión menor** de frida-extensible-workflows (`required_tools`/`execution_hints`
  metadata) — trabajo incremental, no bloqueante pero necesario para paridad.
- Migración de paths `_bmad/tea/...` → `.frida/tea/...` + reescribir referencias de
  knowledge a paths centralizados de `#29`.

## Puntos frágiles

- **Tiered injection depende de `#21`/`#18`**: sin context-routing, el porte pierde el
  ahorro de 40-50% (caería a carga completa = más tokens). `#18` (token accounting) es
  además el gate que mide ese ahorro.
- **`required_tools` no existe en frida-extensible-workflows hoy**: el sandbox actual
  expone `agent/shell/withWorktree/parallel/...` sin declaración de capabilities. La
  extensión menor (D8) debe añadir validación de que el workflow declara tools que el
  sandbox provee.
- **Execution targets de terceros** (p.ej. `@seontechnologies/playwright-utils`): TEA lo
  sugiere en el output generado. **No es dependencia del agente** (es del código que TEA
  produce) — el usuario decide. Documentar claramente para evitar confusión con la regla
  "sin deps externas".
- **Resume por YAML frontmatter** vs **journal de frida-extensible-workflows**: TEA usa
  frontmatter `stepsCompleted`/`lastStep`; Frida usa el journal por structural-path.
  Decisión de migración: mapear el frontmatter al journal (no duplicar mecanismos).

## Referencias

- Issue **#41**.
- **ADR-0050** (`frida-aidd`) — camino A (skill pack); TEA sigue el mismo modelo.
- **ADR-0052** (`frida-cis`) — customize-layer (`uv`/Python → D5) y patrón de porte de
  módulo BMAD.
- **`#19`** (frida-dynamic-workflows) — **bloqueo directo**: TEA materializa sus patrones
  (D7).
- **`#29`** (frida-knowledge-base) — **bloqueo directo**: knowledge centralizada (D4).
- **`#21`** (frida-hermes-memory) + **`#18`** (token accounting) — tiered injection (D8).
- **`#38`** (frida-aidd) — customize-layer reusada (D3).
- **ADR-0028** D7 — precedente de exclusión de eval harness (D6).
