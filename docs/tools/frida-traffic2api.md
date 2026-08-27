# frida-traffic2api — del tráfico real de la app a openapi.json + matriz funcionalidad↔endpoint↔módulo (patrón builtin)

> Issue #135 · M9 · Pista M

Skill pack que registra el patrón builtin **`traffic2api`** sobre el motor de
[frida-extensible-workflows](frida-extensible-workflows.md): captura el
**tráfico HTTP real** de una app web — un walk agéntico que graba un HAR
sobre una sesión de navegador pre-autenticada
([frida-agent-browser](frida-agent-browser.md) `network har`), o un HAR ya
capturado con devtools/mitmproxy — y deriva `docs/api/`: la **spec OpenAPI
3.1 de la API observada** (`openapi.json`, errores 4xx/5xx incluidos), la
**matriz funcionalidad↔endpoint↔módulo** con grounding del moat, huérfanos
bidireccionales, **zona muerta calificada por alcanzabilidad** y **grafo de
navegación** con frontera clasificada. Es el primer pack que combina los dos
ejes de sus hermanos: el moat declarativo de
[frida-understand-app](frida-understand-app.md) (M1) y la sesión pinneada por
args de [frida-app-walkthrough](frida-app-walkthrough.md) (M8) — ejes
ortogonales del motor. Mismo modelo: skill pack que **compone** al motor —
sin tools propios, sin ciclo de vida de sesión, cero dependencias npm nuevas.

## Qué es (y qué no es)

**Es**: un generador determinista de documentación de API **desde tráfico
observado**, one-shot y desatendido tras el lanzamiento. Las fases
deterministas trocean el HAR (en el host, con `node`), agregan la spec,
derivan el grafo y sintetizan los entregables desde un solo inventario; los
agentes desechables sólo interpretan la pantalla en el walk, clasifican la
frontera, correlacionan con el moat y auditan. La spec documenta **lo
observado**: cada path/método/código viene de una petición real del HAR.

**No es**: testing/mocking de la API (eso es [frida-tea](frida-tea.md)), un
proxy man-in-the-middle (mitmproxy es sólo un formato de entrada), una spec
autorativa con schemas inferidos (no infiere schemas de ejemplos), panel
visual de la matriz (M2), re-corrida con diff, ni backport del grafo a M8.

## El workflow — 8 fases

| Fase | Tipo | Qué hace |
| --- | --- | --- |
| `bootstrap` | determinista | `mkdir -p` de `docs/api/**`; **gate de sesión viva** (walk) o verificación+copia del HAR externo; **sonda híbrida del moat** (const `CAPABILITIES` interpolada host-side + `test -s` del índice); sondas de docs hermanos M8/M1 con degradaciones deterministas; fecha/epoch vía shell |
| `walk` | agéntica (sólo modo walk) | Loop «script navega, agente decide» molde M8 con dos deltas: **captura HAR** (salvage stop → `network har start --content all` antes del `open` inicial → `stop <ruta-absoluta>` en `try/finally`) y **epoch por acción** (insumo del join temporal). Veto de irreversibles; cortes de presupuesto ANTES de gastar LLM |
| `ingest` | determinista | **Carve del HAR con `node` en el host** (el sandbox no puede parsear HARs de decenas de MB): `requests.jsonl` + `payloads.jsonl` delgados + censo de dominios + **join screenId por epochs**. HAR vacío o 0 same-origin → error accionable con el censo |
| `spec` | determinista | Agregación **OpenAPI 3.1**: paths colapsados (numérico/UUID/ObjectId → `{id}`), **todos los códigos observados** (4xx/5xx incluidos), ejemplo de request payload **scrubbeado de secretos**; tabla `endpoints.json` con IDs estables `E01..` + gate de forma post-escritura |
| `graph` | determinista + 1 agente | Deriva `nav-graph.json` + `navegacion.md` desde steps propios o de M8: aristas `traversed` / `attempted-failed` (3 causas) / `discovered` (refs no ejercidas), frontera con **motivo** (corte de presupuesto vs agotamiento vs interacción no lograda), errores por pantalla citando step+archivo. El agente `boundary` clasifica las descubiertas (`duplicada`/`externa`/`destructiva-vetada`/`requiere-datos`/`desconocida`) sólo si existen |
| `matrix` | agéntica (moat) | Prep determinista de rutas **candidatas** de zona muerta (grep multi-framework + semilla `components[]` de M1) → un correlacionador cruza endpoints ↔ funcionalidades (walk o docs M8) ↔ módulos con evidencia `file:line`; huérfanos bidireccionales; zona muerta calificada |
| `synthesize` | determinista | `matriz.md` + `README.md` desde el **mismo inventario serializado** + **veredicto de cobertura** determinista (molde `m4m5Verdict` de M1: un gap que no está en el inventario no puede aparecer) |
| `judge` | agéntica | Auditor detached contra los archivos reales: `PASS / CONCERNS / FAIL`; corte por presupuesto/tiempo = gap CONOCIDO → `CONCERNS`, no `FAIL`; muestrea buscando secretos expuestos. Checkpoint final (se omite con `review: "auto"`) |

