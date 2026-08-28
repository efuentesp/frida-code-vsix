# frida-size-app — dimensionamiento cuantitativo de apps para preventa (patrón builtin)

> Issue #139 · M10 · Pista M

Skill pack que registra el patrón builtin **`size-app`** sobre el motor de
[frida-extensible-workflows](frida-extensible-workflows.md): toma una app
(desde su código — no la ejecuta) y produce un **dimensionamiento
cuantitativo para preventa**: KLOC efectivos, **COCOMO Basic 81** con spread
EAF y costo con wage mensual, **SQALE proxy** de deuda técnica, percentiles
de complejidad, hotspots/churn/coupling/bus factor y **olas de migración
strangler-fig** — entregables deterministas en `docs/dimensionamiento/` con
`metrics.json` como **única fuente de verdad numérica**. Hermano
cuantitativo de [frida-understand-app](frida-understand-app.md) (M1): M1
dice *dónde está el riesgo*, M10 dice *cuánto cuesta*. Es la primera
extensión de Frida con una **dependencia binaria no-npm**: el contador
`scc` v4.0.0 (Go, MIT, 270+ lenguajes) se pinea al agentDir con sha256
verificado. Mismo modelo que sus hermanos: skill pack que **compone** al
motor — sin tools propios, sin ciclo de vida de sesión, cero dependencias
npm nuevas.

## Qué es (y qué no es)

**Es**: un medidor determinista one-shot, desatendido tras el lanzamiento.
Las fases deterministas corren `scc` (y `lizard` si existe), agregan todo a
`artifacts/metrics.json` (writer único) y sintetizan el informe 100% desde
ahí; los agentes desechables sólo escriben 3 anexos interpretativos y
auditan. Cada cifra del informe está en `metrics.json` tal cual o se
re-deriva con la fórmula declarada junto a ella (**juez de números**): la
reproducibilidad del número (misma versión de scc = mismos números entre
máquinas) es el argumento de auditoría de la preventa.

