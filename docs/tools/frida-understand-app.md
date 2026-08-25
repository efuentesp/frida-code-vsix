# frida-understand-app — entendimiento técnico de un códigobase desconocido (patrón builtin)

> Issue #134 · M1 · Pista M

Skill pack que registra el patrón builtin **`understand-app`** sobre el motor de
[frida-extensible-workflows](frida-extensible-workflows.md): toma un códigobase
desconocido (el cwd del repo) y produce el entendimiento técnico documentado y
verificable en `docs/entendimiento/` — las **7 preguntas del día 1**
([modernization-apps §7](../modernization-apps.md)) respondidas con evidencia
citable (`file:line`), mapa de riesgos priorizado, modelo LikeC4 semilla,
veredicto preliminar M4/M5 e inventario auditable. El grounding viene del
**moat real**: las sesiones hijas del patrón reciben pi-lens y
frida-codebase-index inyectadas por el motor (`meta.moat`). Mismo modelo que
[frida-tea](frida-tea.md), [frida-aidd](frida-aidd.md) y
[frida-app-walkthrough](frida-app-walkthrough.md): skill pack que **compone**
al motor — sin tools propios, sin ciclo de vida de sesión, cero dependencias
npm nuevas.

## Qué es (y qué no es)

**Es**: un generador determinista de entendimiento técnico, one-shot y
desatendido tras el lanzamiento. Un script determinista sondea capacidades y
levanta datos del repo; agentes desechables interpretan (cartógrafo → scouts →
escritores → juez) escribiendo evidencia en disco; la síntesis final (README +
veredicto M4/M5 + inventario) es determinista desde una sola fuente de verdad.