En modo externo la fase `walk` no nace (las fases nacen de las llamadas
`phase()` en runtime); `maxMinutes` corta el walk, nunca los entregables.

## Args — dos modos mutuamente excluyentes

**Modo `walk`** (el workflow navega la app y graba el HAR):

| Arg | Tipo | Default | Descripción |
| --- | --- | --- | --- |
| `url` | `string` | — | URL base de la app (**requerida**) |
| `maxScreens` | `number` | — | Tope de pantallas únicas (**requerido**, entero 0-200; `0` = «todo») |
| `maxMinutes` | `number` | — (omitido) | Backstop wall-clock (entero 1-240 min). Omitido = sin tope; al vencer corta el walk marcando `stoppedBy: "time"` |
| `session` | `string` | `"app-walkthrough"` | Sesión de navegador pre-autenticada (pin `--session`); otro nombre para descolisionar corridas M8/M9 paralelas |
| `language` | `string` | `"es-MX"` | Idioma (BCP-47) de los entregables |
| `review` | `"manual" \| "auto"` | `"manual"` | `"manual"` detiene en el checkpoint final; `"auto"` corre desatendido |

**Modo `externo`** (ingiere un HAR ya capturado, sin abrir navegador):

| Arg | Tipo | Default | Descripción |
| --- | --- | --- | --- |
| `harPath` | `string` | — | Ruta al archivo HAR (devtools/mitmproxy) (**requerida**, absoluta o relativa al cwd) |
| `maxMinutes` / `language` / `review` | — | — | Ídem walk (`maxMinutes` sin efecto: no hay walk) |

`url` y `harPath` son **mutuamente excluyentes** — mezclarlos u omitir ambos
falla eager con un error que instruye el flujo correcto. `maxScreens` es
requerido **a propósito** (espejo M8): tras el launch la corrida es
desatendida, así que el presupuesto se pregunta ANTES con `ask_user_question`
en la sesión principal.

## Entregables

```text
docs/api/
├── README.md                 # índice determinista (corrida, conteos, veredicto de cobertura)
├── openapi.json              # spec OpenAPI 3.1 de la API observada
├── matriz.md                 # matriz funcionalidad↔endpoint↔módulo + huérfanos + zona muerta
├── navegacion.md             # grafo (mermaid) + frontera clasificada + errores por pantalla
└── artifacts/
    ├── inventory.json        # writer único (el script) — registro auditable
    ├── nav-graph.json        # grafo derivado (nodos, aristas, frontera)
    ├── requests.jsonl        # carve: una petición por línea, con screenId
    ├── payloads.jsonl        # payloads de request acotados (4 KB) — referenciados
    ├── endpoints.json        # tabla delgada E01.. por endpoint
    ├── timeline.json         # [{epoch, screenId}] — insumo del join temporal
    ├── deadzone-candidates.txt # rutas candidatas (greps multi-framework + semilla M1)
    ├── raw.har               # HAR crudo preservado (capturado o copia del externo)
    ├── steps/                # sólo modo walk: snapshots por paso + *-validation.json
    └── screenshots/          # sólo modo walk: una por pantalla, página completa (evidencia de la matriz)
```