**No es**: SonarQube (el SQALE es un *proxy* etiquetado como tal), un
estimador de proyectos verdes (COCOMO calibra sobre código EXISTENTE), un
panel visual (M2), cotización de regeneración con LLM (LOCOMO, fuera del
milestone), ni comandos slash del Composer (#140, follow-up).

## El workflow — 5 fases

| Fase | Tipo | Qué hace |
| --- | --- | --- |
| `bootstrap` | determinista | `mkdir -p` de `docs/dimensionamiento/**`; fecha/epoch vía shell (`Date` tapado en el sandbox); gates por familia: repo `git` (churn/coupling/autores), `lizard` en PATH (CCN por función) — una capacidad ausente **degrada** (`{familia, causa, hint}`), jamás aborta |
| `metrics` | determinista | Sondas del binario pineado **por ruta absoluta** (jamás del PATH): `--by-file --format json --cognitive` volcado a disco (el JSON grande no cruza el límite RPC de 10 MB), 2ª pasada **raw sin exclusiones curadas** para medir el volumen excluido, `-a` (DRYness/ULOC), `--hotspots/--coupling/--by-author` (si hay git), `lizard --csv` (si existe); un helper `node` host-side agrega y devuelve un JSON delgado → `artifacts/metrics.json` |
| `analyze` | agéntica | Fan-out de 3 escritores fijos de anexos interpretativos (`analisis/hotspots.md`, `deuda-modulos.md`, `riesgos-tamano.md`) — leen `metrics.json` de disco y no re-sondean; gate `test -s` + reintento informado único |
| `synthesize` | determinista | `derived` (KLOC, percentiles nearest-rank, SQALE, COCOMO 3 corridas EAF, bus factor, olas) computado EXCLUSIVAMENTE de `metrics.json`; `dimensionamiento.md` + `README.md` derivados al 100% — ninguna cifra nueva |
| `judge` | agéntica | Auditor detached `PASS / CONCERNS / FAIL` contra los archivos reales: cifra sin rastro en `metrics.json` = FAIL; familia degradada o corte por presupuesto = CONCERNS. Checkpoint final sólo con `review: "manual"` |

`maxMinutes` corta el descubrimiento (analyze), **nunca** salta
synthesize/judge sobre lo alcanzado.

## Args

| Arg | Tipo | Default | Descripción |
| --- | --- | --- | --- |
| `wage` | `number` | — | Salario **mensual** por persona (**requerido** a propósito; decimales válidos). Si falta, el error instruye preguntar con `ask_user_question` ANTES del launch: "MXN $35,000" (wage 35000, currency "MXN") · "USD $6,000" (wage 6000, currency "USD") · o monto propio — tras el launch la corrida es desatendida |
| `currency` | `string` | `"USD"` | Etiqueta de moneda del informe (pura etiqueta, sin conversión) |
| `cocomoType` | `"organic" \| "semi-detached" \| "embedded"` | `"semi-detached"` | Modo Basic COCOMO 81 |
| `exclude` | `string[]` | `[]` | Directorios adicionales a excluir — AMPLÍAN la default curada; `[]` = sólo curada |
| `maxMinutes` | `number` | `0` | Backstop wall-clock (entero 1-240 min). `0`/omitido = sin tope; corta analyze, no los entregables |
| `language` | `string` | `"es-MX"` | Idioma (BCP-47) de los entregables |
| `review` | `"manual" \| "auto"` | `"manual"` | `manual` detiene en el checkpoint final |

**Default curada de exclusiones** (SIEMPRE aplicada, aditiva a los defaults
git de scc): `dist, build, node_modules, vendor, target, out, .next,
coverage` + patrón `*.min.js`. El informe declara cada exclusión con su
**volumen medido** (delta de la 2ª pasada raw).

## Entregables

```text
docs/dimensionamiento/
├── README.md                    # índice determinista (corrida, familias)
├── dimensionamiento.md          # el informe: KLOC, COCOMO±rango, SQALE, olas
├── analisis/
│   ├── hotspots.md              # narrativa agéntica de top hotspots (anexo)
│   ├── deuda-modulos.md         # deuda por módulo (anexo)
│   └── riesgos-tamano.md        # riesgos de tamaño (anexo)
└── artifacts/
    ├── metrics.json             # ÚNICA fuente de verdad (writer único)
    ├── scc-by-file.json         # evidencia cruda (con exclusiones)
    ├── scc-by-file-raw.json     # pasada sin curada (volumen excluido)
    ├── scc-a.json               # DRYness/ULOC
    ├── scc-hotspots.csv         # evidencia cruda (si hay git)
    ├── scc-coupling.csv         # evidencia cruda (si hay git)
    ├── scc-by-author.csv        # evidencia cruda (si hay git)
    ├── lizard.csv               # CCN por función (si lizard existe)
    └── metrics-agg.js           # helper host-side (agregación delgada)
```

`metrics.json` es grep-verificable ex-post: `run` (corrida, wage,
exclusiones aplicadas), `capabilities`, `exclusions` con volumen,
`families` con status `ok|absent|empty|parse-error`, `degradations[]
{familia, causa, hint}`, `annexes[]` y `derived` (KLOC, SQALE, COCOMO,
percentiles, bus factor, olas, deuda por módulo — cada fórmula declarada
junto al valor).

## El binario scc — pin al agentDir

Primera dependencia binaria **no-npm** del repo. `scc` v4.0.0 (2026-08-24)
es la única versión con `--hotspots/--coupling/--by-author/--cognitive`.

- **Pin deliberado**: el installer (`installer.ts`) descarga el asset de
  la matrix completa de 8 plataformas (darwin/linux/win32 ×
  arm64/x64/ia32) desde GitHub Releases, verifica el **sha256 contra
  `checksums.txt` ANTES de extraer**, descomprime (tar.gz mínimo propio /
  `unzipSync` en win32) y coloca el binario en `<agentDir>/bin/scc`
  (chmod 0o755) + marker de pin.
- **Fire-and-forget**: `resolve()` del patrón es síncrona por contrato del
  motor — la descarga se dispara al **registrar la factory** (molde
  frida-hermes-memory), nunca bloquea ni tumba la sesión; el gate
  `isSccInstalledAtPin` la vuelve no-op tras la primera descarga (~7 MB).
- **Autorreparable**: borrar `<agentDir>/bin/` → re-descarga al siguiente
  arranque. El script invoca scc por **ruta absoluta** (jamás del PATH):
  reproducibilidad del pin.
- **Doctor**: `checkScc` es el 8º check de "Verificar entorno" — misma
  sonda que `CAPABILITIES.scc` del patrón (doctor y workflow nunca
  discrepan); ausente = guía accionable, no error.
- **Degradación**: si la descarga sigue en curso o falló, la corrida
  degrada las 5 familias scc con causa+hint — no aborta.

## Las cifras y sus fórmulas

Todas las fórmulas viven declaradas junto al valor (en
`metrics.json.derived` y a pie de tabla del informe) para auditoría:

- **KLOC efectivos**: SLOC (Code) total con exclusiones.
- **COCOMO — Basic COCOMO 81 (Boehm)**, réplica EXACTA de scc
  (`processor/cocomo.go`): E = a·KSLOC^b·EAF (persona-mes), TDEV = c·E^d
  (meses), personas pico = E/TDEV, costo = E·wage mensual·overhead 2.4.
  Constantes por modo: organic {2.4, 1.05, 2.5, 0.38}, semi-detached
  {3.0, 1.12, 2.5, 0.35}, embedded {3.6, 1.20, 2.5, 0.32}.
- **Spread EAF 0.85 / 1.00 / 1.15**: supuesto conservador del analista,
  etiquetado explícitamente **no estándar** (lo documentado: típicamente
  0.9–1.4). La fila central (1.00) va en bold.
- **SQALE proxy** (etiquetado "proxy, NO es SonarQube"):
  `deudaHoras = Σ por archivo max(0, cognitiva − 15) × 0.5 h` (umbral 15 =
  complejidad cognitiva alta, estándar SonarQube); rating =
  `deudaHoras / (0.5 h × NCLOC)` con umbrales A ≤0.05 · B ≤0.10 · C ≤0.20 ·
  D ≤0.50 · E >0.50.
- **Percentiles nearest-rank** (`sorted[ceil(p·N)−1]`), etiquetados
  distintamente: complejidad por archivo (scc) vs CCN por función (lizard,
  opcional).
- **Bus factor**: autores necesarios para cubrir ≥50% del Code total.
- **Olas strangler-fig**: módulos = top-level dirs con LOC ≥ 1% del total,
  ordenados por deuda desc; ola 1 acumula ~1/3 de la deuda, ola 2 el
  siguiente 1/3, ola 3 el resto (≥1 módulo por ola restante); semanas =
  share × TDEV central (EAF 1.00) × 52/12.
- **Exclusiones con volumen**: delta de la 2ª pasada raw + volumen del
  patrón `*.min.js`.

## El moat — tools inyectadas en las sesiones hijas

El patrón declara `meta.moat = { lens: true, codebaseIndex: true }` (mismo
seam que understand-app/traffic2api): flags JSON-safe visibles en
`workflow_catalog`; el toggle `frida.codebaseIndex.enabled` se respeta; la
factory re-sondea en cada `resolve()` — exacta por launch.

| Extensión | Tools |
| --- | --- |
| **pi-lens** (read-only) | `project_report`, `symbol_search`, `module_report`, `read_symbol` |
| **frida-codebase-index** | `semantic_context`, `semantic_search`, `call_graph`, `implementation_lookup`, `index_codebase`, `index_status` |

## Degradaciones (disciplina M1)

Una capacidad ausente **jamás aborta** la corrida — degrada con
`{familia, causa, hint}` y el informe marca "no disponible":

- Sin scc instalado al pin (descarga en curso/fallida): 5 familias
  (by-file, duplication, hotspots, coupling, authors).
- Sin repo git: 3 familias (hotspots, coupling, authors) — churn no
  derivable sin historial.
- Sin `lizard` en PATH: 1 familia (ccn-funcion) — opcional, `pip install
  lizard`.
- Familia corrupta mid-run (JSON/CSV no parseable): el helper host-side
  reporta `{status, causa, hint}` sin duplicar los gates de bootstrap.

## Política de acciones

El veto vive en un **preamble no-stage** (`SIZE_APP_PREAMBLE` en
`skills.ts`), interpolado FUERA del mapa de stages — un override 3-capas
reemplaza el prompt completo del stage y no puede tocarlo:

- **VETADO** todo cambio al código fuente del proyecto: escribir
  ÚNICAMENTE `docs/dimensionamiento/**`.
- **Juez de números** (no negociable): toda cifra está en `metrics.json`
  tal cual o se re-deriva de él con fórmula declarada — nunca se inventa,
  estima ni "corrige".

## Estructura

```text
src/tools/frida-size-app/
├── constants.ts  # pin scc + matrix 8 assets + digests reales + rutas del binario/marker
├── installer.ts  # ensureBinary (sha256 antes de extraer) + extractTarGz + isSccInstalledAtPin
├── skills.ts     # SIZE_APP_STAGES + prompts defaults (es-MX) + preamble no-stage
├── resolver.ts   # 3-capas reusada de frida-aidd (6º consumidor del customize-layer)
├── workflow.ts   # validación eager + generador del script de 5 fases
└── index.ts      # SIZE_APP_PATTERN + createFridaSizeApp() (sonda + fire-and-forget)
```

## Registro en runtime

`createFridaSizeApp()` registra el patrón con `registerBuiltinPattern` —
el motor lo expone en `workflow({ name: "size-app", args })` y en el
picker `/wf` (sección «Patrones agénticos»). Idempotente por nombre; el
cwd se resuelve lazy en `resolve()` (los overrides de equipo son por
repo). La entrada de pi-session pasa el `agentDir` real y el getter
`codebaseIndexEnabled` para que la const `CAPABILITIES` del script sea
exacta. Alias de ayuda: `size-app`/`size`/`tamaño`/`dimensionamiento`/
`cocomo` (HELP_TOOLS, first-match sin colisiones).

## Customización 3-capas

Los prompts se resuelven en launch-time (mismo núcleo que frida-aidd):

1. **Defaults** — `skills.ts` (bundled).
2. **Equipo** — `.frida/size-app/stages.json` en el repo.
3. **Usuario** — `~/.frida/size-app/stages.json`.

```json
{ "stages": { "judge": "nuestra rúbrica de auditoría…" } }
```

Stages: `analyze`, `judge` (una clave por rol agéntico; bootstrap, metrics
y synthesize son deterministas y no tienen clave). Un override es el
prompt completo del stage. JSON inválido aborta ruidosamente antes de
correr nada. **El veto y el juez de números no son direccionables desde
aquí** (viven en el preamble no-stage). La regla corte por presupuesto →
CONCERNS vive DOS veces (prompt default de judge + runtime block del
script) para sobrevivir overrides.

## Metadatos

El patrón declara `meta.requiredTools: ["shell"]`,
`meta.executionHints.autonomous: true` y `meta.moat: { lens: true,
codebaseIndex: true }` — visibles en `workflow_catalog` como JSON.

## Pruebas

`test/frida-size-app/`:

- **installer** (8): digests↔assets guardián del bump, idempotencia,
  tar.gz y zip win32, sha256 negativo sin estado a medias, tar-slip,
  plataforma sin asset, fallo de red con guía.
- **resolver** (6): defaults, equipo, usuario, ignora desconocidos y fases
  deterministas, JSON inválido aborta, veto/juez sólo en el preamble.
- **pattern** (31): validación eager (wage/cocomoType/exclude/maxMinutes/
  review), sonda de capacidades, forma del script (5 fases,
  CAPABILITIES, SCC_BIN absoluta, escapes), registro idempotente +
  fire-and-forget.
- **e2e** (9): motor real con scc falso instalado al pin (ruta absoluta):
  recorrido feliz con cifras congeladas, degradación total (9), familia
  corrupta (5), corte wall-clock FAKE_DATE, escritor mentiroso/flaky,
  juez FAIL sin abortar, checkpoint manual, determinismo.
- **cocomo-domain** (7): schema TypeBox + fixture congelada (521.3 PM para
  KSLOC=100 EAF 1.00 semi) + anti-fixtures + e2e compacta con borde
  SQALE B.

Más `test/environment-doctor.test.ts` (19): checkScc al pin / ausente /
pin viejo + reporte global de 8 deps.

## Ver también

- [README](../../README.md) — índice general de Frida Code.
- [Guía de uso](../how-to-frida-size-app.md) — recetas paso a paso.
- [frida-extensible-workflows](frida-extensible-workflows.md) — el motor.
- [frida-understand-app](frida-understand-app.md) — el hermano cualitativo de la Pista M.
- [modernization-apps](../modernization-apps.md) — el marco (Pista M).