**No es**: documentación funcional de una app usándola (eso es M8 —
`app-walkthrough`), cruce funcional↔técnico (M9, issue #135), panel «Mapa del
proyecto» (M2), matriz funcionalidad↔endpoint↔módulo (M9) ni integración
SonarQube (M3). Tampoco refina ni visualiza el modelo LikeC4 (tooling externo —
Frida solo genera el `.c4` semilla).

## El workflow — 6 fases

| Fase | Tipo | Qué hace |
| --- | --- | --- |
| `bootstrap` | determinista | `mkdir -p` de `docs/entendimiento/**`; **sonda híbrida de capacidades** (`test -s` del índice + const `CAPABILITIES` interpolada host-side); fecha/epoch vía shell; `ls`/`git log`/manifiestos para el overview; inventario inicial |
| `overview` | agéntica | 1 cartógrafo: **confirma capacidades runtime** (ejercita `index_status` — modo guía = degradación), considera indexar si conviene, levanta componentes/lenguajes/frameworks (moat + datos deterministas) y propone **áreas de riesgo priorizadas** orientadas a las 7 preguntas |
| `hotspots` | agéntica | **Fan-out dinámico de scouts** en `parallel()`: corte de `maxHotspots` UNA vez antes de construir las tasks; cada scout investiga su área y escribe hallazgos con evidencia `file:line` a `artifacts/hotspots/`; gate `test -s` + reintento informado una vez |
| `analyze` | agéntica | **Fan-out de 3 escritores** sobre artefactos en disco (no re-investigan desde cero): `entendimiento.md` (§Q1..§Q7), `mapa-riesgos.md`, `likec4/modelo.c4` |
| `synthesize` | determinista | `README.md` + `m4-m5-veredicto.md` + inventario final escritos por el script desde el **mismo inventario serializado** — un gap que no está en el inventario no puede aparecer en el veredicto, y viceversa |
| `judge` | agéntica | Auditor detached contra los archivos reales: `PASS / CONCERNS / FAIL` con findings por severidad contra la rúbrica de las 7 preguntas; corte por presupuesto/tiempo = gap CONOCIDO → `CONCERNS`, no `FAIL`. Checkpoint final (se omite con `review: "auto"`) |

El wall-clock (`maxMinutes`) corta el **descubrimiento** (overview/scouts); las
fases de entregable (analyze/synthesize/judge) siempre corren sobre lo
alcanzado — el corte no aborta.

## Args

| Arg | Tipo | Default | Descripción |
| --- | --- | --- | --- |
| `maxHotspots` | `number` | — | Tope de áreas de riesgo a scoutear (**requerido**, entero 0-100; `0` = «todo») |
| `maxMinutes` | `number` | `0` | Backstop wall-clock (entero 1-240 min). `0` = sin tope; al vencer corta el descubrimiento marcando `stoppedByTime` |
| `language` | `string` | `"es-MX"` | Idioma (BCP-47) de los entregables |
| `review` | `"manual" \| "auto"` | `"manual"` | `"manual"` detiene en el checkpoint final; `"auto"` corre desatendido |

`maxHotspots` es requerido **a propósito** (igual que `maxScreens` en M8):
tras el launch la corrida es desatendida, así que el presupuesto se pregunta
ANTES con `ask_user_question` en la sesión principal. Si falta, la validación
eager falla con un error que instruye exactamente ese flujo. Sin `url`: el
target es el cwd del repo.

## Entregables

```text
docs/entendimiento/
├── README.md                 # índice determinista (corrida, conteos, links)
├── entendimiento.md          # §Q1..§Q7 — 7 preguntas del día 1 con evidencia file:line
├── mapa-riesgos.md           # R01.. — priorizados desde los hallazgos (origen H01..)
├── m4-m5-veredicto.md        # ¿bastó el moat? (preliminar, determinista)
├── likec4/modelo.c4          # DSL LikeC4 semilla desde los componentes (C01..)
└── artifacts/
    ├── inventory.json        # writer único (el script): run, capabilities,
    │                         #   tools[] (disponibles/usadas/degradadas),
    │                         #   degradations[], components[], hotspots[],
    │                         #   questions[] (rúbrica), stoppedBy/stoppedByTime
    └── hotspots/H01-*.md     # hallazgos crudos por área (cadena de custodia)
```

`inventory.json` es grep-verificable ex-post y es la fuente de verdad de
`README.md` y `m4-m5-veredicto.md` — imposible que índice y veredicto diverjan.

## El moat — tools inyectadas en las sesiones hijas

El patrón declara `meta.moat = { lens: true, codebaseIndex: true }` y el motor
inyecta en las sesiones hijas de ESTE patrón (y sólo de éste — no-leakage a
`frida-tea`/`frida-aidd`/`app-walkthrough`):

| Extensión | Tools |
| --- | --- |
| **pi-lens** (read-only) | `project_report`, `symbol_search`, `module_report`, `read_symbol` |
| **frida-codebase-index** | `semantic_context`, `semantic_search`, `call_graph`, `implementation_lookup`, `index_codebase`, `index_status` |

Detalles del seam:

- `meta.moat` son **flags declarativas JSON-safe** (visibles en
  `workflow_catalog`); la resolución flag→factory vive en el motor
  (`moat-factories.ts`).
- `patternMeta` se persiste en `snapshot.metadata` — **retry/resume
  reconstruyen el moat** de la corrida (runs viejas sin el campo → sin moat,
  backwards-compatible).
- El toggle `frida.codebaseIndex.enabled` se respeta (getter): apagado → el
  patrón recibe solo pi-lens y el inventario registra la degradación con el
  hint accionable.
- `index_codebase` es la única tool que muta disco (escribe
  `.codebase-index/`); riesgo aceptado, hardening como follow-up.
- La sonda de capacidades es **híbrida**: presencia física del índice
  (`test -s .codebase-index/index/codebase.db`) + instalación interpolada
  host-side en launch + confirmación runtime (el cartógrafo ejercita
  `index_status`; modo guía = degradación, no error).

## Las 7 preguntas del día 1

La rúbrica del juez y la columna vertebral de `entendimiento.md` — las
preguntas del día 1 de [modernization-apps §7](../modernization-apps.md),
normalizadas a forma de pregunta:

1. ¿Dónde se autentican los usuarios?
2. ¿Qué módulos llaman al servicio de pagos?
3. ¿Dónde se valida el estado de autenticación antes de una petición?
4. ¿Qué impacto tendría cambiar esta interfaz?
5. ¿Cuál es el flujo desde este endpoint hasta la base de datos?
6. ¿Qué implementaciones parecidas existen a este flujo?
7. ¿Qué código está muerto y nunca se llama?

Cada pregunta queda en el inventario con status (`answered` / `partial` /
`sin-evidencia`) y evidencia citada. «Sin evidencia suficiente» es una
respuesta válida y valiosa — nunca se inventan rutas ni símbolos.

## Política de acciones

El veto de solo-lectura vive en un **preamble no-stage**
(`UNDERSTAND_APP_PREAMBLE` en `skills.ts`), interpolado por el ctx-helper
FUERA del mapa de stages:

- **Permitido**: leer código, correr consultas read-only (grep/find/git log),
  y escribir ÚNICAMENTE `docs/entendimiento/**` (entregables y evidencia).
- **Excepción única**: `index_codebase` puede escribir `.codebase-index/`
  (índice del moat).
- **VETADO**: todo cambio al código fuente del proyecto — crear, modificar o
  eliminar archivos fuera de lo permitido. El agente marca la acción
  `[VETOED]` y continúa en solo lectura.

Como un override 3-capas **reemplaza** el prompt completo del stage, los
invariantes de seguridad NO pueden vivir en un default de stage — por eso
viajan en el preamble, inalcanzable para `stages.json`.

## Estructura

```text
src/tools/frida-understand-app/
├── skills.ts     # UNDERSTAND_APP_STAGES + prompts defaults (es-MX) + preamble no-stage
├── resolver.ts   # 3-capas reusada de frida-aidd (createLayeredStageResolver, 4º consumidor)
├── workflow.ts   # validación eager de args + generador del script de 6 fases
└── index.ts      # UNDERSTAND_APP_PATTERN + createFridaUnderstandApp()
```

## Registro en runtime

`createFridaUnderstandApp()` registra el patrón con `registerBuiltinPattern` —
el motor lo expone en `workflow({ name: "understand-app", args })` y en el
picker `/wf`. Idempotente por nombre; el cwd se resuelve en `resolve()` (los
overrides de equipo son por repo). Sin gate de setting propio (paridad
frida-tea/frida-aidd/app-walkthrough: el gate relevante es
`frida.extensibleWorkflows.enabled` del motor). La entrada de pi-session pasa
el `agentDir` real y el getter `codebaseIndexEnabled` para que la const
`CAPABILITIES` del script sea exacta respecto de instalación y toggle.

## Customización 3-capas

Los prompts se resuelven en launch-time (mismo núcleo que frida-aidd):

1. **Defaults** — `skills.ts` (bundled).
2. **Equipo** — `.frida/understand-app/stages.json` en el repo.
3. **Usuario** — `~/.frida/understand-app/stages.json`.

```json
{ "stages": { "judge": "rúbrica propia del equipo…" } }
```

Stages: `overview`, `hotspots`, `analyze`, `judge` (una clave por rol agéntico;
bootstrap y synthesize son deterministas y no tienen clave). Un override es el
prompt completo del stage. JSON inválido aborta ruidosamente antes de correr
nada. **El veto de solo-lectura no es direccionable desde aquí** (vive en el
preamble no-stage).

## Metadatos

El patrón declara `meta.requiredTools: ["shell"]`,
`meta.executionHints.autonomous: true` y `meta.moat: { lens: true,
codebaseIndex: true }` — visibles en `workflow_catalog` como JSON.

## Veredicto M4/M5 preliminar

`m4-m5-veredicto.md` responde «¿bastó el moat?» de forma determinista desde el
inventario: núcleo faltante (lens o codebase-index) O ≥4 preguntas sin
evidencia O ≥3 degradaciones → mantener M4/M5 abiertos; señales menores →
suficiente con reservas; sin señales → recomendar cerrar M4 y dejar M5 en
watchlist. Es preliminar: la decisión final depende del piloto formal
([modernization-apps §8](../modernization-apps.md)).

## Pruebas

`test/frida-understand-app/`:

- **resolver** (6): defaults, equipo, usuario, ignora desconocidos, JSON
  inválido aborta, veto vive sólo en el preamble.
- **pattern** (22): validación eager de args, sonda de capacidades host-side,
  forma del script generado (6 fases, veto, rúbrica, CAPABILITIES, cortes),
  registro en runtime idempotente.
- **e2e** (8): motor real (`runWorkflowInStore`) con spawner mock por anclas —
  happy path, corte presupuesto→CONCERNS, corte wall-clock, escritor
  mentiroso, scout/escritor flaky (reintento rescata), juez FAIL (caso
  negativo citando §Qn), determinismo.

Más las suites del motor del moat:
`test/frida-extensible-workflows/moat-factories.test.ts` (composición +
registro real con pi falso) y `moat-seam.test.ts` (patternMeta persistido y
retry/resume). Ver [frida-extensible-workflows](frida-extensible-workflows.md).

## Ver también

- [README](../../README.md) — índice general de Frida Code.
- [Guía de uso](../how-to-frida-understand-app.md) — recetas paso a paso.
- [frida-extensible-workflows](frida-extensible-workflows.md) — el motor.
- [modernization-apps](../modernization-apps.md) — el marco (§7 preguntas, §8
  piloto, §9 M1).
- [frida-app-walkthrough](frida-app-walkthrough.md) — la contraparte funcional
  (M8).