`inventory.json` es grep-verificable ex-post y la fuente de verdad de
`matriz.md` y `README.md`. IDs estables: pantallas `P01..`, endpoints
`E01..`, filas de matriz `M01..` — citables entre documentos y en issues.

## Correlación pantalla↔petición y seguridad del tráfico

- **Join temporal**: el binario graba el HAR pero no correlaciona peticiones
  con el timeline del walk. El script añade `epoch` a cada acción/pantalla y
  el carve hace el join determinista: `epoch(petición) ∈ [epoch(N),
  epoch(N+1))` → screenId del paso N; el burst de hidratación previo a la
  primera acción se atribuye a la primera pantalla. En modo externo no hay
  join: la columna de funcionalidad sale de `docs/funcional/` (M8) o degrada
  a matriz endpoint↔módulo.
- **Secretos**: el HAR puede traer tokens/cookies de una sesión real. El
  carve **no extrae headers** (garantía estructural) y los ejemplos de
  payload se scrubbean deterministamente (claves sospechosas →
  `[REDACTADO]`). Los payloads se **referencian** (`payloads.jsonl`), nunca
  se inlinean completos. El workflow nunca hace login.

## El moat — tools inyectadas en las sesiones hijas

El patrón declara `meta.moat = { lens: true, codebaseIndex: true }` (mismo
seam que understand-app): flags JSON-safe visibles en `workflow_catalog`;
`patternMeta` persistido en el snapshot → retry/resume reconstruyen el moat;
el toggle `frida.codebaseIndex.enabled` se respeta; `index_codebase` es la
única tool que muta disco (`.codebase-index/`).

| Extensión | Tools |
| --- | --- |
| **pi-lens** (read-only) | `project_report`, `symbol_search`, `module_report`, `read_symbol` |
| **frida-codebase-index** | `semantic_context`, `semantic_search`, `call_graph`, `implementation_lookup`, `index_codebase`, `index_status` |

La sonda de capacidades es híbrida (instalación interpolada host-side +
presencia física del índice con `test -s` in-sandbox) y la factory re-sondea
en cada `resolve()` — exacta por launch. Es el **primer pack que combina
moat + sesión pinneada**: `meta.moat` y `args.session` son ejes ortogonales
del spawner del motor.

## Zona muerta y degradaciones (disciplina M1)

- **Zona muerta** (rutas del código ausentes del tráfico): la capa
  determinista siembra candidatas con una tabla curada de patrones por
  framework (Express, Flask, Django, Spring, FastAPI, Laravel, Next.js) +
  semilla `entryPoints[]/hubs[]` de `components[]` de M1 cuando existe; el
  agente de `matrix` groundea cada candidata con el moat (evidencia
  `file:line`) y la clasifica: `probablemente-viva` (alcanzable por arista
  descubierta del grafo) / `candidata-real` (sin aristas entrantes) /
  `desconocida`. Sin matches ni semilla → degradación honesta «no
  enumerable» — nunca se inventan rutas.
- **Degradaciones espejo M1** (`{phase, tool, reason, workaround, evidence}`
  en el inventario): sin `docs/funcional/` → matriz endpoint↔módulo; sin
  `docs/entendimiento/` → zona muerta sin semilla (queda grep
  multi-framework); moat ausente → modo guía; modo externo sin M8 → grafo no
  derivable. El contrato de gaps conocidos viaja en el prompt del judge y en
  el bloque «Contexto de corte» con `degradations=N`.

## Política de acciones

El veto vive en un **preamble no-stage** (`TRAFFIC2API_PREAMBLE` en
`skills.ts`), interpolado FUERA del mapa de stages — un override 3-capas
reemplaza el prompt completo del stage y no puede tocarlo:

- **Permitido**: navegar y ejercer acciones **no destructivas** (búsqueda,
  filtro, ordenamiento, paginación — la meta del walk es ejercer la API);
  escribir ÚNICAMENTE `docs/api/**`.
