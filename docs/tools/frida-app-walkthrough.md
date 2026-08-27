# frida-app-walkthrough — documentación funcional de una app web usándola como usuario (patrón builtin)

> Issue #133 · M8 · Pista M

Skill pack que registra el patrón builtin **`app-walkthrough`** sobre el motor de
[frida-extensible-workflows](frida-extensible-workflows.md): el agente usa una
app web como un usuario real — sobre una sesión de navegador que el usuario
autenticó previamente — y produce la documentación funcional completa en
`docs/funcional/` (catálogo de pantallas, flujos, reglas de negocio,
roles/permisos, evidencia cruda y dashboard HTML autónomo). Mismo modelo que
[frida-tea](frida-tea.md) y [frida-aidd](frida-aidd.md): skill pack que
**compone** al motor — sin tools propios, sin ciclo de vida de sesión, cero
dependencias npm nuevas.

## Qué es (y qué no es)

**Es**: un walkthrough funcional asistido, one-shot y desatendido tras el
lanzamiento. Un script determinista navega la app paso a paso sobre la sesión
pinneada; por cada pantalla un agente desechable la interpreta (propósito,
roles, elementos interactivos) y decide la siguiente acción; al final, cuatro
escritores redactan los documentos desde la evidencia en disco y un juez audita
la cobertura (`PASS / CONCERNS / FAIL`).

**No es**: QA automatizado (eso es [frida-tea](frida-tea.md)), ingeniería
inversa de APIs por tráfico (eso es M9 —
[frida-traffic2api](frida-traffic2api.md)), ni re-corrida con diff
contra una documentación previa (`app-rewalk`, patrón futuro de la Pista M).

## El workflow — 5 fases

| Fase | Tipo | Qué hace |
| --- | --- | --- |
| `bootstrap` | determinista | Crea `docs/funcional/**`; **gate de sesión viva** (`get url` — si falla, error accionable con la receta de pre-autenticación); `open` de `url` |
| `explore` | agéntica | Loop **«script navega, agente decide»**: snapshot por pantalla → disco; dedup por origin canónico; screenshot por pantalla nueva; cortes de presupuesto (`maxScreens`/`maxMinutes`/límite de pasos) ANTES de gastar LLM; **un agente por paso** devuelve `nextAction` (`click`/`form`/`validate`/`goto`/`done`) con `outputSchema`; el script la ejecuta vía `shell("agent-browser --session … --json")` |
| `analyze` | agéntica | **Fan-out de 4 escritores** en `parallel()` sobre artefactos en disco (nunca navegación viva): catálogo, journeys, reglas, roles. Gate `test -s` por documento + reintento informado una vez antes de fallar |
| `synthesize` | determinista | `README.md` + `index.html` (dashboard autónomo, sin assets externos) escritos por el script desde el **mismo inventario serializado** — una sola fuente de verdad, imposible que índice y dashboard diverjan |
| `judge` | agéntica | Auditor detached contra los archivos reales: `PASS / CONCERNS / FAIL` con findings de severidad fija. Checkpoint final (se omite con `review: "auto"`) |

`validate` es una acción estructural del loop: llena un formulario con valores
INVÁLIDOS y hace submit no destructivo; el snapshot post-error queda persistido
como evidencia de las reglas de validación (lo cita el escritor de reglas).

## Args

| Arg | Tipo | Default | Descripción |
| --- | --- | --- | --- |
| `url` | `string` | — | URL base de la app (**requerida**) |
| `maxScreens` | `number` | — | Tope de pantallas únicas (**requerido**, entero 0-200; `0` = «todo») |
| `maxMinutes` | `number` | `0` | Backstop wall-clock (entero 1-240 min). `0` = sin tope; al vencer corta marcando `stoppedByTime` y el juez reporta lo faltante como `CONCERNS` |
| `session` | `string` | `"app-walkthrough"` | Nombre de la sesión de navegador pre-autenticada (pin `--session` en cada comando) |
| `language` | `string` | `"es-MX"` | Idioma (BCP-47) de los entregables |
| `review` | `"manual" \| "auto"` | `"manual"` | `"manual"` detiene en el checkpoint final; `"auto"` corre desatendido |

`maxScreens` es requerido **a propósito**: tras el launch la corrida es
desatendida (el checkpoint del motor es booleano y `ask_user_question` sólo
existe en la sesión principal), así que el presupuesto se pregunta ANTES. Si
falta, la validación eager falla con un error que instruye exactamente ese
flujo (preguntar al usuario y relanzar).

## Entregables

