# frida-tea — Test Engineering Architect como skill pack + patrones de workflow

> Issue #41 · [ADR-0053](../adr/0053-frida-tea-test-engineering-architect-skill-pack.md) · Lote 1 (núcleo de 4) + Lote 2 (ci, nfr, trace, atdd, teach + D8)

Porte del módulo BMAD **TEA** (Test Engineering Architect,
[bmad-method-test-architecture-enterprise](https://github.com/bmad-code-org/bmad-method-test-architecture-enterprise),
MIT) como skill pack. Agente **Murat** (Master Test Architect) + 4 workflows
de QA basado en riesgo. Mismo modelo que [frida-aidd](frida-aidd.md): skill
pack que **compone** al motor de
[frida-extensible-workflows](frida-extensible-workflows.md) — sin tools
propios, sin ciclo de vida de sesión, cero deps npm.

## Qué es (y qué no es)

**Es**: metodología de QA empresarial — decidir *qué* verificar, a qué
profundidad y con qué evidencia, antes de escribir un solo test. Estrategia
dirigida por riesgo (P0-P3), gates de release formales
(PASS/CONCERNS/FAIL/WAIVED) y auditoría con severidades fijas.

**No es**: un runner de tests ni un framework. Los *execution targets*
(Playwright/Cypress/pytest/…) los elige cada repo; TEA recomienda según el
stack real que encuentra.

## Los 9 workflows

| Patrón | Qué hace | Flujo |
| --- | --- | --- |
| `tea-test-design` | Plan de pruebas epic/sistema basado en riesgo | plan (registro P0-P3, estrategia por nivel, not-in-scope con mitigación, entry/exit, trazabilidad) → extracción de targets → **gate de release** → checkpoint |
| `tea-framework` | Setup del framework de pruebas para el stack real | survey (lee package.json/go.mod/…, honra `preference`) → setup (config + estructura + **ejemplo que se auto-verifica corriendo**) → gate → checkpoint |
| `tea-automate` | Expansión de automatización por target del plan | bootstrap determinista (extrae targets, ordena P0→P3, cap `maxTargets`) → **fan-out paralelo** (un agente por target: escribe el test al nivel asignado Y lo corre: `green\|blocked`) → gate → checkpoint |
| `tea-test-review` | Auditoría de calidad de la suite existente | discover (archivos + **baseline de convenciones** established/emerging/absent) → **fan-out por archivo** con registro de criterios de severidad fija → agregado determinista (score 0-100, manifiesto unscorable) → reporte → checkpoint |
| `tea-ci` | Pipeline CI con quality gates | survey (plataforma, comando de test real, framework, package manager, node) → pipeline (escribe config Y la verifica corriendo los comandos) → gate → checkpoint |
| `tea-nfr` | Auditoría de evidencia no funcional | **fan-out por categoría** (performance/security/reliability/maintainability + custom; evidencia citable o `NO_EVIDENCE` honesto) → **gate determinista** (algún FAIL → FAIL; algún CONCERNS/NO_EVIDENCE → CONCERNS) → reporte → checkpoint |
| `tea-trace` | Matriz de trazabilidad requisito→test | extractor de requisitos (del doc o **oráculo sintético** desde el código) → mapper (tests que de verdad verifican) → **coverage gate determinista** (P0 sin cobertura → FAIL; P1 → CONCERNS) → matriz → checkpoint |
| `tea-atdd` | Escenarios como contrato + fase roja | escenarios Given/When/Then anclados al código real → **checkpoint de contrato** (apruebas/editas) → fase roja (tests de aceptación fallando por la razón correcta: `red\|green\|blocked` + checklist) → checkpoint |
| `tea-teach` | Academia de testing en tu repo | **fan-out por módulo** (risk, levels, flakiness, gates, atdd — lecciones con ejemplos del código real, anti-patrones, ejercicios verificables) → índice → checkpoint |

Artefactos en `docs/tea/` (`test-design.md`, `test-review.md`,
`nfr-assessment.md`, `traceability-matrix.md`, `atdd-scenarios.md` /
`atdd-checklist.md`, `academy/`; framework/ci dejan config en las rutas
estándar del repo).

## Estructura

```text
src/tools/frida-tea/
├── skills.ts     # Prompts adaptados MIT (Murat + 9 workflows + gate) — capa defaults
├── resolver.ts   # 3-capas reusada de frida-aidd (D3): .frida/tea/stages.json
├── workflow.ts   # 9 generadores de script deterministas + validación de args
└── index.ts      # TEA_*_PATTERN (9, con meta D8) + createFridaTea()
```

### Adaptación vs. espejo (ADR-0053 D1/D5/D6)

- Cada step-file tri-modal del upstream se colapsa a **un prompt por rol**
  para agentes desechables headless — sin menús, sin `uv`/Python.
- El CLI eval `tea-test-review` (14 deps npm) **no se porta** (D6, mismo
  criterio que ADR-0028 D7).
- La duplicación física de knowledge del upstream (~520 copias) no se
  replica: los workflows referencian artefactos por ruta (D4; centralización
  en frida-knowledge-base queda como seguimiento).
- El fan-out de subagentes por dimensión del upstream se materializa como
  `parallel()` del motor (patrones #19).

### Registro en runtime

`createFridaTea()` registra los 4 patrones con `registerBuiltinPattern` — el
motor los expone en `/wf` y `workflow({ name, args })`. Idempotente por
nombre; el cwd se resuelve lazy en `resolve()`.

## Customización 3-capas (D3)

Los prompts se resuelven en launch-time (mismo núcleo que frida-aidd,
`createLayeredStageResolver`):

1. **Defaults** — `skills.ts` (bundled).
2. **Equipo** — `.frida/tea/stages.json` en el repo.
3. **Usuario** — `~/.frida/tea/stages.json`.

```json
{ "stages": { "gate": "prompt completo que reemplaza al default" } }
```

Stages: `test-design`, `framework`, `automate`, `test-review`, `gate`.
Un override es el prompt completo del stage. JSON inválido aborta
ruidosamente antes de correr nada.

## Gates de release

Todos los workflows terminan con un gate que **audita artefactos y claims**
(lee los archivos, no confía en resúmenes) y devuelve `{ decision, findings[],
notes }` con severidades fijas (CRITICAL/HIGH/MEDIUM/LOW). El checkpoint final
presenta la decisión al usuario (`review: "auto"` lo omite).

Dos gates son además **deterministas** (reglas, no LLM — espejo del upstream):

- `tea-nfr`: algún FAIL → FAIL; algún CONCERNS/NO_EVIDENCE → CONCERNS; else PASS.
- `tea-trace`: P0 sin cobertura → FAIL; P1 sin cobertura → CONCERNS; else PASS.

En `tea-test-review` el score también es determinista: promedio de los
archivos puntuados (unscorable excluidos), deducciones por severidad
(CRITICAL -10, HIGH -5, MEDIUM -3, LOW -1).

## Metadatos D8 (`requiredTools` / `executionHints`)

Los 9 patrones declaran `meta` (extensión menor del motor,
`BuiltinPattern.meta`): las tools del sandbox que necesitan para correr
completo (`shell` para framework/ci/automate/atdd, que ejecutan comandos) y su
postura de autonomía (`autonomous`/`iterative`/`interactive`). Informativos
— el sandbox siempre provee la misma superficie — pero visibles en
`workflow_catalog` para descubrimiento y auditoría de capabilities.

## Pruebas

`test/frida-tea/` — 31 tests:

- **resolver** (5): defaults, equipo, usuario, ignora desconocidos, JSON
  inválido aborta.
- **pattern** (16): validación de args de los 9 patrones, anclas del script
  generado, meta D8, preamble Murat.
- **e2e** (10): sobre el motor real (`runWorkflowInStore`) — cadena con
  checkpoint, orden por riesgo + fan-out + conteo de verdes, filtro/cap de
  targets, agregado de score/unscorable/severidades, pipeline CI, gate NFR
  determinista (FAIL gana), coverage trace (P0 sin cobertura → FAIL),
  contrato ATDD → fase roja, academia filtrada + índice.

## Atribución

Adaptado de
[bmad-code-org/bmad-method-test-architecture-enterprise](https://github.com/bmad-code-org/bmad-method-test-architecture-enterprise)
(MIT, © 2025 BMad Code, LLC). Conceptos portados, no espejo; los errores son
nuestros. Véase el [ADR-0053](../adr/0053-frida-tea-test-engineering-architect-skill-pack.md)
para las decisiones de porte.