- **Excepción única**: `index_codebase` puede escribir `.codebase-index/`.
- **VETADO**: todo lo irreversible sobre la app (crear/editar/eliminar
  registros, compras, envíos, cambios de configuración o de cuenta, logout) —
  el agente marca `[VETOED]` y elige otra.
- **Seguridad del HAR**: nunca copiar headers de autorización, cookies ni
  tokens a los entregables; payloads referenciados, no inlineados.

## Estructura

```text
src/tools/frida-traffic2api/
├── skills.ts     # TRAFFIC2API_STAGES + prompts defaults (es-MX) + preamble no-stage
├── resolver.ts   # 3-capas reusada de frida-aidd (createLayeredStageResolver, 5º consumidor)
├── workflow.ts   # validación eager de modos + generador del script de 8 fases
└── index.ts      # TRAFFIC2API_PATTERN + createFridaTraffic2Api() (sonda moat host-side)
```

## Registro en runtime

`createFridaTraffic2Api()` registra el patrón con `registerBuiltinPattern` —
el motor lo expone en `workflow({ name: "traffic2api", args })` y en el
picker `/wf` (sección «Patrones agénticos»). Idempotente por nombre; el cwd
se resuelve lazy en `resolve()` (los overrides de equipo son por repo). Sin
gate de setting propio (el gate relevante es
`frida.extensibleWorkflows.enabled` del motor). La entrada de pi-session
pasa el `agentDir` real y el getter `codebaseIndexEnabled` para que la const
`CAPABILITIES` del script sea exacta respecto de instalación y toggle.
Alias de ayuda: `traffic2api`/`traffic`/`tráfico`/`api`/`openapi`/`har`
(HELP_TOOLS, first-match sin colisiones).

## Customización 3-capas

Los prompts se resuelven en launch-time (mismo núcleo que frida-aidd):

1. **Defaults** — `skills.ts` (bundled).
2. **Equipo** — `.frida/traffic2api/stages.json` en el repo.
3. **Usuario** — `~/.frida/traffic2api/stages.json`.

```json
{ "stages": { "matrix": "nuestro criterio de correlación…" } }
```

Stages: `walk`, `boundary`, `matrix`, `judge` (una clave por rol agéntico;
bootstrap, ingest, spec, la derivación del grafo y synthesize son
deterministas y no tienen clave). Un override es el prompt completo del
stage. JSON inválido aborta ruidosamente antes de correr nada. **Los vetos
y la seguridad del HAR no son direccionables desde aquí** (viven en el
preamble no-stage).

## Metadatos

El patrón declara `meta.requiredTools: ["shell"]`,
`meta.executionHints.autonomous: true` y `meta.moat: { lens: true,
codebaseIndex: true }` — visibles en `workflow_catalog` como JSON.

## Pruebas

`test/frida-traffic2api/`:

- **resolver** (6): defaults, equipo, usuario, ignora desconocidos, JSON
  inválido aborta, vetos viven sólo en el preamble.
- **pattern**: validación eager de modos excluyentes, sonda de capacidades
  host-side, forma del script por modo (8 fases, contrato `network har`
  start/stop, `CAPABILITIES`, cortes, `ctx.cwd`), registro en runtime
  idempotente.
- **e2e**: motor real (`runWorkflowInStore`) con el binario falsificado en
  PATH (rama `network har` según el contrato observado en smoke), HARs
  externos inline (devtools/mitmproxy), moat falsificado host-side,
  degradaciones y cortes.
- **openapi-schema**: typebox host-side validando fixtures y el artefacto
  real de una corrida e2e compacta (criterio de aceptación del FRD).

## Ver también

- [README](../../README.md) — índice general de Frida Code.
- [Guía de uso](../how-to-frida-traffic2api.md) — recetas paso a paso.
- [frida-extensible-workflows](frida-extensible-workflows.md) — el motor.
- [frida-agent-browser](frida-agent-browser.md) — la sesión de navegador y la captura HAR.
- [frida-understand-app](frida-understand-app.md) · [frida-app-walkthrough](frida-app-walkthrough.md) — los hermanos de la Pista M.
- [modernization-apps](../modernization-apps.md) — el marco (Pista M).