```text
docs/funcional/
├── README.md                 # índice determinista (corrida, N pantallas, links)
├── index.html                # dashboard autónomo (CSS inline + JSON embebido)
├── catalogo-pantallas.md     # P01..Pnn — propósito, roles, elementos, screenshot
├── journeys.md               # J01.. — flujos reconstruidos desde el actionLog
├── reglas-negocio.md         # R01.. — validaciones con evidencia post-error
├── roles-permisos.md         # A01.. — roles detectados por pantalla
├── screenshots/              # P01-<slug>.png (nombrados por ID estable)
└── artifacts/
    ├── inventory.json        # writer único (el script): pantallas, actionLog,
    │                         #   presupuesto, stoppedBy/stoppedByTime
    └── steps/                # 001-snapshot.json … (cadena de custodia cruda)
```

Los snapshots crudos se acumulan en disco (no en el journal del workflow): el
journal persiste sólo los JSON cortos de `outputSchema`. `inventory.json` es
grep-verificable ex-post (`grep -c '"id": "P' docs/funcional/artifacts/inventory.json`).

## Política de acciones

El veto de acciones irreversibles vive en un **preamble no-stage**
(`WALKTHROUGH_PREAMBLE` en `skills.ts`), interpolado por el ctx-helper FUERA del
mapa de stages:

- **Permitido**: navegar, abrir enlaces, llenar y enviar formularios NO
  destructivos (búsqueda, filtro, ordenamiento).
- **VETADO**: crear/editar/eliminar registros, compras, envíos, cambios de
  configuración o cuenta, cierre de sesión — todo lo irreversible. El agente
  marca la acción como `[VETOED]` y elige otra.

Como un override 3-capas **reemplaza** el prompt completo del stage, los
invariantes de seguridad NO pueden vivir en un default de stage (un override de
equipo los omitiría en silencio) — por eso viajan en el preamble, inalcanzable
para `stages.json`. El manifiesto de acciones ejercidas queda en
`inventory.json` (`actionLog`), auditable.

## Estructura

```text
src/tools/frida-app-walkthrough/
├── skills.ts     # WALKTHROUGH_STAGES + prompts defaults (es-MX) + preamble no-stage
├── resolver.ts   # 3-capas reusada de frida-aidd (createLayeredStageResolver)
├── workflow.ts   # validación eager de args + generador del script de sandbox
└── index.ts      # APP_WALKTHROUGH_PATTERN + createFridaAppWalkthrough()
```

## Registro en runtime

`createFridaAppWalkthrough()` registra el patrón con `registerBuiltinPattern` —
el motor lo expone en `workflow({ name: "app-walkthrough", args })` y en el
picker `/wf` (sección «Patrones agénticos», automática). Idempotente por
nombre; el cwd se resuelve lazy en `resolve()` (los overrides de equipo son por
repo). Sin gate de setting propio (paridad frida-tea/frida-aidd: el gate
relevante es `frida.extensibleWorkflows.enabled` del motor).

## Customización 3-capas

Los prompts se resuelven en launch-time (mismo núcleo que frida-aidd,
`createLayeredStageResolver`):

1. **Defaults** — `skills.ts` (bundled).
2. **Equipo** — `.frida/app-walkthrough/stages.json` en el repo.
3. **Usuario** — `~/.frida/app-walkthrough/stages.json`.

```json
{ "stages": { "judge": "prompt completo que reemplaza al default" } }
```

Stages: `explore`, `analyze`, `judge` (una clave por rol agéntico; bootstrap y
synthesize son deterministas y no tienen clave). Un override es el prompt
completo del stage. JSON inválido aborta ruidosamente antes de correr nada.
**El veto de irreversibles no es direccionable desde aquí** (vive en el
preamble no-stage).

## Metadatos (`requiredTools` / `executionHints`)

El patrón declara `meta.requiredTools: ["shell"]` y
`meta.executionHints.autonomous: true` (extensión menor del motor,
informativa): la navegación corre por `shell("agent-browser …")` desde el
script del sandbox y la corrida es autónoma tras el launch. Visibles en
`workflow_catalog`.

## Pruebas

`test/frida-app-walkthrough/`:

- **resolver** (6): defaults, equipo, usuario, ignora desconocidos, JSON
  inválido aborta, veto vive sólo en el preamble.
- **pattern** (14): validación eager de args, forma del script generado (5
  fases, pin de sesión, veto, writers, checkpoint), registro en runtime
  idempotente.
- **e2e**: corrida real del script generado contra el motor con un binario
  mock de `agent-browser` en el PATH del tmpdir (dedup por origin, corte por
  `maxScreens`, gates de artefacto, inventario determinista).

## Ver también

- [README](../../README.md) — índice general de Frida Code.
- [Guía de uso](../how-to-frida-app-walkthrough.md) — recetas paso a paso.
- [frida-extensible-workflows](frida-extensible-workflows.md) — el motor.
- [frida-agent-browser](frida-agent-browser.md) — la sesión de navegador.
